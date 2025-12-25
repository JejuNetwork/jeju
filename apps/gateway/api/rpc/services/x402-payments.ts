import { getRpcUrl } from '@jejunetwork/config'
import type {
  X402Network,
  X402PaymentHeader,
  X402PaymentOption,
  X402PaymentRequirement,
} from '@jejunetwork/shared'
import { expectValid, ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import { createPublicClient, hashMessage, http, recoverAddress } from 'viem'
import { X402PaymentProofSchema } from '../../../lib/validation'
import { initializeState, x402State } from '../../services/state'

export type {
  X402Network,
  X402PaymentHeader,
  X402PaymentOption,
  X402PaymentRequirement,
}

const paymentRecipientEnv = process.env.RPC_PAYMENT_RECIPIENT
const PAYMENT_RECIPIENT: Address =
  paymentRecipientEnv?.startsWith('0x') && paymentRecipientEnv.length === 42
    ? (paymentRecipientEnv as Address)
    : ZERO_ADDRESS
const X402_ENABLED = process.env.X402_ENABLED !== 'false'

export const RPC_PRICING = {
  standard: 100n,
  archive: 500n,
  trace: 1000n,
} as const

initializeState().catch(console.error)

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

  const proof = expectValid(
    X402PaymentProofSchema,
    JSON.parse(payment.payload),
    'x402 payment proof',
  )
  const nonceKey = `${userAddress}:${proof.nonce}`

  if (proof.payTo.toLowerCase() !== PAYMENT_RECIPIENT.toLowerCase())
    return { valid: false, error: 'Wrong recipient' }
  if (await x402State.isNonceUsed(nonceKey))
    return { valid: false, error: 'Nonce reused' }
  if (Date.now() / 1000 - proof.timestamp > 300)
    return { valid: false, error: 'Expired' }

  const message = `x402:rpc:${proof.network}:${proof.payTo}:${proof.amount}:${proof.nonce}:${proof.timestamp}`
  if (!proof.signature.startsWith('0x')) {
    return { valid: false, error: 'Invalid signature format' }
  }
  const recovered = await recoverAddress({
    hash: hashMessage(message),
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

const RPC_URL = getRpcUrl()

interface CreditPurchaseResult {
  success: boolean
  newBalance: bigint
  error?: string
}

/**
 * Verify and process a credit purchase by checking the transaction on-chain.
 * This prevents fake credit claims by verifying:
 * 1. Transaction exists and succeeded
 * 2. Transaction was sent by the claimed address
 * 3. CreditsPurchased event was emitted with matching amount
 */
export async function purchaseCredits(
  addr: string,
  txHash: Hex,
  expectedAmount: bigint,
): Promise<CreditPurchaseResult> {
  const client = createPublicClient({
    transport: http(RPC_URL),
  })

  // Get transaction receipt to verify it succeeded
  const receipt = await client.getTransactionReceipt({ hash: txHash })

  if (receipt.status !== 'success') {
    return {
      success: false,
      newBalance: await getCredits(addr),
      error: 'Transaction failed on-chain',
    }
  }

  // Get the original transaction to verify sender
  const tx = await client.getTransaction({ hash: txHash })
  if (tx.from.toLowerCase() !== addr.toLowerCase()) {
    return {
      success: false,
      newBalance: await getCredits(addr),
      error: `Transaction sender mismatch: expected ${addr}, got ${tx.from}`,
    }
  }

  // Parse logs to find CreditsPurchased event
  let purchasedAmount: bigint | null = null
  for (const log of receipt.logs) {
    // Check for CreditsPurchased event signature
    const eventSignature =
      '0x' +
      Buffer.from('CreditsPurchased(address,uint256,bytes32)').toString('hex')
    if (log.topics[0]?.startsWith(eventSignature.slice(0, 10))) {
      // Decode the amount from the log data
      const amountHex = log.data.slice(0, 66) // First 32 bytes
      purchasedAmount = BigInt(amountHex)
      break
    }
  }

  // Fallback: check if tx value matches expected amount (for simple ETH transfers)
  if (purchasedAmount === null && tx.value > 0n) {
    purchasedAmount = tx.value
  }

  if (purchasedAmount === null) {
    return {
      success: false,
      newBalance: await getCredits(addr),
      error: 'No credit purchase event found in transaction',
    }
  }

  if (purchasedAmount < expectedAmount) {
    return {
      success: false,
      newBalance: await getCredits(addr),
      error: `Insufficient amount: got ${purchasedAmount}, expected ${expectedAmount}`,
    }
  }

  // All checks passed - add credits
  const newBalance = await addCredits(addr, purchasedAmount)
  return { success: true, newBalance }
}
