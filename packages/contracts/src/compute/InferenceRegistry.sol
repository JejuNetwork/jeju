// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title InferenceRegistry
 * @notice On-chain registry for AI models and inference providers
 * @dev Enables permissionless model discovery and provider registration
 *
 * Features:
 * - Register AI models with metadata (type, capabilities, pricing)
 * - Provider endpoints for serving models
 * - Quality metrics (latency, uptime, requests)
 * - TEE attestation support
 */
contract InferenceRegistry is Ownable, ReentrancyGuard {
    // =========================================================================
    // Types
    // =========================================================================
    
    enum ModelType { LLM, IMAGE_GEN, VIDEO_GEN, AUDIO_GEN, EMBEDDING, SPEECH }
    enum SourceType { OPEN_SOURCE, CLOSED_SOURCE, FINE_TUNED }
    enum HostingType { CENTRALIZED, DECENTRALIZED, HYBRID }
    enum TEEType { NONE, PHALA, MARLIN, NITRO, SGX, SEV }
    
    struct ModelPricing {
        uint256 pricePerInputToken;   // wei per token
        uint256 pricePerOutputToken;  // wei per token
        uint256 pricePerImage;        // wei per image
        uint256 pricePerVideoSecond;  // wei per second
        uint256 pricePerAudioSecond;  // wei per second
        uint256 minimumFee;           // minimum fee per request
    }
    
    struct ModelHardware {
        uint256 minGpuVram;           // GB
        uint8 recommendedGpuType;     // GPU enum
        uint256 minCpuCores;
        uint256 minMemory;            // GB
        bool teeRequired;
        TEEType teeType;
    }
    
    struct RegisteredModel {
        string modelId;               // e.g., "openai/gpt-4o"
        string name;
        string description;
        string version;
        ModelType modelType;
        SourceType sourceType;
        HostingType hostingType;
        address creator;
        string creatorName;
        string creatorWebsite;
        uint256 capabilities;         // Bitmask of capabilities
        uint256 contextWindow;        // For LLMs
        ModelPricing pricing;
        ModelHardware hardware;
        uint256 registeredAt;
        uint256 updatedAt;
        bool active;
        uint256 totalRequests;
        uint256 avgLatencyMs;
        uint256 uptime;               // Basis points (10000 = 100%)
    }
    
    struct ModelEndpoint {
        string modelId;
        address providerAddress;
        string endpoint;              // API endpoint URL
        string region;                // Geographic region
        TEEType teeType;
        bytes32 attestationHash;      // TEE attestation
        bool active;
        uint256 currentLoad;          // Current concurrent requests
        uint256 maxConcurrent;        // Max concurrent limit
        ModelPricing pricing;         // Provider-specific pricing
        uint256 registeredAt;
        uint256 lastHealthCheck;
    }
    
    // =========================================================================
    // State
    // =========================================================================
    
    /// @notice All registered models
    mapping(string => RegisteredModel) public models;
    
    /// @notice Model IDs
    string[] public modelIds;
    
    /// @notice Endpoints by model
    mapping(string => ModelEndpoint[]) public modelEndpoints;
    
    /// @notice Provider endpoints
    mapping(address => string[]) public providerModels;
    
    /// @notice Verified creators
    mapping(address => bool) public verifiedCreators;
    
    /// @notice Minimum stake for providers
    uint256 public minProviderStake = 0.01 ether;
    
    /// @notice Provider stakes
    mapping(address => uint256) public providerStakes;
    
    // =========================================================================
    // Events
    // =========================================================================
    
    event ModelRegistered(string indexed modelId, address indexed creator, ModelType modelType);
    event ModelUpdated(string indexed modelId);
    event ModelDeactivated(string indexed modelId);
    event EndpointAdded(string indexed modelId, address indexed provider, string endpoint);
    event EndpointRemoved(string indexed modelId, address indexed provider);
    event EndpointHealthUpdated(string indexed modelId, address indexed provider, bool healthy);
    event ProviderStaked(address indexed provider, uint256 amount);
    event ProviderUnstaked(address indexed provider, uint256 amount);
    event CreatorVerified(address indexed creator, bool verified);
    
    // =========================================================================
    // Constructor
    // =========================================================================
    
    constructor() Ownable(msg.sender) {}
    
    // =========================================================================
    // Model Registration
    // =========================================================================
    
    /**
     * @notice Register a new model
     */
    function registerModel(
        string calldata modelId,
        string calldata name,
        string calldata description,
        string calldata version,
        ModelType modelType,
        SourceType sourceType,
        HostingType hostingType,
        string calldata creatorName,
        string calldata creatorWebsite,
        uint256 capabilities,
        uint256 contextWindow,
        ModelPricing calldata pricing,
        ModelHardware calldata hardware
    ) external {
        require(bytes(modelId).length > 0, "Model ID required");
        require(models[modelId].registeredAt == 0, "Model exists");
        
        RegisteredModel storage model = models[modelId];
        model.modelId = modelId;
        model.name = name;
        model.description = description;
        model.version = version;
        model.modelType = modelType;
        model.sourceType = sourceType;
        model.hostingType = hostingType;
        model.creator = msg.sender;
        model.creatorName = creatorName;
        model.creatorWebsite = creatorWebsite;
        model.capabilities = capabilities;
        model.contextWindow = contextWindow;
        model.pricing = pricing;
        model.hardware = hardware;
        model.registeredAt = block.timestamp;
        model.updatedAt = block.timestamp;
        model.active = true;
        model.uptime = 10000; // 100%
        
        modelIds.push(modelId);
        
        emit ModelRegistered(modelId, msg.sender, modelType);
    }
    
    /**
     * @notice Update model metadata
     */
    function updateModel(
        string calldata modelId,
        string calldata description,
        ModelPricing calldata pricing,
        uint256 capabilities
    ) external {
        RegisteredModel storage model = models[modelId];
        require(model.creator == msg.sender, "Not creator");
        
        model.description = description;
        model.pricing = pricing;
        model.capabilities = capabilities;
        model.updatedAt = block.timestamp;
        
        emit ModelUpdated(modelId);
    }
    
    /**
     * @notice Deactivate a model
     */
    function deactivateModel(string calldata modelId) external {
        RegisteredModel storage model = models[modelId];
        require(model.creator == msg.sender || owner() == msg.sender, "Not authorized");
        model.active = false;
        emit ModelDeactivated(modelId);
    }
    
    // =========================================================================
    // Endpoint Management
    // =========================================================================
    
    /**
     * @notice Add an endpoint for serving a model
     */
    function addEndpoint(
        string calldata modelId,
        string calldata endpoint,
        string calldata region,
        TEEType teeType,
        bytes32 attestationHash,
        uint256 maxConcurrent,
        ModelPricing calldata pricing
    ) external payable {
        require(models[modelId].active, "Model not active");
        require(providerStakes[msg.sender] + msg.value >= minProviderStake, "Insufficient stake");
        
        if (msg.value > 0) {
            providerStakes[msg.sender] += msg.value;
            emit ProviderStaked(msg.sender, msg.value);
        }
        
        ModelEndpoint memory ep = ModelEndpoint({
            modelId: modelId,
            providerAddress: msg.sender,
            endpoint: endpoint,
            region: region,
            teeType: teeType,
            attestationHash: attestationHash,
            active: true,
            currentLoad: 0,
            maxConcurrent: maxConcurrent,
            pricing: pricing,
            registeredAt: block.timestamp,
            lastHealthCheck: block.timestamp
        });
        
        modelEndpoints[modelId].push(ep);
        providerModels[msg.sender].push(modelId);
        
        emit EndpointAdded(modelId, msg.sender, endpoint);
    }
    
    /**
     * @notice Remove an endpoint
     */
    function removeEndpoint(string calldata modelId, uint256 index) external {
        ModelEndpoint[] storage endpoints = modelEndpoints[modelId];
        require(index < endpoints.length, "Invalid index");
        require(endpoints[index].providerAddress == msg.sender, "Not provider");
        
        emit EndpointRemoved(modelId, msg.sender);
        
        // Remove by swapping with last
        endpoints[index] = endpoints[endpoints.length - 1];
        endpoints.pop();
    }
    
    /**
     * @notice Update endpoint health status
     */
    function updateEndpointHealth(
        string calldata modelId,
        uint256 index,
        bool healthy,
        uint256 latencyMs
    ) external {
        ModelEndpoint[] storage endpoints = modelEndpoints[modelId];
        require(index < endpoints.length, "Invalid index");
        
        ModelEndpoint storage ep = endpoints[index];
        ep.lastHealthCheck = block.timestamp;
        ep.active = healthy;
        
        // Update model average latency
        RegisteredModel storage model = models[modelId];
        if (latencyMs > 0) {
            model.avgLatencyMs = (model.avgLatencyMs + latencyMs) / 2;
        }
        
        emit EndpointHealthUpdated(modelId, ep.providerAddress, healthy);
    }
    
    /**
     * @notice Record a request (for metrics)
     */
    function recordRequest(string calldata modelId) external {
        RegisteredModel storage model = models[modelId];
        model.totalRequests++;
    }
    
    // =========================================================================
    // Staking
    // =========================================================================
    
    /**
     * @notice Stake as a provider
     */
    function stake() external payable {
        require(msg.value > 0, "No value");
        providerStakes[msg.sender] += msg.value;
        emit ProviderStaked(msg.sender, msg.value);
    }
    
    /**
     * @notice Unstake (withdrawable after cooldown)
     */
    function unstake(uint256 amount) external nonReentrant {
        require(providerStakes[msg.sender] >= amount, "Insufficient stake");
        
        // Check if provider has no active endpoints
        bool hasActiveEndpoints = false;
        for (uint256 i = 0; i < modelIds.length; i++) {
            ModelEndpoint[] storage endpoints = modelEndpoints[modelIds[i]];
            for (uint256 j = 0; j < endpoints.length; j++) {
                if (endpoints[j].providerAddress == msg.sender && endpoints[j].active) {
                    hasActiveEndpoints = true;
                    break;
                }
            }
            if (hasActiveEndpoints) break;
        }
        
        require(!hasActiveEndpoints, "Deactivate endpoints first");
        
        providerStakes[msg.sender] -= amount;
        (bool sent, ) = msg.sender.call{value: amount}("");
        require(sent, "Transfer failed");
        
        emit ProviderUnstaked(msg.sender, amount);
    }
    
    // =========================================================================
    // View Functions
    // =========================================================================
    
    /**
     * @notice Get model info
     */
    function getModel(string calldata modelId) external view returns (
        string memory name,
        ModelType modelType,
        address creator,
        uint256 capabilities,
        uint256 contextWindow,
        bool active,
        uint256 totalRequests
    ) {
        RegisteredModel storage m = models[modelId];
        return (m.name, m.modelType, m.creator, m.capabilities, m.contextWindow, m.active, m.totalRequests);
    }
    
    /**
     * @notice Get model pricing
     */
    function getModelPricing(string calldata modelId) external view returns (ModelPricing memory) {
        return models[modelId].pricing;
    }
    
    /**
     * @notice Get all endpoints for a model
     */
    function getEndpoints(string calldata modelId) external view returns (ModelEndpoint[] memory) {
        return modelEndpoints[modelId];
    }
    
    /**
     * @notice Get best available endpoint for a model
     */
    function getBestEndpoint(string calldata modelId) external view returns (
        address providerAddress,
        string memory endpoint,
        TEEType teeType,
        uint256 currentLoad
    ) {
        ModelEndpoint[] storage endpoints = modelEndpoints[modelId];
        
        uint256 bestIndex = type(uint256).max;
        uint256 lowestLoad = type(uint256).max;
        
        for (uint256 i = 0; i < endpoints.length; i++) {
            if (endpoints[i].active && endpoints[i].currentLoad < lowestLoad) {
                lowestLoad = endpoints[i].currentLoad;
                bestIndex = i;
            }
        }
        
        if (bestIndex < endpoints.length) {
            ModelEndpoint storage ep = endpoints[bestIndex];
            return (ep.providerAddress, ep.endpoint, ep.teeType, ep.currentLoad);
        }
        
        return (address(0), "", TEEType.NONE, 0);
    }
    
    /**
     * @notice Get all active models of a type
     */
    function getModelsByType(ModelType modelType) external view returns (string[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < modelIds.length; i++) {
            if (models[modelIds[i]].active && models[modelIds[i]].modelType == modelType) {
                count++;
            }
        }
        
        string[] memory result = new string[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < modelIds.length; i++) {
            if (models[modelIds[i]].active && models[modelIds[i]].modelType == modelType) {
                result[idx++] = modelIds[i];
            }
        }
        
        return result;
    }
    
    /**
     * @notice Get all model IDs
     */
    function getAllModels() external view returns (string[] memory) {
        return modelIds;
    }
    
    /**
     * @notice Get model count
     */
    function getModelCount() external view returns (uint256) {
        return modelIds.length;
    }
    
    /**
     * @notice Estimate cost for inference
     */
    function estimateCost(
        string calldata modelId,
        uint256 inputTokens,
        uint256 outputTokens
    ) external view returns (uint256) {
        ModelPricing memory p = models[modelId].pricing;
        uint256 cost = (inputTokens * p.pricePerInputToken) + (outputTokens * p.pricePerOutputToken);
        return cost < p.minimumFee ? p.minimumFee : cost;
    }
    
    // =========================================================================
    // Admin
    // =========================================================================
    
    /**
     * @notice Set minimum provider stake
     */
    function setMinProviderStake(uint256 amount) external onlyOwner {
        minProviderStake = amount;
    }
    
    /**
     * @notice Verify a creator
     */
    function setCreatorVerified(address creator, bool verified) external onlyOwner {
        verifiedCreators[creator] = verified;
        emit CreatorVerified(creator, verified);
    }
}
