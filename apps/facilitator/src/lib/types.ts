/**
 * x402 Facilitator Types
 */

import type { Address, Hex } from 'viem';

export interface PaymentRequirements {
  scheme: 'exact' | 'upto';
  network: string;
  maxAmountRequired: string;
  payTo: Address;
  asset: Address;
  resource: string;
  description?: string;
  mimeType?: string;
  outputSchema?: string | null;
  maxTimeoutSeconds?: number;
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
  signature: Hex;
  payer?: Address;
}

export interface VerifyRequest {
  x402Version: number;
  paymentHeader: string;
  paymentRequirements: PaymentRequirements;
}

export interface VerifyResponse {
  isValid: boolean;
  invalidReason: string | null;
  payer: Address | null;
  amount: string | null;
  timestamp: number;
}

export interface SettleRequest {
  x402Version: number;
  paymentHeader: string;
  paymentRequirements: PaymentRequirements;
}

export interface SettleResponse {
  success: boolean;
  txHash: string | null;
  networkId: string;
  settlementId: string | null;
  payer: Address | null;
  recipient: Address | null;
  amount: { human: string; base: string; symbol: string; decimals: number } | null;
  fee: { human: string; base: string; bps: number } | null;
  net: { human: string; base: string } | null;
  error: string | null;
  timestamp: number;
}

export interface SupportedResponse {
  kinds: Array<{ scheme: 'exact' | 'upto'; network: string }>;
  x402Version: number;
  facilitator: { name: string; version: string; url: string };
}

export interface StatsResponse {
  totalSettlements: string;
  totalVolumeUSD: string;
  protocolFeeBps: number;
  feeRecipient: Address;
  supportedTokens: Address[];
  uptime: number;
  timestamp: number;
}

export interface HealthResponse {
  service: string;
  version: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  mode: 'production' | 'development';
  chainId: number;
  network: string;
  facilitatorAddress: Address;
  endpoints: { verify: string; settle: string; supported: string; stats: string };
  timestamp: number;
}

export interface DecodedPayment {
  payer: Address;
  recipient: Address;
  token: Address;
  amount: bigint;
  resource: string;
  nonce: string;
  timestamp: number;
  signature: Hex;
}

export interface VerificationResult {
  valid: boolean;
  error?: string;
  signer?: Address;
  decodedPayment?: DecodedPayment;
}

export interface SettlementResult {
  success: boolean;
  txHash?: Hex;
  paymentId?: Hex;
  protocolFee?: bigint;
  error?: string;
}

export interface ChainConfig {
  chainId: number;
  name: string;
  network: string;
  rpcUrl: string;
  blockExplorer?: string;
  usdc: Address;
  facilitator: Address;
  nativeCurrency: { name: string; symbol: string; decimals: number };
}

export interface TokenConfig {
  address: Address;
  symbol: string;
  decimals: number;
  name: string;
}
