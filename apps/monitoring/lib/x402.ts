/**
 * x402 Payment Protocol Implementation for Monitoring
 * Provides paid access to premium metrics and monitoring data
 */

import { Address, parseEther, formatEther } from 'viem';

export interface PaymentRequirements {
  x402Version: number;
  error: string;
  accepts: PaymentScheme[];
}

export interface PaymentScheme {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  asset: Address;
  payTo: Address;
  resource: string;
  description: string;
  mimeType: string;
  outputSchema: string | null;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface PaymentPayload {
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

export interface SettlementResponse {
  settled: boolean;
  txHash?: string;
  blockNumber?: number;
  timestamp?: number;
  amountSettled?: string;
  error?: string;
}

/**
 * Payment tiers for monitoring services
 */
export const PAYMENT_TIERS = {
  METRICS_QUERY: parseEther('0.001'), // 0.001 ETH per metrics query
  HISTORICAL_DATA: parseEther('0.01'), // 0.01 ETH for historical data
  REAL_TIME_STREAM: parseEther('0.05'), // 0.05 ETH for real-time metrics stream
  CUSTOM_DASHBOARD: parseEther('0.1'), // 0.1 ETH for custom dashboard
  ALERTS_SETUP: parseEther('0.02'), // 0.02 ETH for alerts
  DAILY_ACCESS: parseEther('0.5'), // 0.5 ETH for 24h full access
} as const;

export function createPaymentRequirement(
  resource: string,
  amount: bigint,
  description: string,
  recipientAddress: Address,
  tokenAddress: Address = '0x0000000000000000000000000000000000000000',
  network: string = 'jeju'
): PaymentRequirements {
  return {
    x402Version: 1,
    error: 'Payment required to access this resource',
    accepts: [{
      scheme: 'exact',
      network,
      maxAmountRequired: amount.toString(),
      asset: tokenAddress,
      payTo: recipientAddress,
      resource,
      description,
      mimeType: 'application/json',
      outputSchema: null,
      maxTimeoutSeconds: 300,
      extra: {
        serviceName: 'Jeju Monitoring',
        category: 'monitoring',
      },
    }],
  };
}

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

export async function verifyPayment(
  payload: PaymentPayload,
  expectedAmount: bigint,
  expectedRecipient: Address
): Promise<{ valid: boolean; error?: string }> {
  if (!payload.amount || !payload.payTo) {
    return { valid: false, error: 'Missing fields' };
  }

  if (BigInt(payload.amount) < expectedAmount) {
    return { valid: false, error: 'Insufficient amount' };
  }

  if (payload.payTo.toLowerCase() !== expectedRecipient.toLowerCase()) {
    return { valid: false, error: 'Invalid recipient' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - payload.timestamp) > 300) {
    return { valid: false, error: 'Expired' };
  }

  if (!payload.signature) {
    return { valid: false, error: 'No signature' };
  }

  return { valid: true };
}

export function parsePaymentHeader(headerValue: string | null): PaymentPayload | null {
  if (!headerValue) return null;
  try {
    return JSON.parse(headerValue) as PaymentPayload;
  } catch {
    return null;
  }
}

export async function checkPayment(
  paymentHeader: string | null,
  requiredAmount: bigint,
  recipient: Address
): Promise<{ paid: boolean; error?: string }> {
  const payment = parsePaymentHeader(paymentHeader);
  
  if (!payment) {
    return { paid: false, error: 'No payment' };
  }

  const verification = await verifyPayment(payment, requiredAmount, recipient);
  
  return { paid: verification.valid, error: verification.error };
}

