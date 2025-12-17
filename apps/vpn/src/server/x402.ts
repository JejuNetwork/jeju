/**
 * x402 Payment Integration for VPN
 *
 * Enables micropayments for:
 * - Premium VPN tier
 * - Per-request proxy access
 * - Priority routing
 */

import { Hono } from 'hono';
import { verifyMessage, getAddress, type Address, type Hex } from 'viem';
import type { VPNServerConfig, VPNServiceContext } from './types';

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
    const body = await c.req.json() as { paymentHeader: string; resource: string; amount: string };
    
    const result = await verifyX402Payment(
      body.paymentHeader,
      BigInt(body.amount),
      body.resource,
      ctx.config,
    );

    if (!result.valid) {
      return c.json({ valid: false, error: result.error }, 400);
    }

    return c.json({
      valid: true,
      receipt: {
        paymentId: result.receipt?.paymentId,
        payer: result.receipt?.payer,
        amount: result.receipt?.amount.toString(),
        resource: result.receipt?.resource,
      },
    });
  });

  /**
   * POST /create-header - Create a payment header for client use
   */
  router.post('/create-header', async (c) => {
    const body = await c.req.json() as {
      resource: string;
      amount: string;
      signature: Hex;
      payer: Address;
    };

    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = `${body.payer}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;

    const payload: X402PaymentPayload = {
      scheme: 'exact',
      network: 'jeju',
      payTo: ctx.config.paymentRecipient,
      amount: body.amount,
      asset: ctx.config.pricing.supportedTokens[0] || '0x0000000000000000000000000000000000000000',
      resource: body.resource,
      nonce,
      timestamp,
      signature: body.signature,
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
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    payload = JSON.parse(decoded);
  } catch {
    return { valid: false, error: 'Invalid payment header format' };
  }

  // Validate timestamp (within 5 minutes)
  const maxAge = 300;
  if (Math.abs(Date.now() / 1000 - payload.timestamp) > maxAge) {
    return { valid: false, error: 'Payment expired' };
  }

  // Validate amount
  const paymentAmount = BigInt(payload.amount);
  if (payload.scheme === 'exact' && paymentAmount !== expectedAmount) {
    return { valid: false, error: 'Amount mismatch' };
  }
  if (payload.scheme === 'upto' && paymentAmount < expectedAmount) {
    return { valid: false, error: 'Insufficient payment amount' };
  }

  // Validate resource
  if (payload.resource !== expectedResource) {
    return { valid: false, error: 'Resource mismatch' };
  }

  // Validate recipient
  if (getAddress(payload.payTo) !== getAddress(config.paymentRecipient)) {
    return { valid: false, error: 'Wrong payment recipient' };
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
      address: payload.payTo,
      message,
      signature: payload.signature,
    });
    
    if (!valid) {
      return { valid: false, error: 'Invalid signature' };
    }
  } catch {
    return { valid: false, error: 'Signature verification failed' };
  }

  // Mark nonce as used
  usedNonces.add(nonceKey);

  // Create receipt
  const receipt: X402Receipt = {
    paymentId: `pay-${payload.nonce}`,
    amount: paymentAmount,
    payer: payload.payTo,
    recipient: config.paymentRecipient,
    resource: payload.resource,
    timestamp: payload.timestamp,
    verified: true,
  };

  return { valid: true, receipt };
}

// ============================================================================
// Payment Header Creation (Client-side helper)
// ============================================================================

export function createX402PaymentHeader(params: {
  resource: string;
  amount: bigint;
  recipient: Address;
  asset: Address;
  signature: Hex;
  payer: Address;
}): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = `${params.payer}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;

  const payload: X402PaymentPayload = {
    scheme: 'exact',
    network: 'jeju',
    payTo: params.recipient,
    amount: params.amount.toString(),
    asset: params.asset,
    resource: params.resource,
    nonce,
    timestamp,
    signature: params.signature,
  };

  return `x402 ${Buffer.from(JSON.stringify(payload)).toString('base64')}`;
}

