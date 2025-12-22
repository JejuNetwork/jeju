/**
 * Authentication helpers for VPN server
 * 
 * Uses fail-fast validation patterns
 */

import { verifyMessage, getAddress, type Address, type Hex } from 'viem';
import type { Context } from 'hono';
import { AuthHeadersSchema, expectValid, expect } from './schemas';

export interface AuthResult {
  valid: boolean;
  address?: Address;
  error?: string;
}

/**
 * Verify authentication from request headers
 */
export async function verifyAuth(c: Context): Promise<AuthResult> {
  const address = c.req.header('x-jeju-address');
  const timestamp = c.req.header('x-jeju-timestamp');
  const signature = c.req.header('x-jeju-signature');

  // Check if headers are present
  if (!address || !timestamp || !signature) {
    return { valid: false, error: 'Missing authentication headers' };
  }

  // Validate headers structure
  const headers = { 'x-jeju-address': address, 'x-jeju-timestamp': timestamp, 'x-jeju-signature': signature };
  const validatedHeaders = expectValid(AuthHeadersSchema, headers, 'auth headers');

  // Validate timestamp (within 5 minutes)
  const ts = parseInt(validatedHeaders['x-jeju-timestamp']);
  expect(!isNaN(ts), 'Timestamp must be a valid number');
  
  const now = Date.now();
  const timeDiff = Math.abs(now - ts);
  const maxAge = 5 * 60 * 1000; // 5 minutes
  expect(timeDiff <= maxAge, `Timestamp expired or invalid. Time difference: ${timeDiff}ms, max: ${maxAge}ms`);

  // Verify signature
  const message = `jeju-vpn:${timestamp}`;
  const validAddress = getAddress(validatedHeaders['x-jeju-address']);
  const validSignature = validatedHeaders['x-jeju-signature'] as Hex;
  
  const isValid = await verifyMessage({
    address: validAddress,
    message,
    signature: validSignature,
  });

  if (!isValid) {
    throw new Error('Invalid signature');
  }

  return { valid: true, address: validAddress };
}

/**
 * Get authenticated address from context
 * Returns null if invalid, but doesn't throw
 */
export function getAuthAddress(c: Context): Address | null {
  const address = c.req.header('x-jeju-address');
  if (!address) return null;
  
  try {
    return getAddress(address);
  } catch {
    return null;
  }
}

/**
 * Create authentication headers for client
 */
export function createAuthHeaders(
  address: Address,
  signMessage: (message: string) => Promise<Hex>,
): Promise<Record<string, string>> {
  const timestamp = Date.now().toString();
  const message = `jeju-vpn:${timestamp}`;
  
  return signMessage(message).then(signature => ({
    'x-jeju-address': address,
    'x-jeju-timestamp': timestamp,
    'x-jeju-signature': signature,
  }));
}

