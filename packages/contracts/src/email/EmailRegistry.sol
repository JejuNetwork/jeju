// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IEmailRegistry} from "./IEmailRegistry.sol";

interface IJNS {
    function owner(bytes32 node) external view returns (address);
}

interface IBanManager {
    function isAddressBanned(address target) external view returns (bool);
    function applyAddressBan(address target, bytes32 caseId, string calldata reason) external;
}

interface IEmailProviderStaking {
    function isActiveRelay(address relay) external view returns (bool);
}

/**
 * @title EmailRegistry
 * @notice Decentralized email account registry for Jeju Network
 * @dev Integrates with JNS, staking, and moderation systems
 *
 * Key features:
 * - Free tier: Intra-network email only, easier to ban
 * - Staked tier: External network access, moderation protection
 * - MPC key integration for E2E encryption
 * - Rate limiting and quota management
 * - Integration with ModerationMarketplace for disputes
 */
contract EmailRegistry is IEmailRegistry, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant MIN_STAKE = 0.1 ether;
    uint256 public constant UNSTAKE_COOLDOWN = 7 days;
    uint256 public constant RATE_LIMIT_PERIOD = 1 days;

    // Quota limits by tier (in bytes)
    uint256 public constant FREE_QUOTA = 100 * 1024 * 1024; // 100 MB
    uint256 public constant STAKED_QUOTA = 1024 * 1024 * 1024; // 1 GB
    uint256 public constant PREMIUM_QUOTA = 10 * 1024 * 1024 * 1024; // 10 GB

    // Rate limits by tier (emails per day)
    uint256 public constant FREE_RATE_LIMIT = 50;
    uint256 public constant STAKED_RATE_LIMIT = 500;
    uint256 public constant PREMIUM_RATE_LIMIT = 5000;

    // ============ State ============

    /// @notice JNS registry for name ownership verification
    IJNS public immutable jns;

    /// @notice Ban manager for moderation integration
    IBanManager public banManager;

    /// @notice Email provider staking contract
    IEmailProviderStaking public providerStaking;

    /// @notice Email domain (e.g., "jeju.mail")
    string public emailDomain;

    /// @notice Accounts by owner address
    mapping(address => EmailAccount) private _accounts;

    /// @notice Account configs by owner address
    mapping(address => EmailConfig) private _configs;

    /// @notice JNS node to owner mapping
    mapping(bytes32 => address) private _jnsToOwner;

    /// @notice Pending unstake requests
    mapping(address => uint256) public unstakeRequestTime;

    /// @notice Authorized relay nodes (can record usage)
    mapping(address => bool) public authorizedRelays;

    /// @notice Total registered accounts
    uint256 public totalAccounts;

    /// @notice Total staked value
    uint256 public totalStaked;

    // ============ Errors ============

    error AlreadyRegistered();
    error NotRegistered();
    error NotJNSOwner();
    error AccountBanned();
    error AccountSuspended();
    error AccountInactive();
    error InsufficientStake();
    error StakeTooSoon();
    error UnstakeCooldownActive();
    error NotAuthorizedRelay();
    error RateLimitExceeded();
    error QuotaExceeded();
    error ExternalNotAllowed();
    error InvalidAddress();
    error InvalidConfig();

    // ============ Modifiers ============

    modifier onlyActiveAccount() {
        EmailAccount storage account = _accounts[msg.sender];
        if (account.status == AccountStatus.INACTIVE) revert NotRegistered();
        if (account.status == AccountStatus.BANNED) revert AccountBanned();
        if (account.status == AccountStatus.SUSPENDED) revert AccountSuspended();
        _;
    }

    modifier onlyAuthorizedRelay() {
        if (
            !authorizedRelays[msg.sender]
                && (address(providerStaking) == address(0) || !providerStaking.isActiveRelay(msg.sender))
        ) {
            revert NotAuthorizedRelay();
        }
        _;
    }

    // ============ Constructor ============

    constructor(address _jns, address _banManager, string memory _emailDomain, address initialOwner)
        Ownable(initialOwner)
    {
        if (_jns == address(0)) revert InvalidAddress();
        jns = IJNS(_jns);
        banManager = IBanManager(_banManager);
        emailDomain = _emailDomain;
    }

    // ============ Registration ============

    /**
     * @notice Register a new email account (free tier)
     */
    function register(bytes32 jnsNode, bytes32 publicKeyHash, address[] calldata preferredRelays)
        external
        override
        whenNotPaused
        nonReentrant
    {
        _register(jnsNode, publicKeyHash, preferredRelays, AccountTier.FREE, 0);
    }

    /**
     * @notice Register with staking for external network access
     */
    function registerWithStake(bytes32 jnsNode, bytes32 publicKeyHash, address[] calldata preferredRelays)
        external
        payable
        override
        whenNotPaused
        nonReentrant
    {
        if (msg.value < MIN_STAKE) revert InsufficientStake();
        _register(jnsNode, publicKeyHash, preferredRelays, AccountTier.STAKED, msg.value);
    }

    function _register(
        bytes32 jnsNode,
        bytes32 publicKeyHash,
        address[] calldata preferredRelays,
        AccountTier tier,
        uint256 stakeAmount
    ) internal {
        if (_accounts[msg.sender].status != AccountStatus.INACTIVE) revert AlreadyRegistered();
        if (jns.owner(jnsNode) != msg.sender) revert NotJNSOwner();
        if (address(banManager) != address(0) && banManager.isAddressBanned(msg.sender)) revert AccountBanned();

        uint256 quotaLimit =
            tier == AccountTier.FREE ? FREE_QUOTA : tier == AccountTier.STAKED ? STAKED_QUOTA : PREMIUM_QUOTA;

        _accounts[msg.sender] = EmailAccount({
            owner: msg.sender,
            publicKeyHash: publicKeyHash,
            jnsNode: jnsNode,
            status: AccountStatus.ACTIVE,
            tier: tier,
            stakedAmount: stakeAmount,
            quotaUsedBytes: 0,
            quotaLimitBytes: quotaLimit,
            emailsSentToday: 0,
            lastResetTimestamp: block.timestamp,
            createdAt: block.timestamp,
            lastActivityAt: block.timestamp,
            preferredRelays: preferredRelays
        });

        _configs[msg.sender] = EmailConfig({
            allowExternalInbound: true,
            allowExternalOutbound: tier != AccountTier.FREE,
            encryptionRequired: false,
            spamFilterLevel: 2, // Medium
            autoForwardAddress: ""
        });

        _jnsToOwner[jnsNode] = msg.sender;
        totalAccounts++;
        totalStaked += stakeAmount;

        // Derive email address from JNS node (simplified - actual implementation needs JNS label resolution)
        string memory emailAddress = string(abi.encodePacked("user@", emailDomain));

        emit AccountRegistered(msg.sender, jnsNode, emailAddress, tier);
    }

    // ============ Account Management ============

    /**
     * @notice Update account configuration
     */
    function updateAccount(bytes32 newPublicKeyHash, address[] calldata newRelays)
        external
        override
        onlyActiveAccount
        whenNotPaused
    {
        EmailAccount storage account = _accounts[msg.sender];

        bytes32 oldKeyHash = account.publicKeyHash;
        account.publicKeyHash = newPublicKeyHash;
        account.preferredRelays = newRelays;
        account.lastActivityAt = block.timestamp;

        emit AccountUpdated(msg.sender, newPublicKeyHash, newRelays);

        if (oldKeyHash != newPublicKeyHash) {
            emit PublicKeyRotated(msg.sender, oldKeyHash, newPublicKeyHash);
        }
    }

    /**
     * @notice Stake tokens to upgrade to staked tier
     */
    function stake() external payable override onlyActiveAccount whenNotPaused nonReentrant {
        if (msg.value < MIN_STAKE) revert InsufficientStake();

        EmailAccount storage account = _accounts[msg.sender];
        AccountTier oldTier = account.tier;

        account.stakedAmount += msg.value;
        totalStaked += msg.value;

        // Upgrade tier if needed
        if (account.tier == AccountTier.FREE) {
            account.tier = AccountTier.STAKED;
            account.quotaLimitBytes = STAKED_QUOTA;
            _configs[msg.sender].allowExternalOutbound = true;
        }

        account.lastActivityAt = block.timestamp;

        emit AccountTierChanged(msg.sender, oldTier, account.tier, account.stakedAmount);
    }

    /**
     * @notice Request unstake (starts cooldown)
     */
    function requestUnstake() external onlyActiveAccount {
        EmailAccount storage account = _accounts[msg.sender];
        if (account.stakedAmount == 0) revert InsufficientStake();
        if (unstakeRequestTime[msg.sender] != 0) revert UnstakeCooldownActive();

        unstakeRequestTime[msg.sender] = block.timestamp;
    }

    /**
     * @notice Complete unstake after cooldown
     */
    function unstake() external override onlyActiveAccount nonReentrant {
        EmailAccount storage account = _accounts[msg.sender];

        uint256 requestTime = unstakeRequestTime[msg.sender];
        if (requestTime == 0) revert StakeTooSoon();
        if (block.timestamp < requestTime + UNSTAKE_COOLDOWN) revert UnstakeCooldownActive();

        uint256 amount = account.stakedAmount;
        AccountTier oldTier = account.tier;

        account.stakedAmount = 0;
        account.tier = AccountTier.FREE;
        account.quotaLimitBytes = FREE_QUOTA;
        _configs[msg.sender].allowExternalOutbound = false;

        totalStaked -= amount;
        delete unstakeRequestTime[msg.sender];

        (bool success,) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        emit AccountTierChanged(msg.sender, oldTier, AccountTier.FREE, 0);
    }

    /**
     * @notice Update email configuration
     */
    function setConfig(EmailConfig calldata config) external override onlyActiveAccount {
        EmailAccount storage account = _accounts[msg.sender];

        // Only staked accounts can enable external outbound
        if (config.allowExternalOutbound && account.tier == AccountTier.FREE) {
            revert ExternalNotAllowed();
        }

        _configs[msg.sender] = config;
        account.lastActivityAt = block.timestamp;

        emit ConfigUpdated(msg.sender, config.allowExternalInbound, config.allowExternalOutbound);
    }

    /**
     * @notice Deactivate account
     */
    function deactivate() external override onlyActiveAccount nonReentrant {
        EmailAccount storage account = _accounts[msg.sender];

        // Return staked amount
        if (account.stakedAmount > 0) {
            uint256 amount = account.stakedAmount;
            account.stakedAmount = 0;
            totalStaked -= amount;

            (bool success,) = msg.sender.call{value: amount}("");
            require(success, "Transfer failed");
        }

        account.status = AccountStatus.INACTIVE;
        delete _jnsToOwner[account.jnsNode];
        totalAccounts--;

        emit AccountStatusChanged(msg.sender, AccountStatus.ACTIVE, AccountStatus.INACTIVE, "User deactivated");
    }

    // ============ Moderation ============

    /**
     * @notice Suspend an account
     */
    function suspendAccount(address owner_, string calldata reason) external override onlyOwner {
        EmailAccount storage account = _accounts[owner_];
        if (account.status == AccountStatus.INACTIVE) revert NotRegistered();

        AccountStatus oldStatus = account.status;
        account.status = AccountStatus.SUSPENDED;

        emit AccountStatusChanged(owner_, oldStatus, AccountStatus.SUSPENDED, reason);
    }

    /**
     * @notice Ban an account
     */
    function banAccount(address owner_, string calldata reason) external override onlyOwner {
        EmailAccount storage account = _accounts[owner_];
        if (account.status == AccountStatus.INACTIVE) revert NotRegistered();

        AccountStatus oldStatus = account.status;
        account.status = AccountStatus.BANNED;

        // Slash staked amount
        if (account.stakedAmount > 0) {
            uint256 slashedAmount = account.stakedAmount;
            account.stakedAmount = 0;
            totalStaked -= slashedAmount;
            // Slashed funds go to treasury (owner)
        }

        emit AccountStatusChanged(owner_, oldStatus, AccountStatus.BANNED, reason);

        // Notify ban manager if configured
        if (address(banManager) != address(0)) {
            banManager.applyAddressBan(
                owner_, keccak256(abi.encodePacked("EMAIL_BAN", owner_, block.timestamp)), reason
            );
        }
    }

    /**
     * @notice Restore a suspended account
     */
    function restoreAccount(address owner_) external override onlyOwner {
        EmailAccount storage account = _accounts[owner_];
        if (account.status != AccountStatus.SUSPENDED) revert AccountInactive();

        account.status = AccountStatus.ACTIVE;

        emit AccountStatusChanged(owner_, AccountStatus.SUSPENDED, AccountStatus.ACTIVE, "Restored by moderator");
    }

    // ============ Usage Tracking ============

    /**
     * @notice Record email sent
     */
    function recordEmailSent(address sender, uint256 sizeBytes, bool isExternal)
        external
        override
        onlyAuthorizedRelay
    {
        EmailAccount storage account = _accounts[sender];
        if (account.status != AccountStatus.ACTIVE) revert AccountInactive();

        // Check external permission
        if (isExternal && !_configs[sender].allowExternalOutbound) {
            revert ExternalNotAllowed();
        }

        // Reset rate limit if needed
        if (block.timestamp >= account.lastResetTimestamp + RATE_LIMIT_PERIOD) {
            account.emailsSentToday = 0;
            account.lastResetTimestamp = block.timestamp;
        }

        // Check rate limit
        uint256 limit = account.tier == AccountTier.FREE
            ? FREE_RATE_LIMIT
            : account.tier == AccountTier.STAKED ? STAKED_RATE_LIMIT : PREMIUM_RATE_LIMIT;
        if (account.emailsSentToday >= limit) {
            revert RateLimitExceeded();
        }

        account.emailsSentToday++;
        account.quotaUsedBytes += sizeBytes;
        account.lastActivityAt = block.timestamp;

        if (account.quotaUsedBytes > account.quotaLimitBytes) {
            revert QuotaExceeded();
        }
    }

    /**
     * @notice Record storage change
     */
    function recordStorageChange(address owner_, int256 deltaBytes) external override onlyAuthorizedRelay {
        EmailAccount storage account = _accounts[owner_];
        if (account.status == AccountStatus.INACTIVE) revert NotRegistered();

        if (deltaBytes > 0) {
            account.quotaUsedBytes += uint256(deltaBytes);
            if (account.quotaUsedBytes > account.quotaLimitBytes) {
                revert QuotaExceeded();
            }
        } else {
            uint256 decrease = uint256(-deltaBytes);
            if (decrease > account.quotaUsedBytes) {
                account.quotaUsedBytes = 0;
            } else {
                account.quotaUsedBytes -= decrease;
            }
        }

        account.lastActivityAt = block.timestamp;

        emit QuotaUpdated(owner_, account.quotaUsedBytes, account.quotaLimitBytes);
    }

    // ============ View Functions ============

    function getAccount(address owner_) external view override returns (EmailAccount memory) {
        return _accounts[owner_];
    }

    function getAccountByJNS(bytes32 jnsNode) external view override returns (EmailAccount memory) {
        address owner_ = _jnsToOwner[jnsNode];
        return _accounts[owner_];
    }

    function getConfig(address owner_) external view override returns (EmailConfig memory) {
        return _configs[owner_];
    }

    function canSendExternal(address owner_) external view override returns (bool) {
        EmailAccount storage account = _accounts[owner_];
        if (account.status != AccountStatus.ACTIVE) return false;
        return _configs[owner_].allowExternalOutbound;
    }

    function canReceive(address owner_) external view override returns (bool) {
        EmailAccount storage account = _accounts[owner_];
        return account.status == AccountStatus.ACTIVE;
    }

    function getRateLimit(address owner_)
        external
        view
        override
        returns (uint256 sent, uint256 limit, uint256 resetsAt)
    {
        EmailAccount storage account = _accounts[owner_];
        sent = account.emailsSentToday;
        limit = account.tier == AccountTier.FREE
            ? FREE_RATE_LIMIT
            : account.tier == AccountTier.STAKED ? STAKED_RATE_LIMIT : PREMIUM_RATE_LIMIT;
        resetsAt = account.lastResetTimestamp + RATE_LIMIT_PERIOD;
    }

    function getQuota(address owner_) external view override returns (uint256 used, uint256 limit) {
        EmailAccount storage account = _accounts[owner_];
        return (account.quotaUsedBytes, account.quotaLimitBytes);
    }

    function resolveEmail(string calldata /* emailAddress */ )
        external
        view
        override
        returns (bytes32 publicKeyHash, address[] memory preferredRelays)
    {
        // TODO: Parse email address and resolve via JNS
        // For now, return empty (actual implementation needs JNS label parsing)
        return (bytes32(0), new address[](0));
    }

    // ============ Admin Functions ============

    function setBanManager(address _banManager) external onlyOwner {
        banManager = IBanManager(_banManager);
    }

    function setProviderStaking(address _providerStaking) external onlyOwner {
        providerStaking = IEmailProviderStaking(_providerStaking);
    }

    function setAuthorizedRelay(address relay, bool authorized) external onlyOwner {
        authorizedRelays[relay] = authorized;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function withdrawSlashedFunds() external onlyOwner {
        uint256 balance = address(this).balance - totalStaked;
        if (balance > 0) {
            (bool success,) = owner().call{value: balance}("");
            require(success, "Transfer failed");
        }
    }

    receive() external payable {}
}
