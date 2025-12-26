// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IDWSTypes} from "./IDWSTypes.sol";

/**
 * @title ExternalChainProvider
 * @notice Provision external blockchain nodes (Solana, Bitcoin, etc.) via DWS
 * @dev Enables permissionless provisioning of cross-chain infrastructure
 *
 * Deployment Modes:
 * - Devnet: Local node, no TEE required
 * - Testnet: DWS-provisioned, TEE optional
 * - Mainnet: DWS-provisioned, TEE required for sensitive operations
 *
 * Flow:
 * 1. Provider registers with hardware/TEE attestation
 * 2. Consumer requests chain node (Solana RPC, validator, etc.)
 * 3. DWS provisions node on matching provider(s)
 * 4. Consumer pays via x402 or prepaid credits
 * 5. Provider earns rewards proportional to usage
 */
contract ExternalChainProvider is Ownable, Pausable, ReentrancyGuard {

    // ============ Types ============

    enum ChainType {
        Solana,
        Bitcoin,
        Cosmos,
        Polkadot,
        Near,
        Aptos,
        Sui,
        Avalanche,
        Polygon,
        Arbitrum,
        Optimism,
        Base,
        Custom
    }

    enum NodeType {
        RPC,            // Read-only RPC node
        Validator,      // Consensus validator
        Archive,        // Full archive node
        Light,          // Light client
        Indexer,        // Chain indexer
        Geyser,         // Streaming data (Solana)
        Bridge          // Bridge relay node
    }

    enum NetworkMode {
        Devnet,
        Testnet,
        Mainnet
    }

    struct ChainNodeConfig {
        ChainType chainType;
        NodeType nodeType;
        NetworkMode network;
        string version;              // e.g., "v2.1.0" for Solana
        bool teeRequired;
        string teeType;              // "intel_tdx", "amd_sev", "sgx"
        uint256 minMemoryGb;
        uint256 minStorageGb;
        uint256 minCpuCores;
        string[] additionalParams;   // Chain-specific config
    }

    struct ChainNodeProvider {
        address provider;
        bytes32 providerId;
        ChainType[] supportedChains;
        NodeType[] supportedNodes;
        NetworkMode[] supportedNetworks;
        uint256 stakedAmount;
        bytes32 teeAttestation;      // TEE attestation hash
        string endpoint;              // Provider management endpoint
        uint256 registeredAt;
        uint256 lastHeartbeat;
        bool active;
        uint256 totalNodesProvisioned;
        uint256 totalEarnings;
    }

    struct ProvisionedNode {
        bytes32 nodeId;
        bytes32 providerId;
        address consumer;
        ChainNodeConfig config;
        string rpcEndpoint;
        string wsEndpoint;
        uint256 provisionedAt;
        uint256 expiresAt;            // 0 for indefinite
        uint256 pricePerHour;
        uint256 totalPaid;
        NodeStatus status;
    }

    enum NodeStatus {
        Pending,
        Syncing,
        Active,
        Degraded,
        Stopped,
        Failed
    }

    struct ChainRequirements {
        uint256 minMemoryGb;
        uint256 minStorageGb;
        uint256 minCpuCores;
        uint256 basePricePerHour;
        bool teeRequired;
    }

    // ============ State ============

    mapping(bytes32 => ChainNodeProvider) public providers;
    mapping(address => bytes32) public providerIds;
    mapping(bytes32 => ProvisionedNode) public nodes;
    mapping(address => bytes32[]) public consumerNodes;
    mapping(bytes32 => bytes32[]) public providerNodes;

    // Chain-specific requirements
    mapping(ChainType => mapping(NetworkMode => ChainRequirements)) public chainRequirements;

    bytes32[] public allProviders;
    bytes32[] public allNodes;

    uint256 public minProviderStake = 5_000 ether;
    uint256 public protocolFeeBps = 500; // 5%
    address public treasury;
    address public delegatedStaking; // DelegatedNodeStaking contract

    // ============ Events ============

    event ProviderRegistered(
        bytes32 indexed providerId,
        address indexed provider,
        ChainType[] chains,
        uint256 stake
    );
    event ProviderUpdated(bytes32 indexed providerId, string endpoint);
    event ProviderDeactivated(bytes32 indexed providerId);

    event NodeProvisioned(
        bytes32 indexed nodeId,
        bytes32 indexed providerId,
        address indexed consumer,
        ChainType chainType,
        NodeType nodeType,
        NetworkMode network
    );
    event NodeStatusChanged(bytes32 indexed nodeId, NodeStatus oldStatus, NodeStatus newStatus);
    event NodeEndpointUpdated(bytes32 indexed nodeId, string rpcEndpoint, string wsEndpoint);
    event NodeTerminated(bytes32 indexed nodeId, address indexed consumer);

    event PaymentReceived(bytes32 indexed nodeId, address indexed payer, uint256 amount);

    // ============ Errors ============

    error AlreadyRegistered();
    error NotRegistered();
    error InsufficientStake();
    error InvalidChain();
    error NoAvailableProvider();
    error NodeNotFound();
    error Unauthorized();
    error InsufficientPayment();
    error ChainNotSupported();

    // ============ Constructor ============

    constructor(address _treasury, address _owner) Ownable(_owner) {
        treasury = _treasury;

        // Initialize Solana requirements
        chainRequirements[ChainType.Solana][NetworkMode.Devnet] = ChainRequirements({
            minMemoryGb: 8,
            minStorageGb: 50,
            minCpuCores: 4,
            basePricePerHour: 0.01 ether,
            teeRequired: false
        });
        chainRequirements[ChainType.Solana][NetworkMode.Testnet] = ChainRequirements({
            minMemoryGb: 64,
            minStorageGb: 500,
            minCpuCores: 8,
            basePricePerHour: 0.1 ether,
            teeRequired: false
        });
        chainRequirements[ChainType.Solana][NetworkMode.Mainnet] = ChainRequirements({
            minMemoryGb: 128,
            minStorageGb: 2000,
            minCpuCores: 16,
            basePricePerHour: 0.5 ether,
            teeRequired: true
        });

        // Initialize Bitcoin requirements
        chainRequirements[ChainType.Bitcoin][NetworkMode.Testnet] = ChainRequirements({
            minMemoryGb: 8,
            minStorageGb: 50,
            minCpuCores: 4,
            basePricePerHour: 0.02 ether,
            teeRequired: false
        });
        chainRequirements[ChainType.Bitcoin][NetworkMode.Mainnet] = ChainRequirements({
            minMemoryGb: 16,
            minStorageGb: 1000,
            minCpuCores: 8,
            basePricePerHour: 0.1 ether,
            teeRequired: false
        });
    }

    // ============ Provider Functions ============

    /**
     * @notice Register as an external chain provider
     * @param supportedChains Chains this provider can run
     * @param supportedNodes Node types this provider supports
     * @param supportedNetworks Networks this provider supports
     * @param endpoint Provider management endpoint
     * @param teeAttestation TEE attestation hash (0 if no TEE)
     */
    function registerProvider(
        ChainType[] calldata supportedChains,
        NodeType[] calldata supportedNodes,
        NetworkMode[] calldata supportedNetworks,
        string calldata endpoint,
        bytes32 teeAttestation
    ) external payable nonReentrant whenNotPaused returns (bytes32 providerId) {
        if (providerIds[msg.sender] != bytes32(0)) revert AlreadyRegistered();
        if (msg.value < minProviderStake) revert InsufficientStake();

        providerId = keccak256(abi.encodePacked(msg.sender, endpoint, block.timestamp));

        providers[providerId] = ChainNodeProvider({
            provider: msg.sender,
            providerId: providerId,
            supportedChains: supportedChains,
            supportedNodes: supportedNodes,
            supportedNetworks: supportedNetworks,
            stakedAmount: msg.value,
            teeAttestation: teeAttestation,
            endpoint: endpoint,
            registeredAt: block.timestamp,
            lastHeartbeat: block.timestamp,
            active: true,
            totalNodesProvisioned: 0,
            totalEarnings: 0
        });

        providerIds[msg.sender] = providerId;
        allProviders.push(providerId);

        emit ProviderRegistered(providerId, msg.sender, supportedChains, msg.value);
    }

    /**
     * @notice Provider heartbeat to prove liveness
     */
    function heartbeat() external {
        bytes32 providerId = providerIds[msg.sender];
        if (providerId == bytes32(0)) revert NotRegistered();
        providers[providerId].lastHeartbeat = block.timestamp;
    }

    /**
     * @notice Update provider endpoint
     */
    function updateEndpoint(string calldata endpoint) external {
        bytes32 providerId = providerIds[msg.sender];
        if (providerId == bytes32(0)) revert NotRegistered();
        providers[providerId].endpoint = endpoint;
        emit ProviderUpdated(providerId, endpoint);
    }

    /**
     * @notice Deactivate provider
     */
    function deactivateProvider() external {
        bytes32 providerId = providerIds[msg.sender];
        if (providerId == bytes32(0)) revert NotRegistered();
        providers[providerId].active = false;
        emit ProviderDeactivated(providerId);
    }

    // ============ Consumer Functions ============

    /**
     * @notice Request provisioning of an external chain node
     * @param config Node configuration
     * @param durationHours How long to provision (0 for indefinite)
     */
    function provisionNode(
        ChainNodeConfig calldata config,
        uint256 durationHours
    ) external payable nonReentrant whenNotPaused returns (bytes32 nodeId) {
        // Find matching provider
        bytes32 providerId = _findMatchingProvider(config);
        if (providerId == bytes32(0)) revert NoAvailableProvider();

        ChainRequirements memory req = chainRequirements[config.chainType][config.network];
        uint256 pricePerHour = req.basePricePerHour;

        // Calculate payment
        uint256 requiredPayment = durationHours > 0 ? pricePerHour * durationHours : pricePerHour * 24; // 24h minimum
        if (msg.value < requiredPayment) revert InsufficientPayment();

        nodeId = keccak256(abi.encodePacked(msg.sender, providerId, block.timestamp, config.chainType));

        nodes[nodeId] = ProvisionedNode({
            nodeId: nodeId,
            providerId: providerId,
            consumer: msg.sender,
            config: config,
            rpcEndpoint: "",
            wsEndpoint: "",
            provisionedAt: block.timestamp,
            expiresAt: durationHours > 0 ? block.timestamp + (durationHours * 1 hours) : 0,
            pricePerHour: pricePerHour,
            totalPaid: msg.value,
            status: NodeStatus.Pending
        });

        consumerNodes[msg.sender].push(nodeId);
        providerNodes[providerId].push(nodeId);
        allNodes.push(nodeId);

        providers[providerId].totalNodesProvisioned++;

        // Distribute payment
        _distributePayment(providerId, msg.value);

        emit NodeProvisioned(
            nodeId,
            providerId,
            msg.sender,
            config.chainType,
            config.nodeType,
            config.network
        );
    }

    /**
     * @notice Extend node provisioning
     */
    function extendNode(bytes32 nodeId, uint256 additionalHours) external payable {
        ProvisionedNode storage node = nodes[nodeId];
        if (node.consumer != msg.sender) revert Unauthorized();

        uint256 requiredPayment = node.pricePerHour * additionalHours;
        if (msg.value < requiredPayment) revert InsufficientPayment();

        if (node.expiresAt > 0) {
            node.expiresAt += additionalHours * 1 hours;
        }
        node.totalPaid += msg.value;

        _distributePayment(node.providerId, msg.value);

        emit PaymentReceived(nodeId, msg.sender, msg.value);
    }

    /**
     * @notice Terminate a node
     */
    function terminateNode(bytes32 nodeId) external {
        ProvisionedNode storage node = nodes[nodeId];
        if (node.consumer != msg.sender && msg.sender != owner()) revert Unauthorized();

        node.status = NodeStatus.Stopped;

        emit NodeTerminated(nodeId, msg.sender);
    }

    // ============ Provider Reporting ============

    /**
     * @notice Provider reports node is ready with endpoints
     */
    function reportNodeReady(
        bytes32 nodeId,
        string calldata rpcEndpoint,
        string calldata wsEndpoint
    ) external {
        ProvisionedNode storage node = nodes[nodeId];
        ChainNodeProvider storage provider = providers[node.providerId];
        if (provider.provider != msg.sender) revert Unauthorized();

        node.rpcEndpoint = rpcEndpoint;
        node.wsEndpoint = wsEndpoint;
        node.status = NodeStatus.Active;

        emit NodeEndpointUpdated(nodeId, rpcEndpoint, wsEndpoint);
        emit NodeStatusChanged(nodeId, NodeStatus.Pending, NodeStatus.Active);
    }

    /**
     * @notice Provider reports node status change
     */
    function reportNodeStatus(bytes32 nodeId, NodeStatus newStatus) external {
        ProvisionedNode storage node = nodes[nodeId];
        ChainNodeProvider storage provider = providers[node.providerId];
        if (provider.provider != msg.sender) revert Unauthorized();

        NodeStatus oldStatus = node.status;
        node.status = newStatus;

        emit NodeStatusChanged(nodeId, oldStatus, newStatus);
    }

    // ============ Internal ============

    function _findMatchingProvider(ChainNodeConfig calldata config) internal view returns (bytes32) {
        ChainRequirements memory req = chainRequirements[config.chainType][config.network];
        if (req.minMemoryGb == 0) revert ChainNotSupported();

        for (uint256 i = 0; i < allProviders.length; i++) {
            ChainNodeProvider storage provider = providers[allProviders[i]];

            if (!provider.active) continue;
            if (block.timestamp - provider.lastHeartbeat > 10 minutes) continue;

            // Check chain support
            bool supportsChain = false;
            for (uint256 j = 0; j < provider.supportedChains.length; j++) {
                if (provider.supportedChains[j] == config.chainType) {
                    supportsChain = true;
                    break;
                }
            }
            if (!supportsChain) continue;

            // Check node type support
            bool supportsNode = false;
            for (uint256 j = 0; j < provider.supportedNodes.length; j++) {
                if (provider.supportedNodes[j] == config.nodeType) {
                    supportsNode = true;
                    break;
                }
            }
            if (!supportsNode) continue;

            // Check network support
            bool supportsNetwork = false;
            for (uint256 j = 0; j < provider.supportedNetworks.length; j++) {
                if (provider.supportedNetworks[j] == config.network) {
                    supportsNetwork = true;
                    break;
                }
            }
            if (!supportsNetwork) continue;

            // Check TEE requirement
            if (config.teeRequired && provider.teeAttestation == bytes32(0)) continue;

            return allProviders[i];
        }

        return bytes32(0);
    }

    function _distributePayment(bytes32 providerId, uint256 amount) internal {
        uint256 protocolFee = (amount * protocolFeeBps) / 10_000;
        uint256 providerShare = amount - protocolFee;

        providers[providerId].totalEarnings += providerShare;

        // Send protocol fee to treasury
        if (protocolFee > 0) {
            (bool success, ) = payable(treasury).call{value: protocolFee}("");
            require(success, "Treasury transfer failed");
        }

        // Send provider share (or route through DelegatedNodeStaking)
        if (delegatedStaking != address(0)) {
            // Route through delegated staking for profit sharing
            (bool success, ) = payable(delegatedStaking).call{value: providerShare}("");
            require(success, "Staking transfer failed");
        } else {
            // Direct to provider
            (bool success, ) = payable(providers[providerId].provider).call{value: providerShare}("");
            require(success, "Provider transfer failed");
        }
    }

    // ============ Views ============

    function getProvider(bytes32 providerId) external view returns (ChainNodeProvider memory) {
        return providers[providerId];
    }

    function getNode(bytes32 nodeId) external view returns (ProvisionedNode memory) {
        return nodes[nodeId];
    }

    function getActiveProviders(ChainType chainType, NetworkMode network) external view returns (bytes32[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < allProviders.length; i++) {
            if (_providerSupports(allProviders[i], chainType, network)) {
                count++;
            }
        }

        bytes32[] memory result = new bytes32[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < allProviders.length; i++) {
            if (_providerSupports(allProviders[i], chainType, network)) {
                result[idx++] = allProviders[i];
            }
        }
        return result;
    }

    function _providerSupports(bytes32 providerId, ChainType chainType, NetworkMode network) internal view returns (bool) {
        ChainNodeProvider storage provider = providers[providerId];
        if (!provider.active) return false;
        if (block.timestamp - provider.lastHeartbeat > 10 minutes) return false;

        bool supportsChain = false;
        for (uint256 i = 0; i < provider.supportedChains.length; i++) {
            if (provider.supportedChains[i] == chainType) {
                supportsChain = true;
                break;
            }
        }
        if (!supportsChain) return false;

        for (uint256 i = 0; i < provider.supportedNetworks.length; i++) {
            if (provider.supportedNetworks[i] == network) {
                return true;
            }
        }
        return false;
    }

    function getConsumerNodes(address consumer) external view returns (bytes32[] memory) {
        return consumerNodes[consumer];
    }

    function getProviderNodes(bytes32 providerId) external view returns (bytes32[] memory) {
        return providerNodes[providerId];
    }

    // ============ Admin ============

    function setChainRequirements(
        ChainType chainType,
        NetworkMode network,
        ChainRequirements calldata requirements
    ) external onlyOwner {
        chainRequirements[chainType][network] = requirements;
    }

    function setMinProviderStake(uint256 stake) external onlyOwner {
        minProviderStake = stake;
    }

    function setProtocolFee(uint256 feeBps) external onlyOwner {
        require(feeBps <= 1000, "Fee too high");
        protocolFeeBps = feeBps;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function setDelegatedStaking(address _delegatedStaking) external onlyOwner {
        delegatedStaking = _delegatedStaking;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}

