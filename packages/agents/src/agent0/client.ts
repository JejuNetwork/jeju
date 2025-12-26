/**
 * Agent0 SDK Client
 */

import {
  getAgent0IpfsProvider,
  getAgent0PrivateKey,
  getAgent0SubgraphUrl,
  getCurrentNetwork,
  getExternalRpc,
  getFilecoinPrivateKey,
  getIpfsApiUrl,
  getPinataJwt,
  getRpcUrl,
} from '@jejunetwork/config'
import { logger, toJsonRecord } from '@jejunetwork/shared'
import type { AgentCapabilities, JsonValue } from '@jejunetwork/types'
import type {
  AgentSummary,
  Feedback,
  SearchParams,
  SearchResultMeta,
} from 'agent0-sdk'
import { SDK } from 'agent0-sdk'
import type { Address, Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type {
  Agent0AgentProfile,
  Agent0AgentUpdateParams,
  Agent0ClientConfig,
  Agent0ContractAddresses,
  Agent0Feedback,
  Agent0FeedbackParams,
  Agent0FeedbackSearchParams,
  Agent0Network,
  Agent0RegistrationParams,
  Agent0RegistrationResult,
  Agent0ReputationSummary,
  Agent0SearchFilters,
  Agent0SearchOptions,
  Agent0SearchResponse,
  Agent0SearchResult,
  Agent0TransferResult,
  IAgent0Client,
} from './types'

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000'

let contractAddressesProvider: (() => Agent0ContractAddresses) | null = null

export function setContractAddressesProvider(
  provider: () => Agent0ContractAddresses,
): void {
  contractAddressesProvider = provider
}

function getContractAddresses(): Agent0ContractAddresses {
  return contractAddressesProvider?.() ?? {
    identityRegistry: ZERO_ADDRESS,
    reputationSystem: ZERO_ADDRESS,
    chainId: 31337,
    network: 'localnet',
  }
}

const CHAIN_IDS: Record<Agent0Network, number> = {
  mainnet: 1,
  sepolia: 11155111,
  localnet: 31337,
}

function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address)
}

function toAddress(value: string): Address {
  if (!isValidAddress(value)) throw new Error(`Invalid address: ${value}`)
  return value as Address
}

function toAddressArray(values: string[]): Address[] {
  return values.filter(isValidAddress).map((v) => v as Address)
}

function toHex(value: string): Hex {
  return (value.startsWith('0x') ? value : `0x${value}`) as Hex
}

/** Convert -5 to +5 rating to 0-100 Agent0 score */
export function ratingToScore(rating: number): number {
  return Math.max(0, Math.min(100, (rating + 5) * 10))
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []
}

const ENDPOINT_TYPES = new Set(['MCP', 'A2A', 'ENS', 'DID', 'OASF'])
type EndpointType = 'MCP' | 'A2A' | 'ENS' | 'DID' | 'wallet' | 'OASF'

function toEndpointType(type: string): EndpointType {
  const upper = type.toUpperCase()
  if (ENDPOINT_TYPES.has(upper)) return upper as EndpointType
  return upper === 'WALLET' ? 'wallet' : 'A2A'
}

function parseCapabilities(extras: Record<string, JsonValue> | undefined) {
  const caps = extras?.capabilities
  if (!caps || typeof caps !== 'object' || Array.isArray(caps)) {
    return { strategies: [], markets: [], actions: [], version: '1.0.0', skills: [], domains: [] }
  }
  const c = caps as Record<string, JsonValue>
  return {
    strategies: toStringArray(c.strategies),
    markets: toStringArray(c.markets),
    actions: toStringArray(c.actions),
    version: typeof c.version === 'string' ? c.version : '1.0.0',
    skills: toStringArray(c.skills),
    domains: toStringArray(c.domains),
  }
}

function extractReputation(extras: Record<string, JsonValue> | undefined) {
  const rep = extras?.reputation as Record<string, unknown> | undefined
  const trust = typeof rep?.trustScore === 'number' ? rep.trustScore
    : typeof rep?.averageScore === 'number' ? rep.averageScore / 100
    : 0
  return { trustScore: trust, accuracyScore: typeof rep?.accuracyScore === 'number' ? rep.accuracyScore : trust }
}

export class Agent0Client implements IAgent0Client {
  private sdk: SDK | null = null
  private chainId: number
  private config: Agent0ClientConfig
  private initPromise: Promise<void> | null = null

  constructor(config: Agent0ClientConfig) {
    this.chainId = CHAIN_IDS[config.network] ?? 31337
    this.config = config
  }

  private async ensureSDK(): Promise<SDK> {
    if (this.sdk) return this.sdk

    if (this.initPromise) {
      await this.initPromise
      return this.sdk!
    }

    this.initPromise = (async () => {
      const ipfs = this.config.ipfsProvider ?? 'node'
      if (ipfs === 'pinata' && !this.config.pinataJwt) {
        throw new Error('PINATA_JWT required for pinata provider')
      }
      if (ipfs === 'filecoinPin' && !this.config.filecoinPrivateKey) {
        throw new Error('FILECOIN_PRIVATE_KEY required for filecoinPin provider')
      }

      const contracts = getContractAddresses()
      const registryOverrides = this.chainId === 31337 && contracts.reputationSystem !== ZERO_ADDRESS
        ? { [this.chainId]: { REPUTATION: contracts.reputationSystem, IDENTITY: contracts.identityRegistry } }
        : undefined

      this.sdk = new SDK({
        chainId: this.chainId,
        rpcUrl: this.config.rpcUrl,
        signer: this.config.privateKey,
        ipfs,
        ipfsNodeUrl: this.config.ipfsNodeUrl ?? (ipfs === 'node' ? 'https://ipfs.io' : undefined),
        pinataJwt: this.config.pinataJwt,
        filecoinPrivateKey: this.config.filecoinPrivateKey,
        subgraphUrl: this.config.subgraphUrl,
        registryOverrides,
      })
      logger.info('Agent0Client initialized', { chainId: this.chainId, isReadOnly: this.sdk.isReadOnly })
    })()

    await this.initPromise
    this.initPromise = null
    return this.sdk!
  }

  private requireWriteAccess(sdk: SDK) {
    if (sdk.isReadOnly) throw new Error('SDK not initialized with write access')
  }

  async registerAgent(params: Agent0RegistrationParams): Promise<Agent0RegistrationResult> {
    const sdk = await this.ensureSDK()
    this.requireWriteAccess(sdk)

    const agent = sdk.createAgent(params.name, params.description, params.imageUrl ?? undefined)

    if (params.walletAddress && isValidAddress(params.walletAddress)) {
      agent.setAgentWallet(params.walletAddress, this.chainId)
    }
    if (params.mcpEndpoint) await agent.setMCP(params.mcpEndpoint, '1.0.0', false)
    if (params.a2aEndpoint) await agent.setA2A(params.a2aEndpoint, '1.0.0', false)

    agent.setMetadata({ capabilities: params.capabilities, version: params.capabilities.version ?? '1.0.0' })
    agent.setActive(true)
    if (params.capabilities.x402Support !== undefined) agent.setX402Support(params.capabilities.x402Support)

    const reg = await agent.registerIPFS()
    if (!reg.agentId) throw new Error('Registration missing agentId')

    const tokenId = Number.parseInt(reg.agentId.split(':')[1] ?? '0', 10)
    logger.info('Agent registered', { agentId: reg.agentId })

    return { tokenId, metadataCID: reg.agentURI?.replace('ipfs://', '') }
  }

  async searchAgents(
    filters: Agent0SearchFilters,
    options?: Agent0SearchOptions,
  ): Promise<Agent0SearchResponse<Agent0SearchResult>> {
    const sdk = await this.ensureSDK()

    const skills = filters.a2aSkills?.length ? filters.a2aSkills
      : filters.strategies?.length ? filters.strategies
      : filters.skills?.length ? filters.skills
      : undefined

    const searchParams: SearchParams = {
      ...(skills && { a2aSkills: skills }),
      ...(filters.name && { name: filters.name }),
      ...(filters.description && { description: filters.description }),
      ...(filters.x402Support !== undefined && { x402support: filters.x402Support }),
      ...(filters.chains !== undefined && { chains: filters.chains }),
      ...(filters.active !== undefined && { active: filters.active }),
      ...(filters.owners?.length && { owners: toAddressArray(filters.owners) }),
      ...(filters.operators?.length && { operators: toAddressArray(filters.operators) }),
      ...(filters.mcp !== undefined && { mcp: filters.mcp }),
      ...(filters.a2a !== undefined && { a2a: filters.a2a }),
      ...(filters.ens && { ens: filters.ens }),
      ...(filters.did && { did: filters.did }),
      ...(filters.walletAddress && isValidAddress(filters.walletAddress) && { walletAddress: filters.walletAddress }),
      ...(filters.supportedTrust?.length && { supportedTrust: filters.supportedTrust }),
      ...(filters.mcpTools?.length && { mcpTools: filters.mcpTools }),
      ...(filters.mcpPrompts?.length && { mcpPrompts: filters.mcpPrompts }),
      ...(filters.mcpResources?.length && { mcpResources: filters.mcpResources }),
    }

    const result = await sdk.searchAgents(searchParams, options?.sort, options?.pageSize, options?.cursor)

    return {
      items: (result?.items ?? []).map((a) => this.toSearchResult(a)),
      nextCursor: result?.nextCursor,
      meta: result?.meta ? this.toMeta(result.meta) : undefined,
    }
  }

  async searchAgentsByReputation(
    params: Agent0FeedbackSearchParams,
    options?: Agent0SearchOptions,
  ): Promise<Agent0SearchResponse<Agent0SearchResult>> {
    const sdk = await this.ensureSDK()

    const result = await sdk.searchAgentsByReputation(
      params.agents, params.tags, params.reviewers ? toAddressArray(params.reviewers) : undefined,
      params.capabilities, params.skills, params.tasks, params.names,
      params.minScore, params.includeRevoked,
      options?.pageSize, options?.cursor, options?.sort,
    )

    return {
      items: (result?.items ?? []).map((a) => this.toSearchResult(a)),
      nextCursor: result?.nextCursor,
      meta: result?.meta ? this.toMeta(result.meta) : undefined,
    }
  }

  async getAgentProfile(tokenId: number): Promise<Agent0AgentProfile | null> {
    const sdk = await this.ensureSDK()
    const agent = await sdk.getAgent(`${this.chainId}:${tokenId}`)
    return agent ? this.toProfile(agent, tokenId) : null
  }

  async loadAgent(agentId: string): Promise<Agent0AgentProfile | null> {
    const sdk = await this.ensureSDK()
    const agent = await sdk.loadAgent(agentId)
    if (!agent) return null

    const reg = agent.getRegistrationFile()
    const tokenId = Number.parseInt(agentId.split(':')[1] ?? '0', 10)

    return {
      tokenId,
      name: reg.name,
      walletAddress: reg.walletAddress ?? '',
      metadataCID: reg.agentURI ?? agentId,
      capabilities: parseCapabilities(toJsonRecord(reg.metadata)) as AgentCapabilities,
      reputation: { trustScore: 0, accuracyScore: 0 },
      description: reg.description,
      image: reg.image,
      chainId: reg.walletChainId,
      owners: reg.owners,
      operators: reg.operators,
      endpoints: reg.endpoints.map((ep) => ({ type: toEndpointType(ep.type), value: ep.value, meta: ep.meta })),
      trustModels: toStringArray(reg.trustModels),
      active: reg.active,
      x402support: reg.x402support,
      metadata: reg.metadata,
      updatedAt: reg.updatedAt,
    }
  }

  async updateAgent(agentId: string, params: Agent0AgentUpdateParams): Promise<Agent0RegistrationResult> {
    const sdk = await this.ensureSDK()
    this.requireWriteAccess(sdk)

    const agent = await sdk.loadAgent(agentId)

    if (params.name || params.description || params.image) agent.updateInfo(params.name, params.description, params.image)
    if (params.walletAddress && isValidAddress(params.walletAddress)) agent.setAgentWallet(params.walletAddress, params.walletChainId ?? this.chainId)
    if (params.mcpEndpoint) await agent.setMCP(params.mcpEndpoint, '1.0.0', false)
    if (params.a2aEndpoint) await agent.setA2A(params.a2aEndpoint, '1.0.0', false)
    if (params.skills) params.skills.forEach((s) => agent.addSkill(s, false))
    if (params.domains) params.domains.forEach((d) => agent.addDomain(d, false))
    if (params.active !== undefined) agent.setActive(params.active)
    if (params.x402Support !== undefined) agent.setX402Support(params.x402Support)
    if (params.trustModels) agent.setTrust(params.trustModels.reputation, params.trustModels.cryptoEconomic, params.trustModels.teeAttestation)
    if (params.metadata) agent.setMetadata(params.metadata)

    const reg = await agent.registerIPFS()
    const tokenId = Number.parseInt(agentId.split(':')[1] ?? '0', 10)

    logger.info('Agent updated', { agentId })
    return { tokenId, metadataCID: reg.agentURI?.replace('ipfs://', '') }
  }

  async transferAgent(agentId: string, newOwner: string): Promise<Agent0TransferResult> {
    const sdk = await this.ensureSDK()
    this.requireWriteAccess(sdk)
    const result = await sdk.transferAgent(agentId, toAddress(newOwner))
    logger.info('Agent transferred', { agentId, newOwner })
    return { txHash: result.txHash, from: result.from, to: result.to, agentId: result.agentId }
  }

  async isAgentOwner(agentId: string, address: string): Promise<boolean> {
    const sdk = await this.ensureSDK()
    return sdk.isAgentOwner(agentId, toAddress(address))
  }

  async getAgentOwner(agentId: string): Promise<string> {
    const sdk = await this.ensureSDK()
    const owner = await sdk.getAgentOwner(agentId)
    if (!owner) throw new Error(`No owner for agent ${agentId}`)
    return owner
  }

  async submitFeedback(params: Agent0FeedbackParams): Promise<Agent0Feedback> {
    const sdk = await this.ensureSDK()
    this.requireWriteAccess(sdk)

    const agentId = `${this.chainId}:${params.targetAgentId}`
    const score = ratingToScore(params.rating)

    const feedbackFile = sdk.prepareFeedback(
      agentId, score, params.tags ?? [], params.comment || undefined,
      params.capability, undefined, params.skill, params.task, params.context, params.proofOfPayment,
    )

    const signer = privateKeyToAccount(toHex(this.config.privateKey ?? ''))
    const auth = await sdk.signFeedbackAuth(agentId, signer.address, undefined, 24)
    const feedback = await sdk.giveFeedback(agentId, feedbackFile, auth)

    logger.info('Feedback submitted', { agentId })
    return this.toFeedback(feedback)
  }

  async getFeedback(agentId: string, clientAddress: string, feedbackIndex: number): Promise<Agent0Feedback> {
    const sdk = await this.ensureSDK()
    const feedback = await sdk.getFeedback(agentId, toAddress(clientAddress), feedbackIndex)
    if (!feedback) throw new Error(`Feedback not found for ${agentId}`)
    return this.toFeedback(feedback)
  }

  async searchFeedback(agentId: string, params?: Partial<Agent0FeedbackSearchParams>): Promise<Agent0Feedback[]> {
    const sdk = await this.ensureSDK()
    const list = await sdk.searchFeedback(agentId, params?.tags, params?.capabilities, params?.skills, params?.minScore, params?.maxScore)
    return list?.map((f) => this.toFeedback(f)) ?? []
  }

  async revokeFeedback(agentId: string, feedbackIndex: number): Promise<string> {
    const sdk = await this.ensureSDK()
    this.requireWriteAccess(sdk)
    const txHash = await sdk.revokeFeedback(agentId, feedbackIndex)
    logger.info('Feedback revoked', { agentId })
    return txHash
  }

  async appendFeedbackResponse(agentId: string, clientAddress: string, feedbackIndex: number, uri: string, hash: string): Promise<string> {
    const sdk = await this.ensureSDK()
    this.requireWriteAccess(sdk)
    const txHash = await sdk.appendResponse(agentId, toAddress(clientAddress), feedbackIndex, { uri, hash })
    logger.info('Response appended', { agentId })
    return txHash
  }

  async getReputationSummary(agentId: string, tag1?: string, tag2?: string): Promise<Agent0ReputationSummary> {
    const sdk = await this.ensureSDK()
    const summary = await sdk.getReputationSummary(agentId, tag1, tag2)
    if (!summary) throw new Error(`No reputation for ${agentId}`)
    return { count: summary.count, averageScore: summary.averageScore }
  }

  isAvailable(): boolean {
    return this.sdk !== null && !this.sdk.isReadOnly
  }

  async ensureAvailable(): Promise<boolean> {
    await this.ensureSDK()
    return this.isAvailable()
  }

  getSDK(): SDK | null { return this.sdk }
  getChainId(): number { return this.chainId }
  formatAgentId(tokenId: number): string { return `${this.chainId}:${tokenId}` }

  private toSearchResult(agent: AgentSummary): Agent0SearchResult {
    const extras = toJsonRecord(agent.extras)
    return {
      tokenId: Number.parseInt(agent.agentId.split(':')[1] ?? '0', 10),
      name: agent.name,
      walletAddress: agent.walletAddress ?? '',
      metadataCID: agent.agentId,
      capabilities: parseCapabilities(extras) as AgentCapabilities,
      reputation: extractReputation(extras),
      chainId: agent.chainId,
      description: agent.description,
      image: agent.image,
      owners: agent.owners,
      operators: agent.operators,
      mcp: agent.mcp,
      a2a: agent.a2a,
      ens: agent.ens,
      did: agent.did,
      supportedTrusts: agent.supportedTrusts,
      a2aSkills: agent.a2aSkills,
      mcpTools: agent.mcpTools,
      mcpPrompts: agent.mcpPrompts,
      mcpResources: agent.mcpResources,
      active: agent.active,
      x402support: agent.x402support,
    }
  }

  private toProfile(agent: AgentSummary, tokenId: number): Agent0AgentProfile {
    const extras = toJsonRecord(agent.extras)
    return {
      tokenId,
      name: agent.name,
      walletAddress: agent.walletAddress ?? '',
      metadataCID: agent.agentId,
      capabilities: parseCapabilities(extras) as AgentCapabilities,
      reputation: extractReputation(extras),
      description: agent.description,
      image: agent.image,
      chainId: agent.chainId,
      owners: agent.owners,
      operators: agent.operators,
      trustModels: agent.supportedTrusts,
      active: agent.active,
      x402support: agent.x402support,
      metadata: agent.extras,
    }
  }

  private toMeta(meta: SearchResultMeta) {
    return {
      chains: meta.chains,
      successfulChains: meta.successfulChains,
      failedChains: meta.failedChains,
      totalResults: meta.totalResults,
      timing: { totalMs: meta.timing.totalMs, averagePerChainMs: meta.timing.averagePerChainMs },
    }
  }

  private toFeedback(f: Feedback): Agent0Feedback {
    return {
      id: f.id, agentId: f.agentId, reviewer: f.reviewer, score: f.score,
      tags: f.tags, text: f.text, context: f.context, proofOfPayment: f.proofOfPayment,
      fileURI: f.fileURI, createdAt: f.createdAt, answers: f.answers, isRevoked: f.isRevoked,
      capability: f.capability, name: f.name, skill: f.skill, task: f.task,
    }
  }
}

export function createAgent0Client(): Agent0Client {
  const jejuNetwork = getCurrentNetwork()
  const network: Agent0Network = jejuNetwork === 'localnet' ? 'localnet' : jejuNetwork === 'testnet' ? 'sepolia' : 'mainnet'
  const rpcUrl = network === 'localnet' ? getRpcUrl('localnet') : getExternalRpc(network === 'sepolia' ? 'sepolia' : 'ethereum')

  return new Agent0Client({
    network,
    rpcUrl,
    privateKey: getAgent0PrivateKey(),
    ipfsProvider: getAgent0IpfsProvider(),
    ipfsNodeUrl: getIpfsApiUrl(),
    pinataJwt: getPinataJwt(),
    filecoinPrivateKey: getFilecoinPrivateKey(),
    subgraphUrl: getAgent0SubgraphUrl(),
  })
}

let instance: Agent0Client | null = null

export function getAgent0Client(): Agent0Client {
  return instance ?? (instance = createAgent0Client())
}

export function resetAgent0Client(): void {
  instance = null
}
