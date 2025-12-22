// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Treasury} from "./Treasury.sol";
import {GameTreasury} from "./GameTreasury.sol";
import {ProfitTreasury} from "./ProfitTreasury.sol";

/**
 * @title TreasuryFactory
 * @author Jeju Network
 * @notice Factory for deploying treasury contracts for DAOs, games, and profit distribution
 * @dev Enables dynamic creation of treasuries without hardcoding vendor-specific contracts
 *
 * Treasury Types:
 * - BASE: Standard Treasury with rate-limited withdrawals and operator management
 * - GAME: GameTreasury with TEE operator, heartbeat monitoring, and state tracking
 * - PROFIT: ProfitTreasury with multi-recipient distribution and profit categorization
 *
 * Usage:
 * 1. Deploy TreasuryFactory
 * 2. Call createTreasury/createGameTreasury/createProfitTreasury as needed
 * 3. Each treasury is fully independent with its own admin
 */
contract TreasuryFactory is Ownable {
    // ============ Types ============

    enum TreasuryType {
        BASE,
        GAME,
        PROFIT
    }

    struct TreasuryInfo {
        address treasury;
        TreasuryType treasuryType;
        string name;
        address admin;
        uint256 createdAt;
        bool active;
    }

    // ============ State ============

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

    /// @notice Creation fee (optional, can be 0)
    uint256 public creationFee;

    /// @notice Fee recipient
    address public feeRecipient;

    // ============ Events ============

    event TreasuryCreated(
        bytes32 indexed treasuryId,
        address indexed treasury,
        TreasuryType treasuryType,
        string name,
        address indexed admin
    );

    event TreasuryDeactivated(bytes32 indexed treasuryId, address indexed treasury);
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
     * @notice Create a standard Treasury
     * @param name Human-readable name for the treasury
     * @param admin Admin address for the treasury
     * @param dailyLimit Daily withdrawal limit (0 to use default)
     * @return treasuryId Unique identifier for the treasury
     * @return treasury Address of the deployed treasury
     */
    function createTreasury(
        string calldata name,
        address admin,
        uint256 dailyLimit
    ) external payable returns (bytes32 treasuryId, address treasury) {
        return _createTreasury(name, admin, dailyLimit, TreasuryType.BASE);
    }

    /**
     * @notice Create a GameTreasury for TEE-operated games/agents
     * @param name Human-readable name for the treasury
     * @param admin Admin address for the treasury
     * @param dailyLimit Daily withdrawal limit (0 to use default)
     * @return treasuryId Unique identifier for the treasury
     * @return treasury Address of the deployed treasury
     */
    function createGameTreasury(
        string calldata name,
        address admin,
        uint256 dailyLimit
    ) external payable returns (bytes32 treasuryId, address treasury) {
        return _createTreasury(name, admin, dailyLimit, TreasuryType.GAME);
    }

    /**
     * @notice Create a ProfitTreasury for profit distribution
     * @param name Human-readable name for the treasury
     * @param admin Admin address for the treasury
     * @param dailyLimit Daily withdrawal limit (0 to use default)
     * @param protocolRecipient Address to receive protocol share
     * @param stakersRecipient Address to receive stakers share
     * @param insuranceRecipient Address to receive insurance share
     * @return treasuryId Unique identifier for the treasury
     * @return treasury Address of the deployed treasury
     */
    function createProfitTreasury(
        string calldata name,
        address admin,
        uint256 dailyLimit,
        address protocolRecipient,
        address stakersRecipient,
        address insuranceRecipient
    ) external payable returns (bytes32 treasuryId, address treasury) {
        _validateCreation(name, admin);

        uint256 limit = dailyLimit > 0 ? dailyLimit : defaultDailyLimit;

        // Deploy ProfitTreasury
        ProfitTreasury newTreasury = new ProfitTreasury(
            limit,
            admin,
            protocolRecipient,
            stakersRecipient,
            insuranceRecipient
        );
        treasury = address(newTreasury);

        treasuryId = _registerTreasury(name, admin, treasury, TreasuryType.PROFIT);
    }

    // ============ Internal ============

    function _createTreasury(
        string calldata name,
        address admin,
        uint256 dailyLimit,
        TreasuryType treasuryType
    ) internal returns (bytes32 treasuryId, address treasury) {
        _validateCreation(name, admin);

        uint256 limit = dailyLimit > 0 ? dailyLimit : defaultDailyLimit;

        // Deploy appropriate treasury type
        if (treasuryType == TreasuryType.BASE) {
            Treasury newTreasury = new Treasury(limit, admin);
            treasury = address(newTreasury);
        } else if (treasuryType == TreasuryType.GAME) {
            GameTreasury newTreasury = new GameTreasury(limit, admin);
            treasury = address(newTreasury);
        } else {
            revert("Invalid treasury type");
        }

        treasuryId = _registerTreasury(name, admin, treasury, treasuryType);
    }

    function _validateCreation(string calldata name, address admin) internal {
        if (admin == address(0)) revert InvalidAdmin();
        if (bytes(name).length == 0) revert InvalidName();

        // Handle creation fee
        if (creationFee > 0) {
            if (msg.value < creationFee) revert InsufficientFee(msg.value, creationFee);
            if (feeRecipient != address(0)) {
                (bool success,) = feeRecipient.call{value: creationFee}("");
                if (!success) revert TransferFailed();
            }
            // Refund excess
            if (msg.value > creationFee) {
                (bool refundSuccess,) = msg.sender.call{value: msg.value - creationFee}("");
                if (!refundSuccess) revert TransferFailed();
            }
        }
    }

    function _registerTreasury(
        string calldata name,
        address admin,
        address treasury,
        TreasuryType treasuryType
    ) internal returns (bytes32 treasuryId) {
        // Generate unique ID
        treasuryId = keccak256(abi.encodePacked(name, admin, block.timestamp, allTreasuryIds.length));

        if (treasuries[treasuryId].treasury != address(0)) {
            revert TreasuryAlreadyExists(treasuryId);
        }

        // Store treasury info
        treasuries[treasuryId] = TreasuryInfo({
            treasury: treasury,
            treasuryType: treasuryType,
            name: name,
            admin: admin,
            createdAt: block.timestamp,
            active: true
        });

        adminTreasuries[admin].push(treasuryId);
        allTreasuryIds.push(treasuryId);
        treasuryToId[treasury] = treasuryId;

        emit TreasuryCreated(treasuryId, treasury, treasuryType, name, admin);
    }

    // ============ View Functions ============

    /**
     * @notice Get treasury info by ID
     */
    function getTreasury(bytes32 treasuryId) external view returns (TreasuryInfo memory) {
        return treasuries[treasuryId];
    }

    /**
     * @notice Get all treasuries for an admin
     */
    function getTreasuriesByAdmin(address admin) external view returns (bytes32[] memory) {
        return adminTreasuries[admin];
    }

    /**
     * @notice Get all treasury IDs
     */
    function getAllTreasuryIds() external view returns (bytes32[] memory) {
        return allTreasuryIds;
    }

    /**
     * @notice Get total treasury count
     */
    function getTreasuryCount() external view returns (uint256) {
        return allTreasuryIds.length;
    }

    /**
     * @notice Get treasuries by type
     */
    function getTreasuriesByType(TreasuryType treasuryType) external view returns (bytes32[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < allTreasuryIds.length; i++) {
            if (treasuries[allTreasuryIds[i]].treasuryType == treasuryType) {
                count++;
            }
        }

        bytes32[] memory result = new bytes32[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < allTreasuryIds.length; i++) {
            if (treasuries[allTreasuryIds[i]].treasuryType == treasuryType) {
                result[idx++] = allTreasuryIds[i];
            }
        }
        return result;
    }

    /**
     * @notice Get active treasuries
     */
    function getActiveTreasuries() external view returns (bytes32[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < allTreasuryIds.length; i++) {
            if (treasuries[allTreasuryIds[i]].active) {
                count++;
            }
        }

        bytes32[] memory result = new bytes32[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < allTreasuryIds.length; i++) {
            if (treasuries[allTreasuryIds[i]].active) {
                result[idx++] = allTreasuryIds[i];
            }
        }
        return result;
    }

    // ============ Admin Functions ============

    /**
     * @notice Mark a treasury as inactive (does not affect the treasury itself)
     * @dev Only for factory tracking purposes
     */
    function deactivateTreasury(bytes32 treasuryId) external onlyOwner {
        TreasuryInfo storage info = treasuries[treasuryId];
        if (info.treasury == address(0)) revert TreasuryNotFound(treasuryId);

        info.active = false;
        emit TreasuryDeactivated(treasuryId, info.treasury);
    }

    /**
     * @notice Set default daily limit for new treasuries
     */
    function setDefaultDailyLimit(uint256 newLimit) external onlyOwner {
        uint256 oldLimit = defaultDailyLimit;
        defaultDailyLimit = newLimit;
        emit DefaultDailyLimitUpdated(oldLimit, newLimit);
    }

    /**
     * @notice Set creation fee
     */
    function setCreationFee(uint256 newFee) external onlyOwner {
        uint256 oldFee = creationFee;
        creationFee = newFee;
        emit CreationFeeUpdated(oldFee, newFee);
    }

    /**
     * @notice Set fee recipient
     */
    function setFeeRecipient(address newRecipient) external onlyOwner {
        address oldRecipient = feeRecipient;
        feeRecipient = newRecipient;
        emit FeeRecipientUpdated(oldRecipient, newRecipient);
    }

    /**
     * @notice Contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
