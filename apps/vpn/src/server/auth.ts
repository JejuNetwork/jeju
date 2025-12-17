/**
 * Authentication helpers for VPN server
 */

import { verifyMessage, getAddress, type Address, type Hex } from 'viem';
import type { Context } from 'hono';

export interface AuthResult {
  valid: boolean;
  address?: string;
  error?: string;
}

/**
 * Verify authentication from request headers
 */
export async function verifyAuth(c: Context): Promise<AuthResult> {
  const address = c.req.header('x-jeju-address');
  const timestamp = c.req.header('x-jeju-timestamp');
  const signature = c.req.header('x-jeju-signature') as Hex | undefined;

  // Check if headers are present
  if (!address || !timestamp || !signature) {
    return { valid: false, error: 'Missing authentication headers' };
  }

  // Validate timestamp (within 5 minutes)
  const ts = parseInt(timestamp);
  if (isNaN(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
    return { valid: false, error: 'Timestamp expired or invalid' };
  }

  // Verify signature
  try {
    const message = `jeju-vpn:${timestamp}`;
    const valid = await verifyMessage({
      address: getAddress(address),
      message,
      signature,
    });

    if (!valid) {
      return { valid: false, error: 'Invalid signature' };
    }

    return { valid: true, address: getAddress(address) };
  } catch (error) {
    return { valid: false, error: 'Signature verification failed' };
  }
}

/**
 * Get authenticated address from context
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

