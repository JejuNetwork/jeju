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

import { Hono } from 'hono';
import { verifyMessage, getAddress, type Address, type Hex } from 'viem';
import type { VPNServerConfig, VPNServiceContext } from './types';
import {
  X402PaymentPayloadSchema,
  X402VerifyRequestSchema,
  X402CreateHeaderRequestSchema,
  expectValid,
  expect,
} from './schemas';

// ============================================================================
// Types
// ============================================================================

export interface X402PaymentPayload {
  scheme: 'exact' | 'upto';
  network: string;
  payTo: Address;
  amount: string;
  asset: Address;
  resource: string;
  nonce: string;
  timestamp: number;
  signature: Hex;
}

export interface X402Receipt {
  paymentId: string;
  amount: bigint;
  payer: Address;
  recipient: Address;
  resource: string;
  timestamp: number;
  verified: boolean;
}

// Track used nonces to prevent replay
const usedNonces = new Set<string>();

// ============================================================================
// Middleware
// ============================================================================

export function createX402Middleware(ctx: VPNServiceContext): Hono {
  const router = new Hono();

  // Error handling middleware
  router.onError((err, c) => {
    console.error('x402 API error:', err);
    return c.json({ error: err.message || 'Internal server error' }, 500);
  });

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
    });
  });

  /**
   * POST /verify - Verify a payment
   */
  router.post('/verify', async (c) => {
    const rawBody = await c.req.json();
    const body = expectValid(X402VerifyRequestSchema, rawBody, 'verify request');
    
    const amount = BigInt(body.amount);
    expect(amount >= BigInt(0), 'Amount cannot be negative');
    
    const result = await verifyX402Payment(
      body.paymentHeader,
      amount,
      body.resource,
      ctx.config,
    );

    if (!result.valid) {
      throw new Error(result.error || 'Payment verification failed');
    }
    if (!result.receipt) {
      throw new Error('Payment receipt missing after verification');
    }

    return c.json({
      valid: true,
      receipt: {
        paymentId: result.receipt.paymentId,
        payer: result.receipt.payer,
        amount: result.receipt.amount.toString(),
        resource: result.receipt.resource,
      },
    });
  });

  /**
   * POST /create-header - Create a payment header for client use
   */
  router.post('/create-header', async (c) => {
    const rawBody = await c.req.json();
    const body = expectValid(X402CreateHeaderRequestSchema, rawBody, 'create header request');

    expect(ctx.config.pricing.supportedTokens.length > 0, 'No supported tokens configured');
    
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = `${body.payer}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;

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
    };

    // Encode to base64 header
    const header = Buffer.from(JSON.stringify(payload)).toString('base64');

    return c.json({
      header: `x402 ${header}`,
      expiresAt: timestamp + 300, // 5 minutes
    });
  });

  return router;
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
    return { valid: false, error: 'Missing or invalid payment header' };
  }

  // Parse header
  let payload: X402PaymentPayload;
  try {
    const encoded = paymentHeader.slice(5); // Remove "x402 " prefix
    if (encoded.length === 0) {
      throw new Error('Payment header payload is empty');
    }
    
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    const validated = expectValid(X402PaymentPayloadSchema, parsed, 'x402 payment payload');
    
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
    };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Invalid payment header format' };
  }

  // Validate timestamp (within 5 minutes)
  const maxAge = 300;
  const now = Math.floor(Date.now() / 1000);
  const age = Math.abs(now - payload.timestamp);
  if (age > maxAge) {
    return { valid: false, error: `Payment expired. Age: ${age}s, max: ${maxAge}s` };
  }

  // Validate amount
  const paymentAmount = BigInt(payload.amount);
  expect(paymentAmount >= BigInt(0), 'Payment amount cannot be negative');
  
  if (payload.scheme === 'exact' && paymentAmount !== expectedAmount) {
    return { valid: false, error: `Amount mismatch. Expected: ${expectedAmount}, got: ${paymentAmount}` };
  }
  if (payload.scheme === 'upto' && paymentAmount < expectedAmount) {
    return { valid: false, error: `Insufficient payment amount. Required: ${expectedAmount}, got: ${paymentAmount}` };
  }

  // Validate resource
  if (payload.resource !== expectedResource) {
    return { valid: false, error: `Resource mismatch. Expected: ${expectedResource}, got: ${payload.resource}` };
  }

  // Validate recipient
  const payToAddress = getAddress(payload.payTo);
  const expectedRecipient = getAddress(config.paymentRecipient);
  if (payToAddress !== expectedRecipient) {
    return { valid: false, error: `Wrong payment recipient. Expected: ${expectedRecipient}, got: ${payToAddress}` };
  }

  // Check nonce hasn't been used
  const nonceKey = payload.nonce;
  if (usedNonces.has(nonceKey)) {
    return { valid: false, error: 'Nonce already used' };
  }

  // Verify signature
  const message = `x402:${payload.scheme}:${payload.network}:${payload.payTo}:${payload.amount}:${payload.asset}:${payload.resource}:${payload.nonce}:${payload.timestamp}`;
  
  try {
    const valid = await verifyMessage({
      address: payToAddress,
      message,
      signature: payload.signature,
    });
    
    if (!valid) {
      return { valid: false, error: 'Invalid signature' };
    }
  } catch (err) {
    return { valid: false, error: `Signature verification failed: ${err instanceof Error ? err.message : 'Unknown error'}` };
  }

  // Mark nonce as used
  usedNonces.add(nonceKey);

  // Create receipt
  const receipt: X402Receipt = {
    paymentId: `pay-${payload.nonce}`,
    amount: paymentAmount,
    payer: payToAddress,
    recipient: expectedRecipient,
    resource: payload.resource,
    timestamp: payload.timestamp,
    verified: true,
  };

  return { valid: true, receipt };
}

