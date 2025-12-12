// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IGameTreasury
 * @author Jeju Network
 * @notice Interface for game-specific treasury contracts
 * @dev Vendor-specific game treasuries (e.g., BabylonTreasury, HyperscapeTreasury)
 *      implement this interface for consistent integration with Jeju infrastructure.
 *
 * Key Features:
 * - Rate-limited withdrawals prevent fund draining
 * - Heartbeat-based liveness monitoring
 * - Permissionless takeover after operator timeout
 * - On-chain state anchoring via IPFS CIDs
 *
 * Implementations:
 * - BabylonTreasury (vendor/babylon) - Babylon game treasury
 * - Any game can implement this for unruggable treasury management
 */
interface IGameTreasury {
    // ============ Events ============

    event OperatorRegistered(address indexed operator, bytes attestation);
    event OperatorDeactivated(address indexed operator, string reason);
    event TakeoverInitiated(address indexed newOperator, address indexed oldOperator);
    event StateUpdated(string cid, bytes32 hash, uint256 version);
    event HeartbeatReceived(address indexed operator, uint256 timestamp);
    event FundsWithdrawn(address indexed operator, uint256 amount);
    event FundsDeposited(address indexed depositor, uint256 amount);

    // ============ Funding ============

    /**
     * @notice Deposit funds into treasury (permissionless)
     */
    function deposit() external payable;

    /**
     * @notice Get treasury balance
     */
    function getBalance() external view returns (uint256);

    // ============ Operator Management ============

    /**
     * @notice Register a new TEE operator
     * @param _operator Address derived inside TEE
     * @param _attestation Remote attestation proof
     */
    function registerOperator(address _operator, bytes calldata _attestation) external;

    /**
     * @notice Check if current operator is active
     */
    function isOperatorActive() external view returns (bool);

    /**
     * @notice Permissionless takeover by a new TEE operator
     * @param _attestation New operator's attestation proof
     */
    function takeoverAsOperator(bytes calldata _attestation) external;

    /**
     * @notice Get current operator address
     */
    function operator() external view returns (address);

    // ============ Game State Management ============

    /**
     * @notice Update game state (TEE operator only)
     * @param _cid IPFS CID of encrypted state
     * @param _hash Hash of the state for integrity
     */
    function updateState(string calldata _cid, bytes32 _hash) external;

    /**
     * @notice Send heartbeat to prove liveness
     */
    function heartbeat() external;

    /**
     * @notice Get current game state info
     */
    function getGameState()
        external
        view
        returns (
            string memory cid,
            bytes32 stateHash,
            uint256 version,
            uint256 keyVer,
            uint256 lastBeat,
            bool operatorActive
        );

    // ============ Withdrawals ============

    /**
     * @notice Withdraw funds for operational costs (rate-limited)
     * @param _amount Amount to withdraw
     */
    function withdraw(uint256 _amount) external;

    /**
     * @notice Get withdrawal info
     */
    function getWithdrawalInfo() external view returns (uint256 limit, uint256 usedToday, uint256 remaining);

    // ============ Takeover ============

    /**
     * @notice Check if takeover is available
     */
    function isTakeoverAvailable() external view returns (bool);
}

/**
 * @title IGameTreasuryFactory
 * @notice Factory interface for deploying game treasuries
 * @dev Allows any game to deploy their own treasury with standard features
 */
interface IGameTreasuryFactory {
    /**
     * @notice Deploy a new game treasury
     * @param gameName Name of the game
     * @param dailyLimit Daily withdrawal limit
     * @param owner Initial owner address
     * @return treasury Address of deployed treasury
     */
    function deployTreasury(string calldata gameName, uint256 dailyLimit, address owner)
        external
        returns (address treasury);

    /**
     * @notice Get all treasuries deployed by this factory
     * @return treasuries Array of treasury addresses
     */
    function getTreasuries() external view returns (address[] memory treasuries);
}
