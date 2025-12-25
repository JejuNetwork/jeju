import { readContract } from '@jejunetwork/contracts'
import { validateOrNull, ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address, PublicClient } from 'viem'
import { z } from 'zod'
import { config } from '../config/index'
import { X402_FACILITATOR_ABI } from '../lib/contracts'

// Cache API response schemas
const CacheSetResponseSchema = z.object({
  success: z.boolean(),
})

const CacheGetResponseSchema = z.object({
  value: z.string().optional(),
})

const CACHE_URL = process.env.CACHE_SERVICE_URL ?? 'http://localhost:4015'
const CACHE_NS = process.env.NONCE_CACHE_NAMESPACE ?? 'facilitator-nonces'
const NONCE_TTL = 24 * 60 * 60

const localUsed = new Set<string>()
const localPending = new Set<string>()
let cacheAvailable = true
let lastHealthCheck = 0

async function checkHealth(): Promise<boolean> {
  if (Date.now() - lastHealthCheck < 30000) return cacheAvailable
  lastHealthCheck = Date.now()
  const response = await fetch(`${CACHE_URL}/health`, {
    signal: AbortSignal.timeout(2000),
  })
  cacheAvailable = response.ok
  return cacheAvailable
}

function nonceKey(payer: Address, nonce: string): string {
  return `nonce:${payer.toLowerCase()}:${nonce}`
}

async function cacheSet(
  key: string,
  value: string,
  ttl = NONCE_TTL,
): Promise<boolean> {
  const res = await fetch(`${CACHE_URL}/cache/set`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value, ttl, namespace: CACHE_NS }),
  })
  if (!res.ok) return false
  const data = validateOrNull(CacheSetResponseSchema, await res.json())
  return data?.success ?? false
}

async function cacheGet(key: string): Promise<string | null> {
  const res = await fetch(
    `${CACHE_URL}/cache/get?namespace=${CACHE_NS}&key=${encodeURIComponent(key)}`,
  )
  if (!res.ok) return null
  const data = validateOrNull(CacheGetResponseSchema, await res.json())
  return data?.value ?? null
}

async function cacheDel(key: string): Promise<boolean> {
  return (
    await fetch(
      `${CACHE_URL}/cache/delete?namespace=${CACHE_NS}&key=${encodeURIComponent(key)}`,
      { method: 'DELETE' },
    )
  ).ok
}

export async function isNonceUsedLocally(
  payer: Address,
  nonce: string,
): Promise<boolean> {
  const key = nonceKey(payer, nonce)
  if (await checkHealth()) return (await cacheGet(key)) !== null
  return localUsed.has(key) || localPending.has(key)
}

export async function isNonceUsedOnChain(
  client: PublicClient,
  payer: Address,
  nonce: string,
): Promise<boolean> {
  const cfg = config()
  if (cfg.facilitatorAddress === ZERO_ADDRESS) {
    if (cfg.environment === 'production')
      throw new Error('Facilitator not deployed')
    return false
  }
  return readContract(client, {
    address: cfg.facilitatorAddress,
    abi: X402_FACILITATOR_ABI,
    functionName: 'isNonceUsed',
    args: [payer, nonce],
  })
}

export async function isNonceUsed(
  client: PublicClient,
  payer: Address,
  nonce: string,
): Promise<boolean> {
  if (await isNonceUsedLocally(payer, nonce)) return true
  const onChain = await isNonceUsedOnChain(client, payer, nonce)
  if (onChain) await markNonceUsed(payer, nonce)
  return onChain
}

export async function markNoncePending(
  payer: Address,
  nonce: string,
): Promise<void> {
  const key = nonceKey(payer, nonce)
  if (await checkHealth()) await cacheSet(key, 'pending', 300)
  localPending.add(key)
}

export async function markNonceUsed(
  payer: Address,
  nonce: string,
): Promise<void> {
  const key = nonceKey(payer, nonce)
  if (await checkHealth()) await cacheSet(key, 'used')
  localPending.delete(key)
  localUsed.add(key)
}

export async function markNonceFailed(
  payer: Address,
  nonce: string,
): Promise<void> {
  const key = nonceKey(payer, nonce)
  if (await checkHealth()) await cacheDel(key)
  localPending.delete(key)
}

export async function reserveNonce(
  client: PublicClient,
  payer: Address,
  nonce: string,
): Promise<{ reserved: boolean; error?: string }> {
  if (await isNonceUsedLocally(payer, nonce))
    return { reserved: false, error: 'Nonce already used or pending' }
  if (await isNonceUsedOnChain(client, payer, nonce)) {
    await markNonceUsed(payer, nonce)
    return { reserved: false, error: 'Nonce already used on-chain' }
  }
  if ((await checkHealth()) && (await cacheGet(nonceKey(payer, nonce)))) {
    return { reserved: false, error: 'Nonce already reserved' }
  }
  await markNoncePending(payer, nonce)
  return { reserved: true }
}

export function generateNonce(): string {
  const arr = new Uint8Array(16)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function getNonceCacheStats() {
  return {
    distributed: true,
    cacheServiceAvailable: await checkHealth(),
    localUsed: localUsed.size,
    localPending: localPending.size,
  }
}

export function clearLocalNonceCache(): void {
  localUsed.clear()
  localPending.clear()
}

export async function initDistributedNonceManager(): Promise<void> {
  const available = await checkHealth()
  console.log(
    `[NonceManager] Distributed mode: ${available ? 'connected' : 'fallback'}`,
  )
}
