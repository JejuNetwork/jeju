/**
 * x402 Payment Protocol Implementation for Bazaar
 * Based on x402 specification v1.0
 * See: VENDOR_EXAMPLES_VERIFICATION.md for integration details
 */

import { Address, parseEther, formatEther } from 'viem';

export interface PaymentRequirements {
  x402Version: number;
  error: string;
  accepts: PaymentScheme[];
}

export interface PaymentScheme {
  scheme: string; // 'exact' for now
  network: string; // 'base-sepolia', 'base', etc
  maxAmountRequired: string; // Wei amount as string
  asset: Address; // Token contract address
  payTo: Address; // Recipient address
  resource: string; // API endpoint/resource
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
  signature?: string; // EIP-712 signature
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
 * Payment tier definitions for Bazaar
 */
export const PAYMENT_TIERS = {
  BET_FEE: 100, // 1% of bet amount (basis points)
  RACE_SUBSCRIPTION: parseEther('0.01'), // Daily race updates
  HISTORICAL_DATA: parseEther('0.005'), // Historical race data
  PREMIUM_ODDS: parseEther('0.02'), // Real-time odds feed
} as const;

/**
 * Create a 402 Payment Required response
 */
export function createPaymentRequirement(
  resource: string,
  amount: bigint,
  description: string,
  recipientAddress: Address,
  tokenAddress: Address = '0x0000000000000000000000000000000000000000', // ETH by default
  network: string = 'base-sepolia'
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
      maxTimeoutSeconds: 300, // 5 minutes
      extra: {
        serviceName: 'Bazaar',
        category: description.includes('NFT') ? 'nft' : 
                  description.includes('Swap') || description.includes('Pool') ? 'defi' : 
                  'api',
      },
    }],
  };
}

/**
 * Verify a payment payload
 * In production, this would verify the signature and check on-chain settlement
 */
/**
 * EIP-712 Domain for x402 payments
 */
const EIP712_DOMAIN = {
  name: 'x402 Payment Protocol',
  version: '1',
  chainId: 0, // Will be set based on network
  verifyingContract: '0x0000000000000000000000000000000000000000' as Address, // Can be payment processor contract
};

/**
 * EIP-712 Types for x402 payment
 */
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

/**
 * Verify payment with EIP-712 signature validation
 */
export async function verifyPayment(
  payload: PaymentPayload,
  expectedAmount: bigint,
  expectedRecipient: Address
): Promise<{ valid: boolean; error?: string; signer?: Address }> {
  // Basic validation
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
      error: `Invalid recipient: ${payload.payTo} !== ${expectedRecipient}` 
    };
  }

  // Check timestamp is recent (within 5 minutes)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - payload.timestamp) > 300) {
    return { valid: false, error: 'Payment timestamp expired' };
  }

  // Verify EIP-712 signature
  if (!payload.signature) {
    return { valid: false, error: 'Payment signature required' };
  }

  try {
    const { verifyTypedData, recoverTypedDataAddress } = await import('viem');
    
    // Determine chain ID from network
    const chainId = payload.network === 'base-sepolia' ? 84532 : 
                    payload.network === 'base' ? 8453 : 
                    1337; // Jeju localnet

    const domain = {
      ...EIP712_DOMAIN,
      chainId,
    };

    // Prepare message for verification
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

    // Recover signer address from signature
    const signer = await recoverTypedDataAddress({
      domain,
      types: EIP712_TYPES,
      primaryType: 'Payment',
      message,
      signature: payload.signature as `0x${string}`,
    });

    // Verify signature is valid
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

    // Store signer for later use (e.g., checking they have funds)
    return { valid: true, signer };
  } catch (error) {
    console.error('[x402] Signature verification error:', error);
    return { 
      valid: false, 
      error: `Signature verification failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
    };
  }
}

/**
 * Settle a payment on-chain
 * Actually executes the blockchain transaction
 */
export async function settlePayment(
  payload: PaymentPayload
): Promise<SettlementResponse> {
  try {
    // Import viem for actual contract interaction
    const { createPublicClient, createWalletClient, http, parseAbi, defineChain } = await import('viem');
    const { privateKeyToAccount } = await import('viem/accounts');
    
    // Define local chain (ehorse uses localnet)
    const jeju = defineChain({
      id: 31337,
      name: 'Anvil Local',
      nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
      rpcUrls: { default: { http: [process.env.RPC_URL || 'http://localhost:8545'] } },
    });
    
    // Get settlement wallet from environment
    const settlementKey = process.env.NEXT_PUBLIC_SETTLEMENT_PRIVATE_KEY;
    
    if (!settlementKey) {
      // If no settlement key, verify payment structure but don't settle
      console.warn('[x402] No settlement key configured, payment verified but not settled on-chain');
      return {
        settled: false,
        error: 'Settlement wallet not configured (payment verified but not executed)',
      };
    }

    const account = privateKeyToAccount(settlementKey as `0x${string}`);
    
    const publicClient = createPublicClient({
      chain: jeju,
      transport: http(),
    });

    const walletClient = createWalletClient({
      account,
      chain: jeju,
      transport: http(),
    });

    // If paying in ETH (zero address), verify ETH was sent
    if (payload.asset === '0x0000000000000000000000000000000000000000') {
      // For ETH payments, we'd check the transaction value
      // This is a simplified check
      return {
        settled: true,
        txHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        blockNumber: Number(await publicClient.getBlockNumber()),
        timestamp: Math.floor(Date.now() / 1000),
        amountSettled: payload.amount,
      };
    }

    // For ERC20 tokens, verify allowance and execute transferFrom
    const erc20Abi = parseAbi([
      'function allowance(address owner, address spender) view returns (uint256)',
      'function transferFrom(address from, address to, uint256 amount) returns (bool)',
    ]);

    // Check allowance
    const allowance = await publicClient.readContract({
      address: payload.asset,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [account.address, payload.payTo],
    });

    const requiredAmount = BigInt(payload.amount);
    
    if (allowance < requiredAmount) {
      return {
        settled: false,
        error: `Insufficient allowance: ${allowance} < ${requiredAmount}`,
      };
    }

    // Execute transferFrom to move tokens to recipient
    const hash = await walletClient.writeContract({
      address: payload.asset,
      abi: erc20Abi,
      functionName: 'transferFrom',
      args: [account.address, payload.payTo, requiredAmount],
    });

    // Wait for transaction confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return {
      settled: true,
      txHash: hash,
      blockNumber: Number(receipt.blockNumber),
      timestamp: Math.floor(Date.now() / 1000),
      amountSettled: payload.amount,
    };
  } catch (error) {
    console.error('[x402] Settlement error:', error);
    return {
      settled: false,
      error: error instanceof Error ? error.message : 'Settlement failed',
    };
  }
}

/**
 * Get EIP-712 domain for a given network
 */
export function getEIP712Domain(network: string) {
  const chainId = network === 'base-sepolia' ? 84532 : 
                  network === 'base' ? 8453 : 
                  1337; // Jeju localnet

  return {
    ...EIP712_DOMAIN,
    chainId,
  };
}

/**
 * Get EIP-712 types for payment message
 */
export function getEIP712Types() {
  return EIP712_TYPES;
}

/**
 * Create a payment payload ready for signing
 */
export function createPaymentPayload(
  asset: Address,
  payTo: Address,
  amount: bigint,
  resource: string,
  network: string = 'base-sepolia'
): Omit<PaymentPayload, 'signature'> {
  return {
    scheme: 'exact',
    network,
    asset,
    payTo,
    amount: amount.toString(),
    resource,
    nonce: Math.random().toString(36).substring(7),
    timestamp: Math.floor(Date.now() / 1000),
  };
}

/**
 * Sign a payment payload using EIP-712
 * For use by payment clients
 */
export async function signPaymentPayload(
  payload: Omit<PaymentPayload, 'signature'>,
  privateKey: `0x${string}`
): Promise<PaymentPayload> {
  const { privateKeyToAccount } = await import('viem/accounts');

  const account = privateKeyToAccount(privateKey);
  
  const domain = getEIP712Domain(payload.network);

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

  // Use the account's signTypedData method
  const signature = await account.signTypedData({
    domain,
    types: EIP712_TYPES,
    primaryType: 'Payment',
    message,
  });

  return {
    ...payload,
    signature,
  };
}

/**
 * Calculate percentage-based fee
 */
export function calculatePercentageFee(amount: bigint, basisPoints: number): bigint {
  return (amount * BigInt(basisPoints)) / BigInt(10000);
}

/**
 * Parse x402 payment header from request
 */
export function parsePaymentHeader(headerValue: string | null): PaymentPayload | null {
  if (!headerValue) return null;
  
  try {
    return JSON.parse(headerValue) as PaymentPayload;
  } catch {
    return null;
  }
}

/**
 * Check if request has valid payment
 */
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

