/**
 * DWS Inference Node System
 *
 * All inference goes through registered DWS nodes - no direct provider fallback.
 *
 * Architecture:
 * - Nodes register with DWS specifying their capabilities (models, providers)
 * - DWS routes requests to available nodes based on model/load
 * - Local dev: A local node registers to provide inference from your machine
 * - Testnet/Mainnet: Dedicated nodes serve the base providers
 */

export interface InferenceNode {
  address: string
  endpoint: string
  capabilities: string[]
  models: string[]
  provider: string
  region: string
  gpuTier: number
  maxConcurrent: number
  currentLoad: number
  isActive: boolean
  registeredAt: number
  lastHeartbeat: number
  teeProvider?: string
}

export interface InferenceRequest {
  model: string
  messages: Array<{ role: string; content: string }>
  max_tokens?: number
  temperature?: number
  stream?: boolean
}

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

// In-memory node registry (in production, this would be on-chain via ComputeRegistry)
const inferenceNodes = new Map<string, InferenceNode>()

// Model to provider mapping for routing
const MODEL_PROVIDERS: Record<string, string[]> = {
  'gpt-4': ['openai'],
  'gpt-4o': ['openai'],
  'gpt-4o-mini': ['openai'],
  'gpt-4-turbo': ['openai'],
  'gpt-3.5': ['openai'],
  'gpt-3.5-turbo': ['openai'],
  o1: ['openai'],
  o3: ['openai'],
  claude: ['anthropic'],
  'claude-3': ['anthropic'],
  'claude-3.5': ['anthropic'],
  'claude-3-opus': ['anthropic'],
  'claude-3-sonnet': ['anthropic'],
  'claude-3-haiku': ['anthropic'],
  'claude-3-5-sonnet': ['anthropic'],
  'claude-3-5-haiku': ['anthropic'],
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

/**
 * Register an inference node with DWS
 */
export function registerNode(
  node: Omit<InferenceNode, 'registeredAt' | 'lastHeartbeat' | 'currentLoad'>,
): InferenceNode {
  const fullNode: InferenceNode = {
    ...node,
    currentLoad: 0,
    registeredAt: Date.now(),
    lastHeartbeat: Date.now(),
  }

  inferenceNodes.set(node.address, fullNode)
  console.log(
    `[Inference] Node registered: ${node.address} (${node.provider}, ${node.models.length} models)`,
  )

  return fullNode
}

/**
 * Update node heartbeat and load
 */
export function updateNodeHeartbeat(address: string, load?: number): boolean {
  const node = inferenceNodes.get(address)
  if (!node) return false

  node.lastHeartbeat = Date.now()
  if (load !== undefined) {
    node.currentLoad = load
  }
  return true
}

/**
 * Unregister an inference node
 */
export function unregisterNode(address: string): boolean {
  return inferenceNodes.delete(address)
}

/**
 * Get all active nodes
 */
export function getActiveNodes(): InferenceNode[] {
  const now = Date.now()
  const staleThreshold = 60000 // 1 minute

  return Array.from(inferenceNodes.values()).filter(
    (node) => node.isActive && now - node.lastHeartbeat < staleThreshold,
  )
}

/**
 * Find the best node for a given model
 */
export function findNodeForModel(model: string): InferenceNode | null {
  const activeNodes = getActiveNodes()
  if (activeNodes.length === 0) return null

  // Find nodes that can serve this model
  const modelPrefix = model.split('-')[0].toLowerCase()
  const compatibleProviders =
    MODEL_PROVIDERS[modelPrefix] || MODEL_PROVIDERS[model.toLowerCase()] || []

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
    return anyNode || null
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
  const node = findNodeForModel(request.model)

  if (!node) {
    throw new Error(
      'No inference nodes available. Register a node with DWS or start a local inference node.',
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

    const result = (await response.json()) as Omit<InferenceResponse, 'node'>

    return {
      ...result,
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
export function getNodeStats(): {
  totalNodes: number
  activeNodes: number
  totalCapacity: number
  currentLoad: number
  providers: string[]
  models: string[]
} {
  const active = getActiveNodes()
  const allModels = new Set<string>()
  const allProviders = new Set<string>()

  for (const node of active) {
    allProviders.add(node.provider)
    node.models.forEach((m) => allModels.add(m))
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
 * Register a local development node that proxies to provider APIs
 * This is used during local development when you have API keys
 */
export function registerLocalDevNode(config: {
  endpoint?: string
  provider: string
  apiKey: string
  models?: string[]
}): InferenceNode {
  return registerNode({
    address: 'local-dev-node',
    endpoint: config.endpoint || 'http://localhost:4031',
    capabilities: ['inference', 'embeddings'],
    models: config.models || ['*'],
    provider: config.provider,
    region: 'local',
    gpuTier: 0,
    maxConcurrent: 10,
    isActive: true,
  })
}

// Export for testing
export { inferenceNodes }
