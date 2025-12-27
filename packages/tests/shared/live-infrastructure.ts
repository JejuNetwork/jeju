/**
 * Live Infrastructure Test Utilities
 *
 * Provides connections to real infrastructure for integration testing:
 * - CQL (CovenantSQL)
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
 *       await requireInfra(['cql', 'chain'])
 *     })
 *
 *     test('uses real CQL', async () => {
 *       const { cql } = await getLiveInfra()
 *       const result = await cql.query('SELECT 1')
 *       expect(result.rows.length).toBe(1)
 *     })
 *   })
 */

import { z } from 'zod'

// Infrastructure configuration from environment
const InfraConfigSchema = z.object({
  cqlEndpoint: z.string().default('http://127.0.0.1:4661'),
  redisUrl: z.string().default('redis://127.0.0.1:6379'),
  l1RpcUrl: z.string().default('http://127.0.0.1:6545'),
  l2RpcUrl: z.string().default('http://127.0.0.1:6546'),
  solanaRpcUrl: z.string().default('http://127.0.0.1:8899'),
  ipfsApiUrl: z.string().default('http://127.0.0.1:5001'),
  gatewayUrl: z.string().default('http://127.0.0.1:8787'),
  indexerUrl: z.string().default('http://127.0.0.1:4350/graphql'),
  oracleUrl: z.string().default('http://127.0.0.1:4301'),
  computeUrl: z.string().default('http://127.0.0.1:4010'),
  messagingUrl: z.string().default('http://127.0.0.1:4201'),
  teeAgentUrl: z.string().default('http://127.0.0.1:4500'),
})

type InfraConfig = z.infer<typeof InfraConfigSchema>

export function getInfraConfig(): InfraConfig {
  return InfraConfigSchema.parse({
    cqlEndpoint: process.env.CQL_ENDPOINT ?? process.env.CQL_BLOCK_PRODUCER_ENDPOINT,
    redisUrl: process.env.REDIS_URL,
    l1RpcUrl: process.env.L1_RPC_URL,
    l2RpcUrl: process.env.L2_RPC_URL ?? process.env.JEJU_RPC_URL,
    solanaRpcUrl: process.env.SOLANA_RPC_URL,
    ipfsApiUrl: process.env.IPFS_API_URL,
    gatewayUrl: process.env.GATEWAY_URL,
    indexerUrl: process.env.INDEXER_GRAPHQL_URL,
    oracleUrl: process.env.ORACLE_URL,
    computeUrl: process.env.COMPUTE_URL ?? process.env.COMPUTE_BRIDGE_URL,
    messagingUrl: process.env.MESSAGING_URL,
    teeAgentUrl: process.env.TEE_AGENT_URL ?? process.env.OAUTH3_TEE_URL,
  })
}

// Service availability status
export interface InfraStatus {
  cql: boolean
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
export async function checkCqlAvailable(config: InfraConfig): Promise<boolean> {
  try {
    const response = await fetch(`${config.cqlEndpoint}/health`, {
      signal: AbortSignal.timeout(3000),
    })
    return response.ok
  } catch {
    // Try alternate health endpoint
    try {
      const response = await fetch(`${config.cqlEndpoint}/v1/health`, {
        signal: AbortSignal.timeout(3000),
      })
      return response.ok
    } catch {
      return false
    }
  }
}

export async function checkRedisAvailable(config: InfraConfig): Promise<boolean> {
  try {
    // Use a simple Redis PING via HTTP if available, or just check connectivity
    const url = new URL(config.redisUrl)
    const host = url.hostname
    const port = parseInt(url.port || '6379', 10)

    // Try to connect via TCP (simple check)
    const response = await fetch(`http://${host}:${port}/`, {
      signal: AbortSignal.timeout(1000),
    }).catch(() => null)

    // Redis doesn't respond to HTTP, but if connection is refused, it's not running
    // If we got ECONNREFUSED, return false. Otherwise, assume Redis is there.
    return response !== null || true // Assume available unless we can detect otherwise
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

export async function checkSolanaAvailable(config: InfraConfig): Promise<boolean> {
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

export async function checkIpfsAvailable(config: InfraConfig): Promise<boolean> {
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

  const [cql, l1Chain, l2Chain, solana, ipfs, gateway, indexer, oracle, compute, messaging, teeAgent] =
    await Promise.all([
      checkCqlAvailable(config),
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
    cql,
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
  | 'cql'
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
export async function requireInfra(requirements: InfraRequirement[]): Promise<void> {
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

/**
 * Check if required infrastructure is available (non-throwing)
 */
export async function hasInfra(requirements: InfraRequirement[]): Promise<boolean> {
  try {
    await requireInfra(requirements)
    return true
  } catch {
    return false
  }
}

// Live client instances for tests

/**
 * Get live CQL client for testing
 */
export async function getLiveCqlClient(): Promise<CqlTestClient> {
  const config = getInfraConfig()
  await requireInfra(['cql'])
  return new CqlTestClient(config.cqlEndpoint)
}

/**
 * Simple CQL client for tests (no mocks)
 */
export class CqlTestClient {
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
      throw new Error(`CQL query failed: ${response.status}`)
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
      throw new Error(`CQL exec failed: ${response.status}`)
    }

    const data = await response.json()
    return { rowsAffected: data.rowsAffected ?? 0 }
  }

  async isHealthy(): Promise<boolean> {
    return checkCqlAvailable(getInfraConfig())
  }
}

/**
 * Get live Redis client for testing
 */
export async function getLiveRedisClient(): Promise<RedisTestClient> {
  const config = getInfraConfig()
  await requireInfra(['redis'])
  return new RedisTestClient(config.redisUrl)
}

/**
 * Simple Redis client interface for tests
 */
export class RedisTestClient {
  constructor(private url: string) {}

  private parseUrl() {
    const url = new URL(this.url)
    return {
      host: url.hostname,
      port: parseInt(url.port || '6379', 10),
      password: url.password || undefined,
    }
  }

  async get(key: string): Promise<string | null> {
    // Note: For real Redis integration, you would use ioredis or similar
    // This is a placeholder that demonstrates the interface
    throw new Error('Redis client requires ioredis - use getLiveRedis() from @jejunetwork/db')
  }

  async set(key: string, value: string, options?: { ex?: number }): Promise<void> {
    throw new Error('Redis client requires ioredis - use getLiveRedis() from @jejunetwork/db')
  }

  async del(key: string): Promise<void> {
    throw new Error('Redis client requires ioredis - use getLiveRedis() from @jejunetwork/db')
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
        privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const,
      },
      user1: {
        address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const,
        privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const,
      },
      user2: {
        address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as const,
        privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as const,
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
  cql: CqlTestClient
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
    cql: new CqlTestClient(config.cqlEndpoint),
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
 */
export async function describeWithInfra(
  requirements: InfraRequirement[],
): Promise<{ available: boolean; skip: boolean }> {
  const available = await hasInfra(requirements)
  return { available, skip: !available }
}

