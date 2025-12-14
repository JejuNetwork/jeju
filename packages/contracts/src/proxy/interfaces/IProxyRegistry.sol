// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IProxyRegistry
 * @author Jeju Network
 * @notice Interface for the decentralized proxy node registry
 */
interface IProxyRegistry {
    // ============ Structs ============

    struct ProxyNode {
        address owner;
        bytes32 regionCode;       // ISO 3166-1 alpha-2 hash (e.g., keccak256("US"))
        string endpoint;          // Coordinator callback endpoint or empty for wallet nodes
        uint256 stake;
        uint256 registeredAt;
        uint256 totalBytesServed;
        uint256 totalSessions;
        uint256 successfulSessions;
        bool active;
    }

    // ============ Events ============

    event NodeRegistered(
        address indexed node,
        bytes32 indexed regionCode,
        uint256 stake,
        string endpoint
    );
    event NodeUpdated(address indexed node, bytes32 regionCode, string endpoint);
    event NodeDeactivated(address indexed node);
    event NodeReactivated(address indexed node);
    event StakeAdded(address indexed node, uint256 amount, uint256 newTotal);
    event StakeWithdrawn(address indexed node, uint256 amount);
    event NodeSlashed(address indexed node, uint256 amount, string reason);
    event SessionRecorded(
        address indexed node,
        uint256 bytesServed,
        bool successful
    );

    // ============ Errors ============

    error InsufficientStake(uint256 provided, uint256 required);
    error NodeAlreadyRegistered();
    error NodeNotRegistered();
    error NodeNotActive();
    error NodeStillActive();
    error InvalidRegion();
    error WithdrawalWouldBreachMinimum();
    error TransferFailed();
    error NotAuthorized();
    error SlashExceedsStake();

    // ============ Registration ============

    function register(
        bytes32 regionCode,
        string calldata endpoint
    ) external payable;

    function updateNode(
        bytes32 regionCode,
        string calldata endpoint
    ) external;

    function deactivate() external;

    function reactivate() external;

    // ============ Staking ============

    function addStake() external payable;

    function withdrawStake(uint256 amount) external;

    // ============ View Functions ============

    function getNode(address addr) external view returns (ProxyNode memory);

    function isActive(address addr) external view returns (bool);

    function getActiveNodes() external view returns (address[] memory);

    function getNodesByRegion(bytes32 regionCode) external view returns (address[] memory);

    function getNodeStake(address addr) external view returns (uint256);

    function getNodeCount() external view returns (uint256);

    function minNodeStake() external view returns (uint256);

    // ============ Session Recording ============

    function recordSession(
        address node,
        uint256 bytesServed,
        bool successful
    ) external;

    // ============ Admin ============

    function slash(address node, uint256 amount, string calldata reason) external;

    function setMinNodeStake(uint256 newMinStake) external;

    function setCoordinator(address coordinator) external;
}

