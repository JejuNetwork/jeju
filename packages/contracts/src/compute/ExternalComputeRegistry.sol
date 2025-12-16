// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";

/**
 * @title ExternalComputeRegistry
 * @author Jeju Network
 * @notice Registry for external compute providers (Akash, etc.) bridge nodes
 * @dev Bridge nodes stake to provide access to external compute marketplaces
 *
 * ## How it works:
 * 1. Bridge nodes register with stake and link to ERC-8004 agent
 * 2. Bridge nodes store credentials in off-chain KMS (SecretVault)
 * 3. Users request deployments, paying Jeju tokens
 * 4. Bridge nodes provision on external provider and earn fees
 * 5. Failed deployments trigger slashing (revenue first, then stake)
 *
 * ## Governance Integration:
 * - Markup rates adjustable by DAO
 * - Slashing parameters adjustable by DAO
 * - Provider types can be added/removed by DAO
 *
 * @custom:security-contact security@jeju.network
 */
contract ExternalComputeRegistry is Ownable, Pausable, ReentrancyGuard {
    // ============ Types ============

    enum ProviderType {
        AKASH,
        NATIVE
    }

    enum DeploymentStatus {
        PENDING,
        ACTIVE,
        COMPLETED,
        FAILED,
        CANCELLED
    }

    struct BridgeNode {
        address operator;
        uint256 agentId;
        uint256 stake;
        uint256 revenueEarned;
        uint256 revenueSlashed;
        uint256 reputationScore; // 0-100
        uint256 activeDeployments;
        uint256 totalDeployments;
        uint256 registeredAt;
        uint256 lastActivityAt;
        bool active;
        ProviderType[] supportedProviders;
    }

    struct Deployment {
        bytes32 deploymentId;
        address user;
        address bridgeNode;
        ProviderType providerType;
        DeploymentStatus status;
        uint256 totalCost;
        uint256 paidAmount;
        uint256 startTime;
        uint256 endTime;
        uint256 createdAt;
        string externalId; // e.g., Akash dseq
    }

    struct SlashingParams {
        uint256 revenueSlashBps; // Revenue slash on failure (bps)
        uint256 stakeSlashBps; // Stake slash for repeat offenders (bps)
        uint256 minReputationForStakeProtection; // Below this, stake can be slashed
        uint256 slashingCooldownSec; // Cooldown between slashing events
    }

    struct GovernanceParams {
        uint256 defaultMarkupBps; // Default markup (10% = 1000)
        uint256 minBridgeNodeStake; // Minimum stake to register
        uint256 maxMarkupBps; // Maximum allowed markup
        uint256 deploymentDepositBps; // Required deposit from users
        bool requireAgentRegistration; // Require ERC-8004 agent
    }

    // ============ State ============

    /// @notice ERC-8004 Identity Registry
    IIdentityRegistry public identityRegistry;

    /// @notice Bridge node data
    mapping(address => BridgeNode) public bridgeNodes;

    /// @notice All bridge node addresses
    address[] public bridgeNodeList;

    /// @notice Bridge node by agent ID
    mapping(uint256 => address) public agentToBridgeNode;

    /// @notice Deployment data
    mapping(bytes32 => Deployment) public deployments;

    /// @notice User deployments
    mapping(address => bytes32[]) public userDeployments;

    /// @notice Bridge node deployments
    mapping(address => bytes32[]) public bridgeNodeDeployments;

    /// @notice Last slashing timestamp per bridge node
    mapping(address => uint256) public lastSlashTime;

    /// @notice Slashing parameters (DAO adjustable)
    SlashingParams public slashingParams;

    /// @notice Governance parameters (DAO adjustable)
    GovernanceParams public governanceParams;

    /// @notice DAO/Council address for governance
    address public governanceAddress;

    /// @notice Protocol fee recipient
    address public feeRecipient;

    /// @notice Protocol fee (bps)
    uint256 public protocolFeeBps;

    // ============ Events ============

    event BridgeNodeRegistered(
        address indexed operator,
        uint256 indexed agentId,
        uint256 stake,
        ProviderType[] supportedProviders
    );
    event BridgeNodeDeactivated(address indexed operator);
    event BridgeNodeReactivated(address indexed operator);
    event StakeAdded(address indexed operator, uint256 amount, uint256 newTotal);
    event StakeWithdrawn(address indexed operator, uint256 amount);

    event DeploymentCreated(
        bytes32 indexed deploymentId,
        address indexed user,
        address indexed bridgeNode,
        ProviderType providerType,
        uint256 totalCost
    );
    event DeploymentActivated(bytes32 indexed deploymentId, string externalId);
    event DeploymentCompleted(bytes32 indexed deploymentId);
    event DeploymentFailed(bytes32 indexed deploymentId, string reason);
    event DeploymentCancelled(bytes32 indexed deploymentId, uint256 refundAmount);

    event BridgeNodeSlashed(
        address indexed operator,
        bytes32 indexed deploymentId,
        uint256 revenueSlashed,
        uint256 stakeSlashed,
        string reason
    );

    event GovernanceParamsUpdated(
        uint256 defaultMarkupBps,
        uint256 minBridgeNodeStake,
        uint256 maxMarkupBps
    );
    event SlashingParamsUpdated(
        uint256 revenueSlashBps,
        uint256 stakeSlashBps,
        uint256 minReputationForStakeProtection
    );

    // ============ Errors ============

    error InsufficientStake(uint256 provided, uint256 required);
    error BridgeNodeAlreadyRegistered();
    error BridgeNodeNotRegistered();
    error BridgeNodeNotActive();
    error InvalidAgentId();
    error NotAgentOwner();
    error AgentAlreadyLinked();
    error DeploymentNotFound();
    error InvalidDeploymentStatus();
    error NotAuthorized();
    error SlashingCooldown();
    error TransferFailed();
    error InvalidAmount();
    error ExceedsMaxMarkup();

    // ============ Constructor ============

    constructor(address initialOwner, address _governanceAddress, address _feeRecipient) Ownable(initialOwner) {
        governanceAddress = _governanceAddress;
        feeRecipient = _feeRecipient;
        protocolFeeBps = 100; // 1% protocol fee

        slashingParams = SlashingParams({
            revenueSlashBps: 1000, // 10% of revenue
            stakeSlashBps: 100, // 1% of stake for repeat offenders
            minReputationForStakeProtection: 50,
            slashingCooldownSec: 3600 // 1 hour
        });

        governanceParams = GovernanceParams({
            defaultMarkupBps: 1000, // 10%
            minBridgeNodeStake: 0.01 ether,
            maxMarkupBps: 5000, // 50% max
            deploymentDepositBps: 500, // 5% deposit
            requireAgentRegistration: false
        });
    }

    // ============ Bridge Node Management ============

    /**
     * @notice Register as a bridge node
     * @param supportedProviders Array of supported provider types
     */
    function registerBridgeNode(ProviderType[] calldata supportedProviders)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        if (governanceParams.requireAgentRegistration) revert InvalidAgentId();
        _registerBridgeNode(supportedProviders, 0);
    }

    /**
     * @notice Register as a bridge node with ERC-8004 agent
     * @param supportedProviders Array of supported provider types
     * @param agentId ERC-8004 agent ID
     */
    function registerBridgeNodeWithAgent(
        ProviderType[] calldata supportedProviders,
        uint256 agentId
    ) external payable nonReentrant whenNotPaused {
        if (address(identityRegistry) == address(0)) revert InvalidAgentId();
        if (!identityRegistry.agentExists(agentId)) revert InvalidAgentId();
        if (identityRegistry.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        if (agentToBridgeNode[agentId] != address(0)) revert AgentAlreadyLinked();

        _registerBridgeNode(supportedProviders, agentId);
        agentToBridgeNode[agentId] = msg.sender;
    }

    function _registerBridgeNode(ProviderType[] calldata supportedProviders, uint256 agentId) internal {
        if (bridgeNodes[msg.sender].registeredAt != 0) revert BridgeNodeAlreadyRegistered();
        if (msg.value < governanceParams.minBridgeNodeStake) {
            revert InsufficientStake(msg.value, governanceParams.minBridgeNodeStake);
        }
        if (supportedProviders.length == 0) revert InvalidAmount();

        bridgeNodes[msg.sender] = BridgeNode({
            operator: msg.sender,
            agentId: agentId,
            stake: msg.value,
            revenueEarned: 0,
            revenueSlashed: 0,
            reputationScore: 80, // Start with good reputation
            activeDeployments: 0,
            totalDeployments: 0,
            registeredAt: block.timestamp,
            lastActivityAt: block.timestamp,
            active: true,
            supportedProviders: supportedProviders
        });

        bridgeNodeList.push(msg.sender);

        emit BridgeNodeRegistered(msg.sender, agentId, msg.value, supportedProviders);
    }

    /**
     * @notice Deactivate bridge node
     */
    function deactivateBridgeNode() external {
        BridgeNode storage node = bridgeNodes[msg.sender];
        if (node.registeredAt == 0) revert BridgeNodeNotRegistered();
        if (!node.active) revert BridgeNodeNotActive();

        node.active = false;
        emit BridgeNodeDeactivated(msg.sender);
    }

    /**
     * @notice Reactivate bridge node
     */
    function reactivateBridgeNode() external {
        BridgeNode storage node = bridgeNodes[msg.sender];
        if (node.registeredAt == 0) revert BridgeNodeNotRegistered();
        if (node.active) revert BridgeNodeNotActive();
        if (node.stake < governanceParams.minBridgeNodeStake) {
            revert InsufficientStake(node.stake, governanceParams.minBridgeNodeStake);
        }

        node.active = true;
        emit BridgeNodeReactivated(msg.sender);
    }

    /**
     * @notice Add stake to bridge node
     */
    function addStake() external payable nonReentrant {
        BridgeNode storage node = bridgeNodes[msg.sender];
        if (node.registeredAt == 0) revert BridgeNodeNotRegistered();

        node.stake += msg.value;
        emit StakeAdded(msg.sender, msg.value, node.stake);
    }

    /**
     * @notice Withdraw stake (must be deactivated with no active deployments)
     * @param amount Amount to withdraw
     */
    function withdrawStake(uint256 amount) external nonReentrant {
        BridgeNode storage node = bridgeNodes[msg.sender];
        if (node.registeredAt == 0) revert BridgeNodeNotRegistered();
        if (node.activeDeployments > 0) revert NotAuthorized();
        if (node.active && node.stake - amount < governanceParams.minBridgeNodeStake) {
            revert InsufficientStake(node.stake - amount, governanceParams.minBridgeNodeStake);
        }
        if (amount > node.stake) revert InvalidAmount();

        node.stake -= amount;

        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit StakeWithdrawn(msg.sender, amount);
    }

    // ============ Deployment Management ============

    /**
     * @notice Request a deployment from a bridge node
     * @param bridgeNode Address of bridge node to use
     * @param providerType External provider type
     */
    function requestDeployment(
        address bridgeNode,
        ProviderType providerType,
        uint256 /* durationHours - reserved for future use */
    ) external payable nonReentrant whenNotPaused returns (bytes32) {
        BridgeNode storage node = bridgeNodes[bridgeNode];
        if (node.registeredAt == 0) revert BridgeNodeNotRegistered();
        if (!node.active) revert BridgeNodeNotActive();

        // Verify provider is supported
        bool providerSupported = false;
        for (uint256 i = 0; i < node.supportedProviders.length; i++) {
            if (node.supportedProviders[i] == providerType) {
                providerSupported = true;
                break;
            }
        }
        if (!providerSupported) revert NotAuthorized();

        // Generate deployment ID
        bytes32 deploymentId = keccak256(
            abi.encodePacked(msg.sender, bridgeNode, block.timestamp, block.number)
        );

        // Create deployment record
        deployments[deploymentId] = Deployment({
            deploymentId: deploymentId,
            user: msg.sender,
            bridgeNode: bridgeNode,
            providerType: providerType,
            status: DeploymentStatus.PENDING,
            totalCost: msg.value,
            paidAmount: msg.value,
            startTime: 0,
            endTime: 0,
            createdAt: block.timestamp,
            externalId: ""
        });

        userDeployments[msg.sender].push(deploymentId);
        bridgeNodeDeployments[bridgeNode].push(deploymentId);

        node.activeDeployments++;
        node.lastActivityAt = block.timestamp;

        emit DeploymentCreated(deploymentId, msg.sender, bridgeNode, providerType, msg.value);

        return deploymentId;
    }

    /**
     * @notice Bridge node activates a deployment after external provisioning
     * @param deploymentId Deployment ID
     * @param externalId External provider's deployment ID
     * @param endTime Expected end time
     */
    function activateDeployment(
        bytes32 deploymentId,
        string calldata externalId,
        uint256 endTime
    ) external {
        Deployment storage deployment = deployments[deploymentId];
        if (deployment.createdAt == 0) revert DeploymentNotFound();
        if (deployment.bridgeNode != msg.sender) revert NotAuthorized();
        if (deployment.status != DeploymentStatus.PENDING) revert InvalidDeploymentStatus();

        deployment.status = DeploymentStatus.ACTIVE;
        deployment.externalId = externalId;
        deployment.startTime = block.timestamp;
        deployment.endTime = endTime;

        // Transfer payment to bridge node (minus protocol fee)
        BridgeNode storage node = bridgeNodes[msg.sender];
        uint256 protocolFee = (deployment.totalCost * protocolFeeBps) / 10000;
        uint256 bridgeNodePayment = deployment.totalCost - protocolFee;

        node.revenueEarned += bridgeNodePayment;

        // Transfer to fee recipient
        if (protocolFee > 0 && feeRecipient != address(0)) {
            (bool feeSuccess,) = feeRecipient.call{value: protocolFee}("");
            if (!feeSuccess) revert TransferFailed();
        }

        // Transfer to bridge node
        (bool success,) = msg.sender.call{value: bridgeNodePayment}("");
        if (!success) revert TransferFailed();

        emit DeploymentActivated(deploymentId, externalId);
    }

    /**
     * @notice Complete a deployment
     * @param deploymentId Deployment ID
     */
    function completeDeployment(bytes32 deploymentId) external {
        Deployment storage deployment = deployments[deploymentId];
        if (deployment.createdAt == 0) revert DeploymentNotFound();
        if (deployment.bridgeNode != msg.sender) revert NotAuthorized();
        if (deployment.status != DeploymentStatus.ACTIVE) revert InvalidDeploymentStatus();

        deployment.status = DeploymentStatus.COMPLETED;

        BridgeNode storage node = bridgeNodes[msg.sender];
        node.activeDeployments--;
        node.totalDeployments++;

        // Improve reputation for successful completion
        if (node.reputationScore < 100) {
            node.reputationScore += 1;
        }

        emit DeploymentCompleted(deploymentId);
    }

    /**
     * @notice Report a failed deployment (triggers slashing)
     * @param deploymentId Deployment ID
     * @param reason Failure reason
     */
    function reportDeploymentFailure(bytes32 deploymentId, string calldata reason) external {
        Deployment storage deployment = deployments[deploymentId];
        if (deployment.createdAt == 0) revert DeploymentNotFound();
        // Can be called by user, bridge node, or governance
        if (msg.sender != deployment.user && 
            msg.sender != deployment.bridgeNode && 
            msg.sender != governanceAddress) {
            revert NotAuthorized();
        }

        // Don't slash if already failed/cancelled
        if (deployment.status == DeploymentStatus.FAILED || 
            deployment.status == DeploymentStatus.CANCELLED) {
            revert InvalidDeploymentStatus();
        }

        address bridgeNode = deployment.bridgeNode;
        BridgeNode storage node = bridgeNodes[bridgeNode];

        // Check slashing cooldown
        if (block.timestamp - lastSlashTime[bridgeNode] < slashingParams.slashingCooldownSec) {
            revert SlashingCooldown();
        }

        // Calculate slashing amounts
        uint256 revenueSlash = (node.revenueEarned * slashingParams.revenueSlashBps) / 10000;
        uint256 stakeSlash = 0;

        // Slash stake if reputation is below threshold
        if (node.reputationScore < slashingParams.minReputationForStakeProtection) {
            stakeSlash = (node.stake * slashingParams.stakeSlashBps) / 10000;
            node.stake -= stakeSlash;
        }

        node.revenueSlashed += revenueSlash;
        node.activeDeployments--;

        // Decrease reputation
        if (node.reputationScore > 10) {
            node.reputationScore -= 10;
        } else {
            node.reputationScore = 0;
        }

        lastSlashTime[bridgeNode] = block.timestamp;
        deployment.status = DeploymentStatus.FAILED;

        // Refund user if payment was pending
        if (deployment.status == DeploymentStatus.PENDING && deployment.paidAmount > 0) {
            (bool success,) = deployment.user.call{value: deployment.paidAmount}("");
            if (!success) revert TransferFailed();
        }

        emit DeploymentFailed(deploymentId, reason);
        emit BridgeNodeSlashed(bridgeNode, deploymentId, revenueSlash, stakeSlash, reason);
    }

    /**
     * @notice Cancel a pending deployment
     * @param deploymentId Deployment ID
     */
    function cancelDeployment(bytes32 deploymentId) external nonReentrant {
        Deployment storage deployment = deployments[deploymentId];
        if (deployment.createdAt == 0) revert DeploymentNotFound();
        if (deployment.user != msg.sender) revert NotAuthorized();
        if (deployment.status != DeploymentStatus.PENDING) revert InvalidDeploymentStatus();

        deployment.status = DeploymentStatus.CANCELLED;

        BridgeNode storage node = bridgeNodes[deployment.bridgeNode];
        node.activeDeployments--;

        // Full refund for pending deployments
        uint256 refundAmount = deployment.paidAmount;
        deployment.paidAmount = 0;

        (bool success,) = msg.sender.call{value: refundAmount}("");
        if (!success) revert TransferFailed();

        emit DeploymentCancelled(deploymentId, refundAmount);
    }

    // ============ View Functions ============

    /**
     * @notice Get bridge node info
     */
    function getBridgeNode(address operator) external view returns (BridgeNode memory) {
        return bridgeNodes[operator];
    }

    /**
     * @notice Get active bridge nodes
     */
    function getActiveBridgeNodes() external view returns (address[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < bridgeNodeList.length; i++) {
            if (bridgeNodes[bridgeNodeList[i]].active) {
                activeCount++;
            }
        }

        address[] memory activeNodes = new address[](activeCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < bridgeNodeList.length; i++) {
            if (bridgeNodes[bridgeNodeList[i]].active) {
                activeNodes[idx++] = bridgeNodeList[i];
            }
        }

        return activeNodes;
    }

    /**
     * @notice Get bridge nodes by provider type
     */
    function getBridgeNodesByProvider(ProviderType providerType) external view returns (address[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < bridgeNodeList.length; i++) {
            BridgeNode storage node = bridgeNodes[bridgeNodeList[i]];
            if (!node.active) continue;
            for (uint256 j = 0; j < node.supportedProviders.length; j++) {
                if (node.supportedProviders[j] == providerType) {
                    count++;
                    break;
                }
            }
        }

        address[] memory nodes = new address[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < bridgeNodeList.length; i++) {
            BridgeNode storage node = bridgeNodes[bridgeNodeList[i]];
            if (!node.active) continue;
            for (uint256 j = 0; j < node.supportedProviders.length; j++) {
                if (node.supportedProviders[j] == providerType) {
                    nodes[idx++] = bridgeNodeList[i];
                    break;
                }
            }
        }

        return nodes;
    }

    /**
     * @notice Get deployment info
     */
    function getDeployment(bytes32 deploymentId) external view returns (Deployment memory) {
        return deployments[deploymentId];
    }

    /**
     * @notice Get user's deployments
     */
    function getUserDeployments(address user) external view returns (bytes32[] memory) {
        return userDeployments[user];
    }

    /**
     * @notice Get bridge node's deployments
     */
    function getBridgeNodeDeployments(address bridgeNode) external view returns (bytes32[] memory) {
        return bridgeNodeDeployments[bridgeNode];
    }

    /**
     * @notice Get total bridge node count
     */
    function getBridgeNodeCount() external view returns (uint256) {
        return bridgeNodeList.length;
    }

    // ============ Governance Functions ============

    /**
     * @notice Update governance parameters (DAO only)
     */
    function updateGovernanceParams(
        uint256 _defaultMarkupBps,
        uint256 _minBridgeNodeStake,
        uint256 _maxMarkupBps,
        uint256 _deploymentDepositBps,
        bool _requireAgentRegistration
    ) external {
        if (msg.sender != governanceAddress && msg.sender != owner()) revert NotAuthorized();
        if (_defaultMarkupBps > _maxMarkupBps) revert ExceedsMaxMarkup();

        governanceParams = GovernanceParams({
            defaultMarkupBps: _defaultMarkupBps,
            minBridgeNodeStake: _minBridgeNodeStake,
            maxMarkupBps: _maxMarkupBps,
            deploymentDepositBps: _deploymentDepositBps,
            requireAgentRegistration: _requireAgentRegistration
        });

        emit GovernanceParamsUpdated(_defaultMarkupBps, _minBridgeNodeStake, _maxMarkupBps);
    }

    /**
     * @notice Update slashing parameters (DAO only)
     */
    function updateSlashingParams(
        uint256 _revenueSlashBps,
        uint256 _stakeSlashBps,
        uint256 _minReputationForStakeProtection,
        uint256 _slashingCooldownSec
    ) external {
        if (msg.sender != governanceAddress && msg.sender != owner()) revert NotAuthorized();

        slashingParams = SlashingParams({
            revenueSlashBps: _revenueSlashBps,
            stakeSlashBps: _stakeSlashBps,
            minReputationForStakeProtection: _minReputationForStakeProtection,
            slashingCooldownSec: _slashingCooldownSec
        });

        emit SlashingParamsUpdated(_revenueSlashBps, _stakeSlashBps, _minReputationForStakeProtection);
    }

    /**
     * @notice Set governance address
     */
    function setGovernanceAddress(address _governanceAddress) external onlyOwner {
        governanceAddress = _governanceAddress;
    }

    /**
     * @notice Set identity registry
     */
    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        identityRegistry = IIdentityRegistry(_identityRegistry);
    }

    /**
     * @notice Set fee recipient
     */
    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        feeRecipient = _feeRecipient;
    }

    /**
     * @notice Set protocol fee
     */
    function setProtocolFeeBps(uint256 _protocolFeeBps) external onlyOwner {
        if (_protocolFeeBps > 1000) revert InvalidAmount(); // Max 10%
        protocolFeeBps = _protocolFeeBps;
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

    /**
     * @notice Contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}

