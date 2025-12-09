// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title FileStorageManager
 * @author Jeju Network
 * @notice Simple on-chain tracking and payment for IPFS file storage
 * @dev Legacy contract - use StorageMarket + StorageProviderRegistry for full marketplace
 * 
 * Features:
 * - Multi-token payment support (USDC, elizaOS, ETH)
 * - Duration-based pricing (1 month, 6 months, 1 year)
 * - File expiry tracking
 * - Revenue distribution
 */
contract FileStorageManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    
    struct FileRecord {
        bytes32 cid;
        address owner;
        uint256 sizeBytes;
        uint256 paidAmount;
        address paymentToken;
        uint256 createdAt;
        uint256 expiresAt;
        bool isPinned;
    }
    
    mapping(bytes32 => FileRecord) public files;
    mapping(address => bytes32[]) private _ownerFiles;
    mapping(address => bool) public supportedTokens;
    mapping(address => uint256) public pricePerGBPerMonth;
    
    address public immutable treasury;
    address public immutable nodeOperator;
    
    uint256 public totalFilesStored;
    uint256 public totalBytesStored;
    uint256 public totalRevenueCollected;
    
    event FilePinned(bytes32 indexed cid, address indexed owner, uint256 sizeBytes, uint256 paidAmount, address paymentToken, uint256 expiresAt);
    event FileUnpinned(bytes32 indexed cid, address indexed owner);
    event FileRenewed(bytes32 indexed cid, uint256 newExpiresAt, uint256 payment);
    event PaymentReceived(address indexed payer, uint256 amount, address token);
    
    constructor(address _treasury, address _nodeOperator, address _owner) Ownable(_owner) {
        treasury = _treasury;
        nodeOperator = _nodeOperator;
        pricePerGBPerMonth[address(0)] = 0.0001 ether;
    }
    
    function pinFile(
        bytes32 cid,
        uint256 sizeBytes,
        uint256 durationMonths,
        address paymentToken
    ) external payable nonReentrant {
        require(sizeBytes > 0, "Invalid size");
        require(durationMonths > 0 && durationMonths <= 12, "Invalid duration");
        require(files[cid].createdAt == 0, "File already exists");
        
        uint256 cost = calculateCost(sizeBytes, durationMonths, paymentToken);
        
        if (paymentToken == address(0)) {
            require(msg.value >= cost, "Insufficient payment");
        } else {
            require(supportedTokens[paymentToken], "Token not supported");
            IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), cost);
        }
        
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
        totalFilesStored++;
        totalBytesStored += sizeBytes;
        totalRevenueCollected += cost;
        
        emit FilePinned(cid, msg.sender, sizeBytes, cost, paymentToken, files[cid].expiresAt);
        emit PaymentReceived(msg.sender, cost, paymentToken);
    }
    
    function renewFile(bytes32 cid, uint256 additionalMonths, address paymentToken) external payable nonReentrant {
        FileRecord storage file = files[cid];
        require(file.owner == msg.sender, "Not owner");
        require(file.isPinned, "File not pinned");
        
        uint256 cost = calculateCost(file.sizeBytes, additionalMonths, paymentToken);
        
        if (paymentToken == address(0)) {
            require(msg.value >= cost, "Insufficient payment");
        } else {
            IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), cost);
        }
        
        file.expiresAt += additionalMonths * 30 days;
        
        emit FileRenewed(cid, file.expiresAt, cost);
        emit PaymentReceived(msg.sender, cost, paymentToken);
    }
    
    function unpinFile(bytes32 cid) external {
        require(files[cid].owner == msg.sender, "Not owner");
        files[cid].isPinned = false;
        emit FileUnpinned(cid, msg.sender);
    }
    
    function calculateCost(uint256 sizeBytes, uint256 durationMonths, address paymentToken) public view returns (uint256) {
        uint256 sizeGB = (sizeBytes * 1e18) / (1024 ** 3);
        uint256 pricePerGB = pricePerGBPerMonth[paymentToken];
        if (pricePerGB == 0) {
            pricePerGB = pricePerGBPerMonth[address(0)];
        }
        return (sizeGB * pricePerGB * durationMonths) / 1e18;
    }
    
    function getOwnerFiles(address owner) external view returns (bytes32[] memory) {
        return _ownerFiles[owner];
    }
    
    function isExpired(bytes32 cid) external view returns (bool) {
        return block.timestamp > files[cid].expiresAt;
    }
    
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
            
            (bool s1,) = nodeOperator.call{value: toNodeOp}("");
            require(s1, "Node operator transfer failed");
            (bool s2,) = treasury.call{value: toTreasury}("");
            require(s2, "Treasury transfer failed");
        } else {
            IERC20 erc20 = IERC20(token);
            uint256 balance = erc20.balanceOf(address(this));
            uint256 toNodeOp = (balance * 70) / 100;
            uint256 toTreasury = balance - toNodeOp;
            
            erc20.safeTransfer(nodeOperator, toNodeOp);
            erc20.safeTransfer(treasury, toTreasury);
        }
    }
    
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
    
    receive() external payable {}
}

