/**
 * Factory Database Client
 * CovenantSQL integration for decentralized persistence
 */

import {
  type ConsistencyLevel,
  type CovenantSQLClient,
  createCovenantSQLClient,
  type QueryResult,
} from '@jejunetwork/shared'
import type { Address } from 'viem'
import { ALL_SCHEMAS } from './schema'

// ============================================================================
// Configuration
// ============================================================================

export interface FactoryDBConfig {
  /** CovenantSQL node endpoints */
  nodes: string[]
  /** Database ID */
  databaseId: string
  /** Private key for authentication */
  privateKey: string
  /** Default consistency level */
  consistency: ConsistencyLevel
  /** Enable query logging */
  logging: boolean
}

// ============================================================================
// Factory Database Client
// ============================================================================

let dbClient: CovenantSQLClient | null = null
let initialized = false

/**
 * Get or create the Factory database client
 */
export function getFactoryDB(): CovenantSQLClient {
  if (dbClient) {
    return dbClient
  }

  const nodes = process.env.COVENANTSQL_NODES?.split(',') ?? [
    'http://localhost:4661',
  ]
  const databaseId = process.env.FACTORY_DATABASE_ID ?? 'factory'
  const privateKey = process.env.FACTORY_DB_PRIVATE_KEY

  if (!privateKey) {
    throw new Error(
      'FACTORY_DB_PRIVATE_KEY environment variable required for database access',
    )
  }

  dbClient = createCovenantSQLClient({
    nodes,
    databaseId,
    privateKey,
    defaultConsistency:
      (process.env.COVENANTSQL_CONSISTENCY as ConsistencyLevel) ?? 'strong',
    poolSize: parseInt(process.env.COVENANTSQL_POOL_SIZE ?? '10', 10),
    queryTimeout: parseInt(process.env.COVENANTSQL_TIMEOUT ?? '30000', 10),
    retryAttempts: parseInt(process.env.COVENANTSQL_RETRIES ?? '3', 10),
    logging: process.env.COVENANTSQL_LOGGING === 'true',
  })

  return dbClient
}

/**
 * Initialize database schema (creates tables if not exist)
 */
export async function initializeFactoryDB(): Promise<void> {
  if (initialized) return

  const db = getFactoryDB()
  await db.initialize()

  console.log('[Factory DB] Creating tables...')
  for (const schema of ALL_SCHEMAS) {
    await db.createTable(schema)
    console.log(`[Factory DB] Created table: ${schema.name}`)
  }

  initialized = true
  console.log('[Factory DB] Initialization complete')
}

/**
 * Check if database is available
 */
export async function checkFactoryDB(): Promise<{
  available: boolean
  nodes: Array<{ node: string; healthy: boolean; latency: number }>
}> {
  const db = getFactoryDB()
  const health = db.getHealth()
  return {
    available: health.healthy,
    nodes: health.nodes,
  }
}

/**
 * Close database connections
 */
export async function closeFactoryDB(): Promise<void> {
  if (dbClient) {
    await dbClient.close()
    dbClient = null
    initialized = false
  }
}

// ============================================================================
// Type Definitions
// ============================================================================

export interface Bounty {
  id: string
  title: string
  description: string
  creator: Address
  reward: string
  currency: string
  skills: string[]
  status: 'open' | 'in_progress' | 'review' | 'completed' | 'cancelled'
  deadline: number
  milestones?: Array<{
    name: string
    description: string
    reward: string
    currency: string
    deadline: number
  }>
  submissions_count: number
  created_at: number
  updated_at: number
}

export interface Job {
  id: string
  title: string
  description: string
  company: string
  poster: Address
  job_type: 'full_time' | 'part_time' | 'contract' | 'internship'
  location: string | null
  remote: boolean
  salary_min: string | null
  salary_max: string | null
  salary_currency: string | null
  skills: string[]
  status: 'open' | 'closed' | 'filled'
  created_at: number
  updated_at: number
  expires_at: number | null
}

export interface Project {
  id: string
  name: string
  description: string | null
  owner: Address
  visibility: 'public' | 'private'
  repo_id: string | null
  status: 'active' | 'archived'
  created_at: number
  updated_at: number
}

export interface Repository {
  id: string
  name: string
  owner: Address
  description: string | null
  is_private: boolean
  default_branch: string
  stars: number
  forks: number
  dws_repo_id: string | null
  created_at: number
  updated_at: number
}

export interface Package {
  id: string
  name: string
  owner: Address
  description: string | null
  latest_version: string | null
  license: string | null
  downloads: number
  dws_pkg_name: string | null
  created_at: number
  updated_at: number
}

export interface Container {
  id: string
  name: string
  owner: Address
  latest_tag: string | null
  latest_digest: string | null
  downloads: number
  created_at: number
  updated_at: number
}

export interface Model {
  id: string
  name: string
  owner: Address
  description: string | null
  model_type: string
  framework: string | null
  license: string | null
  cid: string | null
  size_bytes: number | null
  downloads: number
  created_at: number
  updated_at: number
}

export interface Dataset {
  id: string
  name: string
  owner: Address
  description: string | null
  format: string | null
  license: string | null
  cid: string | null
  size_bytes: number | null
  row_count: number | null
  downloads: number
  created_at: number
  updated_at: number
}

export interface CIRun {
  id: string
  repo_id: string
  workflow_name: string
  trigger: 'push' | 'pull_request' | 'manual' | 'schedule'
  branch: string | null
  commit_sha: string | null
  status: 'pending' | 'running' | 'success' | 'failure' | 'cancelled'
  started_at: number
  completed_at: number | null
  duration_ms: number | null
  logs_cid: string | null
}

export interface Agent {
  id: string
  name: string
  owner: Address
  agent_type: 'ai_agent' | 'trading_bot' | 'org_tool'
  description: string | null
  character_cid: string | null
  state_cid: string | null
  active: boolean
  execution_count: number
  dws_agent_id: string | null
  created_at: number
  updated_at: number
}

export interface Issue {
  id: string
  repo_id: string
  number: number
  title: string
  body: string | null
  author: Address
  status: 'open' | 'closed'
  labels: string[] | null
  assignees: Address[] | null
  created_at: number
  updated_at: number
  closed_at: number | null
}

export interface Pull {
  id: string
  repo_id: string
  number: number
  title: string
  body: string | null
  author: Address
  source_branch: string
  target_branch: string
  status: 'open' | 'closed' | 'merged'
  is_draft: boolean
  labels: string[] | null
  reviewers: Address[] | null
  created_at: number
  updated_at: number
  merged_at: number | null
  closed_at: number | null
}

// ============================================================================
// Re-exports
// ============================================================================

export type { QueryResult, ConsistencyLevel }
