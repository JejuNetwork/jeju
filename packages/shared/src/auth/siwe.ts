/**
 * SIWE - Sign In With Ethereum
 * 
 * EIP-4361 compliant authentication for Ethereum wallets.
 * Uses the official siwe library for parsing and validation.
 * Works with MetaMask, WalletConnect, Coinbase Wallet, etc.
 */

import { SiweMessage, SiweErrorType, generateNonce as siweGenerateNonce } from 'siwe';
import { verifyMessage, type Address, type Hex } from 'viem';
import type { SIWEMessage } from './types';

/**
 * Generate a random nonce for SIWE using the official siwe library
 */
export function generateNonce(): string {
  return siweGenerateNonce();
}

/**
 * Create a SIWE message object
 */
export function createSIWEMessage(params: {
  domain: string;
  address: Address;
  uri: string;
  chainId: number;
  statement?: string;
  nonce?: string;
  expirationMinutes?: number;
  resources?: string[];
}): SIWEMessage {
  const now = new Date();
  const nonce = params.nonce || generateNonce();
  
  const expirationTime = params.expirationMinutes 
    ? new Date(now.getTime() + params.expirationMinutes * 60 * 1000).toISOString()
    : undefined;

  return {
    domain: params.domain,
    address: params.address,
    statement: params.statement || 'Sign in with Ethereum to authenticate.',
    uri: params.uri,
    version: '1',
    chainId: params.chainId,
    nonce,
    issuedAt: now.toISOString(),
    expirationTime,
    resources: params.resources,
  };
}

/**
 * Format SIWE message for signing using the official siwe library
 */
export function formatSIWEMessage(message: SIWEMessage): string {
  const siweMessage = new SiweMessage({
    domain: message.domain,
    address: message.address,
    statement: message.statement,
    uri: message.uri,
    version: message.version,
    chainId: message.chainId,
    nonce: message.nonce,
    issuedAt: message.issuedAt,
    expirationTime: message.expirationTime,
    notBefore: message.notBefore,
    requestId: message.requestId,
    resources: message.resources,
  });
  return siweMessage.prepareMessage();
}

/**
 * Parse a SIWE message string back to object using the official siwe library
 */
export function parseSIWEMessage(messageString: string): SIWEMessage {
  const siweMessage = new SiweMessage(messageString);
  return {
    domain: siweMessage.domain,
    address: siweMessage.address as Address,
    statement: siweMessage.statement,
    uri: siweMessage.uri,
    version: siweMessage.version,
    chainId: siweMessage.chainId,
    nonce: siweMessage.nonce,
    issuedAt: siweMessage.issuedAt ?? new Date().toISOString(),
    expirationTime: siweMessage.expirationTime,
    notBefore: siweMessage.notBefore,
    requestId: siweMessage.requestId,
    resources: siweMessage.resources,
  };
}

/**
 * Verify a SIWE signature using the official siwe library
 */
export async function verifySIWESignature(params: {
  message: SIWEMessage | string;
  signature: Hex;
}): Promise<{ valid: boolean; address: Address; error?: string }> {
  const messageString = typeof params.message === 'string' 
    ? params.message 
    : formatSIWEMessage(params.message);
  
  const siweMessage = new SiweMessage(messageString);
  
  try {
    // Manual verification for compatibility with viem (siwe library expects ethers)
    const valid = await verifyMessage({
      address: siweMessage.address as Address,
      message: messageString,
      signature: params.signature,
    });
    
    if (!valid) {
      return { valid: false, address: siweMessage.address as Address, error: 'Invalid signature' };
    }

    // Check expiration using siwe's validation
    if (siweMessage.expirationTime) {
      const expirationDate = new Date(siweMessage.expirationTime);
      if (expirationDate < new Date()) {
        return { valid: false, address: siweMessage.address as Address, error: 'Message expired' };
      }
    }

    // Check not before
    if (siweMessage.notBefore) {
      const notBeforeDate = new Date(siweMessage.notBefore);
      if (notBeforeDate > new Date()) {
        return { valid: false, address: siweMessage.address as Address, error: 'Message not yet valid' };
      }
    }

    return { valid: true, address: siweMessage.address as Address };
  } catch (error) {
    const siweError = error as { type?: SiweErrorType };
    const errorMessage = siweError.type 
      ? `SIWE error: ${siweError.type}` 
      : error instanceof Error ? error.message : 'Verification failed';
    return { valid: false, address: siweMessage.address as Address, error: errorMessage };
  }
}

/**
 * Request wallet signature for SIWE
 */
export async function signSIWEMessage(params: {
  message: SIWEMessage;
  signMessage: (message: string) => Promise<Hex>;
}): Promise<{ message: string; signature: Hex }> {
  const messageString = formatSIWEMessage(params.message);
  const signature = await params.signMessage(messageString);
  return { message: messageString, signature };
}
