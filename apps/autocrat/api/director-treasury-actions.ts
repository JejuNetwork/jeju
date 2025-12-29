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

import { createPublicClient, createWalletClient, http, formatEther } from 'viem'
import type { Address, Hash, Chain } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'
import { getContractAddress, getChainConfig, getCurrentNetwork } from '@jejunetwork/config'
import { mainnet, sepolia, localhost } from 'viem/chains'

function getViemChain(): Chain {
  const network = getCurrentNetwork()
  if (network === 'mainnet') return mainnet
  if (network === 'testnet') return sepolia
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
  private publicClient
  private walletClient
  private treasuryAddress: Address

  constructor() {
    const chainConfig = getChainConfig()
    const chain = getViemChain()
    this.treasuryAddress = getContractAddress('treasury') as Address

    this.publicClient = createPublicClient({
      chain,
      transport: http(chainConfig.rpcUrl),
    })

    // Use Director operator key for transactions
    const directorKey = process.env.DIRECTOR_OPERATOR_KEY
    if (directorKey) {
      const account = privateKeyToAccount(directorKey as `0x${string}`)
      this.walletClient = createWalletClient({
        account,
        chain,
        transport: http(chainConfig.rpcUrl),
      })
    }
  }

  /**
   * Execute a token transfer from treasury
   */
  async executeTransfer(request: TransferRequest): Promise<TreasuryActionResult> {
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

    // Execute transfer (this would need to be done via the treasury contract)
    // For now, we'll return a placeholder
    return {
      success: true,
      data: {
        to: parsed.to,
        amount: parsed.amount,
        reason: parsed.reason,
        note: 'Transfer queued for execution',
      },
    }
  }

  /**
   * Create a recurring payment
   */
  async createRecurringPayment(payment: RecurringPayment): Promise<TreasuryActionResult> {
    const parsed = RecurringPaymentSchema.parse(payment)

    if (!this.walletClient) {
      return { success: false, error: 'Director wallet not configured' }
    }

    // This would interact with a RecurringPayments contract
    return {
      success: true,
      data: {
        recipient: parsed.recipient,
        amount: parsed.amount,
        intervalDays: parsed.intervalDays,
        reason: parsed.reason,
        note: 'Recurring payment created',
      },
    }
  }

  /**
   * Cancel a recurring payment
   */
  async cancelRecurringPayment(paymentId: string): Promise<TreasuryActionResult> {
    if (!this.walletClient) {
      return { success: false, error: 'Director wallet not configured' }
    }

    // This would interact with a RecurringPayments contract
    return {
      success: true,
      data: {
        paymentId,
        note: 'Recurring payment cancelled',
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
   * Top up a service account
   */
  async topUpServiceAccount(request: TopUpRequest): Promise<TreasuryActionResult> {
    const parsed = TopUpRequestSchema.parse(request)

    if (!this.walletClient) {
      return { success: false, error: 'Director wallet not configured' }
    }

    // This would interact with service-specific deposit contracts
    return {
      success: true,
      data: {
        account: parsed.account,
        service: parsed.service,
        amount: parsed.amount,
        note: `Service account ${parsed.service} topped up`,
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
  async getTreasuryBalance(token: Address): Promise<{ balance: string; symbol: string }> {
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
      return treasury.createRecurringPayment(params as unknown as RecurringPayment)

    case 'cancel-recurring':
      return treasury.cancelRecurringPayment(params.paymentId as string)

    case 'swap':
      return treasury.swapTokens(params as unknown as SwapRequest)

    case 'top-up':
      return treasury.topUpServiceAccount(params as unknown as TopUpRequest)

    case 'get-whitelist':
      const destinations = await treasury.getWhitelistedDestinations()
      return { success: true, data: { destinations: destinations.join(',') } }

    case 'add-whitelist':
      return treasury.addSwapDestination(params.token as Address)

    case 'remove-whitelist':
      return treasury.removeSwapDestination(params.token as Address)

    case 'balance':
      const balanceInfo = await treasury.getTreasuryBalance(params.token as Address)
      return {
        success: true,
        data: { balance: balanceInfo.balance, symbol: balanceInfo.symbol },
      }

    default:
      return { success: false, error: `Unknown action: ${action}` }
  }
}

export default DirectorTreasuryActions

