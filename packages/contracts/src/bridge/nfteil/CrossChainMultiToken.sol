// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Supply} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {ERC1155URIStorage} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {ICrossChainNFTHandler, ProvenanceEntry} from "./INFTEIL.sol";

/**
 * @title IHyperlaneMailbox
 */
interface IHyperlaneMailbox {
    function dispatch(uint32 destinationDomain, bytes32 recipientAddress, bytes calldata messageBody)
        external
        payable
        returns (bytes32 messageId);

    function localDomain() external view returns (uint32);
}

/**
 * @title IInterchainGasPaymaster
 */
interface IInterchainGasPaymaster {
    function payForGas(bytes32 messageId, uint32 destinationDomain, uint256 gasAmount, address refundAddress)
        external
        payable;

    function quoteGasPayment(uint32 destinationDomain, uint256 gasAmount) external view returns (uint256);
}

/**
 * @title CrossChainMultiToken
 * @author Jeju Network
 * @notice Abstract base contract for cross-chain ERC1155 tokens using Hyperlane
 * @dev
 * - Supports semi-fungible tokens (same tokenId, multiple copies)
 * - Home chain: Lock tokens when bridging out, unlock when bridging back
 * - Synthetic chain: Mint wrapped tokens when receiving, burn when bridging out
 * - Preserves original tokenId across all chains
 * - Supports batch transfers for gas efficiency
 * - Implements ERC-2981 royalties
 *
 * @custom:security-contact security@jejunetwork.org
 */
abstract contract CrossChainMultiToken is
    ERC1155Supply,
    ERC1155URIStorage,
    Ownable,
    ReentrancyGuard,
    IERC2981,
    IERC1155Receiver,
    ICrossChainNFTHandler
{
    // ============ Constants ============

    uint256 public constant GAS_LIMIT_BRIDGE = 500_000;
    uint256 public constant GAS_LIMIT_BATCH = 800_000;

    // Message types
    bytes1 public constant MESSAGE_TYPE_TRANSFER = 0x01;
    bytes1 public constant MESSAGE_TYPE_BATCH_TRANSFER = 0x02;
    bytes1 public constant MESSAGE_TYPE_METADATA_SYNC = 0x03;

    // ============ State Variables ============

    /// @notice Hyperlane mailbox
    IHyperlaneMailbox public mailbox;

    /// @notice Gas paymaster
    IInterchainGasPaymaster public igp;

    /// @notice Home chain domain
    uint32 public homeChainDomain;

    /// @notice Is this the home chain instance
    bool public isHomeChainInstance;

    /// @notice Remote routers
    mapping(uint32 => bytes32) public remoteRouters;

    /// @notice Supported domains
    mapping(uint32 => bool) public supportedDomains;

    /// @notice Locked token balances on home chain: tokenId => amount
    mapping(uint256 => uint256) public lockedBalances;

    /// @notice Total unique tokens locked
    uint256 public totalTokensLocked;

    /// @notice Total bridged out (count of transfers)
    uint256 public totalBridgedOut;

    /// @notice Total bridged in
    uint256 public totalBridgedIn;

    /// @notice Processed messages
    mapping(bytes32 => bool) public processedMessages;

    /// @notice Provenance per token
    mapping(uint256 => ProvenanceEntry[]) public tokenProvenance;

    /// @notice Metadata hashes
    mapping(uint256 => bytes32) public metadataHashes;

    /// @notice Royalty info per token: tokenId => (receiver, feeBps)
    mapping(uint256 => RoyaltyInfo) private _tokenRoyalties;

    /// @notice Default royalty
    RoyaltyInfo private _defaultRoyalty;

    struct RoyaltyInfo {
        address receiver;
        uint96 royaltyFraction;
    }

    // ============ Events ============

    event RouterSet(uint32 indexed domain, bytes32 router);
    event DomainEnabled(uint32 indexed domain, bool enabled);
    event TokensLocked(uint256 indexed tokenId, address indexed owner, uint256 amount);
    event TokensUnlocked(uint256 indexed tokenId, address indexed recipient, uint256 amount);
    event BatchBridgeInitiated(
        bytes32 indexed messageId,
        address indexed sender,
        uint32 destinationDomain,
        uint256[] tokenIds,
        uint256[] amounts
    );

    // ============ Errors ============

    error UnsupportedDomain(uint32 domain);
    error RouterNotSet(uint32 domain);
    error InsufficientGasPayment(uint256 required, uint256 provided);
    error MessageAlreadyProcessed(bytes32 messageId);
    error OnlyMailbox();
    error InvalidMessageType();
    error InvalidRecipient();
    error InsufficientLockedBalance();
    error InsufficientBalance();
    error ArrayLengthMismatch();

    // ============ Modifiers ============

    modifier onlyMailbox() {
        if (msg.sender != address(mailbox)) revert OnlyMailbox();
        _;
    }

    // ============ Constructor ============

    constructor(string memory uri_, address initialOwner) ERC1155(uri_) Ownable(initialOwner) {}

    // ============ Initialization ============

    function _initializeCrossChain(address _mailbox, address _igp, uint32 _homeChainDomain, bool _isHomeChain)
        internal
    {
        mailbox = IHyperlaneMailbox(_mailbox);
        igp = IInterchainGasPaymaster(_igp);
        homeChainDomain = _homeChainDomain;
        isHomeChainInstance = _isHomeChain;
    }

    // ============ Single Token Bridge ============

    /**
     * @notice Bridge NFT (single token for ERC721 compatibility)
     */
    function bridgeNFT(uint32 destinationDomain, bytes32 recipient, uint256 tokenId)
        external
        payable
        nonReentrant
        returns (bytes32 messageId)
    {
        return _bridgeTokens(destinationDomain, recipient, tokenId, 1, msg.value);
    }

    /**
     * @notice Bridge multiple copies of a token
     */
    function bridgeMultiToken(uint32 destinationDomain, bytes32 recipient, uint256 tokenId, uint256 amount)
        external
        payable
        nonReentrant
        returns (bytes32 messageId)
    {
        return _bridgeTokens(destinationDomain, recipient, tokenId, amount, msg.value);
    }

    /**
     * @notice Batch bridge multiple different tokens
     */
    function bridgeBatch(
        uint32 destinationDomain,
        bytes32 recipient,
        uint256[] calldata tokenIds,
        uint256[] calldata amounts
    ) external payable nonReentrant returns (bytes32 messageId) {
        if (recipient == bytes32(0)) revert InvalidRecipient();
        if (!supportedDomains[destinationDomain]) revert UnsupportedDomain(destinationDomain);
        if (remoteRouters[destinationDomain] == bytes32(0)) revert RouterNotSet(destinationDomain);
        if (tokenIds.length != amounts.length) revert ArrayLengthMismatch();

        // Handle tokens
        for (uint256 i = 0; i < tokenIds.length; i++) {
            if (balanceOf(msg.sender, tokenIds[i]) < amounts[i]) revert InsufficientBalance();

            if (isHomeChainInstance) {
                _lockTokens(tokenIds[i], amounts[i]);
            } else {
                _burn(msg.sender, tokenIds[i], amounts[i]);
            }

            _recordProvenance(tokenIds[i], msg.sender);
        }

        totalBridgedOut += tokenIds.length;

        // Construct batch message
        bytes memory messageBody = abi.encodePacked(MESSAGE_TYPE_BATCH_TRANSFER, recipient, uint256(tokenIds.length));

        for (uint256 i = 0; i < tokenIds.length; i++) {
            messageBody = abi.encodePacked(messageBody, tokenIds[i], amounts[i]);
        }

        // Dispatch
        messageId = mailbox.dispatch{value: 0}(destinationDomain, remoteRouters[destinationDomain], messageBody);

        // Pay for gas
        uint256 requiredGas = igp.quoteGasPayment(destinationDomain, GAS_LIMIT_BATCH);
        if (msg.value < requiredGas) revert InsufficientGasPayment(requiredGas, msg.value);

        igp.payForGas{value: msg.value}(messageId, destinationDomain, GAS_LIMIT_BATCH, msg.sender);

        emit BatchBridgeInitiated(messageId, msg.sender, destinationDomain, tokenIds, amounts);

        return messageId;
    }

    function _bridgeTokens(
        uint32 destinationDomain,
        bytes32 recipient,
        uint256 tokenId,
        uint256 amount,
        uint256 gasPayment
    ) internal returns (bytes32 messageId) {
        if (recipient == bytes32(0)) revert InvalidRecipient();
        if (!supportedDomains[destinationDomain]) revert UnsupportedDomain(destinationDomain);
        if (remoteRouters[destinationDomain] == bytes32(0)) revert RouterNotSet(destinationDomain);
        if (balanceOf(msg.sender, tokenId) < amount) revert InsufficientBalance();

        // Get URI before locking/burning
        string memory tokenUri = uri(tokenId);

        if (isHomeChainInstance) {
            _lockTokens(tokenId, amount);
        } else {
            _burn(msg.sender, tokenId, amount);
        }

        _recordProvenance(tokenId, msg.sender);
        totalBridgedOut++;

        // Construct message
        bytes memory messageBody = abi.encodePacked(MESSAGE_TYPE_TRANSFER, recipient, tokenId, amount, tokenUri);

        messageId = mailbox.dispatch{value: 0}(destinationDomain, remoteRouters[destinationDomain], messageBody);

        uint256 requiredGas = igp.quoteGasPayment(destinationDomain, GAS_LIMIT_BRIDGE);
        if (gasPayment < requiredGas) revert InsufficientGasPayment(requiredGas, gasPayment);

        igp.payForGas{value: gasPayment}(messageId, destinationDomain, GAS_LIMIT_BRIDGE, msg.sender);

        emit NFTBridgeInitiated(messageId, msg.sender, destinationDomain, recipient, tokenId, amount);
    }

    // ============ Message Handling ============

    function handle(uint32 origin, bytes32 sender, bytes calldata body) external onlyMailbox {
        if (remoteRouters[origin] != sender) revert RouterNotSet(origin);

        bytes1 messageType = body[0];

        if (messageType == MESSAGE_TYPE_TRANSFER) {
            _handleSingleTransfer(origin, body);
        } else if (messageType == MESSAGE_TYPE_BATCH_TRANSFER) {
            _handleBatchTransfer(origin, body);
        } else if (messageType == MESSAGE_TYPE_METADATA_SYNC) {
            _handleMetadataSync(body);
        } else {
            revert InvalidMessageType();
        }
    }

    function _handleSingleTransfer(uint32 origin, bytes calldata body) internal {
        // Decode: type(1) + recipient(32) + tokenId(32) + amount(32) + uri(variable)
        bytes32 recipientBytes = bytes32(body[1:33]);
        uint256 tokenId = uint256(bytes32(body[33:65]));
        uint256 amount = uint256(bytes32(body[65:97]));
        string memory tokenUri = string(body[97:]);

        address recipient = address(uint160(uint256(recipientBytes)));

        bytes32 messageId = keccak256(abi.encodePacked(origin, body, block.number));
        if (processedMessages[messageId]) revert MessageAlreadyProcessed(messageId);
        processedMessages[messageId] = true;

        if (isHomeChainInstance) {
            _unlockTokens(tokenId, amount, recipient);
        } else {
            _mint(recipient, tokenId, amount, "");
            _setURI(tokenId, tokenUri);
            metadataHashes[tokenId] = keccak256(bytes(tokenUri));
        }

        _recordProvenance(tokenId, recipient);
        totalBridgedIn++;

        emit NFTBridgeReceived(messageId, origin, recipient, tokenId, amount);
    }

    function _handleBatchTransfer(uint32 origin, bytes calldata body) internal {
        // Decode: type(1) + recipient(32) + count(32) + [tokenId(32) + amount(32)]...
        bytes32 recipientBytes = bytes32(body[1:33]);
        uint256 count = uint256(bytes32(body[33:65]));
        address recipient = address(uint160(uint256(recipientBytes)));

        bytes32 messageId = keccak256(abi.encodePacked(origin, body, block.number));
        if (processedMessages[messageId]) revert MessageAlreadyProcessed(messageId);
        processedMessages[messageId] = true;

        uint256 offset = 65;
        for (uint256 i = 0; i < count; i++) {
            uint256 tokenId = uint256(bytes32(body[offset:offset + 32]));
            uint256 amount = uint256(bytes32(body[offset + 32:offset + 64]));
            offset += 64;

            if (isHomeChainInstance) {
                _unlockTokens(tokenId, amount, recipient);
            } else {
                _mint(recipient, tokenId, amount, "");
            }

            _recordProvenance(tokenId, recipient);
        }

        totalBridgedIn += count;
    }

    function _handleMetadataSync(bytes calldata body) internal {
        uint256 tokenId = uint256(bytes32(body[1:33]));
        string memory tokenUri = string(body[33:]);

        _setURI(tokenId, tokenUri);
        metadataHashes[tokenId] = keccak256(bytes(tokenUri));
    }

    // ============ Token Locking ============

    function _lockTokens(uint256 tokenId, uint256 amount) internal {
        _safeTransferFrom(msg.sender, address(this), tokenId, amount, "");

        if (lockedBalances[tokenId] == 0) {
            totalTokensLocked++;
        }
        lockedBalances[tokenId] += amount;

        emit TokensLocked(tokenId, msg.sender, amount);
    }

    function _unlockTokens(uint256 tokenId, uint256 amount, address recipient) internal {
        if (lockedBalances[tokenId] < amount) revert InsufficientLockedBalance();

        lockedBalances[tokenId] -= amount;
        if (lockedBalances[tokenId] == 0) {
            totalTokensLocked--;
        }

        _safeTransferFrom(address(this), recipient, tokenId, amount, "");

        emit TokensUnlocked(tokenId, recipient, amount);
    }

    // ============ Provenance ============

    function _recordProvenance(uint256 tokenId, address owner) internal {
        tokenProvenance[tokenId].push(
            ProvenanceEntry({
                chainId: block.chainid,
                collection: address(this),
                tokenId: tokenId,
                timestamp: block.timestamp,
                txHash: bytes32(0),
                owner: owner
            })
        );
    }

    function getProvenance(uint256 tokenId) external view returns (ProvenanceEntry[] memory) {
        return tokenProvenance[tokenId];
    }

    // ============ Royalties (ERC-2981) ============

    function setDefaultRoyalty(address receiver, uint96 feeNumerator) external onlyOwner {
        _defaultRoyalty = RoyaltyInfo(receiver, feeNumerator);
    }

    function setTokenRoyalty(uint256 tokenId, address receiver, uint96 feeNumerator) external onlyOwner {
        _tokenRoyalties[tokenId] = RoyaltyInfo(receiver, feeNumerator);
    }

    function royaltyInfo(uint256 tokenId, uint256 salePrice) external view override returns (address, uint256) {
        RoyaltyInfo memory royalty = _tokenRoyalties[tokenId];

        if (royalty.receiver == address(0)) {
            royalty = _defaultRoyalty;
        }

        uint256 royaltyAmount = (salePrice * royalty.royaltyFraction) / 10000;
        return (royalty.receiver, royaltyAmount);
    }

    // ============ View Functions ============

    function getCrossChainStats()
        external
        view
        returns (uint256 totalBridged, uint256 totalReceived, uint32 homeDomain, bool isHome)
    {
        return (totalBridgedOut, totalBridgedIn, homeChainDomain, isHomeChainInstance);
    }

    function quoteBridge(uint32 destinationDomain, uint256 /* tokenId */ ) external view returns (uint256 gasPayment) {
        return igp.quoteGasPayment(destinationDomain, GAS_LIMIT_BRIDGE);
    }

    function quoteBatchBridge(uint32 destinationDomain, uint256 /* tokenCount */ )
        external
        view
        returns (uint256 gasPayment)
    {
        return igp.quoteGasPayment(destinationDomain, GAS_LIMIT_BATCH);
    }

    // ============ Admin ============

    function setRouter(uint32 domain, bytes32 router) external onlyOwner {
        remoteRouters[domain] = router;
        emit RouterSet(domain, router);
    }

    function setDomainEnabled(uint32 domain, bool enabled) external onlyOwner {
        supportedDomains[domain] = enabled;
        emit DomainEnabled(domain, enabled);
    }

    function configureRouters(uint32[] calldata domains, bytes32[] calldata routers) external onlyOwner {
        require(domains.length == routers.length, "Length mismatch");
        for (uint256 i = 0; i < domains.length; i++) {
            remoteRouters[domains[i]] = routers[i];
            supportedDomains[domains[i]] = routers[i] != bytes32(0);
            emit RouterSet(domains[i], routers[i]);
            emit DomainEnabled(domains[i], routers[i] != bytes32(0));
        }
    }

    // ============ Required Overrides ============

    function uri(uint256 tokenId) public view virtual override(ERC1155, ERC1155URIStorage) returns (string memory) {
        return ERC1155URIStorage.uri(tokenId);
    }

    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        virtual
        override(ERC1155, ERC1155Supply)
    {
        super._update(from, to, ids, values);
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC1155, IERC165) returns (bool) {
        return interfaceId == type(IERC2981).interfaceId || interfaceId == type(IERC1155Receiver).interfaceId
            || ERC1155.supportsInterface(interfaceId);
    }

    // ============ IERC1155Receiver Implementation ============

    function onERC1155Received(address, address, uint256, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
