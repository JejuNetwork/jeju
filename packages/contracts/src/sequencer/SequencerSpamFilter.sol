// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {RateLimiter} from "../libraries/RateLimiter.sol";

/**
 * @title SequencerSpamFilter
 * @author Jeju Network
 * @notice Mempool-level spam filtering for sequencer transactions
 * @dev Provides transaction filtering and prioritization for sequencers
 *
 * Features:
 * - Transaction rate limiting per sender
 * - Priority fee enforcement during congestion
 * - Duplicate transaction detection
 * - Sender reputation tracking
 * - Blacklist/whitelist management
 * - Congestion-based throttling
 * - Gas price floor enforcement
 */
contract SequencerSpamFilter is Ownable {
    using RateLimiter for RateLimiter.TokenBucket;
    using RateLimiter for RateLimiter.AdaptiveCooldown;
    using RateLimiter for RateLimiter.GlobalLimit;

    // ============ Errors ============
    error SenderIsBlacklisted(address sender);
    error DuplicateTransaction(bytes32 txHash);
    error GasPriceTooLow(uint256 provided, uint256 minimum);
    error SenderRateLimited(address sender, uint256 cooldownRemaining);
    error SequencerNotAuthorized();
    error InvalidConfiguration();
    error CongestionThrottled();
    error NonceGap(uint256 expected, uint256 provided);
    error TransactionTooLarge(uint256 size, uint256 maximum);

    // ============ Events ============
    event TransactionFiltered(bytes32 indexed txHash, address indexed sender, string reason);
    event SenderBlacklisted(address indexed sender, string reason);
    event SenderWhitelisted(address indexed sender);
    event CongestionModeEnabled(uint256 threshold);
    event CongestionModeDisabled();
    event SenderReputationUpdated(address indexed sender, int256 change, int256 newScore);
    event SpamDetected(address indexed sender, uint256 count);
    event ConfigurationUpdated();

    // ============ Structs ============

    struct FilterConfig {
        uint256 maxTxPerBlock;              // Max transactions per sender per block
        uint256 maxTxPerMinute;             // Max transactions per sender per minute
        uint256 minGasPrice;                // Minimum gas price (wei)
        uint256 congestionGasMultiplier;    // Gas price multiplier during congestion (basis points)
        uint256 maxTxSize;                  // Maximum transaction size (bytes)
        uint256 maxNonceGap;                // Maximum allowed nonce gap
        uint256 reputationDecayPeriod;      // Period for reputation decay
        int256 initialReputation;           // Starting reputation for new senders
        int256 minReputation;               // Minimum reputation (below = blacklisted)
        bool enforcePriorityFee;            // Whether to enforce priority fees
    }

    struct SenderInfo {
        int256 reputation;                  // Reputation score
        uint256 lastTxBlock;                // Last transaction block
        uint256 txInCurrentBlock;           // Transactions in current block
        uint256 totalTxCount;               // Total transactions
        uint256 spamCount;                  // Detected spam attempts
        uint256 lastNonce;                  // Last seen nonce
        uint256 firstSeenBlock;             // First activity block
        bool isBlacklisted;
        bool isWhitelisted;
    }

    struct CongestionState {
        bool isActive;
        uint256 activatedAt;
        uint256 pendingTxCount;
        uint256 congestionThreshold;
        uint256 minPriorityFee;
    }

    // ============ State ============

    /// @notice Filter configuration
    FilterConfig public config;

    /// @notice Sender information
    mapping(address => SenderInfo) public senders;

    /// @notice Per-sender rate limiters
    mapping(address => RateLimiter.TokenBucket) private _senderRateLimits;

    /// @notice Per-sender cooldowns
    mapping(address => RateLimiter.AdaptiveCooldown) private _senderCooldowns;

    /// @notice Global transaction rate limit
    RateLimiter.GlobalLimit private _globalRateLimit;

    /// @notice Seen transaction hashes (for duplicate detection)
    mapping(bytes32 => bool) public seenTxHashes;

    /// @notice Congestion state
    CongestionState public congestion;

    /// @notice Authorized sequencers
    mapping(address => bool) public authorizedSequencers;

    /// @notice Recent tx hashes cleanup index
    bytes32[] private _recentTxHashes;
    uint256 private _txHashCleanupIndex;
    uint256 public constant MAX_TX_HASH_HISTORY = 10000;

    // ============ Modifiers ============

    modifier onlySequencer() {
        if (!authorizedSequencers[msg.sender]) revert SequencerNotAuthorized();
        _;
    }

    // ============ Constructor ============

    constructor(address _owner) Ownable(_owner) {
        config = FilterConfig({
            maxTxPerBlock: 10,
            maxTxPerMinute: 100,
            minGasPrice: 1 gwei,
            congestionGasMultiplier: 15000,  // 1.5x during congestion
            maxTxSize: 128 * 1024,           // 128 KB
            maxNonceGap: 10,
            reputationDecayPeriod: 1 days,
            initialReputation: 100,
            minReputation: -50,
            enforcePriorityFee: true
        });

        congestion = CongestionState({
            isActive: false,
            activatedAt: 0,
            pendingTxCount: 0,
            congestionThreshold: 1000,
            minPriorityFee: 1 gwei
        });

        // Initialize global rate limit (10000 tx per minute globally)
        _globalRateLimit.init(10000, 60);
    }

    // ============ Transaction Filtering ============

    /**
     * @notice Filter a transaction before inclusion
     * @param sender Transaction sender
     * @param txHash Transaction hash
     * @param gasPrice Gas price offered
     * @param priorityFee Priority fee offered
     * @param txSize Transaction size in bytes
     * @param nonce Transaction nonce
     * @return allowed Whether transaction should be included
     * @return reason Rejection reason (empty if allowed)
     */
    function filterTransaction(
        address sender,
        bytes32 txHash,
        uint256 gasPrice,
        uint256 priorityFee,
        uint256 txSize,
        uint256 nonce
    ) external onlySequencer returns (bool allowed, string memory reason) {
        // Check blacklist/whitelist
        SenderInfo storage info = senders[sender];
        
        if (info.isBlacklisted) {
            emit TransactionFiltered(txHash, sender, "blacklisted");
            return (false, "sender blacklisted");
        }

        // Whitelisted senders bypass most checks
        if (info.isWhitelisted) {
            _recordTransaction(sender, txHash, nonce);
            return (true, "");
        }

        // Check duplicate
        if (seenTxHashes[txHash]) {
            emit TransactionFiltered(txHash, sender, "duplicate");
            return (false, "duplicate transaction");
        }

        // Check transaction size
        if (txSize > config.maxTxSize) {
            emit TransactionFiltered(txHash, sender, "too_large");
            return (false, "transaction too large");
        }

        // Check gas price
        uint256 requiredGasPrice = _getRequiredGasPrice();
        if (gasPrice < requiredGasPrice) {
            emit TransactionFiltered(txHash, sender, "gas_too_low");
            return (false, "gas price too low");
        }

        // Check priority fee during congestion
        if (congestion.isActive && config.enforcePriorityFee) {
            if (priorityFee < congestion.minPriorityFee) {
                emit TransactionFiltered(txHash, sender, "priority_too_low");
                return (false, "priority fee too low during congestion");
            }
        }

        // Check nonce gap
        if (info.totalTxCount > 0 && nonce > info.lastNonce + config.maxNonceGap) {
            emit TransactionFiltered(txHash, sender, "nonce_gap");
            return (false, "nonce gap too large");
        }

        // Check rate limits
        (bool rateLimitOk, string memory rateLimitReason) = _checkRateLimits(sender);
        if (!rateLimitOk) {
            emit TransactionFiltered(txHash, sender, rateLimitReason);
            return (false, rateLimitReason);
        }

        // Check per-block limit
        if (info.lastTxBlock == block.number) {
            if (info.txInCurrentBlock >= config.maxTxPerBlock) {
                _handleSpamAttempt(sender);
                emit TransactionFiltered(txHash, sender, "block_limit");
                return (false, "per-block limit exceeded");
            }
        }

        // All checks passed
        _recordTransaction(sender, txHash, nonce);
        return (true, "");
    }

    /**
     * @notice Batch filter multiple transactions
     * @param txData Array of transaction data
     * @return results Array of (allowed, reason) tuples
     */
    function filterTransactionBatch(
        TxFilterInput[] calldata txData
    ) external onlySequencer returns (FilterResult[] memory results) {
        results = new FilterResult[](txData.length);
        
        for (uint256 i = 0; i < txData.length; i++) {
            (bool allowed, string memory reason) = this.filterTransaction(
                txData[i].sender,
                txData[i].txHash,
                txData[i].gasPrice,
                txData[i].priorityFee,
                txData[i].txSize,
                txData[i].nonce
            );
            results[i] = FilterResult({allowed: allowed, reason: reason});
        }
    }

    struct TxFilterInput {
        address sender;
        bytes32 txHash;
        uint256 gasPrice;
        uint256 priorityFee;
        uint256 txSize;
        uint256 nonce;
    }

    struct FilterResult {
        bool allowed;
        string reason;
    }

    // ============ Internal Functions ============

    /**
     * @notice Get required gas price based on congestion
     */
    function _getRequiredGasPrice() internal view returns (uint256) {
        if (!congestion.isActive) {
            return config.minGasPrice;
        }
        return (config.minGasPrice * config.congestionGasMultiplier) / 10000;
    }

    /**
     * @notice Check rate limits for sender
     */
    function _checkRateLimits(address sender) internal returns (bool ok, string memory reason) {
        // Initialize if needed
        RateLimiter.TokenBucket storage bucket = _senderRateLimits[sender];
        if (bucket.capacity == 0) {
            bucket.init(config.maxTxPerMinute, config.maxTxPerMinute / 60);
        }

        RateLimiter.AdaptiveCooldown storage cooldown = _senderCooldowns[sender];
        if (cooldown.baseCooldown == 0) {
            cooldown.init(60, 3600, config.reputationDecayPeriod);
        }

        // Check cooldown
        if (cooldown.isInCooldown()) {
            return (false, "sender in cooldown");
        }

        // Check global limit
        if (!_globalRateLimit.consume()) {
            return (false, "global rate limit");
        }

        // Check sender limit
        if (!bucket.consume(1)) {
            cooldown.recordViolation();
            return (false, "sender rate limit");
        }

        return (true, "");
    }

    /**
     * @notice Record a successful transaction
     */
    function _recordTransaction(address sender, bytes32 txHash, uint256 nonce) internal {
        SenderInfo storage info = senders[sender];

        // Initialize sender if first time
        if (info.firstSeenBlock == 0) {
            info.firstSeenBlock = block.number;
            info.reputation = config.initialReputation;
        }

        // Update per-block tracking
        if (info.lastTxBlock != block.number) {
            info.lastTxBlock = block.number;
            info.txInCurrentBlock = 1;
        } else {
            info.txInCurrentBlock++;
        }

        info.totalTxCount++;
        info.lastNonce = nonce;

        // Record tx hash for duplicate detection
        seenTxHashes[txHash] = true;
        _recentTxHashes.push(txHash);

        // Cleanup old hashes if needed
        if (_recentTxHashes.length > MAX_TX_HASH_HISTORY) {
            // Remove oldest entries
            uint256 toRemove = _recentTxHashes.length - MAX_TX_HASH_HISTORY;
            for (uint256 i = 0; i < toRemove && _txHashCleanupIndex < _recentTxHashes.length; i++) {
                delete seenTxHashes[_recentTxHashes[_txHashCleanupIndex]];
                _txHashCleanupIndex++;
            }
        }

        // Positive reputation for successful tx
        _updateReputation(sender, 1);
    }

    /**
     * @notice Handle spam attempt
     */
    function _handleSpamAttempt(address sender) internal {
        SenderInfo storage info = senders[sender];
        info.spamCount++;

        // Decrease reputation
        _updateReputation(sender, -10);

        emit SpamDetected(sender, info.spamCount);

        // Auto-blacklist if reputation too low
        if (info.reputation <= config.minReputation) {
            info.isBlacklisted = true;
            emit SenderBlacklisted(sender, "reputation too low");
        }
    }

    /**
     * @notice Update sender reputation
     */
    function _updateReputation(address sender, int256 change) internal {
        SenderInfo storage info = senders[sender];
        int256 oldReputation = info.reputation;
        info.reputation += change;
        emit SenderReputationUpdated(sender, change, info.reputation);
    }

    // ============ Congestion Management ============

    /**
     * @notice Report current pending transaction count
     * @param pendingCount Number of pending transactions
     */
    function reportPendingTxCount(uint256 pendingCount) external onlySequencer {
        congestion.pendingTxCount = pendingCount;

        if (pendingCount >= congestion.congestionThreshold && !congestion.isActive) {
            congestion.isActive = true;
            congestion.activatedAt = block.timestamp;
            emit CongestionModeEnabled(pendingCount);
        } else if (pendingCount < congestion.congestionThreshold / 2 && congestion.isActive) {
            congestion.isActive = false;
            emit CongestionModeDisabled();
        }
    }

    // ============ Admin Functions ============

    /**
     * @notice Update filter configuration
     */
    function setConfig(FilterConfig calldata newConfig) external onlyOwner {
        if (newConfig.maxTxPerBlock == 0 || newConfig.maxTxPerMinute == 0) {
            revert InvalidConfiguration();
        }
        config = newConfig;
        emit ConfigurationUpdated();
    }

    /**
     * @notice Set congestion parameters
     */
    function setCongestionParams(
        uint256 threshold,
        uint256 minPriorityFee
    ) external onlyOwner {
        congestion.congestionThreshold = threshold;
        congestion.minPriorityFee = minPriorityFee;
    }

    /**
     * @notice Add authorized sequencer
     */
    function addSequencer(address sequencer) external onlyOwner {
        authorizedSequencers[sequencer] = true;
    }

    /**
     * @notice Remove authorized sequencer
     */
    function removeSequencer(address sequencer) external onlyOwner {
        authorizedSequencers[sequencer] = false;
    }

    /**
     * @notice Blacklist a sender
     */
    function blacklistSender(address sender, string calldata reason) external onlyOwner {
        senders[sender].isBlacklisted = true;
        senders[sender].isWhitelisted = false;
        emit SenderBlacklisted(sender, reason);
    }

    /**
     * @notice Whitelist a sender
     */
    function whitelistSender(address sender) external onlyOwner {
        senders[sender].isWhitelisted = true;
        senders[sender].isBlacklisted = false;
        emit SenderWhitelisted(sender);
    }

    /**
     * @notice Remove sender from blacklist
     */
    function unblacklistSender(address sender) external onlyOwner {
        senders[sender].isBlacklisted = false;
        senders[sender].reputation = config.initialReputation;
    }

    /**
     * @notice Reset sender reputation
     */
    function resetSenderReputation(address sender) external onlyOwner {
        senders[sender].reputation = config.initialReputation;
        senders[sender].spamCount = 0;
        
        RateLimiter.AdaptiveCooldown storage cooldown = _senderCooldowns[sender];
        if (cooldown.baseCooldown > 0) {
            cooldown.resetViolations();
        }
    }

    // ============ View Functions ============

    /**
     * @notice Get sender statistics
     */
    function getSenderStats(address sender) external view returns (
        int256 reputation,
        uint256 totalTxCount,
        uint256 spamCount,
        bool isBlacklisted,
        bool isWhitelisted,
        uint256 txInCurrentBlock
    ) {
        SenderInfo storage info = senders[sender];
        return (
            info.reputation,
            info.totalTxCount,
            info.spamCount,
            info.isBlacklisted,
            info.isWhitelisted,
            info.lastTxBlock == block.number ? info.txInCurrentBlock : 0
        );
    }

    /**
     * @notice Check if sender can submit transaction
     */
    function canSubmit(address sender) external view returns (bool) {
        SenderInfo storage info = senders[sender];
        
        if (info.isBlacklisted) return false;
        if (info.isWhitelisted) return true;
        
        if (info.lastTxBlock == block.number && 
            info.txInCurrentBlock >= config.maxTxPerBlock) {
            return false;
        }

        RateLimiter.AdaptiveCooldown storage cooldown = _senderCooldowns[sender];
        if (cooldown.baseCooldown > 0 && cooldown.isInCooldown()) {
            return false;
        }

        return true;
    }

    /**
     * @notice Get current required gas price
     */
    function getRequiredGasPrice() external view returns (uint256) {
        return _getRequiredGasPrice();
    }
}

