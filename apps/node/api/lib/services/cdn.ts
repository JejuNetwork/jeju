/**
 * SECURITY TODO: Migrate to SecureTransactionExecutor for KMS-backed signing
 * Current implementation uses walletClient.writeContract which requires
 * private keys in memory. Should use createSecureTransactionExecutor()
 * from '../secure-transactions' for TEE-safe operations.
 */
import { getRpcUrl } from '@jejunetwork/config'
import type { CDNRegion } from '@jejunetwork/types'
import { expectAddress, expectHex, toBigInt } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import { z } from 'zod'
import { config as nodeConfig } from '../../config'
import { CDN_REGISTRY_ABI } from '../abis'
import { getChain, type SecureNodeClient } from '../contracts'

/** Type for CDN edge node as returned by getEdgeNode contract call */
interface CDNEdgeNodeResult {
  nodeId: Hex
  operator: Address
  endpoint: string
  region: number
  providerType: number
  status: number
  stake: bigint
  registeredAt: bigint
  lastSeen: bigint
  agentId: bigint
}

/** Type for CDN node metrics as returned by getNodeMetrics contract call */
interface CDNMetricsResult {
  currentLoad: bigint
  bandwidthUsage: bigint
  activeConnections: bigint
  requestsPerSecond: bigint
  bytesServedTotal: bigint
  requestsTotal: bigint
  cacheSize: bigint
  cacheEntries: bigint
  cacheHitRate: bigint
  avgResponseTime: bigint
  lastUpdated: bigint
}

function parseEdgeNodeResult(result: readonly unknown[]): CDNEdgeNodeResult {
  return {
    nodeId: expectHex(result[0], 'nodeId'),
    operator: expectAddress(result[1], 'operator'),
    endpoint: String(result[2]),
    region: Number(result[3]),
    providerType: Number(result[4]),
    status: Number(result[5]),
    stake: toBigInt(result[6]),
    registeredAt: toBigInt(result[7]),
    lastSeen: toBigInt(result[8]),
    agentId: toBigInt(result[9]),
  }
}

function parseMetricsResult(result: readonly unknown[]): CDNMetricsResult {
  return {
    currentLoad: toBigInt(result[0]),
    bandwidthUsage: toBigInt(result[1]),
    activeConnections: toBigInt(result[2]),
    requestsPerSecond: toBigInt(result[3]),
    bytesServedTotal: toBigInt(result[4]),
    requestsTotal: toBigInt(result[5]),
    cacheSize: toBigInt(result[6]),
    cacheEntries: toBigInt(result[7]),
    cacheHitRate: toBigInt(result[8]),
    avgResponseTime: toBigInt(result[9]),
    lastUpdated: toBigInt(result[10]),
  }
}

// Types & Validation

// Valid CDN regions
const CDN_REGIONS = new Set([
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'eu-west-1',
  'eu-west-2',
  'eu-central-1',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-south-1',
  'sa-east-1',
  'af-south-1',
  'me-south-1',
])

function isCDNRegion(val: string): val is CDNRegion {
  return CDN_REGIONS.has(val)
}

// Use the actual CDNRegion type from @jejunetwork/types
const CDNRegionSchema = z.custom<CDNRegion>(
  (val): val is CDNRegion => typeof val === 'string' && isCDNRegion(val),
  'Invalid CDN region',
)

const CDNServiceConfigSchema = z.object({
  endpoint: z.string().url(),
  region: CDNRegionSchema,
  maxCacheSizeMB: z.number().int().positive(),
  stakeAmount: z.bigint(),
  supportedOrigins: z.array(z.string().url()),
})

export interface CDNServiceConfig {
  endpoint: string
  region: CDNRegion
  maxCacheSizeMB: number
  stakeAmount: bigint
  supportedOrigins: string[]
}

const CDNNodeMetricsSchema = z.object({
  requestsTotal: z.number().int().nonnegative(),
  bytesServed: z.number().int().nonnegative(),
  cacheHitRate: z.number().min(0).max(100),
  avgLatencyMs: z.number().nonnegative(),
  activeConnections: z.number().int().nonnegative(),
  cacheEntries: z.number().int().nonnegative(),
  cacheSizeBytes: z.number().int().nonnegative(),
})

export interface CDNNodeMetrics {
  requestsTotal: number
  bytesServed: number
  cacheHitRate: number
  avgLatencyMs: number
  activeConnections: number
  cacheEntries: number
  cacheSizeBytes: number
}

const HexStringSchema = z.custom<Hex>(
  (val): val is Hex => typeof val === 'string' && /^0x[a-fA-F0-9]+$/.test(val),
  'Invalid hex string',
)

const CDNServiceStateSchema = z.object({
  isRegistered: z.boolean(),
  nodeId: HexStringSchema,
  endpoint: z.string().url(),
  region: z.custom<CDNRegion>(
    (val): val is CDNRegion => typeof val === 'string' && CDN_REGIONS.has(val),
  ),
  stake: z.bigint(),
  status: z.enum([
    'healthy',
    'degraded',
    'unhealthy',
    'maintenance',
    'offline',
  ]),
  metrics: CDNNodeMetricsSchema,
})

export interface CDNServiceState {
  isRegistered: boolean
  nodeId: `0x${string}`
  endpoint: string
  region: CDNRegion
  stake: bigint
  status: 'healthy' | 'degraded' | 'unhealthy' | 'maintenance' | 'offline'
  metrics: CDNNodeMetrics
}

const CDNEarningsSchema = z.object({
  pending: z.bigint(),
  total: z.bigint(),
  lastSettlement: z.number().int().positive(),
})

export interface CDNEarnings {
  pending: bigint
  total: bigint
  lastSettlement: number
}

export function validateCDNServiceConfig(data: unknown): CDNServiceConfig {
  const parsed = CDNServiceConfigSchema.parse(data)
  if (!isCDNRegion(parsed.region)) {
    throw new Error(`Invalid CDN region: ${parsed.region}`)
  }
  return {
    ...parsed,
    region: parsed.region,
  }
}

export function validateCDNServiceState(data: unknown): CDNServiceState {
  return CDNServiceStateSchema.parse(data)
}

export function validateCDNNodeMetrics(data: unknown): CDNNodeMetrics {
  return CDNNodeMetricsSchema.parse(data)
}

export function validateCDNEarnings(data: unknown): CDNEarnings {
  return CDNEarningsSchema.parse(data)
}

// CDN Service

export class CDNService {
  private client: SecureNodeClient
  private edgeNodeProcess: ChildProcess | null = null

  constructor(client: SecureNodeClient) {
    this.client = client
  }

  /**
   * Get CDN service state
   */
  async getState(address: Address): Promise<CDNServiceState | null> {
    const validatedAddress = expectAddress(address, 'CDN getState address')

    // Get operator's nodes
    const nodeIds = await this.client.publicClient.readContract({
      address: this.client.addresses.cdnRegistry,
      abi: CDN_REGISTRY_ABI,
      functionName: 'getOperatorNodes',
      args: [validatedAddress],
    })

    if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
      return null
    }

    // Get first node's details
    const nodeId = expectHex(nodeIds[0], 'CDN node ID')
    const nodeResult = await this.client.publicClient.readContract({
      address: this.client.addresses.cdnRegistry,
      abi: CDN_REGISTRY_ABI,
      functionName: 'getEdgeNode',
      args: [nodeId],
    })
    const node = parseEdgeNodeResult(nodeResult)

    const metricsResult = await this.client.publicClient.readContract({
      address: this.client.addresses.cdnRegistry,
      abi: CDN_REGISTRY_ABI,
      functionName: 'getNodeMetrics',
      args: [nodeId],
    })
    const metrics = parseMetricsResult(metricsResult)

    const regionMap: CDNRegion[] = [
      'us-east-1',
      'us-east-2',
      'us-west-1',
      'us-west-2',
      'eu-west-1',
      'eu-west-2',
      'eu-central-1',
      'ap-northeast-1',
      'ap-northeast-2',
      'ap-southeast-1',
      'ap-southeast-2',
      'ap-south-1',
      'sa-east-1',
      'af-south-1',
      'me-south-1',
      'global',
    ]

    const statusMap: CDNServiceState['status'][] = [
      'healthy',
      'degraded',
      'unhealthy',
      'maintenance',
      'offline',
    ]

    const rawState = {
      isRegistered: true,
      nodeId: node.nodeId,
      endpoint: node.endpoint,
      region: regionMap[node.region] ?? 'global',
      stake: node.stake,
      status: statusMap[node.status] ?? 'offline',
      metrics: {
        requestsTotal: Number(metrics.requestsTotal),
        bytesServed: Number(metrics.bytesServedTotal),
        cacheHitRate: Number(metrics.cacheHitRate) / 100, // Stored as basis points
        avgLatencyMs: Number(metrics.avgResponseTime),
        activeConnections: Number(metrics.activeConnections),
        cacheEntries: Number(metrics.cacheEntries),
        cacheSizeBytes: Number(metrics.cacheSize),
      },
    }

    return validateCDNServiceState(rawState)
  }

  /**
   * Register as CDN edge node
   */
  async register(config: CDNServiceConfig): Promise<string> {
    const validatedConfig = validateCDNServiceConfig(config)

    if (!this.client.walletClient?.account) {
      throw new Error('Wallet not connected')
    }

    const regionIndex = this.getRegionIndex(validatedConfig.region)

    const hash = await this.client.walletClient.writeContract({
      chain: getChain(this.client.chainId),
      account: this.client.walletClient.account,
      address: this.client.addresses.cdnRegistry,
      abi: CDN_REGISTRY_ABI,
      functionName: 'registerEdgeNode',
      args: [validatedConfig.endpoint, regionIndex, 0], // 0 = decentralized type
      value: validatedConfig.stakeAmount,
    })

    return hash
  }

  /**
   * Start the edge node process
   */
  async startEdgeNode(
    nodeId: string,
    config: {
      port: number
      maxCacheSizeMB: number
      origins: Array<{ name: string; type: string; endpoint: string }>
    },
  ): Promise<void> {
    if (this.edgeNodeProcess) {
      console.warn('[CDN] Edge node already running')
      return
    }

    const privateKey = await this.getPrivateKey()

    // Start edge node as subprocess
    this.edgeNodeProcess = Bun.spawn({
      cmd: ['bun', 'run', '-w', '@jejunetwork/dws', 'cdn:edge'],
      env: {
        ...process.env,
        CDN_NODE_ID: nodeId,
        CDN_PORT: config.port.toString(),
        CDN_CACHE_SIZE_MB: config.maxCacheSizeMB.toString(),
        PRIVATE_KEY: privateKey,
        CDN_REGISTRY_ADDRESS: this.client.addresses.cdnRegistry,
        CDN_BILLING_ADDRESS: this.client.addresses.cdnBilling,
        RPC_URL: nodeConfig.rpcUrl ?? getRpcUrl(),
      },
      stdio: ['inherit', 'inherit', 'inherit'],
    })

    console.log(`[CDN] Started edge node on port ${config.port}`)
  }

  /**
   * Stop the edge node process
   */
  async stopEdgeNode(): Promise<void> {
    if (this.edgeNodeProcess) {
      this.edgeNodeProcess.kill()
      this.edgeNodeProcess = null
      console.log('[CDN] Stopped edge node')
    }
  }

  /**
   * Check if edge node is running
   */
  isRunning(): boolean {
    return this.edgeNodeProcess !== null
  }

  /**
   * Get earnings with last settlement time
   */
  async getEarnings(address: Address): Promise<CDNEarnings> {
    const result = await this.client.publicClient.readContract({
      address: this.client.addresses.cdnBilling,
      abi: [
        'function getProviderEarnings(address) view returns (uint256, uint256)',
      ],
      functionName: 'getProviderEarnings',
      args: [address],
    })

    const resultArray = result as readonly unknown[]
    const pending = toBigInt(resultArray[0])
    const settled = toBigInt(resultArray[1])

    // Get billing records to find the most recent settlement
    const lastSettlement = await this.getLastSettlementTime(address)

    return {
      pending,
      total: settled,
      lastSettlement,
    }
  }

  /**
   * Get the timestamp of the provider's last settlement
   * Queries billing records and finds the most recent one
   */
  private async getLastSettlementTime(
    providerAddress: Address,
  ): Promise<number> {
    // Get provider's billing record IDs
    const billingRecordIds = await this.client.publicClient.readContract({
      address: this.client.addresses.cdnBilling,
      abi: [
        {
          name: 'getProviderBillingRecords',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ name: 'provider', type: 'address' }],
          outputs: [{ name: '', type: 'bytes32[]' }],
        },
      ] as const,
      functionName: 'getProviderBillingRecords',
      args: [providerAddress],
    })

    if (billingRecordIds.length === 0) {
      return 0 // No settlements yet
    }

    // Get the most recent billing record (last in array is most recent)
    const latestRecordId = expectHex(
      billingRecordIds[billingRecordIds.length - 1],
      'billing record ID',
    )

    const record = await this.client.publicClient.readContract({
      address: this.client.addresses.cdnBilling,
      abi: [
        {
          name: 'getBillingRecord',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ name: 'id', type: 'bytes32' }],
          outputs: [
            {
              name: '',
              type: 'tuple',
              components: [
                { name: 'id', type: 'bytes32' },
                { name: 'user', type: 'address' },
                { name: 'provider', type: 'address' },
                { name: 'amount', type: 'uint256' },
                { name: 'timestamp', type: 'uint256' },
                { name: 'status', type: 'uint8' },
                { name: 'periodStart', type: 'uint256' },
                { name: 'periodEnd', type: 'uint256' },
              ],
            },
          ],
        },
      ] as const,
      functionName: 'getBillingRecord',
      args: [latestRecordId],
    })

    // Return timestamp in milliseconds
    return Number(record.timestamp) * 1000
  }

  /**
   * Withdraw earnings
   */
  async withdrawEarnings(): Promise<string> {
    if (!this.client.walletClient?.account) {
      throw new Error('Wallet not connected')
    }

    const hash = await this.client.walletClient.writeContract({
      chain: getChain(this.client.chainId),
      account: this.client.walletClient.account,
      address: this.client.addresses.cdnBilling,
      abi: ['function providerWithdraw() external'],
      functionName: 'providerWithdraw',
      args: [],
    })

    return hash
  }

  /**
   * Add stake to node
   */
  async addStake(nodeId: `0x${string}`, amount: bigint): Promise<string> {
    if (!this.client.walletClient?.account) {
      throw new Error('Wallet not connected')
    }

    const hash = await this.client.walletClient.writeContract({
      chain: getChain(this.client.chainId),
      account: this.client.walletClient.account,
      address: this.client.addresses.cdnRegistry,
      abi: CDN_REGISTRY_ABI,
      functionName: 'addNodeStake',
      args: [nodeId],
      value: amount,
    })

    return hash
  }

  /**
   * Update node status
   */
  async updateStatus(
    nodeId: `0x${string}`,
    status: CDNServiceState['status'],
  ): Promise<string> {
    if (!this.client.walletClient?.account) {
      throw new Error('Wallet not connected')
    }

    const statusMap: Record<CDNServiceState['status'], number> = {
      healthy: 0,
      degraded: 1,
      unhealthy: 2,
      maintenance: 3,
      offline: 4,
    }

    const hash = await this.client.walletClient.writeContract({
      chain: getChain(this.client.chainId),
      account: this.client.walletClient.account,
      address: this.client.addresses.cdnRegistry,
      abi: CDN_REGISTRY_ABI,
      functionName: 'updateNodeStatus',
      args: [nodeId, statusMap[status]],
    })

    return hash
  }

  // Helpers

  private getRegionIndex(region: CDNRegion): number {
    const regions: CDNRegion[] = [
      'us-east-1',
      'us-east-2',
      'us-west-1',
      'us-west-2',
      'eu-west-1',
      'eu-west-2',
      'eu-central-1',
      'ap-northeast-1',
      'ap-northeast-2',
      'ap-southeast-1',
      'ap-southeast-2',
      'ap-south-1',
      'sa-east-1',
      'af-south-1',
      'me-south-1',
      'global',
    ]
    return regions.indexOf(region)
  }

  private async getPrivateKey(): Promise<string> {
    // Priority order for private key retrieval:
    // 1. PRIVATE_KEY environment variable (for CLI/daemon mode)
    // 2. JEJU_PRIVATE_KEY environment variable (alternate name)
    // The Tauri desktop app uses secure OS keychain storage instead
    const key = nodeConfig.privateKey ?? nodeConfig.jejuPrivateKey
    if (!key) {
      throw new Error(
        'Private key not available. Set PRIVATE_KEY or JEJU_PRIVATE_KEY environment variable.',
      )
    }

    // Validate key format
    if (!/^0x[a-fA-F0-9]{64}$/.test(key)) {
      throw new Error(
        'Invalid private key format. Must be 0x followed by 64 hex characters.',
      )
    }

    return key
  }
}

// Types for subprocess

interface ChildProcess {
  kill(): void
}

// Factory

export function createCDNService(client: SecureNodeClient): CDNService {
  return new CDNService(client)
}
