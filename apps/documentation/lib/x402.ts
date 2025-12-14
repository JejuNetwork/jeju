/**
 * x402 Payment Protocol for Documentation
 * Standalone implementation for documentation-specific payment tiers
 */

type Address = `0x${string}`;

// Define parseEther locally to avoid viem dependency issues during tests
const parseEther = (value: string): bigint => {
  const [whole, decimal = ''] = value.split('.');
  const paddedDecimal = decimal.padEnd(18, '0').slice(0, 18);
  return BigInt(whole + paddedDecimal);
};

export const PAYMENT_TIERS = {
  PREMIUM_DOCS: parseEther('0.01'),
  API_DOCS: parseEther('0.005'),
  TUTORIALS: parseEther('0.02'),
  EXAMPLES: parseEther('0.01'),
} as const;

export interface PaymentScheme {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  payTo: Address;
  asset: Address;
  maxTimeoutSeconds: number;
  mimeType: string;
  extra?: Record<string, string>;
}

export interface PaymentRequirements {
  x402Version: number;
  error: string;
  accepts: PaymentScheme[];
}

export interface PaymentPayload {
  version: number;
  network: string;
  amount: string;
  recipient: Address;
  resource: string;
  timestamp: number;
  nonce: string;
  payer: Address;
  signature: string;
}

type Network = 'base-sepolia' | 'base' | 'jeju' | 'jeju-testnet';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export function createPaymentRequirement(
  resource: string,
  amount: bigint,
  description: string,
  recipientAddress: Address,
  tokenAddress: Address = ZERO_ADDRESS,
  network: Network = 'jeju'
): PaymentRequirements {
  return {
    x402Version: 1,
    error: 'Payment required to access this resource',
    accepts: [
      {
        scheme: 'exact',
        network,
        maxAmountRequired: amount.toString(),
        resource,
        description,
        payTo: recipientAddress,
        asset: tokenAddress,
        maxTimeoutSeconds: 300,
        mimeType: 'application/json',
        extra: {
          serviceName: 'Documentation',
        },
      },
    ],
  };
}

export function parsePaymentHeader(header: string): PaymentPayload | null {
  try {
    return JSON.parse(header) as PaymentPayload;
  } catch {
    return null;
  }
}

export function checkPayment(
  payment: PaymentPayload,
  requirement: PaymentRequirements
): { valid: boolean; error?: string } {
  const accept = requirement.accepts[0];
  
  if (!accept) {
    return { valid: false, error: 'No payment schemes available' };
  }
  
  if (payment.network !== accept.network) {
    return { valid: false, error: 'Network mismatch' };
  }
  
  if (BigInt(payment.amount) < BigInt(accept.maxAmountRequired)) {
    return { valid: false, error: 'Insufficient payment amount' };
  }
  
  if (payment.resource !== accept.resource) {
    return { valid: false, error: 'Resource mismatch' };
  }
  
  const now = Math.floor(Date.now() / 1000);
  if (payment.timestamp < now - accept.maxTimeoutSeconds) {
    return { valid: false, error: 'Payment expired' };
  }
  
  return { valid: true };
}
