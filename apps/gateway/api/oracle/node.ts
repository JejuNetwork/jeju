/**
 * Oracle Node
 *
 * SECURITY: This module uses KMS for all signing operations.
 * Private keys are NEVER loaded into memory. All cryptographic
 * operations are delegated to the KMS service (MPC or TEE).
 */

import { getChainId, getRpcUrl } from '@jejunetwork/config'
import {
  COMMITTEE_MANAGER_ABI,
  FEED_REGISTRY_ABI,
  NETWORK_CONNECTOR_ABI,
  REPORT_VERIFIER_ABI,
  readContract,
} from '@jejunetwork/shared'
import type { NodeMetrics, OracleNodeConfig } from '@jejunetwork/types'
import { parseEnvAddress, ZERO_ADDRESS } from '@jejunetwork/types'
import {
  type Address,
  type Chain,
  createPublicClient,
  defineChain,
  encodeFunctionData,
  encodePacked,
  type Hex,
  http,
  isHex,
  keccak256,
  toBytes,
} from 'viem'
import { base, baseSepolia, foundry } from 'viem/chains'
import { getKMSSigner, type KMSSigner } from '../../lib/kms-signer'
import { type PriceData, PriceFetcher } from './price-fetcher'
import type { PriceReport } from './types'

const ZERO_BYTES32 =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as const

/**
 * Secure Oracle Node Config
 *
 * SECURITY: No private keys in config. Uses KMS service IDs instead.
 */
export interface SecureOracleNodeConfig {
  rpcUrl: string
  chainId: number
  /** KMS service ID for operator signing (registration) */
  operatorServiceId: string
  /** KMS service ID for worker signing (reports, heartbeats) */
  workerServiceId: string
  feedRegistry: Address
  reportVerifier: Address
  committeeManager: Address
  feeRouter: Address
  networkConnector: Address
  pollIntervalMs: number
  heartbeatIntervalMs: number
  metricsPort: number
  priceSources: string[]
}

export class OracleNode {
  private config: SecureOracleNodeConfig
  private publicClient: ReturnType<typeof createPublicClient>
  private workerSigner: KMSSigner
  private operatorSigner: KMSSigner
  private workerAddress: Address | null = null
  private operatorAddress: Address | null = null
  private priceFetcher: PriceFetcher
  private operatorId: Hex | null = null
  private running = false
  private pollInterval?: Timer
  private heartbeatInterval?: Timer
  private metrics: NodeMetrics
  private startTime: number
  private chain: Chain

  constructor(config: SecureOracleNodeConfig) {
    this.config = config
    this.startTime = Date.now()

    this.chain = this.getChain(config.chainId)

    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(config.rpcUrl),
    })

    // SECURITY: Use KMS signers instead of private keys
    this.workerSigner = getKMSSigner(config.workerServiceId)
    this.operatorSigner = getKMSSigner(config.operatorServiceId)

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

    // Initialize KMS signers and get addresses
    await this.workerSigner.initialize()
    await this.operatorSigner.initialize()

    this.workerAddress = await this.workerSigner.getAddress()
    this.operatorAddress = await this.operatorSigner.getAddress()

    console.log(`[OracleNode] Worker address: ${this.workerAddress}`)
    console.log(`[OracleNode] Operator address: ${this.operatorAddress}`)
    console.log(`[OracleNode] Signing mode: ${this.workerSigner.getMode()}`)

    await this.ensureRegistered()

    this.running = true
    await this.pollAndSubmit()
    this.pollInterval = setInterval(
      () => this.pollAndSubmit(),
      this.config.pollIntervalMs,
    )
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
    if (!this.workerAddress) throw new Error('Worker address not initialized')

    const existingOperatorId = await readContract(this.publicClient, {
      address: this.config.networkConnector,
      abi: NETWORK_CONNECTOR_ABI,
      functionName: 'workerToOperator',
      args: [this.workerAddress],
    })

    if (existingOperatorId !== ZERO_BYTES32) {
      this.operatorId = existingOperatorId
      console.log(`[OracleNode] Registered as operator: ${this.operatorId}`)
      return
    }

    console.log('[OracleNode] Registering new operator...')

    // Build and sign the registration transaction via KMS
    const hash = await this.sendSignedTransaction(
      this.operatorSigner,
      this.config.networkConnector,
      encodeFunctionData({
        abi: NETWORK_CONNECTOR_ABI,
        functionName: 'registerOperator',
        args: [ZERO_BYTES32, 0n, this.workerAddress],
      }),
    )

    await this.publicClient.waitForTransactionReceipt({ hash })

    this.operatorId = await readContract(this.publicClient, {
      address: this.config.networkConnector,
      abi: NETWORK_CONNECTOR_ABI,
      functionName: 'workerToOperator',
      args: [this.workerAddress],
    })
    console.log(`[OracleNode] Operator ID: ${this.operatorId}`)
  }

  private async pollAndSubmit(): Promise<void> {
    if (!this.running) return

    console.log('[OracleNode] Polling prices...')

    const feedIds = await readContract(this.publicClient, {
      address: this.config.feedRegistry,
      abi: FEED_REGISTRY_ABI,
      functionName: 'getActiveFeeds',
    })

    const prices = await this.priceFetcher.fetchAllPrices()

    for (const feedId of feedIds) {
      if (!isHex(feedId)) continue
      const priceData = prices.get(feedId)
      if (!priceData) continue

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
    if (!this.workerAddress) throw new Error('Worker address not initialized')

    return readContract(this.publicClient, {
      address: this.config.committeeManager,
      abi: COMMITTEE_MANAGER_ABI,
      functionName: 'isCommitteeMember',
      args: [feedId, this.workerAddress],
    })
  }

  private async submitReport(feedId: Hex, priceData: PriceData): Promise<void> {
    const currentRound = await readContract(this.publicClient, {
      address: this.config.reportVerifier,
      abi: REPORT_VERIFIER_ABI,
      functionName: 'getCurrentRound',
      args: [feedId],
    })

    const newRound = currentRound + 1n

    const report: PriceReport = {
      feedId,
      price: priceData.price,
      confidence: priceData.confidence,
      timestamp: priceData.timestamp,
      round: newRound,
      sourcesHash: this.priceFetcher.computeSourcesHash([priceData.source]),
    }

    const reportHash = this.computeReportHash(report)

    // SECURITY: Sign report via KMS - private key never in memory
    const signature = await this.signReport(reportHash)

    console.log(
      `[OracleNode] Submitting report for ${feedId}: price=${report.price}, round=${report.round}`,
    )

    this.metrics.reportsSubmitted++

    // Build and sign the transaction via KMS
    const hash = await this.sendSignedTransaction(
      this.workerSigner,
      this.config.reportVerifier,
      encodeFunctionData({
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
      }),
    )

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

  /**
   * SECURITY: Sign report via KMS - private key never exposed
   */
  private async signReport(reportHash: Hex): Promise<Hex> {
    const result = await this.workerSigner.sign({
      messageHash: reportHash,
      metadata: { type: 'oracle-report' },
    })
    return result.signature
  }

  /**
   * SECURITY: Build, sign, and send transaction via KMS
   */
  private async sendSignedTransaction(
    signer: KMSSigner,
    to: Address,
    data: Hex,
  ): Promise<Hex> {
    const signerAddress = await signer.getAddress()

    // Get nonce and gas parameters
    const [nonce, gasPrice] = await Promise.all([
      this.publicClient.getTransactionCount({ address: signerAddress }),
      this.publicClient.getGasPrice(),
    ])

    // Estimate gas
    const gasLimit = await this.publicClient.estimateGas({
      account: signerAddress,
      to,
      data,
    })

    // Send transaction via KMS
    return signer.sendTransaction(
      {
        transaction: {
          to,
          data,
          nonce,
          gas: gasLimit,
          gasPrice,
          chainId: this.config.chainId,
        },
        chain: this.chain,
      },
      this.config.rpcUrl,
    )
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.running || !this.operatorId) return

    console.log('[OracleNode] Sending heartbeat...')

    const hash = await this.sendSignedTransaction(
      this.workerSigner,
      this.config.networkConnector,
      encodeFunctionData({
        abi: NETWORK_CONNECTOR_ABI,
        functionName: 'recordHeartbeat',
        args: [this.operatorId],
      }),
    )

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

  getWorkerAddress(): Address | null {
    return this.workerAddress
  }

  getOperatorAddress(): Address | null {
    return this.operatorAddress
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
        return defineChain({
          id: chainId,
          name: `Chain ${chainId}`,
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: { default: { http: [this.config.rpcUrl] } },
        })
    }
  }
}

/**
 * Create secure node config from environment.
 *
 * SECURITY: Uses KMS service IDs instead of private keys.
 * Private keys are managed by the KMS service (MPC or TEE).
 */
export function createNodeConfig(): SecureOracleNodeConfig {
  return {
    rpcUrl: getRpcUrl(),
    chainId: getChainId(),
    // SECURITY: Service IDs for KMS, not private keys
    operatorServiceId:
      process.env.ORACLE_OPERATOR_SERVICE_ID ?? 'oracle-operator',
    workerServiceId: process.env.ORACLE_WORKER_SERVICE_ID ?? 'oracle-worker',

    feedRegistry: parseEnvAddress(
      process.env.FEED_REGISTRY_ADDRESS,
      ZERO_ADDRESS,
    ),
    reportVerifier: parseEnvAddress(
      process.env.REPORT_VERIFIER_ADDRESS,
      ZERO_ADDRESS,
    ),
    committeeManager: parseEnvAddress(
      process.env.COMMITTEE_MANAGER_ADDRESS,
      ZERO_ADDRESS,
    ),
    feeRouter: parseEnvAddress(process.env.FEE_ROUTER_ADDRESS, ZERO_ADDRESS),
    networkConnector: parseEnvAddress(
      process.env.NETWORK_CONNECTOR_ADDRESS,
      ZERO_ADDRESS,
    ),

    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS ?? '60000', 10),
    heartbeatIntervalMs: parseInt(
      process.env.HEARTBEAT_INTERVAL_MS ?? '300000',
      10,
    ),
    metricsPort: parseInt(process.env.METRICS_PORT ?? '9090', 10),

    priceSources: [],
  }
}

/**
 * Legacy config type for backwards compatibility.
 * @deprecated Use SecureOracleNodeConfig with KMS service IDs
 */
export type OracleNodeConfig = SecureOracleNodeConfig
