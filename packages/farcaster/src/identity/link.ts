/**
 * @fileoverview Farcaster Identity Linking
 * 
 * Links Farcaster IDs (FIDs) with Jeju Agent IDs (ERC-8004).
 * Enables cross-platform identity verification.
 */

import type { Address, Hex } from 'viem';
import { FarcasterClient } from '../hub/client';

export interface IdentityLink {
  fid: number;
  jejuAddress: Address;
  linkedAt: number;
  verificationMethod: 'custody' | 'verified_address' | 'signature';
  proof?: Hex;
}

export interface LinkVerificationResult {
  valid: boolean;
  fid?: number;
  linkedAddress?: Address;
  error?: string;
}

/**
 * Verify that an address can be linked to a Farcaster ID
 * 
 * @param fid - Farcaster ID to verify
 * @param address - Ethereum address to check
 * @param client - Farcaster client instance
 */
export async function verifyAddressCanLink(
  fid: number,
  address: Address,
  client: FarcasterClient = new FarcasterClient()
): Promise<LinkVerificationResult> {
  try {
    const profile = await client.getProfile(fid);

    // Check if address is custody address
    if (profile.custodyAddress.toLowerCase() === address.toLowerCase()) {
      return {
        valid: true,
        fid,
        linkedAddress: profile.custodyAddress,
      };
    }

    // Check if address is a verified address
    const isVerified = profile.verifiedAddresses.some(
      (v) => v.toLowerCase() === address.toLowerCase()
    );

    if (isVerified) {
      return {
        valid: true,
        fid,
        linkedAddress: address,
      };
    }

    return {
      valid: false,
      error: 'Address not associated with this FID',
    };
  } catch (error) {
    return {
      valid: false,
      error: `Failed to verify: ${(error as Error).message}`,
    };
  }
}

/**
 * Look up Farcaster profile by Ethereum address
 */
export async function lookupFidByAddress(
  address: Address,
  client: FarcasterClient = new FarcasterClient()
): Promise<number | null> {
  const profile = await client.getProfileByVerifiedAddress(address);
  return profile?.fid ?? null;
}

/**
 * Generate identity link proof message for signing
 */
export function generateLinkProofMessage(params: {
  fid: number;
  jejuAddress: Address;
  timestamp: number;
  domain: string;
}): string {
  return [
    `${params.domain} wants to link your Farcaster account to Jeju Network.`,
    '',
    `Farcaster ID: ${params.fid}`,
    `Jeju Address: ${params.jejuAddress}`,
    `Timestamp: ${params.timestamp}`,
    '',
    'Signing this message proves you control both accounts.',
    'This does not grant any permissions or transfer any assets.',
  ].join('\n');
}

/**
 * Parse identity link proof message
 */
export function parseLinkProofMessage(message: string): {
  fid: number;
  jejuAddress: Address;
  timestamp: number;
  domain: string;
} | null {
  try {
    const lines = message.split('\n');
    
    const domainMatch = lines[0].match(/^(.+) wants to link/);
    const domain = domainMatch?.[1] || '';
    
    let fid = 0;
    let jejuAddress: Address = '0x0' as Address;
    let timestamp = 0;

    for (const line of lines) {
      if (line.startsWith('Farcaster ID: ')) {
        fid = parseInt(line.slice(14), 10);
      } else if (line.startsWith('Jeju Address: ')) {
        jejuAddress = line.slice(14) as Address;
      } else if (line.startsWith('Timestamp: ')) {
        timestamp = parseInt(line.slice(11), 10);
      }
    }

    if (!fid || !jejuAddress || !timestamp) {
      return null;
    }

    return { fid, jejuAddress, timestamp, domain };
  } catch {
    return null;
  }
}

/**
 * Verify identity link proof signature
 */
export async function verifyLinkProof(
  message: string,
  signature: Hex,
  expectedFid: number,
  client: FarcasterClient = new FarcasterClient()
): Promise<LinkVerificationResult> {
  const parsed = parseLinkProofMessage(message);
  
  if (!parsed) {
    return { valid: false, error: 'Invalid proof message format' };
  }

  if (parsed.fid !== expectedFid) {
    return { valid: false, error: 'FID mismatch' };
  }

  // Check timestamp (within 24 hours)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.timestamp) > 86400) {
    return { valid: false, error: 'Proof expired' };
  }

  // Recover signer and verify ownership
  const { verifyMessage } = await import('viem');
  const profile = await client.getProfile(expectedFid);

  // Try custody address first
  try {
    const isValidCustody = await verifyMessage({
      address: profile.custodyAddress,
      message,
      signature,
    });

    if (isValidCustody) {
      return {
        valid: true,
        fid: expectedFid,
        linkedAddress: parsed.jejuAddress,
      };
    }
  } catch {
    // Continue to try verified addresses
  }

  // Try verified addresses
  for (const verifiedAddr of profile.verifiedAddresses) {
    try {
      const isValid = await verifyMessage({
        address: verifiedAddr,
        message,
        signature,
      });

      if (isValid) {
        return {
          valid: true,
          fid: expectedFid,
          linkedAddress: parsed.jejuAddress,
        };
      }
    } catch {
      // Continue
    }
  }

  return { valid: false, error: 'Signature verification failed' };
}

