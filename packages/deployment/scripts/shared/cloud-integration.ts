/**
 * Cloud Reputation Integration
 *
 * Integrates with ERC-8004 registry for cloud service registration,
 * reputation management, and x402 payments.
 */

import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  type PublicClient,
  parseAbi,
  parseEther,
  stringToBytes,
  stringToHex,
  type WalletClient,
  zeroHash,
} from 'viem'

// Helper to encode a string as bytes32 (padded to 32 bytes)
function encodeBytes32String(str: string): `0x${string}` {
  const hex = stringToHex(str, { size: 32 })
  return hex
}

import type { PrivateKeyAccount } from 'viem/accounts'
import { waitForTransactionReceipt } from 'viem/actions'
import { createSignedFeedbackAuth } from './cloud-signing'
import type { Logger } from './logger'

/**
 * Cloud service integration with ERC-8004 registry and services contracts
 * Enables cloud services to:
 * - Register as an agent
 * - Set reputation for users/agents
 * - Ban violators
 * - Register services in ServiceRegistry
 * - Accept x402 payments via paymasters
 */

export interface CloudConfig {
  identityRegistryAddress: Address
  reputationRegistryAddress: Address
  cloudReputationProviderAddress: Address
  serviceRegistryAddress: Address
  creditManagerAddress: Address
  rpcUrl: string
  chain?: Chain
  logger: Logger
  cloudAgentAccount?: PrivateKeyAccount // Cloud agent's account for feedback authorization
  chainId?: bigint
}

export interface AgentMetadata {
  name: string
  description: string
  endpoint: string // A2A endpoint
  version: string
  capabilities: string[]
}

export interface CloudService {
  name: string
  category: string // "ai", "compute", "storage", etc.
  basePrice: bigint // In elizaOS tokens (18 decimals)
  minPrice: bigint
  maxPrice: bigint
  x402Enabled: boolean
  a2aEndpoint?: string
}

export const ViolationType = {
  API_ABUSE: 0,
  RESOURCE_EXPLOITATION: 1,
  SCAMMING: 2,
  PHISHING: 3,
  HACKING: 4,
  UNAUTHORIZED_ACCESS: 5,
  DATA_THEFT: 6,
  ILLEGAL_CONTENT: 7,
  HARASSMENT: 8,
  SPAM: 9,
  TOS_VIOLATION: 10,
} as const
export type ViolationType = (typeof ViolationType)[keyof typeof ViolationType]

const ViolationTypeNames: Record<ViolationType, string> = {
  0: 'API_ABUSE',
  1: 'RESOURCE_EXPLOITATION',
  2: 'SCAMMING',
  3: 'PHISHING',
  4: 'HACKING',
  5: 'UNAUTHORIZED_ACCESS',
  6: 'DATA_THEFT',
  7: 'ILLEGAL_CONTENT',
  8: 'HARASSMENT',
  9: 'SPAM',
  10: 'TOS_VIOLATION',
}

const REPUTATION_REGISTRY_ABI = parseAbi([
  'function giveFeedback(uint256 agentId, uint8 score, bytes32 tag1, bytes32 tag2, string calldata fileuri, bytes32 filehash, bytes memory feedbackAuth) external',
  'function getSummary(uint256 agentId, address[] calldata clientAddresses, bytes32 tag1, bytes32 tag2) external view returns (uint64 count, uint8 averageScore)',
])

const CLOUD_REPUTATION_PROVIDER_ABI = parseAbi([
  'function registerCloudAgent(string calldata tokenURI, tuple(string key, bytes value)[] calldata metadata) external returns (uint256 agentId)',
  'function setReputation(uint256 agentId, uint8 score, bytes32 tag1, bytes32 tag2, string calldata reason, bytes calldata signedAuth) external',
  'function recordViolation(uint256 agentId, uint8 violationType, uint8 severityScore, string calldata evidence) external',
  'function proposeBan(uint256 agentId, uint8 reason, string calldata evidence) external returns (bytes32 proposalId)',
  'function approveBan(bytes32 proposalId) external',
  'function getAgentViolations(uint256 agentId, uint256 offset, uint256 limit) external view returns (tuple(uint256 agentId, uint8 violationType, uint8 severityScore, string evidence, uint256 timestamp, address reporter)[])',
  'function getAgentViolationCount(uint256 agentId) external view returns (uint256)',
  'function cloudAgentId() external view returns (uint256)',
  'event CloudAgentRegistered(uint256 indexed agentId)',
  'event BanProposalCreated(bytes32 indexed proposalId, uint256 indexed agentId, uint8 reason, address indexed proposer)',
])

const SERVICE_REGISTRY_ABI = parseAbi([
  'function registerService(string calldata serviceName, string calldata category, uint256 basePrice, uint256 minPrice, uint256 maxPrice, address provider) external',
  'function getServiceCost(string calldata serviceName, address user) external view returns (uint256 cost)',
  'function isServiceAvailable(string calldata serviceName) external view returns (bool available)',
])

const CREDIT_MANAGER_ABI = parseAbi([
  'function getBalance(address user, address token) external view returns (uint256 balance)',
  'function getAllBalances(address user) external view returns (uint256 usdcBalance, uint256 elizaBalance, uint256 ethBalance)',
  'function hasSufficientCredit(address user, address token, uint256 amount) external view returns (bool sufficient, uint256 available)',
])

export class CloudIntegration {
  private config: CloudConfig
  private client: PublicClient
  private walletClient: WalletClient
  private chain: Chain

  constructor(config: CloudConfig) {
    this.config = config
    this.chain =
      config.chain ||
      ({ id: Number(config.chainId || 31337n), name: 'local' } as Chain)

    this.client = createPublicClient({
      chain: this.chain,
      transport: http(config.rpcUrl),
    })

    // Wallet client will be created per-operation with account
    this.walletClient = createWalletClient({
      chain: this.chain,
      transport: http(config.rpcUrl),
    })
  }

  /**
   * Register cloud service as an agent in the registry
   */
  async registerCloudAgent(
    account: PrivateKeyAccount,
    metadata: AgentMetadata,
    tokenURI: string,
  ): Promise<bigint> {
    this.config.logger.info('Registering cloud service as agent...')

    // Convert metadata to contract format
    const metadataEntries = [
      { key: 'name', value: stringToBytes(metadata.name) },
      { key: 'description', value: stringToBytes(metadata.description) },
      { key: 'endpoint', value: stringToBytes(metadata.endpoint) },
      { key: 'version', value: stringToBytes(metadata.version) },
      {
        key: 'capabilities',
        value: stringToBytes(JSON.stringify(metadata.capabilities)),
      },
      { key: 'type', value: stringToBytes('cloud-service') },
    ]

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.config.cloudReputationProviderAddress,
      abi: CLOUD_REPUTATION_PROVIDER_ABI,
      functionName: 'registerCloudAgent',
      args: [tokenURI, metadataEntries],
      account,
    })

    const receipt = await waitForTransactionReceipt(this.client, { hash })

    // Extract agentId from event
    const eventSignature = keccak256(
      stringToBytes('CloudAgentRegistered(uint256)'),
    )
    const event = receipt.logs.find((log) => log.topics[0] === eventSignature)

    if (!event || !event.topics[1]) {
      throw new Error('CloudAgentRegistered event not found')
    }

    const agentId = BigInt(event.topics[1])
    this.config.logger.info(`Cloud agent registered with ID: ${agentId}`)

    return agentId
  }

  /**
   * Register cloud services in ServiceRegistry
   */
  async registerServices(
    account: PrivateKeyAccount,
    services: CloudService[],
  ): Promise<void> {
    this.config.logger.info(`Registering ${services.length} cloud services...`)

    for (const service of services) {
      this.config.logger.info(`Registering service: ${service.name}`)

      const hash = await this.walletClient.writeContract({
        chain: this.chain,
        address: this.config.serviceRegistryAddress,
        abi: SERVICE_REGISTRY_ABI,
        functionName: 'registerService',
        args: [
          service.name,
          service.category,
          service.basePrice,
          service.minPrice,
          service.maxPrice,
          account.address,
        ],
        account,
      })

      await waitForTransactionReceipt(this.client, { hash })
      this.config.logger.info(`✓ ${service.name} registered`)
    }

    this.config.logger.info('All services registered successfully')
  }

  /**
   * Set reputation for an agent/user based on their behavior
   */
  async setReputation(
    account: PrivateKeyAccount,
    agentId: bigint,
    score: number,
    category: 'quality' | 'reliability' | 'api-usage' | 'payment' | 'security',
    subcategory: string,
    reason: string,
  ): Promise<void> {
    if (score < 0 || score > 100) {
      throw new Error('Score must be between 0 and 100')
    }

    const tag1 = encodeBytes32String(category)
    const tag2 = encodeBytes32String(subcategory)

    this.config.logger.info(
      `Setting reputation for agent ${agentId}: ${score}/100`,
    )

    // Create signed feedback authorization
    if (!this.config.cloudAgentAccount) {
      throw new Error('Cloud agent account not configured in CloudConfig')
    }

    const signedAuth = await createSignedFeedbackAuth(
      this.config.cloudAgentAccount,
      agentId,
      account.address, // Client is the operator calling setReputation
      this.config.reputationRegistryAddress,
      this.config.chainId || 31337n,
    )

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.config.cloudReputationProviderAddress,
      abi: CLOUD_REPUTATION_PROVIDER_ABI,
      functionName: 'setReputation',
      args: [
        agentId,
        score,
        tag1,
        tag2,
        reason, // IPFS hash in production
        signedAuth,
      ],
      account,
    })

    await waitForTransactionReceipt(this.client, { hash })
    this.config.logger.info('Reputation set successfully')
  }

  /**
   * Record a violation without immediate ban
   */
  async recordViolation(
    account: PrivateKeyAccount,
    agentId: bigint,
    violationType: ViolationType,
    severityScore: number,
    evidence: string,
  ): Promise<void> {
    if (severityScore < 0 || severityScore > 100) {
      throw new Error('Severity score must be between 0 and 100')
    }

    this.config.logger.warn(
      `Recording violation for agent ${agentId}: ${ViolationTypeNames[violationType]} (severity: ${severityScore})`,
    )

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.config.cloudReputationProviderAddress,
      abi: CLOUD_REPUTATION_PROVIDER_ABI,
      functionName: 'recordViolation',
      args: [
        agentId,
        violationType,
        severityScore,
        evidence, // IPFS hash
      ],
      account,
    })

    await waitForTransactionReceipt(this.client, { hash })
    this.config.logger.info('Violation recorded')
  }

  /**
   * Propose banning an agent for serious violations
   */
  async proposeBan(
    account: PrivateKeyAccount,
    agentId: bigint,
    violationType: ViolationType,
    evidence: string,
  ): Promise<`0x${string}`> {
    this.config.logger.warn(
      `Proposing ban for agent ${agentId}: ${ViolationTypeNames[violationType]}`,
    )

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.config.cloudReputationProviderAddress,
      abi: CLOUD_REPUTATION_PROVIDER_ABI,
      functionName: 'proposeBan',
      args: [agentId, violationType, evidence],
      account,
    })

    const receipt = await waitForTransactionReceipt(this.client, { hash })

    // Extract proposalId from event
    const banEventSignature = keccak256(
      stringToBytes('BanProposalCreated(bytes32,uint256,uint8,address)'),
    )
    const event = receipt.logs.find(
      (log) => log.topics[0] === banEventSignature,
    )

    if (!event || !event.topics[1]) {
      throw new Error('BanProposalCreated event not found')
    }

    const proposalId = event.topics[1] as `0x${string}`
    this.config.logger.info(`Ban proposal created: ${proposalId}`)

    return proposalId
  }

  /**
   * Approve a ban proposal (multi-sig)
   */
  async approveBan(
    account: PrivateKeyAccount,
    proposalId: `0x${string}`,
  ): Promise<void> {
    this.config.logger.info(`Approving ban proposal: ${proposalId}`)

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.config.cloudReputationProviderAddress,
      abi: CLOUD_REPUTATION_PROVIDER_ABI,
      functionName: 'approveBan',
      args: [proposalId],
      account,
    })
    await waitForTransactionReceipt(this.client, { hash })

    this.config.logger.info('Ban proposal approved')
  }

  /**
   * Check if user has sufficient credit for service
   */
  async checkUserCredit(
    userAddress: Address,
    serviceName: string,
    tokenAddress: Address,
  ): Promise<{ sufficient: boolean; available: bigint; required: bigint }> {
    // Get service cost
    const required = await this.client.readContract({
      address: this.config.serviceRegistryAddress,
      abi: SERVICE_REGISTRY_ABI,
      functionName: 'getServiceCost',
      args: [serviceName, userAddress],
    })

    // Check user balance
    const result = await this.client.readContract({
      address: this.config.creditManagerAddress,
      abi: CREDIT_MANAGER_ABI,
      functionName: 'hasSufficientCredit',
      args: [userAddress, tokenAddress, required],
    })

    const [sufficient, available] = result as [boolean, bigint]

    return {
      sufficient,
      available,
      required,
    }
  }

  /**
   * Get agent's reputation summary
   */
  async getAgentReputation(
    agentId: bigint,
    category?: string,
  ): Promise<{ count: bigint; averageScore: number }> {
    const tag1 = category ? encodeBytes32String(category) : zeroHash

    const result = await this.client.readContract({
      address: this.config.reputationRegistryAddress,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: 'getSummary',
      args: [
        agentId,
        [], // All clients
        tag1,
        zeroHash,
      ],
    })

    const [count, averageScore] = result as [bigint, number]

    return { count, averageScore }
  }

  /**
   * Get agent's violation history (paginated)
   */
  async getAgentViolations(
    agentId: bigint,
    offset: number = 0,
    limit: number = 100,
  ) {
    return this.client.readContract({
      address: this.config.cloudReputationProviderAddress,
      abi: CLOUD_REPUTATION_PROVIDER_ABI,
      functionName: 'getAgentViolations',
      args: [agentId, BigInt(offset), BigInt(limit)],
    })
  }

  /**
   * Get total violation count for an agent
   */
  async getAgentViolationCount(agentId: bigint): Promise<bigint> {
    return this.client.readContract({
      address: this.config.cloudReputationProviderAddress,
      abi: CLOUD_REPUTATION_PROVIDER_ABI,
      functionName: 'getAgentViolationCount',
      args: [agentId],
    }) as Promise<bigint>
  }

  /**
   * Get cloud agent ID
   */
  async getCloudAgentId(): Promise<bigint> {
    return this.client.readContract({
      address: this.config.cloudReputationProviderAddress,
      abi: CLOUD_REPUTATION_PROVIDER_ABI,
      functionName: 'cloudAgentId',
    }) as Promise<bigint>
  }
}

/**
 * Example cloud services configuration
 */
export const defaultCloudServices: CloudService[] = [
  {
    name: 'chat-completion',
    category: 'ai',
    basePrice: parseEther('0.001'), // 0.001 elizaOS per request
    minPrice: parseEther('0.0001'),
    maxPrice: parseEther('0.01'),
    x402Enabled: true,
    a2aEndpoint: '/a2a/chat',
  },
  {
    name: 'image-generation',
    category: 'ai',
    basePrice: parseEther('0.01'),
    minPrice: parseEther('0.001'),
    maxPrice: parseEther('0.1'),
    x402Enabled: true,
    a2aEndpoint: '/a2a/image',
  },
  {
    name: 'embeddings',
    category: 'ai',
    basePrice: parseEther('0.0001'),
    minPrice: parseEther('0.00001'),
    maxPrice: parseEther('0.001'),
    x402Enabled: true,
    a2aEndpoint: '/a2a/embed',
  },
  {
    name: 'storage',
    category: 'storage',
    basePrice: parseEther('0.0001'), // Per MB per month
    minPrice: parseEther('0.00001'),
    maxPrice: parseEther('0.001'),
    x402Enabled: true,
    a2aEndpoint: '/a2a/storage',
  },
  {
    name: 'compute',
    category: 'compute',
    basePrice: parseEther('0.001'), // Per CPU hour
    minPrice: parseEther('0.0001'),
    maxPrice: parseEther('0.01'),
    x402Enabled: true,
    a2aEndpoint: '/a2a/compute',
  },
]
