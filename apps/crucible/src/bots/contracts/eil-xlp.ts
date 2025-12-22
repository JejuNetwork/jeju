/**
 * EIL (Ethereum Interop Layer) + XLP (Cross-chain Liquidity Provider) Integration
 *
 * Provides deep integration with Jeju's cross-chain liquidity infrastructure:
 * - FederatedLiquidity contract for XLP operations
 * - EIL voucher system for trustless cross-chain transfers
 * - OIF solver integration for intent-based operations
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

export const FEDERATED_LIQUIDITY_ABI = parseAbi([
  // XLP Management
  'function registerXLP(uint256[] calldata supportedChains) external',
  'function deactivateXLP() external',
  'function getXLP(address provider) view returns ((address provider, uint256[] supportedChains, uint256 totalProvided, uint256 totalEarned, uint256 registeredAt, bool isActive))',
  'function getActiveXLPs() view returns (address[])',
  'function getXLPsForRoute(uint256 sourceChain, uint256 destChain) view returns (address[])',

  // Liquidity Requests
  'function createRequest(address token, uint256 amount, uint256 targetChainId) payable returns (bytes32 requestId)',
  'function fulfillRequest(bytes32 requestId, bytes calldata proof) external',
  'function refundExpiredRequest(bytes32 requestId) external',
  'function getRequest(bytes32 requestId) view returns ((bytes32 requestId, address requester, address token, uint256 amount, uint256 sourceChainId, uint256 targetChainId, uint256 createdAt, uint256 deadline, bool fulfilled, address fulfiller))',
  'function getPendingRequests() view returns (bytes32[])',

  // Network Liquidity
  'function updateNetworkLiquidity(uint256 chainId, address vault, uint256 ethLiquidity, uint256 tokenLiquidity, uint256 utilizationBps) external',
  'function getNetworkLiquidity(uint256 chainId) view returns ((uint256 chainId, address vault, uint256 ethLiquidity, uint256 tokenLiquidity, uint256 utilizationBps, uint256 lastUpdated))',
  'function getTotalFederatedLiquidity() view returns (uint256 totalEth, uint256 totalToken)',
  'function getBestNetworkForLiquidity(uint256 amount) view returns (uint256 bestChainId, uint256 available)',

  // Config
  'function fulfillmentFeeBps() view returns (uint256)',
  'function minRequestAmount() view returns (uint256)',
  'function totalXLPs() view returns (uint256)',
])

export const LIQUIDITY_AGGREGATOR_ABI = parseAbi([
  'function getBestQuote(address tokenIn, address tokenOut, uint256 amountIn) view returns ((uint8 poolType, address pool, uint256 amountOut, uint256 priceImpactBps, uint24 fee))',
  'function getAllQuotes(address tokenIn, address tokenOut, uint256 amountIn) view returns ((uint8 poolType, address pool, uint256 amountOut, uint256 priceImpactBps, uint24 fee)[])',
  'function getTotalLiquidity(address token0, address token1) view returns ((uint8 poolType, address pool, uint256 reserve0, uint256 reserve1, uint256 liquidity, uint24 fee)[])',
  'function v2Factory() view returns (address)',
  'function v3Factory() view returns (address)',
  'function paymaster() view returns (address)',
])

export const INPUT_SETTLER_ABI = parseAbi([
  'function openFor(((address originSettler, address user, uint256 nonce, uint256 originChainId, uint32 openDeadline, uint32 fillDeadline, bytes32 orderDataType, bytes orderData) order, bytes signature, bytes originFillerData)) external',
  'function resolveFor(((address originSettler, address user, uint256 nonce, uint256 originChainId, uint32 openDeadline, uint32 fillDeadline, bytes32 orderDataType, bytes orderData) order, bytes signature, bytes originFillerData)) view returns ((address user, uint256 originChainId, uint32 openDeadline, uint32 fillDeadline, bytes32 orderId, (address token, uint256 amount, address recipient, uint256 chainId)[] maxSpent, (address token, uint256 amount, address recipient, uint256 chainId)[] minReceived, (uint256 destinationChainId, address destinationSettler, bytes originData)[] fillInstructions))',
])

export const OUTPUT_SETTLER_ABI = parseAbi([
  'function fill(bytes32 orderId, bytes originData, bytes fillerData) external',
  'function claim(bytes32[] orderIds, bytes[] attestations) external',
])

// ============ Types ============

export interface XLPProfile {
  address: Address
  supportedChains: ChainId[]
  totalProvided: bigint
  totalEarned: bigint
  registeredAt: number
  isActive: boolean
}

export interface LiquidityRequest {
  requestId: `0x${string}`
  requester: Address
  token: Address
  amount: bigint
  sourceChainId: ChainId
  targetChainId: ChainId
  createdAt: number
  deadline: number
  fulfilled: boolean
  fulfiller: Address
}

export interface NetworkLiquidity {
  chainId: ChainId
  vault: Address
  ethLiquidity: bigint
  tokenLiquidity: bigint
  utilizationBps: number
  lastUpdated: number
}

export interface XLPConfig {
  chainId: ChainId
  rpcUrl: string
  privateKey: string
  federatedLiquidityAddress: Address
  liquidityAggregatorAddress: Address
  inputSettlerAddress?: Address
  outputSettlerAddress?: Address
}

// ============ XLP Manager ============

export class XLPManager {
  private config: XLPConfig
  private publicClient: PublicClient
  private walletClient: WalletClient
  private account: PrivateKeyAccount
  private chain: Chain

  constructor(config: XLPConfig) {
    this.config = config
    this.account = privateKeyToAccount(config.privateKey as `0x${string}`)

    this.chain = {
      id: config.chainId,
      name: `Chain ${config.chainId}`,
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [config.rpcUrl] } },
    }

    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(config.rpcUrl),
    })

    this.walletClient = createWalletClient({
      account: this.account,
      chain: this.chain,
      transport: http(config.rpcUrl),
    })
  }

  // ============ XLP Registration ============

  /**
   * Register as an XLP for the given chains
   */
  async registerAsXLP(supportedChains: ChainId[]): Promise<`0x${string}`> {
    const hash = await this.walletClient.writeContract({
      address: this.config.federatedLiquidityAddress,
      abi: FEDERATED_LIQUIDITY_ABI,
      functionName: 'registerXLP',
      args: [supportedChains.map(BigInt)],
      chain: this.chain,
      account: this.account,
    })

    return hash
  }

  /**
   * Deactivate XLP status
   */
  async deactivateXLP(): Promise<`0x${string}`> {
    const hash = await this.walletClient.writeContract({
      address: this.config.federatedLiquidityAddress,
      abi: FEDERATED_LIQUIDITY_ABI,
      functionName: 'deactivateXLP',
      args: [],
      chain: this.chain,
      account: this.account,
    })

    return hash
  }

  /**
   * Get XLP profile
   */
  async getXLPProfile(address?: Address): Promise<XLPProfile | null> {
    const xlpAddress = address ?? this.account.address

    const result = (await this.publicClient.readContract({
      address: this.config.federatedLiquidityAddress,
      abi: FEDERATED_LIQUIDITY_ABI,
      functionName: 'getXLP',
      args: [xlpAddress],
    })) as {
      provider: Address
      supportedChains: readonly bigint[]
      totalProvided: bigint
      totalEarned: bigint
      registeredAt: bigint
      isActive: boolean
    }

    if (result.registeredAt === 0n) return null // Not registered

    return {
      address: result.provider,
      supportedChains: result.supportedChains.map((n) => Number(n) as ChainId),
      totalProvided: result.totalProvided,
      totalEarned: result.totalEarned,
      registeredAt: Number(result.registeredAt),
      isActive: result.isActive,
    }
  }

  /**
   * Get all active XLPs
   */
  async getActiveXLPs(): Promise<Address[]> {
    return (await this.publicClient.readContract({
      address: this.config.federatedLiquidityAddress,
      abi: FEDERATED_LIQUIDITY_ABI,
      functionName: 'getActiveXLPs',
    })) as Address[]
  }

  /**
   * Get XLPs for a specific route
   */
  async getXLPsForRoute(
    sourceChain: ChainId,
    destChain: ChainId,
  ): Promise<Address[]> {
    return (await this.publicClient.readContract({
      address: this.config.federatedLiquidityAddress,
      abi: FEDERATED_LIQUIDITY_ABI,
      functionName: 'getXLPsForRoute',
      args: [BigInt(sourceChain), BigInt(destChain)],
    })) as Address[]
  }

  // ============ Liquidity Requests ============

  /**
   * Create a liquidity request
   */
  async createRequest(
    token: Address,
    amount: bigint,
    targetChainId: ChainId,
  ): Promise<`0x${string}`> {
    const value =
      token === '0x0000000000000000000000000000000000000000' ? amount : 0n

    const hash = await this.walletClient.writeContract({
      address: this.config.federatedLiquidityAddress,
      abi: FEDERATED_LIQUIDITY_ABI,
      functionName: 'createRequest',
      args: [token, amount, BigInt(targetChainId)],
      value,
      chain: this.chain,
      account: this.account,
    })

    return hash
  }

  /**
   * Fulfill a pending liquidity request (as XLP)
   */
  async fulfillRequest(
    requestId: `0x${string}`,
    proof: `0x${string}`,
  ): Promise<`0x${string}`> {
    const hash = await this.walletClient.writeContract({
      address: this.config.federatedLiquidityAddress,
      abi: FEDERATED_LIQUIDITY_ABI,
      functionName: 'fulfillRequest',
      args: [requestId, proof],
      chain: this.chain,
      account: this.account,
    })

    return hash
  }

  /**
   * Get all pending requests
   */
  async getPendingRequests(): Promise<LiquidityRequest[]> {
    const requestIds = (await this.publicClient.readContract({
      address: this.config.federatedLiquidityAddress,
      abi: FEDERATED_LIQUIDITY_ABI,
      functionName: 'getPendingRequests',
    })) as `0x${string}`[]

    const requests: LiquidityRequest[] = []

    for (const requestId of requestIds) {
      const req = await this.getRequest(requestId)
      if (req) requests.push(req)
    }

    return requests
  }

  /**
   * Get a specific request
   */
  async getRequest(requestId: `0x${string}`): Promise<LiquidityRequest | null> {
    const result = (await this.publicClient.readContract({
      address: this.config.federatedLiquidityAddress,
      abi: FEDERATED_LIQUIDITY_ABI,
      functionName: 'getRequest',
      args: [requestId],
    })) as {
      requestId: `0x${string}`
      requester: Address
      token: Address
      amount: bigint
      sourceChainId: bigint
      targetChainId: bigint
      createdAt: bigint
      deadline: bigint
      fulfilled: boolean
      fulfiller: Address
    }

    if (result.createdAt === 0n) return null

    return {
      requestId: result.requestId,
      requester: result.requester,
      token: result.token,
      amount: result.amount,
      sourceChainId: Number(result.sourceChainId) as ChainId,
      targetChainId: Number(result.targetChainId) as ChainId,
      createdAt: Number(result.createdAt),
      deadline: Number(result.deadline),
      fulfilled: result.fulfilled,
      fulfiller: result.fulfiller,
    }
  }

  // ============ Network Liquidity ============

  /**
   * Get liquidity for a specific network
   */
  async getNetworkLiquidity(chainId: ChainId): Promise<NetworkLiquidity> {
    const result = (await this.publicClient.readContract({
      address: this.config.federatedLiquidityAddress,
      abi: FEDERATED_LIQUIDITY_ABI,
      functionName: 'getNetworkLiquidity',
      args: [BigInt(chainId)],
    })) as {
      chainId: bigint
      vault: Address
      ethLiquidity: bigint
      tokenLiquidity: bigint
      utilizationBps: bigint
      lastUpdated: bigint
    }

    return {
      chainId: Number(result.chainId) as ChainId,
      vault: result.vault,
      ethLiquidity: result.ethLiquidity,
      tokenLiquidity: result.tokenLiquidity,
      utilizationBps: Number(result.utilizationBps),
      lastUpdated: Number(result.lastUpdated),
    }
  }

  /**
   * Get total federated liquidity across all networks
   */
  async getTotalFederatedLiquidity(): Promise<{
    totalEth: bigint
    totalToken: bigint
  }> {
    const [totalEth, totalToken] = (await this.publicClient.readContract({
      address: this.config.federatedLiquidityAddress,
      abi: FEDERATED_LIQUIDITY_ABI,
      functionName: 'getTotalFederatedLiquidity',
    })) as [bigint, bigint]

    return { totalEth, totalToken }
  }

  /**
   * Find the best network to source liquidity from
   */
  async getBestNetworkForLiquidity(
    amount: bigint,
  ): Promise<{ chainId: ChainId; available: bigint } | null> {
    const [bestChainId, available] = (await this.publicClient.readContract({
      address: this.config.federatedLiquidityAddress,
      abi: FEDERATED_LIQUIDITY_ABI,
      functionName: 'getBestNetworkForLiquidity',
      args: [amount],
    })) as [bigint, bigint]

    if (bestChainId === 0n) return null

    return { chainId: Number(bestChainId) as ChainId, available }
  }

  // ============ Liquidity Aggregator ============

  /**
   * Get best quote from the aggregator
   */
  async getBestQuote(
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint,
  ): Promise<{
    poolType: number
    pool: Address
    amountOut: bigint
    priceImpactBps: number
    fee: number
  } | null> {
    const result = (await this.publicClient.readContract({
      address: this.config.liquidityAggregatorAddress,
      abi: LIQUIDITY_AGGREGATOR_ABI,
      functionName: 'getBestQuote',
      args: [tokenIn, tokenOut, amountIn],
    })) as {
      poolType: number
      pool: Address
      amountOut: bigint
      priceImpactBps: bigint
      fee: number
    }

    if (result.amountOut === 0n) return null

    return {
      poolType: result.poolType,
      pool: result.pool,
      amountOut: result.amountOut,
      priceImpactBps: Number(result.priceImpactBps),
      fee: result.fee,
    }
  }

  // ============ XLP Profit Calculation ============

  /**
   * Calculate potential profit from fulfilling a request
   */
  async calculateFulfillmentProfit(request: LiquidityRequest): Promise<{
    estimatedProfit: bigint
    feeBps: number
    isProfitable: boolean
  }> {
    const feeBps = Number(
      await this.publicClient.readContract({
        address: this.config.federatedLiquidityAddress,
        abi: FEDERATED_LIQUIDITY_ABI,
        functionName: 'fulfillmentFeeBps',
      }),
    )

    const fee = (request.amount * BigInt(feeBps)) / 10000n

    // Estimate gas cost (simplified)
    const gasPrice = await this.publicClient.getGasPrice()
    const estimatedGas = 150000n // Approximate gas for fulfillment
    const gasCost = gasPrice * estimatedGas

    const profit = fee - gasCost

    return {
      estimatedProfit: profit,
      feeBps,
      isProfitable: profit > 0n,
    }
  }

  /**
   * Get XLP stats summary
   */
  async getXLPStats(): Promise<{
    totalXLPs: number
    activeXLPs: number
    totalEthLiquidity: bigint
    totalTokenLiquidity: bigint
    pendingRequests: number
  }> {
    const [totalXLPs, activeXLPs, { totalEth, totalToken }, pendingRequests] =
      await Promise.all([
        this.publicClient.readContract({
          address: this.config.federatedLiquidityAddress,
          abi: FEDERATED_LIQUIDITY_ABI,
          functionName: 'totalXLPs',
        }) as Promise<bigint>,
        this.getActiveXLPs(),
        this.getTotalFederatedLiquidity(),
        this.getPendingRequests(),
      ])

    return {
      totalXLPs: Number(totalXLPs),
      activeXLPs: activeXLPs.length,
      totalEthLiquidity: totalEth,
      totalTokenLiquidity: totalToken,
      pendingRequests: pendingRequests.length,
    }
  }
}

export { XLPManager as EILXLPManager }
