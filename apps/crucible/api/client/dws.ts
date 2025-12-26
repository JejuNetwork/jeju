/**
 * DWS Client
 *
 * Typed client for Decentralized Web Services API.
 * Uses a typed fetch wrapper with zod schema validation for response types.
 */

import { getDWSComputeUrl } from '@jejunetwork/config'
import { z } from 'zod'
import { expect, expectTrue, StorageUploadResponseSchema } from '../schemas'

// Response Schemas

const DWSHealthSchema = z.object({
  status: z.literal('healthy'),
  service: z.string(),
  version: z.string(),
  uptime: z.number().nullable(),
})

const ComputeNodeStatsSchema = z.object({
  inference: z
    .object({
      totalNodes: z.number(),
      activeNodes: z.number(),
      totalCapacity: z.number().optional(),
      currentLoad: z.number().optional(),
      providers: z.array(z.string()).optional(),
      models: z.array(z.string()).optional(),
    })
    .optional(),
  training: z
    .object({
      totalNodes: z.number(),
      activeNodes: z.number(),
      totalRuns: z.number().optional(),
      activeRuns: z.number().optional(),
    })
    .optional(),
  // Flat response fields (alternative format from some DWS versions)
  totalNodes: z.number().optional(),
  activeNodes: z.number().optional(),
  avgLoad: z.number().optional(),
})

const ChatCompletionResponseSchema = z.object({
  id: z.string(),
  choices: z.array(
    z.object({
      index: z.number(),
      message: z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string(),
      }),
      finish_reason: z.string().nullable(),
    }),
  ),
  usage: z
    .object({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      total_tokens: z.number(),
    })
    .nullable(),
})

const InferenceAvailabilitySchema = z.object({
  available: z.boolean(),
  nodes: z.number(),
  error: z.string().nullable(),
})

/**
 * Get DWS endpoint from environment or centralized config
 * Returns base URL without /compute suffix
 */
export function getDWSEndpoint(): string {
  if (process.env.DWS_URL) {
    return process.env.DWS_URL.replace(/\/compute\/?$/, '')
  }
  if (process.env.COMPUTE_MARKETPLACE_URL) {
    return process.env.COMPUTE_MARKETPLACE_URL.replace(/\/compute\/?$/, '')
  }
  // getDWSComputeUrl returns http://127.0.0.1:4030/compute - strip the /compute
  return getDWSComputeUrl().replace(/\/compute\/?$/, '')
}

// DWS Client Class

export interface DWSClientConfig {
  baseUrl: string
  ipfsGateway?: string
  headers?: Record<string, string>
  timeout?: number
}

export class DWSClient {
  private baseUrl: string
  private ipfsGateway: string
  private headers: Record<string, string>
  private timeout: number

  constructor(config: DWSClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.ipfsGateway = config.ipfsGateway ?? `${this.baseUrl}/storage`
    this.headers = {
      'Content-Type': 'application/json',
      ...config.headers,
    }
    this.timeout = config.timeout ?? 30000
  }

  private async fetch<T>(
    path: string,
    init?: RequestInit & { schema?: z.ZodType<T> },
  ): Promise<T> {
    const { schema, ...fetchInit } = init ?? {}
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...fetchInit,
      headers: { ...this.headers, ...fetchInit?.headers },
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`DWS request failed: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    if (schema) {
      return schema.parse(data)
    }
    return data as T
  }

  async health(): Promise<z.infer<typeof DWSHealthSchema>> {
    return this.fetch('/health', { schema: DWSHealthSchema })
  }

  async isHealthy(): Promise<boolean> {
    const result = await this.health()
    return result.status === 'healthy'
  }

  // Compute API

  async getComputeNodeStats(): Promise<{
    totalNodes: number
    activeNodes: number
  }> {
    const result = await this.fetch('/compute/nodes/stats', {
      schema: ComputeNodeStatsSchema,
    })
    // Handle both response formats
    const activeNodes = result.inference?.activeNodes ?? result.activeNodes ?? 0
    const totalNodes = result.totalNodes ?? activeNodes
    return { totalNodes, activeNodes }
  }

  async checkInferenceAvailable(): Promise<
    z.infer<typeof InferenceAvailabilitySchema>
  > {
    const result = await this.getComputeNodeStats().catch((err: Error) => ({
      available: false,
      nodes: 0,
      error: err.message,
    }))

    if ('error' in result) {
      return result as z.infer<typeof InferenceAvailabilitySchema>
    }

    return {
      available: result.activeNodes > 0,
      nodes: result.activeNodes,
      error: null,
    }
  }

  async chatCompletion(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    options?: {
      model?: string
      temperature?: number
      maxTokens?: number
    },
  ): Promise<z.infer<typeof ChatCompletionResponseSchema>> {
    return this.fetch('/compute/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: options?.model ?? 'llama-3.1-8b-instant',
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 1000,
      }),
      schema: ChatCompletionResponseSchema,
    })
  }

  async storageUpload(
    content: string,
    filename: string,
    pin = true,
  ): Promise<z.infer<typeof StorageUploadResponseSchema>> {
    return this.fetch('/storage/api/v1/add', {
      method: 'POST',
      body: JSON.stringify({ content, filename, pin }),
      schema: StorageUploadResponseSchema,
    })
  }

  async storagePin(cid: string): Promise<void> {
    await this.fetch('/storage/api/v1/pin', {
      method: 'POST',
      body: JSON.stringify({ cid }),
    })
  }

  async storageFetch(cid: string): Promise<string> {
    expect(cid, 'CID is required')
    expectTrue(cid.length > 0, 'CID cannot be empty')

    const response = await fetch(`${this.ipfsGateway}/ipfs/${cid}`, {
      headers: this.headers,
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch CID ${cid}: ${response.statusText}`)
    }

    return response.text()
  }

  async storageExists(cid: string): Promise<boolean> {
    expect(cid, 'CID is required')
    expectTrue(cid.length > 0, 'CID cannot be empty')

    const response = await fetch(`${this.ipfsGateway}/ipfs/${cid}`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(this.timeout),
    })

    return response.ok
  }

  async storageHead(cid: string): Promise<{ contentLength: number | null }> {
    const response = await fetch(`${this.ipfsGateway}/ipfs/${cid}`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      throw new Error(`Failed to HEAD CID ${cid}: ${response.statusText}`)
    }

    const contentLength = response.headers.get('content-length')
    return {
      contentLength: contentLength ? parseInt(contentLength, 10) : null,
    }
  }

  // Models API

  async getModels(): Promise<
    Array<{
      id: string
      name: string
      provider: string
      pricePerInputToken: string
      pricePerOutputToken: string
      maxContextLength: number
    }>
  > {
    const ModelSchema = z.object({
      id: z.string(),
      name: z.string(),
      provider: z.string(),
      pricePerInputToken: z.string(),
      pricePerOutputToken: z.string(),
      maxContextLength: z.number(),
    })

    const ModelsResponseSchema = z.object({
      models: z.array(ModelSchema),
    })

    const result = await this.fetch('/api/v1/models', {
      schema: ModelsResponseSchema,
    })
    return result.models
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const result = await this.fetch<{ embedding: number[] }>(
      '/api/v1/embeddings',
      {
        method: 'POST',
        body: JSON.stringify({ input: text }),
      },
    )
    return result.embedding
  }
}

// Factory Functions

/**
 * Creates a DWS client with the given configuration
 */
export function createDWSClient(config: DWSClientConfig): DWSClient {
  return new DWSClient(config)
}

/**
 * Default DWS client using environment/centralized config
 */
function getDefaultDWSClient(): DWSClient {
  const baseUrl = getDWSEndpoint()
  const ipfsGateway = process.env.IPFS_GATEWAY ?? `${baseUrl}/storage`
  return new DWSClient({ baseUrl, ipfsGateway })
}

// Singleton for convenience
let _defaultClient: DWSClient | null = null

export function getSharedDWSClient(): DWSClient {
  if (!_defaultClient) {
    _defaultClient = getDefaultDWSClient()
  }
  return _defaultClient
}

/**
 * Check DWS health status
 * Returns false if DWS is not available (gracefully handles errors)
 */
export async function checkDWSHealth(): Promise<boolean> {
  const client = getSharedDWSClient()
  const health = await client.health().catch(() => null)
  return health?.status === 'healthy'
}

/**
 * Check if DWS inference is available
 */
export async function checkDWSInferenceAvailable(): Promise<{
  available: boolean
  nodes: number
  error: string | null
}> {
  return getSharedDWSClient().checkInferenceAvailable()
}
