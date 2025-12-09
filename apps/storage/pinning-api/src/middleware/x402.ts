/**
 * x402 Micropayment Middleware for IPFS Pinning Service
 * Coinbase x402 protocol for HTTP 402 payments
 * 
 * Supports multiple payment methods:
 * - EIP-712 signed payment proofs (x402 standard)
 * - On-chain transaction verification (fallback)
 * - Credit balance deduction (via CreditManager)
 */

import { Context, Next } from 'hono';
import { createPublicClient, http, parseEther, Address, verifyTypedData, recoverTypedDataAddress } from 'viem';
import { mainnet, sepolia } from 'viem/chains';

// ============ Configuration ============

type SupportedNetwork = 'ethereum' | 'sepolia' | 'jeju';

const NETWORK_CONFIG: Record<SupportedNetwork, { chain: typeof mainnet; usdc: Address }> = {
  'ethereum': { chain: mainnet, usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
  'sepolia': { chain: sepolia, usdc: '0x0000000000000000000000000000000000000000' }, // No USDC on Sepolia
  'jeju': { 
    chain: {
      id: 420691,
      name: 'Jeju',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [process.env.JEJU_RPC_URL || 'http://127.0.0.1:9545'] } },
    } as typeof mainnet,
    usdc: (process.env.JEJU_USDC_ADDRESS || '0x0165878A594ca255338adfa4d48449f69242Eb8F') as Address,
  },
};

const RECEIVER_ADDRESS = (process.env.PAYMENT_RECEIVER_ADDRESS || 
  process.env.X402_RECIPIENT_ADDRESS || 
  '0x0000000000000000000000000000000000000000') as Address;

const DEFAULT_NETWORK: SupportedNetwork = (process.env.X402_NETWORK as SupportedNetwork) || 'jeju';

const PRICING = {
  perGBPerMonth: parseEther('0.0001'), // 0.0001 ETH per GB per month
  minFee: parseEther('0.00001'),       // Minimum fee
  retrievalFee: parseEther('0.000001'), // Per retrieval
};

// ============ EIP-712 Types ============

const EIP712_DOMAIN = {
  name: 'x402 Payment Protocol',
  version: '1',
};

const EIP712_TYPES = {
  Payment: [
    { name: 'scheme', type: 'string' },
    { name: 'network', type: 'string' },
    { name: 'asset', type: 'address' },
    { name: 'payTo', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'resource', type: 'string' },
    { name: 'nonce', type: 'string' },
    { name: 'timestamp', type: 'uint256' },
  ],
};

interface PaymentPayload {
  scheme: string;
  network: string;
  asset: Address;
  payTo: Address;
  amount: string;
  resource: string;
  nonce: string;
  timestamp: number;
  signature?: string;
}

// ============ Middleware ============

/**
 * x402 payment middleware with EIP-712 signature verification
 */
export async function x402Middleware(c: Context, next: Next) {
  const paymentHeader = c.req.header('X-PAYMENT') || c.req.header('x-payment-proof');

  if (!paymentHeader) {
    const fileSize = parseInt(c.req.header('content-length') || '0');
    const durationMonths = parseInt(c.req.header('x-duration-months') || '1');
    const cost = calculateCost(fileSize, durationMonths);

    return c.json(
      {
        x402Version: 1,
        error: 'Payment Required',
        accepts: [{
          scheme: 'exact',
          network: DEFAULT_NETWORK,
          maxAmountRequired: cost.toString(),
          asset: '0x0000000000000000000000000000000000000000',
          payTo: RECEIVER_ADDRESS,
          resource: c.req.path,
          description: `Storage: ${(fileSize / (1024 ** 3)).toFixed(4)} GB for ${durationMonths} month(s)`,
          mimeType: 'application/json',
          outputSchema: null,
          maxTimeoutSeconds: 300,
        }],
      },
      402,
      {
        'WWW-Authenticate': 'x402',
        'X-Payment-Requirement': 'true',
      }
    );
  }

  const payment = JSON.parse(paymentHeader) as PaymentPayload;
  const verification = await verifyPayment(payment, c.req.path);

  if (!verification.valid) {
    return c.json({ error: verification.error }, 402);
  }

  c.set('payment', payment);
  c.set('payer', verification.signer);

  await next();
}

/**
 * Calculate storage cost in wei
 */
function calculateCost(fileSizeBytes: number, durationMonths: number): bigint {
  const sizeGB = fileSizeBytes / (1024 ** 3);
  const cost = BigInt(Math.ceil(sizeGB * Number(PRICING.perGBPerMonth) * durationMonths));
  return cost > PRICING.minFee ? cost : PRICING.minFee;
}

/**
 * Verify EIP-712 signed payment
 */
async function verifyPayment(
  payment: PaymentPayload,
  resource: string
): Promise<{ valid: boolean; error?: string; signer?: Address }> {
  if (!payment.amount || !payment.payTo || !payment.asset) {
    return { valid: false, error: 'Missing required payment fields' };
  }

  if (payment.payTo.toLowerCase() !== RECEIVER_ADDRESS.toLowerCase()) {
    return { valid: false, error: 'Invalid payment recipient' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - payment.timestamp) > 300) {
    return { valid: false, error: 'Payment timestamp expired' };
  }

  if (!payment.signature) {
    return { valid: false, error: 'Payment signature required' };
  }

  const network = payment.network as SupportedNetwork;
  const config = NETWORK_CONFIG[network];
  if (!config) {
    return { valid: false, error: `Unsupported network: ${network}` };
  }

  const domain = { ...EIP712_DOMAIN, chainId: config.chain.id };

  const message = {
    scheme: payment.scheme,
    network: payment.network,
    asset: payment.asset,
    payTo: payment.payTo,
    amount: BigInt(payment.amount),
    resource: payment.resource,
    nonce: payment.nonce,
    timestamp: BigInt(payment.timestamp),
  };

  const signer = await recoverTypedDataAddress({
    domain,
    types: EIP712_TYPES,
    primaryType: 'Payment',
    message,
    signature: payment.signature as `0x${string}`,
  });

  const isValid = await verifyTypedData({
    address: signer,
    domain,
    types: EIP712_TYPES,
    primaryType: 'Payment',
    message,
    signature: payment.signature as `0x${string}`,
  });

  if (!isValid) {
    return { valid: false, error: 'Invalid payment signature' };
  }

  return { valid: true, signer };
}

/**
 * Development mode middleware (bypasses payment)
 */
export function x402MiddlewareDev(c: Context, next: Next) {
  if (process.env.NODE_ENV === 'development' && process.env.BYPASS_X402 === 'true') {
    console.log('[x402] Development mode: Bypassing payment');
    return next();
  }
  
  return x402Middleware(c, next);
}

/**
 * Export pricing constants
 */
export { PRICING, RECEIVER_ADDRESS, DEFAULT_NETWORK };

