/**
 * Payment Integration
 *
 * x402 payment verification and account management
 */

import type { Address } from 'viem'
import { deposit, getAccount, getOrCreateAccount, withdraw } from './registry'
import type { DepositRequest, PaymentProof, WithdrawRequest } from './types'

// ============================================================================
// Payment Configuration
// ============================================================================

export interface PaymentConfig {
  /** Payment recipient address */
  paymentRecipient: Address
  /** Network ID for payment verification */
  networkId: number
  /** Token address for payments (native token = 0x0) */
  assetAddress: Address
}

const DEFAULT_CONFIG: PaymentConfig = {
  paymentRecipient: '0x0000000000000000000000000000000000000001' as Address,
  networkId: 420690, // Jeju testnet
  assetAddress: '0x0000000000000000000000000000000000000000' as Address, // Native token
}

let config = DEFAULT_CONFIG

/**
 * Configure payment settings
 */
export function configurePayments(newConfig: Partial<PaymentConfig>): void {
  config = { ...config, ...newConfig }
}

// ============================================================================
// x402 Payment Header Handling
// ============================================================================

/**
 * Create a 402 Payment Required response
 */
export function create402Response(
  amount: bigint,
  resource: string,
  description: string,
): {
  status: number
  headers: Record<string, string>
  body: Record<string, unknown>
} {
  return {
    status: 402,
    headers: {
      'Content-Type': 'application/json',
      'X-Payment-Required': 'true',
    },
    body: {
      x402Version: 1,
      error: 'Payment required',
      accepts: [
        {
          scheme: 'exact',
          network: `eip155:${config.networkId}`,
          maxAmountRequired: amount.toString(),
          asset: config.assetAddress,
          payTo: config.paymentRecipient,
          resource,
          description,
        },
      ],
    },
  }
}

/**
 * Parse x402 payment proof from headers
 */
export function parsePaymentProof(
  headers: Record<string, string>,
): PaymentProof | null {
  const proofHeader = headers['x-payment-proof'] || headers['X-Payment-Proof']
  if (!proofHeader) return null

  // Format: txHash:amount:payer:timestamp
  const parts = proofHeader.split(':')
  if (parts.length < 4) return null

  const [txHash, amountStr, payer, timestampStr] = parts

  return {
    txHash,
    amount: BigInt(amountStr || '0'),
    payer: payer as Address,
    timestamp: parseInt(timestampStr || '0', 10),
  }
}

/**
 * Verify a payment proof
 * In production, this would verify on-chain
 */
export async function verifyPaymentProof(
  proof: PaymentProof,
  expectedAmount: bigint,
): Promise<{ valid: boolean; error?: string }> {
  // Basic validation
  if (!proof.txHash || proof.txHash.length !== 66) {
    return { valid: false, error: 'Invalid transaction hash' }
  }

  if (proof.amount < expectedAmount) {
    return {
      valid: false,
      error: `Insufficient amount: got ${proof.amount}, need ${expectedAmount}`,
    }
  }

  // Check timestamp (must be recent - within 5 minutes)
  const fiveMinutesAgo = Date.now() - 300000
  if (proof.timestamp < fiveMinutesAgo) {
    return { valid: false, error: 'Payment proof expired' }
  }

  // In production: verify on-chain that:
  // 1. Transaction exists and is confirmed
  // 2. Amount and recipient match
  // 3. Transaction hasn't been used before (prevent replay)

  return { valid: true }
}

// ============================================================================
// Account Balance Operations
// ============================================================================

/**
 * Process a deposit
 */
export async function processDeposit(
  request: DepositRequest,
  proof?: PaymentProof,
): Promise<{ success: boolean; newBalance: bigint; error?: string }> {
  // If proof provided, verify it
  if (proof) {
    const verification = await verifyPaymentProof(proof, request.amount)
    if (!verification.valid) {
      return { success: false, newBalance: 0n, error: verification.error }
    }

    // Verify payer matches
    if (proof.payer.toLowerCase() !== request.payer.toLowerCase()) {
      return { success: false, newBalance: 0n, error: 'Payer mismatch' }
    }
  }

  // Credit account
  const account = await deposit(request.payer, request.amount)

  return { success: true, newBalance: account.balance }
}

/**
 * Process a withdrawal
 */
export async function processWithdraw(
  request: WithdrawRequest,
  requester: Address,
): Promise<{ success: boolean; remainingBalance: bigint; error?: string }> {
  // Only owner can withdraw
  if (requester.toLowerCase() !== request.recipient.toLowerCase()) {
    return { success: false, remainingBalance: 0n, error: 'Unauthorized' }
  }

  try {
    const account = await withdraw(request.recipient, request.amount)
    return { success: true, remainingBalance: account.balance }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Withdrawal failed'
    return { success: false, remainingBalance: 0n, error: message }
  }
}

/**
 * Get account balance
 */
export async function getBalance(address: Address): Promise<bigint> {
  const account = await getAccount(address)
  return account?.balance ?? 0n
}

/**
 * Get full account info
 */
export async function getAccountInfo(address: Address): Promise<{
  balance: bigint
  totalSpent: bigint
  totalRequests: bigint
}> {
  const account = await getOrCreateAccount(address)
  return {
    balance: account.balance,
    totalSpent: account.totalSpent,
    totalRequests: account.totalRequests,
  }
}

// ============================================================================
// Minimum Deposit
// ============================================================================

const MINIMUM_DEPOSIT = 1000000000000000n // 0.001 ETH

/**
 * Check if deposit meets minimum
 */
export function meetsMinimumDeposit(amount: bigint): boolean {
  return amount >= MINIMUM_DEPOSIT
}

/**
 * Get minimum deposit amount
 */
export function getMinimumDeposit(): bigint {
  return MINIMUM_DEPOSIT
}

// ============================================================================
// Price Estimation
// ============================================================================

/**
 * Estimate cost for a number of requests
 */
export function estimateCost(
  pricePerRequest: bigint,
  requestCount: number,
): bigint {
  return pricePerRequest * BigInt(requestCount)
}

/**
 * Calculate how many requests a balance can afford
 */
export function calculateAffordableRequests(
  balance: bigint,
  pricePerRequest: bigint,
): bigint {
  if (pricePerRequest === 0n) return BigInt(Number.MAX_SAFE_INTEGER)
  return balance / pricePerRequest
}

// ============================================================================
// Revenue Distribution
// ============================================================================

interface RevenueShare {
  seller: bigint
  platform: bigint
  total: bigint
}

const PLATFORM_FEE_BPS = 500n // 5%

/**
 * Calculate revenue distribution for a payment
 */
export function calculateRevenueShare(amount: bigint): RevenueShare {
  const platformFee = (amount * PLATFORM_FEE_BPS) / 10000n
  const sellerShare = amount - platformFee

  return {
    seller: sellerShare,
    platform: platformFee,
    total: amount,
  }
}

/**
 * Get platform fee in basis points
 */
export function getPlatformFeeBps(): bigint {
  return PLATFORM_FEE_BPS
}
