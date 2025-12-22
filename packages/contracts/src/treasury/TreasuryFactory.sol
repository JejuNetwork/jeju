// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Treasury} from "./Treasury.sol";

/**
 * @title TreasuryFactory
 * @author Jeju Network
 * @notice Factory for deploying treasury contracts for DAOs, games, and profit distribution
 * @dev Creates Treasury contracts and optionally enables TEE or profit distribution features
 *
 * Usage:
 * 1. createTreasury() - Basic treasury with rate-limited withdrawals
 * 2. createTEETreasury() - Treasury with TEE operator, heartbeat, state tracking
 * 3. createProfitTreasury() - Treasury with profit distribution to multiple recipients
 */
contract TreasuryFactory is Ownable {
    // ============ State ============

    struct TreasuryInfo {
        address treasury;
        string name;
        address admin;
        uint256 createdAt;
        bool teeEnabled;
        bool profitDistributionEnabled;
    }

    /// @notice All deployed treasuries
    mapping(bytes32 => TreasuryInfo) public treasuries;

    /// @notice Treasury IDs by admin
    mapping(address => bytes32[]) public adminTreasuries;

    /// @notice All treasury IDs
    bytes32[] public allTreasuryIds;

    /// @notice Treasury address to ID mapping
    mapping(address => bytes32) public treasuryToId;

    /// @notice Default daily withdrawal limit for new treasuries
    uint256 public defaultDailyLimit = 10 ether;

    /// @notice Default TEE timeouts
    uint256 public defaultHeartbeatTimeout = 1 hours;
    uint256 public defaultTakeoverCooldown = 2 hours;

    /// @notice Creation fee (optional, can be 0)
    uint256 public creationFee;

    /// @notice Fee recipient
    address public feeRecipient;

    // ============ Events ============

    event TreasuryCreated(
        bytes32 indexed treasuryId,
        address indexed treasury,
        string name,
        address indexed admin,
        bool teeEnabled,
        bool profitDistributionEnabled
    );

    event DefaultDailyLimitUpdated(uint256 oldLimit, uint256 newLimit);
    event CreationFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);

    // ============ Errors ============

    error TreasuryAlreadyExists(bytes32 treasuryId);
    error TreasuryNotFound(bytes32 treasuryId);
    error InvalidAdmin();
    error InvalidName();
    error InsufficientFee(uint256 provided, uint256 required);
    error TransferFailed();

    // ============ Constructor ============

    constructor(address initialOwner) Ownable(initialOwner) {
        feeRecipient = initialOwner;
    }

    // ============ Treasury Creation ============

    /**
     * @notice Create a basic Treasury
     * @param treasuryName Human-readable name for the treasury
     * @param admin Admin address for the treasury
     * @param dailyLimit Daily withdrawal limit (0 to use default)
     * @return treasuryId Unique identifier for the treasury
     * @return treasury Address of the deployed treasury
     */
    function createTreasury(
        string calldata treasuryName,
        address admin,
        uint256 dailyLimit
    ) external payable returns (bytes32 treasuryId, address treasury) {
        _validateCreation(treasuryName, admin);

        uint256 limit = dailyLimit > 0 ? dailyLimit : defaultDailyLimit;

        Treasury newTreasury = new Treasury(treasuryName, limit, admin);
        treasury = address(newTreasury);

        treasuryId = _registerTreasury(treasuryName, admin, treasury, false, false);
    }

    /**
     * @notice Create a Treasury with TEE operator mode enabled
     * @param treasuryName Human-readable name for the treasury
     * @param admin Admin address for the treasury
     * @param dailyLimit Daily withdrawal limit (0 to use default)
     * @return treasuryId Unique identifier for the treasury
     * @return treasury Address of the deployed treasury
     */
    function createTEETreasury(
        string calldata treasuryName,
        address admin,
        uint256 dailyLimit
    ) external payable returns (bytes32 treasuryId, address treasury) {
        _validateCreation(treasuryName, admin);

        uint256 limit = dailyLimit > 0 ? dailyLimit : defaultDailyLimit;

        Treasury newTreasury = new Treasury(treasuryName, limit, admin);
        newTreasury.enableTEEMode(defaultHeartbeatTimeout, defaultTakeoverCooldown);
        treasury = address(newTreasury);

        treasuryId = _registerTreasury(treasuryName, admin, treasury, true, false);
    }

    /**
     * @notice Create a Treasury with profit distribution enabled
     * @param treasuryName Human-readable name for the treasury
     * @param admin Admin address for the treasury
     * @param dailyLimit Daily withdrawal limit (0 to use default)
     * @param protocolRecipient Address to receive protocol share
     * @param stakersRecipient Address to receive stakers share
     * @param insuranceRecipient Address to receive insurance share
     * @return treasuryId Unique identifier for the treasury
     * @return treasury Address of the deployed treasury
     */
    function createProfitTreasury(
        string calldata treasuryName,
        address admin,
        uint256 dailyLimit,
        address protocolRecipient,
        address stakersRecipient,
        address insuranceRecipient
    ) external payable returns (bytes32 treasuryId, address treasury) {
        _validateCreation(treasuryName, admin);

        uint256 limit = dailyLimit > 0 ? dailyLimit : defaultDailyLimit;

        Treasury newTreasury = new Treasury(treasuryName, limit, admin);
        newTreasury.enableProfitDistribution(protocolRecipient, stakersRecipient, insuranceRecipient);
        treasury = address(newTreasury);

        treasuryId = _registerTreasury(treasuryName, admin, treasury, false, true);
    }

    /**
     * @notice Create a Treasury with both TEE and profit distribution enabled
     * @param treasuryName Human-readable name for the treasury
     * @param admin Admin address for the treasury
     * @param dailyLimit Daily withdrawal limit (0 to use default)
     * @param protocolRecipient Address to receive protocol share
     * @param stakersRecipient Address to receive stakers share
     * @param insuranceRecipient Address to receive insurance share
     * @return treasuryId Unique identifier for the treasury
     * @return treasury Address of the deployed treasury
     */
    function createFullTreasury(
        string calldata treasuryName,
        address admin,
        uint256 dailyLimit,
        address protocolRecipient,
        address stakersRecipient,
        address insuranceRecipient
    ) external payable returns (bytes32 treasuryId, address treasury) {
        _validateCreation(treasuryName, admin);

        uint256 limit = dailyLimit > 0 ? dailyLimit : defaultDailyLimit;

        Treasury newTreasury = new Treasury(treasuryName, limit, admin);
        newTreasury.enableTEEMode(defaultHeartbeatTimeout, defaultTakeoverCooldown);
        newTreasury.enableProfitDistribution(protocolRecipient, stakersRecipient, insuranceRecipient);
        treasury = address(newTreasury);

        treasuryId = _registerTreasury(treasuryName, admin, treasury, true, true);
    }

    // ============ Internal ============

    function _validateCreation(string calldata treasuryName, address admin) internal {
        if (admin == address(0)) revert InvalidAdmin();
        if (bytes(treasuryName).length == 0) revert InvalidName();

        if (creationFee > 0) {
            if (msg.value < creationFee) revert InsufficientFee(msg.value, creationFee);
            if (feeRecipient != address(0)) {
                (bool success,) = feeRecipient.call{value: creationFee}("");
                if (!success) revert TransferFailed();
            }
            if (msg.value > creationFee) {
                (bool refundSuccess,) = msg.sender.call{value: msg.value - creationFee}("");
                if (!refundSuccess) revert TransferFailed();
            }
        }
    }

    function _registerTreasury(
        string calldata treasuryName,
        address admin,
        address treasury,
        bool teeEnabled,
        bool profitDistributionEnabled
    ) internal returns (bytes32 treasuryId) {
        treasuryId = keccak256(abi.encodePacked(treasuryName, admin, block.timestamp, allTreasuryIds.length));

        if (treasuries[treasuryId].treasury != address(0)) {
            revert TreasuryAlreadyExists(treasuryId);
        }

        treasuries[treasuryId] = TreasuryInfo({
            treasury: treasury,
            name: treasuryName,
            admin: admin,
            createdAt: block.timestamp,
            teeEnabled: teeEnabled,
            profitDistributionEnabled: profitDistributionEnabled
        });

        adminTreasuries[admin].push(treasuryId);
        allTreasuryIds.push(treasuryId);
        treasuryToId[treasury] = treasuryId;

        emit TreasuryCreated(treasuryId, treasury, treasuryName, admin, teeEnabled, profitDistributionEnabled);
    }

    // ============ View Functions ============

    function getTreasury(bytes32 treasuryId) external view returns (TreasuryInfo memory) {
        return treasuries[treasuryId];
    }

    function getTreasuriesByAdmin(address admin) external view returns (bytes32[] memory) {
        return adminTreasuries[admin];
    }

    function getAllTreasuryIds() external view returns (bytes32[] memory) {
        return allTreasuryIds;
    }

    function getTreasuryCount() external view returns (uint256) {
        return allTreasuryIds.length;
    }

    function getTEETreasuries() external view returns (bytes32[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < allTreasuryIds.length; i++) {
            if (treasuries[allTreasuryIds[i]].teeEnabled) {
                count++;
            }
        }

        bytes32[] memory result = new bytes32[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < allTreasuryIds.length; i++) {
            if (treasuries[allTreasuryIds[i]].teeEnabled) {
                result[idx++] = allTreasuryIds[i];
            }
        }
        return result;
    }

    function getProfitTreasuries() external view returns (bytes32[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < allTreasuryIds.length; i++) {
            if (treasuries[allTreasuryIds[i]].profitDistributionEnabled) {
                count++;
            }
        }

        bytes32[] memory result = new bytes32[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < allTreasuryIds.length; i++) {
            if (treasuries[allTreasuryIds[i]].profitDistributionEnabled) {
                result[idx++] = allTreasuryIds[i];
            }
        }
        return result;
    }

    // ============ Admin Functions ============

    function setDefaultDailyLimit(uint256 newLimit) external onlyOwner {
        uint256 oldLimit = defaultDailyLimit;
        defaultDailyLimit = newLimit;
        emit DefaultDailyLimitUpdated(oldLimit, newLimit);
    }

    function setDefaultTEETimeouts(uint256 _heartbeatTimeout, uint256 _takeoverCooldown) external onlyOwner {
        defaultHeartbeatTimeout = _heartbeatTimeout;
        defaultTakeoverCooldown = _takeoverCooldown;
    }

    function setCreationFee(uint256 newFee) external onlyOwner {
        uint256 oldFee = creationFee;
        creationFee = newFee;
        emit CreationFeeUpdated(oldFee, newFee);
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        address oldRecipient = feeRecipient;
        feeRecipient = newRecipient;
        emit FeeRecipientUpdated(oldRecipient, newRecipient);
    }

    function version() external pure returns (string memory) {
        return "2.0.0";
    }
}
