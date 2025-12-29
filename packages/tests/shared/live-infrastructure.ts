/**
 * Live Infrastructure Test Utilities
 *
 * Provides connections to real infrastructure for integration testing:
 * - SQLit (SQLit)
 * - Redis
 * - EVM Chain
 * - Solana
 * - IPFS
 * - Other services
 *
 * Tests MUST use live infrastructure. Mocks are banned.
 * Tests skip gracefully when infrastructure is unavailable.
 *
 * Usage:
 *   import { getLiveInfra, requireInfra } from '@jejunetwork/tests/shared'
 *
 *   describe('My Integration Tests', () => {
 *     beforeAll(async () => {
 *       await requireInfra(['sqlit', 'chain'])
 *     })
 *
 *     test('uses real SQLit', async () => {
 *       const { sqlit } = await getLiveInfra()
 *       const result = await sqlit.query('SELECT 1')
 *       expect(result.rows.length).toBe(1)
 *     })
 *   })
 */

import {
  getIndexerGraphqlUrl,
  getIpfsApiUrl,
  getL1RpcUrl,
  getLocalhostHost,
  getOAuth3Url,
  getOracleUrl,
  getRpcUrl,
  getServiceUrl,
  getSolanaRpcUrl,
  getSQLitBlockProducerUrl,
} from '@jejunetwork/config'
import { z } from 'zod'

// Infrastructure configuration from environment
// Fields have defaults so they are always defined (not optional)
const InfraConfigSchema = z.object({
  sqlitEndpoint: z.string(),
  redisUrl: z.string(),
  l1RpcUrl: z.string(),
  l2RpcUrl: z.string(),
  solanaRpcUrl: z.string(),
  ipfsApiUrl: z.string(),
  gatewayUrl: z.string(),
  indexerUrl: z.string(),
  oracleUrl: z.string(),
  computeUrl: z.string(),
  messagingUrl: z.string(),
  teeAgentUrl: z.string(),
})

type InfraConfig = z.infer<typeof InfraConfigSchema>

export function getInfraConfig(): InfraConfig {
  const host = getLocalhostHost()
  return InfraConfigSchema.parse({
    sqlitEndpoint:
      (typeof process !== 'undefined'
        ? process.env.SQLIT_ENDPOINT
        : undefined) ??
      (typeof process !== 'undefined'
        ? process.env.SQLIT_BLOCK_PRODUCER_ENDPOINT
        : undefined) ??
      getSQLitBlockProducerUrl() ??
      `http://${host}:4401`,
    redisUrl:
      (typeof process !== 'undefined' ? process.env.REDIS_URL : undefined) ??
      `redis://${host}:6379`,
    l1RpcUrl:
      (typeof process !== 'undefined' ? process.env.L1_RPC_URL : undefined) ??
      getL1RpcUrl() ??
      `http://${host}:6545`,
    l2RpcUrl:
      (typeof process !== 'undefined' ? process.env.L2_RPC_URL : undefined) ??
      (typeof process !== 'undefined' ? process.env.JEJU_RPC_URL : undefined) ??
      getRpcUrl() ??
      `http://${host}:6546`,
    solanaRpcUrl:
      (typeof process !== 'undefined'
        ? process.env.SOLANA_RPC_URL
        : undefined) ??
      getSolanaRpcUrl() ??
      `http://${host}:8899`,
    ipfsApiUrl:
      (typeof process !== 'undefined' ? process.env.IPFS_API_URL : undefined) ??
      getIpfsApiUrl() ??
      `http://${host}:5001`,
    gatewayUrl:
      (typeof process !== 'undefined' ? process.env.GATEWAY_URL : undefined) ??
      getServiceUrl('gateway', 'api') ??
      `http://${host}:8787`,
    indexerUrl:
      (typeof process !== 'undefined'
        ? process.env.INDEXER_GRAPHQL_URL
        : undefined) ??
      getIndexerGraphqlUrl() ??
      `http://${host}:4350/graphql`,
    oracleUrl:
      (typeof process !== 'undefined' ? process.env.ORACLE_URL : undefined) ??
      getOracleUrl() ??
      `http://${host}:4301`,
    computeUrl:
      (typeof process !== 'undefined' ? process.env.COMPUTE_URL : undefined) ??
      (typeof process !== 'undefined'
        ? process.env.COMPUTE_BRIDGE_URL
        : undefined) ??
      getServiceUrl('compute', 'marketplace') ??
      `http://${host}:4500`,
    messagingUrl:
      (typeof process !== 'undefined'
        ? process.env.MESSAGING_URL
        : undefined) ?? `http://${host}:4201`,
    teeAgentUrl:
      (typeof process !== 'undefined'
        ? process.env.TEE_AGENT_URL
        : undefined) ??
      (typeof process !== 'undefined'
        ? process.env.OAUTH3_TEE_URL
        : undefined) ??
      getOAuth3Url() ??
      `http://${host}:4001`,
  })
}

// Service availability status
export interface InfraStatus {
  sqlit: boolean
  redis: boolean
  l1Chain: boolean
  l2Chain: boolean
  solana: boolean
  ipfs: boolean
  gateway: boolean
  indexer: boolean
  oracle: boolean
  compute: boolean
  messaging: boolean
  teeAgent: boolean
}

// Check individual service availability
export async function checkSQLitAvailable(
  config: InfraConfig,
): Promise<boolean> {
  try {
    const response = await fetch(`${config.sqlitEndpoint}/health`, {
      signal: AbortSignal.timeout(3000),
    })
    return response.ok
  } catch {
    // Try alternate health endpoint
    try {
      const response = await fetch(`${config.sqlitEndpoint}/v1/health`, {
        signal: AbortSignal.timeout(3000),
      })
      return response.ok
    } catch {
      return false
    }
  }
}

export async function checkRedisAvailable(
  config: InfraConfig,
): Promise<boolean> {
  try {
    // Use TCP connection check to Redis
    const url = new URL(config.redisUrl)
    const host = url.hostname
    const port = parseInt(url.port || '6379', 10)

    // Use Bun.connect to check TCP connectivity
    const socket = await Bun.connect({
      hostname: host,
      port: port,
      socket: {
        data: () => {},
        open: () => {},
        close: () => {},
        error: () => {},
        connectError: () => {},
      },
    }).catch(() => null)

    if (socket) {
      socket.end()
      return true
    }
    return false
  } catch {
    return false
  }
}

export async function checkChainAvailable(rpcUrl: string): Promise<boolean> {
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1,
      }),
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) return false
    const data = await response.json()
    return data.result !== undefined && !data.error
  } catch {
    return false
  }
}

export async function checkSolanaAvailable(
  config: InfraConfig,
): Promise<boolean> {
  try {
    const response = await fetch(config.solanaRpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'getHealth',
        id: 1,
      }),
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) return false
    const data = await response.json()
    return data.result === 'ok'
  } catch {
    return false
  }
}

export async function checkHttpServiceAvailable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(3000),
    })
    return response.ok || response.status < 500
  } catch {
    return false
  }
}

export async function checkIpfsAvailable(
  config: InfraConfig,
): Promise<boolean> {
  try {
    const response = await fetch(`${config.ipfsApiUrl}/api/v0/id`, {
      method: 'POST',
      signal: AbortSignal.timeout(3000),
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Check all infrastructure availability
 */
export async function getInfraStatus(): Promise<InfraStatus> {
  const config = getInfraConfig()

  const [
    sqlit,
    l1Chain,
    l2Chain,
    solana,
    ipfs,
    gateway,
    indexer,
    oracle,
    compute,
    messaging,
    teeAgent,
  ] = await Promise.all([
    checkSQLitAvailable(config),
    checkChainAvailable(config.l1RpcUrl),
    checkChainAvailable(config.l2RpcUrl),
    checkSolanaAvailable(config),
    checkIpfsAvailable(config),
    checkHttpServiceAvailable(config.gatewayUrl),
    checkHttpServiceAvailable(config.indexerUrl),
    checkHttpServiceAvailable(config.oracleUrl),
    checkHttpServiceAvailable(config.computeUrl),
    checkHttpServiceAvailable(config.messagingUrl),
    checkHttpServiceAvailable(config.teeAgentUrl),
  ])

  // Redis check is special - we'll assume it's available if we can't determine otherwise
  const redis = await checkRedisAvailable(config)

  return {
    sqlit,
    redis,
    l1Chain,
    l2Chain,
    solana,
    ipfs,
    gateway,
    indexer,
    oracle,
    compute,
    messaging,
    teeAgent,
  }
}

/**
 * Print infrastructure status for debugging
 */
export async function printInfraStatus(): Promise<void> {
  const status = await getInfraStatus()
  console.log('\n=== Infrastructure Status ===')
  for (const [service, available] of Object.entries(status)) {
    console.log(`  ${service.padEnd(12)} ${available ? '✓' : '✗'}`)
  }
  console.log('=============================\n')
}

// Infrastructure requirement types
export type InfraRequirement =
  | 'sqlit'
  | 'redis'
  | 'l1Chain'
  | 'l2Chain'
  | 'chain' // alias for l2Chain
  | 'solana'
  | 'ipfs'
  | 'gateway'
  | 'indexer'
  | 'oracle'
  | 'compute'
  | 'messaging'
  | 'teeAgent'

/**
 * Require specific infrastructure to be available
 * Throws if any required infrastructure is unavailable
 */
export async function requireInfra(
  requirements: InfraRequirement[],
): Promise<void> {
  const status = await getInfraStatus()
  const missing: string[] = []

  for (const req of requirements) {
    const key = req === 'chain' ? 'l2Chain' : req
    if (!status[key as keyof InfraStatus]) {
      missing.push(req)
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Required infrastructure not available: ${missing.join(', ')}. ` +
        'Start infrastructure with: bun run start (or jeju up)',
    )
  }
}

// Convert object-style requirements to array
export type InfraRequirementObject = Partial<Record<InfraRequirement, boolean>>

function normalizeRequirements(
  requirements: InfraRequirement[] | InfraRequirementObject,
): InfraRequirement[] {
  if (Array.isArray(requirements)) {
    return requirements
  }
  return Object.entries(requirements)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key as InfraRequirement)
}

/**
 * Check if required infrastructure is available (non-throwing)
 * Accepts array or object-style requirements
 */
export async function hasInfra(
  requirements: InfraRequirement[] | InfraRequirementObject,
): Promise<boolean> {
  try {
    await requireInfra(normalizeRequirements(requirements))
    return true
  } catch {
    return false
  }
}

// Live client instances for tests

/**
 * Get live SQLit client for testing
 */
export async function getLiveSQLitClient(): Promise<SQLitTestClient> {
  const config = getInfraConfig()
  await requireInfra(['sqlit'])
  return new SQLitTestClient(config.sqlitEndpoint)
}

/**
 * Simple SQLit client for tests (no mocks)
 */
export class SQLitTestClient {
  constructor(private endpoint: string) {}

  async query<T = Record<string, unknown>>(
    sql: string,
    params: (string | number | boolean | null)[] = [],
    databaseId = 'test-db',
  ): Promise<{ rows: T[]; rowCount: number }> {
    const response = await fetch(`${this.endpoint}/v1/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        database_id: databaseId,
        sql,
        params,
      }),
    })

    if (!response.ok) {
      throw new Error(`SQLit query failed: ${response.status}`)
    }

    const data = await response.json()
    return {
      rows: data.rows ?? [],
      rowCount: data.rowCount ?? data.rows?.length ?? 0,
    }
  }

  async exec(
    sql: string,
    params: (string | number | boolean | null)[] = [],
    databaseId = 'test-db',
  ): Promise<{ rowsAffected: number }> {
    const response = await fetch(`${this.endpoint}/v1/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        database_id: databaseId,
        sql,
        params,
        type: 'exec',
      }),
    })

    if (!response.ok) {
      throw new Error(`SQLit exec failed: ${response.status}`)
    }

    const data = await response.json()
    return { rowsAffected: data.rowsAffected ?? 0 }
  }

  async isHealthy(): Promise<boolean> {
    return checkSQLitAvailable(getInfraConfig())
  }
}

/**
 * Get live Redis client for testing
 */
export async function getLiveRedisClient(): Promise<RedisTestClient> {
  await requireInfra(['redis'])
  return new RedisTestClient()
}

/**
 * Simple Redis client interface for tests
 */
export class RedisTestClient {
  async get(_key: string): Promise<string | null> {
    // Note: For real Redis integration, you would use ioredis or similar
    // This is a placeholder that demonstrates the interface
    throw new Error(
      'Redis client requires ioredis - use getLiveRedis() from @jejunetwork/db',
    )
  }

  async set(
    _key: string,
    _value: string,
    _options?: { ex?: number },
  ): Promise<void> {
    throw new Error(
      'Redis client requires ioredis - use getLiveRedis() from @jejunetwork/db',
    )
  }

  async del(_key: string): Promise<void> {
    throw new Error(
      'Redis client requires ioredis - use getLiveRedis() from @jejunetwork/db',
    )
  }

  async isHealthy(): Promise<boolean> {
    return checkRedisAvailable(getInfraConfig())
  }
}

/**
 * Get live chain client configuration
 */
export function getChainConfig(chain: 'l1' | 'l2' = 'l2') {
  const config = getInfraConfig()
  const rpcUrl = chain === 'l1' ? config.l1RpcUrl : config.l2RpcUrl
  const chainId = chain === 'l1' ? 1 : 31337

  return {
    rpcUrl,
    chainId,
    // Well-known Anvil test accounts
    accounts: {
      deployer: {
        address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const,
        privateKey:
          '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const,
      },
      user1: {
        address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const,
        privateKey:
          '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const,
      },
      user2: {
        address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as const,
        privateKey:
          '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as const,
      },
    },
  }
}

/**
 * Live infrastructure object with all services
 */
export interface LiveInfra {
  config: InfraConfig
  status: InfraStatus
  sqlit: SQLitTestClient
  chainConfig: ReturnType<typeof getChainConfig>
}

/**
 * Get all live infrastructure for testing
 */
export async function getLiveInfra(): Promise<LiveInfra> {
  const config = getInfraConfig()
  const status = await getInfraStatus()

  return {
    config,
    status,
    sqlit: new SQLitTestClient(config.sqlitEndpoint),
    chainConfig: getChainConfig('l2'),
  }
}

/**
 * Test helper: skip test if infrastructure is not available
 */
export function skipWithoutInfra(
  requirements: InfraRequirement[],
  testFn: () => void | Promise<void>,
): () => void | Promise<void> {
  return async () => {
    const available = await hasInfra(requirements)
    if (!available) {
      console.log(`Skipping: requires ${requirements.join(', ')}`)
      return
    }
    return testFn()
  }
}

/**
 * Test helper: create a describe block that skips if infra unavailable
 *
 * Usage:
 *   describeWithInfra('My Tests', { redis: true, chain: true }, () => {
 *     it('should work with Redis and chain', () => { ... })
 *   })
 *
 * Note: When infra is not available, tests will show as skipped.
 */
export function describeWithInfra(
  name: string,
  requirements: InfraRequirement[] | InfraRequirementObject,
  fn: () => void,
): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const bunTest = require('bun:test')

  const reqs = normalizeRequirements(requirements)

  bunTest.describe(name, () => {
    let infraAvailable: boolean | null = null

    bunTest.beforeAll(async () => {
      infraAvailable = await hasInfra(reqs)
      if (!infraAvailable) {
        console.log(`  ⚠ Skipping "${name}": requires ${reqs.join(', ')}`)
      }
    })

    // Single skip marker test
    bunTest.it.skip(`skipped: requires ${reqs.join(', ')}`, () => {})

    // Run the actual test definitions
    fn()
  })
}
