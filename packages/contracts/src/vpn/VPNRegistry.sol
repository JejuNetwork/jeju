// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title VPNRegistry
 * @author Jeju Network
 * @notice Registry for decentralized VPN nodes in the Jeju network
 * @dev Extends ProxyRegistry concepts with VPN-specific features:
 *      - Country-based legal compliance
 *      - WireGuard public key storage
 *      - Capability flags (VPN relay, CDN, SOCKS5)
 *      - Fair contribution tracking
 *
 * @custom:security-contact security@jeju.network
 */
contract VPNRegistry is Ownable, Pausable, ReentrancyGuard {
    // ============ Structs ============

    /**
     * @notice VPN node capabilities
     */
    struct NodeCapabilities {
        bool supportsWireGuard;    // Can handle WireGuard tunnels
        bool supportsSOCKS5;       // Can handle SOCKS5 proxy
        bool supportsHTTPConnect;  // Can handle HTTP CONNECT
        bool servesCDN;            // Serves static assets
        bool isVPNExit;            // Acts as VPN exit node
    }

    /**
     * @notice VPN node data
     */
    struct VPNNode {
        address operator;
        bytes2 countryCode;        // ISO 3166-1 alpha-2 (e.g., "US", "DE")
        bytes32 regionHash;        // Hash of region (e.g., keccak256("us-east-1"))
        string endpoint;           // Public endpoint (host:port)
        string wireguardPubKey;    // WireGuard public key (base64)
        uint256 stake;
        uint256 registeredAt;
        uint256 lastSeen;
        NodeCapabilities capabilities;
        bool active;
        // Metrics
        uint256 totalBytesServed;
        uint256 totalSessions;
        uint256 successfulSessions;
    }

    /**
     * @notice User contribution tracking for fair sharing
     */
    struct UserContribution {
        uint256 vpnBytesUsed;      // VPN data consumed
        uint256 bytesContributed;   // Data contributed (CDN + relay)
        uint256 periodStart;
        uint256 periodEnd;
    }

    // ============ Constants ============

    uint256 public constant CONTRIBUTION_MULTIPLIER = 3; // 3x usage cap

    // ============ State Variables ============

    /// @notice Minimum stake required to register as a node
    uint256 public minNodeStake = 0.01 ether;

    /// @notice Protocol fee percentage (basis points, 100 = 1%)
    uint256 public protocolFeeBps = 500; // 5%

    /// @notice Coordinator address authorized to record sessions
    address public coordinator;

    /// @notice Treasury for protocol fees
    address public treasury;

    /// @notice Node data by operator address
    mapping(address => VPNNode) public nodes;

    /// @notice All registered node addresses
    address[] public nodeList;

    /// @notice Index of node in nodeList for O(1) removal
    mapping(address => uint256) private _nodeIndex;

    /// @notice Nodes by country code
    mapping(bytes2 => address[]) private _nodesByCountry;

    /// @notice Index in country list
    mapping(address => mapping(bytes2 => uint256)) private _countryIndex;

    /// @notice Countries where VPN exit is allowed
    mapping(bytes2 => bool) public allowedCountries;

    /// @notice Countries that are blocked entirely
    mapping(bytes2 => bool) public blockedCountries;

    /// @notice User contribution tracking
    mapping(address => UserContribution) public contributions;

    // ============ Events ============

    event NodeRegistered(
        address indexed operator,
        bytes2 countryCode,
        uint256 stake,
        string endpoint
    );

    event NodeUpdated(
        address indexed operator,
        bytes2 countryCode,
        string endpoint
    );

    event NodeDeactivated(address indexed operator);
    event NodeReactivated(address indexed operator);

    event StakeAdded(address indexed operator, uint256 amount, uint256 total);
    event StakeWithdrawn(address indexed operator, uint256 amount);

    event SessionRecorded(
        address indexed node,
        address indexed client,
        uint256 bytesServed,
        bool successful
    );

    event NodeSlashed(address indexed operator, uint256 amount, string reason);

    event ContributionRecorded(
        address indexed user,
        uint256 bytesUsed,
        uint256 bytesContributed
    );

    event CountryStatusUpdated(bytes2 countryCode, bool allowed, bool blocked);

    // ============ Errors ============

    error NodeAlreadyRegistered();
    error NodeNotRegistered();
    error NodeNotActive();
    error NodeStillActive();
    error NotAuthorized();
    error InvalidCountry();
    error CountryBlocked();
    error InsufficientStake(uint256 provided, uint256 required);
    error WithdrawalWouldBreachMinimum();
    error SlashExceedsStake();
    error TransferFailed();

    // ============ Constructor ============

    constructor(address initialOwner, address _treasury) Ownable(initialOwner) {
        treasury = _treasury;

        // Initialize allowed countries (Tier 1 & 2 jurisdictions)
        _setCountryAllowed("NL", true);
        _setCountryAllowed("CH", true);
        _setCountryAllowed("SE", true);
        _setCountryAllowed("US", true);
        _setCountryAllowed("CA", true);
        _setCountryAllowed("GB", true);
        _setCountryAllowed("DE", true);
        _setCountryAllowed("FR", true);
        _setCountryAllowed("JP", true);
        _setCountryAllowed("SG", true);
        _setCountryAllowed("AU", true);
        _setCountryAllowed("KR", true);
        _setCountryAllowed("TW", true);
        _setCountryAllowed("BR", true);

        // Initialize blocked countries
        _setCountryBlocked("CN", true);
        _setCountryBlocked("RU", true);
        _setCountryBlocked("IR", true);
        _setCountryBlocked("BY", true);
        _setCountryBlocked("KP", true);
    }

    // ============ Modifiers ============

    modifier onlyCoordinator() {
        if (msg.sender != coordinator && msg.sender != owner()) revert NotAuthorized();
        _;
    }

    // ============ Registration ============

    /**
     * @notice Register as a VPN node
     * @param countryCode ISO 3166-1 alpha-2 country code
     * @param regionHash Hash of region string
     * @param endpoint Public endpoint (host:port)
     * @param wireguardPubKey WireGuard public key (base64)
     * @param capabilities Node capabilities
     */
    function register(
        bytes2 countryCode,
        bytes32 regionHash,
        string calldata endpoint,
        string calldata wireguardPubKey,
        NodeCapabilities calldata capabilities
    ) external payable nonReentrant whenNotPaused {
        if (nodes[msg.sender].registeredAt != 0) revert NodeAlreadyRegistered();
        if (blockedCountries[countryCode]) revert CountryBlocked();
        if (msg.value < minNodeStake) revert InsufficientStake(msg.value, minNodeStake);

        // If capabilities.isVPNExit, check country is allowed
        if (capabilities.isVPNExit && !allowedCountries[countryCode]) {
            revert InvalidCountry();
        }

        nodes[msg.sender] = VPNNode({
            operator: msg.sender,
            countryCode: countryCode,
            regionHash: regionHash,
            endpoint: endpoint,
            wireguardPubKey: wireguardPubKey,
            stake: msg.value,
            registeredAt: block.timestamp,
            lastSeen: block.timestamp,
            capabilities: capabilities,
            active: true,
            totalBytesServed: 0,
            totalSessions: 0,
            successfulSessions: 0
        });

        // Track in lists
        _nodeIndex[msg.sender] = nodeList.length;
        nodeList.push(msg.sender);

        _countryIndex[msg.sender][countryCode] = _nodesByCountry[countryCode].length;
        _nodesByCountry[countryCode].push(msg.sender);

        emit NodeRegistered(msg.sender, countryCode, msg.value, endpoint);
    }

    /**
     * @notice Update node endpoint and capabilities
     */
    function updateNode(
        string calldata endpoint,
        string calldata wireguardPubKey,
        NodeCapabilities calldata capabilities
    ) external {
        VPNNode storage node = nodes[msg.sender];
        if (node.registeredAt == 0) revert NodeNotRegistered();

        // If enabling VPN exit, check country is allowed
        if (capabilities.isVPNExit && !allowedCountries[node.countryCode]) {
            revert InvalidCountry();
        }

        if (bytes(endpoint).length > 0) {
            node.endpoint = endpoint;
        }
        if (bytes(wireguardPubKey).length > 0) {
            node.wireguardPubKey = wireguardPubKey;
        }
        node.capabilities = capabilities;
        node.lastSeen = block.timestamp;

        emit NodeUpdated(msg.sender, node.countryCode, node.endpoint);
    }

    /**
     * @notice Update node's last seen timestamp
     */
    function heartbeat() external {
        VPNNode storage node = nodes[msg.sender];
        if (node.registeredAt == 0) revert NodeNotRegistered();
        node.lastSeen = block.timestamp;
    }

    /**
     * @notice Deactivate node
     */
    function deactivate() external {
        VPNNode storage node = nodes[msg.sender];
        if (node.registeredAt == 0) revert NodeNotRegistered();
        if (!node.active) revert NodeNotActive();

        node.active = false;
        emit NodeDeactivated(msg.sender);
    }

    /**
     * @notice Reactivate node
     */
    function reactivate() external {
        VPNNode storage node = nodes[msg.sender];
        if (node.registeredAt == 0) revert NodeNotRegistered();
        if (node.active) revert NodeStillActive();
        if (node.stake < minNodeStake) revert InsufficientStake(node.stake, minNodeStake);

        node.active = true;
        emit NodeReactivated(msg.sender);
    }

    // ============ Staking ============

    /**
     * @notice Add stake to node
     */
    function addStake() external payable nonReentrant {
        VPNNode storage node = nodes[msg.sender];
        if (node.registeredAt == 0) revert NodeNotRegistered();

        node.stake += msg.value;
        emit StakeAdded(msg.sender, msg.value, node.stake);
    }

    /**
     * @notice Withdraw stake (must maintain minimum if active)
     */
    function withdrawStake(uint256 amount) external nonReentrant {
        VPNNode storage node = nodes[msg.sender];
        if (node.registeredAt == 0) revert NodeNotRegistered();

        if (node.active && node.stake - amount < minNodeStake) {
            revert WithdrawalWouldBreachMinimum();
        }

        if (amount > node.stake) {
            amount = node.stake;
        }

        node.stake -= amount;

        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit StakeWithdrawn(msg.sender, amount);
    }

    // ============ Session Recording ============

    /**
     * @notice Record a VPN session (called by coordinator)
     */
    function recordSession(
        address nodeAddr,
        address client,
        uint256 bytesServed,
        bool successful
    ) external onlyCoordinator {
        VPNNode storage node = nodes[nodeAddr];
        if (node.registeredAt == 0) revert NodeNotRegistered();

        node.totalBytesServed += bytesServed;
        node.totalSessions++;
        if (successful) {
            node.successfulSessions++;
        }
        node.lastSeen = block.timestamp;

        emit SessionRecorded(nodeAddr, client, bytesServed, successful);
    }

    /**
     * @notice Record user contribution (called by coordinator)
     */
    function recordContribution(
        address user,
        uint256 bytesUsed,
        uint256 bytesContributed
    ) external onlyCoordinator {
        UserContribution storage contrib = contributions[user];

        // Reset if period expired (monthly)
        if (block.timestamp > contrib.periodEnd) {
            contrib.vpnBytesUsed = 0;
            contrib.bytesContributed = 0;
            contrib.periodStart = block.timestamp;
            contrib.periodEnd = block.timestamp + 30 days;
        }

        contrib.vpnBytesUsed += bytesUsed;
        contrib.bytesContributed += bytesContributed;

        emit ContributionRecorded(user, bytesUsed, bytesContributed);
    }

    // ============ View Functions ============

    /**
     * @notice Get node info
     */
    function getNode(address operator) external view returns (VPNNode memory) {
        return nodes[operator];
    }

    /**
     * @notice Check if node is active
     */
    function isActive(address operator) external view returns (bool) {
        VPNNode storage node = nodes[operator];
        return node.registeredAt != 0 && node.active;
    }

    /**
     * @notice Get all active VPN exit nodes
     */
    function getActiveExitNodes() external view returns (address[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < nodeList.length; i++) {
            VPNNode storage node = nodes[nodeList[i]];
            if (node.active && node.capabilities.isVPNExit) {
                count++;
            }
        }

        address[] memory result = new address[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < nodeList.length; i++) {
            VPNNode storage node = nodes[nodeList[i]];
            if (node.active && node.capabilities.isVPNExit) {
                result[idx++] = nodeList[i];
            }
        }
        return result;
    }

    /**
     * @notice Get nodes by country
     */
    function getNodesByCountry(bytes2 countryCode) external view returns (address[] memory) {
        address[] storage countryNodes = _nodesByCountry[countryCode];
        uint256 activeCount = 0;

        for (uint256 i = 0; i < countryNodes.length; i++) {
            if (nodes[countryNodes[i]].active) {
                activeCount++;
            }
        }

        address[] memory result = new address[](activeCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < countryNodes.length; i++) {
            if (nodes[countryNodes[i]].active) {
                result[idx++] = countryNodes[i];
            }
        }
        return result;
    }

    /**
     * @notice Get user's contribution status
     */
    function getContribution(address user) external view returns (UserContribution memory) {
        return contributions[user];
    }

    /**
     * @notice Check if user has reached contribution cap
     */
    function hasReachedContributionCap(address user) external view returns (bool) {
        UserContribution storage contrib = contributions[user];
        uint256 cap = contrib.vpnBytesUsed * CONTRIBUTION_MULTIPLIER;
        return contrib.bytesContributed >= cap;
    }

    /**
     * @notice Get remaining contribution quota
     */
    function getRemainingQuota(address user) external view returns (uint256) {
        UserContribution storage contrib = contributions[user];
        uint256 cap = contrib.vpnBytesUsed * CONTRIBUTION_MULTIPLIER;
        if (contrib.bytesContributed >= cap) return 0;
        return cap - contrib.bytesContributed;
    }

    /**
     * @notice Get node count
     */
    function getNodeCount() external view returns (uint256) {
        return nodeList.length;
    }

    /**
     * @notice Get node success rate
     */
    function getSuccessRate(address operator) external view returns (uint256) {
        VPNNode storage node = nodes[operator];
        if (node.totalSessions == 0) return 100;
        return (node.successfulSessions * 100) / node.totalSessions;
    }

    // ============ Admin Functions ============

    /**
     * @notice Slash a misbehaving node
     */
    function slash(address nodeAddr, uint256 amount, string calldata reason) external onlyOwner {
        VPNNode storage node = nodes[nodeAddr];
        if (node.registeredAt == 0) revert NodeNotRegistered();
        if (amount > node.stake) revert SlashExceedsStake();

        node.stake -= amount;
        node.active = false;

        if (treasury != address(0)) {
            (bool success,) = treasury.call{value: amount}("");
            if (!success) revert TransferFailed();
        }

        emit NodeSlashed(nodeAddr, amount, reason);
    }

    /**
     * @notice Set country as allowed for VPN exit
     */
    function setCountryAllowed(bytes2 countryCode, bool allowed) external onlyOwner {
        _setCountryAllowed(countryCode, allowed);
    }

    /**
     * @notice Set country as blocked entirely
     */
    function setCountryBlocked(bytes2 countryCode, bool blocked) external onlyOwner {
        _setCountryBlocked(countryCode, blocked);
    }

    /**
     * @notice Set minimum node stake
     */
    function setMinNodeStake(uint256 newMinStake) external onlyOwner {
        minNodeStake = newMinStake;
    }

    /**
     * @notice Set coordinator address
     */
    function setCoordinator(address _coordinator) external onlyOwner {
        coordinator = _coordinator;
    }

    /**
     * @notice Set treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    /**
     * @notice Set protocol fee
     */
    function setProtocolFeeBps(uint256 _feeBps) external onlyOwner {
        protocolFeeBps = _feeBps;
    }

    /**
     * @notice Pause/unpause
     */
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ Internal Functions ============

    function _setCountryAllowed(bytes2 countryCode, bool allowed) internal {
        allowedCountries[countryCode] = allowed;
        emit CountryStatusUpdated(countryCode, allowed, blockedCountries[countryCode]);
    }

    function _setCountryBlocked(bytes2 countryCode, bool blocked) internal {
        blockedCountries[countryCode] = blocked;
        if (blocked) {
            allowedCountries[countryCode] = false;
        }
        emit CountryStatusUpdated(countryCode, allowedCountries[countryCode], blocked);
    }

    /**
     * @notice Contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}

