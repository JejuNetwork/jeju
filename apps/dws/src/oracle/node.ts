import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  defineChain,
  encodePacked,
  type Hex,
  http,
  keccak256,
  type PublicClient,
  toBytes,
  type WalletClient,
} from 'viem'
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia, foundry } from 'viem/chains'
import {
  COMMITTEE_MANAGER_ABI,
  FEED_REGISTRY_ABI,
  NETWORK_CONNECTOR_ABI,
  REPORT_VERIFIER_ABI,
} from './abis'
import { type PriceData, PriceFetcher } from './price-fetcher'
import type { NodeMetrics, OracleNodeConfig, PriceReport } from './types'

const ZERO_BYTES32 =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as const

export class OracleNode {
  private config: OracleNodeConfig
  private account: PrivateKeyAccount
  private publicClient: PublicClient
  private walletClient: WalletClient
  private priceFetcher: PriceFetcher
  private operatorId: Hex | null = null
  private running = false
  private pollInterval?: Timer
  private heartbeatInterval?: Timer
  private metrics: NodeMetrics
  private startTime: number

  constructor(config: OracleNodeConfig) {
    this.config = config
    this.startTime = Date.now()

    this.account = privateKeyToAccount(config.workerPrivateKey)
    const chain = this.getChain(config.chainId)

    this.publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    })

    this.walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(config.rpcUrl),
    })

    this.priceFetcher = new PriceFetcher(config.rpcUrl, config.priceSources)

    this.metrics = {
      reportsSubmitted: 0,
      reportsAccepted: 0,
      reportsRejected: 0,
      lastReportTime: 0,
      lastHeartbeat: 0,
      feedPrices: new Map(),
      uptime: 0,
    }
  }

  async start(): Promise<void> {
    if (this.running) return

    console.log('[OracleNode] Starting...')

    // Check if operator is registered
    await this.ensureRegistered()

    this.running = true

    // Start price polling
    await this.pollAndSubmit()
    this.pollInterval = setInterval(
      () => this.pollAndSubmit(),
      this.config.pollIntervalMs,
    )

    // Start heartbeat
    this.heartbeatInterval = setInterval(
      () => this.sendHeartbeat(),
      this.config.heartbeatIntervalMs,
    )

    console.log('[OracleNode] Started successfully')
  }

  async stop(): Promise<void> {
    this.running = false
    if (this.pollInterval) clearInterval(this.pollInterval)
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval)
    console.log('[OracleNode] Stopped')
  }

  private async ensureRegistered(): Promise<void> {
    const workerAddress = this.account.address

    const existingOperatorId = await this.publicClient.readContract({
      address: this.config.networkConnector,
      abi: NETWORK_CONNECTOR_ABI,
      functionName: 'workerToOperator',
      args: [workerAddress],
    })

    if (existingOperatorId !== ZERO_BYTES32) {
      this.operatorId = existingOperatorId
      console.log(`[OracleNode] Registered as operator: ${this.operatorId}`)
      return
    }

    console.log('[OracleNode] Registering new operator...')
    const operatorAccount = privateKeyToAccount(this.config.operatorPrivateKey)
    const chain = this.getChain(this.config.chainId)
    const operatorClient = createWalletClient({
      account: operatorAccount,
      chain,
      transport: http(this.config.rpcUrl),
    })

    const hash = await operatorClient.writeContract({
      address: this.config.networkConnector,
      abi: NETWORK_CONNECTOR_ABI,
      functionName: 'registerOperator',
      args: [ZERO_BYTES32, 0n, workerAddress],
      chain: null,
      account: null,
    })

    await this.publicClient.waitForTransactionReceipt({ hash })

    this.operatorId = await this.publicClient.readContract({
      address: this.config.networkConnector,
      abi: NETWORK_CONNECTOR_ABI,
      functionName: 'workerToOperator',
      args: [workerAddress],
    })
    console.log(`[OracleNode] Operator ID: ${this.operatorId}`)
  }

  private async pollAndSubmit(): Promise<void> {
    if (!this.running) return

    console.log('[OracleNode] Polling prices...')

    // Get active feeds
    const feedIds = await this.publicClient.readContract({
      address: this.config.feedRegistry,
      abi: FEED_REGISTRY_ABI,
      functionName: 'getActiveFeeds',
    })

    // Fetch prices for all feeds we have sources for
    const prices = await this.priceFetcher.fetchAllPrices()

    // Submit reports for each feed
    for (const feedId of feedIds) {
      const priceData = prices.get(feedId as Hex)
      if (!priceData) continue

      // Check if we're a committee member for this feed
      const isMember = await this.isCommitteeMember(feedId as Hex)
      if (!isMember) {
        console.log(
          `[OracleNode] Not a committee member for ${feedId}, skipping`,
        )
        continue
      }

      await this.submitReport(feedId as Hex, priceData)
    }
  }

  private async isCommitteeMember(feedId: Hex): Promise<boolean> {
    const workerAddress = this.account.address

    return this.publicClient.readContract({
      address: this.config.committeeManager,
      abi: COMMITTEE_MANAGER_ABI,
      functionName: 'isCommitteeMember',
      args: [feedId, workerAddress],
    })
  }

  private async submitReport(feedId: Hex, priceData: PriceData): Promise<void> {
    // Get current round
    const currentRound = await this.publicClient.readContract({
      address: this.config.reportVerifier,
      abi: REPORT_VERIFIER_ABI,
      functionName: 'getCurrentRound',
      args: [feedId],
    })

    const newRound = currentRound + 1n

    // Build report
    const report: PriceReport = {
      feedId,
      price: priceData.price,
      confidence: priceData.confidence,
      timestamp: priceData.timestamp,
      round: newRound,
      sourcesHash: this.priceFetcher.computeSourcesHash([priceData.source]),
    }

    // Sign the report
    const reportHash = this.computeReportHash(report)
    const signature = await this.signReport(reportHash)

    // Submit
    console.log(
      `[OracleNode] Submitting report for ${feedId}: price=${report.price}, round=${report.round}`,
    )

    this.metrics.reportsSubmitted++

    const hash = await this.walletClient.writeContract({
      address: this.config.reportVerifier,
      abi: REPORT_VERIFIER_ABI,
      functionName: 'submitReport',
      args: [
        {
          report: {
            feedId: report.feedId,
            price: report.price,
            confidence: report.confidence,
            timestamp: report.timestamp,
            round: report.round,
            sourcesHash: report.sourcesHash,
          },
          signatures: [signature],
        },
      ],
      chain: null,
      account: null,
    })

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash })

    if (receipt.status === 'success') {
      console.log(`[OracleNode] Report accepted for ${feedId}`)
      this.metrics.reportsAccepted++
      this.metrics.lastReportTime = Date.now()
      this.metrics.feedPrices.set(feedId, priceData.price)
    } else {
      console.log(`[OracleNode] Report rejected for ${feedId}`)
      this.metrics.reportsRejected++
    }
  }

  private computeReportHash(report: PriceReport): Hex {
    return keccak256(
      encodePacked(
        ['bytes32', 'uint256', 'uint256', 'uint256', 'uint256', 'bytes32'],
        [
          report.feedId,
          report.price,
          report.confidence,
          report.timestamp,
          report.round,
          report.sourcesHash,
        ],
      ),
    )
  }

  private async signReport(reportHash: Hex): Promise<Hex> {
    return this.walletClient.signMessage({
      account: this.account,
      message: { raw: toBytes(reportHash) },
    })
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.running || !this.operatorId) return

    console.log('[OracleNode] Sending heartbeat...')

    const hash = await this.walletClient.writeContract({
      address: this.config.networkConnector,
      abi: NETWORK_CONNECTOR_ABI,
      functionName: 'recordHeartbeat',
      args: [this.operatorId],
      chain: null,
      account: null,
    })

    await this.publicClient.waitForTransactionReceipt({ hash })
    this.metrics.lastHeartbeat = Date.now()
    console.log('[OracleNode] Heartbeat sent')
  }

  getMetrics(): NodeMetrics {
    this.metrics.uptime = Date.now() - this.startTime
    return { ...this.metrics }
  }

  getOperatorId(): Hex | null {
    return this.operatorId
  }

  private getChain(chainId: number): Chain {
    switch (chainId) {
      case 8453:
        return base
      case 84532:
        return baseSepolia
      case 1337:
      case 31337:
        return foundry
      default:
        // Create a custom chain for unknown chain IDs
        return defineChain({
          id: chainId,
          name: `Chain ${chainId}`,
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: { default: { http: [this.config.rpcUrl] } },
        })
    }
  }
}

// Default config from environment
export function createNodeConfig(): OracleNodeConfig {
  const zeroAddress = '0x0000000000000000000000000000000000000000' as Address

  return {
    rpcUrl: process.env.RPC_URL || 'http://localhost:9545',
    chainId: parseInt(process.env.CHAIN_ID || '1337', 10),
    operatorPrivateKey: (process.env.OPERATOR_PRIVATE_KEY ||
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as Hex,
    workerPrivateKey: (process.env.WORKER_PRIVATE_KEY ||
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d') as Hex,

    feedRegistry: (process.env.FEED_REGISTRY_ADDRESS || zeroAddress) as Address,
    reportVerifier: (process.env.REPORT_VERIFIER_ADDRESS ||
      zeroAddress) as Address,
    committeeManager: (process.env.COMMITTEE_MANAGER_ADDRESS ||
      zeroAddress) as Address,
    feeRouter: (process.env.FEE_ROUTER_ADDRESS || zeroAddress) as Address,
    networkConnector: (process.env.NETWORK_CONNECTOR_ADDRESS ||
      zeroAddress) as Address,

    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '60000', 10),
    heartbeatIntervalMs: parseInt(
      process.env.HEARTBEAT_INTERVAL_MS || '300000',
      10,
    ),
    metricsPort: parseInt(process.env.METRICS_PORT || '9090', 10),

    priceSources: [],
  }
}
