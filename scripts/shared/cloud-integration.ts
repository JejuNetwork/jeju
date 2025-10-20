import { ethers } from 'ethers';
import type { Logger } from './logger';
import { createSignedFeedbackAuth } from './cloud-signing';

/**
 * Cloud service integration with ERC-8004 registry and services contracts
 * Enables cloud to:
 * - Register as an agent
 * - Set reputation for users/agents
 * - Ban violators
 * - Register services in ServiceRegistry
 * - Accept x402 payments via paymasters
 */

export interface CloudConfig {
  identityRegistryAddress: string;
  reputationRegistryAddress: string;
  cloudReputationProviderAddress: string;
  serviceRegistryAddress: string;
  creditManagerAddress: string;
  provider: ethers.Provider;
  logger: Logger;
  cloudAgentSigner?: ethers.Signer; // Cloud agent's signer for feedback authorization
  chainId?: bigint;
}

export interface AgentMetadata {
  name: string;
  description: string;
  endpoint: string; // A2A endpoint
  version: string;
  capabilities: string[];
}

export interface CloudService {
  name: string;
  category: string; // "ai", "compute", "storage", etc.
  basePrice: bigint; // In elizaOS tokens (18 decimals)
  minPrice: bigint;
  maxPrice: bigint;
  x402Enabled: boolean;
  a2aEndpoint?: string;
}

export enum ViolationType {
  API_ABUSE = 0,
  RESOURCE_EXPLOITATION = 1,
  SCAMMING = 2,
  PHISHING = 3,
  HACKING = 4,
  UNAUTHORIZED_ACCESS = 5,
  DATA_THEFT = 6,
  ILLEGAL_CONTENT = 7,
  HARASSMENT = 8,
  SPAM = 9,
  TOS_VIOLATION = 10
}

export class CloudIntegration {
  private config: CloudConfig;
  private identityRegistry: ethers.Contract;
  private reputationRegistry: ethers.Contract;
  private cloudReputationProvider: ethers.Contract;
  private serviceRegistry: ethers.Contract;
  private creditManager: ethers.Contract;
  
  constructor(config: CloudConfig) {
    this.config = config;
    
    // Initialize contract interfaces
    this.identityRegistry = new ethers.Contract(
      config.identityRegistryAddress,
      [
        'function register(string calldata tokenURI) external returns (uint256 agentId)',
        'function register(string calldata tokenURI, tuple(string key, bytes value)[] calldata metadata) external returns (uint256 agentId)',
        'function setMetadata(uint256 agentId, string calldata key, bytes calldata value) external',
        'function agentExists(uint256 agentId) external view returns (bool)',
        'function ownerOf(uint256 tokenId) external view returns (address)',
        'function banAgent(uint256 agentId, string calldata reason) external'
      ],
      config.provider
    );
    
    this.reputationRegistry = new ethers.Contract(
      config.reputationRegistryAddress,
      [
        'function giveFeedback(uint256 agentId, uint8 score, bytes32 tag1, bytes32 tag2, string calldata fileuri, bytes32 filehash, bytes memory feedbackAuth) external',
        'function getSummary(uint256 agentId, address[] calldata clientAddresses, bytes32 tag1, bytes32 tag2) external view returns (uint64 count, uint8 averageScore)'
      ],
      config.provider
    );
    
    this.cloudReputationProvider = new ethers.Contract(
      config.cloudReputationProviderAddress,
      [
        'function registerCloudAgent(string calldata tokenURI, tuple(string key, bytes value)[] calldata metadata) external returns (uint256 agentId)',
        'function setReputation(uint256 agentId, uint8 score, bytes32 tag1, bytes32 tag2, string calldata reason, bytes calldata signedAuth) external',
        'function recordViolation(uint256 agentId, uint8 violationType, uint8 severityScore, string calldata evidence) external',
        'function proposeBan(uint256 agentId, uint8 reason, string calldata evidence) external returns (bytes32 proposalId)',
        'function approveBan(bytes32 proposalId) external',
        'function getAgentViolations(uint256 agentId, uint256 offset, uint256 limit) external view returns (tuple(uint256 agentId, uint8 violationType, uint8 severityScore, string evidence, uint256 timestamp, address reporter)[])',
        'function getAgentViolationCount(uint256 agentId) external view returns (uint256)',
        'function cloudAgentId() external view returns (uint256)'
      ],
      config.provider
    );
    
    this.serviceRegistry = new ethers.Contract(
      config.serviceRegistryAddress,
      [
        'function registerService(string calldata serviceName, string calldata category, uint256 basePrice, uint256 minPrice, uint256 maxPrice, address provider) external',
        'function getServiceCost(string calldata serviceName, address user) external view returns (uint256 cost)',
        'function isServiceAvailable(string calldata serviceName) external view returns (bool available)'
      ],
      config.provider
    );
    
    this.creditManager = new ethers.Contract(
      config.creditManagerAddress,
      [
        'function getBalance(address user, address token) external view returns (uint256 balance)',
        'function getAllBalances(address user) external view returns (uint256 usdcBalance, uint256 elizaBalance, uint256 ethBalance)',
        'function hasSufficientCredit(address user, address token, uint256 amount) external view returns (bool sufficient, uint256 available)'
      ],
      config.provider
    );
  }
  
  /**
   * Register cloud service as an agent in the registry
   */
  async registerCloudAgent(
    signer: ethers.Signer,
    metadata: AgentMetadata,
    tokenURI: string
  ): Promise<bigint> {
    this.config.logger.info('Registering cloud service as agent...');
    
    // Convert metadata to contract format
    const metadataEntries = [
      { key: 'name', value: ethers.toUtf8Bytes(metadata.name) },
      { key: 'description', value: ethers.toUtf8Bytes(metadata.description) },
      { key: 'endpoint', value: ethers.toUtf8Bytes(metadata.endpoint) },
      { key: 'version', value: ethers.toUtf8Bytes(metadata.version) },
      { key: 'capabilities', value: ethers.toUtf8Bytes(JSON.stringify(metadata.capabilities)) },
      { key: 'type', value: ethers.toUtf8Bytes('cloud-service') }
    ];
    
    const contract = this.cloudReputationProvider.connect(signer);
    const tx = await contract.registerCloudAgent(tokenURI, metadataEntries);
    const receipt = await tx.wait();
    
    // Extract agentId from event
    const event = receipt.logs.find((log: { topics: string[] }) => 
      log.topics[0] === ethers.id('CloudAgentRegistered(uint256)')
    );
    
    if (!event) {
      throw new Error('CloudAgentRegistered event not found');
    }
    
    const agentId = BigInt(event.topics[1]);
    this.config.logger.info(`Cloud agent registered with ID: ${agentId}`);
    
    return agentId;
  }
  
  /**
   * Register cloud services in ServiceRegistry
   */
  async registerServices(
    signer: ethers.Signer,
    services: CloudService[]
  ): Promise<void> {
    this.config.logger.info(`Registering ${services.length} cloud services...`);
    
    const contract = this.serviceRegistry.connect(signer);
    
    for (const service of services) {
      this.config.logger.info(`Registering service: ${service.name}`);
      
      const tx = await contract.registerService(
        service.name,
        service.category,
        service.basePrice,
        service.minPrice,
        service.maxPrice,
        await signer.getAddress()
      );
      
      await tx.wait();
      this.config.logger.info(`✓ ${service.name} registered`);
    }
    
    this.config.logger.info('All services registered successfully');
  }
  
  /**
   * Set reputation for an agent/user based on their behavior
   */
  async setReputation(
    signer: ethers.Signer,
    agentId: bigint,
    score: number,
    category: 'quality' | 'reliability' | 'api-usage' | 'payment' | 'security',
    subcategory: string,
    reason: string
  ): Promise<void> {
    if (score < 0 || score > 100) {
      throw new Error('Score must be between 0 and 100');
    }
    
    const tag1 = ethers.encodeBytes32String(category);
    const tag2 = ethers.encodeBytes32String(subcategory);
    
    this.config.logger.info(`Setting reputation for agent ${agentId}: ${score}/100`);
    
    // Create signed feedback authorization
    if (!this.config.cloudAgentSigner) {
      throw new Error('Cloud agent signer not configured in CloudConfig');
    }
    
    const signedAuth = await createSignedFeedbackAuth(
      this.config.cloudAgentSigner,
      agentId,
      await signer.getAddress(), // Client is the operator calling setReputation
      this.config.reputationRegistryAddress,
      this.config.chainId || 31337n
    );
    
    const contract = this.cloudReputationProvider.connect(signer);
    const tx = await contract.setReputation(
      agentId,
      score,
      tag1,
      tag2,
      reason, // IPFS hash in production
      signedAuth
    );
    
    await tx.wait();
    this.config.logger.info('Reputation set successfully');
  }
  
  /**
   * Record a violation without immediate ban
   */
  async recordViolation(
    signer: ethers.Signer,
    agentId: bigint,
    violationType: ViolationType,
    severityScore: number,
    evidence: string
  ): Promise<void> {
    if (severityScore < 0 || severityScore > 100) {
      throw new Error('Severity score must be between 0 and 100');
    }
    
    this.config.logger.warn(
      `Recording violation for agent ${agentId}: ${ViolationType[violationType]} (severity: ${severityScore})`
    );
    
    const contract = this.cloudReputationProvider.connect(signer);
    const tx = await contract.recordViolation(
      agentId,
      violationType,
      severityScore,
      evidence // IPFS hash
    );
    
    await tx.wait();
    this.config.logger.info('Violation recorded');
  }
  
  /**
   * Propose banning an agent for serious violations
   */
  async proposeBan(
    signer: ethers.Signer,
    agentId: bigint,
    violationType: ViolationType,
    evidence: string
  ): Promise<string> {
    this.config.logger.warn(
      `Proposing ban for agent ${agentId}: ${ViolationType[violationType]}`
    );
    
    const contract = this.cloudReputationProvider.connect(signer);
    const tx = await contract.proposeBan(
      agentId,
      violationType,
      evidence
    );
    
    const receipt = await tx.wait();
    
    // Extract proposalId from event
    const event = receipt.logs.find((log: { topics: string[] }) => 
      log.topics[0] === ethers.id('BanProposalCreated(bytes32,uint256,uint8,address)')
    );
    
    if (!event) {
      throw new Error('BanProposalCreated event not found');
    }
    
    const proposalId = event.topics[1];
    this.config.logger.info(`Ban proposal created: ${proposalId}`);
    
    return proposalId;
  }
  
  /**
   * Approve a ban proposal (multi-sig)
   */
  async approveBan(
    signer: ethers.Signer,
    proposalId: string
  ): Promise<void> {
    this.config.logger.info(`Approving ban proposal: ${proposalId}`);
    
    const contract = this.cloudReputationProvider.connect(signer);
    const tx = await contract.approveBan(proposalId);
    await tx.wait();
    
    this.config.logger.info('Ban proposal approved');
  }
  
  /**
   * Check if user has sufficient credit for service
   */
  async checkUserCredit(
    userAddress: string,
    serviceName: string,
    tokenAddress: string
  ): Promise<{ sufficient: boolean; available: bigint; required: bigint }> {
    // Get service cost
    const required = await this.serviceRegistry.getServiceCost(serviceName, userAddress);
    
    // Check user balance
    const [sufficient, available] = await this.creditManager.hasSufficientCredit(
      userAddress,
      tokenAddress,
      required
    );
    
    return {
      sufficient,
      available,
      required
    };
  }
  
  /**
   * Get agent's reputation summary
   */
  async getAgentReputation(
    agentId: bigint,
    category?: string
  ): Promise<{ count: bigint; averageScore: number }> {
    const tag1 = category ? ethers.encodeBytes32String(category) : ethers.ZeroHash;
    
    const [count, averageScore] = await this.reputationRegistry.getSummary(
      agentId,
      [], // All clients
      tag1,
      ethers.ZeroHash
    );
    
    return { count, averageScore };
  }
  
  /**
   * Get agent's violation history (paginated)
   */
  async getAgentViolations(
    agentId: bigint,
    offset: number = 0,
    limit: number = 100
  ) {
    return await this.cloudReputationProvider.getAgentViolations(agentId, offset, limit);
  }
  
  /**
   * Get total violation count for an agent
   */
  async getAgentViolationCount(agentId: bigint): Promise<bigint> {
    return await this.cloudReputationProvider.getAgentViolationCount(agentId);
  }
  
  /**
   * Get cloud agent ID
   */
  async getCloudAgentId(): Promise<bigint> {
    return await this.cloudReputationProvider.cloudAgentId();
  }
}

/**
 * Example cloud services configuration
 */
export const defaultCloudServices: CloudService[] = [
  {
    name: 'chat-completion',
    category: 'ai',
    basePrice: ethers.parseEther('0.001'), // 0.001 elizaOS per request
    minPrice: ethers.parseEther('0.0001'),
    maxPrice: ethers.parseEther('0.01'),
    x402Enabled: true,
    a2aEndpoint: '/a2a/chat'
  },
  {
    name: 'image-generation',
    category: 'ai',
    basePrice: ethers.parseEther('0.01'),
    minPrice: ethers.parseEther('0.001'),
    maxPrice: ethers.parseEther('0.1'),
    x402Enabled: true,
    a2aEndpoint: '/a2a/image'
  },
  {
    name: 'embeddings',
    category: 'ai',
    basePrice: ethers.parseEther('0.0001'),
    minPrice: ethers.parseEther('0.00001'),
    maxPrice: ethers.parseEther('0.001'),
    x402Enabled: true,
    a2aEndpoint: '/a2a/embed'
  },
  {
    name: 'storage',
    category: 'storage',
    basePrice: ethers.parseEther('0.0001'), // Per MB per month
    minPrice: ethers.parseEther('0.00001'),
    maxPrice: ethers.parseEther('0.001'),
    x402Enabled: true,
    a2aEndpoint: '/a2a/storage'
  },
  {
    name: 'compute',
    category: 'compute',
    basePrice: ethers.parseEther('0.001'), // Per CPU hour
    minPrice: ethers.parseEther('0.0001'),
    maxPrice: ethers.parseEther('0.01'),
    x402Enabled: true,
    a2aEndpoint: '/a2a/compute'
  }
];

