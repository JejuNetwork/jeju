// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title ITreasury
 * @notice Interface for modular treasury contracts
 * @dev Single treasury with optional TEE and profit distribution features
 */
interface ITreasury {
    // =========================================================================
    // Structs
    // =========================================================================

    struct DistributionConfig {
        uint16 protocolBps;
        uint16 stakersBps;
        uint16 insuranceBps;
        uint16 operatorBps;
    }

    // =========================================================================
    // Core Events
    // =========================================================================

    event FundsDeposited(address indexed from, address indexed token, uint256 amount);
    event FundsWithdrawn(address indexed to, address indexed token, uint256 amount);
    event DailyLimitUpdated(uint256 oldLimit, uint256 newLimit);
    event OperatorAdded(address indexed operator);
    event OperatorRemoved(address indexed operator);

    // TEE Events
    event TEEModeEnabled(uint256 heartbeatTimeout, uint256 takeoverCooldown);
    event TEEOperatorRegistered(address indexed operator, bytes attestation);
    event TEEOperatorDeactivated(address indexed operator, string reason);
    event TakeoverInitiated(address indexed newOperator, address indexed oldOperator);
    event StateUpdated(string cid, bytes32 stateHash, uint256 version);
    event HeartbeatReceived(address indexed operator, uint256 timestamp);
    event TrainingRecorded(uint256 epoch, string datasetCID, bytes32 modelHash);
    event KeyRotationExecuted(uint256 indexed requestId, uint256 newVersion);

    // Profit Distribution Events
    event ProfitDistributionEnabled(address protocol, address stakers, address insurance);
    event ProfitDeposited(address indexed depositor, address indexed token, uint256 amount);
    event ProfitDistributed(
        address indexed token,
        uint256 protocolAmount,
        uint256 stakersAmount,
        uint256 insuranceAmount,
        uint256 operatorAmount
    );
    event OperatorWithdrawal(address indexed operator, address indexed token, uint256 amount);

    // =========================================================================
    // Core Functions
    // =========================================================================

    function deposit() external payable;
    function depositToken(address token, uint256 amount) external;
    function withdrawETH(uint256 amount, address to) external;
    function withdrawToken(address token, uint256 amount, address to) external;

    // =========================================================================
    // Feature Enablement
    // =========================================================================

    function enableTEEMode(uint256 _heartbeatTimeout, uint256 _takeoverCooldown) external;
    function enableProfitDistribution(
        address _protocolRecipient,
        address _stakersRecipient,
        address _insuranceRecipient
    ) external;

    // =========================================================================
    // TEE Functions
    // =========================================================================

    function registerTEEOperator(address _operator, bytes calldata _attestation) external;
    function isTEEOperatorActive() external view returns (bool);
    function takeoverAsOperator(bytes calldata _attestation) external;
    function isTakeoverAvailable() external view returns (bool);
    function markOperatorInactive() external;
    function updateState(string calldata _cid, bytes32 _hash) external;
    function heartbeat() external;
    function recordTraining(string calldata _datasetCID, bytes32 _modelHash) external;
    function requestKeyRotation() external returns (uint256);
    function approveKeyRotation(uint256 _requestId) external;

    // =========================================================================
    // Profit Distribution Functions
    // =========================================================================

    function depositProfit() external payable;
    function depositTokenProfit(address token, uint256 amount) external;
    function distributeProfits(address token) external;
    function withdrawOperatorEarnings(address token) external;

    // =========================================================================
    // View Functions
    // =========================================================================

    function name() external view returns (string memory);
    function getBalance() external view returns (uint256);
    function getTokenBalance(address token) external view returns (uint256);
    function getWithdrawalInfo() external view returns (uint256 limit, uint256 usedToday, uint256 remaining);
    function isOperator(address account) external view returns (bool);
    function isBoardMember(address account) external view returns (bool);
    function getFeatures() external view returns (bool teeEnabled, bool profitDistributionEnabled);

    // TEE Views
    function teeOperator() external view returns (address);
    function getGameState()
        external
        view
        returns (
            string memory cid,
            bytes32 stateHash,
            uint256 _stateVersion,
            uint256 _keyVersion,
            uint256 lastBeat,
            bool operatorActive
        );
    function getTEEOperatorInfo()
        external
        view
        returns (address op, bytes memory attestation, uint256 registeredAt, bool active);

    // Profit Distribution Views
    function getDistributionConfig() external view returns (DistributionConfig memory);
    function getRecipients() external view returns (address protocol, address stakers, address insurance);
    function getPendingWithdrawal(address operator, address token) external view returns (uint256);
    function getOperatorEarnings(address operator, address token) external view returns (uint256);
}

/**
 * @title ITreasuryFactory
 * @notice Interface for the TreasuryFactory contract
 */
interface ITreasuryFactory {
    struct TreasuryInfo {
        address treasury;
        string name;
        address admin;
        uint256 createdAt;
        bool teeEnabled;
        bool profitDistributionEnabled;
    }

    event TreasuryCreated(
        bytes32 indexed treasuryId,
        address indexed treasury,
        string name,
        address indexed admin,
        bool teeEnabled,
        bool profitDistributionEnabled
    );

    function createTreasury(string calldata treasuryName, address admin, uint256 dailyLimit)
        external
        payable
        returns (bytes32 treasuryId, address treasury);

    function createTEETreasury(string calldata treasuryName, address admin, uint256 dailyLimit)
        external
        payable
        returns (bytes32 treasuryId, address treasury);

    function createProfitTreasury(
        string calldata treasuryName,
        address admin,
        uint256 dailyLimit,
        address protocolRecipient,
        address stakersRecipient,
        address insuranceRecipient
    ) external payable returns (bytes32 treasuryId, address treasury);

    function createFullTreasury(
        string calldata treasuryName,
        address admin,
        uint256 dailyLimit,
        address protocolRecipient,
        address stakersRecipient,
        address insuranceRecipient
    ) external payable returns (bytes32 treasuryId, address treasury);

    function getTreasury(bytes32 treasuryId) external view returns (TreasuryInfo memory);
    function getTreasuriesByAdmin(address admin) external view returns (bytes32[] memory);
    function getAllTreasuryIds() external view returns (bytes32[] memory);
    function getTreasuryCount() external view returns (uint256);
    function getTEETreasuries() external view returns (bytes32[] memory);
    function getProfitTreasuries() external view returns (bytes32[] memory);
}
