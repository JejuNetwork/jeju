// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {INFTModeration, INFTModerationHooks} from "./interfaces/INFTModeration.sol";

/**
 * @title NFTModerationAdapter
 * @author Jeju Network
 * @notice Adapter connecting NFT contracts to the Jeju moderation system
 * @dev Implements moderation hooks for NFT transfers, mints, and bridges
 *
 * Integration:
 * - Connects to BanManager for user/agent bans
 * - Supports collection-level bans
 * - Supports token-level bans (for reported content)
 * - Integrates with IdentityRegistry for agent checks
 *
 * @custom:security-contact security@jejunetwork.org
 */
contract NFTModerationAdapter is INFTModeration, INFTModerationHooks, Ownable {
    // =========================================================================
    // State
    // =========================================================================

    /// @notice BanManager contract
    address public banManager;

    /// @notice IdentityRegistry contract
    address public identityRegistry;

    /// @notice Banned collections
    mapping(address => bool) public bannedCollections;

    /// @notice Banned tokens: collection => tokenId => banned
    mapping(address => mapping(uint256 => bool)) public bannedTokens;

    /// @notice Banned users (direct address bans)
    mapping(address => bool) public bannedUsers;

    /// @notice Whitelisted collections (bypass checks)
    mapping(address => bool) public whitelistedCollections;

    /// @notice Authorized moderators
    mapping(address => bool) public moderators;

    /// @notice Blocked destination chains
    mapping(uint256 => bool) public blockedChains;

    // =========================================================================
    // Events
    // =========================================================================

    event UserBanned(address indexed user, string reason);
    event UserUnbanned(address indexed user);
    event CollectionBanned(address indexed collection, string reason);
    event CollectionUnbanned(address indexed collection);
    event TokenBanned(address indexed collection, uint256 indexed tokenId, string reason);
    event TokenUnbanned(address indexed collection, uint256 indexed tokenId);
    event ModeratorSet(address indexed moderator, bool authorized);
    event ChainBlocked(uint256 indexed chainId, bool blocked);
    event CollectionWhitelisted(address indexed collection, bool whitelisted);

    // =========================================================================
    // Errors
    // =========================================================================

    error NotModerator();
    error UserIsBanned();
    error CollectionIsBanned();
    error TokenIsBanned();
    error ChainIsBlocked();

    // =========================================================================
    // Modifiers
    // =========================================================================

    modifier onlyModerator() {
        if (!moderators[msg.sender] && msg.sender != owner()) revert NotModerator();
        _;
    }

    // =========================================================================
    // Constructor
    // =========================================================================

    constructor(address _owner) Ownable(_owner) {
        moderators[_owner] = true;
    }

    // =========================================================================
    // Configuration
    // =========================================================================

    /// @notice Set BanManager contract
    function setBanManager(address _banManager) external onlyOwner {
        banManager = _banManager;
    }

    /// @notice Set IdentityRegistry contract
    function setIdentityRegistry(address _registry) external onlyOwner {
        identityRegistry = _registry;
    }

    /// @notice Set moderator authorization
    function setModerator(address moderator, bool authorized) external onlyOwner {
        moderators[moderator] = authorized;
        emit ModeratorSet(moderator, authorized);
    }

    // =========================================================================
    // INFTModeration Implementation
    // =========================================================================

    /// @inheritdoc INFTModeration
    function isUserBanned(address user) public view override returns (bool) {
        // Direct ban
        if (bannedUsers[user]) return true;

        // Check BanManager if configured
        if (banManager != address(0)) {
            // Query BanManager for address-based ban
            (bool success, bytes memory data) = banManager.staticcall(
                abi.encodeWithSignature("isAddressBanned(address)", user)
            );
            if (success && data.length >= 32) {
                return abi.decode(data, (bool));
            }
        }

        return false;
    }

    /// @inheritdoc INFTModeration
    function isCollectionBanned(address collection) public view override returns (bool) {
        return bannedCollections[collection];
    }

    /// @inheritdoc INFTModeration
    function isTokenBanned(address collection, uint256 tokenId) public view override returns (bool) {
        return bannedTokens[collection][tokenId];
    }

    // =========================================================================
    // INFTModerationHooks Implementation
    // =========================================================================

    /// @inheritdoc INFTModerationHooks
    function beforeTransfer(
        address collection,
        address from,
        address to,
        uint256 tokenId
    ) external view override returns (bool) {
        // Skip checks for whitelisted collections
        if (whitelistedCollections[collection]) return true;

        // Check collection ban
        if (isCollectionBanned(collection)) return false;

        // Check token ban
        if (isTokenBanned(collection, tokenId)) return false;

        // Check sender ban (allow burns from banned users)
        if (to != address(0) && isUserBanned(from)) return false;

        // Check recipient ban (allow mints)
        if (from != address(0) && isUserBanned(to)) return false;

        return true;
    }

    /// @inheritdoc INFTModerationHooks
    function beforeMint(
        address collection,
        address to,
        uint256 tokenId
    ) external view override returns (bool) {
        // Skip checks for whitelisted collections
        if (whitelistedCollections[collection]) return true;

        // Check collection ban
        if (isCollectionBanned(collection)) return false;

        // Check token ban
        if (isTokenBanned(collection, tokenId)) return false;

        // Check recipient ban
        if (isUserBanned(to)) return false;

        return true;
    }

    /// @inheritdoc INFTModerationHooks
    function beforeBridge(
        address collection,
        address owner,
        uint256 tokenId,
        uint256 destinationChain
    ) external view override returns (bool) {
        // Skip checks for whitelisted collections
        if (whitelistedCollections[collection]) return true;

        // Check chain block
        if (blockedChains[destinationChain]) return false;

        // Check collection ban
        if (isCollectionBanned(collection)) return false;

        // Check token ban
        if (isTokenBanned(collection, tokenId)) return false;

        // Check owner ban
        if (isUserBanned(owner)) return false;

        return true;
    }

    // =========================================================================
    // Moderation Actions
    // =========================================================================

    /// @notice Ban a user
    function banUser(address user, string calldata reason) external onlyModerator {
        bannedUsers[user] = true;
        emit UserBanned(user, reason);
    }

    /// @notice Unban a user
    function unbanUser(address user) external onlyModerator {
        bannedUsers[user] = false;
        emit UserUnbanned(user);
    }

    /// @notice Ban a collection
    function banCollection(address collection, string calldata reason) external onlyModerator {
        bannedCollections[collection] = true;
        emit CollectionBanned(collection, reason);
    }

    /// @notice Unban a collection
    function unbanCollection(address collection) external onlyModerator {
        bannedCollections[collection] = false;
        emit CollectionUnbanned(collection);
    }

    /// @notice Ban a specific token
    function banToken(address collection, uint256 tokenId, string calldata reason) external onlyModerator {
        bannedTokens[collection][tokenId] = true;
        emit TokenBanned(collection, tokenId, reason);
    }

    /// @notice Unban a specific token
    function unbanToken(address collection, uint256 tokenId) external onlyModerator {
        bannedTokens[collection][tokenId] = false;
        emit TokenUnbanned(collection, tokenId);
    }

    /// @notice Block a destination chain
    function blockChain(uint256 chainId, bool blocked) external onlyModerator {
        blockedChains[chainId] = blocked;
        emit ChainBlocked(chainId, blocked);
    }

    /// @notice Whitelist a collection (bypass all checks)
    function whitelistCollection(address collection, bool whitelisted) external onlyOwner {
        whitelistedCollections[collection] = whitelisted;
        emit CollectionWhitelisted(collection, whitelisted);
    }

    // =========================================================================
    // Batch Operations
    // =========================================================================

    /// @notice Batch ban users
    function banUsers(address[] calldata users, string calldata reason) external onlyModerator {
        for (uint256 i = 0; i < users.length; i++) {
            bannedUsers[users[i]] = true;
            emit UserBanned(users[i], reason);
        }
    }

    /// @notice Batch unban users
    function unbanUsers(address[] calldata users) external onlyModerator {
        for (uint256 i = 0; i < users.length; i++) {
            bannedUsers[users[i]] = false;
            emit UserUnbanned(users[i]);
        }
    }

    /// @notice Batch ban tokens
    function banTokens(
        address collection,
        uint256[] calldata tokenIds,
        string calldata reason
    ) external onlyModerator {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            bannedTokens[collection][tokenIds[i]] = true;
            emit TokenBanned(collection, tokenIds[i], reason);
        }
    }
}
