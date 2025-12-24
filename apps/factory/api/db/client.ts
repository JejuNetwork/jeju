/** Factory Database Client */

import { getCQLBlockProducerUrl } from '@jejunetwork/config'
import { type CQLClient, getCQL, type TableSchema } from '@jejunetwork/db'
import type { Address } from 'viem'
import { toSqlParams, validateHexString } from '../lib/type-guards'
import { ALL_SCHEMAS } from './schema'

export interface FactoryDBConfig {
  /** CovenantSQL node endpoints */
  nodes: string[]
  /** Database ID */
  databaseId: string
  /** Private key for authentication */
  privateKey: string
  /** Query timeout in ms */
  timeout: number
  /** Enable query logging */
  debug: boolean
}

type QueryParam = string | number | boolean

/** Data type for insert/update operations */
type DbRecord = Record<string, string | number | boolean | null>

interface SelectOptions {
  where?: string
  whereParams?: QueryParam[]
  orderBy?: string
  limit?: number
  offset?: number
}

function normalizeParams(params?: QueryParam[]): (string | number)[] {
  if (!params) return []
  return params.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p))
}

interface HealthInfo {
  healthy: boolean
  nodes: Array<{ node: string; healthy: boolean; latency: number }>
}

class FactoryDBClient {
  private client: CQLClient
  private databaseId: string

  constructor(client: CQLClient, databaseId: string) {
    this.client = client
    this.databaseId = databaseId
  }

  async initialize(): Promise<void> {
    await this.client.query('SELECT 1', [], this.databaseId)
  }

  async createTable(schema: TableSchema): Promise<void> {
    const columns = schema.columns
      .map((col) => {
        let def = `${col.name} ${col.type}`
        if (!col.nullable) def += ' NOT NULL'
        if (col.default !== undefined) def += ` DEFAULT ${col.default}`
        return def
      })
      .join(', ')

    const pk =
      schema.primaryKey && schema.primaryKey.length > 0
        ? `, PRIMARY KEY (${schema.primaryKey.join(', ')})`
        : ''

    const sql = `CREATE TABLE IF NOT EXISTS ${schema.name} (${columns}${pk})`
    await this.client.exec(sql, [], this.databaseId)

    if (schema.indexes) {
      for (const idx of schema.indexes) {
        const unique = idx.unique ? 'UNIQUE ' : ''
        const idxSql = `CREATE ${unique}INDEX IF NOT EXISTS ${idx.name} ON ${schema.name} (${idx.columns.join(', ')})`
        await this.client.exec(idxSql, [], this.databaseId)
      }
    }
  }

  async select<T>(table: string, options: SelectOptions = {}): Promise<T[]> {
    let sql = `SELECT * FROM ${table}`
    if (options.where) sql += ` WHERE ${options.where}`
    if (options.orderBy) sql += ` ORDER BY ${options.orderBy}`
    if (options.limit) sql += ` LIMIT ${options.limit}`
    if (options.offset) sql += ` OFFSET ${options.offset}`

    const result = await this.client.query<T>(
      sql,
      normalizeParams(options.whereParams),
      this.databaseId,
    )
    return result.rows
  }

  async selectOne<T>(
    table: string,
    where: string,
    params?: QueryParam[],
  ): Promise<T | null> {
    const sql = `SELECT * FROM ${table} WHERE ${where} LIMIT 1`
    const result = await this.client.query<T>(
      sql,
      normalizeParams(params),
      this.databaseId,
    )
    return result.rows[0] ?? null
  }

  async insert(table: string, data: DbRecord): Promise<void> {
    const keys = Object.keys(data)
    const values = Object.values(data)
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ')

    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`
    await this.client.exec(sql, toSqlParams(values), this.databaseId)
  }

  async update(
    table: string,
    data: DbRecord,
    where: string,
    whereParams: QueryParam[],
  ): Promise<void> {
    const keys = Object.keys(data)
    const values = Object.values(data)
    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ')

    const allParams: (string | number | boolean | null)[] = [
      ...values,
      ...whereParams,
    ]

    let adjustedWhere = where
    whereParams.forEach((_, i) => {
      adjustedWhere = adjustedWhere.replace(
        `$${i + 1}`,
        `$${keys.length + i + 1}`,
      )
    })

    const sql = `UPDATE ${table} SET ${sets} WHERE ${adjustedWhere}`
    await this.client.exec(sql, toSqlParams(allParams), this.databaseId)
  }

  async delete(
    table: string,
    where: string,
    params: QueryParam[],
  ): Promise<void> {
    const sql = `DELETE FROM ${table} WHERE ${where}`
    await this.client.exec(sql, normalizeParams(params), this.databaseId)
  }

  async count(
    table: string,
    where?: string,
    params?: QueryParam[],
  ): Promise<number> {
    let sql = `SELECT COUNT(*) as count FROM ${table}`
    if (where) sql += ` WHERE ${where}`
    const result = await this.client.query<{ count: number }>(
      sql,
      normalizeParams(params),
      this.databaseId,
    )
    return result.rows[0]?.count ?? 0
  }

  async query<T>(sql: string, params?: QueryParam[]): Promise<T[]> {
    const result = await this.client.query<T>(
      sql,
      normalizeParams(params),
      this.databaseId,
    )
    return result.rows
  }

  getHealth(): HealthInfo {
    return {
      healthy: true,
      nodes: [{ node: 'primary', healthy: true, latency: 1 }],
    }
  }

  async close(): Promise<void> {}
}

let dbClient: FactoryDBClient | null = null
let initialized = false

export function getFactoryDB(): FactoryDBClient {
  if (dbClient) {
    return dbClient
  }

  const nodes = process.env.COVENANTSQL_NODES?.split(',') ?? [
    getCQLBlockProducerUrl(),
  ]
  const databaseId = process.env.FACTORY_DATABASE_ID ?? 'factory'
  const privateKey = process.env.FACTORY_DB_PRIVATE_KEY

  if (!privateKey) {
    throw new Error(
      'FACTORY_DB_PRIVATE_KEY environment variable required for database access',
    )
  }

  const cqlClient = getCQL({
    blockProducerEndpoint: nodes[0],
    databaseId,
    privateKey: validateHexString(privateKey),
    timeout: parseInt(process.env.COVENANTSQL_TIMEOUT ?? '30000', 10),
    debug: process.env.COVENANTSQL_LOGGING === 'true',
  })

  dbClient = new FactoryDBClient(cqlClient, databaseId)

  return dbClient
}

export async function initializeFactoryDB(): Promise<void> {
  if (initialized) return

  const db = getFactoryDB()
  await db.initialize()

  for (const schema of ALL_SCHEMAS) {
    await db.createTable(schema)
  }

  initialized = true
}

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

export async function closeFactoryDB(): Promise<void> {
  if (dbClient) {
    await dbClient.close()
    dbClient = null
    initialized = false
  }
}

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
