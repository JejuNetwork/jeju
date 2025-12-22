/**
 * EIP-3009 Utilities for Gasless Token Transfers
 *
 * Implements signing and verification for transferWithAuthorization
 * Used by x402 gasless settlement flow
 */

import type { WalletClient } from 'viem'
import { type Address, encodePacked, type Hex, keccak256, toHex } from 'viem'

export const EIP3009_TYPEHASH = keccak256(
  encodePacked(
    ['string'],
    [
      'TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)',
    ],
  ),
)

export interface EIP3009Authorization {
  from: Address
  to: Address
  value: bigint
  validAfter: number
  validBefore: number
  nonce: Hex
}

export interface SignedEIP3009Authorization extends EIP3009Authorization {
  signature: Hex
}

/**
 * Generate a random nonce for EIP-3009 authorization
 */
export function generateAuthNonce(): Hex {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return toHex(bytes)
}

/**
 * Get current timestamp plus offset (in seconds)
 */
export function getTimestamp(offsetSeconds = 0): number {
  return Math.floor(Date.now() / 1000) + offsetSeconds
}

/**
 * Create EIP-3009 authorization parameters
 */
export function createAuthParams(
  from: Address,
  to: Address,
  value: bigint,
  validitySeconds = 300, // 5 minutes default
): EIP3009Authorization {
  return {
    from,
    to,
    value,
    validAfter: getTimestamp(-60), // Valid from 1 minute ago (allow for clock skew)
    validBefore: getTimestamp(validitySeconds),
    nonce: generateAuthNonce(),
  }
}

/**
 * Sign EIP-3009 transferWithAuthorization
 */
export async function signTransferAuthorization(
  walletClient: WalletClient,
  tokenAddress: Address,
  tokenName: string,
  chainId: number,
  auth: EIP3009Authorization,
): Promise<SignedEIP3009Authorization> {
  const domain = {
    name: tokenName,
    version: '1',
    chainId,
    verifyingContract: tokenAddress,
  }

  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  }

  const message = {
    from: auth.from,
    to: auth.to,
    value: auth.value,
    validAfter: BigInt(auth.validAfter),
    validBefore: BigInt(auth.validBefore),
    nonce: auth.nonce,
  }

  if (!walletClient.account) {
    throw new Error('WalletClient must have an account to sign')
  }

  const signature = await walletClient.signTypedData({
    account: walletClient.account,
    domain,
    types,
    primaryType: 'TransferWithAuthorization',
    message,
  })

  return { ...auth, signature }
}

/**
 * Create and sign a complete gasless payment authorization
 * This combines the x402 payment signature with EIP-3009 authorization
 */
export async function createGaslessPayment(
  walletClient: WalletClient,
  params: {
    tokenAddress: Address
    tokenName: string
    chainId: number
    recipient: Address // Final recipient (x402 facilitator intermediary)
    amount: bigint
    facilitatorAddress: Address // Token transfer goes to facilitator first
    validitySeconds?: number
  },
): Promise<{
  authParams: {
    validAfter: number
    validBefore: number
    authNonce: Hex
    authSignature: Hex
  }
}> {
  const fromAddress = walletClient.account?.address
  if (!fromAddress) {
    throw new Error('Wallet client must have an account')
  }

  const auth = createAuthParams(
    fromAddress,
    params.facilitatorAddress, // EIP-3009 transfer goes to facilitator
    params.amount,
    params.validitySeconds ?? 300,
  )

  const signed = await signTransferAuthorization(
    walletClient,
    params.tokenAddress,
    params.tokenName,
    params.chainId,
    auth,
  )

  return {
    authParams: {
      validAfter: signed.validAfter,
      validBefore: signed.validBefore,
      authNonce: signed.nonce,
      authSignature: signed.signature,
    },
  }
}

/**
 * EIP-3009 Token ABI for reading/calling
 */
export const EIP3009_ABI = [
  {
    name: 'transferWithAuthorization',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'authorizationState',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'authorizer', type: 'address' },
      { name: 'nonce', type: 'bytes32' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'DOMAIN_SEPARATOR',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bytes32' }],
  },
] as const

/**
 * Check if a token supports EIP-3009
 */
export async function supportsEIP3009(
  publicClient: {
    readContract: (args: {
      address: Address
      abi: typeof EIP3009_ABI
      functionName: string
    }) => Promise<unknown>
  },
  tokenAddress: Address,
): Promise<boolean> {
  try {
    await publicClient.readContract({
      address: tokenAddress,
      abi: EIP3009_ABI,
      functionName: 'DOMAIN_SEPARATOR',
    })
    return true
  } catch {
    return false
  }
}
