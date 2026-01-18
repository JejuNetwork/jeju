/**
 * Dev Mode Proxy for JNS Gateway
 *
 * Enables HMR (Hot Module Replacement) during local development by
 * proxying JNS requests to local dev servers instead of fetching from IPFS.
 *
 * Resolution Priority:
 * 1. Environment variable (DEV_PROXY_${APP}_URL)
 * 2. JNS text record `dws.dev` (queried on-chain)
 * 3. Static dev proxy mapping from @jejunetwork/config
 * 4. Normal IPFS resolution (if not in dev mode or no proxy found)
 *
 * Content Versioning Strategy:
 * - Dev: Proxy to local dev server (instant HMR)
 * - Preview: Use IPNS keys (mutable, no on-chain tx)
 * - Production: Immutable IPFS CID (on-chain contenthash)
 */

import { readContract } from '@jejunetwork/shared'
import type { Address, Chain, Hex, PublicClient, Transport } from 'viem'

/** Dev proxy resolution result */
export interface DevProxyResolution {
  /** Whether dev mode is active for this name */
  isDevMode: boolean
  /** URL to proxy to (if dev mode) */
  proxyUrl: string | null
  /** Source of the resolution */
  source: 'env' | 'jns-text' | 'static-config' | 'none'
}

/** Static dev proxy mapping (can be extended via environment) */
const STATIC_DEV_PROXIES: Record<string, number> = {
  gateway: 4013,
  bazaar: 4006,
  docs: 4004,
  documentation: 4004,
  factory: 4009,
  autocrat: 4040,
  crucible: 4020,
  dws: 4030,
  monitoring: 3002,
  node: 4080,
  indexer: 4350,
  auth: 4060,
  babylon: 5008,
}

/** JNS Resolver ABI for text records */
const JNS_RESOLVER_TEXT_ABI = [
  {
    name: 'text',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ type: 'string' }],
  },
] as const

/**
 * SECURITY: Check if dev mode is enabled globally
 * Dev mode is ONLY allowed when explicitly enabled AND not in production
 */
export function isDevModeEnabled(): boolean {
  // SECURITY: Never allow dev mode in production environment
  if (process.env.NODE_ENV === 'production') {
    if (process.env.DEV_MODE === 'true' || process.env.JEJU_DEV === 'true') {
      console.warn(
        '[SECURITY] Dev mode explicitly disabled in production environment',
      )
    }
    return false
  }
  return (
    process.env.DEV_MODE === 'true' ||
    process.env.NODE_ENV === 'development' ||
    process.env.JEJU_DEV === 'true' ||
    process.env.JNS_DEV_PROXY === 'true'
  )
}

/**
 * SECURITY: Validate that a proxy URL is safe (localhost only)
 * Prevents SSRF attacks by restricting proxy targets
 */
function isAllowedProxyTarget(url: string): boolean {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    // SECURITY: Only allow localhost and 127.0.0.1 as proxy targets
    const allowedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1']
    if (!allowedHosts.includes(host)) {
      console.warn(`[SECURITY] Blocked proxy to non-local host: ${host}`)
      return false
    }
    // SECURITY: Only allow http for local dev
    if (parsed.protocol !== 'http:') {
      console.warn(
        `[SECURITY] Blocked proxy with non-http protocol: ${parsed.protocol}`,
      )
      return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * Normalize JNS name (strip .jeju suffix, lowercase)
 */
function normalizeName(name: string): string {
  return name.replace(/\.jeju$/i, '').toLowerCase()
}

/**
 * Get dev proxy URL from environment variable
 */
function getEnvProxy(name: string): string | null {
  const normalized = normalizeName(name)
  const envKey = `DEV_PROXY_${normalized.toUpperCase().replace(/-/g, '_')}_URL`
  return process.env[envKey] ?? null
}

/**
 * Get dev proxy URL from static configuration
 */
function getStaticProxy(name: string): string | null {
  const normalized = normalizeName(name)
  const port = STATIC_DEV_PROXIES[normalized]
  if (port) {
    const host = process.env.DEV_HOST || 'localhost'
    return `http://${host}:${port}`
  }
  return null
}

/**
 * Query JNS for dev mode text record
 * Returns the dev endpoint URL if `dws.dev` text record is set
 */
async function getJnsDevRecord(
  client: PublicClient<Transport, Chain>,
  resolverAddress: Address,
  node: Hex,
): Promise<string | null> {
  const devEndpoint = await readContract(client, {
    address: resolverAddress,
    abi: JNS_RESOLVER_TEXT_ABI,
    functionName: 'text',
    args: [node, 'dws.dev'],
  }).catch((): null => null)

  if (devEndpoint && devEndpoint.length > 0) {
    return devEndpoint
  }
  return null
}

/**
 * Resolve dev proxy for a JNS name
 *
 * @param name - JNS name (e.g., "bazaar" or "bazaar.jeju")
 * @param client - Viem public client (optional, for JNS text record lookup)
 * @param resolverAddress - JNS resolver address (optional)
 * @param node - Namehash of the JNS name (optional)
 */
export async function resolveDevProxy(
  name: string,
  client?: PublicClient<Transport, Chain>,
  resolverAddress?: Address,
  node?: Hex,
): Promise<DevProxyResolution> {
  // If dev mode is not enabled globally, skip all checks
  if (!isDevModeEnabled()) {
    return { isDevMode: false, proxyUrl: null, source: 'none' }
  }

  // 1. Check environment variable first (highest priority)
  const envProxy = getEnvProxy(name)
  if (envProxy) {
    return { isDevMode: true, proxyUrl: envProxy, source: 'env' }
  }

  // 2. Check JNS text record (if we have client and resolver)
  if (client && resolverAddress && node) {
    const jnsProxy = await getJnsDevRecord(client, resolverAddress, node)
    if (jnsProxy) {
      return { isDevMode: true, proxyUrl: jnsProxy, source: 'jns-text' }
    }
  }

  // 3. Check static configuration
  const staticProxy = getStaticProxy(name)
  if (staticProxy) {
    return { isDevMode: true, proxyUrl: staticProxy, source: 'static-config' }
  }

  // No dev proxy found
  return { isDevMode: false, proxyUrl: null, source: 'none' }
}

/**
 * Proxy a request to a dev server
 * Handles both frontend and API requests
 *
 * SECURITY: This function should only be called when isDevModeEnabled() returns true.
 * The proxyUrl is validated to ensure it only targets localhost.
 */
export async function proxyToDevServer(
  proxyUrl: string,
  request: Request,
  path: string,
): Promise<Response> {
  // SECURITY: Double-check dev mode is enabled
  if (!isDevModeEnabled()) {
    return new Response(JSON.stringify({ error: 'Dev proxy not enabled' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // SECURITY: Validate proxy target is localhost only
  if (!isAllowedProxyTarget(proxyUrl)) {
    return new Response(
      JSON.stringify({
        error: 'Invalid proxy target',
        hint: 'Only localhost allowed',
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const url = new URL(request.url)
  // SECURITY: Sanitize path to prevent injection
  const sanitizedPath = path.replace(/\0/g, '').replace(/\.\./g, '')
  const targetUrl = `${proxyUrl}${sanitizedPath}${url.search}`

  const proxyHeaders = new Headers(request.headers)
  proxyHeaders.set('X-Forwarded-Host', url.host)
  proxyHeaders.set('X-JNS-Dev-Proxy', 'true')

  // SECURITY: Strip sensitive headers before forwarding
  proxyHeaders.delete('Authorization')
  proxyHeaders.delete('Cookie')

  const response = await fetch(targetUrl, {
    method: request.method,
    headers: proxyHeaders,
    body:
      request.method !== 'GET' && request.method !== 'HEAD'
        ? request.body
        : undefined,
    signal: AbortSignal.timeout(10000), // SECURITY: Reduced timeout for dev proxy
  }).catch((error: Error): null => {
    console.error(
      `[JNS Dev Proxy] Failed to proxy to ${targetUrl}:`,
      error.message,
    )
    return null
  })

  if (!response) {
    return new Response(
      JSON.stringify({
        error: 'Dev server unavailable',
        proxyUrl,
        path,
        hint: 'Make sure the dev server is running. Start with: bun run dev',
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  // Clone response with dev proxy headers
  const responseHeaders = new Headers(response.headers)
  responseHeaders.set('X-JNS-Dev-Proxy', proxyUrl)
  responseHeaders.set('X-JNS-Dev-Mode', 'true')
  responseHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  })
}

/**
 * Print dev proxy status
 */
export function printDevProxyStatus(): void {
  console.log('\n🔄 JNS Dev Proxy Status:')
  console.log(`   Enabled: ${isDevModeEnabled() ? 'YES' : 'no'}`)

  if (!isDevModeEnabled()) {
    console.log('   (Set DEV_MODE=true or JNS_DEV_PROXY=true to enable)')
    return
  }

  console.log('\n   Static Mappings:')
  for (const [name, port] of Object.entries(STATIC_DEV_PROXIES)) {
    const envOverride = getEnvProxy(name)
    const url = envOverride ?? `http://localhost:${port}`
    const source = envOverride ? '(env)' : '(static)'
    console.log(`   ${name.padEnd(15)} → ${url} ${source}`)
  }
  console.log('')
}
