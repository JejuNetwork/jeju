// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.33;

/**
 * @title IEmailRegistry
 * @notice Interface for decentralized email account registry
 * @dev Integrates with JNS for email address resolution and MPC for key management
 */
interface IEmailRegistry {
    // ============ Enums ============

    enum AccountStatus {
        INACTIVE,       // Not registered
        ACTIVE,         // Normal operation
        SUSPENDED,      // Temporarily suspended (pending moderation)
        BANNED          // Permanently banned
    }

    enum AccountTier {
        FREE,           // Intra-network only, easily banned
        STAKED,         // External network access, moderation protection
        PREMIUM         // Enhanced features, priority delivery
    }

    // ============ Structs ============

    struct EmailAccount {
        address owner;
        bytes32 publicKeyHash;          // Hash of encryption public key (MPC group key)
        bytes32 jnsNode;                // JNS name node (e.g., alice.jeju)
        AccountStatus status;
        AccountTier tier;
        uint256 stakedAmount;           // Staked tokens (0 for free tier)
        uint256 quotaUsedBytes;         // Storage used
        uint256 quotaLimitBytes;        // Storage limit
        uint256 emailsSentToday;        // Rate limiting
        uint256 lastResetTimestamp;     // Daily reset timestamp
        uint256 createdAt;
        uint256 lastActivityAt;
        address[] preferredRelays;      // Preferred relay nodes
    }

    struct EmailConfig {
        bool allowExternalInbound;      // Receive from Web2 email
        bool allowExternalOutbound;     // Send to Web2 email (requires staking)
        bool encryptionRequired;        // Require E2E encryption
        uint8 spamFilterLevel;          // 0=off, 1=low, 2=medium, 3=high
        string autoForwardAddress;      // Auto-forward to another address
    }

    // ============ Events ============

    event AccountRegistered(
        address indexed owner,
        bytes32 indexed jnsNode,
        string emailAddress,
        AccountTier tier
    );

    event AccountUpdated(
        address indexed owner,
        bytes32 newPublicKeyHash,
        address[] newRelays
    );

    event AccountStatusChanged(
        address indexed owner,
        AccountStatus oldStatus,
        AccountStatus newStatus,
        string reason
    );

    event AccountTierChanged(
        address indexed owner,
        AccountTier oldTier,
        AccountTier newTier,
        uint256 stakedAmount
    );

    event PublicKeyRotated(
        address indexed owner,
        bytes32 oldKeyHash,
        bytes32 newKeyHash
    );

    event QuotaUpdated(
        address indexed owner,
        uint256 used,
        uint256 limit
    );

    event ConfigUpdated(
        address indexed owner,
        bool allowExternalInbound,
        bool allowExternalOutbound
    );

    // ============ Registration ============

    /**
     * @notice Register a new email account
     * @param jnsNode JNS name node (must be owned by caller)
     * @param publicKeyHash Hash of the encryption public key
     * @param preferredRelays Array of preferred relay addresses
     */
    function register(
        bytes32 jnsNode,
        bytes32 publicKeyHash,
        address[] calldata preferredRelays
    ) external;

    /**
     * @notice Register with staking for external network access
     * @param jnsNode JNS name node
     * @param publicKeyHash Hash of the encryption public key
     * @param preferredRelays Array of preferred relay addresses
     */
    function registerWithStake(
        bytes32 jnsNode,
        bytes32 publicKeyHash,
        address[] calldata preferredRelays
    ) external payable;

    // ============ Account Management ============

    /**
     * @notice Update account configuration
     * @param newPublicKeyHash New encryption key hash (for rotation)
     * @param newRelays New preferred relay addresses
     */
    function updateAccount(
        bytes32 newPublicKeyHash,
        address[] calldata newRelays
    ) external;

    /**
     * @notice Stake tokens to upgrade to staked tier
     */
    function stake() external payable;

    /**
     * @notice Unstake tokens (returns to free tier)
     * @dev Subject to cooldown period
     */
    function unstake() external;

    /**
     * @notice Update email configuration
     * @param config New configuration
     */
    function setConfig(EmailConfig calldata config) external;

    /**
     * @notice Deactivate account (soft delete)
     */
    function deactivate() external;

    // ============ Moderation ============

    /**
     * @notice Suspend an account (moderator only)
     * @param owner Account to suspend
     * @param reason Suspension reason
     */
    function suspendAccount(address owner, string calldata reason) external;

    /**
     * @notice Ban an account (moderator only)
     * @param owner Account to ban
     * @param reason Ban reason
     */
    function banAccount(address owner, string calldata reason) external;

    /**
     * @notice Restore a suspended account (moderator only)
     * @param owner Account to restore
     */
    function restoreAccount(address owner) external;

    // ============ Usage Tracking ============

    /**
     * @notice Record email sent (relay node only)
     * @param sender Sender address
     * @param sizeBytes Email size in bytes
     * @param isExternal Whether sent to external network
     */
    function recordEmailSent(
        address sender,
        uint256 sizeBytes,
        bool isExternal
    ) external;

    /**
     * @notice Record storage used (relay node only)
     * @param owner Account owner
     * @param deltaBytes Change in storage (positive or negative)
     */
    function recordStorageChange(
        address owner,
        int256 deltaBytes
    ) external;

    // ============ View Functions ============

    /**
     * @notice Get account details
     * @param owner Account owner
     * @return account Account struct
     */
    function getAccount(address owner) external view returns (EmailAccount memory account);

    /**
     * @notice Get account by JNS node
     * @param jnsNode JNS name node
     * @return account Account struct
     */
    function getAccountByJNS(bytes32 jnsNode) external view returns (EmailAccount memory account);

    /**
     * @notice Get email configuration
     * @param owner Account owner
     * @return config Configuration struct
     */
    function getConfig(address owner) external view returns (EmailConfig memory config);

    /**
     * @notice Check if account can send external email
     * @param owner Account owner
     * @return canSend Whether account can send external email
     */
    function canSendExternal(address owner) external view returns (bool canSend);

    /**
     * @notice Check if account can receive email
     * @param owner Account owner
     * @return canReceive Whether account can receive email
     */
    function canReceive(address owner) external view returns (bool canReceive);

    /**
     * @notice Get rate limit status
     * @param owner Account owner
     * @return sent Emails sent today
     * @return limit Daily limit
     * @return resetsAt Timestamp when limit resets
     */
    function getRateLimit(address owner) external view returns (
        uint256 sent,
        uint256 limit,
        uint256 resetsAt
    );

    /**
     * @notice Get storage quota status
     * @param owner Account owner
     * @return used Storage used in bytes
     * @return limit Storage limit in bytes
     */
    function getQuota(address owner) external view returns (
        uint256 used,
        uint256 limit
    );

    /**
     * @notice Resolve email address to public key
     * @param emailAddress Full email address (e.g., alice@jeju.mail)
     * @return publicKeyHash Encryption public key hash
     * @return preferredRelays Preferred relay addresses
     */
    function resolveEmail(string calldata emailAddress) external view returns (
        bytes32 publicKeyHash,
        address[] memory preferredRelays
    );
}
