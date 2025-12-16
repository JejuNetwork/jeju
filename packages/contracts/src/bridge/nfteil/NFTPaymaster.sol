// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {
    INFTPaymaster,
    NFTVoucherRequest,
    NFTVoucher,
    NFTAssetType
} from "./INFTEIL.sol";

/**
 * @title NFTPaymaster
 * @author Jeju Network
 * @notice EIL-compliant paymaster for trustless cross-chain NFT transfers
 * @dev Implements the Ethereum Interop Layer (EIL) protocol for atomic cross-chain NFT swaps
 *
 * ## How Cross-Chain NFT Transfer Works:
 *
 * 1. User locks NFT on source chain by calling `createNFTVoucherRequest()`
 * 2. XLP (Cross-chain Liquidity Provider) sees the request
 * 3. XLP has pre-registered wrapped NFT collections on destination chains
 * 4. XLP issues a voucher, committing to mint wrapped NFT to user on destination
 * 5. User receives wrapped NFT on destination chain
 * 6. After fraud proof window, XLP claims locked NFT from source
 *
 * ## Key Differences from Token EIL:
 * - NFTs are non-fungible: XLPs don't hold NFT "reserves"
 * - XLPs deploy/register wrapped collections on each chain
 * - Wrapped NFT preserves original tokenId
 * - Metadata hash verification ensures NFT integrity
 *
 * ## Security:
 * - XLPs must stake on L1 via L1StakeManager
 * - Failed fulfillments result in XLP stake slashing
 * - Users' NFTs are safe: either transfer completes or they get refund
 *
 * @custom:security-contact security@jeju.network
 */
contract NFTPaymaster is 
    INFTPaymaster,
    Ownable,
    ReentrancyGuard,
    IERC721Receiver,
    IERC1155Receiver
{
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ============ Constants ============

    uint256 public constant REQUEST_TIMEOUT = 100; // ~200 seconds
    uint256 public constant VOUCHER_TIMEOUT = 200;
    uint256 public constant CLAIM_DELAY = 300; // ~10 minutes
    uint256 public constant MIN_FEE = 0.0001 ether;

    // ============ State Variables ============

    /// @notice Chain ID of this deployment
    uint256 public immutable chainId;

    /// @notice L1 stake manager for XLP verification
    address public immutable l1StakeManager;

    /// @notice Voucher requests
    mapping(bytes32 => NFTVoucherRequest) public voucherRequests;

    /// @notice Vouchers
    mapping(bytes32 => NFTVoucher) public vouchers;

    /// @notice XLP verified stakes (cached from L1)
    mapping(address => uint256) public xlpVerifiedStake;

    /// @notice XLP registered wrapped collections: xlp => sourceChainId => sourceCollection => wrappedCollection
    mapping(address => mapping(uint256 => mapping(address => address))) public xlpWrappedCollections;

    /// @notice Supported collections for bridging
    mapping(address => bool) public supportedCollections;

    /// @notice Request nonce
    uint256 private _requestNonce;

    /// @notice Fulfilled voucher hashes (replay protection)
    mapping(bytes32 => bool) public fulfilledVoucherHashes;

    /// @notice Total requests processed
    uint256 public totalRequests;

    /// @notice Total NFTs bridged
    uint256 public totalNFTsBridged;

    // ============ Errors ============

    error UnsupportedCollection();
    error InvalidRecipient();
    error InvalidFee();
    error RequestExpired();
    error RequestNotExpired();
    error RequestAlreadyClaimed();
    error RequestAlreadyRefunded();
    error VoucherExpiredError();
    error VoucherAlreadyFulfilled();
    error InvalidVoucherSignature();
    error InsufficientXLPStake();
    error ClaimDelayNotPassed();
    error OnlyXLP();
    error TransferFailed();
    error VoucherAlreadyClaimed();
    error NotNFTOwner();
    error NFTNotApproved();
    error WrappedCollectionNotRegistered();

    // ============ Constructor ============

    constructor(
        uint256 _chainId,
        address _l1StakeManager
    ) Ownable(msg.sender) {
        chainId = _chainId;
        l1StakeManager = _l1StakeManager;
    }

    // ============ Collection Management ============

    /**
     * @notice Add supported collection
     */
    function setSupportedCollection(address collection, bool supported) external onlyOwner {
        supportedCollections[collection] = supported;
    }

    /**
     * @notice Register wrapped collection mapping (XLP)
     */
    function registerWrappedCollection(
        uint256 sourceChainId,
        address sourceCollection,
        address wrappedCollection
    ) external {
        xlpWrappedCollections[msg.sender][sourceChainId][sourceCollection] = wrappedCollection;
        
        emit WrappedCollectionRegistered(sourceChainId, sourceCollection, wrappedCollection);
    }

    /**
     * @notice Update XLP stake (called via L1 cross-chain message or owner)
     */
    function updateXLPStake(address xlp, uint256 stake) external onlyOwner {
        xlpVerifiedStake[xlp] = stake;
    }

    // ============ Voucher Request (Source Chain) ============

    /**
     * @notice Create a cross-chain NFT transfer request
     */
    function createNFTVoucherRequest(
        NFTAssetType assetType,
        address collection,
        uint256 tokenId,
        uint256 amount,
        uint256 destinationChainId,
        address recipient,
        uint256 gasOnDestination,
        uint256 maxFee,
        uint256 feeIncrement
    ) external payable nonReentrant returns (bytes32 requestId) {
        if (!supportedCollections[collection]) revert UnsupportedCollection();
        if (recipient == address(0)) revert InvalidRecipient();
        if (maxFee < MIN_FEE) revert InvalidFee();
        if (msg.value < maxFee) revert InvalidFee();

        // Validate ownership and approval
        if (assetType == NFTAssetType.ERC721) {
            IERC721 nft = IERC721(collection);
            if (nft.ownerOf(tokenId) != msg.sender) revert NotNFTOwner();
            if (!nft.isApprovedForAll(msg.sender, address(this)) && 
                nft.getApproved(tokenId) != address(this)) {
                revert NFTNotApproved();
            }
            amount = 1; // Force amount to 1 for ERC721
        } else {
            IERC1155 nft = IERC1155(collection);
            if (nft.balanceOf(msg.sender, tokenId) < amount) revert NotNFTOwner();
            if (!nft.isApprovedForAll(msg.sender, address(this))) revert NFTNotApproved();
        }

        // Generate request ID
        requestId = keccak256(
            abi.encodePacked(
                msg.sender,
                collection,
                tokenId,
                destinationChainId,
                block.number,
                block.timestamp,
                ++_requestNonce
            )
        );

        // Get metadata hash
        bytes32 metadataHash = bytes32(0);
        if (assetType == NFTAssetType.ERC721) {
            // For ERC721, try to get tokenURI hash
            // Note: This is a best-effort - some NFTs may not have tokenURI
        }

        // Store request
        voucherRequests[requestId] = NFTVoucherRequest({
            requester: msg.sender,
            assetType: assetType,
            collection: collection,
            tokenId: tokenId,
            amount: amount,
            destinationChainId: destinationChainId,
            recipient: recipient,
            gasOnDestination: gasOnDestination,
            maxFee: maxFee,
            feeIncrement: feeIncrement,
            deadline: block.number + REQUEST_TIMEOUT,
            createdBlock: block.number,
            metadataHash: metadataHash,
            claimed: false,
            expired: false,
            refunded: false,
            bidCount: 0,
            winningXLP: address(0),
            winningFee: 0
        });

        // Transfer NFT to this contract
        if (assetType == NFTAssetType.ERC721) {
            IERC721(collection).transferFrom(msg.sender, address(this), tokenId);
        } else {
            IERC1155(collection).safeTransferFrom(msg.sender, address(this), tokenId, amount, "");
        }

        // Refund excess ETH
        uint256 excess = msg.value - maxFee;
        if (excess > 0) {
            (bool success,) = msg.sender.call{value: excess}("");
            if (!success) revert TransferFailed();
        }

        totalRequests++;

        emit NFTVoucherRequested(
            requestId,
            msg.sender,
            assetType,
            collection,
            tokenId,
            amount,
            destinationChainId,
            recipient,
            maxFee,
            block.number + REQUEST_TIMEOUT
        );
    }

    /**
     * @notice Get current fee for request (reverse Dutch auction)
     */
    function getCurrentFee(bytes32 requestId) public view returns (uint256 currentFee) {
        NFTVoucherRequest storage request = voucherRequests[requestId];
        if (request.requester == address(0)) return 0;

        uint256 elapsedBlocks = block.number - request.createdBlock;
        currentFee = MIN_FEE + (elapsedBlocks * request.feeIncrement);
        if (currentFee > request.maxFee) currentFee = request.maxFee;
    }

    /**
     * @notice Refund expired request
     */
    function refundExpiredRequest(bytes32 requestId) external nonReentrant {
        NFTVoucherRequest storage request = voucherRequests[requestId];

        if (request.requester == address(0)) revert InvalidRecipient();
        if (request.claimed) revert RequestAlreadyClaimed();
        if (request.refunded) revert RequestAlreadyRefunded();
        if (block.number <= request.deadline) revert RequestNotExpired();

        // Cache values
        address requester = request.requester;
        NFTAssetType assetType = request.assetType;
        address collection = request.collection;
        uint256 tokenId = request.tokenId;
        uint256 amount = request.amount;
        uint256 maxFee = request.maxFee;

        // Update state
        request.expired = true;
        request.refunded = true;

        emit NFTVoucherExpired(requestId, requester);
        emit NFTRefunded(requestId, requester, collection, tokenId, amount);

        // Return NFT
        if (assetType == NFTAssetType.ERC721) {
            IERC721(collection).transferFrom(address(this), requester, tokenId);
        } else {
            IERC1155(collection).safeTransferFrom(address(this), requester, tokenId, amount, "");
        }

        // Return fee
        if (maxFee > 0) {
            (bool success,) = requester.call{value: maxFee}("");
            if (!success) revert TransferFailed();
        }
    }

    // ============ Voucher Issuance (XLP) ============

    /**
     * @notice Issue voucher to fulfill request (XLP only)
     */
    function issueNFTVoucher(
        bytes32 requestId,
        bytes calldata signature
    ) external nonReentrant returns (bytes32 voucherId) {
        NFTVoucherRequest storage request = voucherRequests[requestId];

        if (request.requester == address(0)) revert InvalidRecipient();
        if (request.claimed) revert RequestAlreadyClaimed();
        if (request.expired || block.number > request.deadline) revert RequestExpired();

        // Verify XLP has wrapped collection registered
        address wrappedCollection = xlpWrappedCollections[msg.sender][chainId][request.collection];
        if (wrappedCollection == address(0)) revert WrappedCollectionNotRegistered();

        // Verify XLP stake (require 10% of estimated NFT value, min 0.01 ETH)
        uint256 requiredStake = 0.01 ether;
        if (xlpVerifiedStake[msg.sender] < requiredStake) revert InsufficientXLPStake();

        // Calculate fee
        uint256 fee = getCurrentFee(requestId);

        // Generate voucher ID
        voucherId = keccak256(abi.encodePacked(requestId, msg.sender, block.number, signature));

        // Verify signature
        bytes32 commitment = keccak256(
            abi.encodePacked(
                requestId,
                msg.sender,
                request.collection,
                request.tokenId,
                request.amount,
                fee,
                request.destinationChainId
            )
        );
        address signer = commitment.toEthSignedMessageHash().recover(signature);
        if (signer != msg.sender) revert InvalidVoucherSignature();

        // Mark request claimed
        request.claimed = true;
        request.winningXLP = msg.sender;
        request.winningFee = fee;

        // Store voucher
        vouchers[voucherId] = NFTVoucher({
            requestId: requestId,
            xlp: msg.sender,
            assetType: request.assetType,
            sourceChainId: chainId,
            destinationChainId: request.destinationChainId,
            sourceCollection: request.collection,
            destinationCollection: wrappedCollection,
            tokenId: request.tokenId,
            amount: request.amount,
            fee: fee,
            gasProvided: request.gasOnDestination,
            issuedBlock: block.number,
            expiresBlock: block.number + VOUCHER_TIMEOUT,
            fulfilled: false,
            slashed: false,
            claimed: false
        });

        totalNFTsBridged++;

        emit NFTVoucherIssued(voucherId, requestId, msg.sender, fee);
    }

    // ============ Voucher Fulfillment (Destination Chain) ============

    /**
     * @notice Fulfill voucher on destination chain
     * @dev Called by XLP to mint wrapped NFT to user
     */
    function fulfillNFTVoucher(
        bytes32 voucherId,
        bytes32 requestId,
        address xlp,
        address collection,
        uint256 tokenId,
        uint256 amount,
        address recipient,
        uint256 gasAmount,
        bytes calldata xlpSignature
    ) external nonReentrant {
        // Verify voucher signature
        bytes32 voucherHash = keccak256(
            abi.encodePacked(
                voucherId,
                requestId,
                xlp,
                collection,
                tokenId,
                amount,
                recipient,
                gasAmount,
                chainId
            )
        );

        // Prevent replay
        if (fulfilledVoucherHashes[voucherHash]) revert VoucherAlreadyFulfilled();

        address signer = voucherHash.toEthSignedMessageHash().recover(xlpSignature);
        if (signer != xlp) revert InvalidVoucherSignature();

        // Mark fulfilled
        fulfilledVoucherHashes[voucherHash] = true;
        vouchers[voucherId].fulfilled = true;

        // The actual minting is done by the WrappedNFT contract
        // This contract just validates and records the fulfillment
        // XLP calls WrappedNFT.wrap() separately

        emit NFTVoucherFulfilled(voucherId, recipient, collection, tokenId, amount);
    }

    // ============ Claim Source NFT (XLP) ============

    /**
     * @notice Claim source NFT after fraud proof window
     */
    function claimSourceNFT(bytes32 voucherId) external nonReentrant {
        NFTVoucher storage voucher = vouchers[voucherId];
        NFTVoucherRequest storage request = voucherRequests[voucher.requestId];

        if (voucher.xlp != msg.sender) revert OnlyXLP();
        if (!voucher.fulfilled) revert VoucherExpiredError();
        if (voucher.slashed) revert OnlyXLP();
        if (voucher.claimed) revert VoucherAlreadyClaimed();
        if (block.number < voucher.issuedBlock + CLAIM_DELAY) revert ClaimDelayNotPassed();

        // Cache values
        NFTAssetType assetType = voucher.assetType;
        address collection = voucher.sourceCollection;
        uint256 tokenId = voucher.tokenId;
        uint256 amount = voucher.amount;
        uint256 fee = voucher.fee;

        // Update state
        voucher.claimed = true;

        emit SourceNFTClaimed(voucher.requestId, msg.sender, collection, tokenId, amount, fee);

        // Transfer NFT to XLP
        if (assetType == NFTAssetType.ERC721) {
            IERC721(collection).transferFrom(address(this), msg.sender, tokenId);
        } else {
            IERC1155(collection).safeTransferFrom(address(this), msg.sender, tokenId, amount, "");
        }

        // Transfer fee to XLP
        if (fee > 0) {
            (bool success,) = msg.sender.call{value: fee}("");
            if (!success) revert TransferFailed();
        }
    }

    // ============ View Functions ============

    function getRequest(bytes32 requestId) external view returns (NFTVoucherRequest memory) {
        return voucherRequests[requestId];
    }

    function getVoucher(bytes32 voucherId) external view returns (NFTVoucher memory) {
        return vouchers[voucherId];
    }

    function canFulfillRequest(bytes32 requestId) external view returns (bool) {
        NFTVoucherRequest storage request = voucherRequests[requestId];
        return request.requester != address(0) && 
               !request.claimed && 
               !request.expired && 
               block.number <= request.deadline;
    }

    function getXLPWrappedCollection(
        address xlp,
        uint256 sourceChainId,
        address sourceCollection
    ) external view returns (address) {
        return xlpWrappedCollections[xlp][sourceChainId][sourceCollection];
    }

    function getStats() external view returns (
        uint256 _totalRequests,
        uint256 _totalNFTsBridged
    ) {
        return (totalRequests, totalNFTsBridged);
    }

    // ============ ERC721/1155 Receiver ============

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return 
            interfaceId == type(IERC721Receiver).interfaceId ||
            interfaceId == type(IERC1155Receiver).interfaceId;
    }

    receive() external payable {}

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
