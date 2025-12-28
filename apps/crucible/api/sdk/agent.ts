import { ZERO_ADDRESS } from '@jejunetwork/types'
import {
  type Address,
  isAddress,
  type PublicClient,
  parseAbi,
  parseEther,
} from 'viem'
import type {
  AgentCharacter,
  AgentDefinition,
  AgentSearchFilter,
  AgentState,
  CrucibleConfig,
  MemoryEntry,
  SearchResult,
} from '../../lib/types'
import type { KMSSigner } from './kms-signer'

/** Agent registration data from IdentityRegistry contract */
interface AgentRegistration {
  agentId: bigint
  owner: Address
  tier: number
  stakedToken: Address
  stakedAmount: bigint
  registeredAt: bigint
  lastActivityAt: bigint
  isBanned: boolean
  isSlashed: boolean
}

import { AgentSearchResponseSchema, expect, expectTrue } from '../schemas'
import type { CrucibleCompute } from './compute'
import { createLogger, type Logger } from './logger'
import type { CrucibleStorage } from './storage'

// ABI matching actual IdentityRegistry.sol contract
const IDENTITY_REGISTRY_ABI = parseAbi([
  'function register(string tokenURI_) external returns (uint256 agentId)',
  'function getAgent(uint256 agentId) external view returns ((uint256 agentId, address owner, uint8 tier, address stakedToken, uint256 stakedAmount, uint256 registeredAt, uint256 lastActivityAt, bool isBanned, bool isSlashed))',
  'function setAgentUri(uint256 agentId, string newTokenURI) external',
  'function agentExists(uint256 agentId) external view returns (bool)',
  'function ownerOf(uint256 agentId) external view returns (address)',
  'function tokenURI(uint256 agentId) external view returns (string)',
  'event Registered(uint256 indexed agentId, address indexed owner, uint8 tier, uint256 stakedAmount, string tokenURI)',
])

const AGENT_VAULT_ABI = parseAbi([
  'function createVault(uint256 agentId) external payable returns (address vault)',
  'function getVault(uint256 agentId) external view returns (address)',
  'function deposit(uint256 agentId) external payable',
  'function withdraw(uint256 agentId, uint256 amount) external',
  'function getBalance(uint256 agentId) external view returns (uint256)',
  'function setSpendLimit(uint256 agentId, uint256 limit) external',
  'function approveSpender(uint256 agentId, address spender) external',
  'function spend(uint256 agentId, address recipient, uint256 amount, string reason) external',
  'event VaultCreated(uint256 indexed agentId, address vault)',
  'event Deposit(uint256 indexed agentId, address from, uint256 amount)',
  'event Spent(uint256 indexed agentId, address recipient, uint256 amount, string reason)',
])

export interface AgentSDKConfig {
  crucibleConfig: CrucibleConfig
  storage: CrucibleStorage
  compute: CrucibleCompute
  publicClient: PublicClient
  /** KMS-backed signer for threshold signing */
  kmsSigner: KMSSigner
  logger?: Logger
}

export class AgentSDK {
  private config: CrucibleConfig
  private storage: CrucibleStorage
  private compute: CrucibleCompute
  private publicClient: PublicClient
  private kmsSigner: KMSSigner
  private log: Logger

  constructor(sdkConfig: AgentSDKConfig) {
    this.config = sdkConfig.crucibleConfig
    this.storage = sdkConfig.storage
    this.compute = sdkConfig.compute
    this.publicClient = sdkConfig.publicClient
    this.kmsSigner = sdkConfig.kmsSigner
    this.log = sdkConfig.logger ?? createLogger('AgentSDK')
  }

  /**
   * Check if write operations are available (KMS configured)
   */
  canWrite(): boolean {
    return this.kmsSigner.isInitialized()
  }

  /**
   * Execute a contract write using KMS
   */
  private async executeWrite(params: {
    address: Address
    abi: readonly unknown[]
    functionName: string
    args?: readonly unknown[]
    value?: bigint
  }): Promise<`0x${string}`> {
    if (!this.kmsSigner.isInitialized()) {
      throw new Error('KMS signer not initialized')
    }
    this.log.debug('Executing write via KMS', {
      functionName: params.functionName,
    })
    return this.kmsSigner.signContractWrite(params)
  }

  async registerAgent(
    character: AgentCharacter,
    options?: {
      initialFunding?: bigint
      botType?: 'ai_agent' | 'trading_bot' | 'org_tool'
    },
  ): Promise<{
    agentId: bigint
    vaultAddress: Address
    characterCid: string
    stateCid: string
  }> {
    if (!this.canWrite()) {
      throw new Error('Signer required for registration (KMS or wallet)')
    }

    this.log.info('Registering agent', {
      name: character.name,
      id: character.id,
    })

    const characterCid = await this.storage.storeCharacter(character)
    const initialState = this.storage.createInitialState(character.id)
    const stateCid = await this.storage.storeAgentState(initialState)
    const tokenUri = `ipfs://${characterCid}#state=${stateCid}`

    this.log.debug('Stored character and state', { characterCid, stateCid })

    const txHash = await this.executeWrite({
      address: this.config.contracts.identityRegistry,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'register',
      args: [tokenUri],
    })
    this.log.debug('Registration tx submitted', { txHash })

    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
    })

    const log = receipt.logs[0]
    if (!log) {
      throw new Error('Agent registration failed: no logs in receipt')
    }
    const topic = log.topics[1]
    if (!topic) {
      throw new Error(
        'Agent registration failed: agent ID not found in log topics',
      )
    }
    const agentId = BigInt(topic)

    this.log.info('Agent registered', { agentId: agentId.toString(), txHash })

    const vaultAddress = await this.createVault(
      agentId,
      options?.initialFunding,
    )

    return { agentId, vaultAddress, characterCid, stateCid }
  }

  async createVault(
    agentId: bigint,
    initialFunding?: bigint,
  ): Promise<Address> {
    if (!this.canWrite()) {
      throw new Error('Signer required for vault creation (KMS or wallet)')
    }
    expectTrue(agentId > 0n, 'Agent ID must be greater than 0')

    const funding = initialFunding ?? parseEther('0.01')
    expectTrue(funding >= 0n, 'Funding must be non-negative')
    this.log.info('Creating vault', {
      agentId: agentId.toString(),
      funding: funding.toString(),
    })

    const txHash = await this.executeWrite({
      address: this.config.contracts.agentVault,
      abi: AGENT_VAULT_ABI,
      functionName: 'createVault',
      args: [agentId],
      value: funding,
    })
    await this.publicClient.waitForTransactionReceipt({ hash: txHash })

    const vaultAddress = (await this.publicClient.readContract({
      address: this.config.contracts.agentVault,
      abi: AGENT_VAULT_ABI,
      functionName: 'getVault',
      args: [agentId],
    })) as Address

    this.log.info('Vault created', {
      agentId: agentId.toString(),
      vaultAddress,
    })
    return vaultAddress
  }

  async getAgent(agentId: bigint): Promise<AgentDefinition | null> {
    this.log.debug('Getting agent', { agentId: agentId.toString() })

    const exists = (await this.publicClient.readContract({
      address: this.config.contracts.identityRegistry,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'agentExists',
      args: [agentId],
    })) as boolean

    if (!exists) {
      this.log.debug('Agent not found', { agentId: agentId.toString() })
      return null
    }

    // Get AgentRegistration struct from contract
    const registration = (await this.publicClient.readContract({
      address: this.config.contracts.identityRegistry,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getAgent',
      args: [agentId],
    })) as AgentRegistration

    // Get tokenURI for character/state CIDs
    const tokenUri = await this.publicClient.readContract({
      address: this.config.contracts.identityRegistry,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'tokenURI',
      args: [agentId],
    })

    const { characterCid, stateCid } = this.parseTokenUri(tokenUri)

    // Get vault address
    const vaultAddress = await this.publicClient.readContract({
      address: this.config.contracts.agentVault,
      abi: AGENT_VAULT_ABI,
      functionName: 'getVault',
      args: [agentId],
    })

    // Get name from character (stored in IPFS)
    let name = `Agent ${agentId}`
    if (characterCid) {
      const character = await this.storage.loadCharacter(characterCid)
      name = character.name
    }

    // Infer botType from character or default to ai_agent
    let botType: 'ai_agent' | 'trading_bot' | 'org_tool' = 'ai_agent'
    if (characterCid) {
      const character = await this.storage.loadCharacter(characterCid)
      if (
        character.topics.includes('trading') ||
        character.topics.includes('arbitrage') ||
        character.topics.includes('mev')
      ) {
        botType = 'trading_bot'
      } else if (
        character.topics.includes('org') ||
        character.topics.includes('todo') ||
        character.topics.includes('team')
      ) {
        botType = 'org_tool'
      }
    }

    return {
      agentId,
      owner: registration.owner,
      name,
      botType,
      characterCid,
      stateCid,
      vaultAddress,
      active: !registration.isBanned,
      registeredAt: Number(registration.registeredAt) * 1000,
      lastExecutedAt: Number(registration.lastActivityAt) * 1000,
      executionCount: 0,
    }
  }

  async loadCharacter(agentId: bigint): Promise<AgentCharacter> {
    expectTrue(agentId > 0n, 'Agent ID must be greater than 0')
    const agent = await this.getAgent(agentId)
    const validAgent = expect(agent, `Agent not found: ${agentId}`)
    const characterCid = expect(
      validAgent.characterCid,
      `Agent ${agentId} has no character CID`,
    )
    return this.storage.loadCharacter(characterCid)
  }

  async loadState(agentId: bigint): Promise<AgentState> {
    expectTrue(agentId > 0n, 'Agent ID must be greater than 0')
    const agent = await this.getAgent(agentId)
    const validAgent = expect(agent, `Agent not found: ${agentId}`)
    return this.storage.loadAgentState(validAgent.stateCid)
  }

  async updateState(
    agentId: bigint,
    updates: Partial<AgentState>,
  ): Promise<{ state: AgentState; cid: string }> {
    if (!this.canWrite()) {
      throw new Error('Signer required for state update (KMS or wallet)')
    }

    this.log.info('Updating agent state', { agentId: agentId.toString() })

    const currentState = await this.loadState(agentId)
    const { state, cid } = await this.storage.updateAgentState(
      currentState,
      updates,
    )

    const agent = await this.getAgent(agentId)
    if (!agent) throw new Error(`Agent not found: ${agentId}`)

    const newTokenUri = `ipfs://${agent.characterCid}#state=${cid}`

    await this.executeWrite({
      address: this.config.contracts.identityRegistry,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'setAgentUri',
      args: [agentId, newTokenUri],
    })
    this.log.info('State updated', {
      agentId: agentId.toString(),
      newStateCid: cid,
    })

    return { state, cid }
  }

  async addMemory(
    agentId: bigint,
    content: string,
    options?: { importance?: number; roomId?: string; userId?: string },
  ): Promise<MemoryEntry> {
    expectTrue(agentId > 0n, 'Agent ID must be greater than 0')
    expect(content, 'Memory content is required')
    expectTrue(content.length > 0, 'Memory content cannot be empty')
    if (options?.importance !== undefined) {
      expectTrue(
        options.importance >= 0 && options.importance <= 1,
        'Importance must be between 0 and 1',
      )
    }

    const state = await this.loadState(agentId)
    const embedding = await this.compute.generateEmbedding(content)

    const memory: MemoryEntry = {
      id: crypto.randomUUID(),
      content,
      embedding,
      importance: options?.importance ?? 0.5,
      createdAt: Date.now(),
      roomId: options?.roomId,
      userId: options?.userId,
    }

    await this.updateState(agentId, { memories: [...state.memories, memory] })
    this.log.debug('Memory added', {
      agentId: agentId.toString(),
      memoryId: memory.id,
    })

    return memory
  }

  async getVaultBalance(agentId: bigint): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.config.contracts.agentVault,
      abi: AGENT_VAULT_ABI,
      functionName: 'getBalance',
      args: [agentId],
    }) as Promise<bigint>
  }

  async fundVault(agentId: bigint, amount: bigint): Promise<string> {
    if (!this.walletClient) throw new Error('Wallet client required')

    this.log.info('Funding vault', {
      agentId: agentId.toString(),
      amount: amount.toString(),
    })

    const txHash = await this.executeWrite({
      address: this.config.contracts.agentVault,
      abi: AGENT_VAULT_ABI,
      functionName: 'deposit',
      args: [agentId],
      value: amount,
    })
    await this.publicClient.waitForTransactionReceipt({ hash: txHash })

    this.log.info('Vault funded', { agentId: agentId.toString(), txHash })
    return txHash
  }

  async withdrawFromVault(agentId: bigint, amount: bigint): Promise<string> {
    if (!this.canWrite()) {
      throw new Error('Signer required for withdrawal (KMS or wallet)')
    }
    expectTrue(agentId > 0n, 'Agent ID must be greater than 0')
    expectTrue(amount > 0n, 'Amount must be greater than 0')

    this.log.info('Withdrawing from vault', {
      agentId: agentId.toString(),
      amount: amount.toString(),
    })

    const txHash = await this.executeWrite({
      address: this.config.contracts.agentVault,
      abi: AGENT_VAULT_ABI,
      functionName: 'withdraw',
      args: [agentId, amount],
    })
    await this.publicClient.waitForTransactionReceipt({ hash: txHash })

    this.log.info('Withdrawal complete', {
      agentId: agentId.toString(),
      txHash,
    })
    return txHash
  }

  async setSpendLimit(agentId: bigint, limit: bigint): Promise<void> {
    if (!this.canWrite()) {
      throw new Error('Signer required for spend limit (KMS or wallet)')
    }

    await this.executeWrite({
      address: this.config.contracts.agentVault,
      abi: AGENT_VAULT_ABI,
      functionName: 'setSpendLimit',
      args: [agentId, limit],
    })
    this.log.info('Spend limit set', {
      agentId: agentId.toString(),
      limit: limit.toString(),
    })
  }

  async searchAgents(
    filter: AgentSearchFilter,
  ): Promise<SearchResult<AgentDefinition>> {
    expect(filter, 'Search filter is required')
    if (filter.limit !== undefined) {
      expect(
        filter.limit > 0 && filter.limit <= 100,
        'Limit must be between 1 and 100',
      )
    }
    if (filter.owner !== undefined) {
      expect(isAddress(filter.owner), 'Owner must be a valid address')
    }
    this.log.debug('Searching agents', {
      filter: JSON.parse(JSON.stringify(filter)),
    })

    const query = `
      query SearchAgents($filter: AgentFilter!) {
        agents(filter: $filter) {
          items { agentId owner name characterCid stateCid vaultAddress active registeredAt lastExecutedAt executionCount }
          total hasMore
        }
      }
    `

    const response = await fetch(this.config.services.indexerGraphql, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { filter } }),
    })

    expect(response.ok, `Search failed: ${response.statusText}`)

    const rawResult = await response.json()
    const parsed = AgentSearchResponseSchema.parse(rawResult)
    const { agents, total: parsedTotal } = parsed
    const total = parsedTotal ?? agents.length
    this.log.debug('Search complete', { total })

    // Convert parsed agents to SearchResult format
    const items: AgentDefinition[] = agents.map((a) => ({
      ...a,
      agentId: BigInt(a.id),
      owner: ZERO_ADDRESS,
      botType: 'ai_agent',
      stateCid: '',
      vaultAddress: ZERO_ADDRESS,
      active: a.status === 'active',
      registeredAt: 0,
      lastExecutedAt: 0,
      executionCount: 0,
    }))

    return { items, total, hasMore: false }
  }

  private parseTokenUri(uri: string): {
    characterCid: string
    stateCid: string
  } {
    expect(uri, 'Token URI is required')
    expectTrue(uri.length > 0, 'Token URI cannot be empty')
    const [base, fragment] = uri.split('#')
    expect(base, 'Token URI must contain base part')
    expect(fragment, 'Token URI must contain fragment part')
    const characterCid = base.replace('ipfs://', '')
    const stateCid = fragment.replace('state=', '')
    expectTrue(characterCid.length > 0, 'Character CID cannot be empty')
    expectTrue(stateCid.length > 0, 'State CID cannot be empty')
    return { characterCid, stateCid }
  }
}

export function createAgentSDK(config: AgentSDKConfig): AgentSDK {
  return new AgentSDK(config)
}
