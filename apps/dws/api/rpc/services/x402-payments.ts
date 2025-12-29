import {
  getCurrentNetwork,
  getRpcUrl,
  isProductionEnv,
} from '@jejunetwork/config'
import type {
  X402Network,
  X402PaymentHeader,
  X402PaymentOption,
  X402PaymentRequirement,
} from '@jejunetwork/shared'
import { expectJson, ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import { createPublicClient, hashMessage, http, recoverAddress } from 'viem'
import { z } from 'zod'
import { x402State } from '../../state.js'

export type {
  X402Network,
  X402PaymentHeader,
  X402PaymentOption,
  X402PaymentRequirement,
}

// State initialization is handled by main server startup

const X402PaymentProofSchema = z.object({
  payTo: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.string(),
  nonce: z.string(),
  timestamp: z.number(),
  network: z.string(),
  signature: z.string(),
})

import { createAppConfig } from '@jejunetwork/config'

interface X402PaymentsConfig {
  paymentRecipient?: Address
  x402Enabled?: boolean
  [key: string]: Address | boolean | undefined
}

const { config: x402Config, configure: configureX402Payments } =
  createAppConfig<X402PaymentsConfig>({
    paymentRecipient: ZERO_ADDRESS,
    x402Enabled: true,
  })

export function configureX402PaymentsConfig(
  config: Partial<X402PaymentsConfig>,
): void {
  configureX402Payments(config)
}

const PAYMENT_RECIPIENT = (x402Config.paymentRecipient ||
  ZERO_ADDRESS) as Address
const X402_ENABLED = x402Config.x402Enabled ?? true

export const RPC_PRICING = {
  standard: 100n,
  archive: 500n,
  trace: 1000n,
} as const

export const isX402Enabled = () =>
  X402_ENABLED && PAYMENT_RECIPIENT !== ZERO_ADDRESS

export function getMethodPrice(method: string): bigint {
  if (method.startsWith('debug_') || method.startsWith('trace_'))
    return RPC_PRICING.trace
  if (method.includes('Archive') || method.includes('History'))
    return RPC_PRICING.archive
  return RPC_PRICING.standard
}

export function generatePaymentRequirement(
  chainId: number,
  method: string,
): X402PaymentRequirement {
  const price = getMethodPrice(method).toString()
  const resource = `rpc/${chainId}/${method}`
  const base = {
    network: 'jeju' as const,
    maxAmountRequired: price,
    asset: ZERO_ADDRESS,
    payTo: PAYMENT_RECIPIENT,
    resource,
  }

  return {
    x402Version: 1,
    error: 'Payment required for RPC access',
    accepts: [
      { ...base, scheme: 'exact', description: `RPC: ${method}` },
      { ...base, scheme: 'credit', description: 'Prepaid credits' },
    ],
  }
}

export function parseX402Header(header: string): X402PaymentHeader | null {
  const [scheme, network, payload, asset, amount] = header.split(':')
  return amount ? { scheme, network, payload, asset, amount } : null
}

export async function verifyX402Payment(
  payment: X402PaymentHeader,
  expectedAmount: bigint,
  userAddress?: string,
): Promise<{ valid: boolean; error?: string }> {
  if (BigInt(payment.amount) < expectedAmount)
    return { valid: false, error: 'Insufficient payment' }

  const proof = expectJson(
    payment.payload,
    X402PaymentProofSchema,
    'X402 payment proof',
  )
  const nonceKey = `${userAddress}:${proof.nonce}`

  if (proof.payTo.toLowerCase() !== PAYMENT_RECIPIENT.toLowerCase())
    return { valid: false, error: 'Wrong recipient' }
  if (await x402State.isNonceUsed(nonceKey))
    return { valid: false, error: 'Nonce reused' }
  if (Date.now() / 1000 - proof.timestamp > 300)
    return { valid: false, error: 'Expired' }

  const message = `x402:rpc:${proof.network}:${proof.payTo}:${proof.amount}:${proof.nonce}:${proof.timestamp}`
  const recovered = await recoverAddress({
    hash: hashMessage({ raw: message as `0x${string}` }),
    signature: proof.signature as `0x${string}`,
  })

  if (userAddress && recovered.toLowerCase() !== userAddress.toLowerCase())
    return { valid: false, error: 'Invalid signature' }

  await x402State.markNonceUsed(nonceKey)
  return { valid: true }
}

export async function getCredits(addr: string): Promise<bigint> {
  return x402State.getCredits(addr)
}

export async function addCredits(
  addr: string,
  amount: bigint,
): Promise<bigint> {
  await x402State.addCredits(addr, amount)
  return x402State.getCredits(addr)
}

export async function deductCredits(
  addr: string,
  amount: bigint,
): Promise<boolean> {
  return x402State.deductCredits(addr, amount)
}

export async function processPayment(
  paymentHeader: string | undefined,
  chainId: number,
  method: string,
  userAddress?: string,
): Promise<{
  allowed: boolean
  requirement?: X402PaymentRequirement
  error?: string
}> {
  if (!isX402Enabled()) return { allowed: true }

  const price = getMethodPrice(method)
  const deny = (error?: string) => ({
    allowed: false,
    requirement: generatePaymentRequirement(chainId, method),
    error,
  })

  if (userAddress) {
    const credits = await getCredits(userAddress)
    if (credits >= price) {
      await deductCredits(userAddress, price)
      return { allowed: true }
    }
  }

  if (!paymentHeader) return deny()

  const payment = parseX402Header(paymentHeader)
  if (!payment) return deny('Invalid header')

  const result = await verifyX402Payment(payment, price, userAddress)
  return result.valid ? { allowed: true } : deny(result.error)
}

export function getPaymentInfo() {
  return {
    enabled: isX402Enabled(),
    recipient: PAYMENT_RECIPIENT,
    pricing: RPC_PRICING,
    acceptedAssets: ['ETH', 'JEJU'],
  }
}

// Track used tx hashes to prevent replay
const usedCreditTxHashes = new Set<string>()

export async function purchaseCredits(
  addr: string,
  txHash: string,
  amount: bigint,
): Promise<{ success: boolean; newBalance?: bigint; error?: string }> {
  // Validate tx hash format
  if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return { success: false, error: 'Invalid transaction hash' }
  }

  // Check for replay
  const txHashLower = txHash.toLowerCase()
  if (usedCreditTxHashes.has(txHashLower)) {
    return { success: false, error: 'Transaction already used' }
  }

  // In production, verify the transaction on-chain
  if (isProductionEnv()) {
    const network = getCurrentNetwork()
    const rpcUrl =
      (typeof process !== 'undefined' ? process.env.RPC_URL : undefined) ??
      getRpcUrl(network)
    if (!rpcUrl) {
      return { success: false, error: 'RPC_URL not configured' }
    }

    const publicClient = createPublicClient({ transport: http(rpcUrl) })

    // Verify transaction exists and is confirmed
    const receipt = await publicClient
      .getTransactionReceipt({ hash: txHash as Hex })
      .catch(() => null)

    if (!receipt) {
      return { success: false, error: 'Transaction not found or not confirmed' }
    }

    if (receipt.status !== 'success') {
      return { success: false, error: 'Transaction failed' }
    }

    // Verify the transaction was to the payment recipient
    const tx = await publicClient
      .getTransaction({ hash: txHash as Hex })
      .catch(() => null)

    if (!tx) {
      return { success: false, error: 'Could not fetch transaction details' }
    }

    if (tx.to?.toLowerCase() !== PAYMENT_RECIPIENT.toLowerCase()) {
      return { success: false, error: 'Transaction recipient mismatch' }
    }

    if (tx.value < amount) {
      return { success: false, error: 'Transaction value insufficient' }
    }

    // Verify sender matches the address requesting credits
    if (tx.from.toLowerCase() !== addr.toLowerCase()) {
      return { success: false, error: 'Transaction sender mismatch' }
    }
  } else {
    console.warn(
      '[X402] Credit purchase verification skipped in non-production',
    )
  }

  // Mark tx hash as used
  usedCreditTxHashes.add(txHashLower)

  const newBalance = await addCredits(addr, amount)
  return { success: true, newBalance }
}
