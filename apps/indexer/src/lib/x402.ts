/**
 * x402 Payment Protocol for Indexer
 * Provides paid access to GraphQL queries and historical data
 */

import { Address, parseEther } from 'viem';

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

export const PAYMENT_TIERS = {
  QUERY_BASIC: parseEther('0.001'), // 0.001 ETH per query
  QUERY_COMPLEX: parseEther('0.005'), // 0.005 ETH for complex queries
  HISTORICAL_DATA: parseEther('0.01'), // 0.01 ETH for historical data
  BULK_EXPORT: parseEther('0.05'), // 0.05 ETH for bulk export
  SUBSCRIPTION_DAILY: parseEther('0.1'), // 0.1 ETH for daily unlimited
  SUBSCRIPTION_MONTHLY: parseEther('2.0'), // 2 ETH for monthly unlimited
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
    }],
  };
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

  if (BigInt(payment.amount) < requiredAmount) {
    return { paid: false, error: 'Insufficient amount' };
  }

  if (payment.payTo.toLowerCase() !== recipient.toLowerCase()) {
    return { paid: false, error: 'Invalid recipient' };
  }

  return { paid: true };
}

