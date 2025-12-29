/** x402 Payment Integration for VPN */

import { type CacheClient, getCacheClient } from '@jejunetwork/shared'

import { Elysia } from 'elysia'
import { type Address, getAddress, type Hex, recoverMessageAddress } from 'viem'
import {
  expect,
  expectValid,
  type VPNServerConfig,
  X402CreateHeaderRequestSchema,
  X402PaymentPayloadSchema,
  X402VerifyRequestSchema,
} from './schemas'
import type { VPNServiceContext } from './types'

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

// Distributed cache for nonce tracking (prevents replay attacks across instances)
const NONCE_EXPIRATION_SECONDS = 600

let nonceCache: CacheClient | null = null

function getNonceCache(): CacheClient {
  if (!nonceCache) {
    nonceCache = getCacheClient('vpn-x402-nonces')
  }
  return nonceCache
}

async function checkAndUseNonce(nonce: string): Promise<boolean> {
  const cache = getNonceCache()
  const cacheKey = `nonce:${nonce}`

  // Check if nonce exists
  const existing = await cache.get(cacheKey)
  if (existing) {
    return true // Nonce already used
  }

  // Mark nonce as used with TTL
  await cache.set(cacheKey, '1', NONCE_EXPIRATION_SECONDS)
  return false
}

export function createX402Middleware(ctx: VPNServiceContext) {
  const router = new Elysia({ prefix: '/x402' })
    .onError(({ error, set }) => {
      console.error('x402 API error:', error)
      set.status = 500
      const message =
        error instanceof Error ? error.message : 'Internal server error'
      return { error: message }
    })

    .get('/pricing', () => {
      return {
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
      }
    })

    .post('/verify', async ({ body }) => {
      const validatedBody = expectValid(
        X402VerifyRequestSchema,
        body,
        'verify request',
      )

      const amount = BigInt(validatedBody.amount)
      expect(amount >= BigInt(0), 'Amount cannot be negative')

      const result = await verifyX402Payment(
        validatedBody.paymentHeader,
        amount,
        validatedBody.resource,
        ctx.config,
      )

      if (!result.valid) {
        throw new Error(result.error ?? 'Payment verification failed')
      }
      if (!result.receipt) {
        throw new Error('Payment receipt missing after verification')
      }

      return {
        valid: true,
        receipt: {
          paymentId: result.receipt.paymentId,
          payer: result.receipt.payer,
          amount: result.receipt.amount.toString(),
          resource: result.receipt.resource,
        },
      }
    })

    .post('/create-header', async ({ body }) => {
      const validatedBody = expectValid(
        X402CreateHeaderRequestSchema,
        body,
        'create header request',
      )

      expect(
        ctx.config.pricing.supportedTokens.length > 0,
        'No supported tokens configured',
      )

      const timestamp = Math.floor(Date.now() / 1000)
      const nonce = `${validatedBody.payer}-${timestamp}-${crypto.randomUUID()}`

      const payload: X402PaymentPayload = {
        scheme: 'exact',
        network: 'jeju',
        payTo: ctx.config.paymentRecipient,
        amount: validatedBody.amount,
        asset: ctx.config.pricing.supportedTokens[0],
        resource: validatedBody.resource,
        nonce,
        timestamp,
        signature: validatedBody.signature,
      }

      const header = Buffer.from(JSON.stringify(payload)).toString('base64')

      return {
        header: `x402 ${header}`,
        expiresAt: timestamp + 300, // 5 minutes
      }
    })

  return router
}

export async function verifyX402Payment(
  paymentHeader: string,
  expectedAmount: bigint,
  expectedResource: string,
  config: VPNServerConfig,
): Promise<{ valid: boolean; error?: string; receipt?: X402Receipt }> {
  if (!paymentHeader || !paymentHeader.startsWith('x402 ')) {
    return { valid: false, error: 'Missing or invalid payment header' }
  }

  let payload: X402PaymentPayload
  try {
    const encoded = paymentHeader.slice(5)
    if (encoded.length === 0) {
      throw new Error('Payment header payload is empty')
    }

    const decoded = Buffer.from(encoded, 'base64').toString('utf-8')
    const parsed = JSON.parse(decoded)
    payload = expectValid(
      X402PaymentPayloadSchema,
      parsed,
      'x402 payment payload',
    )
  } catch (err) {
    return {
      valid: false,
      error:
        err instanceof Error ? err.message : 'Invalid payment header format',
    }
  }

  const maxAge = 300
  const now = Math.floor(Date.now() / 1000)
  const age = Math.abs(now - payload.timestamp)
  if (age > maxAge) {
    return {
      valid: false,
      error: `Payment expired. Age: ${age}s, max: ${maxAge}s`,
    }
  }

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

  if (payload.resource !== expectedResource) {
    return {
      valid: false,
      error: `Resource mismatch. Expected: ${expectedResource}, got: ${payload.resource}`,
    }
  }

  const payToAddress = getAddress(payload.payTo)
  const expectedRecipient = getAddress(config.paymentRecipient)
  if (payToAddress !== expectedRecipient) {
    return {
      valid: false,
      error: `Wrong payment recipient. Expected: ${expectedRecipient}, got: ${payToAddress}`,
    }
  }

  const expectedNetwork = 'jeju'
  if (payload.network !== expectedNetwork) {
    return {
      valid: false,
      error: `Invalid network. Expected: ${expectedNetwork}, got: ${payload.network}`,
    }
  }

  if (await checkAndUseNonce(payload.nonce)) {
    return { valid: false, error: 'Nonce already used' }
  }

  const message = `x402:${payload.scheme}:${payload.network}:${payload.payTo}:${payload.amount}:${payload.asset}:${payload.resource}:${payload.nonce}:${payload.timestamp}`

  let payerAddress: Address
  try {
    // Use recoverMessageAddress to get the actual signer
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
