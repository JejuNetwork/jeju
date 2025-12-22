// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ITFMMPool} from "./ITFMMPool.sol";
import {IStrategyRule} from "./IStrategyRule.sol";
import {IOracleRegistry} from "./IOracleRegistry.sol";

/**
 * @title WeightUpdateRunner
 * @author Jeju Network
 * @notice Orchestrates periodic weight updates for TFMM pools
 * @dev Called by Chainlink Automation or any keeper to update pool weights
 *
 * Features:
 * - Manages multiple TFMM pools
 * - Fetches oracle prices
 * - Executes strategy rules
 * - Compensates gas costs from pool
 */
contract WeightUpdateRunner is Ownable, ReentrancyGuard {

    // ============ Structs ============

    struct PoolConfig {
        address strategyRule;
        address[] oracles;          // Oracle addresses for each token
        uint256 updateIntervalSec;  // Minimum seconds between updates
        uint256 lastUpdate;         // Timestamp of last update
        uint256 blocksToTarget;     // Default blocks for weight interpolation
        bool active;
    }

    // ============ State Variables ============

    /// @notice Oracle registry for price feeds
    IOracleRegistry public oracleRegistry;

    /// @notice Pool configurations
    mapping(address => PoolConfig) public pools;

    /// @notice List of managed pool addresses
    address[] public poolList;

    /// @notice Governance address
    address public governance;

    /// @notice Compensation per update (in ETH)
    uint256 public updateCompensation;

    /// @notice Whether gas compensation is enabled
    bool public gasCompensationEnabled;

    // ============ Events ============

    event PoolRegistered(
        address indexed pool,
        address indexed strategyRule,
        uint256 updateInterval
    );
    event PoolDeactivated(address indexed pool);
    event UpdatePerformed(
        address indexed pool,
        uint256[] oldWeights,
        uint256[] newWeights,
        uint256 gasUsed
    );
    event OracleRegistryUpdated(address indexed newRegistry);
    event GovernanceUpdated(address indexed newGovernance);

    // ============ Errors ============

    error PoolNotRegistered();
    error PoolNotActive();
    error UpdateTooSoon(uint256 secondsRemaining);
    error StrategyFailed(string reason);
    error OracleFailed(address oracle);

    // ============ Constructor ============

    constructor(
        address oracleRegistry_,
        address governance_
    ) Ownable(msg.sender) {
        oracleRegistry = IOracleRegistry(oracleRegistry_);
        governance = governance_;
        updateCompensation = 0.001 ether;
        gasCompensationEnabled = false;
    }

    // ============ Modifiers ============

    modifier onlyGovernance() {
        require(msg.sender == governance || msg.sender == owner(), "Not governance");
        _;
    }

    // ============ Pool Registration ============

    /**
     * @notice Register a new TFMM pool for management
     * @param pool Pool address
     * @param strategyRule Strategy rule contract
     * @param oracles Oracle addresses for each token
     * @param updateIntervalSec Minimum seconds between updates
     * @param blocksToTarget Default blocks for interpolation
     */
    function registerPool(
        address pool,
        address strategyRule,
        address[] calldata oracles,
        uint256 updateIntervalSec,
        uint256 blocksToTarget
    ) external onlyOwner {
        require(pools[pool].lastUpdate == 0, "Pool already registered");
        require(strategyRule != address(0), "Invalid strategy");

        pools[pool] = PoolConfig({
            strategyRule: strategyRule,
            oracles: oracles,
            updateIntervalSec: updateIntervalSec,
            lastUpdate: 0,
            blocksToTarget: blocksToTarget,
            active: true
        });

        poolList.push(pool);

        emit PoolRegistered(pool, strategyRule, updateIntervalSec);
    }

    /**
     * @notice Deactivate a pool (stop updates)
     */
    function deactivatePool(address pool) external onlyOwner {
        require(pools[pool].lastUpdate > 0, "Pool not registered");
        pools[pool].active = false;
        emit PoolDeactivated(pool);
    }

    /**
     * @notice Reactivate a pool
     */
    function activatePool(address pool) external onlyOwner {
        require(pools[pool].lastUpdate > 0, "Pool not registered");
        pools[pool].active = true;
    }

    /**
     * @notice Update pool configuration
     */
    function updatePoolConfig(
        address pool,
        address strategyRule,
        address[] calldata oracles,
        uint256 updateIntervalSec,
        uint256 blocksToTarget
    ) external onlyOwner {
        require(pools[pool].lastUpdate > 0, "Pool not registered");

        PoolConfig storage config = pools[pool];
        config.strategyRule = strategyRule;
        config.oracles = oracles;
        config.updateIntervalSec = updateIntervalSec;
        config.blocksToTarget = blocksToTarget;
    }

    // ============ Update Execution ============

    /**
     * @notice Perform weight update for a specific pool
     * @param pool Pool address
     */
    function performUpdate(address pool) external nonReentrant {
        uint256 gasStart = gasleft();

        PoolConfig storage config = pools[pool];
        if (config.lastUpdate == 0) revert PoolNotRegistered();
        if (!config.active) revert PoolNotActive();

        // Check update interval
        if (config.lastUpdate > 0) {
            uint256 elapsed = block.timestamp - config.lastUpdate;
            if (elapsed < config.updateIntervalSec) {
                revert UpdateTooSoon(config.updateIntervalSec - elapsed);
            }
        }

        // Fetch oracle prices
        uint256[] memory prices = _fetchPrices(config.oracles);

        // Get current weights from pool
        ITFMMPool tfmmPool = ITFMMPool(pool);
        uint256[] memory currentWeights = tfmmPool.getNormalizedWeights();

        // Calculate new weights using strategy
        IStrategyRule strategy = IStrategyRule(config.strategyRule);
        (uint256[] memory newWeights, uint256 blocksToTarget) = strategy.calculateWeights(
            pool,
            prices,
            currentWeights
        );

        // Apply update to pool
        tfmmPool.updateWeights(newWeights, blocksToTarget > 0 ? blocksToTarget : config.blocksToTarget);

        config.lastUpdate = block.timestamp;

        uint256 gasUsed = gasStart - gasleft();

        // Compensate caller if enabled
        if (gasCompensationEnabled && address(this).balance >= updateCompensation) {
            payable(msg.sender).transfer(updateCompensation);
        }

        emit UpdatePerformed(pool, currentWeights, newWeights, gasUsed);
    }

    /**
     * @notice Perform updates for all eligible pools
     */
    function performBatchUpdate() external nonReentrant {
        for (uint256 i = 0; i < poolList.length; i++) {
            address pool = poolList[i];
            PoolConfig storage config = pools[pool];

            if (!config.active) continue;

            uint256 elapsed = block.timestamp - config.lastUpdate;
            if (elapsed < config.updateIntervalSec) continue;

            // Try to update, continue on failure
            try this.performUpdateInternal(pool) {
                // Success
            } catch {
                // Skip failed pools
            }
        }
    }

    /**
     * @notice Internal update function for try/catch
     */
    function performUpdateInternal(address pool) external {
        require(msg.sender == address(this), "Internal only");

        PoolConfig storage config = pools[pool];
        uint256[] memory prices = _fetchPrices(config.oracles);

        ITFMMPool tfmmPool = ITFMMPool(pool);
        uint256[] memory currentWeights = tfmmPool.getNormalizedWeights();

        IStrategyRule strategy = IStrategyRule(config.strategyRule);
        (uint256[] memory newWeights, uint256 blocksToTarget) = strategy.calculateWeights(
            pool,
            prices,
            currentWeights
        );

        tfmmPool.updateWeights(newWeights, blocksToTarget > 0 ? blocksToTarget : config.blocksToTarget);
        config.lastUpdate = block.timestamp;

        emit UpdatePerformed(pool, currentWeights, newWeights, 0);
    }

    // ============ View Functions ============

    /**
     * @notice Check if a pool can be updated
     */
    function canUpdate(address pool) external view returns (bool) {
        PoolConfig storage config = pools[pool];
        if (config.lastUpdate == 0 || !config.active) return false;

        uint256 elapsed = block.timestamp - config.lastUpdate;
        return elapsed >= config.updateIntervalSec;
    }

    /**
     * @notice Get time until next update for a pool
     */
    function timeUntilUpdate(address pool) external view returns (uint256) {
        PoolConfig storage config = pools[pool];
        if (config.lastUpdate == 0) return 0;

        uint256 elapsed = block.timestamp - config.lastUpdate;
        if (elapsed >= config.updateIntervalSec) return 0;

        return config.updateIntervalSec - elapsed;
    }

    /**
     * @notice Get all managed pools
     */
    function getManagedPools() external view returns (address[] memory) {
        return poolList;
    }

    /**
     * @notice Get active pool count
     */
    function getActivePoolCount() external view returns (uint256 count) {
        for (uint256 i = 0; i < poolList.length; i++) {
            if (pools[poolList[i]].active) count++;
        }
    }

    /**
     * @notice Get pool oracles
     */
    function getPoolOracles(address pool) external view returns (address[] memory) {
        return pools[pool].oracles;
    }

    /**
     * @notice Estimate gas for an update
     */
    function estimateUpdateGas(address pool) external view returns (uint256) {
        // Base gas + per-token gas
        PoolConfig storage config = pools[pool];
        return 100000 + (config.oracles.length * 30000);
    }

    // ============ Admin Functions ============

    function setOracleRegistry(address newRegistry) external onlyOwner {
        oracleRegistry = IOracleRegistry(newRegistry);
        emit OracleRegistryUpdated(newRegistry);
    }

    function setGovernance(address newGovernance) external onlyGovernance {
        governance = newGovernance;
        emit GovernanceUpdated(newGovernance);
    }

    function setUpdateCompensation(uint256 amount) external onlyGovernance {
        updateCompensation = amount;
    }

    function setGasCompensationEnabled(bool enabled) external onlyGovernance {
        gasCompensationEnabled = enabled;
    }

    /**
     * @notice Withdraw ETH for gas compensation funding
     */
    function withdrawETH(address payable to, uint256 amount) external onlyOwner {
        require(address(this).balance >= amount, "Insufficient balance");
        to.transfer(amount);
    }

    receive() external payable {}

    // ============ Internal Functions ============

    function _fetchPrices(address[] storage oracles) internal view returns (uint256[] memory prices) {
        prices = new uint256[](oracles.length);

        for (uint256 i = 0; i < oracles.length; i++) {
            prices[i] = oracleRegistry.getPrice(oracles[i]);
            if (prices[i] == 0) revert OracleFailed(oracles[i]);
        }
    }
}

