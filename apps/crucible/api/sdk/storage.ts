/**
 * Storage SDK - Handles agent state persistence on IPFS with DWS cache layer.
 */

import { type CacheClient, getCacheClient } from '@jejunetwork/shared'
import type { AgentCharacter, AgentState, RoomState } from '../../lib/types'
import {
  AgentCharacterSchema,
  AgentStateSchema,
  expect,
  expectTrue,
  RoomStateSchema,
  StorageUploadResponseSchema,
} from '../schemas'
import { createLogger, type Logger } from './logger'

export interface StorageConfig {
  apiUrl: string
  ipfsGateway: string
  logger?: Logger
  maxContentSize?: number // Max content size in bytes (default: 10MB)
  /** Enable DWS cache layer for faster reads (default: true) */
  enableCache?: boolean
  /** Cache TTL in seconds (default: 3600) */
  cacheTtl?: number
}

// Default maximum content size: 10MB
const DEFAULT_MAX_CONTENT_SIZE = 10 * 1024 * 1024
const DEFAULT_CACHE_TTL = 3600

export class CrucibleStorage {
  private config: StorageConfig
  private log: Logger
  private cache: CacheClient | null = null

  constructor(config: StorageConfig) {
    this.config = config
    this.log = config.logger ?? createLogger('Storage')

    // Initialize DWS cache if enabled (default: true)
    if (config.enableCache !== false) {
      this.cache = getCacheClient('crucible')
      this.log.info('DWS cache layer enabled for storage')
    }
  }

  private async cacheGet(key: string): Promise<string | null> {
    if (!this.cache) return null
    const value = await this.cache.get(key).catch(() => null)
    if (value) {
      this.log.debug('Cache hit', { key })
    }
    return value
  }

  private async cacheSet(key: string, value: string): Promise<void> {
    if (!this.cache) return
    const ttl = this.config.cacheTtl ?? DEFAULT_CACHE_TTL
    await this.cache.set(key, value, ttl).catch((err) => {
      this.log.warn('Cache set failed', { key, error: String(err) })
    })
  }

  async storeCharacter(character: AgentCharacter): Promise<string> {
    expect(character, 'Character is required')
    AgentCharacterSchema.parse(character)
    this.log.debug('Storing character', {
      id: character.id,
      name: character.name,
    })
    const cid = await this.upload(
      JSON.stringify(character, null, 2),
      `character-${character.id}.json`,
    )
    expect(cid, 'CID is required')
    expectTrue(cid.length > 0, 'CID cannot be empty')
    this.log.info('Character stored', { id: character.id, cid })
    return cid
  }

  async loadCharacter(cid: string): Promise<AgentCharacter> {
    expect(cid, 'CID is required')
    expectTrue(cid.length > 0, 'CID cannot be empty')
    this.log.debug('Loading character', { cid })

    // Check cache first
    const cacheKey = `character:${cid}`
    const cached = await this.cacheGet(cacheKey)
    if (cached) {
      const parsed = JSON.parse(cached)
      return AgentCharacterSchema.parse(parsed)
    }

    const content = await this.fetch(cid)
    expect(content, 'Character content is required')

    // Cache for future requests
    await this.cacheSet(cacheKey, content)

    const parsed = JSON.parse(content)
    return AgentCharacterSchema.parse(parsed)
  }

  async storeAgentState(state: AgentState): Promise<string> {
    expect(state, 'Agent state is required')
    expect(state.agentId, 'Agent ID is required')
    expectTrue(state.version >= 0, 'Version must be non-negative')
    this.log.debug('Storing agent state', {
      agentId: state.agentId,
      version: state.version,
    })
    const cid = await this.upload(
      JSON.stringify(state),
      `state-${state.agentId}-v${state.version}.json`,
    )
    expect(cid, 'CID is required')
    return cid
  }

  async loadAgentState(cid: string): Promise<AgentState> {
    expect(cid, 'CID is required')
    expectTrue(cid.length > 0, 'CID cannot be empty')
    this.log.debug('Loading agent state', { cid })

    // Check cache first
    const cacheKey = `agent-state:${cid}`
    const cached = await this.cacheGet(cacheKey)
    if (cached) {
      const parsed = JSON.parse(cached)
      const state = AgentStateSchema.parse(parsed)
      if (!state.agentId) throw new Error('Agent state missing agentId')
      return state as AgentState
    }

    const content = await this.fetch(cid)
    expect(content, 'State content is required')

    // Cache for future requests
    await this.cacheSet(cacheKey, content)

    const parsed = JSON.parse(content)
    const state = AgentStateSchema.parse(parsed)
    if (!state.agentId) throw new Error('Agent state missing agentId')
    return state as AgentState
  }

  createInitialState(agentId: string): AgentState {
    expect(agentId, 'Agent ID is required')
    expectTrue(agentId.length > 0, 'Agent ID cannot be empty')
    return {
      agentId,
      version: 0,
      memories: [],
      rooms: [],
      context: {},
      updatedAt: Date.now(),
    }
  }

  async updateAgentState(
    current: AgentState,
    updates: Partial<AgentState>,
  ): Promise<{ state: AgentState; cid: string }> {
    expect(current, 'Current state is required')
    expect(updates, 'Updates are required')
    const state: AgentState = {
      ...current,
      ...updates,
      version: current.version + 1,
      updatedAt: Date.now(),
    }
    const cid = await this.storeAgentState(state)
    this.log.info('Agent state updated', {
      agentId: state.agentId,
      version: state.version,
      cid,
    })
    return { state, cid }
  }

  async storeRoomState(state: RoomState): Promise<string> {
    expect(state, 'Room state is required')
    expect(state.roomId, 'Room ID is required')
    expectTrue(state.version >= 0, 'Version must be non-negative')
    this.log.debug('Storing room state', {
      roomId: state.roomId,
      version: state.version,
    })
    const cid = await this.upload(
      JSON.stringify(state),
      `room-${state.roomId}-v${state.version}.json`,
    )
    expect(cid, 'CID is required')
    return cid
  }

  async loadRoomState(cid: string): Promise<RoomState> {
    expect(cid, 'CID is required')
    expectTrue(cid.length > 0, 'CID cannot be empty')
    this.log.debug('Loading room state', { cid })

    // Check cache first
    const cacheKey = `room-state:${cid}`
    const cached = await this.cacheGet(cacheKey)
    if (cached) {
      const parsed = JSON.parse(cached)
      const state = RoomStateSchema.parse(parsed)
      return state as RoomState
    }

    const content = await this.fetch(cid)
    expect(content, 'Room state content is required')

    // Cache for future requests
    await this.cacheSet(cacheKey, content)

    const parsed = JSON.parse(content)
    const state = RoomStateSchema.parse(parsed)
    // Schema validates structure, result is compatible with RoomState
    return state as RoomState
  }

  createInitialRoomState(roomId: string): RoomState {
    expect(roomId, 'Room ID is required')
    expectTrue(roomId.length > 0, 'Room ID cannot be empty')
    return {
      roomId,
      version: 0,
      messages: [],
      scores: {},
      phase: 'setup',
      metadata: {},
      updatedAt: Date.now(),
    }
  }

  async exists(cid: string): Promise<boolean> {
    expect(cid, 'CID is required')
    expectTrue(cid.length > 0, 'CID cannot be empty')
    return (
      await fetch(`${this.config.ipfsGateway}/ipfs/${cid}`, { method: 'HEAD' })
    ).ok
  }

  async pin(cid: string): Promise<void> {
    expect(cid, 'CID is required')
    expectTrue(cid.length > 0, 'CID cannot be empty')
    this.log.debug('Pinning CID', { cid })
    const r = await fetch(`${this.config.apiUrl}/api/v1/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cid }),
    })
    expectTrue(r.ok, `Failed to pin CID: ${r.statusText}`)
  }

  private async upload(content: string, filename: string): Promise<string> {
    expect(content, 'Content is required')
    expect(filename, 'Filename is required')
    expectTrue(filename.length > 0, 'Filename cannot be empty')
    const r = await fetch(`${this.config.apiUrl}/api/v1/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, filename, pin: true }),
    })
    if (!r.ok) {
      throw new Error(`Failed to upload to IPFS: ${await r.text()}`)
    }
    const rawResult = await r.json()
    const result = StorageUploadResponseSchema.parse(rawResult)
    return result.cid
  }

  private async fetch(cid: string): Promise<string> {
    expect(cid, 'CID is required')
    expectTrue(cid.length > 0, 'CID cannot be empty')

    const maxSize = this.config.maxContentSize ?? DEFAULT_MAX_CONTENT_SIZE

    // First make a HEAD request to check content length
    const headResponse = await fetch(`${this.config.ipfsGateway}/ipfs/${cid}`, {
      method: 'HEAD',
    })
    if (headResponse.ok) {
      const contentLength = headResponse.headers.get('content-length')
      if (contentLength && parseInt(contentLength, 10) > maxSize) {
        throw new Error(
          `Content size ${contentLength} exceeds maximum allowed size ${maxSize}`,
        )
      }
    }

    const r = await fetch(`${this.config.ipfsGateway}/ipfs/${cid}`)
    expectTrue(r.ok, `Failed to fetch from IPFS: ${r.statusText}`)

    // Read content with size limit using streaming
    const reader = r.body?.getReader()
    if (!reader) {
      throw new Error('Failed to get response reader')
    }

    const chunks: Uint8Array[] = []
    let totalSize = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      totalSize += value.length
      if (totalSize > maxSize) {
        reader.cancel()
        throw new Error(`Content size exceeds maximum allowed size ${maxSize}`)
      }
      chunks.push(value)
    }

    const content = new TextDecoder().decode(
      chunks.reduce((acc, chunk) => {
        const newAcc = new Uint8Array(acc.length + chunk.length)
        newAcc.set(acc)
        newAcc.set(chunk, acc.length)
        return newAcc
      }, new Uint8Array(0)),
    )

    expect(content, 'Content is required')
    return content
  }
}

export function createStorage(config: StorageConfig): CrucibleStorage {
  return new CrucibleStorage(config)
}
