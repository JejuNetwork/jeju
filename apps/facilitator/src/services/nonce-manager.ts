/**
 * Nonce Manager - Prevents replay attacks
 * 
 * LIMITATION: Nonce cache is in-memory and lost on restart.
 * On restart, replay prevention relies entirely on the on-chain contract's
 * usedNonces mapping. This is safe (contract is authoritative) but may allow
 * brief window for duplicate submission attempts during restart.
 * 
 * MULTI-REPLICA LIMITATION: In-memory cache does not work across replicas.
 * For multi-replica deployments, see MULTI_REPLICA.md for implementation guide.
 * Current implementation is safe for single-replica deployments only.
 */

import type { Address, PublicClient } from 'viem';
import { X402_FACILITATOR_ABI } from '../lib/contracts';
import { ZERO_ADDRESS } from '../lib/chains';
import { config } from '../config';

const usedNonces = new Set<string>();
const pendingNonces = new Set<string>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const nonceTimestamps = new Map<string, number>();

function getNonceKey(payer: Address, nonce: string): string {
  return `${payer.toLowerCase()}:${nonce}`;
}

export function isNonceUsedLocally(payer: Address, nonce: string): boolean {
  const key = getNonceKey(payer, nonce);
  return usedNonces.has(key) || pendingNonces.has(key);
}

export async function isNonceUsedOnChain(publicClient: PublicClient, payer: Address, nonce: string): Promise<boolean> {
  const cfg = config();
  if (cfg.facilitatorAddress === ZERO_ADDRESS) {
    if (cfg.environment === 'production') {
      throw new Error('Facilitator contract not deployed - nonce check unavailable');
    }
    return false;
  }

  return (await publicClient.readContract({
    address: cfg.facilitatorAddress,
    abi: X402_FACILITATOR_ABI,
    functionName: 'isNonceUsed',
    args: [payer, nonce],
  })) as boolean;
}

export async function isNonceUsed(publicClient: PublicClient, payer: Address, nonce: string): Promise<boolean> {
  if (isNonceUsedLocally(payer, nonce)) return true;
  const usedOnChain = await isNonceUsedOnChain(publicClient, payer, nonce);
  if (usedOnChain) markNonceUsed(payer, nonce);
  return usedOnChain;
}

export function markNoncePending(payer: Address, nonce: string): void {
  pendingNonces.add(getNonceKey(payer, nonce));
}

export function markNonceUsed(payer: Address, nonce: string): void {
  const key = getNonceKey(payer, nonce);
  pendingNonces.delete(key);
  usedNonces.add(key);
  nonceTimestamps.set(key, Date.now());
}

export function markNonceFailed(payer: Address, nonce: string): void {
  pendingNonces.delete(getNonceKey(payer, nonce));
}

export async function reserveNonce(
  publicClient: PublicClient,
  payer: Address,
  nonce: string
): Promise<{ reserved: boolean; error?: string }> {
  const key = getNonceKey(payer, nonce);
  if (pendingNonces.has(key)) return { reserved: false, error: 'Nonce is being processed' };
  if (usedNonces.has(key)) return { reserved: false, error: 'Nonce already used' };

  const usedOnChain = await isNonceUsedOnChain(publicClient, payer, nonce);
  if (usedOnChain) {
    markNonceUsed(payer, nonce);
    return { reserved: false, error: 'Nonce already used on-chain' };
  }

  markNoncePending(payer, nonce);
  return { reserved: true };
}

export function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function cleanupOldNonces(): number {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, timestamp] of nonceTimestamps.entries()) {
    if (now - timestamp > CACHE_TTL_MS) {
      usedNonces.delete(key);
      nonceTimestamps.delete(key);
      cleaned++;
    }
  }
  return cleaned;
}

export function getNonceCacheStats(): { total: number; used: number; pending: number; oldestTimestamp: number | null } {
  const timestamps = Array.from(nonceTimestamps.values());
  return {
    total: usedNonces.size + pendingNonces.size,
    used: usedNonces.size,
    pending: pendingNonces.size,
    oldestTimestamp: timestamps.length > 0 ? Math.min(...timestamps) : null,
  };
}

export function clearNonceCache(): void {
  usedNonces.clear();
  pendingNonces.clear();
  nonceTimestamps.clear();
}

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startNonceCleanup(): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const cleaned = cleanupOldNonces();
    if (cleaned > 0) console.log(`[NonceManager] Cleaned ${cleaned} old nonces`);
  }, 60 * 60 * 1000);
}

export function stopNonceCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
