// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title FileStorageManager
 * @author Jeju Network
 * @notice On-chain tracking and payment for IPFS file storage
 * @dev Integrates with local IPFS nodes, x402 payments, and A2A protocol
 * 
 * Features:
 * - Multi-token payment support (USDC, elizaOS, ETH)
 * - Duration-based pricing (1 month, 6 months, 1 year)
 * - File expiry tracking
 * - Owner permissions
 * - Revenue distribution
 * - A2A agent integration
 */
contract FileStorageManager is Ownable, ReentrancyGuard {
    
    // ============ Structs ============
    
    struct FileRecord {
        bytes32 cid;           // IPFS content ID (hash)
        address owner;         // Who uploaded/owns the file
        uint256 sizeBytes;     // File size
        uint256 paidAmount;    // Amount paid for storage
        address paymentToken;  // Token used for payment (address(0) = ETH)
        uint256 createdAt;     // Upload timestamp
        uint256 expiresAt;     // When storage expires
        bool isPinned;         // Currently pinned status
    }
    
    // ============ State Variables ============
    
    /// @notice All file records
    mapping(bytes32 => FileRecord) public files;
    
    /// @notice Files by owner
    mapping(address => bytes32[]) private _ownerFiles;
    
    /// @notice Supported payment tokens
    mapping(address => bool) public supportedTokens;
    
    /// @notice Pricing: cost per GB per month (in wei of token)
    mapping(address => uint256) public pricePerGBPerMonth;
    
    /// @notice Revenue distribution addresses
    address public treasury;
    address public nodeOperator;
    
    /// @notice Total storage stats
    uint256 public totalFilesStored;
    uint256 public totalBytesStored;
    uint256 public totalRevenueCollected;
    
    // ============ Events ============
    
    event FilePinned(
        bytes32 indexed cid,
        address indexed owner,
        uint256 sizeBytes,
        uint256 paidAmount,
        address paymentToken,
        uint256 expiresAt
    );
    
    event FileUnpinned(bytes32 indexed cid, address indexed owner);
    
    event FileRenewed(bytes32 indexed cid, uint256 newExpiresAt, uint256 payment);
    
    event PaymentReceived(
        address indexed payer,
        uint256 amount,
        address token
    );
    
    // ============ Constructor ============
    
    constructor(
        address _treasury,
        address _nodeOperator,
        address _owner
    ) Ownable(_owner) {
        treasury = _treasury;
        nodeOperator = _nodeOperator;
        
        // Default pricing: $0.10 per GB per month
        // Assuming 18 decimals for USDC on Base
        pricePerGBPerMonth[address(0)] = 0.0001 ether; // ETH pricing
    }
    
    // ============ Core Functions ============
    
    /**
     * @notice Pin file to IPFS with payment
     * @param cid IPFS content ID
     * @param sizeBytes File size in bytes
     * @param durationMonths How long to pin (1, 6, 12)
     * @param paymentToken Token to pay with (address(0) for ETH)
     */
    function pinFile(
        bytes32 cid,
        uint256 sizeBytes,
        uint256 durationMonths,
        address paymentToken
    ) external payable nonReentrant {
        require(sizeBytes > 0, "Invalid size");
        require(durationMonths > 0 && durationMonths <= 12, "Invalid duration");
        require(files[cid].createdAt == 0, "File already exists");
        
        // Calculate cost
        uint256 cost = calculateCost(sizeBytes, durationMonths, paymentToken);
        
        // Process payment
        if (paymentToken == address(0)) {
            // ETH payment
            require(msg.value >= cost, "Insufficient payment");
        } else {
            // ERC-20 payment
            require(supportedTokens[paymentToken], "Token not supported");
            IERC20(paymentToken).transferFrom(msg.sender, address(this), cost);
        }
        
        // Create file record
        files[cid] = FileRecord({
            cid: cid,
            owner: msg.sender,
            sizeBytes: sizeBytes,
            paidAmount: cost,
            paymentToken: paymentToken,
            createdAt: block.timestamp,
            expiresAt: block.timestamp + (durationMonths * 30 days),
            isPinned: true
        });
        
        _ownerFiles[msg.sender].push(cid);
        
        // Update stats
        totalFilesStored++;
        totalBytesStored += sizeBytes;
        totalRevenueCollected += cost;
        
        emit FilePinned(cid, msg.sender, sizeBytes, cost, paymentToken, files[cid].expiresAt);
        emit PaymentReceived(msg.sender, cost, paymentToken);
    }
    
    /**
     * @notice Renew file pinning
     */
    function renewFile(
        bytes32 cid,
        uint256 additionalMonths,
        address paymentToken
    ) external payable nonReentrant {
        FileRecord storage file = files[cid];
        require(file.owner == msg.sender, "Not owner");
        require(file.isPinned, "File not pinned");
        
        uint256 cost = calculateCost(file.sizeBytes, additionalMonths, paymentToken);
        
        if (paymentToken == address(0)) {
            require(msg.value >= cost, "Insufficient payment");
        } else {
            IERC20(paymentToken).transferFrom(msg.sender, address(this), cost);
        }
        
        file.expiresAt += additionalMonths * 30 days;
        
        emit FileRenewed(cid, file.expiresAt, cost);
        emit PaymentReceived(msg.sender, cost, paymentToken);
    }
    
    /**
     * @notice Unpin file (owner only)
     */
    function unpinFile(bytes32 cid) external {
        require(files[cid].owner == msg.sender, "Not owner");
        files[cid].isPinned = false;
        
        emit FileUnpinned(cid, msg.sender);
    }
    
    // ============ View Functions ============
    
    function calculateCost(
        uint256 sizeBytes,
        uint256 durationMonths,
        address paymentToken
    ) public view returns (uint256) {
        uint256 sizeGB = (sizeBytes * 1e18) / (1024 ** 3); // Convert to GB with precision
        uint256 pricePerGB = pricePerGBPerMonth[paymentToken];
        
        if (pricePerGB == 0) {
            pricePerGB = pricePerGBPerMonth[address(0)]; // Use ETH pricing as default
        }
        
        uint256 cost = (sizeGB * pricePerGB * durationMonths) / 1e18;
        return cost;
    }
    
    function getOwnerFiles(address owner) external view returns (bytes32[] memory) {
        return _ownerFiles[owner];
    }
    
    function isExpired(bytes32 cid) external view returns (bool) {
        return block.timestamp > files[cid].expiresAt;
    }
    
    // ============ Admin Functions ============
    
    function addSupportedToken(address token, uint256 pricePerGB) external onlyOwner {
        supportedTokens[token] = true;
        pricePerGBPerMonth[token] = pricePerGB;
    }
    
    function setPricing(address token, uint256 pricePerGB) external onlyOwner {
        pricePerGBPerMonth[token] = pricePerGB;
    }
    
    function withdrawRevenue(address token) external onlyOwner {
        if (token == address(0)) {
            uint256 balance = address(this).balance;
            uint256 toNodeOp = (balance * 70) / 100;
            uint256 toTreasury = balance - toNodeOp;
            
            (bool success1,) = nodeOperator.call{value: toNodeOp}("");
            require(success1, "Node operator transfer failed");
            
            (bool success2,) = treasury.call{value: toTreasury}("");
            require(success2, "Treasury transfer failed");
        } else {
            IERC20 erc20 = IERC20(token);
            uint256 balance = erc20.balanceOf(address(this));
            uint256 toNodeOp = (balance * 70) / 100;
            uint256 toTreasury = balance - toNodeOp;
            
            erc20.transfer(nodeOperator, toNodeOp);
            erc20.transfer(treasury, toTreasury);
        }
    }
    
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
    
    receive() external payable {}
}

