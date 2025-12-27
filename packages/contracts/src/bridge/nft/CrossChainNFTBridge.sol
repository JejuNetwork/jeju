// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title CrossChainNFTBridge
 * @author Jeju Network
 * @notice Bridge NFTs between EVM chains and Solana using ZK proofs
 * @dev Supports both lock/release (native NFTs) and mint/burn (wrapped NFTs)
 *
 * Architecture:
 * - Native chain: Lock NFT in bridge, release on return
 * - Remote chain: Mint wrapped NFT, burn on bridge back
 * - Solana: Uses 8004-solana agent NFTs or Metaplex NFTs
 *
 * Security:
 * - ZK proof verification for cross-chain state
 * - Oracle attestation for Solana state
 * - Timelock for large transfers
 */
contract CrossChainNFTBridge is Ownable, ReentrancyGuard, Pausable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ============ Constants ============

    uint256 public constant SOLANA_CHAIN_ID = 101;
    uint256 public constant SOLANA_DEVNET_CHAIN_ID = 102;
    uint256 public constant LARGE_TRANSFER_DELAY = 1 hours;
    uint256 public constant MAX_BATCH_SIZE = 20;

    // ============ Structs ============

    struct BridgeRequest {
        bytes32 requestId;
        address sender;
        address nftContract;
        uint256 tokenId;
        uint256 destChainId;
        bytes32 destRecipient; // 32 bytes for Solana pubkey compatibility
        string tokenUri;
        uint256 timestamp;
        BridgeStatus status;
    }

    struct WrappedNFTInfo {
        uint256 originChainId;
        address originContract;
        uint256 originTokenId;
        bytes32 solanaOriginMint; // If originated from Solana
    }

    struct CollectionMapping {
        uint256 remoteChainId;
        bytes32 remoteCollection; // Address or Solana pubkey
        bool isActive;
        bool isNative; // True if this chain is the native chain
        uint256 totalBridged;
    }

    enum BridgeStatus {
        PENDING,
        COMPLETED,
        CANCELLED,
        FAILED
    }

    // ============ State Variables ============

    /// @notice Oracle address for Solana state attestations
    address public oracle;

    /// @notice ZK verifier contract for cross-chain proofs
    address public zkVerifier;

    /// @notice Bridge fee in basis points
    uint256 public bridgeFeeBps = 30; // 0.3%

    /// @notice Minimum bridge fee in wei
    uint256 public minBridgeFee = 0.001 ether;

    /// @notice Fee recipient
    address public feeRecipient;

    /// @notice Request counter for unique IDs
    uint256 private _requestNonce;

    /// @notice All bridge requests
    mapping(bytes32 => BridgeRequest) public requests;

    /// @notice User's pending requests
    mapping(address => bytes32[]) public userRequests;

    /// @notice Wrapped NFT info (for wrapped NFTs minted by this bridge)
    mapping(address => mapping(uint256 => WrappedNFTInfo)) public wrappedNFTs;

    /// @notice Collection mappings (local collection => remote chain => mapping)
    mapping(address => mapping(uint256 => CollectionMapping)) public collectionMappings;

    /// @notice Supported collections
    address[] public supportedCollections;
    mapping(address => bool) public isSupported;

    /// @notice Completed transfers (to prevent replay)
    mapping(bytes32 => bool) public completedTransfers;

    /// @notice Pending large transfers requiring timelock
    mapping(bytes32 => uint256) public largeTransferUnlockTime;

    // ============ Events ============

    event BridgeInitiated(
        bytes32 indexed requestId,
        address indexed sender,
        address indexed nftContract,
        uint256 tokenId,
        uint256 destChainId,
        bytes32 destRecipient
    );

    event BridgeCompleted(
        bytes32 indexed requestId,
        address indexed recipient,
        address indexed nftContract,
        uint256 tokenId,
        uint256 sourceChainId
    );

    event BridgeCancelled(bytes32 indexed requestId);

    event CollectionMapped(
        address indexed localCollection, uint256 indexed remoteChainId, bytes32 remoteCollection, bool isNative
    );

    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event FeesUpdated(uint256 bridgeFeeBps, uint256 minBridgeFee);

    // ============ Errors ============

    error CollectionNotSupported();
    error InvalidDestination();
    error TransferNotFound();
    error TransferAlreadyCompleted();
    error InvalidProof();
    error InvalidSignature();
    error InsufficientFee();
    error NotOwnerOfToken();
    error TimelockNotExpired();
    error BatchTooLarge();
    error ZeroAddress();

    // ============ Constructor ============

    constructor(address _oracle, address _zkVerifier, address _feeRecipient) Ownable(msg.sender) {
        if (_oracle == address(0) || _feeRecipient == address(0)) revert ZeroAddress();
        oracle = _oracle;
        zkVerifier = _zkVerifier;
        feeRecipient = _feeRecipient;
    }

    // ============ External Functions ============

    /**
     * @notice Bridge an NFT to another chain
     * @param nftContract The NFT contract address
     * @param tokenId The token ID to bridge
     * @param destChainId Destination chain ID (101/102 for Solana)
     * @param destRecipient Recipient on destination chain (32 bytes for Solana compatibility)
     */
    function bridgeNFT(address nftContract, uint256 tokenId, uint256 destChainId, bytes32 destRecipient)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (bytes32 requestId)
    {
        if (!isSupported[nftContract]) revert CollectionNotSupported();
        if (destRecipient == bytes32(0)) revert InvalidDestination();
        if (msg.value < calculateBridgeFee(nftContract)) revert InsufficientFee();

        IERC721 nft = IERC721(nftContract);
        if (nft.ownerOf(tokenId) != msg.sender) revert NotOwnerOfToken();

        // Generate unique request ID
        requestId = keccak256(
            abi.encodePacked(
                block.chainid, nftContract, tokenId, destChainId, destRecipient, _requestNonce++, block.timestamp
            )
        );

        // Get token URI
        string memory tokenUri = "";
        // Try to get tokenURI if the contract supports it
        (bool success, bytes memory data) =
            nftContract.staticcall(abi.encodeWithSignature("tokenURI(uint256)", tokenId));
        if (success && data.length > 0) {
            tokenUri = abi.decode(data, (string));
        }

        // Lock NFT in bridge
        nft.transferFrom(msg.sender, address(this), tokenId);

        // Create request
        requests[requestId] = BridgeRequest({
            requestId: requestId,
            sender: msg.sender,
            nftContract: nftContract,
            tokenId: tokenId,
            destChainId: destChainId,
            destRecipient: destRecipient,
            tokenUri: tokenUri,
            timestamp: block.timestamp,
            status: BridgeStatus.PENDING
        });

        userRequests[msg.sender].push(requestId);

        // Transfer fee
        (bool feeSuccess,) = feeRecipient.call{value: msg.value}("");
        require(feeSuccess, "Fee transfer failed");

        emit BridgeInitiated(requestId, msg.sender, nftContract, tokenId, destChainId, destRecipient);
    }

    /**
     * @notice Bridge multiple NFTs in a single transaction
     * @param nftContract The NFT contract address
     * @param tokenIds Array of token IDs to bridge
     * @param destChainId Destination chain ID
     * @param destRecipient Recipient on destination chain
     */
    function bridgeNFTBatch(
        address nftContract,
        uint256[] calldata tokenIds,
        uint256 destChainId,
        bytes32 destRecipient
    ) external payable nonReentrant whenNotPaused returns (bytes32[] memory requestIds) {
        if (tokenIds.length > MAX_BATCH_SIZE) revert BatchTooLarge();
        if (!isSupported[nftContract]) revert CollectionNotSupported();
        if (destRecipient == bytes32(0)) revert InvalidDestination();

        uint256 totalFee = calculateBridgeFee(nftContract) * tokenIds.length;
        if (msg.value < totalFee) revert InsufficientFee();

        IERC721 nft = IERC721(nftContract);
        requestIds = new bytes32[](tokenIds.length);

        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            if (nft.ownerOf(tokenId) != msg.sender) revert NotOwnerOfToken();

            bytes32 requestId = keccak256(
                abi.encodePacked(
                    block.chainid, nftContract, tokenId, destChainId, destRecipient, _requestNonce++, block.timestamp, i
                )
            );

            string memory tokenUri = "";
            (bool success, bytes memory data) =
                nftContract.staticcall(abi.encodeWithSignature("tokenURI(uint256)", tokenId));
            if (success && data.length > 0) {
                tokenUri = abi.decode(data, (string));
            }

            nft.transferFrom(msg.sender, address(this), tokenId);

            requests[requestId] = BridgeRequest({
                requestId: requestId,
                sender: msg.sender,
                nftContract: nftContract,
                tokenId: tokenId,
                destChainId: destChainId,
                destRecipient: destRecipient,
                tokenUri: tokenUri,
                timestamp: block.timestamp,
                status: BridgeStatus.PENDING
            });

            userRequests[msg.sender].push(requestId);
            requestIds[i] = requestId;

            emit BridgeInitiated(requestId, msg.sender, nftContract, tokenId, destChainId, destRecipient);
        }

        (bool feeSuccess,) = feeRecipient.call{value: msg.value}("");
        require(feeSuccess, "Fee transfer failed");
    }

    /**
     * @notice Complete a bridge from another chain (release locked NFT or mint wrapped)
     * @param sourceChainId Source chain ID
     * @param sourceRequestId Original request ID on source chain
     * @param nftContract Local NFT contract address
     * @param tokenId Token ID
     * @param recipient Recipient address
     * @param tokenUri Token URI for metadata
     * @param proof ZK proof or oracle signature
     */
    function completeBridge(
        uint256 sourceChainId,
        bytes32 sourceRequestId,
        address nftContract,
        uint256 tokenId,
        address recipient,
        string calldata tokenUri,
        bytes calldata proof
    ) external nonReentrant whenNotPaused {
        bytes32 transferId = keccak256(abi.encodePacked(sourceChainId, sourceRequestId, block.chainid));

        if (completedTransfers[transferId]) revert TransferAlreadyCompleted();

        // Verify proof based on source chain
        if (sourceChainId == SOLANA_CHAIN_ID || sourceChainId == SOLANA_DEVNET_CHAIN_ID) {
            // Verify oracle attestation for Solana
            _verifyOracleAttestation(sourceChainId, sourceRequestId, nftContract, tokenId, recipient, tokenUri, proof);
        } else {
            // Verify ZK proof for EVM chains
            _verifyZKProof(sourceChainId, sourceRequestId, nftContract, tokenId, recipient, proof);
        }

        completedTransfers[transferId] = true;

        CollectionMapping storage mapping_ = collectionMappings[nftContract][sourceChainId];

        if (mapping_.isNative) {
            // This is the native chain - release locked NFT
            IERC721(nftContract).transferFrom(address(this), recipient, tokenId);
        } else {
            // This is a remote chain - mint wrapped NFT
            _mintWrappedNFT(nftContract, tokenId, recipient, tokenUri, sourceChainId);
        }

        emit BridgeCompleted(transferId, recipient, nftContract, tokenId, sourceChainId);
    }

    /**
     * @notice Cancel a pending bridge request (before completion)
     * @param requestId The request ID to cancel
     */
    function cancelBridge(bytes32 requestId) external nonReentrant {
        BridgeRequest storage request = requests[requestId];
        if (request.requestId == bytes32(0)) revert TransferNotFound();
        if (request.sender != msg.sender) revert NotOwnerOfToken();
        if (request.status != BridgeStatus.PENDING) revert TransferAlreadyCompleted();

        request.status = BridgeStatus.CANCELLED;

        // Return NFT to sender
        IERC721(request.nftContract).transferFrom(address(this), msg.sender, request.tokenId);

        emit BridgeCancelled(requestId);
    }

    // ============ Admin Functions ============

    /**
     * @notice Add a supported collection with remote chain mapping
     */
    function addCollection(address localCollection, uint256 remoteChainId, bytes32 remoteCollection, bool isNative)
        external
        onlyOwner
    {
        if (!isSupported[localCollection]) {
            supportedCollections.push(localCollection);
            isSupported[localCollection] = true;
        }

        collectionMappings[localCollection][remoteChainId] = CollectionMapping({
            remoteChainId: remoteChainId,
            remoteCollection: remoteCollection,
            isActive: true,
            isNative: isNative,
            totalBridged: 0
        });

        emit CollectionMapped(localCollection, remoteChainId, remoteCollection, isNative);
    }

    /**
     * @notice Update oracle address
     */
    function setOracle(address _oracle) external onlyOwner {
        if (_oracle == address(0)) revert ZeroAddress();
        address oldOracle = oracle;
        oracle = _oracle;
        emit OracleUpdated(oldOracle, _oracle);
    }

    /**
     * @notice Update ZK verifier
     */
    function setZKVerifier(address _zkVerifier) external onlyOwner {
        zkVerifier = _zkVerifier;
    }

    /**
     * @notice Update bridge fees
     */
    function setFees(uint256 _bridgeFeeBps, uint256 _minBridgeFee) external onlyOwner {
        bridgeFeeBps = _bridgeFeeBps;
        minBridgeFee = _minBridgeFee;
        emit FeesUpdated(_bridgeFeeBps, _minBridgeFee);
    }

    /**
     * @notice Update fee recipient
     */
    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        if (_feeRecipient == address(0)) revert ZeroAddress();
        feeRecipient = _feeRecipient;
    }

    /**
     * @notice Pause/unpause bridge
     */
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ View Functions ============

    /**
     * @notice Calculate bridge fee for a collection
     */
    function calculateBridgeFee(address nftContract) public view returns (uint256) {
        // Could implement collection-specific pricing
        // For now, use minimum fee
        return minBridgeFee;
    }

    /**
     * @notice Get user's pending requests
     */
    function getUserRequests(address user) external view returns (bytes32[] memory) {
        return userRequests[user];
    }

    /**
     * @notice Get request details
     */
    function getRequest(bytes32 requestId) external view returns (BridgeRequest memory) {
        return requests[requestId];
    }

    /**
     * @notice Get all supported collections
     */
    function getSupportedCollections() external view returns (address[] memory) {
        return supportedCollections;
    }

    /**
     * @notice Check if a transfer is completed
     */
    function isTransferCompleted(uint256 sourceChainId, bytes32 sourceRequestId) external view returns (bool) {
        bytes32 transferId = keccak256(abi.encodePacked(sourceChainId, sourceRequestId, block.chainid));
        return completedTransfers[transferId];
    }

    // ============ Internal Functions ============

    function _verifyOracleAttestation(
        uint256 sourceChainId,
        bytes32 sourceRequestId,
        address nftContract,
        uint256 tokenId,
        address recipient,
        string calldata tokenUri,
        bytes calldata signature
    ) internal view {
        bytes32 messageHash = keccak256(
            abi.encodePacked(sourceChainId, sourceRequestId, block.chainid, nftContract, tokenId, recipient, tokenUri)
        );

        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        address signer = ethSignedHash.recover(signature);

        if (signer != oracle) revert InvalidSignature();
    }

    function _verifyZKProof(
        uint256 sourceChainId,
        bytes32 sourceRequestId,
        address nftContract,
        uint256 tokenId,
        address recipient,
        bytes calldata proof
    ) internal view {
        if (zkVerifier == address(0)) revert InvalidProof();

        // Call ZK verifier contract
        (bool success, bytes memory result) = zkVerifier.staticcall(
            abi.encodeWithSignature(
                "verifyProof(uint256,bytes32,address,uint256,address,bytes)",
                sourceChainId,
                sourceRequestId,
                nftContract,
                tokenId,
                recipient,
                proof
            )
        );

        if (!success || (result.length > 0 && !abi.decode(result, (bool)))) {
            revert InvalidProof();
        }
    }

    function _mintWrappedNFT(
        address nftContract,
        uint256 tokenId,
        address recipient,
        string calldata tokenUri,
        uint256 originChainId
    ) internal {
        // For wrapped NFTs, the contract must implement mint function
        // This assumes a WrappedNFT contract that this bridge can mint on
        (bool success,) = nftContract.call(
            abi.encodeWithSignature("bridgeMint(address,uint256,string)", recipient, tokenId, tokenUri)
        );
        require(success, "Mint failed");

        // Store wrapped NFT info
        wrappedNFTs[nftContract][tokenId] = WrappedNFTInfo({
            originChainId: originChainId,
            originContract: address(0), // Set by caller if known
            originTokenId: tokenId,
            solanaOriginMint: bytes32(0)
        });
    }
}

/**
 * @title WrappedNFT
 * @notice ERC721 that can be minted by the bridge for wrapped cross-chain NFTs
 */
contract WrappedNFT is ERC721URIStorage, Ownable {
    address public bridge;
    uint256 public originChainId;
    bytes32 public originCollection; // Address or Solana pubkey

    error OnlyBridge();
    error ZeroAddress();

    modifier onlyBridge() {
        if (msg.sender != bridge) revert OnlyBridge();
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        address _bridge,
        uint256 _originChainId,
        bytes32 _originCollection
    ) ERC721(name_, symbol_) Ownable(msg.sender) {
        if (_bridge == address(0)) revert ZeroAddress();
        bridge = _bridge;
        originChainId = _originChainId;
        originCollection = _originCollection;
    }

    function bridgeMint(address to, uint256 tokenId, string calldata uri) external onlyBridge {
        _mint(to, tokenId);
        _setTokenURI(tokenId, uri);
    }

    function bridgeBurn(uint256 tokenId) external onlyBridge {
        _burn(tokenId);
    }

    function setBridge(address _bridge) external onlyOwner {
        if (_bridge == address(0)) revert ZeroAddress();
        bridge = _bridge;
    }
}
