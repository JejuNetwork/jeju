/**
 * Infrastructure Check for Tests
 *
 * Checks which infrastructure services are available and provides
 * skip flags for tests that require specific services.
 */

import { DWS_URL, INFERENCE_URL, RPC_URL } from './setup'

async function checkService(url: string, path = '/health'): Promise<boolean> {
  try {
    const response = await fetch(`${url}${path}`, {
      signal: AbortSignal.timeout(2000),
    })
    return response.ok
  } catch {
    return false
  }
}

async function checkAnvil(): Promise<boolean> {
  try {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1,
      }),
      signal: AbortSignal.timeout(2000),
    })
    return response.ok
  } catch {
    return false
  }
}

import { getIpfsApiUrl } from '@jejunetwork/config'

async function checkIPFS(): Promise<boolean> {
  const ipfsApiUrl =
    (typeof process !== 'undefined' ? process.env.IPFS_API_URL : undefined) ||
    getIpfsApiUrl()
  if (!ipfsApiUrl) return false
  try {
    const response = await fetch(`${ipfsApiUrl}/api/v0/id`, {
      method: 'POST',
      signal: AbortSignal.timeout(2000),
    })
    return response.ok
  } catch {
    return false
  }
}

async function checkStorage(): Promise<boolean> {
  // Storage is always available via local backend
  return true
}

interface SkipFlags {
  ANVIL: boolean
  DWS: boolean
  INFERENCE: boolean
  IPFS: boolean
  STORAGE: boolean
  INTEGRATION: boolean
}

async function computeSkipFlags(): Promise<SkipFlags> {
  const [anvil, dws, inference, ipfs, storage] = await Promise.all([
    checkAnvil(),
    checkService(DWS_URL),
    checkService(INFERENCE_URL),
    checkIPFS(),
    checkStorage(),
  ])

  return {
    ANVIL: !anvil,
    DWS: !dws,
    INFERENCE: !inference,
    IPFS: !ipfs,
    STORAGE: !storage,
    INTEGRATION: process.env.SKIP_INTEGRATION === 'true',
  }
}

// Compute skip flags at module load (synchronous fallback for imports)
export let SKIP: SkipFlags = {
  ANVIL: false,
  DWS: false,
  INFERENCE: false,
  IPFS: false,
  STORAGE: false,
  INTEGRATION:
    (typeof process !== 'undefined'
      ? process.env.SKIP_INTEGRATION
      : undefined) === 'true',
}

// Update flags asynchronously
computeSkipFlags()
  .then((flags) => {
    SKIP = flags
  })
  .catch((err) => {
    console.warn('[infra-check] Failed to compute skip flags:', err)
  })

/** Check infrastructure and return skip flags */
export async function getSkipFlags(): Promise<SkipFlags> {
  return computeSkipFlags()
}

/** Skip test if condition is true */
export function skipIf(condition: boolean, reason: string): void {
  if (condition) {
    console.log(`[SKIP] ${reason}`)
  }
}
