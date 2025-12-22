// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title ITreasury
 * @notice Base interface for all treasury contracts
 */
interface ITreasury {
    // Events
    event FundsDeposited(address indexed from, address indexed token, uint256 amount);
    event FundsWithdrawn(address indexed to, address indexed token, uint256 amount);
    event DailyLimitUpdated(uint256 oldLimit, uint256 newLimit);
    event OperatorAdded(address indexed operator);
    event OperatorRemoved(address indexed operator);

    // Core functions
    function deposit() external payable;
    function depositToken(address token, uint256 amount) external;
    function withdrawETH(uint256 amount, address to) external;
    function withdrawToken(address token, uint256 amount, address to) external;

    // View functions
    function getBalance() external view returns (uint256);
    function getTokenBalance(address token) external view returns (uint256);
    function getWithdrawalInfo() external view returns (uint256 limit, uint256 usedToday, uint256 remaining);
    function isOperator(address account) external view returns (bool);
    function isCouncilMember(address account) external view returns (bool);
}

/**
 * @title IGameTreasury
 * @notice Interface for game treasuries with TEE operator management
 */
interface IGameTreasury is ITreasury {
    // Events
    event TEEOperatorRegistered(address indexed operator, bytes attestation);
    event TEEOperatorDeactivated(address indexed operator, string reason);
    event TakeoverInitiated(address indexed newOperator, address indexed oldOperator);
    event StateUpdated(string cid, bytes32 stateHash, uint256 version);
    event HeartbeatReceived(address indexed operator, uint256 timestamp);
    event TrainingRecorded(uint256 epoch, string datasetCID, bytes32 modelHash);
    event KeyRotationExecuted(uint256 indexed requestId, uint256 newVersion);

    // TEE Operator functions
    function registerTEEOperator(address _operator, bytes calldata _attestation) external;
    function isTEEOperatorActive() external view returns (bool);
    function takeoverAsOperator(bytes calldata _attestation) external;
    function isTakeoverAvailable() external view returns (bool);

    // State functions
    function updateState(string calldata _cid, bytes32 _hash) external;
    function heartbeat() external;
    function recordTraining(string calldata _datasetCID, bytes32 _modelHash) external;

    // View functions
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
}

/**
 * @title IProfitTreasury
 * @notice Interface for profit distribution treasuries
 */
interface IProfitTreasury is ITreasury {
    enum ProfitSource {
        DEX_ARBITRAGE,
        CROSS_CHAIN_ARBITRAGE,
        SANDWICH,
        LIQUIDATION,
        SOLVER_FEE,
        ORACLE_KEEPER,
        PLATFORM_FEE,
        OTHER
    }

    struct DistributionConfig {
        uint16 protocolBps;
        uint16 stakersBps;
        uint16 insuranceBps;
        uint16 operatorBps;
    }

    // Events
    event ProfitDeposited(
        address indexed depositor,
        address indexed token,
        uint256 amount,
        ProfitSource source,
        bytes32 txHash
    );
    event ProfitDistributed(
        address indexed token,
        uint256 protocolAmount,
        uint256 stakersAmount,
        uint256 insuranceAmount,
        uint256 operatorAmount
    );
    event OperatorWithdrawal(address indexed operator, address indexed token, uint256 amount);

    // Profit functions
    function depositProfit(ProfitSource source, bytes32 txHash) external payable;
    function depositTokenProfit(address token, uint256 amount, ProfitSource source, bytes32 txHash) external;
    function distributeProfits(address token) external;
    function withdrawOperatorEarnings(address token) external;

    // View functions
    function getDistributionConfig() external view returns (DistributionConfig memory);
    function getPendingWithdrawal(address operator, address token) external view returns (uint256);
    function getOperatorEarnings(address operator, address token) external view returns (uint256);
    function getRecipients() external view returns (address protocol, address stakers, address insurance);
}







