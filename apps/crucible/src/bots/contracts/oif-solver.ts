/**
 * OIF (Open Intents Framework) Solver Integration
 *
 * Enables the LP bot to act as an OIF solver:
 * - Monitor open intents across chains
 * - Quote and fill intents profitably
 * - Handle settlement and attestation
 */

import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  parseAbi,
  type WalletClient,
} from 'viem'
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import type { ChainId } from '../autocrat-types-source'

// ============ Contract ABIs ============

export const SOLVER_REGISTRY_ABI = parseAbi([
  'function registerSolver(string name, uint256[] supportedChains) external',
  'function updateSupportedChains(uint256[] supportedChains) external',
  'function deactivateSolver() external',
  'function stake() external payable',
  'function unstake(uint256 amount) external',
  'function getSolver(address solver) view returns ((address solver, string name, uint256[] supportedChains, uint256 stakedAmount, uint256 totalFills, uint256 successfulFills, uint256 failedFills, uint256 registeredAt, bool isActive))',
  'function getActiveSolvers() view returns (address[])',
  'function getSolversForRoute(uint256 sourceChain, uint256 destChain) view returns (address[])',
  'function minStake() view returns (uint256)',
  'function slashingPercent() view returns (uint256)',
])

export const INPUT_SETTLER_ABI = parseAbi([
  'function open(bytes order, bytes signature) external returns (bytes32 orderId)',
  'function openFor(bytes order, bytes signature, bytes originFillerData) external returns (bytes32 orderId)',
  'function resolve(bytes order) view returns (bytes resolvedOrder)',
  'function getOrder(bytes32 orderId) view returns ((bytes32 orderId, address user, uint256 sourceChainId, uint256 destChainId, address inputToken, address outputToken, uint256 inputAmount, uint256 minOutputAmount, uint256 fee, uint32 openDeadline, uint32 fillDeadline, uint8 status, address solver))',
  'function getOpenOrders() view returns (bytes32[])',
  'function getOrdersByUser(address user) view returns (bytes32[])',
])

export const OUTPUT_SETTLER_ABI = parseAbi([
  'function fill(bytes32 orderId, bytes originData, bytes fillerData) external payable',
  'function claim(bytes32[] orderIds, bytes[] attestations) external',
  'function getClaimableOrders(address solver) view returns (bytes32[])',
])

export const HYPERLANE_ORACLE_ABI = parseAbi([
  'function verifyMessage(bytes32 messageId, bytes proof) view returns (bool)',
  'function getLatestMessage(uint256 originDomain) view returns ((bytes32 messageId, uint256 timestamp, bytes32 sender, bytes body))',
])

export const ORACLE_ADAPTER_ABI = parseAbi([
  'function hasAttested(bytes32 orderId) view returns (bool)',
  'function getAttestation(bytes32 orderId) view returns (bytes)',
  'function getAttestationBlock(bytes32 orderId) view returns (uint256)',
  'function submitAttestation(bytes32 orderId, bytes proof) external',
])

// ============ Types ============

export interface SolverProfile {
  address: Address
  name: string
  supportedChains: ChainId[]
  stakedAmount: bigint
  totalFills: number
  successfulFills: number
  failedFills: number
  registeredAt: number
  isActive: boolean
}

export interface OpenIntent {
  orderId: `0x${string}`
  user: Address
  sourceChainId: ChainId
  destChainId: ChainId
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  minOutputAmount: bigint
  fee: bigint
  openDeadline: number
  fillDeadline: number
  status: IntentStatus
  solver: Address
}

export const IntentStatus = {
  Open: 0,
  Pending: 1,
  Filled: 2,
  Expired: 3,
  Cancelled: 4,
  Failed: 5,
} as const
export type IntentStatus = (typeof IntentStatus)[keyof typeof IntentStatus]

export interface OIFSolverConfig {
  name: string
  chainConfigs: Record<
    ChainId,
    {
      rpcUrl: string
      inputSettlerAddress: Address
      outputSettlerAddress: Address
      solverRegistryAddress: Address
      oracleAddress?: Address
    }
  >
  privateKey: string
  minProfitBps: number
  maxSlippageBps: number
}

// ============ OIF Solver ============

export class OIFSolver {
  private config: OIFSolverConfig
  private account: PrivateKeyAccount
  private clients: Map<
    ChainId,
    { public: PublicClient; wallet: WalletClient }
  > = new Map()
  private isRegistered = false

  constructor(config: OIFSolverConfig) {
    this.config = config
    this.account = privateKeyToAccount(config.privateKey as `0x${string}`)

    // Initialize clients for each chain
    for (const [chainIdStr, chainConfig] of Object.entries(
      config.chainConfigs,
    )) {
      const chainId = parseInt(chainIdStr, 10) as ChainId
      const chain: Chain = {
        id: chainId,
        name: `Chain ${chainId}`,
        nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [chainConfig.rpcUrl] } },
      }

      this.clients.set(chainId, {
        public: createPublicClient({
          chain,
          transport: http(chainConfig.rpcUrl),
        }),
        wallet: createWalletClient({
          account: this.account,
          chain,
          transport: http(chainConfig.rpcUrl),
        }),
      })
    }
  }

  // ============ Solver Registration ============

  /**
   * Register as an OIF solver
   */
  async register(
    primaryChainId: ChainId,
    stakeAmount: bigint,
  ): Promise<`0x${string}`> {
    const clients = this.clients.get(primaryChainId)
    const chainConfig = this.config.chainConfigs[primaryChainId]
    if (!clients || !chainConfig)
      throw new Error(`Chain ${primaryChainId} not configured`)

    const supportedChains = Object.keys(this.config.chainConfigs).map(Number)

    const chain: Chain = {
      id: primaryChainId,
      name: `Chain ${primaryChainId}`,
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [chainConfig.rpcUrl] } },
    }

    // Register solver
    const registerHash = await clients.wallet.writeContract({
      address: chainConfig.solverRegistryAddress,
      abi: SOLVER_REGISTRY_ABI,
      functionName: 'registerSolver',
      args: [this.config.name, supportedChains.map(BigInt)],
      chain,
      account: this.account,
    })

    // Stake
    if (stakeAmount > 0n) {
      await clients.wallet.writeContract({
        address: chainConfig.solverRegistryAddress,
        abi: SOLVER_REGISTRY_ABI,
        functionName: 'stake',
        value: stakeAmount,
        chain,
        account: this.account,
      })
    }

    this.isRegistered = true
    return registerHash
  }

  /**
   * Get solver profile
   */
  async getSolverProfile(
    chainId: ChainId,
    address?: Address,
  ): Promise<SolverProfile | null> {
    const clients = this.clients.get(chainId)
    const chainConfig = this.config.chainConfigs[chainId]
    if (!clients || !chainConfig)
      throw new Error(`Chain ${chainId} not configured`)

    const solverAddress = address ?? this.account.address

    const result = (await clients.public.readContract({
      address: chainConfig.solverRegistryAddress,
      abi: SOLVER_REGISTRY_ABI,
      functionName: 'getSolver',
      args: [solverAddress],
    })) as {
      solver: Address
      name: string
      supportedChains: readonly bigint[]
      stakedAmount: bigint
      totalFills: bigint
      successfulFills: bigint
      failedFills: bigint
      registeredAt: bigint
      isActive: boolean
    }

    if (result.registeredAt === 0n) return null

    return {
      address: result.solver,
      name: result.name,
      supportedChains: result.supportedChains.map((n) => Number(n) as ChainId),
      stakedAmount: result.stakedAmount,
      totalFills: Number(result.totalFills),
      successfulFills: Number(result.successfulFills),
      failedFills: Number(result.failedFills),
      registeredAt: Number(result.registeredAt),
      isActive: result.isActive,
    }
  }

  // ============ Intent Monitoring ============

  /**
   * Get all open intents on a chain
   */
  async getOpenIntents(chainId: ChainId): Promise<OpenIntent[]> {
    const clients = this.clients.get(chainId)
    const chainConfig = this.config.chainConfigs[chainId]
    if (!clients || !chainConfig)
      throw new Error(`Chain ${chainId} not configured`)

    const orderIds = (await clients.public.readContract({
      address: chainConfig.inputSettlerAddress,
      abi: INPUT_SETTLER_ABI,
      functionName: 'getOpenOrders',
    })) as `0x${string}`[]

    const intents: OpenIntent[] = []

    for (const orderId of orderIds) {
      const intent = await this.getIntent(chainId, orderId)
      if (intent && intent.status === IntentStatus.Open) {
        intents.push(intent)
      }
    }

    return intents
  }

  /**
   * Get a specific intent
   */
  async getIntent(
    chainId: ChainId,
    orderId: `0x${string}`,
  ): Promise<OpenIntent | null> {
    const clients = this.clients.get(chainId)
    const chainConfig = this.config.chainConfigs[chainId]
    if (!clients || !chainConfig)
      throw new Error(`Chain ${chainId} not configured`)

    const result = (await clients.public.readContract({
      address: chainConfig.inputSettlerAddress,
      abi: INPUT_SETTLER_ABI,
      functionName: 'getOrder',
      args: [orderId],
    })) as {
      orderId: `0x${string}`
      user: Address
      sourceChainId: bigint
      destChainId: bigint
      inputToken: Address
      outputToken: Address
      inputAmount: bigint
      minOutputAmount: bigint
      fee: bigint
      openDeadline: number
      fillDeadline: number
      status: number
      solver: Address
    }

    if (
      result.orderId ===
      '0x0000000000000000000000000000000000000000000000000000000000000000'
    ) {
      return null
    }

    return {
      orderId: result.orderId,
      user: result.user,
      sourceChainId: Number(result.sourceChainId) as ChainId,
      destChainId: Number(result.destChainId) as ChainId,
      inputToken: result.inputToken,
      outputToken: result.outputToken,
      inputAmount: result.inputAmount,
      minOutputAmount: result.minOutputAmount,
      fee: result.fee,
      openDeadline: result.openDeadline,
      fillDeadline: result.fillDeadline,
      status: result.status as IntentStatus,
      solver: result.solver,
    }
  }

  // ============ Intent Filling ============

  /**
   * Quote an intent fill
   */
  async quoteIntent(intent: OpenIntent): Promise<{
    canFill: boolean
    estimatedProfit: bigint
    profitBps: number
    reason?: string
  }> {
    const destConfig = this.config.chainConfigs[intent.destChainId]
    if (!destConfig) {
      return {
        canFill: false,
        estimatedProfit: 0n,
        profitBps: 0,
        reason: 'Destination chain not supported',
      }
    }

    // Check deadline
    const now = Math.floor(Date.now() / 1000)
    if (now > intent.fillDeadline) {
      return {
        canFill: false,
        estimatedProfit: 0n,
        profitBps: 0,
        reason: 'Intent expired',
      }
    }

    // Calculate profit
    // fee is what we earn, minus gas costs
    const estimatedGas = 200000n
    const clients = this.clients.get(intent.destChainId)
    if (!clients) {
      return {
        canFill: false,
        estimatedProfit: 0n,
        profitBps: 0,
        reason: 'No client for destination',
      }
    }

    const gasPrice = await clients.public.getGasPrice()
    const gasCost = gasPrice * estimatedGas
    const profit = intent.fee - gasCost
    const profitBps = Number((profit * 10000n) / intent.inputAmount)

    if (profitBps < this.config.minProfitBps) {
      return {
        canFill: false,
        estimatedProfit: profit,
        profitBps,
        reason: `Profit ${profitBps} bps below minimum ${this.config.minProfitBps}`,
      }
    }

    return { canFill: true, estimatedProfit: profit, profitBps }
  }

  /**
   * Fill an intent
   */
  async fillIntent(
    intent: OpenIntent,
    originData: `0x${string}`,
  ): Promise<`0x${string}`> {
    const clients = this.clients.get(intent.destChainId)
    const chainConfig = this.config.chainConfigs[intent.destChainId]
    if (!clients || !chainConfig)
      throw new Error(`Chain ${intent.destChainId} not configured`)

    const chain: Chain = {
      id: intent.destChainId,
      name: `Chain ${intent.destChainId}`,
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [chainConfig.rpcUrl] } },
    }

    // Execute fill on destination chain
    const hash = await clients.wallet.writeContract({
      address: chainConfig.outputSettlerAddress,
      abi: OUTPUT_SETTLER_ABI,
      functionName: 'fill',
      args: [intent.orderId, originData, '0x' as `0x${string}`],
      value: intent.minOutputAmount, // Send the output tokens/ETH
      chain,
      account: this.account,
    })

    return hash
  }

  /**
   * Claim filled intents
   */
  async claimFilledIntents(chainId: ChainId): Promise<`0x${string}` | null> {
    const clients = this.clients.get(chainId)
    const chainConfig = this.config.chainConfigs[chainId]
    if (!clients || !chainConfig)
      throw new Error(`Chain ${chainId} not configured`)

    const claimableOrders = (await clients.public.readContract({
      address: chainConfig.outputSettlerAddress,
      abi: OUTPUT_SETTLER_ABI,
      functionName: 'getClaimableOrders',
      args: [this.account.address],
    })) as `0x${string}`[]

    if (claimableOrders.length === 0) return null

    // Fetch attestations from oracle for each claimable order
    const oracleAddress = chainConfig.oracleAddress
    if (!oracleAddress) {
      throw new Error(`No oracle address configured for chain ${chainId}`)
    }

    const attestations: `0x${string}`[] = []
    const validOrders: `0x${string}`[] = []

    for (const orderId of claimableOrders) {
      // Check if order has been attested
      const isAttested = (await clients.public.readContract({
        address: oracleAddress,
        abi: ORACLE_ADAPTER_ABI,
        functionName: 'hasAttested',
        args: [orderId],
      })) as boolean

      if (!isAttested) {
        console.log(`[OIF] Order ${orderId} not yet attested, skipping`)
        continue
      }

      // Get the attestation proof
      const attestation = (await clients.public.readContract({
        address: oracleAddress,
        abi: ORACLE_ADAPTER_ABI,
        functionName: 'getAttestation',
        args: [orderId],
      })) as `0x${string}`

      validOrders.push(orderId)
      attestations.push(attestation)
    }

    if (validOrders.length === 0) {
      console.log('[OIF] No attested orders to claim')
      return null
    }

    const chain: Chain = {
      id: chainId,
      name: `Chain ${chainId}`,
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [chainConfig.rpcUrl] } },
    }

    console.log(
      `[OIF] Claiming ${validOrders.length} orders on chain ${chainId}`,
    )

    const hash = await clients.wallet.writeContract({
      address: chainConfig.outputSettlerAddress,
      abi: OUTPUT_SETTLER_ABI,
      functionName: 'claim',
      args: [validOrders, attestations],
      chain,
      account: this.account,
    })

    console.log(`[OIF] Claim tx: ${hash}`)
    return hash
  }

  // ============ Monitoring Loop ============

  /**
   * Start monitoring for profitable intents
   */
  async startMonitoring(
    onOpportunity: (
      intent: OpenIntent,
      quote: { estimatedProfit: bigint; profitBps: number },
    ) => Promise<void>,
    pollIntervalMs = 5000,
  ): Promise<() => void> {
    let running = true

    const monitor = async () => {
      while (running) {
        for (const chainId of Object.keys(this.config.chainConfigs).map(
          Number,
        ) as ChainId[]) {
          const intents = await this.getOpenIntents(chainId)

          for (const intent of intents) {
            const quote = await this.quoteIntent(intent)
            if (quote.canFill) {
              await onOpportunity(intent, {
                estimatedProfit: quote.estimatedProfit,
                profitBps: quote.profitBps,
              })
            }
          }
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
      }
    }

    monitor()

    return () => {
      running = false
    }
  }

  /**
   * Get solver stats across all chains
   */
  async getStats(): Promise<{
    totalIntents: number
    profitableIntents: number
    totalPotentialProfit: bigint
    avgProfitBps: number
  }> {
    let totalIntents = 0
    let profitableIntents = 0
    let totalProfit = 0n
    let totalProfitBps = 0

    for (const chainId of Object.keys(this.config.chainConfigs).map(
      Number,
    ) as ChainId[]) {
      const intents = await this.getOpenIntents(chainId)
      totalIntents += intents.length

      for (const intent of intents) {
        const quote = await this.quoteIntent(intent)
        if (quote.canFill) {
          profitableIntents++
          totalProfit += quote.estimatedProfit
          totalProfitBps += quote.profitBps
        }
      }
    }

    return {
      totalIntents,
      profitableIntents,
      totalPotentialProfit: totalProfit,
      avgProfitBps:
        profitableIntents > 0
          ? Math.round(totalProfitBps / profitableIntents)
          : 0,
    }
  }
}
