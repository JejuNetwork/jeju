// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Burnable} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Burnable.sol";
import {ERC1155Supply} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title Items
 * @author Jeju Network
 * @notice Mintable ERC-1155 tokens for Hyperscape in-game items
 * @dev ERC-1155 multi-token standard supporting both:
 *      - Stackable items (fungible): arrows, potions, resources (quantity > 1)
 *      - Unique items (non-fungible): legendary weapons, armor (quantity = 1)
 *
 * Game Integration Flow:
 * 1. Player obtains item in-game (stored in MUD InventorySlot table)
 * 2. Player decides to "mint" item to make it permanent and tradeable
 * 3. Game server generates signature with item metadata
 * 4. Player calls mintItem() with signature to create token
 * 5. Item becomes tradeable on marketplace (Bazaar) or via PlayerTradeEscrow
 * 6. Player can burn tokens to convert back to in-game items
 *
 * Token ID Structure:
 * - itemId (uint256): Unique identifier for item type
 * - instanceId (bytes32): Unique instance for non-stackable items
 * - For stackable items, instanceId can be reused (represents item type)
 * - For non-stackable items, instanceId must be unique per token
 *
 * Metadata:
 * - itemId: Numeric item type identifier
 * - stackable: Whether item is stackable (true) or unique (false)
 * - attack, defense, strength: Combat stats
 * - rarity: 0=Common, 1=Uncommon, 2=Rare, 3=Epic, 4=Legendary
 * - name: Human-readable item name
 *
 * Security:
 * - Signature-based minting (only game server can authorize)
 * - Instance ID prevents double-minting non-stackable items
 * - Burnable to remove from circulation
 * - Registry integration for player verification
 *
 * @custom:security-contact security@jeju.network
 */
contract Items is ERC1155, ERC1155Burnable, ERC1155Supply, Ownable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;
    using Strings for uint256;

    // ============ Structs ============

    /// @notice Item type metadata for each item ID
    struct ItemTypeMetadata {
        uint256 itemId; // Item type identifier (token ID)
        string name; // Item name (e.g., "Bronze Sword")
        bool stackable; // True if stackable (fungible), false if unique (non-fungible)
        int16 attack; // Attack bonus
        int16 defense; // Defense bonus
        int16 strength; // Strength bonus
        uint8 rarity; // 0=Common, 1=Uncommon, 2=Rare, 3=Epic, 4=Legendary
    }

    /// @notice Minted NFT instance metadata (tracks WHO minted it)
    struct MintedItemMetadata {
        address originalMinter; // WHO first minted this token/instance
        uint256 mintedAt; // WHEN it was minted
        bytes32 instanceId; // Unique instance identifier (for non-stackable)
    }

    // ============ Constants ============

    /// @notice Base URI for token metadata
    string private constant BASE_URI = "https://api.hyperscape.jeju.network/items/";

    // ============ State Variables ============

    /// @notice Game's agent ID in IdentityRegistry (ERC-8004)
    /// @dev Links these items to a registered game entity
    uint256 public immutable gameAgentId;

    /// @notice Address authorized to sign mint requests (game server)
    address public gameSigner;

    /// @notice Counter for item type IDs
    uint256 private _nextItemId;

    /// @notice Mapping from item ID to item TYPE metadata
    mapping(uint256 => ItemTypeMetadata) private _itemTypeMetadata;

    /// @notice Mapping from (player address + itemId) to minted metadata (WHO minted their tokens)
    mapping(address => mapping(uint256 => MintedItemMetadata)) private _mintedMetadata;

    /// @notice Mapping from instance ID to original minter (prevents double-minting non-stackable)
    mapping(bytes32 => address) private _instanceToMinter;

    /// @notice Mapping to check if instance has been minted (for non-stackable items)
    mapping(bytes32 => bool) private _instanceMinted;

    // ============ Events ============

    event ItemMinted(
        address indexed minter, uint256 indexed itemId, uint256 amount, bytes32 instanceId, bool stackable, uint8 rarity
    );
    event ItemBurned(address indexed player, uint256 indexed itemId, uint256 amount);
    event GameSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event ItemTypeCreated(uint256 indexed itemId, string name, bool stackable, uint8 rarity);
    event NFTProvenance(
        address indexed originalMinter, uint256 indexed itemId, bytes32 indexed instanceId, uint256 mintedAt
    );

    // ============ Errors ============

    error InvalidSignature();
    error InstanceAlreadyMinted(bytes32 instanceId, address originalMinter);
    error InvalidItemId();
    error InvalidGameSigner();
    error ItemDoesNotExist();
    error InvalidAmount();
    error ItemNotStackable();
    error NotOriginalMinter();

    // ============ Constructor ============

    /**
     * @notice Deploy Items contract
     * @param _gameAgentId Game's agent ID in IdentityRegistry (ERC-8004)
     * @param _gameSigner Address authorized to sign mint requests
     * @param _owner Contract owner (admin)
     * @dev Game must be registered in IdentityRegistry before deployment
     */
    constructor(uint256 _gameAgentId, address _gameSigner, address _owner) ERC1155(BASE_URI) Ownable(_owner) {
        if (_gameSigner == address(0)) revert InvalidGameSigner();
        gameAgentId = _gameAgentId;
        gameSigner = _gameSigner;
        _nextItemId = 1; // Start at 1, reserve 0 for "no item"
    }

    // ============ Item Type Creation ============

    /**
     * @notice Create a new item type
     * @param name Item name
     * @param stackable Whether item is stackable
     * @param attack Attack bonus
     * @param defense Defense bonus
     * @param strength Strength bonus
     * @param rarity Rarity level (0-4)
     * @return itemId The created item type ID
     * @dev Only owner can create item types
     */
    function createItemType(
        string memory name,
        bool stackable,
        int16 attack,
        int16 defense,
        int16 strength,
        uint8 rarity
    ) external onlyOwner returns (uint256 itemId) {
        itemId = _nextItemId++;

        _itemTypeMetadata[itemId] = ItemTypeMetadata({
            itemId: itemId,
            name: name,
            stackable: stackable,
            attack: attack,
            defense: defense,
            strength: strength,
            rarity: rarity
        });

        emit ItemTypeCreated(itemId, name, stackable, rarity);
    }

    // ============ Player Functions ============

    /**
     * @notice Mint items from in-game
     * @param itemId Item type identifier
     * @param amount Amount to mint (1 for non-stackable, >1 for stackable)
     * @param instanceId Unique instance hash (must be unique for non-stackable)
     * @param signature Game server signature authorizing mint
     * @dev Signature = sign(keccak256(abi.encodePacked(
     *          msg.sender, itemId, amount, instanceId
     *      )))
     */
    function mintItem(uint256 itemId, uint256 amount, bytes32 instanceId, bytes memory signature) external {
        if (amount == 0) revert InvalidAmount();

        ItemTypeMetadata memory metadata = _itemTypeMetadata[itemId];
        if (bytes(metadata.name).length == 0) revert ItemDoesNotExist();

        // For non-stackable items, check instance hasn't been minted
        if (!metadata.stackable) {
            if (amount != 1) revert InvalidAmount();
            if (_instanceMinted[instanceId]) {
                revert InstanceAlreadyMinted(instanceId, _instanceToMinter[instanceId]);
            }
        }

        if (!verifyMint(msg.sender, itemId, amount, instanceId, signature)) {
            revert InvalidSignature();
        }

        // CRITICAL: Record who is minting this (ORIGINAL MINTER tracking)
        if (_mintedMetadata[msg.sender][itemId].originalMinter == address(0)) {
            _mintedMetadata[msg.sender][itemId] =
                MintedItemMetadata({originalMinter: msg.sender, mintedAt: block.timestamp, instanceId: instanceId});
        }

        // Mark instance as minted for non-stackable items
        if (!metadata.stackable) {
            _instanceToMinter[instanceId] = msg.sender; // Record WHO first minted this instance
            _instanceMinted[instanceId] = true;
        }

        _mint(msg.sender, itemId, amount, "");

        emit ItemMinted(msg.sender, itemId, amount, instanceId, metadata.stackable, metadata.rarity);

        // Emit provenance event for tracking
        emit NFTProvenance(msg.sender, itemId, instanceId, block.timestamp);
    }

    /**
     * @notice Burn items (converts back to in-game items)
     * @param account Account to burn from
     * @param itemId Item type ID
     * @param amount Amount to burn
     * @dev Can be called by token owner
     *      WARNING: Burning loses minter provenance! Item returns to in-game state.
     */
    function burn(address account, uint256 itemId, uint256 amount) public override {
        if (account != msg.sender && !isApprovedForAll(account, msg.sender)) {
            revert ERC1155MissingApprovalForAll(msg.sender, account);
        }

        super.burn(account, itemId, amount);
        emit ItemBurned(account, itemId, amount);
    }

    /**
     * @notice Burn item by instance (for non-stackable items)
     * @param instanceId Instance hash of item to burn
     * @dev Allows burning specific non-stackable item instance
     */
    function burnByInstance(bytes32 instanceId) external {
        if (!_instanceMinted[instanceId]) revert InvalidItemId();

        address originalMinter = _instanceToMinter[instanceId];
        if (msg.sender != originalMinter) revert NotOriginalMinter();

        // Find itemId from minted metadata
        for (uint256 i = 1; i < _nextItemId; i++) {
            if (_mintedMetadata[originalMinter][i].instanceId == instanceId) {
                ItemTypeMetadata memory itemType = _itemTypeMetadata[i];
                if (itemType.stackable) revert ItemNotStackable();
                if (balanceOf(msg.sender, i) == 0) revert InvalidAmount();

                // Allow re-minting same instance after burn (loses provenance)
                _instanceMinted[instanceId] = false;

                burn(msg.sender, i, 1);
                return;
            }
        }

        revert InvalidItemId();
    }

    // ============ View Functions ============

    /**
     * @notice Get item metadata for an item type
     * @param itemId Item type ID
     * @return Item metadata struct
     */
    function getItemMetadata(uint256 itemId) external view returns (ItemTypeMetadata memory) {
        ItemTypeMetadata memory metadata = _itemTypeMetadata[itemId];
        if (bytes(metadata.name).length == 0) revert ItemDoesNotExist();
        return metadata;
    }

    /**
     * @notice Get WHO minted an item for a specific owner
     * @param owner Token owner address
     * @param itemId Item type ID
     * @return Minted metadata including original minter
     * @dev THIS IS KEY: Shows WHO first minted this item type for this owner
     *      Even if item is traded, this shows the ORIGINAL MINTER
     */
    function getMintedMetadata(address owner, uint256 itemId) external view returns (MintedItemMetadata memory) {
        return _mintedMetadata[owner][itemId];
    }

    /**
     * @notice Get original minter of a specific instance (for non-stackable)
     * @param instanceId Instance hash
     * @return Original minter address
     * @dev Shows WHO first minted this unique instance
     *      This is IMMUTABLE - even after trading, shows original creator
     */
    function getInstanceMinter(bytes32 instanceId) external view returns (address) {
        return _instanceToMinter[instanceId];
    }

    /**
     * @notice Check if an instance has been minted (for non-stackable items)
     * @param instanceId Instance hash to check
     * @return minted True if instance has been minted
     * @return originalMinter WHO first minted this instance
     */
    function checkInstance(bytes32 instanceId) external view returns (bool minted, address originalMinter) {
        return (_instanceMinted[instanceId], _instanceToMinter[instanceId]);
    }

    /**
     * @notice Verify a mint signature
     * @param player Player address
     * @param itemId Item type identifier
     * @param amount Amount to mint
     * @param instanceId Instance hash
     * @param signature Signature to verify
     * @return True if signature is valid
     */
    function verifyMint(address player, uint256 itemId, uint256 amount, bytes32 instanceId, bytes memory signature)
        public
        view
        returns (bool)
    {
        bytes32 messageHash = keccak256(abi.encodePacked(player, itemId, amount, instanceId));
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        address signer = ethSignedMessageHash.recover(signature);
        return signer == gameSigner;
    }

    /**
     * @notice Get URI for an item type
     * @param itemId Item type ID
     * @return Token URI
     */
    function uri(uint256 itemId) public pure override returns (string memory) {
        return string(abi.encodePacked(BASE_URI, itemId.toString(), ".json"));
    }

    // ============ Admin Functions ============

    /**
     * @notice Update game signer address
     * @param newSigner New game signer address
     * @dev Only owner can update
     */
    function setGameSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert InvalidGameSigner();
        address oldSigner = gameSigner;
        gameSigner = newSigner;
        emit GameSignerUpdated(oldSigner, newSigner);
    }

    /**
     * @notice Get contract version
     * @return Version string
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    // ============ Internal Overrides ============

    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override(ERC1155, ERC1155Supply)
    {
        super._update(from, to, ids, values);
    }
}
