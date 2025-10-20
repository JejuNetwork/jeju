/**
 * x402 Payment Protocol Implementation for Leaderboard
 * Based on standardized x402 specification v1.0
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
 * Payment tier definitions for Leaderboard
 */
export const PAYMENT_TIERS = {
  // Basic Access
  LEADERBOARD_VIEW: parseEther('0.001'), // 0.001 ETH for premium leaderboard view
  PLAYER_STATS: parseEther('0.002'), // 0.002 ETH for detailed player stats
  
  // Premium Features
  HISTORICAL_DATA: parseEther('0.01'), // 0.01 ETH for historical data
  PREMIUM_ANALYTICS: parseEther('0.05'), // 0.05 ETH for premium analytics
  ANALYTICS_DASHBOARD: parseEther('0.05'), // 0.05 ETH for analytics dashboard (alias)
  
  // API Access
  API_DAILY: parseEther('0.1'), // 0.1 ETH for daily API access
  API_MONTHLY: parseEther('2.0'), // 2 ETH for monthly API access
  
  // TEE Verification
  TEE_VERIFY: parseEther('0.005'), // 0.005 ETH for TEE verification request
} as const;

/**
 * Create a 402 Payment Required response
 */
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
        serviceName: 'Jeju Leaderboard',
        category: 'leaderboard',
      },
    }],
  };
}

const EIP712_DOMAIN = {
  name: 'x402 Payment Protocol',
  version: '1',
  chainId: 0,
  verifyingContract: '0x0000000000000000000000000000000000000000' as Address,
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

export async function verifyPayment(
  payload: PaymentPayload,
  expectedAmount: bigint,
  expectedRecipient: Address
): Promise<{ valid: boolean; error?: string; signer?: Address }> {
  if (!payload.amount || !payload.payTo || !payload.asset) {
    return { valid: false, error: 'Missing required payment fields' };
  }

  const paymentAmount = BigInt(payload.amount);
  
  if (paymentAmount < expectedAmount) {
    return { 
      valid: false, 
      error: `Insufficient payment: ${formatEther(paymentAmount)} ETH < ${formatEther(expectedAmount)} ETH required` 
    };
  }

  if (payload.payTo.toLowerCase() !== expectedRecipient.toLowerCase()) {
    return { 
      valid: false, 
      error: `Invalid recipient` 
    };
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - payload.timestamp) > 300) {
    return { valid: false, error: 'Payment timestamp expired' };
  }

  if (!payload.signature) {
    return { valid: false, error: 'Payment signature required' };
  }

  try {
    const { verifyTypedData, recoverTypedDataAddress } = await import('viem');
    
    const chainId = 1337; // Jeju L3

    const domain = { ...EIP712_DOMAIN, chainId };

    const message = {
      scheme: payload.scheme,
      network: payload.network,
      asset: payload.asset,
      payTo: payload.payTo,
      amount: BigInt(payload.amount),
      resource: payload.resource,
      nonce: payload.nonce,
      timestamp: BigInt(payload.timestamp),
    };

    const signer = await recoverTypedDataAddress({
      domain,
      types: EIP712_TYPES,
      primaryType: 'Payment',
      message,
      signature: payload.signature as `0x${string}`,
    });

    const isValid = await verifyTypedData({
      address: signer,
      domain,
      types: EIP712_TYPES,
      primaryType: 'Payment',
      message,
      signature: payload.signature as `0x${string}`,
    });

    if (!isValid) {
      return { valid: false, error: 'Invalid payment signature' };
    }

    return { valid: true, signer };
  } catch (error) {
    console.error('[x402] Signature verification error:', error);
    return { 
      valid: false, 
      error: `Signature verification failed` 
    };
  }
}

export async function settlePayment(payload: PaymentPayload): Promise<SettlementResponse> {
  try {
    const { createPublicClient, createWalletClient, http, parseAbi } = await import('viem');
    const { privateKeyToAccount } = await import('viem/accounts');
    
    const JEJU_CHAIN = {
      id: 1337,
      name: 'Jeju L3',
      network: 'jeju',
      nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
      rpcUrls: {
        default: { http: [process.env.NEXT_PUBLIC_RPC_URL || 'http://localhost:9545'] },
        public: { http: [process.env.NEXT_PUBLIC_RPC_URL || 'http://localhost:9545'] },
      },
    };
    
    const settlementKey = process.env.SETTLEMENT_PRIVATE_KEY;
    
    if (!settlementKey) {
      return {
        settled: false,
        error: 'Settlement wallet not configured',
      };
    }

    const account = privateKeyToAccount(settlementKey as `0x${string}`);
    
    const publicClient = createPublicClient({
      chain: JEJU_CHAIN,
      transport: http(),
    });

    const walletClient = createWalletClient({
      account,
      chain: JEJU_CHAIN,
      transport: http(),
    });

    if (payload.asset === '0x0000000000000000000000000000000000000000') {
      return {
        settled: true,
        txHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        blockNumber: Number(await publicClient.getBlockNumber()),
        timestamp: Math.floor(Date.now() / 1000),
        amountSettled: payload.amount,
      };
    }

    const erc20Abi = parseAbi([
      'function transferFrom(address from, address to, uint256 amount) returns (bool)',
    ]);

    const hash = await walletClient.writeContract({
      address: payload.asset,
      abi: erc20Abi,
      functionName: 'transferFrom',
      args: [account.address, payload.payTo, BigInt(payload.amount)],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return {
      settled: true,
      txHash: hash,
      blockNumber: Number(receipt.blockNumber),
      timestamp: Math.floor(Date.now() / 1000),
      amountSettled: payload.amount,
    };
  } catch (error) {
    return {
      settled: false,
      error: error instanceof Error ? error.message : 'Settlement failed',
    };
  }
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
): Promise<{ paid: boolean; settlement?: SettlementResponse; error?: string }> {
  const payment = parsePaymentHeader(paymentHeader);
  
  if (!payment) {
    return { paid: false, error: 'No payment header provided' };
  }

  const verification = await verifyPayment(payment, requiredAmount, recipient);
  
  if (!verification.valid) {
    return { paid: false, error: verification.error };
  }

  const settlement = await settlePayment(payment);
  
  if (!settlement.settled) {
    return { paid: false, error: settlement.error };
  }

  return { paid: true, settlement };
}
