/**
 * x402 Payment Protocol Middleware
 * 
 * Implements HTTP 402 Payment Required for paid API access.
 * Supports JEJU and USDC payments on Base/Jeju networks.
 * 
 * All validation uses zod with expect/throw patterns.
 */

import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { createPublicClient, http, parseAbi, verifyMessage } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import type { Address, Hex } from 'viem';
import {
  x402PaymentHeaderSchema,
  x402VerifySchema,
} from '../schemas';
import { expectValid, ValidationError } from '../utils/validation';
import type { X402Config, X402PaymentHeader, X402PaymentResult, X402Token } from '../types';

// Default token configurations
const TOKENS: Record<string, X402Token> = {
  JEJU: {
    symbol: 'JEJU',
    address: '0x0000000000000000000000000000000000000000' as Address, // Native token
    decimals: 18,
    minAmount: BigInt(1e15), // 0.001 JEJU
  },
  USDC: {
    symbol: 'USDC',
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address, // Base USDC
    decimals: 6,
    minAmount: BigInt(1e4), // 0.01 USDC
  },
};

// Environment configuration
const PAYMENT_ADDRESS = (process.env.X402_PAYMENT_ADDRESS || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266') as Address;
const X402_ENABLED = process.env.X402_ENABLED !== 'false';
const NETWORK = process.env.NETWORK || 'localnet';

// Price per request in USDC micro-units (1 = $0.000001)
const PRICES = {
  free: BigInt(0),
  basic: BigInt(1000), // $0.001
  premium: BigInt(10000), // $0.01
  ai: BigInt(100000), // $0.1
};

export interface X402Middleware {
  config: X402Config;
  requirePayment: (price?: keyof typeof PRICES) => (c: Context, next: Next) => Promise<Response | void>;
  verifyPayment: (header: string) => Promise<X402PaymentResult>;
  getPaymentInfo: () => { address: Address; tokens: X402Token[]; prices: typeof PRICES };
}

class X402MiddlewareImpl implements X402Middleware {
  config: X402Config;
  private client;

  constructor() {
    const chain = NETWORK === 'mainnet' ? base : baseSepolia;
    
    this.config = {
      enabled: X402_ENABLED,
      acceptedTokens: [TOKENS.JEJU, TOKENS.USDC],
      paymentAddress: PAYMENT_ADDRESS,
      pricePerRequest: PRICES.basic,
      network: NETWORK === 'mainnet' ? 'base' : 'base-sepolia',
    };

    this.client = createPublicClient({
      chain,
      transport: http(),
    });
  }

  requirePayment(price: keyof typeof PRICES = 'basic') {
    return async (c: Context, next: Next): Promise<Response | void> => {
      // Skip payment check if disabled
      if (!this.config.enabled) {
        return next();
      }

      // Free tier doesn't require payment
      if (price === 'free') {
        return next();
      }

      const paymentHeader = c.req.header('X-Payment');
      
      if (!paymentHeader) {
        return this.sendPaymentRequired(c, price);
      }

      const result = await this.verifyPayment(paymentHeader);
      
      if (!result.valid) {
        return c.json(
          { error: 'Payment verification failed', details: result.error },
          402
        );
      }

      // Payment verified, continue
      c.set('x402TxHash', result.txHash);
      return next();
    };
  }

  async verifyPayment(header: string): Promise<X402PaymentResult> {
    const payment = this.parsePaymentHeader(header);
    if (!payment) {
      throw new ValidationError('Invalid payment header format');
    }

    // Validate payment structure with zod
    const validatedPayment = expectValid(
      x402PaymentHeaderSchema,
      payment,
      'Payment header'
    );

    // Check deadline
    const now = Date.now();
    const deadlineMs = validatedPayment.deadline * 1000;
    if (now > deadlineMs) {
      throw new ValidationError(
        `Payment deadline expired: ${deadlineMs} is in the past (now: ${now})`
      );
    }

    // Check payee matches
    if (validatedPayment.payee.toLowerCase() !== this.config.paymentAddress.toLowerCase()) {
      throw new ValidationError(
        `Invalid payment recipient: ${validatedPayment.payee} != ${this.config.paymentAddress}`
      );
    }

    // Verify signature
    const message = this.constructPaymentMessage(validatedPayment);
    const isValid = await this.verifySignature(
      message,
      validatedPayment.signature,
      validatedPayment.payer
    );
    
    if (!isValid) {
      throw new ValidationError('Invalid signature');
    }

    // Verify on-chain payment (for production)
    if (NETWORK !== 'localnet') {
      const onChainValid = await this.verifyOnChainPayment(validatedPayment);
      if (!onChainValid.valid) {
        return onChainValid;
      }
    }

    return { valid: true, txHash: validatedPayment.signature }; // Use signature as receipt in dev
  }

  getPaymentInfo() {
    return {
      address: this.config.paymentAddress,
      tokens: this.config.acceptedTokens,
      prices: PRICES,
    };
  }

  private parsePaymentHeader(header: string): Record<string, string | number> | null {
    // Format: token:amount:payer:payee:nonce:deadline:signature
    const parts = header.split(':');
    if (parts.length !== 7) {
      return null;
    }

    const deadline = parseInt(parts[5], 10);
    if (isNaN(deadline) || deadline <= 0) {
      return null;
    }

    return {
      token: parts[0],
      amount: parts[1],
      payer: parts[2],
      payee: parts[3],
      nonce: parts[4],
      deadline,
      signature: parts[6],
    };
  }

  private constructPaymentMessage(payment: X402PaymentHeader): string {
    return `x402-payment:${payment.token}:${payment.amount}:${payment.payer}:${payment.payee}:${payment.nonce}:${payment.deadline}`;
  }

  private async verifySignature(message: string, signature: Hex, expectedSigner: Address): Promise<boolean> {
    const recovered = await verifyMessage({
      address: expectedSigner,
      message,
      signature,
    });
    return recovered;
  }

  private async verifyOnChainPayment(payment: X402PaymentHeader): Promise<X402PaymentResult> {
    // Check if token is native or ERC20
    const isNative = payment.token === '0x0000000000000000000000000000000000000000';
    
    if (isNative) {
      // For native token, we'd check a payment escrow contract
      // For now, signature-based verification is sufficient
      return { valid: true };
    }

    // Check ERC20 allowance/balance
    const erc20Abi = parseAbi([
      'function allowance(address owner, address spender) view returns (uint256)',
      'function balanceOf(address account) view returns (uint256)',
    ]);

    const [allowance, balance] = await Promise.all([
      this.client.readContract({
        address: payment.token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [payment.payer, this.config.paymentAddress],
      }),
      this.client.readContract({
        address: payment.token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [payment.payer],
      }),
    ]);

    const amount = BigInt(payment.amount);
    if (balance < amount) {
      return { valid: false, error: 'Insufficient token balance' };
    }
    if (allowance < amount) {
      return { valid: false, error: 'Insufficient token allowance' };
    }

    return { valid: true };
  }

  private sendPaymentRequired(c: Context, tier: keyof typeof PRICES): Response {
    const price = PRICES[tier];
    const acceptedTokens = this.config.acceptedTokens.map(t => t.symbol).join(', ');
    
    return c.json(
      {
        error: 'Payment Required',
        code: 'PAYMENT_REQUIRED',
        payment: {
          recipient: this.config.paymentAddress,
          amount: price.toString(),
          currency: 'USDC',
          acceptedTokens,
          network: this.config.network,
          message: `x402 payment required. Send ${price} to ${this.config.paymentAddress} and include X-Payment header.`,
          headerFormat: 'token:amount:payer:payee:nonce:deadline:signature',
        },
      },
      402
    );
  }
}

let x402Middleware: X402Middleware | null = null;

export function getX402Middleware(): X402Middleware {
  if (!x402Middleware) {
    x402Middleware = new X402MiddlewareImpl();
  }
  return x402Middleware;
}

// Helper to create x402 routes
export function createX402Routes(): Hono {
  const app = new Hono();
  const x402 = getX402Middleware();

  // Payment info endpoint
  app.get('/info', (c) => {
    const info = x402.getPaymentInfo();
    return c.json({
      enabled: x402.config.enabled,
      paymentAddress: info.address,
      acceptedTokens: info.tokens.map(t => ({
        symbol: t.symbol,
        address: t.address,
        decimals: t.decimals,
      })),
      prices: Object.fromEntries(
        Object.entries(info.prices).map(([k, v]) => [k, v.toString()])
      ),
      network: x402.config.network,
    });
  });

  // Error handler
  app.onError((err, c) => {
    if (err instanceof ValidationError) {
      return c.json({ valid: false, error: err.message }, 400);
    }
    return c.json({ valid: false, error: err.message || 'Internal error' }, 500);
  });

  // Verify payment endpoint with validated input
  app.post('/verify', async (c) => {
    const body = await c.req.json();
    const validatedInput = expectValid(x402VerifySchema, body, 'Verify payment input');
    
    const result = await x402.verifyPayment(validatedInput.header);
    return c.json(result, result.valid ? 200 : 400);
  });

  return app;
}

