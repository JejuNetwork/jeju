/**
 * SIWE - Sign In With Ethereum
 * 
 * EIP-4361 compliant authentication for Ethereum wallets.
 * Works with MetaMask, WalletConnect, Coinbase Wallet, etc.
 */

import { verifyMessage, type Address, type Hex } from 'viem';
import type { SIWEMessage } from './types';

/**
 * Generate a random nonce for SIWE
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
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
 * Format SIWE message for signing
 */
export function formatSIWEMessage(message: SIWEMessage): string {
  const lines = [
    `${message.domain} wants you to sign in with your Ethereum account:`,
    message.address,
    '',
  ];

  if (message.statement) {
    lines.push(message.statement, '');
  }

  lines.push(
    `URI: ${message.uri}`,
    `Version: ${message.version}`,
    `Chain ID: ${message.chainId}`,
    `Nonce: ${message.nonce}`,
    `Issued At: ${message.issuedAt}`,
  );

  if (message.expirationTime) {
    lines.push(`Expiration Time: ${message.expirationTime}`);
  }
  if (message.notBefore) {
    lines.push(`Not Before: ${message.notBefore}`);
  }
  if (message.requestId) {
    lines.push(`Request ID: ${message.requestId}`);
  }
  if (message.resources?.length) {
    lines.push('Resources:');
    message.resources.forEach(r => lines.push(`- ${r}`));
  }

  return lines.join('\n');
}

/**
 * Parse a SIWE message string back to object
 */
export function parseSIWEMessage(messageString: string): SIWEMessage {
  const lines = messageString.split('\n');
  
  // First line: "{domain} wants you to sign in with your Ethereum account:"
  const domainMatch = lines[0].match(/^(.+) wants you to sign in with your Ethereum account:$/);
  const domain = domainMatch?.[1] || '';
  
  // Second line: address
  const address = lines[1] as Address;
  
  // Parse key-value pairs
  const message: Partial<SIWEMessage> = { domain, address };
  let statementLines: string[] = [];
  let inStatement = false;
  let inResources = false;
  const resources: string[] = [];

  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.startsWith('URI: ')) {
      inStatement = false;
      message.statement = statementLines.join('\n').trim();
      message.uri = line.slice(5);
    } else if (line.startsWith('Version: ')) {
      message.version = line.slice(9);
    } else if (line.startsWith('Chain ID: ')) {
      message.chainId = parseInt(line.slice(10), 10);
    } else if (line.startsWith('Nonce: ')) {
      message.nonce = line.slice(7);
    } else if (line.startsWith('Issued At: ')) {
      message.issuedAt = line.slice(11);
    } else if (line.startsWith('Expiration Time: ')) {
      message.expirationTime = line.slice(17);
    } else if (line.startsWith('Not Before: ')) {
      message.notBefore = line.slice(12);
    } else if (line.startsWith('Request ID: ')) {
      message.requestId = line.slice(12);
    } else if (line === 'Resources:') {
      inResources = true;
    } else if (inResources && line.startsWith('- ')) {
      resources.push(line.slice(2));
    } else if (i > 2 && !line.startsWith('URI:')) {
      inStatement = true;
      statementLines.push(line);
    }
  }

  if (resources.length) {
    message.resources = resources;
  }

  return message as SIWEMessage;
}

/**
 * Verify a SIWE signature
 */
export async function verifySIWESignature(params: {
  message: SIWEMessage | string;
  signature: Hex;
}): Promise<{ valid: boolean; address: Address; error?: string }> {
  const messageString = typeof params.message === 'string' 
    ? params.message 
    : formatSIWEMessage(params.message);
  
  const parsedMessage = typeof params.message === 'string'
    ? parseSIWEMessage(params.message)
    : params.message;

  // Check expiration
  if (parsedMessage.expirationTime) {
    const expirationDate = new Date(parsedMessage.expirationTime);
    if (expirationDate < new Date()) {
      return { valid: false, address: parsedMessage.address, error: 'Message expired' };
    }
  }

  // Check not before
  if (parsedMessage.notBefore) {
    const notBeforeDate = new Date(parsedMessage.notBefore);
    if (notBeforeDate > new Date()) {
      return { valid: false, address: parsedMessage.address, error: 'Message not yet valid' };
    }
  }

  // Verify signature
  const valid = await verifyMessage({
    address: parsedMessage.address,
    message: messageString,
    signature: params.signature,
  });

  return { valid, address: parsedMessage.address };
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
