/**
 * Authentication types for SIWE and SIWF
 */

import type { Address } from 'viem'

/**
 * SIWE (Sign-In With Ethereum) message format
 * EIP-4361 compliant structure
 */
export interface SIWEMessage {
  domain: string
  address: Address
  statement: string
  uri: string
  version: string
  chainId: number
  nonce: string
  issuedAt: string
  expirationTime?: string
  notBefore?: string
  requestId?: string
  resources?: string[]
}

/**
 * SIWF (Sign-In With Farcaster) message format
 */
export interface SIWFMessage {
  domain: string
  fid: number
  custody: Address
  nonce: string
  issuedAt: string
  expirationTime?: string
}
