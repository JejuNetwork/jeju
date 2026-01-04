/** Futarchy - Prediction market escalation for vetoed proposals */

import { isProductionEnv } from '@jejunetwork/config'
import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  type PublicClient,
  parseAbi,
  type Transport,
  type WalletClient,
  zeroAddress,
  zeroHash,
} from 'viem'
import { type LocalAccount, privateKeyToAccount } from 'viem/accounts'
import { readContract, waitForTransactionReceipt } from 'viem/actions'
import { toAddress, toHex } from '../lib'
import { inferChainFromRpcUrl } from './chains'
import { createKMSHttpWalletClient } from './kms-signer'

const ZERO = zeroAddress
const ZERO32 = zeroHash

const BOARD_ABI = parseAbi([
  'function escalateToFutarchy(bytes32 proposalId) external',
  'function resolveFutarchy(bytes32 proposalId) external',
  'function executeFutarchyApproved(bytes32 proposalId) external',
  'function getVetoedProposals() external view returns (bytes32[])',
  'function getFutarchyPendingProposals() external view returns (bytes32[])',
  'function getFutarchyMarket(bytes32 proposalId) external view returns (bytes32 marketId, uint256 deadline, bool canResolve)',
  'function futarchyVotingPeriod() external view returns (uint256)',
  'function futarchyLiquidity() external view returns (uint256)',
])

const MARKET_ABI = parseAbi([
  'function getMarket(bytes32 sessionId) external view returns (bytes32, string, uint256, uint256, uint256, uint256, uint256, bool, bool, uint8, address, uint8)',
  'function getMarketPrices(bytes32 sessionId) external view returns (uint256 yesPrice, uint256 noPrice)',
  'function buyYes(bytes32 sessionId, uint256 amount) external',
  'function buyNo(bytes32 sessionId, uint256 amount) external',
])

export interface FutarchyMarket {
  proposalId: string
  marketId: string
  question: string
  yesPrice: number
  noPrice: number
  yesShares: string
  noShares: string
  totalVolume: string
  deadline: number
  canResolve: boolean
  resolved: boolean
  outcome: boolean | null
  createdAt: number
}

export interface FutarchyConfig {
  rpcUrl: string
  boardAddress: string
  predictionMarketAddress: string
  operatorKey?: string
}

type TxResult = {
  success: boolean
  txHash?: string
  error?: string
  approved?: boolean
}

export class FutarchyClient {
  private readonly client: PublicClient<Transport, Chain>
  private walletClient: WalletClient
  private account: LocalAccount | null
  private readonly chain: ReturnType<typeof inferChainFromRpcUrl>
  private readonly rpcUrl: string
  private readonly boardAddress: Address
  private readonly marketAddress: Address

  readonly boardDeployed: boolean
  readonly predictionMarketDeployed: boolean

  /**
   * Create a FutarchyClient instance.
   *
   * SECURITY: In production (mainnet/testnet), raw private keys are blocked.
   * Use FutarchyClient.create() which initializes KMS automatically.
   */
  constructor(config: FutarchyConfig) {
    const chain = inferChainFromRpcUrl(config.rpcUrl)
    this.chain = chain
    this.rpcUrl = config.rpcUrl
    this.client = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    }) as PublicClient<Transport, Chain>

    this.boardAddress = toAddress(config.boardAddress)
    this.marketAddress = toAddress(config.predictionMarketAddress)

    this.boardDeployed = config.boardAddress !== ZERO
    this.predictionMarketDeployed = config.predictionMarketAddress !== ZERO

    if (config.operatorKey) {
      const keyHex = toHex(config.operatorKey)

      // SECURITY: Block raw private keys in production
      if (keyHex.length === 66 && isProductionEnv()) {
        throw new Error(
          'SECURITY: Raw private keys are not allowed in production. ' +
            'Use FutarchyClient.create() with KMS or provide an address for KMS lookup.',
        )
      }

      if (keyHex.length === 66) {
        // Development only: Allow local signing with warning
        if (isProductionEnv()) {
          throw new Error(
            'SECURITY: Raw private keys are forbidden in production. Use KMS.',
          )
        }
        console.warn(
          '[FutarchyClient] ⚠️  Using local private key. NOT secure for production.',
        )
        this.account = privateKeyToAccount(keyHex)
        this.walletClient = createWalletClient({
          account: this.account,
          chain,
          transport: http(config.rpcUrl),
        }) as WalletClient<Transport, Chain>
      } else {
        // Address only - no local signing, must use KMS
        this.account = null
        this.walletClient = createWalletClient({
          chain,
          transport: http(config.rpcUrl),
        }) as WalletClient<Transport, Chain>
      }
    } else {
      this.account = null
      this.walletClient = createWalletClient({
        chain,
        transport: http(config.rpcUrl),
      }) as WalletClient<Transport, Chain>
    }
  }

  /**
   * Create a FutarchyClient with KMS initialized.
   * This is the recommended way to create a FutarchyClient in production.
   */
  static async create(
    config: FutarchyConfig,
    operatorAddress: Address,
  ): Promise<FutarchyClient> {
    const client = new FutarchyClient({
      ...config,
      operatorKey: undefined, // Don't use private key path
    })
    await client.initializeKMS(operatorAddress)
    return client
  }

  /**
   * Initialize KMS for secure threshold signing
   * Call this in production before any write operations
   */
  async initializeKMS(operatorAddress: Address): Promise<void> {
    const walletClient = await createKMSHttpWalletClient({
      address: operatorAddress,
      chain: this.chain,
      rpcUrl: this.rpcUrl,
    })
    if (!walletClient.chain) {
      throw new Error('Wallet client chain not configured')
    }
    this.walletClient = walletClient as WalletClient<Transport, Chain>
    console.log(
      `[FutarchyClient] KMS initialized for ${operatorAddress} (${walletClient.account?.type || 'local'})`,
    )
  }

  async getVetoedProposals(): Promise<`0x${string}`[]> {
    if (!this.boardDeployed) return []
    return readContract(this.client, {
      address: this.boardAddress,
      abi: BOARD_ABI,
      functionName: 'getVetoedProposals',
    }) as Promise<`0x${string}`[]>
  }

  async getPendingFutarchyProposals(): Promise<`0x${string}`[]> {
    if (!this.boardDeployed) return []
    return readContract(this.client, {
      address: this.boardAddress,
      abi: BOARD_ABI,
      functionName: 'getFutarchyPendingProposals',
    }) as Promise<`0x${string}`[]>
  }

  async getFutarchyMarket(proposalId: string): Promise<FutarchyMarket | null> {
    if (!this.boardDeployed || !this.predictionMarketDeployed) return null

    const result = (await readContract(this.client, {
      address: this.boardAddress,
      abi: BOARD_ABI,
      functionName: 'getFutarchyMarket',
      args: [toHex(proposalId)],
    })) as [`0x${string}`, bigint, boolean]
    const [marketId, deadline, canResolve] = result
    if (marketId === ZERO32) return null

    const marketResult = (await readContract(this.client, {
      address: this.marketAddress,
      abi: MARKET_ABI,
      functionName: 'getMarket',
      args: [marketId],
    })) as [
      `0x${string}`,
      string,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      boolean,
      boolean,
      number,
      Address,
      number,
    ]
    const [
      ,
      question,
      yesShares,
      noShares,
      ,
      totalVolume,
      createdAt,
      resolved,
      outcome,
    ] = marketResult

    const prices = (await readContract(this.client, {
      address: this.marketAddress,
      abi: MARKET_ABI,
      functionName: 'getMarketPrices',
      args: [marketId],
    })) as [bigint, bigint]
    const [yesPrice, noPrice] = prices

    return {
      proposalId,
      marketId,
      question,
      yesPrice: Number(yesPrice) / 100,
      noPrice: Number(noPrice) / 100,
      yesShares: formatEther(yesShares),
      noShares: formatEther(noShares),
      totalVolume: formatEther(totalVolume),
      deadline: Number(deadline),
      canResolve,
      resolved,
      outcome: resolved ? outcome : null,
      createdAt: Number(createdAt),
    }
  }

  async escalateToFutarchy(proposalId: string): Promise<TxResult> {
    if (!this.boardDeployed)
      return { success: false, error: 'Board not deployed' }
    if (!this.account) return { success: false, error: 'Wallet required' }

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.boardAddress,
      abi: BOARD_ABI,
      functionName: 'escalateToFutarchy',
      args: [toHex(proposalId)],
      account: this.account,
    })
    await waitForTransactionReceipt(this.client, { hash })
    return { success: true, txHash: hash }
  }

  async resolveFutarchy(proposalId: string): Promise<TxResult> {
    if (!this.boardDeployed)
      return { success: false, error: 'Board not deployed' }
    if (!this.account) return { success: false, error: 'Wallet required' }

    const m = await this.getFutarchyMarket(proposalId)
    if (!m) return { success: false, error: 'No market for proposal' }
    if (!m.canResolve)
      return {
        success: false,
        error: `Cannot resolve yet. Deadline: ${new Date(m.deadline * 1000).toISOString()}`,
      }

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.boardAddress,
      abi: BOARD_ABI,
      functionName: 'resolveFutarchy',
      args: [toHex(proposalId)],
      account: this.account,
    })
    await waitForTransactionReceipt(this.client, { hash })
    return { success: true, approved: m.yesPrice > m.noPrice, txHash: hash }
  }

  async executeFutarchyApproved(proposalId: string): Promise<TxResult> {
    if (!this.boardDeployed)
      return { success: false, error: 'Board not deployed' }
    if (!this.account) return { success: false, error: 'Wallet required' }

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.boardAddress,
      abi: BOARD_ABI,
      functionName: 'executeFutarchyApproved',
      args: [toHex(proposalId)],
      account: this.account,
    })
    await waitForTransactionReceipt(this.client, { hash })
    return { success: true, txHash: hash }
  }

  async getFutarchyParameters(): Promise<{
    votingPeriod: number
    liquidity: string
  } | null> {
    if (!this.boardDeployed) return null

    const [period, liq] = await Promise.all([
      readContract(this.client, {
        address: this.boardAddress,
        abi: BOARD_ABI,
        functionName: 'futarchyVotingPeriod',
      }) as Promise<bigint>,
      readContract(this.client, {
        address: this.boardAddress,
        abi: BOARD_ABI,
        functionName: 'futarchyLiquidity',
      }) as Promise<bigint>,
    ])
    return { votingPeriod: Number(period), liquidity: formatEther(liq) }
  }

  async buyPosition(
    marketId: `0x${string}`,
    position: 'yes' | 'no',
    amount: bigint,
  ): Promise<`0x${string}`> {
    if (!this.predictionMarketDeployed)
      throw new Error('PredictionMarket not deployed')
    if (!this.account) throw new Error('Wallet required')

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.marketAddress,
      abi: MARKET_ABI,
      functionName: position === 'yes' ? 'buyYes' : 'buyNo',
      args: [marketId, amount],
      account: this.account,
    })
    await waitForTransactionReceipt(this.client, { hash })
    return hash
  }

  async getMarketSentiment(proposalId: string): Promise<{
    sentiment: 'bullish' | 'bearish' | 'neutral'
    confidence: number
  } | null> {
    const m = await this.getFutarchyMarket(proposalId)
    if (!m) return null

    const diff = m.yesPrice - m.noPrice
    return diff > 5
      ? { sentiment: 'bullish', confidence: Math.abs(diff) * 100 }
      : diff < -5
        ? { sentiment: 'bearish', confidence: Math.abs(diff) * 100 }
        : { sentiment: 'neutral', confidence: Math.abs(diff) * 100 }
  }
}

let instance: FutarchyClient | null = null
export const getFutarchyClient = (config: FutarchyConfig) => {
  if (!instance) {
    instance = new FutarchyClient(config)
  }
  return instance
}
