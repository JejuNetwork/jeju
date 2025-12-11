// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {BasePaymaster} from "@account-abstraction/contracts/core/BasePaymaster.sol";

/**
 * @title SponsoredPaymaster
 * @author Jeju Network
 * @notice ERC-4337 paymaster that sponsors transactions for free
 * @dev Used for gasless game transactions where the game/platform sponsors all gas.
 *      Users never pay anything - perfect for onboarding and gameplay.
 *
 * Use Cases:
 * - Game transactions (inventory, combat, equipment)
 * - Onboarding new users who have no tokens
 * - Promotional periods / free trials
 * - Platform-sponsored actions
 *
 * Security:
 * - Only whitelisted contracts can be called (prevents abuse)
 * - Rate limiting per user (configurable)
 * - Maximum gas per operation (prevents expensive attacks)
 * - Pausable for emergencies
 * - Only owner can fund/withdraw
 *
 * Configuration:
 * - Whitelist target contracts (e.g., Gold, Items, World)
 * - Set rate limits per user
 * - Set max gas per operation
 * - Fund from owner's wallet
 *
 * @custom:security-contact security@jeju.network
 */
contract SponsoredPaymaster is BasePaymaster {
    // ============ State Variables ============

    /// @notice Maximum gas cost allowed per operation (in ETH)
    uint256 public maxGasCost = 0.01 ether;

    /// @notice Rate limit: max sponsored txs per user per hour
    uint256 public maxTxPerUserPerHour = 100;

    /// @notice Mapping from contract address to whether it's whitelisted
    mapping(address => bool) public whitelistedTargets;

    /// @notice Mapping from user to their tx count in current hour
    mapping(address => uint256) public userTxCount;

    /// @notice Mapping from user to hour when count was last reset
    mapping(address => uint256) public userTxCountHour;

    /// @notice Paused state
    bool public paused;

    /// @notice Total gas sponsored (for analytics)
    uint256 public totalGasSponsored;

    /// @notice Total transactions sponsored (for analytics)
    uint256 public totalTxSponsored;

    // ============ Events ============

    event TransactionSponsored(address indexed user, address indexed target, uint256 gasCost);
    event TargetWhitelisted(address indexed target, bool whitelisted);
    event MaxGasCostUpdated(uint256 oldMax, uint256 newMax);
    event MaxTxPerUserUpdated(uint256 oldMax, uint256 newMax);
    event Paused(bool isPaused);
    event Funded(address indexed funder, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    // ============ Errors ============

    error PaymasterPaused();
    error TargetNotWhitelisted(address target);
    error GasCostTooHigh(uint256 cost, uint256 max);
    error RateLimitExceeded(address user, uint256 count, uint256 max);
    error InsufficientDeposit();

    // ============ Constructor ============

    /**
     * @notice Deploy SponsoredPaymaster
     * @param _entryPoint ERC-4337 EntryPoint contract
     * @param _owner Owner address (can fund, configure, and withdraw)
     */
    constructor(
        IEntryPoint _entryPoint,
        address _owner
    ) BasePaymaster(_entryPoint) {
        if (_owner != msg.sender) {
            _transferOwnership(_owner);
        }
    }

    // ============ Paymaster Core ============

    /**
     * @notice Validates paymaster willingness to sponsor operation
     * @param userOp User operation to validate
     * @param maxCost Maximum gas cost in ETH
     * @return context Encoded data for postOp (user, target, gasCost)
     * @return validationData 0 for valid, 1 for invalid
     *
     * Validation:
     * 1. Not paused
     * 2. Target contract is whitelisted
     * 3. Gas cost within limits
     * 4. User not rate limited
     * 5. EntryPoint has sufficient deposit
     *
     * paymasterAndData format:
     * - Bytes 0-19: paymaster address (this)
     * - Bytes 20-35: verificationGasLimit (uint128)
     * - Bytes 36-51: postOpGasLimit (uint128)
     * - No custom data required - we sponsor everything
     */
    function _validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32,
        uint256 maxCost
    )
        internal
        view
        override
        returns (bytes memory context, uint256 validationData)
    {
        // Check paused
        if (paused) revert PaymasterPaused();

        // Check gas cost
        if (maxCost > maxGasCost) {
            revert GasCostTooHigh(maxCost, maxGasCost);
        }

        // Extract target from callData (first 4 bytes are selector, next 20 are address for most calls)
        // For SimpleAccount.execute: execute(address dest, uint256 value, bytes calldata func)
        address target;
        if (userOp.callData.length >= 36) {
            // Decode target from execute call
            // Selector (4) + dest address starts at byte 16 (4 + 12 padding) and is 20 bytes
            target = address(bytes20(userOp.callData[16:36]));
        } else {
            // Direct call - target is the sender's wallet calling itself
            target = userOp.sender;
        }

        // Check whitelist (if any targets are whitelisted)
        // If no targets whitelisted, sponsor everything
        if (!whitelistedTargets[target] && !whitelistedTargets[address(0)]) {
            revert TargetNotWhitelisted(target);
        }

        // Check rate limit
        address user = userOp.sender;
        uint256 currentHour = block.timestamp / 1 hours;
        uint256 currentCount = userTxCount[user];

        if (userTxCountHour[user] != currentHour) {
            // New hour, count resets
            currentCount = 0;
        }

        if (currentCount >= maxTxPerUserPerHour) {
            revert RateLimitExceeded(user, currentCount, maxTxPerUserPerHour);
        }

        // Check we have enough deposit
        uint256 deposit = entryPoint.balanceOf(address(this));
        if (deposit < maxCost) {
            revert InsufficientDeposit();
        }

        // Return context for postOp
        context = abi.encode(user, target, maxCost);
        validationData = 0; // Accept
    }

    /**
     * @notice Post-operation callback - track analytics
     * @param context Data from validation
     * @param actualGasCost Actual gas used
     */
    function _postOp(
        PostOpMode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256
    ) internal override {
        (address user, address target,) = abi.decode(context, (address, address, uint256));

        // Update rate limit counter
        uint256 currentHour = block.timestamp / 1 hours;
        if (userTxCountHour[user] != currentHour) {
            userTxCount[user] = 1;
            userTxCountHour[user] = currentHour;
        } else {
            userTxCount[user]++;
        }

        // Update analytics
        totalGasSponsored += actualGasCost;
        totalTxSponsored++;

        emit TransactionSponsored(user, target, actualGasCost);
    }

    // ============ Admin Functions ============

    /**
     * @notice Whitelist a target contract for sponsorship
     * @param target Contract address to whitelist
     * @param whitelisted Whether to whitelist or remove
     * @dev Set address(0) to true to sponsor ALL contracts
     */
    function setWhitelistedTarget(address target, bool whitelisted) external onlyOwner {
        whitelistedTargets[target] = whitelisted;
        emit TargetWhitelisted(target, whitelisted);
    }

    /**
     * @notice Batch whitelist multiple targets
     * @param targets Array of contract addresses
     * @param whitelisted Whether to whitelist all
     */
    function batchWhitelistTargets(address[] calldata targets, bool whitelisted) external onlyOwner {
        for (uint256 i = 0; i < targets.length; i++) {
            whitelistedTargets[targets[i]] = whitelisted;
            emit TargetWhitelisted(targets[i], whitelisted);
        }
    }

    /**
     * @notice Set maximum gas cost per operation
     * @param newMax New maximum in wei
     */
    function setMaxGasCost(uint256 newMax) external onlyOwner {
        uint256 oldMax = maxGasCost;
        maxGasCost = newMax;
        emit MaxGasCostUpdated(oldMax, newMax);
    }

    /**
     * @notice Set rate limit per user
     * @param newMax New maximum transactions per hour
     */
    function setMaxTxPerUser(uint256 newMax) external onlyOwner {
        uint256 oldMax = maxTxPerUserPerHour;
        maxTxPerUserPerHour = newMax;
        emit MaxTxPerUserUpdated(oldMax, newMax);
    }

    /**
     * @notice Pause sponsorship
     */
    function pause() external onlyOwner {
        paused = true;
        emit Paused(true);
    }

    /**
     * @notice Resume sponsorship
     */
    function unpause() external onlyOwner {
        paused = false;
        emit Paused(false);
    }

    /**
     * @notice Fund the paymaster's EntryPoint deposit
     * @dev Anyone can fund, but only owner can withdraw
     */
    function fund() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
        emit Funded(msg.sender, msg.value);
    }

    /**
     * @notice Withdraw from EntryPoint deposit
     * @param to Address to send funds to
     * @param amount Amount to withdraw
     */
    function withdraw(address payable to, uint256 amount) external onlyOwner {
        entryPoint.withdrawTo(to, amount);
        emit Withdrawn(to, amount);
    }

    // ============ View Functions ============

    /**
     * @notice Check if a target is whitelisted
     * @param target Contract address to check
     * @return True if whitelisted (or if all contracts are whitelisted)
     */
    function isWhitelisted(address target) external view returns (bool) {
        return whitelistedTargets[target] || whitelistedTargets[address(0)];
    }

    /**
     * @notice Get remaining sponsored txs for a user this hour
     * @param user User address
     * @return remaining Number of transactions remaining
     */
    function getRemainingTx(address user) external view returns (uint256 remaining) {
        uint256 currentHour = block.timestamp / 1 hours;
        uint256 count = userTxCountHour[user] == currentHour ? userTxCount[user] : 0;
        return count >= maxTxPerUserPerHour ? 0 : maxTxPerUserPerHour - count;
    }

    /**
     * @notice Get paymaster status
     * @return deposit Current EntryPoint deposit
     * @return isPaused Whether sponsorship is paused
     * @return totalTx Total transactions sponsored
     * @return totalGas Total gas sponsored in wei
     */
    function getStatus() external view returns (
        uint256 deposit,
        bool isPaused,
        uint256 totalTx,
        uint256 totalGas
    ) {
        deposit = entryPoint.balanceOf(address(this));
        isPaused = paused;
        totalTx = totalTxSponsored;
        totalGas = totalGasSponsored;
    }

    /**
     * @notice Check if paymaster can sponsor an operation
     * @param user User address
     * @param target Target contract
     * @param gasCost Estimated gas cost
     * @return sponsored True if operation can be sponsored
     * @return reason Reason if cannot sponsor
     */
    function canSponsor(address user, address target, uint256 gasCost) external view returns (
        bool sponsored,
        string memory reason
    ) {
        if (paused) return (false, "Paused");
        if (gasCost > maxGasCost) return (false, "Gas too high");
        if (!whitelistedTargets[target] && !whitelistedTargets[address(0)]) {
            return (false, "Target not whitelisted");
        }
        
        uint256 currentHour = block.timestamp / 1 hours;
        uint256 count = userTxCountHour[user] == currentHour ? userTxCount[user] : 0;
        if (count >= maxTxPerUserPerHour) return (false, "Rate limited");
        
        if (entryPoint.balanceOf(address(this)) < gasCost) {
            return (false, "Insufficient deposit");
        }
        
        return (true, "");
    }

    /**
     * @notice Returns the contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    // ============ Receive ETH ============

    receive() external payable {
        // Accept ETH for funding
        entryPoint.depositTo{value: msg.value}(address(this));
        emit Funded(msg.sender, msg.value);
    }
}
