/**
 * x402 Micropayment Middleware
 * Coinbase x402 protocol for HTTP 402 payments
 */

import { Context, Next } from 'hono';
import { createPublicClient, http, parseUnits } from 'viem';
import { base } from 'viem/chains';

const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // USDC on Base
const RECEIVER_ADDRESS = process.env.PAYMENT_RECEIVER_ADDRESS as `0x${string}`;

const PRICING = {
  perGBPerMonth: 0.10, // $0.10 per GB per month
  minFee: 0.001, // Minimum $0.001 USDC
  retrievalFee: 0.0001, // $0.0001 per retrieval (optional)
};

const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL),
});

/**
 * x402 payment middleware
 * Returns 402 if no payment, verifies payment if provided
 */
export async function x402Middleware(c: Context, next: Next) {
  const paymentProof = c.req.header('x-payment-proof');

  if (!paymentProof) {
    // No payment provided - return 402 with payment details
    const fileSize = parseInt(c.req.header('content-length') || '0');
    const durationMonths = parseInt(c.req.header('x-duration-months') || '1');
    
    const cost = calculateCost(fileSize, durationMonths);

    return c.json(
      {
        error: 'Payment Required',
        payment: {
          amount: cost.toString(),
          currency: 'USDC',
          receiver: RECEIVER_ADDRESS,
          chainId: 8453, // Base
          tokenAddress: USDC_ADDRESS,
          message: `Pay ${cost} USDC for ${(fileSize / (1024 ** 3)).toFixed(4)} GB storage for ${durationMonths} month(s)`,
        },
      },
      402
    );
  }

  // Verify payment
  try {
    const payment = JSON.parse(paymentProof);
    const isValid = await verifyPayment(payment);

    if (!isValid) {
      return c.json({ error: 'Invalid payment proof' }, 402);
    }

    // Store payment info for later
    c.set('payment', payment);

    await next();
  } catch (error) {
    return c.json({ error: `Payment verification failed: ${error}` }, 402);
  }
}

/**
 * Calculate storage cost
 */
function calculateCost(fileSizeBytes: number, durationMonths: number): number {
  const sizeGB = fileSizeBytes / (1024 ** 3);
  const cost = sizeGB * PRICING.perGBPerMonth * durationMonths;
  return Math.max(cost, PRICING.minFee);
}

/**
 * Verify USDC payment was received
 */
async function verifyPayment(payment: {
  txHash: string;
  amount: string;
  payer: string;
}): Promise<boolean> {
  try {
    // Get transaction receipt
    const receipt = await publicClient.getTransactionReceipt({
      hash: payment.txHash as `0x${string}`,
    });

    if (!receipt) return false;

    // Verify transaction succeeded
    if (receipt.status !== 'success') return false;

    // TODO: Parse USDC Transfer event to verify:
    // - Transfer was to our receiver address
    // - Amount matches expected cost
    // - Token is USDC

    // For now, basic verification
    return receipt.to?.toLowerCase() === USDC_ADDRESS.toLowerCase();
  } catch (error) {
    console.error('Payment verification error:', error);
    return false;
  }
}

/**
 * Alternative: Simplified x402 for development
 * Bypasses payment in development mode
 */
export function x402MiddlewareDev(c: Context, next: Next) {
  if (process.env.NODE_ENV === 'development') {
    console.log('⚠️  Development mode: Bypassing x402 payment');
    return next();
  }
  
  return x402Middleware(c, next);
}

