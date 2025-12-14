// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IProxyRegistry} from "./interfaces/IProxyRegistry.sol";

/**
 * @title ProxyRegistry
 * @author Jeju Network
 * @notice Registry for decentralized proxy nodes in the Jeju bandwidth marketplace
 * @dev Nodes stake JEJU/ETH to register, serve proxy requests, and earn fees
 *
 * Key Features:
 * - Permissionless node registration with staking
 * - Region-based node discovery
 * - Session tracking for reputation
 * - Slashing for misbehavior
 *
 * @custom:security-contact security@jeju.network
 */
contract ProxyRegistry is IProxyRegistry, Ownable, Pausable, ReentrancyGuard {
    // ============ State Variables ============

    /// @notice Minimum stake required to register as a node
    uint256 public override minNodeStake = 0.01 ether;

    /// @notice Protocol fee percentage (basis points, 100 = 1%)
    uint256 public protocolFeeBps = 500; // 5%

    /// @notice Coordinator address authorized to record sessions
    address public coordinator;

    /// @notice Node data by address
    mapping(address => ProxyNode) public nodes;

    /// @notice All registered node addresses
    address[] public nodeList;

    /// @notice Nodes by region (regionCode => node addresses)
    mapping(bytes32 => address[]) private _nodesByRegion;

    /// @notice Index of node in nodeList for O(1) removal
    mapping(address => uint256) private _nodeIndex;

    /// @notice Index of node in region list
    mapping(address => mapping(bytes32 => uint256)) private _regionIndex;

    /// @notice Treasury for slashed funds
    address public treasury;

    // ============ Constructor ============

    constructor(address initialOwner, address _treasury) Ownable(initialOwner) {
        treasury = _treasury;
    }

    // ============ Modifiers ============

    modifier onlyCoordinator() {
        if (msg.sender != coordinator && msg.sender != owner()) revert NotAuthorized();
        _;
    }

    // ============ Registration ============

    /**
     * @notice Register as a proxy node
     * @param regionCode Hashed region code (e.g., keccak256("US"))
     * @param endpoint Optional coordinator callback endpoint
     */
    function register(
        bytes32 regionCode,
        string calldata endpoint
    ) external payable override nonReentrant whenNotPaused {
        if (nodes[msg.sender].registeredAt != 0) revert NodeAlreadyRegistered();
        if (regionCode == bytes32(0)) revert InvalidRegion();
        if (msg.value < minNodeStake) revert InsufficientStake(msg.value, minNodeStake);

        nodes[msg.sender] = ProxyNode({
            owner: msg.sender,
            regionCode: regionCode,
            endpoint: endpoint,
            stake: msg.value,
            registeredAt: block.timestamp,
            totalBytesServed: 0,
            totalSessions: 0,
            successfulSessions: 0,
            active: true
        });

        // Track in lists
        _nodeIndex[msg.sender] = nodeList.length;
        nodeList.push(msg.sender);

        _regionIndex[msg.sender][regionCode] = _nodesByRegion[regionCode].length;
        _nodesByRegion[regionCode].push(msg.sender);

        emit NodeRegistered(msg.sender, regionCode, msg.value, endpoint);
    }

    /**
     * @notice Update node region and endpoint
     * @param regionCode New region code (or 0x0 to keep current)
     * @param endpoint New endpoint (or empty to keep current)
     */
    function updateNode(
        bytes32 regionCode,
        string calldata endpoint
    ) external override {
        ProxyNode storage node = nodes[msg.sender];
        if (node.registeredAt == 0) revert NodeNotRegistered();

        // Update region if provided
        if (regionCode != bytes32(0) && regionCode != node.regionCode) {
            // Remove from old region list
            _removeFromRegionList(msg.sender, node.regionCode);

            // Add to new region list
            _regionIndex[msg.sender][regionCode] = _nodesByRegion[regionCode].length;
            _nodesByRegion[regionCode].push(msg.sender);

            node.regionCode = regionCode;
        }

        // Update endpoint if provided
        if (bytes(endpoint).length > 0) {
            node.endpoint = endpoint;
        }

        emit NodeUpdated(msg.sender, node.regionCode, node.endpoint);
    }

    /**
     * @notice Deactivate node (can reactivate later)
     */
    function deactivate() external override {
        ProxyNode storage node = nodes[msg.sender];
        if (node.registeredAt == 0) revert NodeNotRegistered();
        if (!node.active) revert NodeNotActive();

        node.active = false;
        emit NodeDeactivated(msg.sender);
    }

    /**
     * @notice Reactivate a deactivated node
     */
    function reactivate() external override {
        ProxyNode storage node = nodes[msg.sender];
        if (node.registeredAt == 0) revert NodeNotRegistered();
        if (node.active) revert NodeStillActive();
        if (node.stake < minNodeStake) revert InsufficientStake(node.stake, minNodeStake);

        node.active = true;
        emit NodeReactivated(msg.sender);
    }

    // ============ Staking ============

    /**
     * @notice Add more stake to node
     */
    function addStake() external payable override nonReentrant {
        ProxyNode storage node = nodes[msg.sender];
        if (node.registeredAt == 0) revert NodeNotRegistered();

        node.stake += msg.value;
        emit StakeAdded(msg.sender, msg.value, node.stake);
    }

    /**
     * @notice Withdraw stake (must maintain minimum if active)
     * @param amount Amount to withdraw
     */
    function withdrawStake(uint256 amount) external override nonReentrant {
        ProxyNode storage node = nodes[msg.sender];
        if (node.registeredAt == 0) revert NodeNotRegistered();

        // If active, must maintain minimum stake
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
     * @notice Record a completed proxy session (called by coordinator)
     * @param node Node address that served the request
     * @param bytesServed Number of bytes transferred
     * @param successful Whether the session completed successfully
     */
    function recordSession(
        address node,
        uint256 bytesServed,
        bool successful
    ) external override onlyCoordinator {
        ProxyNode storage n = nodes[node];
        if (n.registeredAt == 0) revert NodeNotRegistered();

        n.totalBytesServed += bytesServed;
        n.totalSessions++;
        if (successful) {
            n.successfulSessions++;
        }

        emit SessionRecorded(node, bytesServed, successful);
    }

    // ============ View Functions ============

    /**
     * @notice Get node info
     */
    function getNode(address addr) external view override returns (ProxyNode memory) {
        return nodes[addr];
    }

    /**
     * @notice Check if node is active
     */
    function isActive(address addr) external view override returns (bool) {
        ProxyNode storage node = nodes[addr];
        return node.registeredAt != 0 && node.active;
    }

    /**
     * @notice Get all active nodes
     */
    function getActiveNodes() external view override returns (address[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < nodeList.length; i++) {
            if (nodes[nodeList[i]].active) {
                activeCount++;
            }
        }

        address[] memory activeNodes = new address[](activeCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < nodeList.length; i++) {
            if (nodes[nodeList[i]].active) {
                activeNodes[idx++] = nodeList[i];
            }
        }

        return activeNodes;
    }

    /**
     * @notice Get active nodes by region
     * @param regionCode Region to filter by
     */
    function getNodesByRegion(bytes32 regionCode) external view override returns (address[] memory) {
        address[] storage regionNodes = _nodesByRegion[regionCode];
        uint256 activeCount = 0;

        for (uint256 i = 0; i < regionNodes.length; i++) {
            if (nodes[regionNodes[i]].active) {
                activeCount++;
            }
        }

        address[] memory activeNodes = new address[](activeCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < regionNodes.length; i++) {
            if (nodes[regionNodes[i]].active) {
                activeNodes[idx++] = regionNodes[i];
            }
        }

        return activeNodes;
    }

    /**
     * @notice Get node stake
     */
    function getNodeStake(address addr) external view override returns (uint256) {
        return nodes[addr].stake;
    }

    /**
     * @notice Get total node count
     */
    function getNodeCount() external view override returns (uint256) {
        return nodeList.length;
    }

    /**
     * @notice Get node success rate (0-100)
     */
    function getSuccessRate(address addr) external view returns (uint256) {
        ProxyNode storage node = nodes[addr];
        if (node.totalSessions == 0) return 100;
        return (node.successfulSessions * 100) / node.totalSessions;
    }

    /**
     * @notice Get all registered regions
     */
    function getAllProviders() external view returns (address[] memory) {
        return nodeList;
    }

    // ============ Admin Functions ============

    /**
     * @notice Slash a misbehaving node
     * @param node Node address to slash
     * @param amount Amount to slash
     * @param reason Reason for slashing
     */
    function slash(
        address node,
        uint256 amount,
        string calldata reason
    ) external override onlyOwner {
        ProxyNode storage n = nodes[node];
        if (n.registeredAt == 0) revert NodeNotRegistered();
        if (amount > n.stake) revert SlashExceedsStake();

        n.stake -= amount;
        n.active = false;

        // Send slashed funds to treasury
        if (treasury != address(0)) {
            (bool success,) = treasury.call{value: amount}("");
            if (!success) revert TransferFailed();
        }

        emit NodeSlashed(node, amount, reason);
    }

    /**
     * @notice Update minimum node stake
     */
    function setMinNodeStake(uint256 newMinStake) external override onlyOwner {
        minNodeStake = newMinStake;
    }

    /**
     * @notice Set the coordinator address
     */
    function setCoordinator(address _coordinator) external override onlyOwner {
        coordinator = _coordinator;
    }

    /**
     * @notice Set the treasury address
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
     * @notice Pause/unpause the registry
     */
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ Internal Functions ============

    function _removeFromRegionList(address node, bytes32 regionCode) internal {
        address[] storage regionNodes = _nodesByRegion[regionCode];
        uint256 index = _regionIndex[node][regionCode];
        uint256 lastIndex = regionNodes.length - 1;

        if (index != lastIndex) {
            address lastNode = regionNodes[lastIndex];
            regionNodes[index] = lastNode;
            _regionIndex[lastNode][regionCode] = index;
        }

        regionNodes.pop();
        delete _regionIndex[node][regionCode];
    }

    /**
     * @notice Contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}

