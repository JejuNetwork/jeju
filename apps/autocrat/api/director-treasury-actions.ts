/**
 * Director Treasury Control Actions
 *
 * API actions that allow the Director to control treasury operations:
 * - Token transfers
 * - Recurring payments (create/cancel)
 * - Token swaps (destination whitelist only)
 * - Service payments
 * - Account top-ups
 *
 * All actions require Director role verification and are executed via
 * the Treasury contract with proper access control.
 */

import {
  getChainConfig,
  getContractAddress,
  getCurrentNetwork,
} from '@jejunetwork/config'
import type { Address, Chain, Hash, WalletClient } from 'viem'
import {
  createPublicClient,
  formatEther,
  http,
  type PublicClient,
  type Transport,
} from 'viem'
import { z } from 'zod'
import { jejuMainnet, jejuTestnet, localhost } from './chains'
import { getDirectorSigner } from './secrets'

function getViemChain(): Chain {
  const network = getCurrentNetwork()
  if (network === 'mainnet') return jejuMainnet
  if (network === 'testnet') return jejuTestnet
  return localhost
}

// ============ Types ============

const TransferRequestSchema = z.object({
  to: z.string().startsWith('0x'),
  token: z.string().startsWith('0x'),
  amount: z.string(), // In wei
  reason: z.string(),
})

const RecurringPaymentSchema = z.object({
  recipient: z.string().startsWith('0x'),
  token: z.string().startsWith('0x'),
  amount: z.string(), // In wei
  intervalDays: z.number().min(1).max(365),
  reason: z.string(),
})

const SwapRequestSchema = z.object({
  tokenIn: z.string().startsWith('0x'),
  tokenOut: z.string().startsWith('0x'), // Must be whitelisted
  amountIn: z.string(), // In wei
  minAmountOut: z.string(), // In wei
  poolFee: z.number().optional().default(3000), // Uniswap V3 fee tier
})

const TopUpRequestSchema = z.object({
  account: z.string().startsWith('0x'),
  token: z.string().startsWith('0x'),
  amount: z.string(),
  service: z.string(), // e.g., 'compute', 'storage', 'inference'
})

type TransferRequest = z.infer<typeof TransferRequestSchema>
type RecurringPayment = z.infer<typeof RecurringPaymentSchema>
type SwapRequest = z.infer<typeof SwapRequestSchema>
type TopUpRequest = z.infer<typeof TopUpRequestSchema>

interface TreasuryActionResult {
  success: boolean
  txHash?: Hash
  error?: string
  data?: Record<string, string | number | boolean>
}

// ============ ABI Fragments ============

const TREASURY_ABI = [
  {
    name: 'directorSendTokens',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'reason', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'createRecurringPayment',
    type: 'function',
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'interval', type: 'uint256' },
      { name: 'maxPayments', type: 'uint256' },
      { name: 'description', type: 'string' },
    ],
    outputs: [{ name: 'paymentId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'cancelRecurringPayment',
    type: 'function',
    inputs: [{ name: 'paymentId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'topUpAccount',
    type: 'function',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'swapTokens',
    type: 'function',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'minAmountOut', type: 'uint256' },
      { name: 'poolFee', type: 'uint24' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'isValidSwapDestination',
    type: 'function',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    name: 'getWhitelistedSwapDestinations',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    name: 'whitelistSwapDestination',
    type: 'function',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'removeSwapDestination',
    type: 'function',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

const ERC20_ABI = [
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'symbol',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
] as const

// ============ Director Treasury Actions Class ============

export class DirectorTreasuryActions {
  private publicClient: PublicClient<Transport, Chain>
  private walletClient: WalletClient | null = null
  private directorAccount: Address | null = null
  private treasuryAddress: Address
  private chain: Chain
  private rpcUrl: string
  private initialized = false

  constructor() {
    const chainConfig = getChainConfig()
    this.chain = getViemChain()
    this.rpcUrl = chainConfig.rpcUrl
    this.treasuryAddress = getContractAddress('treasury') as Address

    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(this.rpcUrl),
    }) as PublicClient<Transport, Chain>
  }

  /**
   * Initialize the KMS-based director signer
   * Must be called before any write operations
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      const signer = await getDirectorSigner()
      this.walletClient = await signer.getWalletClient(this.chain, this.rpcUrl)
      this.directorAccount = signer.getAddress()
      this.initialized = true
    } catch (error) {
      console.warn(
        '[DirectorTreasury] KMS signer not available:',
        (error as Error).message,
      )
    }
  }

  /**
   * Execute a token transfer from treasury via directorSendTokens
   */
  async executeTransfer(
    request: TransferRequest,
  ): Promise<TreasuryActionResult> {
    const parsed = TransferRequestSchema.parse(request)

    if (!this.walletClient) {
      return { success: false, error: 'Director wallet not configured' }
    }

    // Check treasury balance
    const balance = await this.publicClient.readContract({
      address: parsed.token as Address,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [this.treasuryAddress],
    })

    const amount = BigInt(parsed.amount)
    if (balance < amount) {
      return {
        success: false,
        error: `Insufficient treasury balance: ${formatEther(balance)} < ${formatEther(amount)}`,
      }
    }

    // Execute transfer via Treasury contract
    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      account: this.directorAccount!,
      address: this.treasuryAddress,
      abi: TREASURY_ABI,
      functionName: 'directorSendTokens',
      args: [
        parsed.to as Address,
        parsed.token as Address,
        amount,
        parsed.reason,
      ],
    })

    return {
      success: true,
      txHash: hash,
      data: {
        to: parsed.to,
        token: parsed.token,
        amount: parsed.amount,
        reason: parsed.reason,
      },
    }
  }

  /**
   * Create a recurring payment via Treasury contract
   */
  async createRecurringPayment(
    payment: RecurringPayment,
  ): Promise<TreasuryActionResult> {
    const parsed = RecurringPaymentSchema.parse(payment)

    if (!this.walletClient) {
      return { success: false, error: 'Director wallet not configured' }
    }

    // Convert intervalDays to seconds
    const intervalSeconds = BigInt(parsed.intervalDays * 24 * 60 * 60)

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      account: this.directorAccount!,
      address: this.treasuryAddress,
      abi: TREASURY_ABI,
      functionName: 'createRecurringPayment',
      args: [
        parsed.recipient as Address,
        parsed.token as Address,
        BigInt(parsed.amount),
        intervalSeconds,
        0n, // maxPayments (0 = unlimited)
        parsed.reason, // description
      ],
    })

    return {
      success: true,
      txHash: hash,
      data: {
        recipient: parsed.recipient,
        token: parsed.token,
        amount: parsed.amount,
        intervalDays: parsed.intervalDays,
        reason: parsed.reason,
      },
    }
  }

  /**
   * Cancel a recurring payment via Treasury contract
   */
  async cancelRecurringPayment(
    paymentId: string,
  ): Promise<TreasuryActionResult> {
    if (!this.walletClient) {
      return { success: false, error: 'Director wallet not configured' }
    }

    // paymentId should be a bytes32 hex string
    if (!paymentId.startsWith('0x') || paymentId.length !== 66) {
      return {
        success: false,
        error: 'Invalid payment ID format (expected bytes32 hex)',
      }
    }

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      account: this.directorAccount!,
      address: this.treasuryAddress,
      abi: TREASURY_ABI,
      functionName: 'cancelRecurringPayment',
      args: [paymentId as `0x${string}`],
    })

    return {
      success: true,
      txHash: hash,
      data: {
        paymentId,
      },
    }
  }

  /**
   * Swap tokens via Treasury (destination must be whitelisted)
   */
  async swapTokens(request: SwapRequest): Promise<TreasuryActionResult> {
    const parsed = SwapRequestSchema.parse(request)

    if (!this.walletClient) {
      return { success: false, error: 'Director wallet not configured' }
    }

    // Check if destination is whitelisted
    const isWhitelisted = await this.publicClient.readContract({
      address: this.treasuryAddress,
      abi: TREASURY_ABI,
      functionName: 'isValidSwapDestination',
      args: [parsed.tokenOut as Address],
    })

    if (!isWhitelisted) {
      return {
        success: false,
        error: `Token ${parsed.tokenOut} is not a whitelisted swap destination. Cannot swap INTO low-value/low-liquidity tokens.`,
      }
    }

    // Execute swap
    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      account: this.directorAccount!,
      address: this.treasuryAddress,
      abi: TREASURY_ABI,
      functionName: 'swapTokens',
      args: [
        parsed.tokenIn as Address,
        parsed.tokenOut as Address,
        BigInt(parsed.amountIn),
        BigInt(parsed.minAmountOut),
        parsed.poolFee,
      ],
    })

    return {
      success: true,
      txHash: hash,
      data: {
        tokenIn: parsed.tokenIn,
        tokenOut: parsed.tokenOut,
        amountIn: parsed.amountIn,
      },
    }
  }

  /**
   * Top up a service account via Treasury contract
   */
  async topUpServiceAccount(
    request: TopUpRequest,
  ): Promise<TreasuryActionResult> {
    const parsed = TopUpRequestSchema.parse(request)

    if (!this.walletClient) {
      return { success: false, error: 'Director wallet not configured' }
    }

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      account: this.directorAccount!,
      address: this.treasuryAddress,
      abi: TREASURY_ABI,
      functionName: 'topUpAccount',
      args: [
        parsed.account as Address,
        parsed.token as Address,
        BigInt(parsed.amount),
      ],
    })

    return {
      success: true,
      txHash: hash,
      data: {
        account: parsed.account,
        token: parsed.token,
        service: parsed.service,
        amount: parsed.amount,
      },
    }
  }

  /**
   * Get whitelisted swap destinations
   */
  async getWhitelistedDestinations(): Promise<Address[]> {
    const destinations = await this.publicClient.readContract({
      address: this.treasuryAddress,
      abi: TREASURY_ABI,
      functionName: 'getWhitelistedSwapDestinations',
    })
    return destinations as Address[]
  }

  /**
   * Add a token to swap whitelist (Board role required)
   */
  async addSwapDestination(token: Address): Promise<TreasuryActionResult> {
    if (!this.walletClient) {
      return { success: false, error: 'Director wallet not configured' }
    }

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      account: this.directorAccount!,
      address: this.treasuryAddress,
      abi: TREASURY_ABI,
      functionName: 'whitelistSwapDestination',
      args: [token],
    })

    return {
      success: true,
      txHash: hash,
      data: { token, note: 'Added to swap whitelist' },
    }
  }

  /**
   * Remove a token from swap whitelist (Board role required)
   */
  async removeSwapDestination(token: Address): Promise<TreasuryActionResult> {
    if (!this.walletClient) {
      return { success: false, error: 'Director wallet not configured' }
    }

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      account: this.directorAccount!,
      address: this.treasuryAddress,
      abi: TREASURY_ABI,
      functionName: 'removeSwapDestination',
      args: [token],
    })

    return {
      success: true,
      txHash: hash,
      data: { token, note: 'Removed from swap whitelist' },
    }
  }

  /**
   * Get treasury token balance
   */
  async getTreasuryBalance(
    token: Address,
  ): Promise<{ balance: string; symbol: string }> {
    const [balance, symbol] = await Promise.all([
      this.publicClient.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [this.treasuryAddress],
      }),
      this.publicClient.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: 'symbol',
      }),
    ])

    return {
      balance: formatEther(balance),
      symbol: symbol as string,
    }
  }
}

// ============ API Route Handlers ============

export async function handleDirectorTreasuryAction(
  action: string,
  params: Record<string, string | number>,
): Promise<TreasuryActionResult> {
  const treasury = new DirectorTreasuryActions()

  switch (action) {
    case 'transfer':
      return treasury.executeTransfer(params as unknown as TransferRequest)

    case 'create-recurring':
      return treasury.createRecurringPayment(
        params as unknown as RecurringPayment,
      )

    case 'cancel-recurring':
      return treasury.cancelRecurringPayment(params.paymentId as string)

    case 'swap':
      return treasury.swapTokens(params as unknown as SwapRequest)

    case 'top-up':
      return treasury.topUpServiceAccount(params as unknown as TopUpRequest)

    case 'get-whitelist': {
      const destinations = await treasury.getWhitelistedDestinations()
      return { success: true, data: { destinations: destinations.join(',') } }
    }

    case 'add-whitelist':
      return treasury.addSwapDestination(params.token as Address)

    case 'remove-whitelist':
      return treasury.removeSwapDestination(params.token as Address)

    case 'balance': {
      const balanceInfo = await treasury.getTreasuryBalance(
        params.token as Address,
      )
      return {
        success: true,
        data: { balance: balanceInfo.balance, symbol: balanceInfo.symbol },
      }
    }

    default:
      return { success: false, error: `Unknown action: ${action}` }
  }
}

export default DirectorTreasuryActions
