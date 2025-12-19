import type { Address } from 'viem';
import { recoverAddress, hashMessage } from 'viem';
import { x402State } from '../../state.js';

// State initialization is handled by main server startup

export type X402Network = 'sepolia' | 'base' | 'base-sepolia' | 'ethereum' | 'jeju' | 'jeju-testnet';

export interface X402PaymentRequirement {
  x402Version: number;
  error: string;
  accepts: X402PaymentOption[];
}

export interface X402PaymentOption {
  scheme: 'exact' | 'credit' | 'prepaid';
  network: X402Network | string;
  maxAmountRequired: string;
  asset: Address;
  payTo: Address;
  resource: string;
  description: string;
}

export interface X402PaymentHeader {
  scheme: string;
  network: string;
  payload: string;
  asset: string;
  amount: string;
}

interface X402PaymentProof {
  payTo: Address;
  amount: string;
  nonce: string;
  timestamp: number;
  network: string;
  signature: string;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
const PAYMENT_RECIPIENT = (process.env.RPC_PAYMENT_RECIPIENT || ZERO_ADDRESS) as Address;
const X402_ENABLED = process.env.X402_ENABLED !== 'false';

export const RPC_PRICING = { standard: 100n, archive: 500n, trace: 1000n } as const;

// Initialize state on module load (non-blocking)
initializeState().catch((err) => {
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[X402 Payments] Running without CQL:', err.message);
  }
});

export const isX402Enabled = () => X402_ENABLED && PAYMENT_RECIPIENT !== ZERO_ADDRESS;

export function getMethodPrice(method: string): bigint {
  if (method.startsWith('debug_') || method.startsWith('trace_')) return RPC_PRICING.trace;
  if (method.includes('Archive') || method.includes('History')) return RPC_PRICING.archive;
  return RPC_PRICING.standard;
}

export function generatePaymentRequirement(chainId: number, method: string): X402PaymentRequirement {
  const price = getMethodPrice(method).toString();
  const resource = `rpc/${chainId}/${method}`;
  const base = { network: 'jeju' as const, maxAmountRequired: price, asset: ZERO_ADDRESS, payTo: PAYMENT_RECIPIENT, resource };
  
  return {
    x402Version: 1,
    error: 'Payment required for RPC access',
    accepts: [
      { ...base, scheme: 'exact', description: `RPC: ${method}` },
      { ...base, scheme: 'credit', description: 'Prepaid credits' },
    ],
  };
}

export function parseX402Header(header: string): X402PaymentHeader | null {
  const [scheme, network, payload, asset, amount] = header.split(':');
  return amount ? { scheme, network, payload, asset, amount } : null;
}

export async function verifyX402Payment(
  payment: X402PaymentHeader,
  expectedAmount: bigint,
  userAddress?: string
): Promise<{ valid: boolean; error?: string }> {
  if (BigInt(payment.amount) < expectedAmount) return { valid: false, error: 'Insufficient payment' };

  const proof = JSON.parse(payment.payload) as X402PaymentProof;
  const nonceKey = `${userAddress}:${proof.nonce}`;

  if (proof.payTo.toLowerCase() !== PAYMENT_RECIPIENT.toLowerCase()) return { valid: false, error: 'Wrong recipient' };
  if (await x402State.isNonceUsed(nonceKey)) return { valid: false, error: 'Nonce reused' };
  if (Date.now() / 1000 - proof.timestamp > 300) return { valid: false, error: 'Expired' };

  const message = `x402:rpc:${proof.network}:${proof.payTo}:${proof.amount}:${proof.nonce}:${proof.timestamp}`;
  const recovered = await recoverAddress({
    hash: hashMessage({ raw: message as `0x${string}` }),
    signature: proof.signature as `0x${string}`,
  });

  if (userAddress && recovered.toLowerCase() !== userAddress.toLowerCase()) return { valid: false, error: 'Invalid signature' };

  await x402State.markNonceUsed(nonceKey);
  return { valid: true };
}

export async function getCredits(addr: string): Promise<bigint> {
  return x402State.getCredits(addr);
}

export async function addCredits(addr: string, amount: bigint): Promise<bigint> {
  await x402State.addCredits(addr, amount);
  return x402State.getCredits(addr);
}

export async function deductCredits(addr: string, amount: bigint): Promise<boolean> {
  return x402State.deductCredits(addr, amount);
}

export async function processPayment(
  paymentHeader: string | undefined,
  chainId: number,
  method: string,
  userAddress?: string
): Promise<{ allowed: boolean; requirement?: X402PaymentRequirement; error?: string }> {
  if (!isX402Enabled()) return { allowed: true };

  const price = getMethodPrice(method);
  const deny = (error?: string) => ({ allowed: false, requirement: generatePaymentRequirement(chainId, method), error });

  if (userAddress) {
    const credits = await getCredits(userAddress);
    if (credits >= price) {
      await deductCredits(userAddress, price);
      return { allowed: true };
    }
  }

  if (!paymentHeader) return deny();

  const payment = parseX402Header(paymentHeader);
  if (!payment) return deny('Invalid header');

  const result = await verifyX402Payment(payment, price, userAddress);
  return result.valid ? { allowed: true } : deny(result.error);
}

export function getPaymentInfo() {
  return { enabled: isX402Enabled(), recipient: PAYMENT_RECIPIENT, pricing: RPC_PRICING, acceptedAssets: ['ETH', 'JEJU'] };
}

export async function purchaseCredits(addr: string, _txHash: string, amount: bigint) {
  const newBalance = await addCredits(addr, amount);
  return { success: true, newBalance };
}
