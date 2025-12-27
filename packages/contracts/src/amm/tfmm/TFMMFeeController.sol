// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ITFMMPool} from "./ITFMMPool.sol";

/**
 * @title TFMMFeeController
 * @author Jeju Network
 * @notice Governance-controlled fee management for TFMM pools
 * @dev Integrates with Jeju CEO/Council/Governor for fee changes
 *
 * Features:
 * - Tiered fee structure based on pool type
 * - Fee caps enforced on-chain
 * - Time-delayed fee changes for transparency
 * - Integration with governance (Governor, Council, CEO)
 */
contract TFMMFeeController is Ownable {
    // ============ Enums ============

    enum PoolTier {
        STANDARD, // Normal pools
        STABLE, // Stablecoin pools (lower fees)
        PREMIUM, // Actively managed pools (higher fees)
        EXPERIMENTAL // New strategy pools

    }

    // ============ Structs ============

    struct FeeConfig {
        uint256 swapFeeBps; // Swap fee in bps
        uint256 protocolFeeBps; // Protocol share of swap fee
        uint256 managementFeeBps; // Annual management fee (for TFMM)
        uint256 performanceFeeBps; // Performance fee on profits
    }

    struct PendingFeeChange {
        uint256 newSwapFeeBps;
        uint256 newProtocolFeeBps;
        uint256 executeAfter;
        bool exists;
    }

    // ============ State Variables ============

    /// @notice Default fee configs by tier
    mapping(PoolTier => FeeConfig) public tierFees;

    /// @notice Pool-specific fee overrides
    mapping(address => FeeConfig) public poolFees;

    /// @notice Pool tier assignments
    mapping(address => PoolTier) public poolTiers;

    /// @notice Pending fee changes (time-locked)
    mapping(address => PendingFeeChange) public pendingChanges;

    /// @notice Time delay for fee changes (seconds)
    uint256 public feeChangeDelay;

    /// @notice Maximum swap fee (bps)
    uint256 public constant MAX_SWAP_FEE_BPS = 1000; // 10%

    /// @notice Maximum protocol fee (bps)
    uint256 public constant MAX_PROTOCOL_FEE_BPS = 5000; // 50% of swap fee

    /// @notice Maximum management fee (bps)
    uint256 public constant MAX_MANAGEMENT_FEE_BPS = 500; // 5% annual

    /// @notice Maximum performance fee (bps)
    uint256 public constant MAX_PERFORMANCE_FEE_BPS = 2000; // 20%

    /// @notice Governor contract
    address public governor;

    /// @notice Council contract (multi-sig)
    address public council;

    /// @notice CEO address (for emergency actions)
    address public ceo;

    /// @notice Treasury address
    address public treasury;

    // ============ Events ============

    event FeeChangeProposed(
        address indexed pool, uint256 newSwapFeeBps, uint256 newProtocolFeeBps, uint256 executeAfter
    );
    event FeeChangeExecuted(address indexed pool, uint256 swapFeeBps, uint256 protocolFeeBps);
    event FeeChangeCancelled(address indexed pool);
    event TierFeesUpdated(PoolTier tier, FeeConfig config);
    event PoolTierSet(address indexed pool, PoolTier tier);
    event GovernanceUpdated(address governor, address council, address ceo);

    // ============ Errors ============

    error FeeTooHigh(string feeType, uint256 value, uint256 max);
    error NotAuthorized();
    error NoPendingChange();
    error TooEarly(uint256 executeAfter);
    error InvalidAddress();

    // ============ Constructor ============

    constructor(address governor_, address council_, address ceo_, address treasury_) Ownable(msg.sender) {
        governor = governor_;
        council = council_;
        ceo = ceo_;
        treasury = treasury_;
        feeChangeDelay = 2 days;

        // Initialize tier fees
        tierFees[PoolTier.STANDARD] = FeeConfig({
            swapFeeBps: 30, // 0.3%
            protocolFeeBps: 1000, // 10% of fees to protocol
            managementFeeBps: 0,
            performanceFeeBps: 0
        });

        tierFees[PoolTier.STABLE] = FeeConfig({
            swapFeeBps: 5, // 0.05%
            protocolFeeBps: 1000,
            managementFeeBps: 0,
            performanceFeeBps: 0
        });

        tierFees[PoolTier.PREMIUM] = FeeConfig({
            swapFeeBps: 50, // 0.5%
            protocolFeeBps: 1500, // 15%
            managementFeeBps: 200, // 2% annual
            performanceFeeBps: 1000 // 10%
        });

        tierFees[PoolTier.EXPERIMENTAL] = FeeConfig({
            swapFeeBps: 100, // 1%
            protocolFeeBps: 2000, // 20%
            managementFeeBps: 100,
            performanceFeeBps: 500
        });
    }

    // ============ Modifiers ============

    modifier onlyGovernance() {
        if (msg.sender != governor && msg.sender != council && msg.sender != ceo && msg.sender != owner()) {
            revert NotAuthorized();
        }
        _;
    }

    modifier onlyCouncilOrHigher() {
        if (msg.sender != council && msg.sender != ceo && msg.sender != owner()) {
            revert NotAuthorized();
        }
        _;
    }

    modifier onlyCEO() {
        if (msg.sender != ceo && msg.sender != owner()) {
            revert NotAuthorized();
        }
        _;
    }

    // ============ Fee Configuration ============

    /**
     * @notice Propose a fee change for a pool (time-delayed)
     * @param pool Pool address
     * @param newSwapFeeBps New swap fee in bps
     * @param newProtocolFeeBps New protocol fee in bps
     */
    function proposeFeeChange(address pool, uint256 newSwapFeeBps, uint256 newProtocolFeeBps) external onlyGovernance {
        _validateFees(newSwapFeeBps, newProtocolFeeBps);

        uint256 executeAfter = block.timestamp + feeChangeDelay;

        pendingChanges[pool] = PendingFeeChange({
            newSwapFeeBps: newSwapFeeBps,
            newProtocolFeeBps: newProtocolFeeBps,
            executeAfter: executeAfter,
            exists: true
        });

        emit FeeChangeProposed(pool, newSwapFeeBps, newProtocolFeeBps, executeAfter);
    }

    /**
     * @notice Execute a pending fee change
     * @param pool Pool address
     */
    function executeFeeChange(address pool) external {
        PendingFeeChange storage pending = pendingChanges[pool];

        if (!pending.exists) revert NoPendingChange();
        if (block.timestamp < pending.executeAfter) {
            revert TooEarly(pending.executeAfter);
        }

        // Update pool fees
        FeeConfig storage config = poolFees[pool];
        config.swapFeeBps = pending.newSwapFeeBps;
        config.protocolFeeBps = pending.newProtocolFeeBps;

        // Apply to pool contract
        ITFMMPool(pool).setSwapFee(pending.newSwapFeeBps);
        ITFMMPool(pool).setProtocolFee(pending.newProtocolFeeBps);

        delete pendingChanges[pool];

        emit FeeChangeExecuted(pool, pending.newSwapFeeBps, pending.newProtocolFeeBps);
    }

    /**
     * @notice Cancel a pending fee change
     * @param pool Pool address
     */
    function cancelFeeChange(address pool) external onlyCouncilOrHigher {
        if (!pendingChanges[pool].exists) revert NoPendingChange();
        delete pendingChanges[pool];
        emit FeeChangeCancelled(pool);
    }

    /**
     * @notice Set pool tier (determines default fees)
     * @param pool Pool address
     * @param tier Pool tier
     */
    function setPoolTier(address pool, PoolTier tier) external onlyGovernance {
        poolTiers[pool] = tier;

        // Apply tier fees to pool
        FeeConfig memory tierConfig = tierFees[tier];
        poolFees[pool] = tierConfig;

        ITFMMPool(pool).setSwapFee(tierConfig.swapFeeBps);
        ITFMMPool(pool).setProtocolFee(tierConfig.protocolFeeBps);

        emit PoolTierSet(pool, tier);
    }

    /**
     * @notice Update tier default fees
     * @param tier Pool tier
     * @param config New fee config
     */
    function setTierFees(PoolTier tier, FeeConfig calldata config) external onlyCouncilOrHigher {
        _validateFees(config.swapFeeBps, config.protocolFeeBps);

        if (config.managementFeeBps > MAX_MANAGEMENT_FEE_BPS) {
            revert FeeTooHigh("management", config.managementFeeBps, MAX_MANAGEMENT_FEE_BPS);
        }
        if (config.performanceFeeBps > MAX_PERFORMANCE_FEE_BPS) {
            revert FeeTooHigh("performance", config.performanceFeeBps, MAX_PERFORMANCE_FEE_BPS);
        }

        tierFees[tier] = config;
        emit TierFeesUpdated(tier, config);
    }

    /**
     * @notice Emergency fee reduction (CEO only)
     * @param pool Pool address
     * @param newSwapFeeBps New swap fee (must be lower)
     */
    function emergencyFeeReduction(address pool, uint256 newSwapFeeBps) external onlyCEO {
        FeeConfig storage config = poolFees[pool];
        require(newSwapFeeBps < config.swapFeeBps, "Must be reduction");

        config.swapFeeBps = newSwapFeeBps;
        ITFMMPool(pool).setSwapFee(newSwapFeeBps);

        emit FeeChangeExecuted(pool, newSwapFeeBps, config.protocolFeeBps);
    }

    // ============ View Functions ============

    /**
     * @notice Get effective fees for a pool
     */
    function getPoolFees(address pool) external view returns (FeeConfig memory) {
        FeeConfig memory config = poolFees[pool];

        // If no custom config, use tier defaults
        if (config.swapFeeBps == 0) {
            PoolTier tier = poolTiers[pool];
            return tierFees[tier];
        }

        return config;
    }

    /**
     * @notice Check if fee change is pending
     */
    function hasPendingChange(address pool) external view returns (bool) {
        return pendingChanges[pool].exists;
    }

    /**
     * @notice Get time until fee change can be executed
     */
    function timeUntilExecution(address pool) external view returns (uint256) {
        PendingFeeChange storage pending = pendingChanges[pool];
        if (!pending.exists || block.timestamp >= pending.executeAfter) {
            return 0;
        }
        return pending.executeAfter - block.timestamp;
    }

    // ============ Admin Functions ============

    function setGovernance(address governor_, address council_, address ceo_) external onlyCEO {
        if (governor_ == address(0) || council_ == address(0) || ceo_ == address(0)) {
            revert InvalidAddress();
        }

        governor = governor_;
        council = council_;
        ceo = ceo_;

        emit GovernanceUpdated(governor_, council_, ceo_);
    }

    function setTreasury(address treasury_) external onlyCouncilOrHigher {
        if (treasury_ == address(0)) revert InvalidAddress();
        treasury = treasury_;
    }

    function setFeeChangeDelay(uint256 delay) external onlyCouncilOrHigher {
        require(delay >= 1 hours && delay <= 7 days, "Invalid delay");
        feeChangeDelay = delay;
    }

    // ============ Internal Functions ============

    function _validateFees(uint256 swapFeeBps, uint256 protocolFeeBps) internal pure {
        if (swapFeeBps > MAX_SWAP_FEE_BPS) {
            revert FeeTooHigh("swap", swapFeeBps, MAX_SWAP_FEE_BPS);
        }
        if (protocolFeeBps > MAX_PROTOCOL_FEE_BPS) {
            revert FeeTooHigh("protocol", protocolFeeBps, MAX_PROTOCOL_FEE_BPS);
        }
    }
}
