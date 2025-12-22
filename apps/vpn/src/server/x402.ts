/**
 * x402 Payment Integration for VPN
 *
 * Enables micropayments for:
 * - Premium VPN tier
 * - Per-request proxy access
 * - Priority routing
 *
 * Uses fail-fast validation patterns
 */

import { Hono } from 'hono'
import { type Address, getAddress, type Hex } from 'viem'
import {
  expect,
  expectValid,
  X402CreateHeaderRequestSchema,
  X402PaymentPayloadSchema,
  X402VerifyRequestSchema,
} from './schemas'
import type { VPNServerConfig, VPNServiceContext } from './types'

// ============================================================================
// Types
// ============================================================================

export interface X402PaymentPayload {
  scheme: 'exact' | 'upto'
  network: string
  payTo: Address
  amount: string
  asset: Address
  resource: string
  nonce: string
  timestamp: number
  signature: Hex
}

export interface X402Receipt {
  paymentId: string
  amount: bigint
  payer: Address
  recipient: Address
  resource: string
  timestamp: number
  verified: boolean
}

// Track used nonces with expiration to prevent replay attacks
// Map stores nonce -> expiration timestamp
const usedNonces = new Map<string, number>()

// Nonce expiration time in seconds (10 minutes - double the max age for safety margin)
const NONCE_EXPIRATION_SECONDS = 600

// Cleanup interval in milliseconds (every minute for more aggressive cleanup)
const NONCE_CLEANUP_INTERVAL_MS = 60 * 1000

// Maximum nonces to store before forcing cleanup
const MAX_NONCES = 100000

// Warning threshold (80% of max) - start warning when approaching capacity
const NONCE_WARNING_THRESHOLD = 80000

// Cleanup expired nonces
function cleanupExpiredNonces(): void {
  const now = Math.floor(Date.now() / 1000)
  let cleanedCount = 0

  for (const [nonce, expiration] of usedNonces.entries()) {
    if (now > expiration) {
      usedNonces.delete(nonce)
      cleanedCount++
    }
  }

  if (cleanedCount > 0) {
    console.log(
      `Cleaned up ${cleanedCount} expired nonces. Remaining: ${usedNonces.size}`,
    )
  }

  // SECURITY: Log warning when approaching capacity (potential attack indicator)
  if (usedNonces.size > NONCE_WARNING_THRESHOLD) {
    console.warn(
      `SECURITY WARNING: Nonce storage at ${usedNonces.size}/${MAX_NONCES} - possible replay attack in progress`,
    )
  }
}

// Start periodic cleanup
setInterval(cleanupExpiredNonces, NONCE_CLEANUP_INTERVAL_MS)

// Check if nonce is used and mark it as used with expiration
function checkAndUseNonce(nonce: string): boolean {
  // SECURITY: Force aggressive cleanup if approaching capacity
  if (usedNonces.size >= MAX_NONCES * 0.9) {
    cleanupExpiredNonces()
  }

  // SECURITY: Reject if still at capacity after cleanup (under attack)
  if (usedNonces.size >= MAX_NONCES) {
    console.error(
      'SECURITY: Nonce storage full after cleanup - rejecting request',
    )
    return true // Treat as already used to reject the request
  }

  // Check if nonce already exists and is not expired
  const existingExpiration = usedNonces.get(nonce)
  const now = Math.floor(Date.now() / 1000)

  if (existingExpiration !== undefined && now <= existingExpiration) {
    return true // Nonce is still valid (already used)
  }

  // Mark nonce as used with expiration
  usedNonces.set(nonce, now + NONCE_EXPIRATION_SECONDS)
  return false // Nonce was not used
}

// ============================================================================
// Middleware
// ============================================================================

export function createX402Middleware(ctx: VPNServiceContext): Hono {
  const router = new Hono()

  // Error handling middleware
  router.onError((err, c) => {
    console.error('x402 API error:', err)
    return c.json({ error: err.message || 'Internal server error' }, 500)
  })

  /**
   * GET /pricing - Get payment pricing for VPN services
   */
  router.get('/pricing', (c) => {
    return c.json({
      services: [
        {
          resource: 'vpn:connect',
          description: 'Premium VPN connection (per hour)',
          price: ctx.config.pricing.pricePerHour.toString(),
          tokens: ctx.config.pricing.supportedTokens,
        },
        {
          resource: 'vpn:proxy',
          description: 'Single proxy request',
          price: ctx.config.pricing.pricePerRequest.toString(),
          tokens: ctx.config.pricing.supportedTokens,
        },
        {
          resource: 'vpn:bandwidth',
          description: 'Premium bandwidth (per GB)',
          price: ctx.config.pricing.pricePerGB.toString(),
          tokens: ctx.config.pricing.supportedTokens,
        },
      ],
      recipient: ctx.config.paymentRecipient,
      network: 'jeju',
    })
  })

  /**
   * POST /verify - Verify a payment
   */
  router.post('/verify', async (c) => {
    const rawBody = await c.req.json()
    const body = expectValid(X402VerifyRequestSchema, rawBody, 'verify request')

    const amount = BigInt(body.amount)
    expect(amount >= BigInt(0), 'Amount cannot be negative')

    const result = await verifyX402Payment(
      body.paymentHeader,
      amount,
      body.resource,
      ctx.config,
    )

    if (!result.valid) {
      throw new Error(result.error || 'Payment verification failed')
    }
    if (!result.receipt) {
      throw new Error('Payment receipt missing after verification')
    }

    return c.json({
      valid: true,
      receipt: {
        paymentId: result.receipt.paymentId,
        payer: result.receipt.payer,
        amount: result.receipt.amount.toString(),
        resource: result.receipt.resource,
      },
    })
  })

  /**
   * POST /create-header - Create a payment header for client use
   */
  router.post('/create-header', async (c) => {
    const rawBody = await c.req.json()
    const body = expectValid(
      X402CreateHeaderRequestSchema,
      rawBody,
      'create header request',
    )

    expect(
      ctx.config.pricing.supportedTokens.length > 0,
      'No supported tokens configured',
    )

    const timestamp = Math.floor(Date.now() / 1000)
    // SECURITY: Use cryptographically secure random generation for nonces
    const nonce = `${body.payer}-${timestamp}-${crypto.randomUUID()}`

    const payload: X402PaymentPayload = {
      scheme: 'exact',
      network: 'jeju',
      payTo: ctx.config.paymentRecipient,
      amount: body.amount,
      asset: ctx.config.pricing.supportedTokens[0],
      resource: body.resource,
      nonce,
      timestamp,
      signature: body.signature as Hex,
    }

    // Encode to base64 header
    const header = Buffer.from(JSON.stringify(payload)).toString('base64')

    return c.json({
      header: `x402 ${header}`,
      expiresAt: timestamp + 300, // 5 minutes
    })
  })

  return router
}

// ============================================================================
// Verification
// ============================================================================

export async function verifyX402Payment(
  paymentHeader: string,
  expectedAmount: bigint,
  expectedResource: string,
  config: VPNServerConfig,
): Promise<{ valid: boolean; error?: string; receipt?: X402Receipt }> {
  if (!paymentHeader || !paymentHeader.startsWith('x402 ')) {
    return { valid: false, error: 'Missing or invalid payment header' }
  }

  // Parse header
  let payload: X402PaymentPayload
  try {
    const encoded = paymentHeader.slice(5) // Remove "x402 " prefix
    if (encoded.length === 0) {
      throw new Error('Payment header payload is empty')
    }

    const decoded = Buffer.from(encoded, 'base64').toString('utf-8')
    const parsed = JSON.parse(decoded)
    const validated = expectValid(
      X402PaymentPayloadSchema,
      parsed,
      'x402 payment payload',
    )

    // Convert validated schema to X402PaymentPayload type
    payload = {
      scheme: validated.scheme,
      network: validated.network,
      payTo: validated.payTo as Address,
      amount: validated.amount,
      asset: validated.asset as Address,
      resource: validated.resource,
      nonce: validated.nonce,
      timestamp: validated.timestamp,
      signature: validated.signature as Hex,
    }
  } catch (err) {
    return {
      valid: false,
      error:
        err instanceof Error ? err.message : 'Invalid payment header format',
    }
  }

  // Validate timestamp (within 5 minutes)
  const maxAge = 300
  const now = Math.floor(Date.now() / 1000)
  const age = Math.abs(now - payload.timestamp)
  if (age > maxAge) {
    return {
      valid: false,
      error: `Payment expired. Age: ${age}s, max: ${maxAge}s`,
    }
  }

  // Validate amount
  const paymentAmount = BigInt(payload.amount)
  expect(paymentAmount >= BigInt(0), 'Payment amount cannot be negative')

  if (payload.scheme === 'exact' && paymentAmount !== expectedAmount) {
    return {
      valid: false,
      error: `Amount mismatch. Expected: ${expectedAmount}, got: ${paymentAmount}`,
    }
  }
  if (payload.scheme === 'upto' && paymentAmount < expectedAmount) {
    return {
      valid: false,
      error: `Insufficient payment amount. Required: ${expectedAmount}, got: ${paymentAmount}`,
    }
  }

  // Validate resource
  if (payload.resource !== expectedResource) {
    return {
      valid: false,
      error: `Resource mismatch. Expected: ${expectedResource}, got: ${payload.resource}`,
    }
  }

  // Validate recipient
  const payToAddress = getAddress(payload.payTo)
  const expectedRecipient = getAddress(config.paymentRecipient)
  if (payToAddress !== expectedRecipient) {
    return {
      valid: false,
      error: `Wrong payment recipient. Expected: ${expectedRecipient}, got: ${payToAddress}`,
    }
  }

  // SECURITY: Validate network/chain ID to prevent cross-chain replay attacks
  // The network field in payload must match expected network
  const expectedNetwork = 'jeju' // Could be made configurable via config.network
  if (payload.network !== expectedNetwork) {
    return {
      valid: false,
      error: `Invalid network. Expected: ${expectedNetwork}, got: ${payload.network}`,
    }
  }

  // Check nonce hasn't been used (with automatic expiration handling)
  if (checkAndUseNonce(payload.nonce)) {
    return { valid: false, error: 'Nonce already used' }
  }

  // SECURITY FIX: The signature must be from the payer, not the recipient (payTo)
  // We need to recover the signer address from the signature
  const message = `x402:${payload.scheme}:${payload.network}:${payload.payTo}:${payload.amount}:${payload.asset}:${payload.resource}:${payload.nonce}:${payload.timestamp}`

  let payerAddress: Address
  try {
    // Use recoverMessageAddress to get the actual signer
    const { recoverMessageAddress } = await import('viem')
    payerAddress = await recoverMessageAddress({
      message,
      signature: payload.signature,
    })
  } catch (err) {
    return {
      valid: false,
      error: `Signature verification failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
    }
  }

  // Nonce is already marked as used in checkAndUseNonce above

  // Create receipt with the actual payer address
  const receipt: X402Receipt = {
    paymentId: `pay-${payload.nonce}`,
    amount: paymentAmount,
    payer: payerAddress,
    recipient: expectedRecipient,
    resource: payload.resource,
    timestamp: payload.timestamp,
    verified: true,
  }

  return { valid: true, receipt }
}
