import type { JsonRecord } from '@jejunetwork/types'
import {
  isValidAddress,
  JsonValueSchema,
  validateOrNull,
} from '@jejunetwork/types'
import type { Address } from 'viem'
import { z } from 'zod'
import { isAgentStatus, isCronAction } from '../shared/utils/type-guards'

// Generic EQLite rows response schema
const EqliteRowsResponseSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).optional(),
})

// Agent data schemas for database reads
const AgentCharacterSchema = z.object({
  name: z.string(),
  system: z.string(),
  bio: z.array(z.string()),
  messageExamples: z
    .array(
      z.array(
        z.object({ name: z.string(), content: z.object({ text: z.string() }) }),
      ),
    )
    .optional(),
  topics: z.array(z.string()).optional(),
  adjectives: z.array(z.string()).optional(),
  style: z
    .object({
      all: z.array(z.string()).optional(),
      chat: z.array(z.string()).optional(),
      post: z.array(z.string()).optional(),
    })
    .optional(),
  knowledge: z.array(z.string()).optional(),
  lore: z.array(z.string()).optional(),
})

const AgentRuntimeConfigSchema = z.object({
  keepWarm: z.boolean(),
  cronSchedule: z.string().optional(),
  maxMemoryMb: z.number(),
  timeoutMs: z.number(),
  plugins: z.array(z.string()),
  mcpServers: z.array(z.string()).optional(),
  a2aCapabilities: z.array(z.string()).optional(),
})

const AgentModelsConfigSchema = z.object({
  small: z.string().optional(),
  large: z.string().optional(),
  embedding: z.string().optional(),
})

import type {
  AgentConfig,
  AgentCronTrigger,
  AgentRuntimeConfig,
  AgentStats,
  AgentStatus,
  RegisterAgentRequest,
  UpdateAgentRequest,
} from './types'

// SQL query parameter type (matches @jejunetwork/db QueryParam)
type SqlParam = string | number | boolean | null

// Registry Configuration

export interface RegistryConfig {
  eqliteUrl: string
  databaseId: string
}

// EQLite-backed storage - no in-memory caching for serverless compatibility

let registryConfig: RegistryConfig | null = null
let initialized = false

// Initialization

export async function initRegistry(config: RegistryConfig): Promise<void> {
  if (initialized) return

  registryConfig = config

  // EQLite is required - no fallback to in-memory
  await createTables()
  console.log('[AgentRegistry] Initialized with EQLite')

  initialized = true
}

async function createTables(): Promise<void> {
  if (!registryConfig) {
    throw new Error('[AgentRegistry] EQLite config is required')
  }

  const tables = [
    `CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      character TEXT NOT NULL,
      models TEXT,
      runtime TEXT NOT NULL,
      secrets_key_id TEXT,
      memories_db_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      metadata TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS agent_memories (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT,
      type TEXT NOT NULL DEFAULT 'message',
      importance REAL NOT NULL DEFAULT 0.5,
      created_at INTEGER NOT NULL,
      metadata TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS agent_cron_triggers (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      schedule TEXT NOT NULL,
      action TEXT NOT NULL DEFAULT 'think',
      payload TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at INTEGER,
      next_run_at INTEGER,
      run_count INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS agent_metrics (
      agent_id TEXT PRIMARY KEY,
      invocation_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      total_latency_ms INTEGER NOT NULL DEFAULT 0,
      latency_samples INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner)`,
    `CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status)`,
    `CREATE INDEX IF NOT EXISTS idx_memories_agent ON agent_memories(agent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_memories_room ON agent_memories(agent_id, room_id)`,
    `CREATE INDEX IF NOT EXISTS idx_cron_agent ON agent_cron_triggers(agent_id)`,
  ]

  for (const sql of tables) {
    await eqliteExec(sql)
  }
}

// Helper to convert EQLite row to AgentConfig
function rowToAgentConfig(row: {
  id: string
  owner: string
  character: string
  models: string | null
  runtime: string
  secrets_key_id: string | null
  memories_db_id: string | null
  status: string
  created_at: number
  updated_at: number
  metadata: string | null
}): AgentConfig | null {
  // Validate owner address
  if (!isValidAddress(row.owner)) {
    console.warn(`[AgentRegistry] Invalid owner address for agent ${row.id}`)
    return null
  }
  // Validate status
  if (!isAgentStatus(row.status)) {
    console.warn(`[AgentRegistry] Invalid status for agent ${row.id}`)
    return null
  }

  return {
    id: row.id,
    owner: row.owner,
    character: AgentCharacterSchema.parse(JSON.parse(row.character)),
    models: row.models
      ? AgentModelsConfigSchema.parse(JSON.parse(row.models))
      : undefined,
    runtime: AgentRuntimeConfigSchema.parse(JSON.parse(row.runtime)),
    secretsKeyId: row.secrets_key_id ?? undefined,
    memoriesDbId: row.memories_db_id ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: row.metadata
      ? z.record(z.string(), z.string()).parse(JSON.parse(row.metadata))
      : undefined,
  }
}

// Helper to convert EQLite row to AgentCronTrigger
function rowToCronTrigger(row: {
  id: string
  agent_id: string
  schedule: string
  action: string
  payload: string | null
  enabled: number
  last_run_at: number | null
  next_run_at: number | null
  run_count: number
}): AgentCronTrigger {
  const action = isCronAction(row.action) ? row.action : 'think'
  return {
    id: row.id,
    agentId: row.agent_id,
    schedule: row.schedule,
    action,
    payload: row.payload
      ? z.record(z.string(), JsonValueSchema).parse(JSON.parse(row.payload))
      : undefined,
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at ?? undefined,
    nextRunAt: row.next_run_at ?? undefined,
    runCount: row.run_count,
  }
}

// CRUD Operations

export async function registerAgent(
  owner: Address,
  request: RegisterAgentRequest,
): Promise<AgentConfig> {
  const id = crypto.randomUUID()
  const now = Date.now()

  const runtime: AgentRuntimeConfig = {
    keepWarm: request.runtime?.keepWarm ?? false,
    cronSchedule: request.runtime?.cronSchedule,
    maxMemoryMb: request.runtime?.maxMemoryMb ?? 256,
    timeoutMs: request.runtime?.timeoutMs ?? 30000,
    plugins: request.runtime?.plugins ?? [],
    mcpServers: request.runtime?.mcpServers,
    a2aCapabilities: request.runtime?.a2aCapabilities,
  }

  const agent: AgentConfig = {
    id,
    owner,
    character: request.character,
    models: request.models,
    runtime,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    metadata: request.metadata,
  }

  // Store in EQLite
  await eqliteExec(
    `INSERT INTO agents (id, owner, character, models, runtime, status, created_at, updated_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      agent.id,
      agent.owner,
      JSON.stringify(agent.character),
      agent.models ? JSON.stringify(agent.models) : null,
      JSON.stringify(agent.runtime),
      agent.status,
      agent.createdAt,
      agent.updatedAt,
      agent.metadata ? JSON.stringify(agent.metadata) : null,
    ],
  )

  // Create cron trigger if specified
  if (runtime.cronSchedule) {
    await addCronTrigger(id, runtime.cronSchedule, 'think')
  }

  console.log(
    `[AgentRegistry] Registered agent: ${agent.character.name} (${id})`,
  )
  return agent
}

export async function getAgent(id: string): Promise<AgentConfig | null> {
  const rows = await eqliteQuery<{
    id: string
    owner: string
    character: string
    models: string | null
    runtime: string
    secrets_key_id: string | null
    memories_db_id: string | null
    status: string
    created_at: number
    updated_at: number
    metadata: string | null
  }>('SELECT * FROM agents WHERE id = ?', [id])

  const row = rows[0]
  if (!row) return null
  return rowToAgentConfig(row)
}

export async function getAgentsByOwner(owner: Address): Promise<AgentConfig[]> {
  const rows = await eqliteQuery<{
    id: string
    owner: string
    character: string
    models: string | null
    runtime: string
    secrets_key_id: string | null
    memories_db_id: string | null
    status: string
    created_at: number
    updated_at: number
    metadata: string | null
  }>('SELECT * FROM agents WHERE owner = ? AND status != ?', [
    owner.toLowerCase(),
    'terminated',
  ])

  return rows.map(rowToAgentConfig).filter((a): a is AgentConfig => a !== null)
}

export async function listAgents(filter?: {
  status?: AgentStatus
  owner?: Address
}): Promise<AgentConfig[]> {
  let sql = 'SELECT * FROM agents WHERE status != ?'
  const params: SqlParam[] = ['terminated']

  if (filter?.status) {
    sql += ' AND status = ?'
    params.push(filter.status)
  }
  if (filter?.owner) {
    sql += ' AND owner = ?'
    params.push(filter.owner.toLowerCase())
  }

  const rows = await eqliteQuery<{
    id: string
    owner: string
    character: string
    models: string | null
    runtime: string
    secrets_key_id: string | null
    memories_db_id: string | null
    status: string
    created_at: number
    updated_at: number
    metadata: string | null
  }>(sql, params)

  return rows.map(rowToAgentConfig).filter((a): a is AgentConfig => a !== null)
}

export async function updateAgent(
  id: string,
  owner: Address,
  update: UpdateAgentRequest,
): Promise<AgentConfig | null> {
  const agent = await getAgent(id)
  if (!agent) return null
  if (agent.owner.toLowerCase() !== owner.toLowerCase()) {
    throw new Error('Not authorized to update this agent')
  }

  // Apply updates
  if (update.character) {
    agent.character = { ...agent.character, ...update.character }
  }
  if (update.models) {
    agent.models = update.models
  }
  if (update.runtime) {
    agent.runtime = { ...agent.runtime, ...update.runtime }
  }
  if (update.metadata) {
    agent.metadata = { ...agent.metadata, ...update.metadata }
  }

  agent.updatedAt = Date.now()

  // Update in EQLite
  await eqliteExec(
    `UPDATE agents SET character = ?, models = ?, runtime = ?, updated_at = ?, metadata = ? WHERE id = ?`,
    [
      JSON.stringify(agent.character),
      agent.models ? JSON.stringify(agent.models) : null,
      JSON.stringify(agent.runtime),
      agent.updatedAt,
      agent.metadata ? JSON.stringify(agent.metadata) : null,
      id,
    ],
  )

  return agent
}

export async function updateAgentStatus(
  id: string,
  status: AgentStatus,
): Promise<void> {
  const now = Date.now()
  await eqliteExec(
    'UPDATE agents SET status = ?, updated_at = ? WHERE id = ?',
    [status, now, id],
  )
}

export async function terminateAgent(
  id: string,
  owner: Address,
): Promise<boolean> {
  const agent = await getAgent(id)
  if (!agent) return false
  if (agent.owner.toLowerCase() !== owner.toLowerCase()) {
    throw new Error('Not authorized to terminate this agent')
  }

  const now = Date.now()

  await eqliteExec(
    'UPDATE agents SET status = ?, updated_at = ? WHERE id = ?',
    ['terminated', now, id],
  )

  // Disable cron triggers
  await eqliteExec(
    'UPDATE agent_cron_triggers SET enabled = 0 WHERE agent_id = ?',
    [id],
  )

  console.log(`[AgentRegistry] Terminated agent: ${id}`)
  return true
}

// Cron Triggers

export async function addCronTrigger(
  agentId: string,
  schedule: string,
  action: AgentCronTrigger['action'],
  payload?: JsonRecord,
): Promise<AgentCronTrigger> {
  const trigger: AgentCronTrigger = {
    id: crypto.randomUUID(),
    agentId,
    schedule,
    action,
    payload,
    enabled: true,
    runCount: 0,
  }

  await eqliteExec(
    `INSERT INTO agent_cron_triggers (id, agent_id, schedule, action, payload, enabled, run_count)
     VALUES (?, ?, ?, ?, ?, 1, 0)`,
    [
      trigger.id,
      trigger.agentId,
      trigger.schedule,
      trigger.action,
      payload ? JSON.stringify(payload) : null,
    ],
  )

  return trigger
}

export async function getCronTriggers(
  agentId: string,
): Promise<AgentCronTrigger[]> {
  const rows = await eqliteQuery<{
    id: string
    agent_id: string
    schedule: string
    action: string
    payload: string | null
    enabled: number
    last_run_at: number | null
    next_run_at: number | null
    run_count: number
  }>('SELECT * FROM agent_cron_triggers WHERE agent_id = ?', [agentId])

  return rows.map(rowToCronTrigger)
}

export async function getAllActiveCronTriggers(): Promise<AgentCronTrigger[]> {
  const rows = await eqliteQuery<{
    id: string
    agent_id: string
    schedule: string
    action: string
    payload: string | null
    enabled: number
    last_run_at: number | null
    next_run_at: number | null
    run_count: number
  }>('SELECT * FROM agent_cron_triggers WHERE enabled = 1', [])

  return rows.map(rowToCronTrigger)
}

export async function updateCronTriggerRun(triggerId: string): Promise<void> {
  const now = Date.now()
  await eqliteExec(
    'UPDATE agent_cron_triggers SET last_run_at = ?, run_count = run_count + 1 WHERE id = ?',
    [now, triggerId],
  )
}

// Metrics

export async function recordInvocation(
  agentId: string,
  latencyMs: number,
  isError = false,
): Promise<void> {
  const now = Date.now()

  // Use UPSERT pattern to update metrics
  await eqliteExec(
    `INSERT INTO agent_metrics (agent_id, invocation_count, error_count, total_latency_ms, latency_samples, updated_at)
     VALUES (?, 1, ?, ?, 1, ?)
     ON CONFLICT(agent_id) DO UPDATE SET
       invocation_count = invocation_count + 1,
       error_count = error_count + ?,
       total_latency_ms = total_latency_ms + ?,
       latency_samples = latency_samples + 1,
       updated_at = ?`,
    [agentId, isError ? 1 : 0, latencyMs, now, isError ? 1 : 0, latencyMs, now],
  )
}

export async function getAgentStats(
  agentId: string,
): Promise<AgentStats | null> {
  const agent = await getAgent(agentId)
  if (!agent) return null

  const rows = await eqliteQuery<{
    agent_id: string
    invocation_count: number
    error_count: number
    total_latency_ms: number
    latency_samples: number
  }>('SELECT * FROM agent_metrics WHERE agent_id = ?', [agentId])

  const metrics = rows[0]
  const invocations = metrics.invocation_count ?? 0
  const errors = metrics.error_count ?? 0
  const avgLatency =
    metrics && metrics.latency_samples > 0
      ? metrics.total_latency_ms / metrics.latency_samples
      : 0
  const errorRate = invocations > 0 ? errors / invocations : 0

  return {
    agentId,
    totalInvocations: invocations,
    avgLatencyMs: Math.round(avgLatency),
    errorRate,
    activeInstances: 0, // Populated by executor.getAgentInstances()
    memoriesCount: 0, // Populated via EQLite query in routes.ts
  }
}

// EQLite Helpers

async function eqliteQuery<T>(
  sql: string,
  params: SqlParam[] = [],
): Promise<T[]> {
  if (!registryConfig) {
    throw new Error(
      '[AgentRegistry] Registry not initialized - call initRegistry first',
    )
  }

  const response = await fetch(`${registryConfig.eqliteUrl}/api/v1/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      database: registryConfig.databaseId,
      type: 'query',
      sql,
      params,
      timestamp: Date.now(),
    }),
    signal: AbortSignal.timeout(5000),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `[AgentRegistry] EQLite query failed: ${response.status} - ${text}`,
    )
  }

  const data = validateOrNull(EqliteRowsResponseSchema, await response.json())
  return (data?.rows as T[]) ?? []
}

async function eqliteExec(sql: string, params: SqlParam[] = []): Promise<void> {
  if (!registryConfig) {
    throw new Error(
      '[AgentRegistry] Registry not initialized - call initRegistry first',
    )
  }

  const response = await fetch(`${registryConfig.eqliteUrl}/api/v1/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      database: registryConfig.databaseId,
      type: 'exec',
      sql,
      params,
      timestamp: Date.now(),
    }),
    signal: AbortSignal.timeout(5000),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `[AgentRegistry] EQLite exec failed: ${response.status} - ${text}`,
    )
  }
}

// Registry State

export function isInitialized(): boolean {
  return initialized
}

export async function getRegistryStats(): Promise<{
  totalAgents: number
  activeAgents: number
  pendingAgents: number
  totalCronTriggers: number
}> {
  const [totalResult, activeResult, pendingResult, triggersResult] =
    await Promise.all([
      eqliteQuery<{ count: number }>(
        'SELECT COUNT(*) as count FROM agents WHERE status != ?',
        ['terminated'],
      ),
      eqliteQuery<{ count: number }>(
        'SELECT COUNT(*) as count FROM agents WHERE status = ?',
        ['active'],
      ),
      eqliteQuery<{ count: number }>(
        'SELECT COUNT(*) as count FROM agents WHERE status = ?',
        ['pending'],
      ),
      eqliteQuery<{ count: number }>(
        'SELECT COUNT(*) as count FROM agent_cron_triggers WHERE enabled = 1',
        [],
      ),
    ])

  return {
    totalAgents: totalResult[0].count ?? 0,
    activeAgents: activeResult[0].count ?? 0,
    pendingAgents: pendingResult[0].count ?? 0,
    totalCronTriggers: triggersResult[0].count ?? 0,
  }
}
