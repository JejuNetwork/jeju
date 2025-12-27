import { ZERO_ADDRESS } from '@jejunetwork/types'
import { config as nodeConfig } from '../config'
import type { Address, Hex } from 'viem'
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  HyperliquidPricesResponseSchema,
  JitoBundleResponseSchema,
  JitoBundleStatusResponseSchema,
  JitoTipFloorResponseSchema,
  JupiterPriceResponseSchema,
} from '../../../lib/validation'

// Dynamic import: Lazy load to avoid native module issues with @solana/web3.js
type ArbitrageExecutorModule = typeof import('./arbitrage-executor')
let arbExecutorModule: ArbitrageExecutorModule | null = null
async function getArbitrageExecutorModule(): Promise<ArbitrageExecutorModule> {
  if (!arbExecutorModule) {
    arbExecutorModule = await import('./arbitrage-executor')
  }
  return arbExecutorModule
}

export interface BridgeServiceConfig {
  // Network configuration
  evmRpcUrls: Record<number, string>
  solanaRpcUrl?: string

  // Contract addresses
  contracts: {
    zkBridge?: Address
    eilPaymaster?: Address
    oifInputSettler?: Address
    oifOutputSettler?: Address
    solverRegistry?: Address
    federatedLiquidity?: Address
  }

  // Operator settings
  operatorAddress: Address
  privateKey?: Hex

  // Service options
  enableRelayer: boolean
  enableXLP: boolean
  enableSolver: boolean
  enableMEV: boolean
  enableArbitrage: boolean

  // Liquidity settings
  xlpChains?: number[]
  minLiquidity?: bigint

  // Arbitrage settings
  minArbProfitBps?: number
  maxArbPositionUsd?: number
  arbTokens?: string[]

  // Solana MEV settings
  jitoTipLamports?: bigint

  // Risk settings
  maxTransferSize?: bigint
  maxPendingTransfers?: number
}

export interface BridgeStats {
  totalTransfersProcessed: number
  totalVolumeProcessed: bigint
  totalFeesEarned: bigint
  pendingTransfers: number
  activeChains: number[]
  uptime: number
  lastTransferAt: number
  // Arbitrage stats
  arbOpportunitiesDetected: number
  arbTradesExecuted: number
  arbProfitUsd: number
  // MEV stats
  jitoBundlesSubmitted: number
  jitoBundlesLanded: number
  mevProfitUsd: number
}

export interface ArbOpportunity {
  id: string
  type: 'solana_evm' | 'hyperliquid' | 'cross_dex'
  buyChain: string
  sellChain: string
  token: string
  priceDiffBps: number
  netProfitUsd: number
  expiresAt: number
}

export interface TransferEvent {
  id: string
  type: 'initiated' | 'completed' | 'failed'
  sourceChain: number
  destChain: number
  token: Address
  amount: bigint
  fee: bigint
  timestamp: number
}

/** Event args from ZK Bridge TransferInitiated */
interface TransferInitiatedArgs {
  transferId: `0x${string}`
  sender: Address
  destChainId: bigint
  token: Address
  amount: bigint
}

/** Event args from Federated Liquidity LiquidityRequest */
interface LiquidityRequestArgs {
  requestId: `0x${string}`
  token: Address
  amount: bigint
  destChainId: bigint
}

/** Event args from Solver Registry IntentCreated */
interface IntentCreatedArgs {
  intentId: `0x${string}`
  sender: Address
  inputToken: Address
  inputAmount: bigint
  outputToken: Address
  minOutputAmount: bigint
  deadline: bigint
}

/** Response from proof generation */
interface ProofResponse {
  proof: `0x${string}`
}

/** Response from quote API */
interface QuoteResponse {
  dstAmount: string
}

export interface BridgeService {
  // Lifecycle
  start(): Promise<void>
  stop(): Promise<void>
  isRunning(): boolean

  // Stats
  getStats(): Promise<BridgeStats>
  getRecentTransfers(limit?: number): Promise<TransferEvent[]>

  // XLP operations
  depositLiquidity(
    chainId: number,
    token: Address,
    amount: bigint,
  ): Promise<Hex>
  withdrawLiquidity(
    chainId: number,
    token: Address,
    amount: bigint,
  ): Promise<Hex>
  getLiquidityBalance(chainId: number, token?: Address): Promise<bigint>

  // Solver operations
  registerAsSolver(name: string, supportedChains: number[]): Promise<Hex>
  deactivateSolver(): Promise<Hex>
  getSolverStats(): Promise<{
    totalFills: number
    successfulFills: number
    failedFills: number
    pendingIntents: number
  }>

  // Arbitrage operations
  getArbOpportunities(): ArbOpportunity[]
  executeArb(
    opportunityId: string,
  ): Promise<{ success: boolean; txHash?: string; profit?: number }>
  setArbEnabled(enabled: boolean): void

  // MEV operations
  submitJitoBundle(
    transactions: Uint8Array[],
  ): Promise<{ bundleId: string; landed: boolean }>
  getJitoTipFloor(): Promise<bigint>

  // Events
  onTransfer(callback: (event: TransferEvent) => void): () => void
  onArbitrage(callback: (opportunity: ArbOpportunity) => void): () => void
  onError(callback: (error: Error) => void): () => void
}

class BridgeServiceImpl implements BridgeService {
  private config: BridgeServiceConfig
  private running = false
  private arbEnabled = false
  private stats: BridgeStats = {
    totalTransfersProcessed: 0,
    totalVolumeProcessed: 0n,
    totalFeesEarned: 0n,
    pendingTransfers: 0,
    activeChains: [],
    uptime: 0,
    lastTransferAt: 0,
    arbOpportunitiesDetected: 0,
    arbTradesExecuted: 0,
    arbProfitUsd: 0,
    jitoBundlesSubmitted: 0,
    jitoBundlesLanded: 0,
    mevProfitUsd: 0,
  }
  private transferCallbacks: Set<(event: TransferEvent) => void> = new Set()
  private arbCallbacks: Set<(opportunity: ArbOpportunity) => void> = new Set()
  private errorCallbacks: Set<(error: Error) => void> = new Set()
  private startTime = 0
  private recentTransfers: TransferEvent[] = []
  private arbOpportunities: Map<string, ArbOpportunity> = new Map()
  private arbPollInterval: ReturnType<typeof setInterval> | null = null
  private readonly maxArbOpportunities = 1000

  // Jito settings
  private jitoBlockEngineUrl = 'https://mainnet.block-engine.jito.wtf'

  // Arbitrage executor (lazily initialized)
  private arbExecutor: Awaited<
    ReturnType<ArbitrageExecutorModule['createArbitrageExecutor']>
  > | null = null
  private arbExecutorInitPromise: Promise<void> | null = null

  // Relayer state
  private relayerPollInterval: ReturnType<typeof setInterval> | null = null

  // XLP state
  private xlpPollInterval: ReturnType<typeof setInterval> | null = null

  // Solver state
  private solverPollInterval: ReturnType<typeof setInterval> | null = null
  private solverStats = {
    totalFills: 0,
    successfulFills: 0,
    failedFills: 0,
    pendingIntents: 0,
  }
  private solverRegistered = false
  private pendingTransferIds: Set<string> = new Set()

  // XLP state
  private xlpRegistered = false

  constructor(config: BridgeServiceConfig) {
    this.config = config
    this.arbEnabled = config.enableArbitrage ?? false
  }

  /** Remove expired arbitrage opportunities and enforce size limit to prevent memory leaks */
  private cleanupArbOpportunities(): void {
    const now = Date.now()
    // Remove expired opportunities
    for (const [id, opp] of this.arbOpportunities) {
      if (opp.expiresAt < now) {
        this.arbOpportunities.delete(id)
      }
    }
    // Enforce size limit - remove oldest first (by expiry)
    if (this.arbOpportunities.size > this.maxArbOpportunities) {
      const sorted = Array.from(this.arbOpportunities.entries()).sort(
        (a, b) => a[1].expiresAt - b[1].expiresAt,
      )
      const toRemove = sorted.slice(
        0,
        this.arbOpportunities.size - this.maxArbOpportunities,
      )
      for (const [id] of toRemove) {
        this.arbOpportunities.delete(id)
      }
    }
  }

  private async initArbExecutor(): Promise<void> {
    if (
      this.arbExecutor ||
      !this.config.privateKey ||
      !this.config.enableArbitrage
    )
      return
    if (this.arbExecutorInitPromise) {
      await this.arbExecutorInitPromise
      return
    }

    // Capture privateKey in local const for type narrowing in async closure
    const privateKey = this.config.privateKey

    this.arbExecutorInitPromise = (async () => {
      // Validate private key format before using
      const privateKeyRegex = /^0x[a-fA-F0-9]{64}$/
      if (!privateKeyRegex.test(privateKey)) {
        throw new Error('Invalid EVM private key format in bridge config')
      }

      // Validate Solana key if provided
      const solanaKey = nodeConfig.solanaPrivateKey
      if (solanaKey) {
        const decoded = Buffer.from(solanaKey, 'base64')
        if (decoded.length !== 64) {
          console.warn(
            '[Bridge] Invalid SOLANA_PRIVATE_KEY format - Solana operations will be disabled',
          )
        }
      }

      const { createArbitrageExecutor } = await getArbitrageExecutorModule()
      this.arbExecutor = createArbitrageExecutor({
        evmPrivateKey: privateKey,
        solanaPrivateKey: solanaKey,
        evmRpcUrls: this.config.evmRpcUrls,
        solanaRpcUrl: this.config.solanaRpcUrl,
        zkBridgeEndpoint: nodeConfig.zkBridgeEndpoint,
        oneInchApiKey: nodeConfig.oneInchApiKey,
        maxSlippageBps: 50,
        jitoTipLamports: this.config.jitoTipLamports ?? BigInt(10000),
      })
    })()

    await this.arbExecutorInitPromise
  }

  async start(): Promise<void> {
    if (this.running) return

    console.log('[Bridge] Starting bridge service...')
    this.running = true
    this.startTime = Date.now()

    // Initialize active chains
    this.stats.activeChains = Object.keys(this.config.evmRpcUrls).map(Number)

    // Start relayer if enabled
    if (this.config.enableRelayer) {
      await this.startRelayer()
    }

    // Register as XLP if enabled
    if (this.config.enableXLP) {
      await this.startXLP()
    }

    // Register as solver if enabled
    if (this.config.enableSolver) {
      await this.startSolver()
    }

    // Start arbitrage detector if enabled
    if (this.config.enableArbitrage) {
      await this.startArbitrage()
    }

    console.log('[Bridge] Bridge service started')
  }

  async stop(): Promise<void> {
    if (!this.running) return

    console.log('[Bridge] Stopping bridge service...')
    this.running = false

    // Stop all polling intervals
    if (this.arbPollInterval) {
      clearInterval(this.arbPollInterval)
      this.arbPollInterval = null
    }
    if (this.relayerPollInterval) {
      clearInterval(this.relayerPollInterval)
      this.relayerPollInterval = null
    }
    if (this.xlpPollInterval) {
      clearInterval(this.xlpPollInterval)
      this.xlpPollInterval = null
    }
    if (this.solverPollInterval) {
      clearInterval(this.solverPollInterval)
      this.solverPollInterval = null
    }

    console.log('[Bridge] Bridge service stopped')
  }

  isRunning(): boolean {
    return this.running
  }

  async getStats(): Promise<BridgeStats> {
    return {
      ...this.stats,
      uptime: this.running ? Date.now() - this.startTime : 0,
    }
  }

  async getRecentTransfers(limit = 50): Promise<TransferEvent[]> {
    return this.recentTransfers.slice(0, limit)
  }

  async depositLiquidity(
    chainId: number,
    token: Address,
    amount: bigint,
  ): Promise<Hex> {
    const rpcUrl = this.config.evmRpcUrls[chainId]
    if (!rpcUrl) throw new Error(`No RPC URL configured for chain ${chainId}`)
    if (!this.config.contracts.federatedLiquidity) {
      throw new Error('FederatedLiquidity contract not configured')
    }
    if (!this.config.privateKey) {
      throw new Error('Private key required for transactions')
    }

    console.log(`[Bridge] Depositing ${amount} of ${token} to chain ${chainId}`)

    const account = privateKeyToAccount(this.config.privateKey)
    const publicClient = createPublicClient({ transport: http(rpcUrl) })
    const walletClient = createWalletClient({
      account,
      transport: http(rpcUrl),
    })

    // First approve the token
    const approveData = encodeFunctionData({
      abi: [
        {
          name: 'approve',
          type: 'function',
          inputs: [{ type: 'address' }, { type: 'uint256' }],
          outputs: [{ type: 'bool' }],
        },
      ],
      functionName: 'approve',
      args: [this.config.contracts.federatedLiquidity, amount],
    })

    const approveHash = await walletClient.sendTransaction({
      account,
      chain: null,
      to: token,
      data: approveData,
    })
    await publicClient.waitForTransactionReceipt({ hash: approveHash })

    // Then deposit
    const depositData = encodeFunctionData({
      abi: [
        {
          name: 'depositLiquidity',
          type: 'function',
          inputs: [{ type: 'address' }, { type: 'uint256' }],
          outputs: [],
        },
      ],
      functionName: 'depositLiquidity',
      args: [token, amount],
    })

    const hash = await walletClient.sendTransaction({
      account,
      chain: null,
      to: this.config.contracts.federatedLiquidity,
      data: depositData,
    })

    console.log(`[Bridge] Deposit tx: ${hash}`)
    return hash
  }

  async withdrawLiquidity(
    chainId: number,
    token: Address,
    amount: bigint,
  ): Promise<Hex> {
    const rpcUrl = this.config.evmRpcUrls[chainId]
    if (!rpcUrl) throw new Error(`No RPC URL configured for chain ${chainId}`)
    if (!this.config.contracts.federatedLiquidity) {
      throw new Error('FederatedLiquidity contract not configured')
    }
    if (!this.config.privateKey) {
      throw new Error('Private key required for transactions')
    }

    console.log(
      `[Bridge] Withdrawing ${amount} of ${token} from chain ${chainId}`,
    )

    const account = privateKeyToAccount(this.config.privateKey)
    const walletClient = createWalletClient({
      account,
      transport: http(rpcUrl),
    })

    const data = encodeFunctionData({
      abi: [
        {
          name: 'withdrawLiquidity',
          type: 'function',
          inputs: [{ type: 'address' }, { type: 'uint256' }],
          outputs: [],
        },
      ],
      functionName: 'withdrawLiquidity',
      args: [token, amount],
    })

    const hash = await walletClient.sendTransaction({
      account,
      chain: null,
      to: this.config.contracts.federatedLiquidity,
      data,
    })

    console.log(`[Bridge] Withdraw tx: ${hash}`)
    return hash
  }

  async getLiquidityBalance(chainId: number, token?: Address): Promise<bigint> {
    const rpcUrl = this.config.evmRpcUrls[chainId]
    if (!rpcUrl) throw new Error(`No RPC URL configured for chain ${chainId}`)
    if (!this.config.contracts.federatedLiquidity) {
      throw new Error('FederatedLiquidity contract not configured')
    }

    console.log(`[Bridge] Getting liquidity balance for chain ${chainId}`)

    const XLP_ABI = parseAbi([
      'function xlpDeposits(address operator, address token) external view returns (uint256)',
    ])

    const publicClient = createPublicClient({ transport: http(rpcUrl) })

    const balance = await publicClient.readContract({
      address: this.config.contracts.federatedLiquidity,
      abi: XLP_ABI,
      functionName: 'xlpDeposits',
      args: [this.config.operatorAddress, token ?? ZERO_ADDRESS],
    })

    return balance
  }

  async registerAsSolver(
    name: string,
    supportedChains: number[],
  ): Promise<Hex> {
    if (!this.config.contracts.solverRegistry) {
      throw new Error('SolverRegistry contract not configured')
    }
    if (!this.config.privateKey) {
      throw new Error('Private key required for transactions')
    }

    console.log(
      `[Bridge] Registering as solver: ${name} for chains ${supportedChains}`,
    )

    const chainId = Object.keys(this.config.evmRpcUrls)[0]
    const rpcUrl = this.config.evmRpcUrls[Number(chainId)]
    if (!rpcUrl) throw new Error('No RPC URL configured')

    const account = privateKeyToAccount(this.config.privateKey)
    const walletClient = createWalletClient({
      account,
      transport: http(rpcUrl),
    })

    const data = encodeFunctionData({
      abi: [
        {
          name: 'registerSolver',
          type: 'function',
          inputs: [{ type: 'string' }, { type: 'uint256[]' }],
          outputs: [],
        },
      ],
      functionName: 'registerSolver',
      args: [name, supportedChains.map((c) => BigInt(c))],
    })

    const hash = await walletClient.sendTransaction({
      account,
      chain: null,
      to: this.config.contracts.solverRegistry,
      data,
    })

    console.log(`[Bridge] Register solver tx: ${hash}`)
    return hash
  }

  async deactivateSolver(): Promise<Hex> {
    if (!this.config.contracts.solverRegistry) {
      throw new Error('SolverRegistry contract not configured')
    }
    if (!this.config.privateKey) {
      throw new Error('Private key required for transactions')
    }

    console.log('[Bridge] Deactivating solver')

    const chainId = Object.keys(this.config.evmRpcUrls)[0]
    const rpcUrl = this.config.evmRpcUrls[Number(chainId)]
    if (!rpcUrl) throw new Error('No RPC URL configured')

    const account = privateKeyToAccount(this.config.privateKey)
    const walletClient = createWalletClient({
      account,
      transport: http(rpcUrl),
    })

    const data = encodeFunctionData({
      abi: [
        { name: 'deactivateSolver', type: 'function', inputs: [], outputs: [] },
      ],
      functionName: 'deactivateSolver',
      args: [],
    })

    const hash = await walletClient.sendTransaction({
      account,
      chain: null,
      to: this.config.contracts.solverRegistry,
      data,
    })

    console.log(`[Bridge] Deactivate solver tx: ${hash}`)
    return hash
  }

  async getSolverStats(): Promise<{
    totalFills: number
    successfulFills: number
    failedFills: number
    pendingIntents: number
  }> {
    // If solver registry is configured, fetch on-chain stats
    if (this.config.contracts.solverRegistry && this.config.privateKey) {
      const chainId = Object.keys(this.config.evmRpcUrls)[0]
      const rpcUrl = this.config.evmRpcUrls[Number(chainId)]
      if (rpcUrl) {
        const publicClient = createPublicClient({ transport: http(rpcUrl) })
        const account = privateKeyToAccount(this.config.privateKey)

        const SOLVER_ABI = parseAbi([
          'function getSolverStats(address solver) external view returns (uint256 totalFills, uint256 successfulFills, uint256 failedFills)',
        ])

        const result = await publicClient.readContract({
          address: this.config.contracts.solverRegistry,
          abi: SOLVER_ABI,
          functionName: 'getSolverStats',
          args: [account.address],
        })

        // Update local stats with on-chain data
        this.solverStats.totalFills = Number(result[0])
        this.solverStats.successfulFills = Number(result[1])
        this.solverStats.failedFills = Number(result[2])
      }
    }
    return { ...this.solverStats }
  }
  getArbOpportunities(): ArbOpportunity[] {
    return Array.from(this.arbOpportunities.values()).filter(
      (opp) => opp.expiresAt > Date.now(),
    )
  }

  async executeArb(
    opportunityId: string,
  ): Promise<{ success: boolean; txHash?: string; profit?: number }> {
    const opportunity = this.arbOpportunities.get(opportunityId)
    if (!opportunity) {
      return { success: false }
    }

    if (opportunity.expiresAt < Date.now()) {
      this.arbOpportunities.delete(opportunityId)
      return { success: false }
    }

    console.log(
      `[Bridge] Executing arbitrage: ${opportunity.type} ${opportunity.token}`,
    )
    console.log(
      `   Buy on ${opportunity.buyChain}, sell on ${opportunity.sellChain}`,
    )
    console.log(`   Expected profit: $${opportunity.netProfitUsd.toFixed(2)}`)

    if (opportunity.type === 'solana_evm') {
      return this.executeSolanaEvmArb(opportunity)
    } else if (opportunity.type === 'hyperliquid') {
      return this.executeHyperliquidArb(opportunity)
    } else {
      return this.executeCrossDexArb(opportunity)
    }
  }

  setArbEnabled(enabled: boolean): void {
    this.arbEnabled = enabled
    if (enabled && !this.arbPollInterval) {
      this.startArbitrage()
    } else if (!enabled && this.arbPollInterval) {
      clearInterval(this.arbPollInterval)
      this.arbPollInterval = null
    }
  }
  async submitJitoBundle(
    transactions: Uint8Array[],
  ): Promise<{ bundleId: string; landed: boolean }> {
    const tipLamports = this.config.jitoTipLamports ?? BigInt(10000)

    console.log(
      `[Bridge] Submitting Jito bundle with ${transactions.length} txs, tip: ${tipLamports} lamports`,
    )

    // Jito bundle submission
    const response = await fetch(`${this.jitoBlockEngineUrl}/api/v1/bundles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendBundle',
        params: [
          transactions.map((tx) => Buffer.from(tx).toString('base64')),
          { encoding: 'base64' },
        ],
      }),
    })

    const json: unknown = await response.json()
    const parsed = JitoBundleResponseSchema.safeParse(json)
    if (!parsed.success) {
      console.error('[Bridge] Invalid Jito bundle response')
      return { bundleId: '', landed: false }
    }
    const result = parsed.data

    if (result.error) {
      console.error(`[Bridge] Jito bundle failed: ${result.error.message}`)
      return { bundleId: '', landed: false }
    }

    const bundleId = result.result ?? ''
    this.stats.jitoBundlesSubmitted++

    // Check bundle status
    const landed = await this.checkJitoBundleStatus(bundleId)
    if (landed) {
      this.stats.jitoBundlesLanded++
    }

    return { bundleId, landed }
  }

  async getJitoTipFloor(): Promise<bigint> {
    const response = await fetch(
      `${this.jitoBlockEngineUrl}/api/v1/bundles/tip_floor`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTipAccounts',
          params: [],
        }),
      },
    )

    const json: unknown = await response.json()
    const parsed = JitoTipFloorResponseSchema.safeParse(json)
    return BigInt(
      parsed.success
        ? (parsed.data.result?.tip_floor_lamports ?? 10000)
        : 10000,
    )
  }
  onTransfer(callback: (event: TransferEvent) => void): () => void {
    this.transferCallbacks.add(callback)
    return () => this.transferCallbacks.delete(callback)
  }

  onArbitrage(callback: (opportunity: ArbOpportunity) => void): () => void {
    this.arbCallbacks.add(callback)
    return () => this.arbCallbacks.delete(callback)
  }

  onError(callback: (error: Error) => void): () => void {
    this.errorCallbacks.add(callback)
    return () => this.errorCallbacks.delete(callback)
  }
  private async startRelayer(): Promise<void> {
    console.log('[Bridge] Starting relayer...')

    if (!this.config.contracts.zkBridge) {
      console.warn(
        '[Bridge] zkBridge contract not configured, relayer disabled',
      )
      return
    }

    const ZK_BRIDGE_ABI = parseAbi([
      'event TransferInitiated(bytes32 indexed transferId, address indexed sender, uint256 destChainId, address token, uint256 amount)',
      'function getPendingTransfers(uint256 offset, uint256 limit) external view returns (bytes32[] memory)',
      'function processTransfer(bytes32 transferId, bytes calldata proof) external',
    ])

    // Monitor for transfer events on each chain
    for (const [chainIdStr, rpcUrl] of Object.entries(this.config.evmRpcUrls)) {
      const chainId = Number(chainIdStr)
      const publicClient = createPublicClient({ transport: http(rpcUrl) })

      // Watch for transfer events
      publicClient.watchContractEvent({
        address: this.config.contracts.zkBridge,
        abi: ZK_BRIDGE_ABI,
        eventName: 'TransferInitiated',
        onLogs: (logs) => {
          for (const log of logs) {
            const args = log.args as TransferInitiatedArgs
            const transferId = args.transferId
            if (!this.pendingTransferIds.has(transferId)) {
              this.pendingTransferIds.add(transferId)
              this.stats.pendingTransfers++

              const event: TransferEvent = {
                id: transferId,
                type: 'initiated',
                sourceChain: chainId,
                destChain: Number(args.destChainId),
                token: args.token,
                amount: args.amount,
                fee: args.amount / 1000n, // Estimate 0.1% fee
                timestamp: Date.now(),
              }
              this.emitTransfer(event)
            }
          }
        },
      })
    }

    // Poll for pending transfers and process them
    this.relayerPollInterval = setInterval(async () => {
      await this.processPendingTransfers()
    }, 10000) // Poll every 10 seconds

    console.log('[Bridge] Relayer started, monitoring transfer events')
  }

  private async processPendingTransfers(): Promise<void> {
    if (!this.config.contracts.zkBridge || !this.config.privateKey) return

    const ZK_BRIDGE_ABI = parseAbi([
      'function getTransfer(bytes32 transferId) external view returns (address sender, uint256 srcChainId, uint256 destChainId, address token, uint256 amount, uint256 timestamp, uint8 status)',
      'function submitProof(bytes32 transferId, bytes calldata proof) external',
    ])

    const account = privateKeyToAccount(this.config.privateKey)

    for (const transferId of this.pendingTransferIds) {
      // Fetch transfer details from the first configured chain
      const chainId = Object.keys(this.config.evmRpcUrls)[0]
      const rpcUrl = this.config.evmRpcUrls[Number(chainId)]
      if (!rpcUrl) continue

      const publicClient = createPublicClient({ transport: http(rpcUrl) })

      const transfer = await publicClient.readContract({
        address: this.config.contracts.zkBridge,
        abi: ZK_BRIDGE_ABI,
        functionName: 'getTransfer',
        args: [transferId as `0x${string}`],
      })

      const [, , destChainId, token, amount, timestamp, status] = transfer

      // Status: 0 = pending, 1 = finalized, 2 = completed, 3 = failed
      if (status === 2 || status === 3) {
        // Transfer already processed
        this.pendingTransferIds.delete(transferId)
        this.stats.pendingTransfers = Math.max(
          0,
          this.stats.pendingTransfers - 1,
        )
        continue
      }

      // Check if transfer has reached finality (>= 64 blocks for PoS chains)
      const currentBlock = await publicClient.getBlockNumber()
      const transferBlock = BigInt(timestamp) // Simplified - would need actual block lookup
      const confirmations = currentBlock - transferBlock

      if (confirmations < 64n) {
        continue // Not finalized yet
      }

      // Generate proof via prover service
      const proverEndpoint = nodeConfig.zkProverEndpoint
      if (!proverEndpoint) {
        console.warn(
          '[Bridge] ZK_PROVER_ENDPOINT not configured, skipping proof generation',
        )
        continue
      }

      const proofResponse = await fetch(`${proverEndpoint}/prove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transferId,
          sourceChain: Number(chainId),
          destChain: Number(destChainId),
          token,
          amount: amount.toString(),
        }),
      })

      if (!proofResponse.ok) {
        console.error(`[Bridge] Proof generation failed for ${transferId}`)
        continue
      }

      const { proof } = (await proofResponse.json()) as ProofResponse

      // Submit proof to destination chain
      const destRpcUrl = this.config.evmRpcUrls[Number(destChainId)]
      if (!destRpcUrl) {
        console.error(`[Bridge] No RPC for destination chain ${destChainId}`)
        continue
      }

      const walletClient = createWalletClient({
        account,
        transport: http(destRpcUrl),
      })

      const hash = await walletClient.writeContract({
        address: this.config.contracts.zkBridge,
        abi: ZK_BRIDGE_ABI,
        functionName: 'submitProof',
        args: [transferId as `0x${string}`, proof],
        chain: null,
        account,
      })

      console.log(`[Bridge] Proof submitted for ${transferId}: ${hash}`)

      // Remove from pending after successful submission
      this.pendingTransferIds.delete(transferId)
      this.stats.pendingTransfers = Math.max(0, this.stats.pendingTransfers - 1)

      // Emit completion event
      this.emitTransfer({
        id: transferId,
        type: 'completed',
        sourceChain: Number(chainId),
        destChain: Number(destChainId),
        token,
        amount,
        fee: amount / 1000n,
        timestamp: Date.now(),
      })
    }
  }

  private async startXLP(): Promise<void> {
    console.log('[Bridge] Starting XLP service...')

    if (this.xlpRegistered) {
      console.log('[Bridge] XLP already registered')
      return
    }
    if (!this.config.contracts.federatedLiquidity) {
      console.warn(
        '[Bridge] FederatedLiquidity contract not configured, XLP disabled',
      )
      return
    }
    if (!this.config.privateKey) {
      console.warn('[Bridge] Private key not configured, XLP disabled')
      return
    }

    const LIQUIDITY_ABI = parseAbi([
      'event LiquidityRequest(bytes32 indexed requestId, address token, uint256 amount, uint256 destChainId)',
      'function fulfillRequest(bytes32 requestId, uint256 amount) external',
      'function isXLPRegistered(address operator) external view returns (bool)',
      'function registerAsXLP(uint256[] calldata chains) external',
    ])

    const chainId = Object.keys(this.config.evmRpcUrls)[0]
    const rpcUrl = this.config.evmRpcUrls[Number(chainId)]
    if (!rpcUrl) return

    const publicClient = createPublicClient({ transport: http(rpcUrl) })
    const account = privateKeyToAccount(this.config.privateKey)

    // Check if already registered
    const isRegistered = await publicClient.readContract({
      address: this.config.contracts.federatedLiquidity,
      abi: LIQUIDITY_ABI,
      functionName: 'isXLPRegistered',
      args: [account.address],
    })

    if (!isRegistered && this.config.xlpChains) {
      // Register as XLP
      const walletClient = createWalletClient({
        account,
        transport: http(rpcUrl),
      })

      const data = encodeFunctionData({
        abi: LIQUIDITY_ABI,
        functionName: 'registerAsXLP',
        args: [this.config.xlpChains.map((c) => BigInt(c))],
      })

      const hash = await walletClient.sendTransaction({
        account,
        chain: null,
        to: this.config.contracts.federatedLiquidity,
        data,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      console.log(`[Bridge] Registered as XLP: ${hash}`)
    }

    this.xlpRegistered = true

    // Watch for liquidity requests
    publicClient.watchContractEvent({
      address: this.config.contracts.federatedLiquidity,
      abi: LIQUIDITY_ABI,
      eventName: 'LiquidityRequest',
      onLogs: (logs) => {
        for (const log of logs) {
          const args = log.args as LiquidityRequestArgs
          console.log(
            `[Bridge] Liquidity request: ${args.requestId} for ${args.amount}`,
          )
          // Evaluate and potentially fulfill the request
          this.evaluateLiquidityRequest(args.requestId, args.token, args.amount)
        }
      },
    })

    console.log('[Bridge] XLP service started')
  }

  private async evaluateLiquidityRequest(
    requestId: `0x${string}`,
    token: Address,
    amount: bigint,
  ): Promise<void> {
    if (!this.config.contracts.federatedLiquidity || !this.config.privateKey)
      return

    // Check minimum liquidity threshold
    const minLiquidity = this.config.minLiquidity ?? 0n
    if (amount < minLiquidity) return

    // Check our liquidity balance
    const chainId = Object.keys(this.config.evmRpcUrls)[0]
    const rpcUrl = this.config.evmRpcUrls[Number(chainId)]
    if (!rpcUrl) return

    const balance = await this.getLiquidityBalance(Number(chainId), token)

    if (balance >= amount) {
      console.log(`[Bridge] Fulfilling liquidity request: ${requestId}`)

      const FULFILL_ABI = parseAbi([
        'function fulfillRequest(bytes32 requestId, uint256 amount) external',
      ])

      const account = privateKeyToAccount(this.config.privateKey)
      const publicClient = createPublicClient({ transport: http(rpcUrl) })
      const walletClient = createWalletClient({
        account,
        transport: http(rpcUrl),
      })

      const hash = await walletClient.writeContract({
        address: this.config.contracts.federatedLiquidity,
        abi: FULFILL_ABI,
        functionName: 'fulfillRequest',
        args: [requestId, amount],
        chain: null,
        account,
      })

      await publicClient.waitForTransactionReceipt({ hash })
      console.log(`[Bridge] Fulfilled request ${requestId}: ${hash}`)
    }
  }

  private async startSolver(): Promise<void> {
    console.log('[Bridge] Starting solver service...')

    if (this.solverRegistered) {
      console.log('[Bridge] Solver already registered')
      return
    }
    if (!this.config.contracts.solverRegistry) {
      console.warn(
        '[Bridge] SolverRegistry contract not configured, solver disabled',
      )
      return
    }
    if (!this.config.privateKey) {
      console.warn('[Bridge] Private key not configured, solver disabled')
      return
    }

    const SOLVER_ABI = parseAbi([
      'event IntentCreated(bytes32 indexed intentId, address sender, address inputToken, uint256 inputAmount, address outputToken, uint256 minOutputAmount, uint256 deadline)',
      'function fillIntent(bytes32 intentId, uint256 outputAmount) external',
      'function getOpenIntents(uint256 offset, uint256 limit) external view returns (bytes32[] memory)',
      'function isSolverRegistered(address solver) external view returns (bool)',
    ])

    const chainId = Object.keys(this.config.evmRpcUrls)[0]
    const rpcUrl = this.config.evmRpcUrls[Number(chainId)]
    if (!rpcUrl) return

    const publicClient = createPublicClient({ transport: http(rpcUrl) })
    const account = privateKeyToAccount(this.config.privateKey)

    // Check if already registered
    const isRegistered = await publicClient.readContract({
      address: this.config.contracts.solverRegistry,
      abi: SOLVER_ABI,
      functionName: 'isSolverRegistered',
      args: [account.address],
    })

    if (!isRegistered) {
      // Register as solver
      await this.registerAsSolver('JejuBridgeSolver', this.stats.activeChains)
    }

    this.solverRegistered = true

    // Watch for new intents
    publicClient.watchContractEvent({
      address: this.config.contracts.solverRegistry,
      abi: SOLVER_ABI,
      eventName: 'IntentCreated',
      onLogs: (logs) => {
        for (const log of logs) {
          const args = log.args as IntentCreatedArgs
          this.solverStats.pendingIntents++
          console.log(`[Bridge] New intent: ${args.intentId}`)
          // Evaluate and potentially fill the intent
          this.evaluateIntent(
            args.intentId,
            args.inputToken,
            args.inputAmount,
            args.outputToken,
            args.minOutputAmount,
            args.deadline,
          )
        }
      },
    })

    // Poll for open intents periodically
    this.solverPollInterval = setInterval(async () => {
      await this.pollOpenIntents()
    }, 5000)

    console.log('[Bridge] Solver service started')
  }

  private async evaluateIntent(
    intentId: `0x${string}`,
    inputToken: Address,
    inputAmount: bigint,
    outputToken: Address,
    minOutputAmount: bigint,
    deadline: bigint,
  ): Promise<void> {
    if (!this.config.contracts.solverRegistry || !this.config.privateKey) return

    // Check deadline
    const nowSeconds = BigInt(Math.floor(Date.now() / 1000))
    if (nowSeconds > deadline) {
      this.solverStats.pendingIntents = Math.max(
        0,
        this.solverStats.pendingIntents - 1,
      )
      return
    }

    const chainId = Object.keys(this.config.evmRpcUrls)[0]
    const rpcUrl = this.config.evmRpcUrls[Number(chainId)]
    if (!rpcUrl) return

    // Get quote for the swap to determine profitability
    const oneInchApiKey = nodeConfig.oneInchApiKey
    if (!oneInchApiKey) {
      console.warn(
        '[Bridge] 1inch API key not configured, cannot evaluate intent',
      )
      return
    }

    const quoteUrl = `https://api.1inch.dev/swap/v6.0/${chainId}/quote?src=${inputToken}&dst=${outputToken}&amount=${inputAmount}`
    const quoteResponse = await fetch(quoteUrl, {
      headers: { Authorization: `Bearer ${oneInchApiKey}` },
    })

    if (!quoteResponse.ok) {
      console.error(`[Bridge] Quote failed for intent ${intentId}`)
      return
    }

    const quote = (await quoteResponse.json()) as QuoteResponse
    const estimatedOutput = BigInt(quote.dstAmount)

    // Add 1% buffer for slippage and profit margin
    const minRequiredOutput = (minOutputAmount * 101n) / 100n

    if (estimatedOutput < minRequiredOutput) {
      // Not profitable enough
      return
    }

    console.log(`[Bridge] Intent ${intentId} is profitable, filling...`)

    // Execute the fill
    const FILL_ABI = parseAbi([
      'function fillIntent(bytes32 intentId, uint256 outputAmount) external',
    ])

    const account = privateKeyToAccount(this.config.privateKey)
    const publicClient = createPublicClient({ transport: http(rpcUrl) })
    const walletClient = createWalletClient({
      account,
      transport: http(rpcUrl),
    })

    this.solverStats.totalFills++

    const hash = await walletClient.writeContract({
      address: this.config.contracts.solverRegistry,
      abi: FILL_ABI,
      functionName: 'fillIntent',
      args: [intentId, estimatedOutput],
      chain: null,
      account,
    })

    const receipt = await publicClient.waitForTransactionReceipt({ hash })

    if (receipt.status === 'success') {
      this.solverStats.successfulFills++
      console.log(`[Bridge] Filled intent ${intentId}: ${hash}`)
    } else {
      this.solverStats.failedFills++
      console.error(`[Bridge] Failed to fill intent ${intentId}: ${hash}`)
    }

    this.solverStats.pendingIntents = Math.max(
      0,
      this.solverStats.pendingIntents - 1,
    )
  }

  private async pollOpenIntents(): Promise<void> {
    if (!this.config.contracts.solverRegistry) return

    const chainId = Object.keys(this.config.evmRpcUrls)[0]
    const rpcUrl = this.config.evmRpcUrls[Number(chainId)]
    if (!rpcUrl) return

    const publicClient = createPublicClient({ transport: http(rpcUrl) })

    const SOLVER_ABI = parseAbi([
      'function getOpenIntents(uint256 offset, uint256 limit) external view returns (bytes32[] memory)',
    ])

    const openIntents = await publicClient.readContract({
      address: this.config.contracts.solverRegistry,
      abi: SOLVER_ABI,
      functionName: 'getOpenIntents',
      args: [0n, 100n],
    })

    this.solverStats.pendingIntents = openIntents.length
  }

  private async startArbitrage(): Promise<void> {
    console.log('[Bridge] Starting arbitrage detector...')

    // Lazy initialize the arbitrage executor
    await this.initArbExecutor()

    const minProfitBps = this.config.minArbProfitBps ?? 30
    const tokens = this.config.arbTokens ?? ['WETH', 'USDC']

    // Poll for arbitrage opportunities every 5 seconds
    this.arbPollInterval = setInterval(async () => {
      if (!this.arbEnabled) return

      for (const token of tokens) {
        await this.detectArbOpportunities(token, minProfitBps)
      }
    }, 5000)

    // Initial detection
    for (const token of tokens) {
      await this.detectArbOpportunities(token, minProfitBps)
    }
  }

  private async detectArbOpportunities(
    token: string,
    minProfitBps: number,
  ): Promise<void> {
    const prices: Array<{ chain: string; price: number; dex: string }> = []

    // Get Solana price via Jupiter
    const solPrice = await this.getSolanaPrice(token)
    if (solPrice)
      prices.push({ chain: 'solana', price: solPrice.price, dex: solPrice.dex })

    // Get EVM prices
    for (const chainId of this.stats.activeChains) {
      const evmPrice = await this.getEvmPrice(token, chainId)
      if (evmPrice)
        prices.push({
          chain: `evm:${chainId}`,
          price: evmPrice.price,
          dex: evmPrice.dex,
        })
    }

    // Get Hyperliquid price
    const hlPrice = await this.getHyperliquidPrice(token)
    if (hlPrice)
      prices.push({
        chain: 'hyperliquid',
        price: hlPrice.price,
        dex: 'hyperliquid',
      })

    if (prices.length < 2) return

    // Find arbitrage opportunities
    for (let i = 0; i < prices.length; i++) {
      for (let j = i + 1; j < prices.length; j++) {
        const [low, high] =
          prices[i].price < prices[j].price
            ? [prices[i], prices[j]]
            : [prices[j], prices[i]]

        const priceDiffBps = Math.floor(
          ((high.price - low.price) / low.price) * 10000,
        )

        // Estimate bridge costs (0.1% + gas)
        const bridgeCostBps = 10 + 5 // 0.1% fee + ~0.05% gas estimate
        const netProfitBps = priceDiffBps - bridgeCostBps

        if (netProfitBps >= minProfitBps) {
          const opportunity: ArbOpportunity = {
            id: `${token}-${low.chain}-${high.chain}-${Date.now()}`,
            type:
              low.chain === 'solana' || high.chain === 'solana'
                ? 'solana_evm'
                : low.chain === 'hyperliquid' || high.chain === 'hyperliquid'
                  ? 'hyperliquid'
                  : 'cross_dex',
            buyChain: low.chain,
            sellChain: high.chain,
            token,
            priceDiffBps,
            netProfitUsd:
              (netProfitBps / 10000) * (this.config.maxArbPositionUsd ?? 10000),
            expiresAt: Date.now() + 30000, // 30 second expiry
          }

          // Cleanup expired/excess opportunities before adding
          this.cleanupArbOpportunities()
          this.arbOpportunities.set(opportunity.id, opportunity)
          this.stats.arbOpportunitiesDetected++

          console.log(
            `[Bridge] Arb opportunity: ${token} ${low.chain} -> ${high.chain} (+${netProfitBps}bps)`,
          )

          for (const callback of this.arbCallbacks) {
            callback(opportunity)
          }
        }
      }
    }
  }

  private async getSolanaPrice(
    token: string,
  ): Promise<{ price: number; dex: string } | null> {
    // Use Jupiter API for Solana prices
    const JUPITER_API = 'https://price.jup.ag/v6/price'
    const TOKEN_MINTS: Record<string, string> = {
      WETH: 'So11111111111111111111111111111111111111112', // Actually SOL
      USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      SOL: 'So11111111111111111111111111111111111111112',
    }

    const mint = TOKEN_MINTS[token]
    if (!mint) return null

    const response = await fetch(`${JUPITER_API}?ids=${mint}`)
    if (!response.ok) return null

    const json: unknown = await response.json()
    const parsed = JupiterPriceResponseSchema.safeParse(json)
    if (!parsed.success) return null

    const price = parsed.data.data?.[mint]?.price
    return price ? { price, dex: 'jupiter' } : null
  }

  private async getEvmPrice(
    token: string,
    chainId: number,
  ): Promise<{ price: number; dex: string } | null> {
    // Use Chainlink price feeds for EVM tokens
    const rpcUrl = this.config.evmRpcUrls[chainId]
    if (!rpcUrl) return null

    const CHAINLINK_FEEDS: Record<string, Record<number, Address>> = {
      WETH: {
        1: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
        8453: '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
        42161: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
      },
    }

    const feedAddress = CHAINLINK_FEEDS[token][chainId]
    if (!feedAddress) return null

    const CHAINLINK_ABI = parseAbi([
      'function latestAnswer() external view returns (int256)',
    ])

    const client = createPublicClient({ transport: http(rpcUrl) })

    const result = await client.readContract({
      address: feedAddress,
      abi: CHAINLINK_ABI,
      functionName: 'latestAnswer',
    })

    // Chainlink returns 8 decimals
    return { price: Number(result) / 1e8, dex: 'chainlink' }
  }

  private async getHyperliquidPrice(
    token: string,
  ): Promise<{ price: number; dex: string } | null> {
    // Hyperliquid API
    const response = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'allMids' }),
    })

    if (!response.ok) return null

    const json: unknown = await response.json()
    const parsed = HyperliquidPricesResponseSchema.safeParse(json)
    if (!parsed.success) return null

    const symbol = token === 'WETH' ? 'ETH' : token
    const price = parsed.data[symbol]

    return price ? { price: parseFloat(price), dex: 'hyperliquid' } : null
  }

  private async executeSolanaEvmArb(
    opportunity: ArbOpportunity,
  ): Promise<{ success: boolean; txHash?: string; profit?: number }> {
    if (!this.arbExecutor) {
      console.error('[Bridge] Arbitrage executor not initialized')
      return { success: false }
    }

    console.log(`[Bridge] Executing Solana-EVM arb for ${opportunity.token}`)

    const result = await this.arbExecutor.executeSolanaEvmArb(opportunity)

    if (result.success) {
      this.stats.arbTradesExecuted++
      this.stats.arbProfitUsd += result.profit || opportunity.netProfitUsd
      this.arbOpportunities.delete(opportunity.id)
    }

    return result
  }

  private async executeHyperliquidArb(
    opportunity: ArbOpportunity,
  ): Promise<{ success: boolean; txHash?: string; profit?: number }> {
    if (!this.arbExecutor) {
      console.error('[Bridge] Arbitrage executor not initialized')
      return { success: false }
    }

    console.log(`[Bridge] Executing Hyperliquid arb for ${opportunity.token}`)

    const result = await this.arbExecutor.executeHyperliquidArb(opportunity)

    if (result.success) {
      this.stats.arbTradesExecuted++
      this.stats.arbProfitUsd += result.profit || opportunity.netProfitUsd
      this.arbOpportunities.delete(opportunity.id)
    }

    return result
  }

  private async executeCrossDexArb(
    opportunity: ArbOpportunity,
  ): Promise<{ success: boolean; txHash?: string; profit?: number }> {
    if (!this.arbExecutor) {
      console.error('[Bridge] Arbitrage executor not initialized')
      return { success: false }
    }

    console.log(`[Bridge] Executing cross-DEX arb for ${opportunity.token}`)

    const result = await this.arbExecutor.executeCrossDexArb(opportunity)

    if (result.success) {
      this.stats.arbTradesExecuted++
      this.stats.arbProfitUsd += result.profit || opportunity.netProfitUsd
      this.arbOpportunities.delete(opportunity.id)
    }

    return result
  }

  private async checkJitoBundleStatus(bundleId: string): Promise<boolean> {
    if (!bundleId) return false

    // Poll for bundle status
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500))

      const response = await fetch(
        `${this.jitoBlockEngineUrl}/api/v1/bundles`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getBundleStatuses',
            params: [[bundleId]],
          }),
        },
      )

      const json: unknown = await response.json()
      const parsed = JitoBundleStatusResponseSchema.safeParse(json)
      if (!parsed.success) continue

      const firstValue = parsed.data.result?.value[0]
      const status = firstValue?.confirmation_status
      if (status === 'confirmed' || status === 'finalized') {
        return true
      }
    }

    return false
  }

  protected emitTransfer(event: TransferEvent): void {
    this.recentTransfers.unshift(event)
    if (this.recentTransfers.length > 1000) {
      this.recentTransfers.pop()
    }

    this.stats.totalTransfersProcessed++
    this.stats.totalVolumeProcessed += event.amount
    this.stats.totalFeesEarned += event.fee
    this.stats.lastTransferAt = event.timestamp

    for (const callback of this.transferCallbacks) {
      callback(event)
    }
  }

  protected emitError(error: Error): void {
    console.error('[Bridge] Error:', error)
    for (const callback of this.errorCallbacks) {
      callback(error)
    }
  }
}

export function createBridgeService(
  config: BridgeServiceConfig,
): BridgeService {
  return new BridgeServiceImpl(config)
}

export function getDefaultBridgeConfig(
  operatorAddress: Address,
): Partial<BridgeServiceConfig> {
  return {
    evmRpcUrls: {
      1: 'https://eth.llamarpc.com',
      8453: 'https://mainnet.base.org',
      84532: 'https://sepolia.base.org',
      42161: 'https://arb1.arbitrum.io/rpc',
      56: 'https://bsc-dataseed.binance.org',
    },
    solanaRpcUrl: 'https://api.mainnet-beta.solana.com',
    operatorAddress,
    enableRelayer: true,
    enableXLP: true,
    enableSolver: true,
    enableMEV: false,
    enableArbitrage: true,
    xlpChains: [1, 8453, 42161],
    // Arbitrage settings
    minArbProfitBps: 30, // 0.3% minimum profit
    maxArbPositionUsd: 10000, // Max $10k per arb trade
    arbTokens: ['WETH', 'USDC', 'SOL'],
    // Jito settings for Solana MEV
    jitoTipLamports: BigInt(10000), // 0.00001 SOL tip
  }
}
