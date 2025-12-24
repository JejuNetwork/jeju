/**
 * Agent Registry
 * CQL-backed storage for agent configurations
 */

import type { JsonRecord } from '@jejunetwork/sdk'
import { isValidAddress } from '@jejunetwork/types'
import type { Address } from 'viem'
import { isAgentStatus, isCronAction } from '../shared/utils/type-guards'
import type { CqlRowsResponse } from '../types'
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
  cqlUrl: string
  databaseId: string
}

// In-Memory Cache + CQL Persistence

const agents = new Map<string, AgentConfig>()
const cronTriggers = new Map<string, AgentCronTrigger[]>()
const invocationCounts = new Map<string, number>()
const errorCounts = new Map<string, number>()
const latencyMetrics = new Map<string, number[]>()

let registryConfig: RegistryConfig | null = null
let initialized = false

// Initialization

export async function initRegistry(config: RegistryConfig): Promise<void> {
  if (initialized) return

  registryConfig = config

  // Try to create tables and load from CQL
  // If CQL is not available, continue with in-memory only mode
  try {
    await createTables()
    await loadAgentsFromCQL()
    console.log(
      `[AgentRegistry] Initialized with ${agents.size} agents (CQL mode)`,
    )
  } catch (e) {
    console.warn(
      `[AgentRegistry] CQL not available, using in-memory mode: ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  initialized = true
}

async function createTables(): Promise<void> {
  if (!registryConfig) return

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
    `CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner)`,
    `CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status)`,
    `CREATE INDEX IF NOT EXISTS idx_memories_agent ON agent_memories(agent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_memories_room ON agent_memories(agent_id, room_id)`,
    `CREATE INDEX IF NOT EXISTS idx_cron_agent ON agent_cron_triggers(agent_id)`,
  ]

  for (const sql of tables) {
    await cqlExec(sql)
  }
}

async function loadAgentsFromCQL(): Promise<void> {
  if (!registryConfig) return

  const result = await cqlQuery<{
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
  }>('SELECT * FROM agents WHERE status != ?', ['terminated'])

  for (const row of result) {
    // Validate owner address
    if (!isValidAddress(row.owner)) {
      console.warn(`[AgentRegistry] Invalid owner address for agent ${row.id}`)
      continue
    }
    // Validate status
    if (!isAgentStatus(row.status)) {
      console.warn(`[AgentRegistry] Invalid status for agent ${row.id}`)
      continue
    }

    const agent: AgentConfig = {
      id: row.id,
      owner: row.owner,
      character: JSON.parse(row.character),
      models: row.models ? JSON.parse(row.models) : undefined,
      runtime: JSON.parse(row.runtime),
      secretsKeyId: row.secrets_key_id ?? undefined,
      memoriesDbId: row.memories_db_id ?? undefined,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }
    agents.set(agent.id, agent)
  }

  // Load cron triggers
  const triggers = await cqlQuery<{
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

  for (const row of triggers) {
    // Validate action
    const action = isCronAction(row.action) ? row.action : 'think'

    const trigger: AgentCronTrigger = {
      id: row.id,
      agentId: row.agent_id,
      schedule: row.schedule,
      action,
      payload: row.payload ? JSON.parse(row.payload) : undefined,
      enabled: row.enabled === 1,
      lastRunAt: row.last_run_at ?? undefined,
      nextRunAt: row.next_run_at ?? undefined,
      runCount: row.run_count,
    }

    const existing = cronTriggers.get(row.agent_id) ?? []
    existing.push(trigger)
    cronTriggers.set(row.agent_id, existing)
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

  // Store in CQL
  await cqlExec(
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

  // Add to cache
  agents.set(id, agent)

  // Create cron trigger if specified
  if (runtime.cronSchedule) {
    await addCronTrigger(id, runtime.cronSchedule, 'think')
  }

  console.log(
    `[AgentRegistry] Registered agent: ${agent.character.name} (${id})`,
  )
  return agent
}

export function getAgent(id: string): AgentConfig | null {
  return agents.get(id) ?? null
}

export function getAgentsByOwner(owner: Address): AgentConfig[] {
  return Array.from(agents.values()).filter(
    (a) => a.owner.toLowerCase() === owner.toLowerCase(),
  )
}

export function listAgents(filter?: {
  status?: AgentStatus
  owner?: Address
}): AgentConfig[] {
  let result = Array.from(agents.values())

  if (filter?.status) {
    result = result.filter((a) => a.status === filter.status)
  }
  if (filter?.owner) {
    const ownerLower = filter.owner.toLowerCase()
    result = result.filter((a) => a.owner.toLowerCase() === ownerLower)
  }

  return result
}

export async function updateAgent(
  id: string,
  owner: Address,
  update: UpdateAgentRequest,
): Promise<AgentConfig | null> {
  const agent = agents.get(id)
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

  // Update in CQL
  await cqlExec(
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
  const agent = agents.get(id)
  if (!agent) return

  agent.status = status
  agent.updatedAt = Date.now()

  await cqlExec('UPDATE agents SET status = ?, updated_at = ? WHERE id = ?', [
    status,
    agent.updatedAt,
    id,
  ])
}

export async function terminateAgent(
  id: string,
  owner: Address,
): Promise<boolean> {
  const agent = agents.get(id)
  if (!agent) return false
  if (agent.owner.toLowerCase() !== owner.toLowerCase()) {
    throw new Error('Not authorized to terminate this agent')
  }

  agent.status = 'terminated'
  agent.updatedAt = Date.now()

  await cqlExec('UPDATE agents SET status = ?, updated_at = ? WHERE id = ?', [
    'terminated',
    agent.updatedAt,
    id,
  ])

  // Disable cron triggers
  await cqlExec(
    'UPDATE agent_cron_triggers SET enabled = 0 WHERE agent_id = ?',
    [id],
  )

  agents.delete(id)
  cronTriggers.delete(id)

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

  await cqlExec(
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

  const existing = cronTriggers.get(agentId) ?? []
  existing.push(trigger)
  cronTriggers.set(agentId, existing)

  return trigger
}

export function getCronTriggers(agentId: string): AgentCronTrigger[] {
  return cronTriggers.get(agentId) ?? []
}

export function getAllActiveCronTriggers(): AgentCronTrigger[] {
  const all: AgentCronTrigger[] = []
  for (const triggers of cronTriggers.values()) {
    all.push(...triggers.filter((t) => t.enabled))
  }
  return all
}

export async function updateCronTriggerRun(triggerId: string): Promise<void> {
  for (const [_agentId, triggers] of cronTriggers) {
    const trigger = triggers.find((t) => t.id === triggerId)
    if (trigger) {
      trigger.lastRunAt = Date.now()
      trigger.runCount++

      await cqlExec(
        'UPDATE agent_cron_triggers SET last_run_at = ?, run_count = ? WHERE id = ?',
        [trigger.lastRunAt, trigger.runCount, triggerId],
      )
      break
    }
  }
}

// Metrics

export function recordInvocation(
  agentId: string,
  latencyMs: number,
  isError = false,
): void {
  // Update count
  const count = invocationCounts.get(agentId) ?? 0
  invocationCounts.set(agentId, count + 1)

  // Update error count
  if (isError) {
    const errors = errorCounts.get(agentId) ?? 0
    errorCounts.set(agentId, errors + 1)
  }

  // Update latency
  const latencies = latencyMetrics.get(agentId) ?? []
  latencies.push(latencyMs)
  if (latencies.length > 1000) {
    latencies.shift()
  }
  latencyMetrics.set(agentId, latencies)
}

export function getAgentStats(agentId: string): AgentStats | null {
  const agent = agents.get(agentId)
  if (!agent) return null

  const invocations = invocationCounts.get(agentId) ?? 0
  const errors = errorCounts.get(agentId) ?? 0
  const latencies = latencyMetrics.get(agentId) ?? []
  const avgLatency =
    latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0
  const errorRate = invocations > 0 ? errors / invocations : 0

  return {
    agentId,
    totalInvocations: invocations,
    avgLatencyMs: Math.round(avgLatency),
    errorRate,
    activeInstances: 0, // Populated by executor.getAgentInstances()
    memoriesCount: 0, // Populated via CQL query in routes.ts
  }
}

// CQL Helpers

async function cqlQuery<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
  if (!registryConfig) return []

  try {
    const response = await fetch(`${registryConfig.cqlUrl}/api/v1/query`, {
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
      return []
    }

    const data = (await response.json()) as CqlRowsResponse<T>
    return data.rows ?? []
  } catch (e) {
    console.warn('[AgentRegistry] CQL query failed:', e)
    throw e
  }
}

async function cqlExec(sql: string, params: SqlParam[] = []): Promise<void> {
  if (!registryConfig) return

  try {
    const response = await fetch(`${registryConfig.cqlUrl}/api/v1/query`, {
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
      console.warn(
        `[AgentRegistry] CQL exec failed: ${response.status} - ${text}`,
      )
    }
  } catch (e) {
    console.warn('[AgentRegistry] CQL exec failed:', e)
    throw e
  }
}

// Registry State

export function isInitialized(): boolean {
  return initialized
}

export function getRegistryStats() {
  return {
    totalAgents: agents.size,
    activeAgents: Array.from(agents.values()).filter(
      (a) => a.status === 'active',
    ).length,
    pendingAgents: Array.from(agents.values()).filter(
      (a) => a.status === 'pending',
    ).length,
    totalCronTriggers: getAllActiveCronTriggers().length,
  }
}
