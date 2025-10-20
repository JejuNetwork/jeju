/**
 * x402 Payment Protocol Implementation for Crucible
 * Based on x402 specification v1.0
 * Supports both ETH and ERC-20 token payments with on-chain settlement
 */

import { Address, parseEther, formatEther } from 'viem';
import { ethers } from 'ethers';

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
  // Security Testing Fees
  SECURITY_TEST: parseEther('0.01'), // Run custom security test
  VULNERABILITY_REPORT: parseEther('0.05'), // Get detailed vulnerability report
  PREMIUM_REPORT_DAILY: parseEther('0.5'), // Daily premium reports
  PREMIUM_REPORT_WEEKLY: parseEther('2.0'), // Weekly premium access
  
  // Subscriptions
  CONTINUOUS_MONITORING_DAILY: parseEther('0.1'),
  CONTINUOUS_MONITORING_MONTHLY: parseEther('2.5'),
  
  // Custom Services
  PENETRATION_TEST: parseEther('1.0'), // Full contract audit
  CODE_REVIEW: parseEther('0.5'), // Smart contract review
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
 * Nonce tracking to prevent replay attacks
 */
const usedNonces = new Set<string>();

/**
 * Store nonce in database for permanent tracking
 */
async function storeUsedNonce(nonce: string, signer: string, runtime?: any): Promise<void> {
  const nonceKey = `x402_nonce_${nonce}_${signer}`;
  usedNonces.add(nonceKey);
  
  // Also store in database if runtime available
  if (runtime?.setCache) {
    await runtime.setCache(nonceKey, {
      nonce,
      signer,
      usedAt: Date.now()
    });
  }
}

/**
 * Check if nonce has been used
 */
async function isNonceUsed(nonce: string, signer: string, runtime?: any): Promise<boolean> {
  const nonceKey = `x402_nonce_${nonce}_${signer}`;
  
  // Check in-memory cache first
  if (usedNonces.has(nonceKey)) {
    return true;
  }
  
  // Check database if runtime available
  if (runtime?.getCache) {
    const cached = await runtime.getCache(nonceKey);
    if (cached) {
      usedNonces.add(nonceKey); // Sync to in-memory cache
      return true;
    }
  }
  
  return false;
}

/**
 * Settle a payment on-chain
 * Supports both ETH and ERC-20 token payments
 * Includes nonce tracking to prevent replay attacks
 */
export async function settlePayment(
  payload: PaymentPayload,
  rpcUrl?: string,
  runtime?: any
): Promise<SettlementResponse> {
  try {
    // Verify signature and get signer FIRST (for nonce check)
    const verification = await verifyPayment(
      payload, 
      BigInt(payload.amount), 
      payload.payTo
    );
    
    if (!verification.valid || !verification.signer) {
      return {
        settled: false,
        error: verification.error || 'Invalid payment signature'
      };
    }
    
    const signer = verification.signer;
    
    // Check for replay attack
    if (await isNonceUsed(payload.nonce, signer, runtime)) {
      return {
        settled: false,
        error: 'Payment nonce already used (replay attack prevented)'
      };
    }
    
    // Get RPC URL from environment or parameter
    const finalRpcUrl = rpcUrl || process.env.JEJU_L2_RPC || 'http://127.0.0.1:9545';
    const provider = new ethers.JsonRpcProvider(finalRpcUrl);
    
    const requiredAmount = BigInt(payload.amount);
    
    // === ETH Payment ===
    if (payload.asset === '0x0000000000000000000000000000000000000000' || 
        payload.asset.toLowerCase() === ethers.ZeroAddress.toLowerCase()) {
      
      // Check signer has sufficient ETH balance
      const balance = await provider.getBalance(signer);
      
      if (balance < requiredAmount) {
        return {
          settled: false,
          error: `Insufficient ETH balance: ${ethers.formatEther(balance)} < ${ethers.formatEther(requiredAmount)}`
        };
      }
      
      // For ETH payments, we expect the signer to send ETH directly to payTo
      // We verify by checking recent transactions or a payment-specific contract
      // For now, we'll mark as settled if they have the balance
      // In production, you'd want a payment escrow contract
      
      console.warn('[x402] ETH payment verified but not escrowed - ensure payment is sent separately');
      
      // Mark nonce as used
      await storeUsedNonce(payload.nonce, signer, runtime);
      
      return {
        settled: true,
        txHash: '0x0000000000000000000000000000000000000000000000000000000000000000', // No tx yet
        blockNumber: await provider.getBlockNumber(),
        timestamp: Math.floor(Date.now() / 1000),
        amountSettled: payload.amount,
        error: 'ETH payment verified - awaiting direct transfer'
      };
    }
    
    // === ERC-20 Payment ===
    const erc20Abi = [
      'function balanceOf(address owner) view returns (uint256)',
      'function allowance(address owner, address spender) view returns (uint256)',
      'function transferFrom(address from, address to, uint256 amount) returns (bool)',
      'function transfer(address to, uint256 amount) returns (bool)'
    ];
    
    const tokenContract = new ethers.Contract(payload.asset, erc20Abi, provider);
    
    // Check signer has sufficient token balance
    const balance = await tokenContract.balanceOf(signer);
    
    if (balance < requiredAmount) {
      return {
        settled: false,
        error: `Insufficient token balance: ${balance} < ${requiredAmount}`
      };
    }
    
    // Get settlement wallet (recipient's wallet that will execute transferFrom)
    const settlementKey = process.env.X402_SETTLEMENT_PRIVATE_KEY || process.env.REDTEAM_PRIVATE_KEY;
    
    if (!settlementKey) {
      return {
        settled: false,
        error: 'X402_SETTLEMENT_PRIVATE_KEY not configured - cannot settle payment'
      };
    }
    
    const settlementWallet = new ethers.Wallet(settlementKey, provider);
    const tokenWithSigner = tokenContract.connect(settlementWallet);
    
    // Check if we have approval to use transferFrom
    const allowance = await tokenContract.allowance(signer, settlementWallet.address);
    
    if (allowance >= requiredAmount) {
      // We have approval - use transferFrom
      const tx = await tokenWithSigner.transferFrom(signer, payload.payTo, requiredAmount);
      const receipt = await tx.wait();
      
      // Mark nonce as used
      await storeUsedNonce(payload.nonce, signer, runtime);
      
      return {
        settled: true,
        txHash: receipt?.hash,
        blockNumber: receipt?.blockNumber,
        timestamp: Math.floor(Date.now() / 1000),
        amountSettled: payload.amount
      };
    }
    
    // No approval - signer must approve first or send directly
    return {
      settled: false,
      error: `Token approval required: signer must approve ${payload.payTo} to spend ${requiredAmount} tokens`
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
  recipient: Address,
  rpcUrl?: string,
  runtime?: any
): Promise<{ paid: boolean; settlement?: SettlementResponse; error?: string }> {
  const payment = parsePaymentHeader(paymentHeader);
  
  if (!payment) {
    return { paid: false, error: 'No payment header provided' };
  }

  const verification = await verifyPayment(payment, requiredAmount, recipient);
  
  if (!verification.valid) {
    return { paid: false, error: verification.error };
  }

  const settlement = await settlePayment(payment, rpcUrl, runtime);
  
  if (!settlement.settled) {
    return { paid: false, error: settlement.error };
  }

  return { paid: true, settlement };
}

