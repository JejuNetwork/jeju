// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {ERC721Royalty} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Royalty.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ICrossChainNFTHandler, ProvenanceEntry} from "./INFTEIL.sol";
import {INFTModerationHooks} from "../../nfts/interfaces/INFTModeration.sol";

/**
 * @title IHyperlaneMailbox
 * @notice Interface for Hyperlane's cross-chain messaging
 */
interface IHyperlaneMailbox {
    function dispatch(
        uint32 destinationDomain,
        bytes32 recipientAddress,
        bytes calldata messageBody
    ) external payable returns (bytes32 messageId);

    function process(bytes calldata metadata, bytes calldata message) external;
    
    function localDomain() external view returns (uint32);
}

/**
 * @title IInterchainGasPaymaster
 * @notice Interface for Hyperlane gas payment
 */
interface IInterchainGasPaymaster {
    function payForGas(
        bytes32 messageId,
        uint32 destinationDomain,
        uint256 gasAmount,
        address refundAddress
    ) external payable;

    function quoteGasPayment(
        uint32 destinationDomain,
        uint256 gasAmount
    ) external view returns (uint256);
}

/**
 * @title CrossChainNFT
 * @author Jeju Network
 * @notice Abstract base contract for cross-chain ERC721 NFTs using Hyperlane
 * @dev
 * - Home chain: Lock NFT when bridging out, unlock when bridging back
 * - Synthetic chain: Mint wrapped NFT when receiving, burn when bridging out
 * - Preserves original tokenId across all chains
 * - Preserves metadata via tokenURI storage
 * - Enforces royalties via ERC-2981 on all chains
 * - Tracks provenance history across chains
 *
 * Usage:
 * - Inherit from this contract
 * - Call _initializeCrossChain in constructor
 * - Override _isHomeChain() if needed
 *
 * @custom:security-contact security@jeju.network
 */
abstract contract CrossChainNFT is 
    ERC721URIStorage, 
    ERC721Royalty, 
    Ownable, 
    ReentrancyGuard,
    ICrossChainNFTHandler 
{
    // ============ Constants ============

    uint256 public constant GAS_LIMIT_BRIDGE = 400_000;

    // Message types
    bytes1 public constant MESSAGE_TYPE_TRANSFER = 0x01;
    bytes1 public constant MESSAGE_TYPE_METADATA_SYNC = 0x02;
    bytes1 public constant MESSAGE_TYPE_ROYALTY_SYNC = 0x03;

    // ============ State Variables ============

    /// @notice Hyperlane mailbox contract
    IHyperlaneMailbox public mailbox;

    /// @notice Hyperlane gas paymaster
    IInterchainGasPaymaster public igp;

    /// @notice Domain ID of the home chain
    uint32 public homeChainDomain;

    /// @notice Whether this instance is on the home chain
    bool public isHomeChainInstance;

    /// @notice Remote router addresses on other chains
    mapping(uint32 => bytes32) public remoteRouters;

    /// @notice Supported destination domains
    mapping(uint32 => bool) public supportedDomains;

    /// @notice Locked NFTs on home chain (tokenId => locked)
    mapping(uint256 => bool) public lockedTokens;

    /// @notice Total NFTs locked (home chain only)
    uint256 public totalLocked;

    /// @notice Total NFTs bridged out
    uint256 public totalBridgedOut;

    /// @notice Total NFTs received from other chains
    uint256 public totalBridgedIn;

    /// @notice Processed message IDs (replay protection)
    mapping(bytes32 => bool) public processedMessages;

    /// @notice Provenance history per token
    mapping(uint256 => ProvenanceEntry[]) public tokenProvenance;

    /// @notice Original metadata hashes (for verification)
    mapping(uint256 => bytes32) public metadataHashes;

    /// @notice Optional moderation hooks
    INFTModerationHooks public moderationHooks;

    // ============ Events ============

    event ModerationHooksSet(address indexed hooks);

    event RouterSet(uint32 indexed domain, bytes32 router);
    event DomainEnabled(uint32 indexed domain, bool enabled);
    event MailboxUpdated(address indexed oldMailbox, address indexed newMailbox);
    event IGPUpdated(address indexed oldIgp, address indexed newIgp);
    event TokenLocked(uint256 indexed tokenId, address indexed owner);
    event TokenUnlocked(uint256 indexed tokenId, address indexed recipient);

    // ============ Errors ============

    error InvalidDomain();
    error UnsupportedDomain(uint32 domain);
    error RouterNotSet(uint32 domain);
    error InsufficientGasPayment(uint256 required, uint256 provided);
    error MessageAlreadyProcessed(bytes32 messageId);
    error OnlyMailbox();
    error InvalidMessageType();
    error InvalidRecipient();
    error TokenNotLocked();
    error TokenAlreadyLocked();
    error NotTokenOwner();
    error TransferFailed();
    error ModerationBlocked();

    // ============ Modifiers ============

    modifier onlyMailbox() {
        if (msg.sender != address(mailbox)) revert OnlyMailbox();
        _;
    }

    // ============ Constructor ============

    constructor(
        string memory name_,
        string memory symbol_,
        address initialOwner
    ) ERC721(name_, symbol_) Ownable(initialOwner) {}

    // ============ Initialization ============

    /**
     * @notice Initialize cross-chain infrastructure
     * @param _mailbox Hyperlane mailbox address
     * @param _igp Interchain gas paymaster address
     * @param _homeChainDomain Domain ID of home chain
     * @param _isHomeChain Whether this instance is on the home chain
     */
    function _initializeCrossChain(
        address _mailbox,
        address _igp,
        uint32 _homeChainDomain,
        bool _isHomeChain
    ) internal {
        mailbox = IHyperlaneMailbox(_mailbox);
        igp = IInterchainGasPaymaster(_igp);
        homeChainDomain = _homeChainDomain;
        isHomeChainInstance = _isHomeChain;
    }

    // ============ Cross-Chain Transfer ============

    /**
     * @notice Bridge NFT to another chain
     * @param destinationDomain Hyperlane domain ID of destination
     * @param recipient Recipient address (as bytes32)
     * @param tokenId Token ID to bridge
     * @return messageId Hyperlane message ID
     */
    function bridgeNFT(
        uint32 destinationDomain,
        bytes32 recipient,
        uint256 tokenId
    ) external payable nonReentrant returns (bytes32 messageId) {
        if (recipient == bytes32(0)) revert InvalidRecipient();
        if (!supportedDomains[destinationDomain]) revert UnsupportedDomain(destinationDomain);
        if (remoteRouters[destinationDomain] == bytes32(0)) revert RouterNotSet(destinationDomain);
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();

        // Moderation check
        if (address(moderationHooks) != address(0)) {
            if (!moderationHooks.beforeBridge(address(this), msg.sender, tokenId, destinationDomain)) {
                revert ModerationBlocked();
            }
        }

        // Get metadata before locking/burning
        string memory uri = tokenURI(tokenId);
        bytes32 metaHash = keccak256(bytes(uri));

        // Handle token based on chain type
        if (isHomeChainInstance) {
            // Lock NFT on home chain
            _lockToken(tokenId);
        } else {
            // Burn synthetic NFT
            _burn(tokenId);
        }

        // Record provenance
        _recordProvenance(tokenId, msg.sender);

        totalBridgedOut++;

        // Construct message: type(1) + recipient(32) + tokenId(32) + uriLength(32) + uri(variable)
        bytes memory messageBody = abi.encodePacked(
            MESSAGE_TYPE_TRANSFER,
            recipient,
            tokenId,
            uri
        );

        // Dispatch via Hyperlane
        messageId = mailbox.dispatch{value: 0}(
            destinationDomain,
            remoteRouters[destinationDomain],
            messageBody
        );

        // Pay for gas
        uint256 gasPayment = msg.value;
        uint256 requiredGas = igp.quoteGasPayment(destinationDomain, GAS_LIMIT_BRIDGE);
        if (gasPayment < requiredGas) revert InsufficientGasPayment(requiredGas, gasPayment);

        igp.payForGas{value: gasPayment}(
            messageId,
            destinationDomain,
            GAS_LIMIT_BRIDGE,
            msg.sender
        );

        emit NFTBridgeInitiated(
            messageId,
            msg.sender,
            destinationDomain,
            recipient,
            tokenId,
            1
        );
    }

    /**
     * @notice Bridge multiple tokens (ERC1155 compatibility - override in CrossChainMultiToken)
     */
    function bridgeMultiToken(
        uint32 destinationDomain,
        bytes32 recipient,
        uint256 tokenId,
        uint256 amount
    ) external payable virtual returns (bytes32 messageId) {
        require(amount == 1, "ERC721: amount must be 1");
        return this.bridgeNFT(destinationDomain, recipient, tokenId);
    }

    /**
     * @notice Handle incoming cross-chain message (called by Hyperlane mailbox)
     * @param origin Origin domain ID
     * @param sender Sender router address
     * @param body Message body
     */
    function handle(
        uint32 origin,
        bytes32 sender,
        bytes calldata body
    ) external onlyMailbox {
        // Verify sender is authorized router
        if (remoteRouters[origin] != sender) revert RouterNotSet(origin);

        // Extract message type
        bytes1 messageType = body[0];
        
        if (messageType == MESSAGE_TYPE_TRANSFER) {
            _handleTransfer(origin, body);
        } else if (messageType == MESSAGE_TYPE_METADATA_SYNC) {
            _handleMetadataSync(body);
        } else if (messageType == MESSAGE_TYPE_ROYALTY_SYNC) {
            _handleRoyaltySync(body);
        } else {
            revert InvalidMessageType();
        }
    }

    /**
     * @dev Handle incoming NFT transfer
     */
    function _handleTransfer(uint32 origin, bytes calldata body) internal {
        // Decode: type(1) + recipient(32) + tokenId(32) + uri(variable)
        bytes32 recipientBytes = bytes32(body[1:33]);
        uint256 tokenId = uint256(bytes32(body[33:65]));
        string memory uri = string(body[65:]);
        
        address recipient = address(uint160(uint256(recipientBytes)));

        // Generate message ID for replay protection
        bytes32 messageId = keccak256(abi.encodePacked(origin, body, block.number));
        if (processedMessages[messageId]) revert MessageAlreadyProcessed(messageId);
        processedMessages[messageId] = true;

        // Handle based on chain type
        if (isHomeChainInstance) {
            // Unlock token on home chain
            _unlockToken(tokenId, recipient);
        } else {
            // Mint synthetic token on synthetic chain
            _safeMint(recipient, tokenId);
            _setTokenURI(tokenId, uri);
            metadataHashes[tokenId] = keccak256(bytes(uri));
        }

        // Record provenance
        _recordProvenance(tokenId, recipient);

        totalBridgedIn++;

        emit NFTBridgeReceived(messageId, origin, recipient, tokenId, 1);
    }

    /**
     * @dev Handle metadata sync message
     */
    function _handleMetadataSync(bytes calldata body) internal {
        // Decode: type(1) + tokenId(32) + uri(variable)
        uint256 tokenId = uint256(bytes32(body[1:33]));
        string memory uri = string(body[33:]);
        
        _setTokenURI(tokenId, uri);
        metadataHashes[tokenId] = keccak256(bytes(uri));
    }

    /**
     * @dev Handle royalty sync message
     */
    function _handleRoyaltySync(bytes calldata body) internal {
        // Decode: type(1) + tokenId(32) + receiver(20) + feeBps(2)
        uint256 tokenId = uint256(bytes32(body[1:33]));
        address receiver = address(uint160(uint256(bytes32(body[33:65]))));
        uint96 feeBps = uint96(uint16(bytes2(body[65:67])));
        
        _setTokenRoyalty(tokenId, receiver, feeBps);
    }

    // ============ Token Locking (Home Chain) ============

    /**
     * @dev Lock token for cross-chain transfer
     */
    function _lockToken(uint256 tokenId) internal {
        if (lockedTokens[tokenId]) revert TokenAlreadyLocked();
        
        // Transfer to this contract (lock)
        _transfer(msg.sender, address(this), tokenId);
        lockedTokens[tokenId] = true;
        totalLocked++;

        emit TokenLocked(tokenId, msg.sender);
    }

    /**
     * @dev Unlock token after cross-chain return
     */
    function _unlockToken(uint256 tokenId, address recipient) internal {
        if (!lockedTokens[tokenId]) revert TokenNotLocked();
        
        lockedTokens[tokenId] = false;
        totalLocked--;
        
        // Transfer from this contract to recipient
        _transfer(address(this), recipient, tokenId);

        emit TokenUnlocked(tokenId, recipient);
    }

    // ============ Provenance Tracking ============

    /**
     * @dev Record provenance entry
     */
    function _recordProvenance(uint256 tokenId, address owner) internal {
        tokenProvenance[tokenId].push(ProvenanceEntry({
            chainId: block.chainid,
            collection: address(this),
            tokenId: tokenId,
            timestamp: block.timestamp,
            txHash: bytes32(0), // Can't access tx.hash in Solidity
            owner: owner
        }));
    }

    /**
     * @notice Get provenance history for a token
     * @param tokenId Token ID
     * @return Array of provenance entries
     */
    function getProvenance(uint256 tokenId) external view returns (ProvenanceEntry[] memory) {
        return tokenProvenance[tokenId];
    }

    /**
     * @notice Get provenance count for a token
     */
    function getProvenanceCount(uint256 tokenId) external view returns (uint256) {
        return tokenProvenance[tokenId].length;
    }

    // ============ View Functions ============

    /**
     * @notice Get cross-chain statistics
     */
    function getCrossChainStats() external view returns (
        uint256 totalBridged,
        uint256 totalReceived,
        uint32 homeDomain,
        bool isHome
    ) {
        return (totalBridgedOut, totalBridgedIn, homeChainDomain, isHomeChainInstance);
    }

    /**
     * @notice Quote gas for cross-chain transfer
     */
    function quoteBridge(
        uint32 destinationDomain,
        uint256 /* tokenId */
    ) external view returns (uint256 gasPayment) {
        return igp.quoteGasPayment(destinationDomain, GAS_LIMIT_BRIDGE);
    }

    /**
     * @notice Check if a domain is supported
     */
    function isSupportedDomain(uint32 domain) external view returns (bool) {
        return supportedDomains[domain] && remoteRouters[domain] != bytes32(0);
    }

    /**
     * @notice Verify metadata hash
     */
    function verifyMetadata(uint256 tokenId, bytes32 expectedHash) external view returns (bool) {
        return metadataHashes[tokenId] == expectedHash;
    }

    // ============ Admin Functions ============

    function setRouter(uint32 domain, bytes32 router) external onlyOwner {
        remoteRouters[domain] = router;
        emit RouterSet(domain, router);
    }

    function setDomainEnabled(uint32 domain, bool enabled) external onlyOwner {
        supportedDomains[domain] = enabled;
        emit DomainEnabled(domain, enabled);
    }

    /// @notice Set moderation hooks contract
    function setModerationHooks(address hooks) external onlyOwner {
        moderationHooks = INFTModerationHooks(hooks);
        emit ModerationHooksSet(hooks);
    }

    function setMailbox(address _mailbox) external onlyOwner {
        emit MailboxUpdated(address(mailbox), _mailbox);
        mailbox = IHyperlaneMailbox(_mailbox);
    }

    function setIGP(address _igp) external onlyOwner {
        emit IGPUpdated(address(igp), _igp);
        igp = IInterchainGasPaymaster(_igp);
    }

    /**
     * @notice Batch configure routers for multiple chains
     */
    function configureRouters(
        uint32[] calldata domains,
        bytes32[] calldata routers
    ) external onlyOwner {
        require(domains.length == routers.length, "Length mismatch");
        for (uint256 i = 0; i < domains.length; i++) {
            remoteRouters[domains[i]] = routers[i];
            supportedDomains[domains[i]] = routers[i] != bytes32(0);
            emit RouterSet(domains[i], routers[i]);
            emit DomainEnabled(domains[i], routers[i] != bytes32(0));
        }
    }

    // ============ Required Overrides ============

    function tokenURI(uint256 tokenId) public view virtual override(ERC721URIStorage, ERC721) returns (string memory) {
        return ERC721URIStorage.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC721URIStorage, ERC721Royalty) returns (bool) {
        return ERC721URIStorage.supportsInterface(interfaceId) || ERC721Royalty.supportsInterface(interfaceId);
    }

    /**
     * @dev Override _update to hook into state changes (OZ v5 pattern)
     */
    function _update(address to, uint256 tokenId, address auth) internal virtual override returns (address) {
        address previousOwner = super._update(to, tokenId, auth);
        
        // If burning, reset royalty
        if (to == address(0)) {
            _resetTokenRoyalty(tokenId);
        }
        
        return previousOwner;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
