import {
  getChainId,
  getContract,
  getCurrentNetwork,
  getRpcUrl,
  isProductionEnv,
} from '@jejunetwork/config'
import {
  COMMITTEE_MANAGER_ABI,
  FEED_REGISTRY_ABI,
  NETWORK_CONNECTOR_ABI,
  REPORT_VERIFIER_ABI,
} from '@jejunetwork/shared'
import type {
  NodeMetrics,
  OracleNodeConfig,
  PriceReport,
} from '@jejunetwork/types'
import {
  type Account,
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  defineChain,
  encodePacked,
  type Hex,
  http,
  keccak256,
  toBytes,
  type WalletClient,
} from 'viem'
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia, foundry } from 'viem/chains'
import {
  createKMSWalletClient,
  isKMSAvailable,
  type KMSWalletClient,
} from '../shared/kms-wallet'
import { type PriceData, PriceFetcher } from './price-fetcher'

const ZERO_BYTES32 =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as const

export class OracleNode {
  private config: OracleNodeConfig
  private account: PrivateKeyAccount | Account
  private publicClient
  private walletClient: WalletClient | KMSWalletClient
  private kmsWallet: KMSWalletClient | null = null
  private priceFetcher: PriceFetcher
  private operatorId: Hex | null = null
  private running = false
  private pollInterval?: Timer
  private heartbeatInterval?: Timer
  private metrics: NodeMetrics
  private startTime: number
  private initialized = false

  constructor(config: OracleNodeConfig) {
    this.config = config
    this.startTime = Date.now()

    const chain = this.getChain(config.chainId)

    this.publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    })

    // Initialize wallet based on key type (direct or KMS)
    if (config.workerPrivateKey) {
      this.account = privateKeyToAccount(config.workerPrivateKey)
      this.walletClient = createWalletClient({
        account: this.account,
        chain,
        transport: http(config.rpcUrl),
      })
    } else if (config.workerKmsKeyId) {
      // KMS mode - account will be set up via KMS in start()
      throw new Error(
        'KMS key support requires async initialization. Use OracleNode.create() instead.',
      )
    } else {
      throw new Error('Oracle node requires workerPrivateKey or workerKmsKeyId')
    }

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

    // Initialize KMS-backed signing if available (side-channel protection)
    await this.initializeSecureSigning()

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

    if (!this.config.operatorPrivateKey) {
      if (this.config.operatorKmsKeyId) {
        throw new Error(
          'Operator registration with KMS not yet implemented. ' +
          'Use direct key or register operator manually.',
        )
      }
      throw new Error('Operator private key not configured')
    }

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
      const priceData = prices.get(feedId)
      if (!priceData) continue

      // Check if we're a committee member for this feed
      const isMember = await this.isCommitteeMember(feedId)
      if (!isMember) {
        console.log(
          `[OracleNode] Not a committee member for ${feedId}, skipping`,
        )
        continue
      }

      await this.submitReport(feedId, priceData)
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
    const sourcesHash = this.priceFetcher.computeSourcesHash([priceData.source])
    const report: PriceReport = {
      feedId,
      price: priceData.price,
      confidence: priceData.confidence,
      timestamp: priceData.timestamp,
      round: newRound,
      sourcesHash,
      sources: [],
      signatures: [],
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
            sourcesHash,
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
          report.sourcesHash ?? ZERO_BYTES32,
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

  /**
   * Initialize KMS-backed signing for side-channel protection
   *
   * In production, this ensures private keys are never held in TEE memory.
   * Signing is performed via FROST threshold cryptography through the KMS.
   */
  private async initializeSecureSigning(): Promise<void> {
    if (this.initialized) return

    const isProduction = isProductionEnv()
    const kmsKeyId =
      typeof process !== 'undefined' ? process.env.ORACLE_KMS_KEY_ID : undefined
    const ownerAddress = (
      typeof process !== 'undefined'
        ? process.env.ORACLE_OWNER_ADDRESS
        : undefined
    ) as Address | undefined

    // Check if KMS is available and configured
    if (kmsKeyId && ownerAddress) {
      const kmsAvailable = await isKMSAvailable()

      if (kmsAvailable) {
        try {
          const chain = this.getChain(this.config.chainId)
          this.kmsWallet = await createKMSWalletClient({
            chain,
            rpcUrl: this.config.rpcUrl,
            kmsKeyId,
            ownerAddress,
          })
          this.account = this.kmsWallet.account
          this.walletClient = this.kmsWallet as unknown as WalletClient
          console.log(
            '[OracleNode] Using KMS-backed signing (FROST threshold cryptography)',
          )
        } catch (err) {
          console.error('[OracleNode] Failed to initialize KMS:', err)
          if (isProduction) {
            throw new Error(
              'KMS initialization failed in production - cannot use insecure direct keys',
            )
          }
        }
      } else if (isProduction) {
        throw new Error(
          'KMS not available in production - set ORACLE_KMS_KEY_ID and ensure KMS is running',
        )
      }
    } else if (isProduction) {
      console.error(
        '[OracleNode] CRITICAL: Using direct private key in production. ' +
          'Set ORACLE_KMS_KEY_ID and ORACLE_OWNER_ADDRESS for side-channel protection.',
      )
      // In strict mode, uncomment to enforce KMS:
      // throw new Error('KMS required in production')
    } else {
      console.warn(
        '[OracleNode] Using direct private key (development mode). ' +
          'Set ORACLE_KMS_KEY_ID for KMS-backed signing.',
      )
    }

    this.initialized = true
  }

  private getChain(chainId: number): Chain {
    switch (chainId) {
      case 8453:
        return base
      case 84532:
        return baseSepolia
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
  const isProduction = isProductionEnv()
  const network = getCurrentNetwork()

  // SECURITY: In production, require KMS. Direct private keys are BLOCKED.
  const operatorKmsKeyId = process.env.ORACLE_OPERATOR_KMS_KEY_ID
  const workerKmsKeyId = process.env.ORACLE_WORKER_KMS_KEY_ID
  const operatorKey = process.env.OPERATOR_PRIVATE_KEY
  const workerKey = process.env.WORKER_PRIVATE_KEY

  if (isProduction) {
    if (operatorKey || workerKey) {
      console.error(
        '[Oracle] SECURITY ERROR: Direct private keys (OPERATOR_PRIVATE_KEY, WORKER_PRIVATE_KEY) ' +
        'detected in production. Use KMS key IDs instead.',
      )
    }
    if (!operatorKmsKeyId || !workerKmsKeyId) {
      throw new Error(
        'SECURITY: ORACLE_OPERATOR_KMS_KEY_ID and ORACLE_WORKER_KMS_KEY_ID required in production. ' +
        'Direct private keys are not allowed.',
      )
    }
    console.log('[Oracle] Using KMS-backed signing (production)')
  } else if (!operatorKey || !workerKey) {
    console.warn(
      '[Oracle] WARNING: Using dev-only test keys. Set OPERATOR_PRIVATE_KEY and WORKER_PRIVATE_KEY for development.',
    )
  } else {
    console.warn(
      '[Oracle] WARNING: Using direct private keys for development. Use KMS in production.',
    )
  }

  // Anvil test keys - ONLY for local development
  const DEV_OPERATOR_KEY =
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex
  const DEV_WORKER_KEY =
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex

  return {
    rpcUrl: getRpcUrl(network),
    chainId: getChainId(network),
    operatorPrivateKey: isProduction ? undefined : (operatorKey ?? DEV_OPERATOR_KEY) as Hex,
    workerPrivateKey: isProduction ? undefined : (workerKey ?? DEV_WORKER_KEY) as Hex,
    operatorKmsKeyId,
    workerKmsKeyId,

    feedRegistry: ((typeof process !== 'undefined'
      ? process.env.FEED_REGISTRY_ADDRESS
      : undefined) ||
      getContract('oracle', 'feedRegistry', network) ||
      zeroAddress) as Address,
    reportVerifier: ((typeof process !== 'undefined'
      ? process.env.REPORT_VERIFIER_ADDRESS
      : undefined) ||
      getContract('oracle', 'reportVerifier', network) ||
      zeroAddress) as Address,
    committeeManager: ((typeof process !== 'undefined'
      ? process.env.COMMITTEE_MANAGER_ADDRESS
      : undefined) || zeroAddress) as Address,
    feeRouter: ((typeof process !== 'undefined'
      ? process.env.FEE_ROUTER_ADDRESS
      : undefined) || zeroAddress) as Address,
    networkConnector: ((typeof process !== 'undefined'
      ? process.env.NETWORK_CONNECTOR_ADDRESS
      : undefined) || zeroAddress) as Address,

    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '60000', 10),
    heartbeatIntervalMs: parseInt(
      process.env.HEARTBEAT_INTERVAL_MS || '300000',
      10,
    ),
    metricsPort: parseInt(process.env.METRICS_PORT || '9090', 10),

    priceSources: [],
  }
}
