/**
 * x402 Payment Protocol for Jeju Storage Marketplace
 *
 * Implements HTTP 402 Payment Required protocol for micropayments.
 * Compatible with @coinbase/x402 and Jeju compute x402 implementation.
 */

import type { Address } from 'viem';
import { Wallet, verifyMessage } from 'ethers';

// ============================================================================
// Types
// ============================================================================

export type X402Network = 'sepolia' | 'base' | 'base-sepolia' | 'ethereum' | 'jeju' | 'jeju-testnet';

export interface X402NetworkConfig {
  name: string;
  chainId: number;
  rpcUrl: string;
  blockExplorer: string;
  isTestnet: boolean;
  usdc: Address;
}

export interface X402PaymentRequirement {
  x402Version: number;
  error: string;
  accepts: X402PaymentOption[];
}

export interface X402PaymentOption {
  scheme: 'exact' | 'credit' | 'paymaster' | string;
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

export interface X402Config {
  enabled: boolean;
  recipientAddress: Address;
  network: X402Network;
  creditsPerDollar: number;
}

// ============================================================================
// Constants
// ============================================================================

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

/** JEJU token address */
export const JEJU_TOKEN_ADDRESS = (process.env.JEJU_TOKEN_ADDRESS || ZERO_ADDRESS) as Address;

export const X402_CHAIN_IDS: Record<X402Network, number> = {
  sepolia: 11155111,
  'base-sepolia': 84532,
  base: 8453,
  ethereum: 1,
  jeju: 9545,
  'jeju-testnet': 11155111,
};

export const X402_USDC_ADDRESSES: Record<X402Network, Address> = {
  sepolia: ZERO_ADDRESS,
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address,
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address,
  ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
  jeju: ZERO_ADDRESS,
  'jeju-testnet': ZERO_ADDRESS,
};

export const X402_RPC_URLS: Record<X402Network, string> = {
  sepolia: 'https://sepolia.ethereum.org',
  'base-sepolia': 'https://sepolia.base.org',
  base: 'https://mainnet.base.org',
  ethereum: 'https://eth.llamarpc.com',
  jeju: 'http://localhost:9545',
  'jeju-testnet': 'https://sepolia.ethereum.org',
};

export const X402_NETWORK_CONFIGS: Record<X402Network, X402NetworkConfig> = {
  sepolia: {
    name: 'Sepolia',
    chainId: 11155111,
    rpcUrl: X402_RPC_URLS.sepolia,
    blockExplorer: 'https://sepolia.etherscan.io',
    isTestnet: true,
    usdc: X402_USDC_ADDRESSES.sepolia,
  },
  'base-sepolia': {
    name: 'Base Sepolia',
    chainId: 84532,
    rpcUrl: X402_RPC_URLS['base-sepolia'],
    blockExplorer: 'https://sepolia.basescan.org',
    isTestnet: true,
    usdc: X402_USDC_ADDRESSES['base-sepolia'],
  },
  base: {
    name: 'Base',
    chainId: 8453,
    rpcUrl: X402_RPC_URLS.base,
    blockExplorer: 'https://basescan.org',
    isTestnet: false,
    usdc: X402_USDC_ADDRESSES.base,
  },
  ethereum: {
    name: 'Ethereum Mainnet',
    chainId: 1,
    rpcUrl: X402_RPC_URLS.ethereum,
    blockExplorer: 'https://etherscan.io',
    isTestnet: false,
    usdc: X402_USDC_ADDRESSES.ethereum,
  },
  jeju: {
    name: 'Jeju Localnet',
    chainId: 9545,
    rpcUrl: X402_RPC_URLS.jeju,
    blockExplorer: '',
    isTestnet: true,
    usdc: ZERO_ADDRESS,
  },
  'jeju-testnet': {
    name: 'Jeju Testnet (Sepolia)',
    chainId: 11155111,
    rpcUrl: X402_RPC_URLS['jeju-testnet'],
    blockExplorer: 'https://sepolia.etherscan.io',
    isTestnet: true,
    usdc: ZERO_ADDRESS,
  },
};

export const CREDITS_PER_DOLLAR = 100;

// ============================================================================
// Storage Pricing
// ============================================================================

export const STORAGE_PRICING = {
  // Per GB per month
  HOT_TIER_PER_GB_MONTH: 100000000000000n,      // 0.0001 ETH
  WARM_TIER_PER_GB_MONTH: 50000000000000n,      // 0.00005 ETH
  COLD_TIER_PER_GB_MONTH: 10000000000000n,      // 0.00001 ETH
  PERMANENT_PER_GB: 5000000000000000n,           // 0.005 ETH (one-time)

  // Bandwidth
  UPLOAD_PER_GB: 10000000000000n,               // 0.00001 ETH
  RETRIEVAL_PER_GB: 20000000000000n,            // 0.00002 ETH

  // Minimum fees
  MIN_UPLOAD_FEE: 1000000000000n,               // 0.000001 ETH
  MIN_PIN_FEE: 10000000000000n,                 // 0.00001 ETH
} as const;

// ============================================================================
// Configuration Functions
// ============================================================================

export function getX402Config(): X402Config {
  const enabled = process.env.X402_ENABLED !== 'false';
  const recipientAddress = (process.env.X402_RECIPIENT_ADDRESS || 
    process.env.PAYMENT_RECEIVER_ADDRESS || 
    ZERO_ADDRESS) as Address;
  const network = (process.env.X402_NETWORK || 'jeju') as X402Network;

  return {
    enabled,
    recipientAddress,
    network,
    creditsPerDollar: CREDITS_PER_DOLLAR,
  };
}

export function isX402Configured(): boolean {
  const config = getX402Config();
  return config.enabled && config.recipientAddress !== ZERO_ADDRESS;
}

export function getX402NetworkConfig(network?: X402Network): X402NetworkConfig {
  const targetNetwork = network || getX402Config().network;
  return X402_NETWORK_CONFIGS[targetNetwork];
}

// ============================================================================
// Payment Header Utilities
// ============================================================================

export function parseX402Header(header: string): X402PaymentHeader | null {
  const parts = header.split(';').reduce(
    (acc, part) => {
      const [key, value] = part.split('=');
      if (key && value) acc[key.trim()] = value.trim();
      return acc;
    },
    {} as Record<string, string>
  );

  if (!parts.scheme || !parts.network || !parts.payload) {
    return null;
  }

  return {
    scheme: parts.scheme,
    network: parts.network,
    payload: parts.payload,
    asset: parts.asset || ZERO_ADDRESS,
    amount: parts.amount || '0',
  };
}

/**
 * Generate x402 payment header with signed proof
 * 
 * Format: scheme=exact;network=...;payload=<JSON proof>;asset=...;amount=...
 * 
 * The payload is a JSON object with all payment details and signature,
 * enabling full verification including replay protection.
 */
export async function generateX402PaymentHeader(
  signer: Wallet,
  providerAddress: Address,
  amount: string,
  resource: string,
  network: X402Network = 'jeju'
): Promise<string> {
  const timestamp = Date.now();
  const nonce = crypto.randomUUID();
  
  // Construct message for signing
  const message = `x402:storage:${network}:${providerAddress}:${amount}:${nonce}:${timestamp}`;
  const signature = await signer.signMessage(message);

  // Create full payment proof
  const proof: X402PaymentProof = {
    scheme: 'exact',
    network,
    asset: ZERO_ADDRESS,
    payTo: providerAddress,
    amount,
    resource,
    nonce,
    timestamp,
    signature,
  };

  // Encode as header value
  return [
    `scheme=exact`,
    `network=${network}`,
    `payload=${JSON.stringify(proof)}`,
    `asset=${ZERO_ADDRESS}`,
    `amount=${amount}`,
  ].join(';');
}

/**
 * Generate simple x402 payment header (legacy format)
 * Use generateX402PaymentHeader for full proof with replay protection
 */
export async function generateSimplePaymentHeader(
  signer: Wallet,
  providerAddress: Address,
  amount: string,
  network: X402Network = 'jeju'
): Promise<string> {
  const message = `x402:storage:${network}:${providerAddress}:${amount}`;
  const signature = await signer.signMessage(message);

  return [
    `scheme=exact`,
    `network=${network}`,
    `payload=${signature}`,
    `asset=${ZERO_ADDRESS}`,
    `amount=${amount}`,
  ].join(';');
}

export interface X402VerifyOptions {
  expectedAmount?: bigint;
  maxAgeMs?: number; // Max age of payment header (default 5 minutes)
}

export interface X402PaymentProof {
  scheme: string;
  network: string;
  asset: Address;
  payTo: Address;
  amount: string;
  resource: string;
  nonce: string;
  timestamp: number;
  signature: string;
}

// Track used nonces to prevent replay attacks
const usedNonces = new Map<string, number>();
const NONCE_EXPIRY_MS = 10 * 60 * 1000; // Clear nonces after 10 minutes

// Periodic cleanup of expired nonces
setInterval(() => {
  const now = Date.now();
  for (const [nonce, timestamp] of usedNonces) {
    if (now - timestamp > NONCE_EXPIRY_MS) {
      usedNonces.delete(nonce);
    }
  }
}, NONCE_EXPIRY_MS / 2);

/**
 * Verify x402 payment header
 * 
 * Supports two verification methods:
 * 1. Simple message signature (x402:storage:network:provider:amount:nonce:timestamp)
 * 2. Full payment proof JSON with signature
 * 
 * @param payment Parsed X-Payment header
 * @param providerAddress Expected provider address (payTo)
 * @param expectedUserAddress Expected payer address
 * @param options Verification options
 */
export function verifyX402Payment(
  payment: X402PaymentHeader,
  providerAddress: Address,
  expectedUserAddress: Address,
  options: X402VerifyOptions = {}
): boolean {
  if (payment.scheme !== 'exact') return false;

  // Verify amount if specified
  if (options.expectedAmount !== undefined) {
    const paidAmount = BigInt(payment.amount || '0');
    if (paidAmount < options.expectedAmount) {
      console.warn(`[x402] Insufficient payment: ${paidAmount} < ${options.expectedAmount}`);
      return false;
    }
  }

  // Try to parse as JSON payment proof first
  try {
    const proof = JSON.parse(payment.payload) as X402PaymentProof;
    return verifyPaymentProof(proof, providerAddress, expectedUserAddress, options);
  } catch {
    // Fall back to simple signature format
  }

  // Simple signature format: payload is the signature
  const signature = payment.payload;
  const message = `x402:storage:${payment.network}:${providerAddress}:${payment.amount}`;
  
  try {
    const recoveredAddress = verifyMessage(message, signature);
    return recoveredAddress.toLowerCase() === expectedUserAddress.toLowerCase();
  } catch (e) {
    console.warn(`[x402] Signature verification failed:`, e);
    return false;
  }
}

/**
 * Verify full payment proof with timestamp and nonce checks
 */
function verifyPaymentProof(
  proof: X402PaymentProof,
  providerAddress: Address,
  expectedUserAddress: Address,
  options: X402VerifyOptions
): boolean {
  // Verify recipient matches
  if (proof.payTo.toLowerCase() !== providerAddress.toLowerCase()) {
    console.warn(`[x402] Wrong recipient: ${proof.payTo} != ${providerAddress}`);
    return false;
  }

  // Check timestamp (default 5 minutes)
  const maxAgeMs = options.maxAgeMs ?? 5 * 60 * 1000;
  const now = Date.now();
  if (Math.abs(now - proof.timestamp) > maxAgeMs) {
    console.warn(`[x402] Payment expired: timestamp ${proof.timestamp} too old`);
    return false;
  }

  // Check nonce not reused (replay protection)
  if (usedNonces.has(proof.nonce)) {
    console.warn(`[x402] Nonce already used: ${proof.nonce}`);
    return false;
  }

  // Reconstruct and verify message
  const message = `x402:storage:${proof.network}:${proof.payTo}:${proof.amount}:${proof.nonce}:${proof.timestamp}`;
  
  try {
    const recoveredAddress = verifyMessage(message, proof.signature);
    if (recoveredAddress.toLowerCase() !== expectedUserAddress.toLowerCase()) {
      console.warn(`[x402] Signer mismatch: ${recoveredAddress} != ${expectedUserAddress}`);
      return false;
    }

    // Mark nonce as used
    usedNonces.set(proof.nonce, now);
    return true;
  } catch (e) {
    console.warn(`[x402] Proof verification failed:`, e);
    return false;
  }
}

// ============================================================================
// Payment Requirement Utilities
// ============================================================================

export function createStoragePaymentRequirement(
  resource: string,
  amountWei: bigint,
  payTo: Address,
  description: string,
  network: X402Network = 'jeju'
): X402PaymentRequirement {
  const netConfig = getX402NetworkConfig(network);
  const accepts: X402PaymentOption[] = [];

  if (JEJU_TOKEN_ADDRESS !== ZERO_ADDRESS) {
    accepts.push({
      scheme: 'paymaster',
      network,
      maxAmountRequired: amountWei.toString(),
      asset: JEJU_TOKEN_ADDRESS,
      payTo,
      resource,
      description: `${description} (JEJU)`,
    });
  }

  // Native ETH
  accepts.push({
    scheme: 'exact',
    network,
    maxAmountRequired: amountWei.toString(),
    asset: ZERO_ADDRESS,
    payTo,
    resource,
    description: `${description} (ETH)`,
  });

  // Credit balance
  accepts.push({
    scheme: 'credit',
    network,
    maxAmountRequired: amountWei.toString(),
    asset: ZERO_ADDRESS,
    payTo,
    resource,
    description: 'Pay from prepaid credit balance',
  });

  // Add USDC option if available on network
  if (netConfig.usdc !== ZERO_ADDRESS) {
    accepts.push({
      scheme: 'paymaster',
      network,
      maxAmountRequired: amountWei.toString(),
      asset: netConfig.usdc,
      payTo,
      resource,
      description: `${description} (USDC via paymaster)`,
    });
  }

  return {
    x402Version: 1,
    error: 'Payment required to access storage service',
    accepts,
  };
}

// ============================================================================
// Cost Calculation
// ============================================================================

export function calculateStorageCost(
  sizeBytes: number,
  durationDays: number,
  tier: 'hot' | 'warm' | 'cold' | 'permanent' = 'warm'
): bigint {
  const sizeGB = sizeBytes / (1024 ** 3);
  const months = durationDays / 30;

  let baseCost: bigint;
  if (tier === 'permanent') {
    baseCost = BigInt(Math.ceil(sizeGB * Number(STORAGE_PRICING.PERMANENT_PER_GB)));
  } else {
    const pricePerGBMonth = tier === 'hot' 
      ? STORAGE_PRICING.HOT_TIER_PER_GB_MONTH
      : tier === 'warm'
        ? STORAGE_PRICING.WARM_TIER_PER_GB_MONTH
        : STORAGE_PRICING.COLD_TIER_PER_GB_MONTH;
    baseCost = BigInt(Math.ceil(sizeGB * months * Number(pricePerGBMonth)));
  }

  // Add upload bandwidth cost
  const uploadCost = BigInt(Math.ceil(sizeGB * Number(STORAGE_PRICING.UPLOAD_PER_GB)));

  const totalCost = baseCost + uploadCost;
  return totalCost > STORAGE_PRICING.MIN_UPLOAD_FEE ? totalCost : STORAGE_PRICING.MIN_UPLOAD_FEE;
}

export function calculateRetrievalCost(sizeBytes: number): bigint {
  const sizeGB = sizeBytes / (1024 ** 3);
  return BigInt(Math.ceil(sizeGB * Number(STORAGE_PRICING.RETRIEVAL_PER_GB)));
}

export function formatStorageCost(weiAmount: bigint): string {
  const eth = Number(weiAmount) / 1e18;
  const ethPrice = 3000; // Approximate

  if (eth < 0.0001) {
    return `~$${(eth * ethPrice * 100).toFixed(2)} cents`;
  }

  return `${eth.toFixed(6)} ETH (~$${(eth * ethPrice).toFixed(4)})`;
}

// ============================================================================
// X402 Client Class
// ============================================================================

export class StorageX402Client {
  private signer: Wallet;
  private network: X402Network;
  private config: X402Config;

  constructor(signer: Wallet, network?: X402Network) {
    this.signer = signer;
    this.config = getX402Config();
    this.network = network || this.config.network;
  }

  async generatePayment(providerAddress: Address, amount: string, resource: string): Promise<string> {
    return generateX402PaymentHeader(this.signer, providerAddress, amount, resource, this.network);
  }

  verifyPayment(payment: X402PaymentHeader, providerAddress: Address): boolean {
    return verifyX402Payment(payment, providerAddress, this.signer.address as Address);
  }

  async paidFetch(
    url: string,
    options: RequestInit,
    providerAddress: Address,
    amount: string,
    resource: string
  ): Promise<Response> {
    const paymentHeader = await this.generatePayment(providerAddress, amount, resource);

    const headers = new Headers(options.headers);
    headers.set('X-Payment', paymentHeader);
    headers.set('x-jeju-address', this.signer.address);

    return fetch(url, { ...options, headers });
  }

  async handlePaymentRequired(
    response: Response,
    url: string,
    options: RequestInit
  ): Promise<Response> {
    if (response.status !== 402) return response;

    const requirement = (await response.json()) as X402PaymentRequirement;
    const exactPayment = requirement.accepts.find((a) => a.scheme === 'exact');

    if (!exactPayment) {
      throw new Error('No exact payment scheme available');
    }

    return this.paidFetch(url, options, exactPayment.payTo, exactPayment.maxAmountRequired, exactPayment.resource);
  }

  getNetworkConfig(): X402NetworkConfig {
    return getX402NetworkConfig(this.network);
  }

  getAddress(): Address {
    return this.signer.address as Address;
  }
}

