// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IVPNRegistry
 * @notice Interface for the VPN node registry
 */
interface IVPNRegistry {
    // ============ Structs ============

    struct NodeCapabilities {
        bool supportsWireGuard;
        bool supportsSOCKS5;
        bool supportsHTTPConnect;
        bool servesCDN;
        bool isVPNExit;
    }

    struct VPNNode {
        address operator;
        bytes2 countryCode;
        bytes32 regionHash;
        string endpoint;
        string wireguardPubKey;
        uint256 stake;
        uint256 registeredAt;
        uint256 lastSeen;
        NodeCapabilities capabilities;
        bool active;
        uint256 totalBytesServed;
        uint256 totalSessions;
        uint256 successfulSessions;
    }

    struct UserContribution {
        uint256 vpnBytesUsed;
        uint256 bytesContributed;
        uint256 periodStart;
        uint256 periodEnd;
    }

    // ============ Events ============

    event NodeRegistered(address indexed operator, bytes2 countryCode, uint256 stake, string endpoint);
    event NodeUpdated(address indexed operator, bytes2 countryCode, string endpoint);
    event NodeDeactivated(address indexed operator);
    event NodeReactivated(address indexed operator);
    event StakeAdded(address indexed operator, uint256 amount, uint256 total);
    event StakeWithdrawn(address indexed operator, uint256 amount);
    event SessionRecorded(address indexed node, address indexed client, uint256 bytesServed, bool successful);
    event NodeSlashed(address indexed operator, uint256 amount, string reason);
    event ContributionRecorded(address indexed user, uint256 bytesUsed, uint256 bytesContributed);
    event CountryStatusUpdated(bytes2 countryCode, bool allowed, bool blocked);

    // ============ Registration ============

    function register(
        bytes2 countryCode,
        bytes32 regionHash,
        string calldata endpoint,
        string calldata wireguardPubKey,
        NodeCapabilities calldata capabilities
    ) external payable;

    function updateNode(
        string calldata endpoint,
        string calldata wireguardPubKey,
        NodeCapabilities calldata capabilities
    ) external;

    function heartbeat() external;
    function deactivate() external;
    function reactivate() external;

    // ============ Staking ============

    function addStake() external payable;
    function withdrawStake(uint256 amount) external;

    // ============ Session Recording ============

    function recordSession(address nodeAddr, address client, uint256 bytesServed, bool successful) external;
    function recordContribution(address user, uint256 bytesUsed, uint256 bytesContributed) external;

    // ============ View Functions ============

    function getNode(address operator) external view returns (VPNNode memory);
    function isActive(address operator) external view returns (bool);
    function getActiveExitNodes() external view returns (address[] memory);
    function getNodesByCountry(bytes2 countryCode) external view returns (address[] memory);
    function getContribution(address user) external view returns (UserContribution memory);
    function hasReachedContributionCap(address user) external view returns (bool);
    function getRemainingQuota(address user) external view returns (uint256);
    function getNodeCount() external view returns (uint256);
    function getSuccessRate(address operator) external view returns (uint256);

    // ============ State Variables ============

    function minNodeStake() external view returns (uint256);
    function protocolFeeBps() external view returns (uint256);
    function coordinator() external view returns (address);
    function treasury() external view returns (address);
    function allowedCountries(bytes2 countryCode) external view returns (bool);
    function blockedCountries(bytes2 countryCode) external view returns (bool);
}

