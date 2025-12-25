/**
 * Shared x402 Payment Protocol Implementation
 *
 * Shared x402 library for all network apps (bazaar, gateway, compute, storage, cloud)
 * Implements Coinbase x402 specification with EIP-712 signatures
 *
 * @see https://x402.org
 */

import {
  type Address,
  formatEther,
  parseEther,
  recoverTypedDataAddress,
  verifyTypedData,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { PaymentPayloadSchema } from '../../schemas'

export type {
  PaymentPayload,
  PaymentRequirements,
  PaymentScheme,
  SettlementResponse,
  UntrustedPaymentPayload,
  X402Network,
} from '@jejunetwork/shared'

import type {
  PaymentPayload,
  PaymentRequirements,
  UntrustedPaymentPayload,
  X402Network,
} from '@jejunetwork/shared'
import { isValidPaymentPayload } from '@jejunetwork/shared'

export interface X402Config {
  recipientAddress: Address
  network: X402Network
  serviceName: string
}
export const CHAIN_IDS: Record<X402Network, number> = {
  sepolia: 11155111,
  'base-sepolia': 84532,
  ethereum: 1,
  base: 8453,
  jeju: 420691,
  'jeju-testnet': 420690,
}

export const RPC_URLS: Record<X402Network, string> = {
  sepolia: 'https://ethereum-sepolia-rpc.publicnode.com',
  'base-sepolia': 'https://sepolia.base.org',
  ethereum: 'https://eth.llamarpc.com',
  base: 'https://mainnet.base.org',
  jeju: process.env.JEJU_RPC_URL || 'http://127.0.0.1:6546',
  'jeju-testnet':
    process.env.JEJU_TESTNET_RPC_URL || 'https://testnet-rpc.jejunetwork.org',
}

// USDC addresses per network
export const USDC_ADDRESSES: Record<X402Network, Address> = {
  sepolia: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  jeju: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
  'jeju-testnet': '0x0000000000000000000000000000000000000000',
}
export const PAYMENT_TIERS = {
  // API Access
  API_CALL_BASIC: parseEther('0.0001'),
  API_CALL_PREMIUM: parseEther('0.001'),
  API_DAILY_ACCESS: parseEther('0.1'),
  API_MONTHLY_ACCESS: parseEther('2.0'),

  // Compute Services
  COMPUTE_INFERENCE: parseEther('0.0005'),
  COMPUTE_HOURLY: parseEther('0.05'),
  COMPUTE_GPU_HOURLY: parseEther('0.5'),

  // Storage
  STORAGE_PER_GB_MONTH: parseEther('0.001'),
  STORAGE_RETRIEVAL: parseEther('0.0001'),

  // Marketplace
  NFT_LISTING: parseEther('0.001'),
  NFT_PURCHASE_FEE_BPS: 250, // 2.5%
  SWAP_FEE_BPS: 30, // 0.3%
  POOL_CREATION: parseEther('0.01'),

  // Games
  GAME_ENTRY: parseEther('0.01'),
  GAME_PREMIUM: parseEther('0.05'),
  BET_PLACEMENT: parseEther('0.001'),
  MARKET_CREATION: parseEther('0.02'),
} as const
const EIP712_DOMAIN_BASE = {
  name: 'x402 Payment Protocol',
  version: '1',
  verifyingContract: '0x0000000000000000000000000000000000000000' as Address,
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
}
/**
 * Create a 402 Payment Required response
 */
export function createPaymentRequirement(
  resource: string,
  amount: bigint,
  description: string,
  config: X402Config,
  tokenAddress: Address = '0x0000000000000000000000000000000000000000',
): PaymentRequirements {
  return {
    x402Version: 1,
    error: 'Payment required to access this resource',
    accepts: [
      {
        scheme: 'exact',
        network: config.network,
        maxAmountRequired: amount.toString(),
        asset: tokenAddress,
        payTo: config.recipientAddress,
        resource,
        description,
        mimeType: 'application/json',
        outputSchema: null,
        maxTimeoutSeconds: 300,
        extra: {
          serviceName: config.serviceName,
        },
      },
    ],
  }
}

/**
 * Get EIP-712 domain for a network
 */
export function getEIP712Domain(network: X402Network) {
  return {
    ...EIP712_DOMAIN_BASE,
    chainId: CHAIN_IDS[network],
  }
}

/**
 * Get EIP-712 types for payment message
 */
export function getEIP712Types() {
  return EIP712_TYPES
}

/**
 * Generate cryptographically secure nonce
 */
function generateSecureNonce(): string {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Create a payment payload ready for signing
 */
export function createPaymentPayload(
  asset: Address,
  payTo: Address,
  amount: bigint,
  resource: string,
  network: X402Network = 'sepolia',
): Omit<PaymentPayload, 'signature'> {
  return {
    scheme: 'exact',
    network,
    asset,
    payTo,
    amount: amount.toString(),
    resource,
    nonce: generateSecureNonce(),
    timestamp: Math.floor(Date.now() / 1000),
  }
}

/**
 * Parse x402 payment header from request
 * Validates against schema to ensure all required fields are present
 */
export function parsePaymentHeader(
  headerValue: string | null,
): PaymentPayload | null {
  if (!headerValue) return null

  try {
    const parsed = JSON.parse(headerValue)
    const result = PaymentPayloadSchema.safeParse(parsed)
    if (!result.success) {
      return null
    }
    return result.data as PaymentPayload
  } catch {
    return null
  }
}

/**
 * Verify payment with EIP-712 signature validation
 * Accepts UntrustedPaymentPayload at boundary for runtime validation
 */
export async function verifyPayment(
  payload: UntrustedPaymentPayload,
  expectedAmount: bigint,
  expectedRecipient: Address,
): Promise<{ valid: boolean; error?: string; signer?: Address }> {
  if (!isValidPaymentPayload(payload)) {
    return { valid: false, error: 'Missing required payment fields' }
  }

  const paymentAmount = BigInt(payload.amount)

  if (paymentAmount < expectedAmount) {
    return {
      valid: false,
      error: `Insufficient payment: ${formatEther(paymentAmount)} < ${formatEther(expectedAmount)} required`,
    }
  }

  if (payload.payTo.toLowerCase() !== expectedRecipient.toLowerCase()) {
    return {
      valid: false,
      error: `Invalid recipient: ${payload.payTo} !== ${expectedRecipient}`,
    }
  }

  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - payload.timestamp) > 300) {
    return { valid: false, error: 'Payment timestamp expired' }
  }

  if (!payload.signature) {
    return { valid: false, error: 'Payment signature required' }
  }

  const network = payload.network as X402Network
  const domain = getEIP712Domain(network)

  const message = {
    scheme: payload.scheme,
    network: payload.network,
    asset: payload.asset,
    payTo: payload.payTo,
    amount: BigInt(payload.amount),
    resource: payload.resource,
    nonce: payload.nonce,
    timestamp: BigInt(payload.timestamp),
  }

  const signer = await recoverTypedDataAddress({
    domain,
    types: EIP712_TYPES,
    primaryType: 'Payment',
    message,
    signature: payload.signature as `0x${string}`,
  })

  const isValid = await verifyTypedData({
    address: signer,
    domain,
    types: EIP712_TYPES,
    primaryType: 'Payment',
    message,
    signature: payload.signature as `0x${string}`,
  })

  if (!isValid) {
    return { valid: false, error: 'Invalid payment signature' }
  }

  return { valid: true, signer }
}

/**
 * Sign a payment payload using EIP-712
 */
export async function signPaymentPayload(
  payload: Omit<PaymentPayload, 'signature'>,
  privateKey: `0x${string}`,
): Promise<PaymentPayload> {
  const account = privateKeyToAccount(privateKey)
  const network = payload.network as X402Network
  const domain = getEIP712Domain(network)

  const message = {
    scheme: payload.scheme,
    network: payload.network,
    asset: payload.asset,
    payTo: payload.payTo,
    amount: BigInt(payload.amount),
    resource: payload.resource,
    nonce: payload.nonce,
    timestamp: BigInt(payload.timestamp),
  }

  const signature = await account.signTypedData({
    domain,
    types: EIP712_TYPES,
    primaryType: 'Payment',
    message,
  })

  return { ...payload, signature }
}

/**
 * Check if request has valid x402 payment
 */
export async function checkPayment(
  paymentHeader: string | null,
  requiredAmount: bigint,
  recipient: Address,
): Promise<{ paid: boolean; error?: string }> {
  const payment = parsePaymentHeader(paymentHeader)

  if (!payment) {
    return { paid: false, error: 'No payment header provided' }
  }

  const verification = await verifyPayment(payment, requiredAmount, recipient)

  if (!verification.valid) {
    return { paid: false, error: verification.error }
  }

  return { paid: true }
}

/**
 * Calculate percentage-based fee
 */
export function calculatePercentageFee(
  amount: bigint,
  basisPoints: number,
): bigint {
  return (amount * BigInt(basisPoints)) / BigInt(10000)
}

/**
 * Generate 402 response headers
 */
export function generate402Headers(
  requirements: PaymentRequirements,
): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'WWW-Authenticate': 'x402',
    'X-Payment-Requirement': JSON.stringify(requirements),
    'Access-Control-Expose-Headers': 'X-Payment-Requirement, WWW-Authenticate',
  }
}
