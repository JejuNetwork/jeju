// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title INFTEIL - NFT Ethereum Interop Layer Interfaces
 * @author Jeju Network
 * @notice Standard interfaces for cross-chain NFT protocol components
 * @dev Extends EIL patterns for non-fungible and semi-fungible tokens
 *
 * Supports:
 * - ERC-721 (unique NFTs)
 * - ERC-1155 (semi-fungible tokens)
 * - Metadata preservation across chains
 * - Royalty enforcement (ERC-2981)
 * - Provenance tracking
 */

// ============ Asset Types ============

enum NFTAssetType {
    ERC721,
    ERC1155
}

// ============ Cross-Chain NFT Request ============

struct NFTVoucherRequest {
    address requester;
    NFTAssetType assetType;
    address collection;
    uint256 tokenId;
    uint256 amount; // 1 for ERC721, >1 for ERC1155
    uint256 destinationChainId;
    address recipient;
    uint256 gasOnDestination;
    uint256 maxFee;
    uint256 feeIncrement;
    uint256 deadline;
    uint256 createdBlock;
    bytes32 metadataHash; // Hash of tokenURI for verification
    bool claimed;
    bool expired;
    bool refunded;
    // Multi-XLP competition
    uint256 bidCount;
    address winningXLP;
    uint256 winningFee;
}

// ============ Cross-Chain NFT Voucher ============

struct NFTVoucher {
    bytes32 requestId;
    address xlp;
    NFTAssetType assetType;
    uint256 sourceChainId;
    uint256 destinationChainId;
    address sourceCollection;
    address destinationCollection; // Wrapped collection on dest
    uint256 tokenId;
    uint256 amount;
    uint256 fee;
    uint256 gasProvided;
    uint256 issuedBlock;
    uint256 expiresBlock;
    bool fulfilled;
    bool slashed;
    bool claimed;
}

// ============ Wrapped NFT Info ============

struct WrappedNFTInfo {
    uint256 homeChainId;
    address originalCollection;
    uint256 originalTokenId;
    string tokenURI;
    bytes32 metadataHash;
    uint256 bridgedAt;
    address bridgedBy;
}

// ============ Provenance Entry ============

struct ProvenanceEntry {
    uint256 chainId;
    address collection;
    uint256 tokenId;
    uint256 timestamp;
    bytes32 txHash;
    address owner;
}

// ============ NFT Paymaster Interface ============

interface INFTPaymaster {
    /// @notice Create a cross-chain NFT transfer request
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
    ) external payable returns (bytes32 requestId);

    /// @notice Get current fee for a request (reverse Dutch auction)
    function getCurrentFee(bytes32 requestId) external view returns (uint256);

    /// @notice Refund expired request
    function refundExpiredRequest(bytes32 requestId) external;

    /// @notice XLP deposits wrapped NFT collection as liquidity
    function registerWrappedCollection(
        uint256 sourceChainId,
        address sourceCollection,
        address wrappedCollection
    ) external;

    /// @notice XLP issues voucher to fulfill request
    function issueNFTVoucher(
        bytes32 requestId,
        bytes calldata signature
    ) external returns (bytes32 voucherId);

    /// @notice Fulfill voucher on destination chain
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
    ) external;

    /// @notice Claim source NFT after fraud proof window
    function claimSourceNFT(bytes32 voucherId) external;

    /// @notice Get request details
    function getRequest(bytes32 requestId) external view returns (NFTVoucherRequest memory);

    /// @notice Get voucher details
    function getVoucher(bytes32 voucherId) external view returns (NFTVoucher memory);

    // Events
    event NFTVoucherRequested(
        bytes32 indexed requestId,
        address indexed requester,
        NFTAssetType assetType,
        address collection,
        uint256 tokenId,
        uint256 amount,
        uint256 destinationChainId,
        address recipient,
        uint256 maxFee,
        uint256 deadline
    );

    event NFTVoucherIssued(
        bytes32 indexed voucherId,
        bytes32 indexed requestId,
        address indexed xlp,
        uint256 fee
    );

    event NFTVoucherFulfilled(
        bytes32 indexed voucherId,
        address indexed recipient,
        address collection,
        uint256 tokenId,
        uint256 amount
    );

    event NFTVoucherExpired(bytes32 indexed requestId, address indexed requester);

    event NFTRefunded(
        bytes32 indexed requestId,
        address indexed requester,
        address collection,
        uint256 tokenId,
        uint256 amount
    );

    event SourceNFTClaimed(
        bytes32 indexed requestId,
        address indexed xlp,
        address collection,
        uint256 tokenId,
        uint256 amount,
        uint256 fee
    );

    event WrappedCollectionRegistered(
        uint256 indexed sourceChainId,
        address indexed sourceCollection,
        address indexed wrappedCollection
    );
}

// ============ Cross-Chain NFT Handler Interface ============

interface ICrossChainNFTHandler {
    /// @notice Bridge NFT to another chain
    function bridgeNFT(
        uint32 destinationDomain,
        bytes32 recipient,
        uint256 tokenId
    ) external payable returns (bytes32 messageId);

    /// @notice Bridge ERC1155 tokens to another chain
    function bridgeMultiToken(
        uint32 destinationDomain,
        bytes32 recipient,
        uint256 tokenId,
        uint256 amount
    ) external payable returns (bytes32 messageId);

    /// @notice Handle incoming cross-chain message
    function handle(
        uint32 origin,
        bytes32 sender,
        bytes calldata body
    ) external;

    /// @notice Get cross-chain stats
    function getCrossChainStats() external view returns (
        uint256 totalBridged,
        uint256 totalReceived,
        uint32 homeDomain,
        bool isHome
    );

    /// @notice Quote gas for cross-chain transfer
    function quoteBridge(
        uint32 destinationDomain,
        uint256 tokenId
    ) external view returns (uint256 gasPayment);

    // Events
    event NFTBridgeInitiated(
        bytes32 indexed messageId,
        address indexed sender,
        uint32 destinationDomain,
        bytes32 recipient,
        uint256 tokenId,
        uint256 amount
    );

    event NFTBridgeReceived(
        bytes32 indexed messageId,
        uint32 originDomain,
        address indexed recipient,
        uint256 tokenId,
        uint256 amount
    );
}

// ============ Wrapped NFT Interface ============

interface IWrappedNFT {
    /// @notice Wrap an NFT from another chain
    function wrap(
        uint256 homeChainId,
        address originalCollection,
        uint256 originalTokenId,
        string calldata tokenURI,
        address recipient
    ) external returns (uint256 wrappedTokenId);

    /// @notice Unwrap to initiate bridge back to home chain
    function unwrap(uint256 tokenId) external;

    /// @notice Get original NFT info
    function getOriginalInfo(uint256 tokenId) external view returns (WrappedNFTInfo memory);

    /// @notice Get provenance history
    function getProvenance(uint256 tokenId) external view returns (ProvenanceEntry[] memory);

    /// @notice Check if tokenId is wrapped
    function isWrapped(uint256 tokenId) external view returns (bool);

    /// @notice Get wrapped tokenId for original
    function getWrappedTokenId(
        uint256 homeChainId,
        address originalCollection,
        uint256 originalTokenId
    ) external view returns (uint256);

    // Events
    event NFTWrapped(
        uint256 indexed wrappedTokenId,
        uint256 homeChainId,
        address originalCollection,
        uint256 originalTokenId,
        address indexed recipient
    );

    event NFTUnwrapped(
        uint256 indexed wrappedTokenId,
        uint256 homeChainId,
        address originalCollection,
        uint256 originalTokenId,
        address indexed initiator
    );

    event ProvenanceRecorded(
        uint256 indexed tokenId,
        uint256 chainId,
        address collection,
        uint256 timestamp,
        address owner
    );
}

// ============ Wrapped Multi-Token Interface (ERC1155) ============

interface IWrappedMultiToken {
    /// @notice Wrap ERC1155 tokens from another chain
    function wrap(
        uint256 homeChainId,
        address originalCollection,
        uint256 originalTokenId,
        uint256 amount,
        string calldata tokenURI,
        address recipient
    ) external returns (uint256 wrappedTokenId);

    /// @notice Unwrap to initiate bridge back
    function unwrap(uint256 tokenId, uint256 amount) external;

    /// @notice Get original token info
    function getOriginalInfo(uint256 tokenId) external view returns (WrappedNFTInfo memory);

    /// @notice Get total wrapped supply for a tokenId
    function wrappedSupply(uint256 tokenId) external view returns (uint256);

    // Events
    event MultiTokenWrapped(
        uint256 indexed wrappedTokenId,
        uint256 homeChainId,
        address originalCollection,
        uint256 originalTokenId,
        uint256 amount,
        address indexed recipient
    );

    event MultiTokenUnwrapped(
        uint256 indexed wrappedTokenId,
        uint256 homeChainId,
        address originalCollection,
        uint256 originalTokenId,
        uint256 amount,
        address indexed initiator
    );
}

// ============ NFT Royalty Enforcer Interface ============

interface INFTRoyaltyEnforcer {
    /// @notice Set universal royalty for wrapped NFTs
    function setUniversalRoyalty(
        uint256 homeChainId,
        address originalCollection,
        address receiver,
        uint96 feeBps
    ) external;

    /// @notice Get royalty info for a token
    function getRoyaltyInfo(
        uint256 tokenId,
        uint256 salePrice
    ) external view returns (address receiver, uint256 royaltyAmount);

    /// @notice Sync royalty from home chain
    function syncRoyaltyFromHome(
        uint256 homeChainId,
        address originalCollection,
        address receiver,
        uint96 feeBps,
        bytes calldata proof
    ) external;

    event RoyaltySet(
        uint256 indexed homeChainId,
        address indexed originalCollection,
        address receiver,
        uint96 feeBps
    );

    event RoyaltySynced(
        uint256 indexed homeChainId,
        address indexed originalCollection,
        bytes32 proofHash
    );
}

// ============ NFT Metadata Storage Interface ============

interface INFTMetadataStorage {
    /// @notice Store metadata for cross-chain NFT
    function storeMetadata(
        uint256 tokenId,
        string calldata tokenURI,
        bytes32 contentHash
    ) external;

    /// @notice Get metadata
    function getMetadata(uint256 tokenId) external view returns (
        string memory tokenURI,
        bytes32 contentHash,
        uint256 storedAt
    );

    /// @notice Verify metadata integrity
    function verifyMetadata(
        uint256 tokenId,
        bytes32 expectedHash
    ) external view returns (bool);

    /// @notice Fetch and cache metadata from home chain
    function fetchRemoteMetadata(
        uint256 homeChainId,
        address collection,
        uint256 tokenId
    ) external returns (string memory tokenURI);

    event MetadataStored(
        uint256 indexed tokenId,
        bytes32 contentHash,
        uint256 timestamp
    );

    event MetadataFetched(
        uint256 indexed tokenId,
        uint256 homeChainId,
        address collection,
        string tokenURI
    );
}

// ============ OIF NFT Order Types ============

// Order type for NFT transfer intents
bytes32 constant NFT_TRANSFER_ORDER_TYPE = keccak256("NFTTransfer");

// Order type for NFT swap intents
bytes32 constant NFT_SWAP_ORDER_TYPE = keccak256("NFTSwap");

/// @notice NFT transfer order data
struct NFTTransferOrderData {
    NFTAssetType assetType;
    address collection;
    uint256 tokenId;
    uint256 amount;
    uint256 destinationChainId;
    address recipient;
    bytes32 metadataHash;
}

/// @notice NFT swap order data (swap NFT for tokens)
struct NFTSwapOrderData {
    NFTAssetType assetType;
    address nftCollection;
    uint256 nftTokenId;
    uint256 nftAmount;
    address paymentToken;
    uint256 minPayment;
    uint256 destinationChainId;
    address recipient;
}
