// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

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
 * @custom:security-contact security@jejunetwork.org
 */
contract VPNRegistry is Ownable, Pausable, ReentrancyGuard {
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

    uint256 public constant CONTRIBUTION_MULTIPLIER = 3;

    uint256 public minNodeStake = 0.01 ether;
    uint256 public protocolFeeBps = 500;
    address public coordinator;
    address public treasury;
    mapping(address => VPNNode) public nodes;
    address[] public nodeList;
    mapping(address => uint256) private _nodeIndex;
    mapping(bytes2 => address[]) private _nodesByCountry;
    mapping(address => mapping(bytes2 => uint256)) private _countryIndex;
    mapping(bytes2 => bool) public allowedCountries;
    mapping(bytes2 => bool) public blockedCountries;
    mapping(address => UserContribution) public contributions;

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

    constructor(address initialOwner, address _treasury) Ownable(initialOwner) {
        treasury = _treasury;
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
        _setCountryBlocked("CN", true);
        _setCountryBlocked("RU", true);
        _setCountryBlocked("IR", true);
        _setCountryBlocked("BY", true);
        _setCountryBlocked("KP", true);
    }

    modifier onlyCoordinator() {
        if (msg.sender != coordinator && msg.sender != owner()) revert NotAuthorized();
        _;
    }

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

        _nodeIndex[msg.sender] = nodeList.length;
        nodeList.push(msg.sender);

        _countryIndex[msg.sender][countryCode] = _nodesByCountry[countryCode].length;
        _nodesByCountry[countryCode].push(msg.sender);

        emit NodeRegistered(msg.sender, countryCode, msg.value, endpoint);
    }

    function updateNode(
        string calldata endpoint,
        string calldata wireguardPubKey,
        NodeCapabilities calldata capabilities
    ) external {
        VPNNode storage node = nodes[msg.sender];
        if (node.registeredAt == 0) revert NodeNotRegistered();
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

    function heartbeat() external {
        VPNNode storage node = nodes[msg.sender];
        if (node.registeredAt == 0) revert NodeNotRegistered();
        node.lastSeen = block.timestamp;
    }

    function deactivate() external {
        VPNNode storage node = nodes[msg.sender];
        if (node.registeredAt == 0) revert NodeNotRegistered();
        if (!node.active) revert NodeNotActive();

        node.active = false;
        emit NodeDeactivated(msg.sender);
    }

    function reactivate() external {
        VPNNode storage node = nodes[msg.sender];
        if (node.registeredAt == 0) revert NodeNotRegistered();
        if (node.active) revert NodeStillActive();
        if (node.stake < minNodeStake) revert InsufficientStake(node.stake, minNodeStake);

        node.active = true;
        emit NodeReactivated(msg.sender);
    }

    function addStake() external payable nonReentrant {
        VPNNode storage node = nodes[msg.sender];
        if (node.registeredAt == 0) revert NodeNotRegistered();

        node.stake += msg.value;
        emit StakeAdded(msg.sender, msg.value, node.stake);
    }

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

    function recordSession(address nodeAddr, address client, uint256 bytesServed, bool successful)
        external
        onlyCoordinator
    {
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

    function recordContribution(address user, uint256 bytesUsed, uint256 bytesContributed) external onlyCoordinator {
        UserContribution storage contrib = contributions[user];
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

    function getNode(address operator) external view returns (VPNNode memory) {
        return nodes[operator];
    }

    function isActive(address operator) external view returns (bool) {
        VPNNode storage node = nodes[operator];
        return node.registeredAt != 0 && node.active;
    }

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

    function getContribution(address user) external view returns (UserContribution memory) {
        return contributions[user];
    }

    function hasReachedContributionCap(address user) external view returns (bool) {
        UserContribution storage contrib = contributions[user];
        uint256 cap = contrib.vpnBytesUsed * CONTRIBUTION_MULTIPLIER;
        return contrib.bytesContributed >= cap;
    }

    function getRemainingQuota(address user) external view returns (uint256) {
        UserContribution storage contrib = contributions[user];
        uint256 cap = contrib.vpnBytesUsed * CONTRIBUTION_MULTIPLIER;
        if (contrib.bytesContributed >= cap) return 0;
        return cap - contrib.bytesContributed;
    }

    function getNodeCount() external view returns (uint256) {
        return nodeList.length;
    }

    function getSuccessRate(address operator) external view returns (uint256) {
        VPNNode storage node = nodes[operator];
        if (node.totalSessions == 0) return 100;
        return (node.successfulSessions * 100) / node.totalSessions;
    }

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

    function setCountryAllowed(bytes2 countryCode, bool allowed) external onlyOwner {
        _setCountryAllowed(countryCode, allowed);
    }

    function setCountryBlocked(bytes2 countryCode, bool blocked) external onlyOwner {
        _setCountryBlocked(countryCode, blocked);
    }

    function setMinNodeStake(uint256 newMinStake) external onlyOwner {
        minNodeStake = newMinStake;
    }

    function setCoordinator(address _coordinator) external onlyOwner {
        coordinator = _coordinator;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function setProtocolFeeBps(uint256 _feeBps) external onlyOwner {
        protocolFeeBps = _feeBps;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

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

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
