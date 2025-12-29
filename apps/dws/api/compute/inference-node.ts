import { getContract, getRpcUrl } from '@jejunetwork/config'
import type { Address, Hex, PublicClient } from 'viem'
import { createPublicClient, http, keccak256, toBytes } from 'viem'
import { z } from 'zod'

export interface InferenceNode {
  address: Address
  endpoint: string
  name: string
  capabilities: string[]
  models: string[]
  provider: string
  attestationHash: Hex
  stake: bigint
  region: string
  gpuTier: number
  maxConcurrent: number
  currentLoad: number
  isActive: boolean
  registeredAt: number
  lastHeartbeat: number
  teeProvider?: string
}

/** Provider data from ComputeRegistry.getProvider */
interface ProviderData {
  owner: Address
  name: string
  endpoint: string
  attestationHash: Hex
  stake: bigint
  registeredAt: bigint
  agentId: bigint
  serviceType: Hex
  active: boolean
}

/** Capability data from ComputeRegistry.getCapabilities */
interface CapabilityData {
  model: string
  pricePerInputToken: bigint
  pricePerOutputToken: bigint
  maxContextLength: bigint
  active: boolean
}

export interface InferenceRequest {
  model: string
  messages: Array<{ role: string; content: string }>
  max_tokens?: number
  temperature?: number
  stream?: boolean
}

const InferenceResponseSchema = z.object({
  id: z.string(),
  object: z.string(),
  created: z.number(),
  model: z.string(),
  provider: z.string().optional(),
  node: z.string().optional(),
  choices: z.array(
    z.object({
      index: z.number(),
      message: z.object({ role: z.string(), content: z.string() }),
      finish_reason: z.string(),
    }),
  ),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
  }),
})

export interface InferenceResponse {
  id: string
  object: string
  created: number
  model: string
  provider: string
  node: string
  choices: Array<{
    index: number
    message: { role: string; content: string }
    finish_reason: string
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

// ComputeRegistry ABI - only the functions we need
const COMPUTE_REGISTRY_ABI = [
  {
    name: 'getActiveProviders',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    name: 'getActiveProvidersByService',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'serviceType', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    name: 'getProvider',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'owner', type: 'address' },
          { name: 'name', type: 'string' },
          { name: 'endpoint', type: 'string' },
          { name: 'attestationHash', type: 'bytes32' },
          { name: 'stake', type: 'uint256' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'agentId', type: 'uint256' },
          { name: 'serviceType', type: 'bytes32' },
          { name: 'active', type: 'bool' },
        ],
      },
    ],
  },
  {
    name: 'getCapabilities',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        components: [
          { name: 'model', type: 'string' },
          { name: 'pricePerInputToken', type: 'uint256' },
          { name: 'pricePerOutputToken', type: 'uint256' },
          { name: 'maxContextLength', type: 'uint256' },
          { name: 'active', type: 'bool' },
        ],
      },
    ],
  },
  {
    name: 'isActive',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

// Service type constant (must match contract)
const SERVICE_INFERENCE = keccak256(toBytes('inference'))

// Local cache of inference nodes (synced from chain)
const inferenceNodes = new Map<string, InferenceNode>()

// Last sync timestamp
let lastSyncTimestamp = 0
const SYNC_INTERVAL_MS = 60000 // 1 minute

// Model to provider mapping for routing
const MODEL_PROVIDERS: Record<string, string[]> = {
  'gpt-5': ['openai'],
  'gpt-5.2': ['openai'],
  claude: ['anthropic'],
  'claude-opus-4-5': ['anthropic'],
  'claude-sonnet-4-5': ['anthropic'],
  llama: ['groq', 'together', 'local'],
  'llama-3': ['groq', 'together', 'local'],
  'llama-3.1': ['groq', 'together', 'local'],
  'llama-3.2': ['groq', 'together', 'local'],
  'llama-3.3': ['groq', 'together', 'local'],
  mixtral: ['groq', 'together', 'local'],
  gemma: ['groq', 'local'],
  qwen: ['together', 'local'],
  deepseek: ['together', 'local'],
}

let publicClient: PublicClient | null = null
let computeRegistryAddress: Address | null = null

function getClient(): PublicClient {
  if (!publicClient) {
    const rpcUrl = getRpcUrl()
    publicClient = createPublicClient({ transport: http(rpcUrl) })
  }
  return publicClient
}

function getComputeRegistryAddress(): Address {
  if (!computeRegistryAddress) {
    const address = getContract('compute', 'registry')
    if (!address) {
      throw new Error('ComputeRegistry address not configured')
    }
    computeRegistryAddress = address as Address
  }
  return computeRegistryAddress
}

/**
 * Sync inference nodes from on-chain ComputeRegistry
 */
export async function syncFromChain(): Promise<void> {
  const now = Date.now()
  if (now - lastSyncTimestamp < SYNC_INTERVAL_MS && inferenceNodes.size > 0) {
    return // Already synced recently
  }

  const client = getClient()
  const registryAddress = getComputeRegistryAddress()

  // Get active inference providers
  const activeAddresses = (await client.readContract({
    address: registryAddress,
    abi: COMPUTE_REGISTRY_ABI,
    functionName: 'getActiveProvidersByService',
    args: [SERVICE_INFERENCE],
  })) as Address[]

  // Clear stale nodes
  inferenceNodes.clear()

  // Fetch each provider's details
  for (const address of activeAddresses) {
    const provider = (await client.readContract({
      address: registryAddress,
      abi: COMPUTE_REGISTRY_ABI,
      functionName: 'getProvider',
      args: [address],
    })) as ProviderData

    const capabilities = (await client.readContract({
      address: registryAddress,
      abi: COMPUTE_REGISTRY_ABI,
      functionName: 'getCapabilities',
      args: [address],
    })) as CapabilityData[]

    const models = capabilities.filter((c) => c.active).map((c) => c.model)

    // Determine provider type from models
    let providerType = 'unknown'
    for (const model of models) {
      const prefix = model.split('-')[0].toLowerCase()
      const providers =
        MODEL_PROVIDERS[prefix] ?? MODEL_PROVIDERS[model.toLowerCase()]
      if (providers && providers.length > 0) {
        providerType = providers[0]
        break
      }
    }

    const node: InferenceNode = {
      address,
      endpoint: provider.endpoint,
      name: provider.name,
      capabilities: ['inference'],
      models,
      provider: providerType,
      attestationHash: provider.attestationHash,
      stake: provider.stake,
      region: 'unknown', // Would need additional on-chain data
      gpuTier: 0,
      maxConcurrent: 10,
      currentLoad: 0,
      isActive: provider.active,
      registeredAt: Number(provider.registeredAt) * 1000,
      lastHeartbeat: Date.now(),
    }

    inferenceNodes.set(address.toLowerCase(), node)
  }

  lastSyncTimestamp = now
  console.log(`[Inference] Synced ${inferenceNodes.size} nodes from chain`)
}

/**
 * Update node heartbeat and load (local tracking)
 */
export function updateNodeHeartbeat(address: string, load?: number): boolean {
  const node = inferenceNodes.get(address.toLowerCase())
  if (!node) return false

  node.lastHeartbeat = Date.now()
  if (load !== undefined) {
    node.currentLoad = load
  }
  return true
}

/**
 * Get all active nodes (synced from chain)
 */
export async function getActiveNodes(): Promise<InferenceNode[]> {
  await syncFromChain()

  const now = Date.now()
  const staleThreshold = 300000 // 5 minutes (longer threshold for on-chain nodes)

  return Array.from(inferenceNodes.values()).filter(
    (node) => node.isActive && now - node.lastHeartbeat < staleThreshold,
  )
}

/**
 * Find the best node for a given model
 */
export async function findNodeForModel(
  model: string,
): Promise<InferenceNode | null> {
  const activeNodes = await getActiveNodes()
  if (activeNodes.length === 0) return null

  // Find nodes that can serve this model
  const modelPrefix = model.split('-')[0].toLowerCase()
  const compatibleProviders =
    MODEL_PROVIDERS[modelPrefix] ?? MODEL_PROVIDERS[model.toLowerCase()] ?? []

  const compatibleNodes = activeNodes.filter((node) => {
    // Check if node's provider is compatible
    if (
      compatibleProviders.length > 0 &&
      !compatibleProviders.includes(node.provider)
    ) {
      return false
    }
    // Check if node explicitly lists this model
    if (
      node.models.length > 0 &&
      !node.models.some(
        (m) =>
          model.toLowerCase().includes(m.toLowerCase()) ||
          m.toLowerCase().includes(modelPrefix),
      )
    ) {
      return false
    }
    // Check load
    return node.currentLoad < node.maxConcurrent
  })

  if (compatibleNodes.length === 0) {
    // Fall back to any available node
    const anyNode = activeNodes.find((n) => n.currentLoad < n.maxConcurrent)
    return anyNode ?? null
  }

  // Select node with lowest load
  compatibleNodes.sort((a, b) => {
    const loadA = a.currentLoad / a.maxConcurrent
    const loadB = b.currentLoad / b.maxConcurrent
    return loadA - loadB
  })

  return compatibleNodes[0]
}

/**
 * Route inference request to a node
 */
export async function routeInference(
  request: InferenceRequest,
): Promise<InferenceResponse> {
  const node = await findNodeForModel(request.model)

  if (!node) {
    throw new Error(
      'No inference nodes available. Register on-chain with ComputeRegistry or wait for nodes to come online.',
    )
  }

  // Increment load
  node.currentLoad++

  try {
    const response = await fetch(`${node.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Node ${node.address} returned error: ${error}`)
    }

    const raw: unknown = await response.json()
    const parsed = InferenceResponseSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`Invalid inference response from node ${node.address}`)
    }

    return {
      ...parsed.data,
      node: node.address,
      provider: node.provider,
    }
  } finally {
    // Decrement load
    node.currentLoad = Math.max(0, node.currentLoad - 1)
  }
}

/**
 * Get node statistics
 */
export async function getNodeStats(): Promise<{
  totalNodes: number
  activeNodes: number
  totalCapacity: number
  currentLoad: number
  providers: string[]
  models: string[]
}> {
  const active = await getActiveNodes()
  const allModels = new Set<string>()
  const allProviders = new Set<string>()

  for (const node of active) {
    allProviders.add(node.provider)
    node.models.forEach((m) => {
      allModels.add(m)
    })
  }

  return {
    totalNodes: inferenceNodes.size,
    activeNodes: active.length,
    totalCapacity: active.reduce((sum, n) => sum + n.maxConcurrent, 0),
    currentLoad: active.reduce((sum, n) => sum + n.currentLoad, 0),
    providers: Array.from(allProviders),
    models: Array.from(allModels),
  }
}

/**
 * Force refresh of on-chain data
 */
export async function forceSync(): Promise<void> {
  lastSyncTimestamp = 0
  await syncFromChain()
}

/**
 * Check if a specific address is registered as an inference provider
 */
export async function isRegisteredProvider(address: Address): Promise<boolean> {
  const client = getClient()
  const registryAddress = getComputeRegistryAddress()

  return (await client.readContract({
    address: registryAddress,
    abi: COMPUTE_REGISTRY_ABI,
    functionName: 'isActive',
    args: [address],
  })) as boolean
}

/**
 * Register a node directly (for testing only)
 * In production, nodes register on-chain via ComputeRegistry
 */
export function registerNode(
  node: Omit<
    InferenceNode,
    | 'registeredAt'
    | 'lastHeartbeat'
    | 'currentLoad'
    | 'attestationHash'
    | 'stake'
  >,
): InferenceNode {
  const fullNode: InferenceNode = {
    ...node,
    address: node.address as Address,
    attestationHash: '0x' as Hex,
    stake: 0n,
    currentLoad: 0,
    registeredAt: Date.now(),
    lastHeartbeat: Date.now(),
  }

  inferenceNodes.set(node.address.toLowerCase(), fullNode)
  console.log(
    `[Inference] Node registered: ${node.address} (${node.provider}, ${node.models.length} models)`,
  )

  return fullNode
}

/**
 * Unregister a node directly (for testing only)
 * In production, nodes deactivate on-chain via ComputeRegistry
 */
export function unregisterNode(address: string): boolean {
  return inferenceNodes.delete(address.toLowerCase())
}

// Export for testing
export { inferenceNodes }
