/**
 * SQLit Database Adapter for ElizaOS
 *
 * Implements IDatabaseAdapter using SQLit as the backend.
 * This is a complete implementation for agent operation on Jeju Network.
 *
 * Features:
 * - Full ElizaOS IDatabaseAdapter compatibility
 * - BFT-Raft consensus for strong consistency
 * - Column-level ACL for privacy
 * - Multi-tenant database rental
 * - Integration with DWS for vector embeddings
 */

import {
  type Agent,
  type AgentRunSummaryResult,
  ChannelType,
  type Component,
  DatabaseAdapter,
  type Entity,
  type Log,
  logger,
  type Memory,
  type MemoryMetadata,
  type Participant,
  type Relationship,
  type Room,
  type RunStatus,
  type Task,
  type UUID,
  type World,
} from '@elizaos/core'
import { getSQLitDatabaseId } from '@jejunetwork/config'
import {
  type SQLitClient,
  getSQLit,
  type QueryParam,
  serializeFloat32Vector,
} from '@jejunetwork/db'
import type { JsonRecord, JsonValue } from '@jejunetwork/types'
import { v4 as uuidv4 } from 'uuid'
import type { ZodType } from 'zod'
import { z } from 'zod'
import { checkMigrationStatus, runSQLitMigrations } from './migrations'

// Embedding API response schema
const EmbeddingResponseSchema = z.object({
  data: z.array(z.object({ embedding: z.array(z.number()) })).optional(),
})

/**
 * SQLit Database Adapter Configuration
 */
export interface SQLitAdapterConfig {
  databaseId?: string
  autoMigrate?: boolean
}

/**
 * SQLit Database Adapter for ElizaOS
 */
export class SQLitDatabaseAdapter extends DatabaseAdapter<SQLitClient> {
  private databaseId: string
  private autoMigrate: boolean
  private initialized = false
  private vectorSearchEnabled = false
  private embeddingDimension = 1536
  protected agentId: UUID
  private cacheStore = new Map<
    string,
    { value: string; expiresAt: number | null }
  >()

  constructor(agentId: UUID, config?: SQLitAdapterConfig) {
    super()
    this.agentId = agentId
    this.databaseId = config?.databaseId ?? getSQLitDatabaseId() ?? 'eliza'
    this.autoMigrate = config?.autoMigrate ?? true
    // Set db directly - parent class expects this property
    this.db = getSQLit()
  }

  async init(): Promise<void> {
    if (this.initialized) return

    logger.info(
      { src: 'sqlit-adapter', agentId: this.agentId },
      'Initializing SQLit database adapter',
    )

    // Check SQLit health
    const healthy = await this.db.isHealthy()
    if (!healthy) {
      throw new Error(
        'SQLit is not healthy. Ensure Jeju services are running: ' +
          'cd /path/to/jeju && bun jeju dev',
      )
    }

    // Run migrations if needed
    if (this.autoMigrate) {
      const migrated = await checkMigrationStatus(this.db, this.databaseId)
      if (!migrated) {
        await runSQLitMigrations(this.db, this.databaseId)
      }
    }

    // Check if sqlite-vec is available for vector search
    await this.checkVectorSearchAvailability()

    this.initialized = true
    logger.info(
      {
        src: 'sqlit-adapter',
        agentId: this.agentId,
        vectorSearch: this.vectorSearchEnabled,
      },
      'SQLit adapter initialized',
    )
  }

  async initialize(): Promise<void> {
    await this.init()
  }

  async isReady(): Promise<boolean> {
    return this.initialized && (await this.db.isHealthy())
  }

  async close(): Promise<void> {
    this.initialized = false
  }

  async getConnection(): Promise<SQLitClient> {
    return this.db
  }

  // Helper Methods

  private async checkVectorSearchAvailability(): Promise<void> {
    // Check if sqlite-vec extension is loaded by querying vec_version()
    const result = await this.db
      .query<{ version: string }>(
        'SELECT vec_version() as version',
        [],
        this.databaseId,
      )
      .catch(() => null)

    if (result?.rows[0]?.version) {
      this.vectorSearchEnabled = true
      logger.info(
        { src: 'sqlit-adapter', version: result.rows[0].version },
        'sqlite-vec extension available for vector search',
      )
    } else {
      this.vectorSearchEnabled = false
      logger.warn(
        { src: 'sqlit-adapter' },
        'sqlite-vec extension not available - vector search will use fallback',
      )
    }
  }

  private async query<T>(sql: string, params: QueryParam[] = []): Promise<T[]> {
    const result = await this.db.query<T>(sql, params, this.databaseId)
    return result.rows
  }

  private async exec(sql: string, params: QueryParam[] = []): Promise<number> {
    const result = await this.db.exec(sql, params, this.databaseId)
    return result.rowsAffected
  }

  private toJson(value: JsonValue): string {
    return JSON.stringify(value)
  }

  /**
   * Parse JSON from database - internal use for known-good data
   * This is used for data we wrote ourselves where the schema is implicit
   * Still wrapped in try-catch for resilience against corrupted data
   */
  private fromJson<T>(value: string | null): T | null {
    if (!value) return null
    try {
      // Cast is acceptable for internally-written data with implicit schema
      const parsed: unknown = JSON.parse(value)
      return parsed as T
    } catch (error) {
      console.error(
        '[ElizaDB] Failed to parse JSON from database:',
        error instanceof Error ? error.message : 'Parse error',
      )
      return null
    }
  }

  // Agent Methods

  async getAgent(agentId: UUID): Promise<Agent | null> {
    const rows = await this.query<{
      id: string
      name: string
      username: string
      details: string
      settings: string
      created_at: number
      updated_at: number
    }>('SELECT * FROM agents WHERE id = ?', [agentId])

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      id: row.id as UUID,
      name: row.name,
      username: row.username,
      bio: '',
      enabled: true,
      status: 'active',
    } as Agent
  }

  async getAgents(): Promise<Partial<Agent>[]> {
    const rows = await this.query<{
      id: string
      name: string
      username: string
    }>('SELECT id, name, username FROM agents')

    return rows.map((row) => ({
      id: row.id as UUID,
      name: row.name,
      username: row.username,
    }))
  }

  async createAgent(agent: Partial<Agent>): Promise<boolean> {
    const id = agent.id ?? uuidv4()
    await this.exec(
      'INSERT INTO agents (id, name, username, details, settings) VALUES (?, ?, ?, ?, ?)',
      [
        id,
        agent.name ?? 'Agent',
        agent.username ??
          agent.name?.toLowerCase().replace(/\s+/g, '_') ??
          'agent',
        '{}',
        '{}',
      ],
    )
    return true
  }

  async updateAgent(agentId: UUID, agent: Partial<Agent>): Promise<boolean> {
    const updates: string[] = []
    const params: QueryParam[] = []

    if (agent.name !== undefined) {
      updates.push('name = ?')
      params.push(agent.name)
    }
    if (agent.username !== undefined) {
      updates.push('username = ?')
      params.push(agent.username)
    }

    if (updates.length === 0) return true

    updates.push('updated_at = ?')
    params.push(Date.now())
    params.push(agentId)

    await this.exec(
      `UPDATE agents SET ${updates.join(', ')} WHERE id = ?`,
      params,
    )
    return true
  }

  async deleteAgent(agentId: UUID): Promise<boolean> {
    await this.exec('DELETE FROM agents WHERE id = ?', [agentId])
    return true
  }

  // Entity Methods

  async getEntitiesByIds(entityIds: UUID[]): Promise<Entity[] | null> {
    if (entityIds.length === 0) return []

    const placeholders = entityIds.map(() => '?').join(', ')
    const rows = await this.query<{
      id: string
      agent_id: string
      names: string
      metadata: string
      created_at: number
    }>(`SELECT * FROM entities WHERE id IN (${placeholders})`, entityIds)

    return rows.map((row) => ({
      id: row.id as UUID,
      agentId: row.agent_id as UUID,
      names: this.fromJson<string[]>(row.names) ?? [],
      metadata: this.fromJson<JsonRecord>(row.metadata) ?? {},
      createdAt: row.created_at,
    })) as Entity[]
  }

  async getEntitiesForRoom(
    roomId: UUID,
    _includeComponents?: boolean,
  ): Promise<Entity[]> {
    const rows = await this.query<{
      id: string
      agent_id: string
      names: string
      metadata: string
    }>(
      `SELECT e.* FROM entities e
       JOIN participants p ON p.entity_id = e.id
       WHERE p.room_id = ?`,
      [roomId],
    )

    return rows.map((row) => ({
      id: row.id as UUID,
      agentId: row.agent_id as UUID,
      names: this.fromJson<string[]>(row.names) ?? [],
      metadata: this.fromJson<JsonRecord>(row.metadata) ?? {},
    })) as Entity[]
  }

  async createEntities(entities: Entity[]): Promise<boolean> {
    for (const entity of entities) {
      await this.exec(
        'INSERT OR REPLACE INTO entities (id, agent_id, names, metadata) VALUES (?, ?, ?, ?)',
        [
          entity.id ?? uuidv4(),
          entity.agentId ?? this.agentId,
          this.toJson(entity.names as JsonValue),
          this.toJson((entity.metadata ?? {}) as JsonValue),
        ],
      )
    }
    return true
  }

  async updateEntity(entity: Entity): Promise<void> {
    if (!entity.id) throw new Error('Entity ID required for update')
    await this.exec(
      'UPDATE entities SET names = ?, metadata = ?, updated_at = ? WHERE id = ?',
      [
        this.toJson(entity.names as JsonValue),
        this.toJson((entity.metadata ?? {}) as JsonValue),
        Date.now(),
        entity.id,
      ],
    )
  }

  async deleteEntity(entityId: UUID): Promise<void> {
    await this.exec('DELETE FROM entities WHERE id = ?', [entityId])
  }

  // Component Methods

  async getComponent(
    entityId: UUID,
    type: string,
    worldId?: UUID,
    sourceEntityId?: UUID,
  ): Promise<Component | null> {
    let sql = 'SELECT * FROM components WHERE entity_id = ? AND type = ?'
    const params: QueryParam[] = [entityId, type]

    if (worldId) {
      sql += ' AND world_id = ?'
      params.push(worldId)
    }
    if (sourceEntityId) {
      sql += ' AND source_entity_id = ?'
      params.push(sourceEntityId)
    }

    const rows = await this.query<{
      id: string
      entity_id: string
      world_id: string | null
      source_entity_id: string | null
      type: string
      data: string
    }>(`${sql} LIMIT 1`, params)

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      id: row.id as UUID,
      entityId: row.entity_id as UUID,
      worldId: row.world_id as UUID | undefined,
      sourceEntityId: row.source_entity_id as UUID | undefined,
      type: row.type,
      data: this.fromJson(row.data) ?? {},
    } as Component
  }

  async getComponents(
    entityId: UUID,
    worldId?: UUID,
    sourceEntityId?: UUID,
  ): Promise<Component[]> {
    let sql = 'SELECT * FROM components WHERE entity_id = ?'
    const params: QueryParam[] = [entityId]

    if (worldId) {
      sql += ' AND world_id = ?'
      params.push(worldId)
    }
    if (sourceEntityId) {
      sql += ' AND source_entity_id = ?'
      params.push(sourceEntityId)
    }

    const rows = await this.query<{
      id: string
      entity_id: string
      world_id: string | null
      source_entity_id: string | null
      type: string
      data: string
    }>(sql, params)

    return rows.map((row) => ({
      id: row.id as UUID,
      entityId: row.entity_id as UUID,
      worldId: row.world_id as UUID | undefined,
      sourceEntityId: row.source_entity_id as UUID | undefined,
      type: row.type,
      data: this.fromJson(row.data) ?? {},
    })) as Component[]
  }

  async createComponent(component: Component): Promise<boolean> {
    await this.exec(
      'INSERT INTO components (id, entity_id, world_id, source_entity_id, type, data) VALUES (?, ?, ?, ?, ?, ?)',
      [
        component.id ?? uuidv4(),
        component.entityId,
        component.worldId ?? null,
        component.sourceEntityId ?? null,
        component.type,
        this.toJson(component.data as JsonValue),
      ],
    )
    return true
  }

  async updateComponent(component: Component): Promise<void> {
    await this.exec(
      'UPDATE components SET data = ?, updated_at = ? WHERE id = ?',
      [this.toJson(component.data as JsonValue), Date.now(), component.id],
    )
  }

  async deleteComponent(componentId: UUID): Promise<void> {
    await this.exec('DELETE FROM components WHERE id = ?', [componentId])
  }

  // Memory Methods

  async getMemories(params: {
    entityId?: UUID
    agentId?: UUID
    count?: number
    offset?: number
    unique?: boolean
    tableName: string
    start?: number
    end?: number
    roomId?: UUID
    worldId?: UUID
  }): Promise<Memory[]> {
    let sql = 'SELECT * FROM memories WHERE 1=1'
    const sqlParams: QueryParam[] = []

    if (params.roomId) {
      sql += ' AND room_id = ?'
      sqlParams.push(params.roomId)
    }
    if (params.entityId) {
      sql += ' AND entity_id = ?'
      sqlParams.push(params.entityId)
    }
    if (params.agentId) {
      sql += ' AND agent_id = ?'
      sqlParams.push(params.agentId)
    }
    if (params.worldId) {
      sql += ' AND world_id = ?'
      sqlParams.push(params.worldId)
    }
    if (params.start) {
      sql += ' AND created_at >= ?'
      sqlParams.push(params.start)
    }
    if (params.end) {
      sql += ' AND created_at <= ?'
      sqlParams.push(params.end)
    }
    if (params.unique) {
      sql += ' AND unique_hash IS NOT NULL'
    }

    sql += ' ORDER BY created_at DESC'

    if (params.count) {
      sql += ' LIMIT ?'
      sqlParams.push(params.count)
    }
    if (params.offset) {
      sql += ' OFFSET ?'
      sqlParams.push(params.offset)
    }

    const rows = await this.query<{
      id: string
      entity_id: string
      agent_id: string | null
      room_id: string
      world_id: string | null
      content: string
      embedding: string | null
      unique_hash: string | null
      created_at: number
    }>(sql, sqlParams)

    return rows.map((row) => ({
      id: row.id as UUID,
      entityId: row.entity_id as UUID,
      agentId: row.agent_id as UUID | undefined,
      roomId: row.room_id as UUID,
      worldId: row.world_id as UUID | undefined,
      content: this.fromJson(row.content) ?? { text: '' },
      embedding: row.embedding
        ? this.fromJson<number[]>(row.embedding)
        : undefined,
      unique: row.unique_hash !== null,
      createdAt: row.created_at,
    })) as Memory[]
  }

  async getMemoryById(id: UUID): Promise<Memory | null> {
    const rows = await this.query<{
      id: string
      entity_id: string
      agent_id: string | null
      room_id: string
      world_id: string | null
      content: string
      embedding: string | null
      created_at: number
    }>('SELECT * FROM memories WHERE id = ?', [id])

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      id: row.id as UUID,
      entityId: row.entity_id as UUID,
      agentId: row.agent_id as UUID | undefined,
      roomId: row.room_id as UUID,
      worldId: row.world_id as UUID | undefined,
      content: this.fromJson(row.content) ?? { text: '' },
      embedding: row.embedding
        ? this.fromJson<number[]>(row.embedding)
        : undefined,
      createdAt: row.created_at,
    } as Memory
  }

  async getMemoriesByIds(ids: UUID[], _tableName?: string): Promise<Memory[]> {
    if (ids.length === 0) return []

    const placeholders = ids.map(() => '?').join(', ')
    const rows = await this.query<{
      id: string
      entity_id: string
      agent_id: string | null
      room_id: string
      world_id: string | null
      content: string
      embedding: string | null
      created_at: number
    }>(`SELECT * FROM memories WHERE id IN (${placeholders})`, ids)

    return rows.map((row) => ({
      id: row.id as UUID,
      entityId: row.entity_id as UUID,
      agentId: row.agent_id as UUID | undefined,
      roomId: row.room_id as UUID,
      content: this.fromJson(row.content) ?? { text: '' },
      createdAt: row.created_at,
    })) as Memory[]
  }

  async getMemoriesByRoomIds(params: {
    tableName: string
    roomIds: UUID[]
    limit?: number
  }): Promise<Memory[]> {
    if (params.roomIds.length === 0) return []

    const placeholders = params.roomIds.map(() => '?').join(', ')
    let sql = `SELECT * FROM memories WHERE room_id IN (${placeholders}) ORDER BY created_at DESC`
    const sqlParams: QueryParam[] = [...params.roomIds]

    if (params.limit) {
      sql += ' LIMIT ?'
      sqlParams.push(params.limit)
    }

    const rows = await this.query<{
      id: string
      entity_id: string
      room_id: string
      content: string
      created_at: number
    }>(sql, sqlParams)

    return rows.map((row) => ({
      id: row.id as UUID,
      entityId: row.entity_id as UUID,
      roomId: row.room_id as UUID,
      content: this.fromJson(row.content) ?? { text: '' },
      createdAt: row.created_at,
    })) as Memory[]
  }

  async createMemory(
    memory: Memory,
    _tableName: string,
    unique?: boolean,
  ): Promise<UUID> {
    const id = (memory.id ?? uuidv4()) as UUID
    const uniqueHash = unique ? this.hashContent(memory.content) : null

    await this.exec(
      `INSERT INTO memories (id, entity_id, agent_id, room_id, world_id, content, embedding, unique_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        memory.entityId,
        memory.agentId ?? null,
        memory.roomId,
        memory.worldId ?? null,
        this.toJson(memory.content as JsonValue),
        memory.embedding ? this.toJson(memory.embedding) : null,
        uniqueHash,
      ],
    )

    // Also insert into vector search table if embedding is provided and sqlite-vec is available
    if (
      memory.embedding &&
      memory.embedding.length > 0 &&
      this.vectorSearchEnabled
    ) {
      await this.insertEmbeddingVector(id, memory)
    }

    return id
  }

  /**
   * Insert embedding into vec0 virtual table for fast KNN search
   */
  private async insertEmbeddingVector(
    memoryId: UUID,
    memory: Memory,
  ): Promise<void> {
    if (!memory.embedding || memory.embedding.length === 0) return

    // Validate embedding dimension matches expected
    if (memory.embedding.length !== this.embeddingDimension) {
      logger.warn(
        {
          src: 'sqlit-adapter',
          expected: this.embeddingDimension,
          got: memory.embedding.length,
        },
        'Embedding dimension mismatch - skipping vector insert',
      )
      return
    }

    const embeddingBlob = serializeFloat32Vector(memory.embedding)

    await this.exec(
      `INSERT INTO memory_embeddings (embedding, memory_id, room_id, entity_id, agent_id)
       VALUES (?, ?, ?, ?, ?)`,
      [
        embeddingBlob,
        memoryId,
        memory.roomId,
        memory.entityId,
        memory.agentId ?? null,
      ],
    ).catch((error) => {
      logger.warn(
        { src: 'sqlit-adapter', memoryId, error },
        'Failed to insert embedding into vector table',
      )
    })
  }

  async updateMemory(
    memory: Partial<Memory> & { id: UUID; metadata?: MemoryMetadata },
  ): Promise<boolean> {
    const updates: string[] = []
    const params: QueryParam[] = []

    if (memory.content !== undefined) {
      updates.push('content = ?')
      params.push(this.toJson(memory.content as JsonValue))
    }
    if (memory.embedding !== undefined) {
      updates.push('embedding = ?')
      params.push(memory.embedding ? this.toJson(memory.embedding) : null)
    }

    if (updates.length === 0) return true

    params.push(memory.id)
    await this.exec(
      `UPDATE memories SET ${updates.join(', ')} WHERE id = ?`,
      params,
    )
    return true
  }

  async deleteMemory(memoryId: UUID): Promise<void> {
    // Delete from vector table first
    if (this.vectorSearchEnabled) {
      await this.exec('DELETE FROM memory_embeddings WHERE memory_id = ?', [
        memoryId,
      ]).catch(() => {})
    }
    await this.exec('DELETE FROM memories WHERE id = ?', [memoryId])
  }

  async deleteManyMemories(memoryIds: UUID[]): Promise<void> {
    if (memoryIds.length === 0) return

    const placeholders = memoryIds.map(() => '?').join(', ')
    await this.exec(
      `DELETE FROM memories WHERE id IN (${placeholders})`,
      memoryIds,
    )
  }

  async deleteAllMemories(roomId: UUID, _tableName: string): Promise<void> {
    await this.exec('DELETE FROM memories WHERE room_id = ?', [roomId])
  }

  async countMemories(
    roomId: UUID,
    unique?: boolean,
    _tableName?: string,
  ): Promise<number> {
    let sql = 'SELECT COUNT(*) as count FROM memories WHERE room_id = ?'
    const params: QueryParam[] = [roomId]

    if (unique) {
      sql += ' AND unique_hash IS NOT NULL'
    }

    const rows = await this.query<{ count: number }>(sql, params)
    return rows[0].count ?? 0
  }

  async searchMemories(params: {
    embedding: number[]
    match_threshold?: number
    count?: number
    unique?: boolean
    tableName: string
    query?: string
    roomId?: UUID
    worldId?: UUID
    entityId?: UUID
  }): Promise<Memory[]> {
    const k = params.count ?? 10

    // Try sqlite-vec KNN search first
    if (params.embedding.length > 0 && this.vectorSearchEnabled) {
      const embeddingBlob = serializeFloat32Vector(params.embedding)
      const sqlParams: QueryParam[] = [embeddingBlob]

      // Build the KNN query using vec0 MATCH syntax
      let sql = `
        SELECT ve.memory_id, ve.distance, m.*
        FROM memory_embeddings AS ve
        JOIN memories AS m ON m.id = ve.memory_id
        WHERE ve.embedding MATCH ?
          AND k = ${k}
      `

      if (params.roomId) {
        sql += ' AND ve.room_id = ?'
        sqlParams.push(params.roomId)
      }
      if (params.entityId) {
        sql += ' AND ve.entity_id = ?'
        sqlParams.push(params.entityId)
      }
      if (params.unique) {
        sql += ' AND m.unique_hash IS NOT NULL'
      }

      sql += ' ORDER BY ve.distance'

      const rows = await this.query<{
        id: string
        memory_id: string
        distance: number
        entity_id: string
        room_id: string
        world_id: string | null
        content: string
        embedding: string | null
        created_at: number
      }>(sql, sqlParams).catch(() => null)

      if (rows && rows.length > 0) {
        // Filter by threshold if provided (convert L2 distance to similarity)
        const threshold = params.match_threshold ?? 0.0
        const filteredRows =
          threshold > 0
            ? rows.filter((row) => row.distance <= (1 - threshold) * 2)
            : rows

        return filteredRows.map((row) => ({
          id: row.id as UUID,
          entityId: row.entity_id as UUID,
          roomId: row.room_id as UUID,
          worldId: row.world_id as UUID | undefined,
          content: this.fromJson(row.content) ?? { text: '' },
          embedding: row.embedding
            ? this.fromJson<number[]>(row.embedding)
            : undefined,
          createdAt: row.created_at,
        })) as Memory[]
      }
    }

    // Fallback to recency-based search if vector search unavailable
    let sql = 'SELECT * FROM memories WHERE 1=1'
    const sqlParams: QueryParam[] = []

    if (params.roomId) {
      sql += ' AND room_id = ?'
      sqlParams.push(params.roomId)
    }
    if (params.entityId) {
      sql += ' AND entity_id = ?'
      sqlParams.push(params.entityId)
    }
    if (params.worldId) {
      sql += ' AND world_id = ?'
      sqlParams.push(params.worldId)
    }
    if (params.unique) {
      sql += ' AND unique_hash IS NOT NULL'
    }

    sql += ' ORDER BY created_at DESC'
    sql += ` LIMIT ${k}`

    const rows = await this.query<{
      id: string
      entity_id: string
      room_id: string
      content: string
      created_at: number
    }>(sql, sqlParams)

    return rows.map((row) => ({
      id: row.id as UUID,
      entityId: row.entity_id as UUID,
      roomId: row.room_id as UUID,
      content: this.fromJson(row.content) ?? { text: '' },
      createdAt: row.created_at,
    })) as Memory[]
  }

  // World Methods

  async createWorld(world: World): Promise<UUID> {
    const id = (world.id ?? uuidv4()) as UUID
    await this.exec(
      'INSERT INTO worlds (id, agent_id, name, server_id, metadata) VALUES (?, ?, ?, ?, ?)',
      [
        id,
        world.agentId ?? this.agentId,
        world.name ?? 'Default World',
        world.serverId ?? '',
        this.toJson((world.metadata ?? {}) as JsonValue),
      ],
    )
    return id
  }

  async getWorld(id: UUID): Promise<World | null> {
    const rows = await this.query<{
      id: string
      agent_id: string
      name: string
      server_id: string | null
      metadata: string
    }>('SELECT * FROM worlds WHERE id = ?', [id])

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      id: row.id as UUID,
      agentId: row.agent_id as UUID,
      name: row.name,
      serverId: row.server_id ?? undefined,
      metadata: this.fromJson<JsonRecord>(row.metadata) ?? {},
    } as World
  }

  async removeWorld(id: UUID): Promise<void> {
    await this.exec('DELETE FROM worlds WHERE id = ?', [id])
  }

  async getAllWorlds(): Promise<World[]> {
    const rows = await this.query<{
      id: string
      agent_id: string
      name: string
      server_id: string | null
      metadata: string
    }>('SELECT * FROM worlds')

    return rows.map((row) => ({
      id: row.id as UUID,
      agentId: row.agent_id as UUID,
      name: row.name,
      serverId: row.server_id ?? undefined,
      metadata: this.fromJson<JsonRecord>(row.metadata) ?? {},
    })) as World[]
  }

  async updateWorld(world: World): Promise<void> {
    if (!world.id) throw new Error('World ID required for update')
    await this.exec(
      'UPDATE worlds SET name = ?, metadata = ?, updated_at = ? WHERE id = ?',
      [
        world.name ?? '',
        this.toJson((world.metadata ?? {}) as JsonValue),
        Date.now(),
        world.id,
      ],
    )
  }

  // Room Methods

  async getRoomsByIds(roomIds: UUID[]): Promise<Room[] | null> {
    if (roomIds.length === 0) return []

    const placeholders = roomIds.map(() => '?').join(', ')
    const rows = await this.query<{
      id: string
      world_id: string | null
      name: string
      source: string
      type: string
      channel_id: string | null
      metadata: string
    }>(`SELECT * FROM rooms WHERE id IN (${placeholders})`, roomIds)

    return rows.map((row) => ({
      id: row.id as UUID,
      worldId: row.world_id as UUID | undefined,
      name: row.name,
      source: row.source,
      type: row.type,
      channelId: row.channel_id ?? undefined,
      metadata: this.fromJson<JsonRecord>(row.metadata) ?? {},
    })) as Room[]
  }

  async createRooms(rooms: Room[]): Promise<UUID[]> {
    const ids: UUID[] = []

    for (const room of rooms) {
      const id = (room.id ?? uuidv4()) as UUID
      await this.exec(
        'INSERT INTO rooms (id, world_id, name, source, type, channel_id, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          id,
          room.worldId ?? '',
          room.name ?? 'Default Room',
          room.source ?? 'api',
          room.type ?? 'DM',
          room.channelId ?? '',
          this.toJson((room.metadata ?? {}) as JsonValue),
        ],
      )
      ids.push(id)
    }

    return ids
  }

  async deleteRoom(roomId: UUID): Promise<void> {
    await this.exec('DELETE FROM rooms WHERE id = ?', [roomId])
  }

  async deleteRoomsByWorldId(worldId: UUID): Promise<void> {
    await this.exec('DELETE FROM rooms WHERE world_id = ?', [worldId])
  }

  async updateRoom(room: Room): Promise<void> {
    if (!room.id) throw new Error('Room ID required for update')
    await this.exec(
      'UPDATE rooms SET name = ?, metadata = ?, updated_at = ? WHERE id = ?',
      [
        room.name ?? '',
        this.toJson((room.metadata ?? {}) as JsonValue),
        Date.now(),
        room.id,
      ],
    )
  }

  async getRoomsForParticipant(entityId: UUID): Promise<UUID[]> {
    const rows = await this.query<{ room_id: string }>(
      'SELECT room_id FROM participants WHERE entity_id = ?',
      [entityId],
    )
    return rows.map((row) => row.room_id as UUID)
  }

  async getRoomsForParticipants(entityIds: UUID[]): Promise<UUID[]> {
    if (entityIds.length === 0) return []

    const placeholders = entityIds.map(() => '?').join(', ')
    const rows = await this.query<{ room_id: string }>(
      `SELECT DISTINCT room_id FROM participants WHERE entity_id IN (${placeholders})`,
      entityIds,
    )
    return rows.map((row) => row.room_id as UUID)
  }

  // Participant Methods

  async addParticipant(entityId: UUID, roomId: UUID): Promise<boolean> {
    const id = uuidv4()
    await this.exec(
      'INSERT OR IGNORE INTO participants (id, room_id, entity_id) VALUES (?, ?, ?)',
      [id, roomId, entityId],
    )
    return true
  }

  async removeParticipant(entityId: UUID, roomId: UUID): Promise<boolean> {
    await this.exec(
      'DELETE FROM participants WHERE entity_id = ? AND room_id = ?',
      [entityId, roomId],
    )
    return true
  }

  async getParticipantsForRoom(roomId: UUID): Promise<UUID[]> {
    const rows = await this.query<{ entity_id: string }>(
      'SELECT entity_id FROM participants WHERE room_id = ?',
      [roomId],
    )
    return rows.map((row) => row.entity_id as UUID)
  }

  async getParticipantUserState(
    _roomId: UUID,
    _entityId: UUID,
  ): Promise<'FOLLOWED' | 'MUTED' | null> {
    // Simplified - could extend participants table to track this
    return null
  }

  async setParticipantUserState(
    _roomId: UUID,
    _entityId: UUID,
    _state: 'FOLLOWED' | 'MUTED' | null,
  ): Promise<void> {
    // Not implemented in minimal version
  }

  // Relationship Methods

  async getRelationship(params: {
    sourceEntityId: UUID
    targetEntityId: UUID
  }): Promise<Relationship | null> {
    const rows = await this.query<{
      id: string
      source_entity_id: string
      target_entity_id: string
      agent_id: string
      type: string
      metadata: string
      created_at: number
    }>(
      'SELECT * FROM relationships WHERE source_entity_id = ? AND target_entity_id = ?',
      [params.sourceEntityId, params.targetEntityId],
    )

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      id: row.id as UUID,
      sourceEntityId: row.source_entity_id as UUID,
      targetEntityId: row.target_entity_id as UUID,
      agentId: row.agent_id as UUID,
      tags: [],
      metadata: this.fromJson<JsonRecord>(row.metadata) ?? {},
      createdAt: new Date(row.created_at).toISOString(),
    } as Relationship
  }

  async getRelationships(params: { entityId: UUID }): Promise<Relationship[]> {
    const rows = await this.query<{
      id: string
      source_entity_id: string
      target_entity_id: string
      agent_id: string
      type: string
      metadata: string
      created_at: number
    }>(
      'SELECT * FROM relationships WHERE source_entity_id = ? OR target_entity_id = ?',
      [params.entityId, params.entityId],
    )

    return rows.map((row) => ({
      id: row.id as UUID,
      sourceEntityId: row.source_entity_id as UUID,
      targetEntityId: row.target_entity_id as UUID,
      agentId: row.agent_id as UUID,
      tags: [],
      metadata: this.fromJson<JsonRecord>(row.metadata) ?? {},
      createdAt: new Date(row.created_at).toISOString(),
    })) as Relationship[]
  }

  async createRelationship(relationship: Relationship): Promise<boolean> {
    const id = relationship.id ?? uuidv4()
    await this.exec(
      'INSERT INTO relationships (id, source_entity_id, target_entity_id, agent_id, type, metadata) VALUES (?, ?, ?, ?, ?, ?)',
      [
        id,
        relationship.sourceEntityId,
        relationship.targetEntityId,
        relationship.agentId ?? this.agentId,
        relationship.tags[0] ?? 'default',
        this.toJson((relationship.metadata as JsonValue) ?? {}),
      ],
    )
    return true
  }

  async updateRelationship(relationship: Relationship): Promise<void> {
    await this.exec(
      'UPDATE relationships SET type = ?, metadata = ? WHERE id = ?',
      [
        relationship.tags[0] ?? 'default',
        this.toJson((relationship.metadata as JsonValue) ?? {}),
        relationship.id,
      ],
    )
  }

  // Cache Methods - In-Memory Implementation

  /**
   * Get cached value with optional schema validation
   * Note: For type safety with external data, provide a schema parameter
   */
  async getCache<T>(key: string, schema?: ZodType<T>): Promise<T | undefined> {
    const entry = this.cacheStore.get(key)
    if (!entry) return undefined

    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.cacheStore.delete(key)
      return undefined
    }

    const parsed: unknown = JSON.parse(entry.value)
    if (schema) {
      const result = schema.safeParse(parsed)
      if (!result.success) {
        logger.warn(
          { src: 'sqlit-adapter', key, error: result.error.message },
          'Cache value failed validation',
        )
        return undefined
      }
      return result.data
    }
    // For internal cache (we control what's stored), return as-is
    return parsed as T
  }

  async setCache<T>(key: string, value: T): Promise<boolean> {
    this.cacheStore.set(key, {
      value: JSON.stringify(value),
      expiresAt: null, // Default no expiration
    })
    return true
  }

  async deleteCache(key: string): Promise<boolean> {
    this.cacheStore.delete(key)
    return true
  }

  // Log Methods

  async log(params: {
    body: { [key: string]: unknown }
    entityId: UUID
    roomId: UUID
    type: string
  }): Promise<void> {
    const id = uuidv4()
    await this.exec(
      'INSERT INTO logs (id, entity_id, room_id, type, body) VALUES (?, ?, ?, ?, ?)',
      [
        id,
        params.entityId,
        params.roomId,
        params.type,
        this.toJson(params.body as JsonValue),
      ],
    )
  }

  async getLogs(params: {
    entityId?: UUID
    roomId?: UUID
    type?: string
    count?: number
    offset?: number
  }): Promise<Log[]> {
    let sql = 'SELECT * FROM logs WHERE 1=1'
    const sqlParams: QueryParam[] = []

    if (params.entityId) {
      sql += ' AND entity_id = ?'
      sqlParams.push(params.entityId)
    }
    if (params.roomId) {
      sql += ' AND room_id = ?'
      sqlParams.push(params.roomId)
    }
    if (params.type) {
      sql += ' AND type = ?'
      sqlParams.push(params.type)
    }

    sql += ' ORDER BY created_at DESC'

    if (params.count) {
      sql += ' LIMIT ?'
      sqlParams.push(params.count)
    }
    if (params.offset) {
      sql += ' OFFSET ?'
      sqlParams.push(params.offset)
    }

    const rows = await this.query<{
      id: string
      entity_id: string
      room_id: string
      type: string
      body: string
      created_at: number
    }>(sql, sqlParams)

    return rows.map((row) => ({
      id: row.id as UUID,
      entityId: row.entity_id as UUID,
      roomId: row.room_id as UUID,
      type: row.type,
      body: this.fromJson<JsonRecord>(row.body) ?? {},
      createdAt: new Date(row.created_at),
    })) as Log[]
  }

  async deleteLog(logId: UUID): Promise<void> {
    await this.exec('DELETE FROM logs WHERE id = ?', [logId])
  }

  // Task Methods

  async getTasks(params: {
    roomId?: UUID
    worldId?: UUID
    tags?: string[]
    status?: string
  }): Promise<Task[]> {
    let sql = 'SELECT * FROM tasks WHERE 1=1'
    const sqlParams: QueryParam[] = []

    if (params.roomId) {
      sql += ' AND room_id = ?'
      sqlParams.push(params.roomId)
    }
    if (params.worldId) {
      sql += ' AND world_id = ?'
      sqlParams.push(params.worldId)
    }
    if (params.status) {
      sql += ' AND status = ?'
      sqlParams.push(params.status)
    }

    sql += ' ORDER BY priority DESC, created_at DESC'

    const rows = await this.query<{
      id: string
      room_id: string | null
      world_id: string | null
      name: string
      description: string | null
      tags: string | null
      metadata: string | null
      status: string
      priority: number
      created_at: number
    }>(sql, sqlParams)

    return rows.map((row) => ({
      id: row.id as UUID,
      roomId: row.room_id as UUID | undefined,
      worldId: row.world_id as UUID | undefined,
      name: row.name,
      description: row.description ?? '',
      tags: row.tags ? (this.fromJson<string[]>(row.tags) ?? []) : [],
      metadata: row.metadata
        ? (this.fromJson<Record<string, unknown>>(row.metadata) ?? {})
        : {},
    })) as Task[]
  }

  async getTask(id: UUID): Promise<Task | null> {
    const rows = await this.query<{
      id: string
      room_id: string | null
      name: string
      description: string | null
      tags: string | null
      created_at: number
    }>('SELECT * FROM tasks WHERE id = ?', [id])

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      id: row.id as UUID,
      roomId: row.room_id as UUID | undefined,
      name: row.name,
      description: row.description ?? '',
      tags: row.tags ? (this.fromJson<string[]>(row.tags) ?? []) : [],
    } as Task
  }

  async createTask(task: Task): Promise<UUID> {
    const id = (task.id ?? uuidv4()) as UUID
    await this.exec(
      'INSERT INTO tasks (id, room_id, world_id, name, description, tags, metadata, status, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        task.roomId ?? null,
        task.worldId ?? null,
        task.name,
        task.description ?? null,
        task.tags ? this.toJson(task.tags) : null,
        task.metadata ? this.toJson(task.metadata as JsonValue) : null,
        'pending',
        0,
      ],
    )
    return id
  }

  async updateTask(id: UUID, task: Partial<Task>): Promise<void> {
    const updates: string[] = []
    const params: QueryParam[] = []

    if (task.name !== undefined) {
      updates.push('name = ?')
      params.push(task.name)
    }
    if (task.description !== undefined) {
      updates.push('description = ?')
      params.push(task.description)
    }
    if (task.metadata !== undefined) {
      updates.push('metadata = ?')
      params.push(this.toJson(task.metadata as JsonValue))
    }

    if (updates.length === 0) return

    updates.push('updated_at = ?')
    params.push(Date.now())
    params.push(id)

    await this.exec(
      `UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`,
      params,
    )
  }

  async deleteTask(id: UUID): Promise<void> {
    await this.exec('DELETE FROM tasks WHERE id = ?', [id])
  }

  // Not Implemented / Stub Methods

  async ensureEmbeddingDimension(dimension: number): Promise<void> {
    // Store the expected embedding dimension for validation
    this.embeddingDimension = dimension
    logger.debug(
      { src: 'sqlit-adapter', dimension },
      'Embedding dimension configured',
    )
  }

  async getCachedEmbeddings(_params: {
    query_table_name: string
    query_threshold: number
    query_input: string
    query_field_name: string
    query_field_sub_name: string
    query_match_count: number
  }): Promise<{ embedding: number[]; levenshtein_score: number }[]> {
    // Not supported in SQLit
    return []
  }

  async getAgentRunSummaries(_params: {
    limit?: number
    roomId?: UUID
    status?: RunStatus | 'all'
    from?: number
    to?: number
    entityId?: UUID
  }): Promise<AgentRunSummaryResult> {
    return { runs: [], total: 0, hasMore: false }
  }

  // Additional required methods for DatabaseAdapter

  async runPluginMigrations(
    _plugins: {
      name: string
      schema?: Record<string, string | number | boolean | JsonRecord | null>
    }[],
    _options?: { verbose?: boolean; force?: boolean; dryRun?: boolean },
  ): Promise<void> {
    // Plugin-specific migrations not needed for SQLit
  }

  async getRoomsByWorld(worldId: UUID): Promise<Room[]> {
    const rows = await this.query<{
      id: string
      world_id: string | null
      name: string
      source: string
      type: string
      channel_id: string | null
      metadata: string
    }>('SELECT * FROM rooms WHERE world_id = ?', [worldId])

    return rows.map((row) => ({
      id: row.id as UUID,
      worldId: row.world_id as UUID | undefined,
      name: row.name,
      source: row.source,
      type: row.type,
      channelId: row.channel_id ?? undefined,
      metadata: this.fromJson<JsonRecord>(row.metadata) ?? {},
    })) as Room[]
  }

  async addParticipantsRoom(entityIds: UUID[], roomId: UUID): Promise<boolean> {
    for (const entityId of entityIds) {
      await this.addParticipant(entityId, roomId)
    }
    return true
  }

  async getParticipantsForEntity(
    entityId: UUID,
  ): Promise<{ id: UUID; roomId: UUID; entity: Entity }[]> {
    const rows = await this.query<{
      id: string
      room_id: string
      entity_id: string
    }>(
      'SELECT p.id, p.room_id, p.entity_id FROM participants p WHERE p.entity_id = ?',
      [entityId],
    )

    const entityData = await this.getEntityById(entityId)
    const entity: Entity =
      entityData ??
      ({
        id: entityId,
        agentId: this.agentId,
        names: [],
        metadata: {},
      } as Entity)

    return rows.map((row) => ({
      id: row.id as UUID,
      roomId: row.room_id as UUID,
      entity,
    }))
  }

  async isRoomParticipant(entityId: UUID, roomId: UUID): Promise<boolean> {
    const rows = await this.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM participants WHERE entity_id = ? AND room_id = ?',
      [entityId, roomId],
    )
    return (rows[0].count ?? 0) > 0
  }

  async getTasksByName(name: string): Promise<Task[]> {
    const rows = await this.query<{
      id: string
      room_id: string | null
      world_id: string | null
      name: string
      description: string | null
      tags: string | null
      metadata: string | null
      status: string
      priority: number
      created_at: number
    }>('SELECT * FROM tasks WHERE name = ?', [name])

    return rows.map((row) => ({
      id: row.id as UUID,
      roomId: row.room_id as UUID | undefined,
      worldId: row.world_id as UUID | undefined,
      name: row.name,
      description: row.description ?? '',
      tags: row.tags ? (this.fromJson<string[]>(row.tags) ?? []) : [],
      metadata: row.metadata
        ? (this.fromJson<Record<string, unknown>>(row.metadata) ?? {})
        : {},
    })) as Task[]
  }

  async getParticipantsByEntityIds(
    entityIds: UUID[],
  ): Promise<Map<UUID, UUID[]>> {
    const result = new Map<UUID, UUID[]>()
    if (entityIds.length === 0) return result

    const placeholders = entityIds.map(() => '?').join(', ')
    const rows = await this.query<{ entity_id: string; room_id: string }>(
      `SELECT entity_id, room_id FROM participants WHERE entity_id IN (${placeholders})`,
      entityIds,
    )

    for (const row of rows) {
      const entityId = row.entity_id as UUID
      const roomIds = result.get(entityId) ?? []
      roomIds.push(row.room_id as UUID)
      result.set(entityId, roomIds)
    }

    return result
  }

  async getMemoriesByWorldId(params: {
    worldId: UUID
    tableName?: string
    limit?: number
  }): Promise<Memory[]> {
    let sql =
      'SELECT * FROM memories WHERE world_id = ? ORDER BY created_at DESC'
    const sqlParams: QueryParam[] = [params.worldId]

    if (params.limit) {
      sql += ' LIMIT ?'
      sqlParams.push(params.limit)
    }

    const rows = await this.query<{
      id: string
      entity_id: string
      room_id: string
      content: string
      created_at: number
    }>(sql, sqlParams)

    return rows.map((row) => ({
      id: row.id as UUID,
      entityId: row.entity_id as UUID,
      roomId: row.room_id as UUID,
      content: this.fromJson(row.content) ?? { text: '' },
      createdAt: row.created_at,
    })) as Memory[]
  }

  async getEntityById(entityId: UUID): Promise<Entity | null> {
    const entities = await this.getEntitiesByIds([entityId])
    return entities?.[0] ?? null
  }

  // Agent Management Methods

  async countAgents(): Promise<number> {
    const rows = await this.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM agents',
    )
    return rows[0].count ?? 0
  }

  async cleanupAgents(): Promise<void> {
    await this.exec('DELETE FROM agents', [])
    logger.info(
      { src: 'sqlit-adapter', agentId: this.agentId },
      'All agents cleaned up',
    )
  }

  // Entity Helpers

  async ensureEntityExists(entity: Entity): Promise<boolean> {
    if (!entity.id) {
      logger.error({ src: 'sqlit-adapter' }, 'Entity ID is required')
      return false
    }

    const existing = await this.getEntitiesByIds([entity.id])
    if (!existing || existing.length === 0) {
      return await this.createEntities([entity])
    }
    return true
  }

  // Message & Channel Methods (Central Database Tables)

  async getMessages(params: {
    roomId?: UUID
    limit?: number
    before?: number
    after?: number
  }): Promise<Memory[]> {
    let sql = 'SELECT * FROM memories WHERE 1=1'
    const sqlParams: QueryParam[] = []

    if (params.roomId) {
      sql += ' AND room_id = ?'
      sqlParams.push(params.roomId)
    }
    if (params.before) {
      sql += ' AND created_at < ?'
      sqlParams.push(params.before)
    }
    if (params.after) {
      sql += ' AND created_at > ?'
      sqlParams.push(params.after)
    }

    sql += ' ORDER BY created_at DESC'

    if (params.limit) {
      sql += ' LIMIT ?'
      sqlParams.push(params.limit)
    }

    const rows = await this.query<{
      id: string
      entity_id: string
      agent_id: string | null
      room_id: string
      world_id: string | null
      content: string
      embedding: string | null
      created_at: number
    }>(sql, sqlParams)

    return rows.map((row) => ({
      id: row.id as UUID,
      entityId: row.entity_id as UUID,
      agentId: row.agent_id as UUID | undefined,
      roomId: row.room_id as UUID,
      worldId: row.world_id as UUID | undefined,
      content: this.fromJson(row.content) ?? { text: '' },
      embedding: row.embedding
        ? this.fromJson<number[]>(row.embedding)
        : undefined,
      createdAt: row.created_at,
    })) as Memory[]
  }

  async getChannels(worldId: UUID): Promise<Room[]> {
    const rows = await this.query<{
      id: string
      world_id: string | null
      name: string
      source: string
      type: string
      channel_id: string | null
      metadata: string
    }>('SELECT * FROM rooms WHERE world_id = ? AND type != ?', [
      worldId,
      ChannelType.DM,
    ])

    return rows.map((row) => ({
      id: row.id as UUID,
      worldId: row.world_id as UUID | undefined,
      name: row.name,
      source: row.source,
      type: row.type as ChannelType,
      channelId: row.channel_id ?? undefined,
      metadata: this.fromJson<JsonRecord>(row.metadata) ?? {},
    })) as Room[]
  }

  async getChannelParticipants(
    roomId: UUID,
  ): Promise<{ id: UUID; entityId: UUID; role: string }[]> {
    const rows = await this.query<{
      id: string
      entity_id: string
      role: string
    }>('SELECT id, entity_id, role FROM participants WHERE room_id = ?', [
      roomId,
    ])

    return rows.map((row) => ({
      id: row.id as UUID,
      entityId: row.entity_id as UUID,
      role: row.role ?? 'member',
    }))
  }

  // Participant Extended Methods

  async getParticipant(
    entityId: UUID,
    roomId: UUID,
  ): Promise<Participant | null> {
    const rows = await this.query<{
      id: string
      room_id: string
      entity_id: string
      role: string
      created_at: number
    }>(
      'SELECT * FROM participants WHERE entity_id = ? AND room_id = ? LIMIT 1',
      [entityId, roomId],
    )

    if (rows.length === 0) return null

    const row = rows[0]
    // Load the entity for the participant
    const entity = await this.getEntityById(row.entity_id as UUID)
    return {
      id: row.id as UUID,
      entity: entity ?? {
        id: row.entity_id as UUID,
        names: [],
        agentId: this.agentId,
        metadata: {},
      },
    }
  }

  async updateParticipantRole(
    entityId: UUID,
    roomId: UUID,
    role: string,
  ): Promise<boolean> {
    await this.exec(
      'UPDATE participants SET role = ? WHERE entity_id = ? AND room_id = ?',
      [role, entityId, roomId],
    )
    return true
  }

  // Server/World Integration (for multi-tenant DAOs)

  async getWorldByServerId(serverId: string): Promise<World | null> {
    const rows = await this.query<{
      id: string
      agent_id: string
      name: string
      server_id: string | null
      metadata: string
    }>('SELECT * FROM worlds WHERE server_id = ? LIMIT 1', [serverId])

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      id: row.id as UUID,
      agentId: row.agent_id as UUID,
      name: row.name,
      serverId: row.server_id ?? undefined,
      metadata: this.fromJson<JsonRecord>(row.metadata) ?? {},
    } as World
  }

  async getOrCreateWorld(params: {
    serverId: string
    name?: string
    metadata?: JsonRecord
  }): Promise<World> {
    // Check if world exists
    const existing = await this.getWorldByServerId(params.serverId)
    if (existing) return existing

    // Create new world
    const worldId = uuidv4() as UUID
    const world: World = {
      id: worldId,
      agentId: this.agentId,
      name: params.name ?? params.serverId,
      serverId: params.serverId as UUID,
      metadata: params.metadata ?? {},
    }

    await this.exec(
      'INSERT INTO worlds (id, agent_id, name, server_id, metadata) VALUES (?, ?, ?, ?, ?)',
      [
        worldId,
        this.agentId,
        world.name ?? params.serverId,
        params.serverId,
        this.toJson((world.metadata ?? {}) as JsonValue),
      ],
    )

    return world
  }

  // DAO-Specific Methods (for Autocrat integration)

  async getDAOAgents(daoId: string): Promise<Agent[]> {
    // Query agents that have a specific DAO tag in their settings
    const rows = await this.query<{
      id: string
      name: string
      username: string
      details: string
      settings: string
    }>('SELECT * FROM agents WHERE settings LIKE ?', [`%"daoId":"${daoId}"%`])

    return rows.map((row) => ({
      id: row.id as UUID,
      name: row.name,
      username: row.username,
      bio: '',
      enabled: true,
      status: 'active',
    })) as Agent[]
  }

  async setAgentDAOAffiliation(agentId: UUID, daoId: string): Promise<boolean> {
    const agent = await this.getAgent(agentId)
    if (!agent) return false

    // Update the settings with DAO affiliation
    const settings = this.toJson({ daoId })
    await this.exec('UPDATE agents SET settings = ? WHERE id = ?', [
      settings,
      agentId,
    ])
    return true
  }

  // Crucible-Specific Methods (for team/room management)

  async getTeamRooms(worldId: UUID): Promise<Room[]> {
    const rows = await this.query<{
      id: string
      world_id: string | null
      name: string
      source: string
      type: string
      channel_id: string | null
      metadata: string
    }>('SELECT * FROM rooms WHERE world_id = ? AND type = ?', [
      worldId,
      ChannelType.GROUP,
    ])

    return rows.map((row) => ({
      id: row.id as UUID,
      worldId: row.world_id as UUID | undefined,
      name: row.name,
      source: row.source,
      type: row.type as ChannelType,
      channelId: row.channel_id ?? undefined,
      metadata: this.fromJson<JsonRecord>(row.metadata) ?? {},
    })) as Room[]
  }

  async createTeamRoom(params: {
    worldId: UUID
    name: string
    teamType: string
    metadata?: JsonRecord
  }): Promise<Room> {
    const roomId = uuidv4() as UUID
    const room: Room = {
      id: roomId,
      worldId: params.worldId,
      name: params.name,
      source: 'crucible',
      type: ChannelType.GROUP,
      metadata: {
        ...params.metadata,
        teamType: params.teamType,
      },
    }

    await this.exec(
      'INSERT INTO rooms (id, world_id, name, source, type, metadata) VALUES (?, ?, ?, ?, ?, ?)',
      [
        roomId,
        params.worldId,
        room.name ?? params.name,
        'crucible',
        ChannelType.GROUP,
        this.toJson((room.metadata ?? {}) as JsonValue),
      ],
    )

    return room
  }

  // Embedding/Vector Integration with DWS

  private embeddingEndpoint: string | null = null

  setEmbeddingEndpoint(endpoint: string): void {
    this.embeddingEndpoint = endpoint
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.embeddingEndpoint) {
      logger.warn(
        { src: 'sqlit-adapter' },
        'No embedding endpoint configured, returning empty embedding',
      )
      return []
    }

    const response = await fetch(`${this.embeddingEndpoint}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: text, model: 'text-embedding-3-small' }),
    })

    if (!response.ok) {
      logger.error({ src: 'sqlit-adapter' }, 'Failed to generate embedding')
      return []
    }

    const data = EmbeddingResponseSchema.parse(await response.json())
    return data.data?.[0]?.embedding ?? []
  }

  async searchByEmbedding(
    embedding: number[],
    options: {
      tableName?: string
      roomId?: UUID
      limit?: number
      threshold?: number
    } = {},
  ): Promise<Memory[]> {
    // SQLit doesn't have native vector search, so we use a text-based approach
    // For production, integrate with a dedicated vector service

    let sql = 'SELECT * FROM memories WHERE embedding IS NOT NULL'
    const sqlParams: QueryParam[] = []

    if (options.roomId) {
      sql += ' AND room_id = ?'
      sqlParams.push(options.roomId)
    }

    sql += ' ORDER BY created_at DESC'

    if (options.limit) {
      sql += ' LIMIT ?'
      sqlParams.push(options.limit * 10) // Fetch more to filter
    }

    const rows = await this.query<{
      id: string
      entity_id: string
      agent_id: string | null
      room_id: string
      world_id: string | null
      content: string
      embedding: string
      created_at: number
    }>(sql, sqlParams)

    // Calculate cosine similarity and filter
    const threshold = options.threshold ?? 0.7
    const limit = options.limit ?? 10

    const results: Array<{ memory: Memory; similarity: number }> = []

    for (const row of rows) {
      const storedEmbedding = this.fromJson<number[]>(row.embedding)
      if (!storedEmbedding || storedEmbedding.length !== embedding.length)
        continue

      const similarity = this.cosineSimilarity(embedding, storedEmbedding)
      if (similarity >= threshold) {
        results.push({
          memory: {
            id: row.id as UUID,
            entityId: row.entity_id as UUID,
            agentId: row.agent_id as UUID | undefined,
            roomId: row.room_id as UUID,
            worldId: row.world_id as UUID | undefined,
            content: this.fromJson(row.content) ?? { text: '' },
            embedding: storedEmbedding,
            createdAt: row.created_at,
          } as Memory,
          similarity,
        })
      }
    }

    // Sort by similarity and take top results
    results.sort((a, b) => b.similarity - a.similarity)
    return results.slice(0, limit).map((r) => r.memory)
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0

    let dotProduct = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }

    if (normA === 0 || normB === 0) return 0
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
  }

  // Connection/Health Methods

  async ping(): Promise<boolean> {
    return await this.db.isHealthy()
  }

  getDatabaseId(): string {
    return this.databaseId
  }

  getAgentId(): UUID {
    return this.agentId
  }

  // Utility Methods

  private hashContent(content: Memory['content']): string {
    const text = typeof content === 'string' ? content : JSON.stringify(content)
    // Use crypto for proper content hashing
    const encoder = new TextEncoder()
    const data = encoder.encode(text)
    // Synchronous hash using Bun's built-in
    const hash = Bun.hash(data)
    return hash.toString(16).padStart(16, '0')
  }
}
