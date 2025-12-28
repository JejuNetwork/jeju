import {
  type Address,
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { getChain } from '../shared/chains.js'
import {
  createKMSWalletClient,
  isKMSAvailable,
  type KMSWalletClient,
} from '../shared/kms-wallet'
import {
  ERC20_APPROVE_ABI,
  INPUT_SETTLER_ABI,
  INPUT_SETTLERS,
  isNativeToken,
  ORACLE_ABI,
  ORACLES,
  OUTPUT_SETTLER_ABI,
  OUTPUT_SETTLERS,
} from './contracts'
import {
  type ExternalOpportunity,
  ExternalProtocolAggregator,
} from './external'
import type { LiquidityManager } from './liquidity'
import {
  recordIntentEvaluated,
  recordIntentFilled,
  recordIntentReceived,
  recordIntentSkipped,
  recordSettlementClaimed,
  recordSettlementFailed,
  updatePendingSettlements,
} from './metrics'
import type { EventMonitor, IntentEvent } from './monitor'
import type { StrategyEngine } from './strategy'

interface SolverConfig {
  chains: Array<{ chainId: number; name: string; rpcUrl: string }>
  minProfitBps: number
  maxGasPrice: bigint
  maxIntentSize: string
  enableExternalProtocols?: boolean
  isTestnet?: boolean
}

interface PendingSettlement {
  orderId: string
  sourceChain: number
  destChain: number
  inputAmount: bigint
  fillTxHash: string
  filledAt: number
  retryCount: number
  nextRetryAt: number
}

const MAX_SETTLEMENT_RETRIES = 5
const SETTLEMENT_CHECK_INTERVAL_MS = 30_000
const SETTLEMENT_STALE_MS = 24 * 60 * 60 * 1000 // 24 hours
const BASE_RETRY_DELAY_MS = 30_000 // 30 seconds, doubles each retry

export class SolverAgent {
  private config: SolverConfig
  private liquidity: LiquidityManager
  private strategy: StrategyEngine
  private monitor: EventMonitor
  private externalAggregator: ExternalProtocolAggregator | null = null
  private clients = new Map<
    number,
    { public: PublicClient; wallet?: WalletClient }
  >()
  private pending = new Map<string, Promise<void>>()
  private pendingSettlements = new Map<string, PendingSettlement>()
  private settlementTimer: ReturnType<typeof setInterval> | null = null
  private externalProcessingTimer: ReturnType<typeof setInterval> | null = null
  private running = false

  constructor(
    config: SolverConfig,
    liquidity: LiquidityManager,
    strategy: StrategyEngine,
    monitor: EventMonitor,
  ) {
    this.config = config
    this.liquidity = liquidity
    this.strategy = strategy
    this.monitor = monitor
  }

  async start(): Promise<void> {
    console.log('📡 Connecting to chains...')
    const pk = process.env.SOLVER_PRIVATE_KEY
    const kmsKeyId = process.env.SOLVER_KMS_KEY_ID
    const ownerAddress = process.env.SOLVER_OWNER_ADDRESS as Address | undefined
    const isProduction = process.env.NODE_ENV === 'production'

    // Determine if we should use KMS
    let useKMS = false
    if (kmsKeyId && ownerAddress) {
      const kmsAvailable = await isKMSAvailable()
      if (kmsAvailable) {
        useKMS = true
        console.log(
          '[Solver] Using KMS-backed signing (FROST threshold cryptography)',
        )
      } else if (isProduction) {
        throw new Error(
          'KMS not available in production - set SOLVER_KMS_KEY_ID and ensure KMS is running',
        )
      }
    } else if (isProduction && pk) {
      console.error(
        '[Solver] CRITICAL: Using direct SOLVER_PRIVATE_KEY in production. ' +
          'Set SOLVER_KMS_KEY_ID and SOLVER_OWNER_ADDRESS for side-channel protection.',
      )
    }

    for (const chain of this.config.chains) {
      const maybeChainDef = getChain(chain.chainId)
      if (!maybeChainDef) {
        throw new Error(
          `Chain definition not found for chainId: ${chain.chainId}`,
        )
      }
      const chainDef = maybeChainDef

      const pub = createPublicClient({
        chain: chainDef,
        transport: http(chain.rpcUrl),
      })

      let wallet: WalletClient | KMSWalletClient | undefined

      if (useKMS && kmsKeyId && ownerAddress) {
        // Use KMS-backed wallet (side-channel protected)
        wallet = await createKMSWalletClient({
          chain: chainDef,
          rpcUrl: chain.rpcUrl,
          kmsKeyId,
          ownerAddress,
        })
      } else if (pk) {
        // Fallback to direct key (development only)
        wallet = createWalletClient({
          account: privateKeyToAccount(pk as `0x${string}`),
          chain: chainDef,
          transport: http(chain.rpcUrl),
        })
      }

      this.clients.set(chain.chainId, {
        public: pub,
        wallet: wallet as WalletClient | undefined,
      })
      console.log(`   ✓ ${chain.name}`)
    }

    await this.liquidity.initialize(this.clients)
    this.monitor.on('intent', (data: unknown) => {
      const e = data as IntentEvent
      this.handleIntent(e)
    })
    await this.monitor.start(this.clients)
    this.startSettlementWatcher()

    // Initialize external protocol aggregator for permissionless revenue (no API keys needed)
    if (this.config.enableExternalProtocols !== false) {
      this.externalAggregator = new ExternalProtocolAggregator(
        {
          chains: this.config.chains,
          minProfitBps: this.config.minProfitBps,
          isTestnet: this.config.isTestnet,
          enableAcross: true,
          enableUniswapX: true,
          enableCow: true,
        },
        this.clients,
      )

      this.externalAggregator.on('opportunity', (data: unknown) => {
        const opp = data as ExternalOpportunity
        this.handleExternalOpportunity(opp)
      })

      await this.externalAggregator.start()
      this.startExternalProcessing()
    }

    this.running = true
  }

  async stop(): Promise<void> {
    this.running = false
    if (this.settlementTimer) {
      clearInterval(this.settlementTimer)
      this.settlementTimer = null
    }
    if (this.externalProcessingTimer) {
      clearInterval(this.externalProcessingTimer)
      this.externalProcessingTimer = null
    }
    await this.monitor.stop()
    await this.externalAggregator?.stop()
    await Promise.all(this.pending.values())
  }

  private startExternalProcessing(): void {
    // Process external opportunities every 2 seconds
    this.externalProcessingTimer = setInterval(
      () => this.processExternalOpportunities(),
      2000,
    )
  }

  private async processExternalOpportunities(): Promise<void> {
    if (!this.externalAggregator) return

    const opportunities = this.externalAggregator.getOpportunities(
      this.config.minProfitBps,
    )

    // Process top 3 opportunities per cycle
    for (const opp of opportunities.slice(0, 3)) {
      if (this.pending.has(opp.id)) continue

      const promise = this.fillExternalOpportunity(opp)
      this.pending.set(opp.id, promise)
      await promise
      this.pending.delete(opp.id)
    }
  }

  private async handleExternalOpportunity(
    opp: ExternalOpportunity,
  ): Promise<void> {
    console.log(
      `\n💰 External ${opp.type}: ${opp.id.slice(0, 20)}... | ${opp.expectedProfitBps} bps`,
    )
  }

  private async fillExternalOpportunity(
    opp: ExternalOpportunity,
  ): Promise<void> {
    // Check liquidity
    const destChain = opp.destinationChainId ?? opp.chainId
    if (
      !(await this.liquidity.hasLiquidity(
        destChain,
        opp.outputToken,
        opp.outputAmount.toString(),
      ))
    ) {
      console.log(`[Agent] Insufficient liquidity for ${opp.type} opportunity`)
      return
    }

    // Check gas price
    const client = this.clients.get(destChain)
    if (client) {
      const gasPrice = await client.public.getGasPrice()
      if (gasPrice > this.config.maxGasPrice) {
        console.log(`[Agent] Gas too high for ${opp.type} opportunity`)
        return
      }
    }

    console.log(
      `[Agent] Filling ${opp.type} opportunity: ${opp.id.slice(0, 20)}...`,
    )

    if (!this.externalAggregator) {
      console.log(`[Agent] External aggregator not initialized`)
      return
    }

    const result = await this.externalAggregator.fill(opp)

    if (result.success) {
      console.log(`[Agent] ${opp.type} fill success: ${result.txHash}`)
      await this.liquidity.recordFill(
        destChain,
        opp.outputToken,
        opp.outputAmount.toString(),
      )
      recordIntentFilled(opp.chainId, destChain, 0, 0n)
    } else {
      console.log(`[Agent] ${opp.type} fill failed: ${result.error}`)
    }
  }

  private startSettlementWatcher(): void {
    this.settlementTimer = setInterval(
      () => this.checkPendingSettlements(),
      SETTLEMENT_CHECK_INTERVAL_MS,
    )
  }

  private async checkPendingSettlements(): Promise<void> {
    updatePendingSettlements(this.pendingSettlements.size)
    const now = Date.now()

    // Snapshot entries to avoid mutation during iteration
    const entries = Array.from(this.pendingSettlements.entries())

    for (const [orderId, settlement] of entries) {
      // Clean up stale entries (older than 24 hours)
      if (now - settlement.filledAt > SETTLEMENT_STALE_MS) {
        this.pendingSettlements.delete(orderId)
        recordSettlementFailed(settlement.sourceChain, 'stale')
        console.log(
          `[Agent] Removed stale settlement: ${orderId.slice(0, 10)}...`,
        )
        continue
      }

      // Skip if not yet time for retry (exponential backoff)
      if (now < settlement.nextRetryAt) {
        continue
      }

      const result = await this.trySettle(settlement)
      if (result.settled) {
        this.pendingSettlements.delete(orderId)
        recordSettlementClaimed(settlement.sourceChain, settlement.inputAmount)
        console.log(`[Agent] Settlement claimed: ${orderId.slice(0, 10)}...`)
      } else if (result.retry) {
        settlement.retryCount++
        if (settlement.retryCount >= MAX_SETTLEMENT_RETRIES) {
          this.pendingSettlements.delete(orderId)
          recordSettlementFailed(settlement.sourceChain, 'max_retries')
          console.log(
            `[Agent] Settlement failed after ${MAX_SETTLEMENT_RETRIES} retries: ${orderId.slice(0, 10)}...`,
          )
        } else {
          // Exponential backoff: 30s, 60s, 120s, 240s, 480s
          const backoffMs = BASE_RETRY_DELAY_MS * 2 ** settlement.retryCount
          settlement.nextRetryAt = now + backoffMs
          console.log(
            `[Agent] Will retry in ${backoffMs / 1000}s: ${orderId.slice(0, 10)}...`,
          )
        }
      } else {
        this.pendingSettlements.delete(orderId)
        recordSettlementFailed(
          settlement.sourceChain,
          result.reason ?? 'unknown',
        )
        console.log(`[Agent] Settlement failed: ${result.reason}`)
      }
    }

    updatePendingSettlements(this.pendingSettlements.size)
  }

  private async trySettle(
    settlement: PendingSettlement,
  ): Promise<{ settled: boolean; retry: boolean; reason?: string }> {
    const client = this.clients.get(settlement.sourceChain)
    if (!client?.wallet)
      return {
        settled: false,
        retry: false,
        reason: 'No wallet for source chain',
      }

    const inputSettler = INPUT_SETTLERS[settlement.sourceChain]
    if (!inputSettler)
      return {
        settled: false,
        retry: false,
        reason: 'No InputSettler on source chain',
      }

    // Check oracle attestation if oracle is configured for this chain
    const oracleAddr =
      ORACLES[settlement.sourceChain] ||
      (process.env[`OIF_ORACLE_${settlement.sourceChain}`] as
        | `0x${string}`
        | undefined)
    if (oracleAddr) {
      const attested = await client.public
        .readContract({
          address: oracleAddr,
          abi: ORACLE_ABI,
          functionName: 'hasAttested',
          args: [settlement.orderId as `0x${string}`],
        })
        .catch((err: Error) => {
          console.warn(
            `Oracle check failed for ${settlement.sourceChain}: ${err.message}`,
          )
          return false
        })

      if (!attested) {
        return {
          settled: false,
          retry: true,
          reason: 'Awaiting oracle attestation',
        }
      }
    } else {
      // No oracle configured - log warning but proceed (some chains may use different attestation)
      console.warn(
        `No oracle configured for chain ${settlement.sourceChain}, proceeding without attestation check`,
      )
    }

    // First check if settlement is possible (canSettle)
    const canSettle = await client.public.readContract({
      address: inputSettler,
      abi: INPUT_SETTLER_ABI,
      functionName: 'canSettle',
      args: [settlement.orderId as `0x${string}`],
    })

    if (!canSettle) {
      return {
        settled: false,
        retry: true,
        reason: 'Cannot settle yet (canSettle=false)',
      }
    }

    const chain = getChain(settlement.sourceChain)
    const account = client.wallet.account
    if (!account)
      return { settled: false, retry: false, reason: 'No account configured' }

    const settleTx = await client.wallet
      .writeContract({
        chain,
        account,
        address: inputSettler,
        abi: INPUT_SETTLER_ABI,
        functionName: 'settle',
        args: [settlement.orderId as `0x${string}`],
      })
      .catch((err: Error): null => {
        console.warn(`Settlement tx failed: ${err.message}`)
        return null
      })

    if (!settleTx)
      return { settled: false, retry: true, reason: 'Transaction failed' }

    const receipt = await client.public.waitForTransactionReceipt({
      hash: settleTx,
    })
    if (receipt.status === 'reverted') {
      return { settled: false, retry: true, reason: 'Transaction reverted' }
    }

    return { settled: true, retry: false }
  }

  isRunning(): boolean {
    return this.running
  }

  private async handleIntent(e: IntentEvent): Promise<void> {
    if (this.pending.has(e.orderId)) {
      console.log(`   ⏭️ Already processing ${e.orderId.slice(0, 10)}...`)
      return
    }
    const promise = this.processIntent(e)
    this.pending.set(e.orderId, promise)
    await promise
    this.pending.delete(e.orderId)
  }

  private async processIntent(e: IntentEvent): Promise<void> {
    recordIntentReceived(e.sourceChain)
    console.log(
      `\n[Agent] Intent ${e.orderId.slice(0, 10)}... | ${e.sourceChain} -> ${e.destinationChain}`,
    )

    const client = this.clients.get(e.destinationChain)
    const settler =
      OUTPUT_SETTLERS[e.destinationChain] ||
      (process.env[`OIF_OUTPUT_SETTLER_${e.destinationChain}`] as `0x${string}`)

    if (client && settler) {
      const filled = await client.public.readContract({
        address: settler,
        abi: OUTPUT_SETTLER_ABI,
        functionName: 'isFilled',
        args: [e.orderId as `0x${string}`],
      })
      if (filled) {
        console.log('   ⏭️ Already filled on-chain')
        recordIntentSkipped(e.sourceChain, 'already_filled')
        return
      }
    }

    const result = await this.strategy.evaluate({
      orderId: e.orderId,
      sourceChain: e.sourceChain,
      destinationChain: e.destinationChain,
      inputToken: e.inputToken,
      inputAmount: e.inputAmount,
      outputToken: e.outputToken,
      outputAmount: e.outputAmount,
    })

    recordIntentEvaluated(e.sourceChain, result.profitable)

    if (!result.profitable) {
      console.log(`[Agent] ${result.reason}`)
      recordIntentSkipped(e.sourceChain, result.reason ?? 'unprofitable')
      return
    }
    console.log(`[Agent] Profitable: ${result.expectedProfitBps} bps`)

    if (
      !(await this.liquidity.hasLiquidity(
        e.destinationChain,
        e.outputToken,
        e.outputAmount,
      ))
    ) {
      console.log('[Agent] Insufficient liquidity')
      recordIntentSkipped(e.sourceChain, 'insufficient_liquidity')
      return
    }

    const fillStart = Date.now()
    const fill = await this.fill(e)
    const fillDurationMs = Date.now() - fillStart

    if (fill.success && fill.txHash) {
      recordIntentFilled(
        e.sourceChain,
        e.destinationChain,
        fillDurationMs,
        fill.gasUsed ?? 0n,
      )
      console.log(`[Agent] Filled: ${fill.txHash}`)
      const now = Date.now()
      this.pendingSettlements.set(e.orderId, {
        orderId: e.orderId,
        sourceChain: e.sourceChain,
        destChain: e.destinationChain,
        inputAmount: BigInt(e.inputAmount),
        fillTxHash: fill.txHash,
        filledAt: now,
        retryCount: 0,
        nextRetryAt: now + BASE_RETRY_DELAY_MS, // First retry after 30s
      })
      updatePendingSettlements(this.pendingSettlements.size)
    } else {
      recordIntentSkipped(e.destinationChain, fill.error ?? 'fill_failed')
      console.log(`[Agent] ${fill.error}`)
    }
  }

  private async fill(e: IntentEvent): Promise<{
    success: boolean
    txHash?: string
    gasUsed?: bigint
    error?: string
  }> {
    const client = this.clients.get(e.destinationChain)
    if (!client?.wallet) return { success: false, error: 'No wallet' }

    const settler =
      OUTPUT_SETTLERS[e.destinationChain] ||
      (process.env[`OIF_OUTPUT_SETTLER_${e.destinationChain}`] as `0x${string}`)
    if (!settler) return { success: false, error: 'No OutputSettler' }

    const gasPrice = await client.public.getGasPrice()
    if (gasPrice > this.config.maxGasPrice)
      return { success: false, error: 'Gas too high' }

    const amount = BigInt(e.outputAmount)
    const chain = getChain(e.destinationChain)
    const native = isNativeToken(e.outputToken)

    const account = client.wallet.account
    if (!account) return { success: false, error: 'No account configured' }

    if (!native) {
      const approveTx = await client.wallet.writeContract({
        chain,
        account,
        address: e.outputToken as `0x${string}`,
        abi: ERC20_APPROVE_ABI,
        functionName: 'approve',
        args: [settler, amount],
      })
      await client.public.waitForTransactionReceipt({ hash: approveTx })
    }

    const fillTx = await client.wallet.writeContract({
      chain,
      account,
      address: settler,
      abi: OUTPUT_SETTLER_ABI,
      functionName: 'fillDirect',
      args: [
        e.orderId as `0x${string}`,
        e.outputToken as `0x${string}`,
        amount,
        e.recipient as `0x${string}`,
      ],
      value: native ? amount : 0n,
    })

    const receipt = await client.public.waitForTransactionReceipt({
      hash: fillTx,
    })
    if (receipt.status === 'reverted')
      return { success: false, error: 'Reverted' }

    await this.liquidity.recordFill(
      e.destinationChain,
      e.outputToken,
      e.outputAmount,
    )
    return { success: true, txHash: fillTx, gasUsed: receipt.gasUsed }
  }
}
