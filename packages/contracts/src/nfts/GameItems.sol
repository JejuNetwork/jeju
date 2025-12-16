// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Supply} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {ERC1155URIStorage} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155URIStorage.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {IGameItems, ProvenanceEntry} from "./interfaces/INFT.sol";
import {INFTModerationHooks} from "./interfaces/INFTModeration.sol";

/**
 * @title GameItems
 * @author Jeju Network
 * @notice ERC-1155 game items with GameTreasury, moderation, and identity integration
 * @dev Supports:
 *      - Multiple item types per game
 *      - GameTreasury operator authorization
 *      - Moderation hooks for bans
 *      - ERC-2981 royalties
 *      - Provenance tracking
 *      - Cross-chain compatible metadata
 *
 * Security:
 * - Only authorized game operators can mint/burn
 * - Moderation hooks can block transfers
 * - Pausable for emergency stops
 * - Rate limiting on mints
 *
 * @custom:security-contact security@jeju.network
 */
contract GameItems is
    ERC1155Supply,
    ERC1155URIStorage,
    Ownable,
    ReentrancyGuard,
    Pausable,
    IERC2981,
    IGameItems
{
    // =========================================================================
    // State
    // =========================================================================

    /// @notice Contract name
    string public name;

    /// @notice Contract symbol
    string public symbol;

    /// @notice Moderation hooks contract
    INFTModerationHooks public moderationHooks;

    /// @notice Identity registry for agent-owned items
    address public identityRegistry;

    /// @notice Game operators: gameId => operator => authorized
    mapping(bytes32 => mapping(address => bool)) private _gameOperators;

    /// @notice Game treasuries: gameId => treasury address
    mapping(bytes32 => address) public gameTreasuries;

    /// @notice Item metadata: itemId => ItemConfig
    mapping(uint256 => ItemConfig) public itemConfigs;

    /// @notice Item provenance: itemId => owner => entries
    mapping(uint256 => mapping(address => ProvenanceEntry[])) private _provenance;

    /// @notice Default royalty info
    address public royaltyReceiver;
    uint96 public royaltyBps;

    /// @notice Per-item royalty overrides
    mapping(uint256 => RoyaltyInfo) private _tokenRoyalties;

    /// @notice Rate limiting: gameId => block => minted
    mapping(bytes32 => mapping(uint256 => uint256)) public mintsPerBlock;
    uint256 public maxMintsPerBlock = 1000;

    // =========================================================================
    // Structs
    // =========================================================================

    struct ItemConfig {
        bytes32 gameId;
        string itemName;
        uint8 rarity; // 0=common, 1=uncommon, 2=rare, 3=epic, 4=legendary
        bool transferable;
        bool burnable;
        uint256 maxSupply; // 0 = unlimited
        uint256 mintPrice; // 0 = free (operator only)
    }

    struct RoyaltyInfo {
        address receiver;
        uint96 royaltyBps;
    }

    // =========================================================================
    // Events
    // =========================================================================

    event GameOperatorSet(bytes32 indexed gameId, address indexed operator, bool authorized);
    event GameTreasurySet(bytes32 indexed gameId, address indexed treasury);
    event ItemConfigured(uint256 indexed itemId, bytes32 indexed gameId, string itemName);
    event ModerationHooksSet(address indexed hooks);
    event RoyaltyUpdated(uint256 indexed itemId, address receiver, uint96 bps);

    // =========================================================================
    // Errors
    // =========================================================================

    error NotGameOperator();
    error ItemNotTransferable();
    error ItemNotBurnable();
    error MaxSupplyExceeded();
    error UserBanned();
    error CollectionBanned();
    error RateLimitExceeded();
    error InvalidRoyalty();
    error InsufficientPayment();

    // =========================================================================
    // Constructor
    // =========================================================================

    constructor(
        string memory _name,
        string memory _symbol,
        string memory _baseUri,
        address _owner
    ) ERC1155(_baseUri) Ownable(_owner) {
        name = _name;
        symbol = _symbol;
        royaltyReceiver = _owner;
        royaltyBps = 500; // 5% default royalty
    }

    // =========================================================================
    // Game Operator Management
    // =========================================================================

    /// @notice Set a game operator
    /// @param gameId The game ID
    /// @param operator The operator address
    /// @param authorized Whether to authorize or revoke
    function setGameOperator(bytes32 gameId, address operator, bool authorized) external onlyOwner {
        _gameOperators[gameId][operator] = authorized;
        emit GameOperatorSet(gameId, operator, authorized);
    }

    /// @notice Set a game's treasury
    /// @param gameId The game ID
    /// @param treasury The treasury address
    function setGameTreasury(bytes32 gameId, address treasury) external onlyOwner {
        gameTreasuries[gameId] = treasury;
        emit GameTreasurySet(gameId, treasury);
    }

    /// @inheritdoc IGameItems
    function isGameOperator(address operator, bytes32 gameId) public view override returns (bool) {
        return _gameOperators[gameId][operator] || gameTreasuries[gameId] == operator;
    }

    // =========================================================================
    // Item Configuration
    // =========================================================================

    /// @notice Configure an item type
    /// @param itemId The item ID
    /// @param config The item configuration
    function configureItem(uint256 itemId, ItemConfig calldata config) external onlyOwner {
        itemConfigs[itemId] = config;
        emit ItemConfigured(itemId, config.gameId, config.itemName);
    }

    /// @notice Batch configure items
    function configureItems(uint256[] calldata itemIds, ItemConfig[] calldata configs) external onlyOwner {
        require(itemIds.length == configs.length, "Length mismatch");
        for (uint256 i = 0; i < itemIds.length; i++) {
            itemConfigs[itemIds[i]] = configs[i];
            emit ItemConfigured(itemIds[i], configs[i].gameId, configs[i].itemName);
        }
    }

    // =========================================================================
    // Minting
    // =========================================================================

    /// @inheritdoc IGameItems
    function mintItem(
        address to,
        uint256 itemId,
        uint256 amount,
        bytes32 gameId
    ) external override nonReentrant whenNotPaused {
        _validateMint(to, itemId, amount, gameId);
        _mint(to, itemId, amount, "");
        _recordProvenance(itemId, address(0), to);
        emit ItemMinted(itemId, to, amount, gameId);
    }

    /// @inheritdoc IGameItems
    function mintBatch(
        address to,
        uint256[] calldata itemIds,
        uint256[] calldata amounts,
        bytes32 gameId
    ) external override nonReentrant whenNotPaused {
        for (uint256 i = 0; i < itemIds.length; i++) {
            _validateMint(to, itemIds[i], amounts[i], gameId);
        }
        _mintBatch(to, itemIds, amounts, "");
        for (uint256 i = 0; i < itemIds.length; i++) {
            _recordProvenance(itemIds[i], address(0), to);
            emit ItemMinted(itemIds[i], to, amounts[i], gameId);
        }
    }

    /// @notice Public mint with payment (if item has mint price)
    function publicMint(uint256 itemId, uint256 amount) external payable nonReentrant whenNotPaused {
        ItemConfig storage config = itemConfigs[itemId];
        require(config.mintPrice > 0, "Not public mintable");
        
        uint256 totalPrice = config.mintPrice * amount;
        if (msg.value < totalPrice) revert InsufficientPayment();

        _validateMint(msg.sender, itemId, amount, config.gameId);
        _mint(msg.sender, itemId, amount, "");
        _recordProvenance(itemId, address(0), msg.sender);

        // Send to game treasury
        address treasury = gameTreasuries[config.gameId];
        if (treasury != address(0)) {
            (bool sent,) = treasury.call{value: msg.value}("");
            require(sent, "Treasury transfer failed");
        }

        emit ItemMinted(itemId, msg.sender, amount, config.gameId);
    }

    function _validateMint(address to, uint256 itemId, uint256 amount, bytes32 gameId) internal view {
        ItemConfig storage config = itemConfigs[itemId];
        
        // Operator check (skip for public mints which check payment)
        if (config.mintPrice == 0 && !isGameOperator(msg.sender, gameId)) {
            revert NotGameOperator();
        }

        // Moderation check
        if (address(moderationHooks) != address(0)) {
            if (!moderationHooks.beforeMint(address(this), to, itemId)) {
                revert UserBanned();
            }
        }

        // Supply check
        if (config.maxSupply > 0 && totalSupply(itemId) + amount > config.maxSupply) {
            revert MaxSupplyExceeded();
        }

        // Rate limit
        if (mintsPerBlock[gameId][block.number] + amount > maxMintsPerBlock) {
            revert RateLimitExceeded();
        }
    }

    // =========================================================================
    // Burning
    // =========================================================================

    /// @inheritdoc IGameItems
    function burnItem(address from, uint256 itemId, uint256 amount) external override nonReentrant {
        ItemConfig storage config = itemConfigs[itemId];
        if (!config.burnable) revert ItemNotBurnable();

        // Only owner or approved operator can burn
        require(
            from == msg.sender || 
            isApprovedForAll(from, msg.sender) ||
            isGameOperator(msg.sender, config.gameId),
            "Not authorized"
        );

        _burn(from, itemId, amount);
        emit ItemBurned(itemId, from, amount, config.gameId);
    }

    // =========================================================================
    // Moderation Integration
    // =========================================================================

    /// @notice Set moderation hooks contract
    function setModerationHooks(address hooks) external onlyOwner {
        moderationHooks = INFTModerationHooks(hooks);
        emit ModerationHooksSet(hooks);
    }

    /// @notice Set identity registry
    function setIdentityRegistry(address registry) external onlyOwner {
        identityRegistry = registry;
    }

    // =========================================================================
    // Transfers
    // =========================================================================

    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal virtual override(ERC1155, ERC1155Supply) {
        // Check transferability and moderation for each item
        for (uint256 i = 0; i < ids.length; i++) {
            if (from != address(0) && to != address(0)) {
                ItemConfig storage config = itemConfigs[ids[i]];
                if (!config.transferable) revert ItemNotTransferable();

                if (address(moderationHooks) != address(0)) {
                    if (!moderationHooks.beforeTransfer(address(this), from, to, ids[i])) {
                        revert UserBanned();
                    }
                }

                _recordProvenance(ids[i], from, to);
            }
        }

        super._update(from, to, ids, values);
    }

    // =========================================================================
    // Provenance
    // =========================================================================

    function _recordProvenance(uint256 itemId, address from, address to) internal {
        _provenance[itemId][to].push(ProvenanceEntry({
            chainId: block.chainid,
            blockNumber: block.number,
            timestamp: block.timestamp,
            from: from,
            to: to
        }));
    }

    /// @notice Get provenance for a specific owner's holding
    function getProvenance(uint256 itemId, address owner) external view returns (ProvenanceEntry[] memory) {
        return _provenance[itemId][owner];
    }

    // =========================================================================
    // Royalties (ERC-2981)
    // =========================================================================

    /// @notice Set default royalty
    function setDefaultRoyalty(address receiver, uint96 bps) external onlyOwner {
        if (bps > 10000) revert InvalidRoyalty();
        royaltyReceiver = receiver;
        royaltyBps = bps;
        emit RoyaltyUpdated(0, receiver, bps);
    }

    /// @notice Set per-item royalty
    function setTokenRoyalty(uint256 itemId, address receiver, uint96 bps) external onlyOwner {
        if (bps > 10000) revert InvalidRoyalty();
        _tokenRoyalties[itemId] = RoyaltyInfo(receiver, bps);
        emit RoyaltyUpdated(itemId, receiver, bps);
    }

    /// @inheritdoc IERC2981
    function royaltyInfo(uint256 tokenId, uint256 salePrice)
        external
        view
        override
        returns (address receiver, uint256 royaltyAmount)
    {
        RoyaltyInfo memory tokenRoyalty = _tokenRoyalties[tokenId];
        if (tokenRoyalty.receiver != address(0)) {
            return (tokenRoyalty.receiver, (salePrice * tokenRoyalty.royaltyBps) / 10000);
        }
        return (royaltyReceiver, (salePrice * royaltyBps) / 10000);
    }

    // =========================================================================
    // URI
    // =========================================================================

    function uri(uint256 tokenId) public view override(ERC1155, ERC1155URIStorage) returns (string memory) {
        return ERC1155URIStorage.uri(tokenId);
    }

    /// @notice Set URI for a specific token
    function setURI(uint256 tokenId, string calldata tokenURI) external onlyOwner {
        _setURI(tokenId, tokenURI);
    }

    /// @notice Set base URI
    function setBaseURI(string calldata baseURI) external onlyOwner {
        _setBaseURI(baseURI);
    }

    // =========================================================================
    // Admin
    // =========================================================================

    /// @notice Pause all transfers
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause transfers
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Set max mints per block rate limit
    function setMaxMintsPerBlock(uint256 max) external onlyOwner {
        maxMintsPerBlock = max;
    }

    /// @notice Withdraw any stuck ETH
    function withdraw() external onlyOwner {
        (bool sent,) = owner().call{value: address(this).balance}("");
        require(sent, "Withdraw failed");
    }

    // =========================================================================
    // ERC165
    // =========================================================================

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC1155, IERC165)
        returns (bool)
    {
        return
            interfaceId == type(IERC2981).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
