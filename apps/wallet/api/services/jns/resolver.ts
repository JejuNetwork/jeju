/**
 * JNS Gateway Resolver
 *
 * Resolves .jeju domains via HTTP gateways (local DWS node or public gateway).
 * This complements the on-chain JNS resolution with off-chain content lookups.
 */

import { getDWSUrl, getLocalhostHost } from '@jejunetwork/config'
import { z } from 'zod'
import { storage } from '../../../web/platform/storage'

/** JNS resolution result from gateway */
export interface JNSResolution {
  domain: string
  name: string
  node: string
  contenthash: string | null
  ipfsHash: string | null
  workerEndpoint: string | null
  address: string | null
  textRecords: Record<string, string> | null
  resolvedAt: number
  resolvedVia: string
}

/** JNS resolver settings */
export interface JNSResolverSettings {
  enabled: boolean
  gatewayUrl: string
  localDwsUrl: string
  preferLocal: boolean
  ipfsGateway: string
}

/** Cache entry for resolved domains */
interface CacheEntry {
  resolution: JNSResolution
  timestamp: number
}

const JNSResolverSettingsSchema = z.object({
  enabled: z.boolean(),
  gatewayUrl: z.string(),
  localDwsUrl: z.string(),
  preferLocal: z.boolean(),
  ipfsGateway: z.string(),
})

const DEFAULT_SETTINGS: JNSResolverSettings = {
  enabled: true,
  gatewayUrl: 'https://gateway.jejunetwork.org',
  localDwsUrl: getDWSUrl() ?? `http://${getLocalhostHost()}:4030`,
  preferLocal: true,
  ipfsGateway: 'https://ipfs.jejunetwork.org',
}

const CACHE_EXPIRY_MS = 5 * 60 * 1000 // 5 minutes
const RESOLVE_TIMEOUT_MS = 5000

/**
 * Base58 encoding (Bitcoin alphabet) for IPFS CID decoding
 */
function base58Encode(bytes: Uint8Array): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

  let leadingZeros = 0
  for (const byte of bytes) {
    if (byte === 0) leadingZeros++
    else break
  }

  const digits = [0]
  for (const byte of bytes) {
    let carry = byte
    for (let i = 0; i < digits.length; i++) {
      const n = digits[i] * 256 + carry
      digits[i] = n % 58
      carry = Math.floor(n / 58)
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = Math.floor(carry / 58)
    }
  }

  let result = ''
  for (let i = 0; i < leadingZeros; i++) {
    result += '1'
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    result += ALPHABET[digits[i]]
  }

  return result
}

/**
 * Decode EIP-1577 contenthash to IPFS CID
 */
function decodeContenthash(hash: string): string | null {
  if (!hash.startsWith('0xe3')) {
    return null // Not IPFS namespace
  }

  const hexData = hash.slice(4)

  // Check for CIDv1 prefix (01 70 = CIDv1 dag-pb)
  if (hexData.startsWith('0170')) {
    const multihashHex = hexData.slice(4)
    const bytes = new Uint8Array(multihashHex.length / 2)
    for (let i = 0; i < multihashHex.length; i += 2) {
      bytes[i / 2] = parseInt(multihashHex.slice(i, i + 2), 16)
    }
    return base58Encode(bytes)
  }

  return null
}

export class JNSResolver {
  private settings: JNSResolverSettings = { ...DEFAULT_SETTINGS }
  private cache = new Map<string, CacheEntry>()
  private initialized = false

  /**
   * Initialize resolver and load settings from storage
   */
  async init(): Promise<void> {
    if (this.initialized) return

    const saved = await storage.getJSON(
      'jns_settings',
      JNSResolverSettingsSchema,
    )
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved }
    }

    // Load cache from storage
    const cacheData = await storage.get('jns_cache')
    if (cacheData) {
      const parsed = JSON.parse(cacheData) as Record<string, CacheEntry>
      const now = Date.now()
      for (const [domain, entry] of Object.entries(parsed)) {
        if (now - entry.timestamp < CACHE_EXPIRY_MS) {
          this.cache.set(domain, entry)
        }
      }
    }

    this.initialized = true
  }

  /**
   * Get current resolver settings
   */
  getSettings(): JNSResolverSettings {
    return { ...this.settings }
  }

  /**
   * Update resolver settings
   */
  async updateSettings(
    settings: Partial<JNSResolverSettings>,
  ): Promise<JNSResolverSettings> {
    this.settings = { ...this.settings, ...settings }
    await storage.setJSON('jns_settings', this.settings)
    return this.getSettings()
  }

  /**
   * Clear the resolution cache
   */
  async clearCache(): Promise<void> {
    this.cache.clear()
    await storage.remove('jns_cache')
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { entries: number; domains: string[] } {
    return {
      entries: this.cache.size,
      domains: [...this.cache.keys()],
    }
  }

  /**
   * Try to resolve a domain from a specific endpoint
   */
  private async tryResolve(
    endpoint: string,
    domain: string,
  ): Promise<JNSResolution | null> {
    const url = `${endpoint}/dns/jns/${domain}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS)

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        return null
      }

      const data = await response.json()
      if (!data || data.error) {
        return null
      }

      return {
        domain,
        name: data.name,
        node: data.node,
        contenthash: data.records?.contenthash ?? null,
        ipfsHash: data.records?.ipfsHash ?? null,
        workerEndpoint: data.records?.workerEndpoint ?? null,
        address: data.records?.address ?? null,
        textRecords: data.records?.text ?? null,
        resolvedAt: Date.now(),
        resolvedVia: endpoint,
      }
    } catch {
      clearTimeout(timeoutId)
      return null
    }
  }

  /**
   * Resolve a .jeju domain via gateway
   */
  async resolve(domain: string): Promise<JNSResolution | null> {
    await this.init()

    if (!this.settings.enabled) {
      return null
    }

    const normalizedDomain = domain.toLowerCase().replace(/\.$/, '')

    // Check cache
    const cached = this.cache.get(normalizedDomain)
    if (cached && Date.now() - cached.timestamp < CACHE_EXPIRY_MS) {
      return cached.resolution
    }

    // Determine endpoint order
    const endpoints = this.settings.preferLocal
      ? [this.settings.localDwsUrl, this.settings.gatewayUrl]
      : [this.settings.gatewayUrl, this.settings.localDwsUrl]

    // Try each endpoint
    for (const endpoint of endpoints) {
      const resolution = await this.tryResolve(endpoint, normalizedDomain)
      if (resolution) {
        // Cache successful resolution
        const entry: CacheEntry = { resolution, timestamp: Date.now() }
        this.cache.set(normalizedDomain, entry)
        await this.saveCache()
        return resolution
      }
    }

    return null
  }

  /**
   * Get the redirect URL for a resolved domain
   */
  getRedirectUrl(resolution: JNSResolution, path: string = ''): string {
    // Priority 1: Worker endpoint (for dynamic apps)
    if (resolution.workerEndpoint) {
      return `${resolution.workerEndpoint}${path}`
    }

    // Priority 2: IPFS content
    if (resolution.ipfsHash) {
      return `${this.settings.ipfsGateway}/ipfs/${resolution.ipfsHash}${path}`
    }

    // Priority 3: Contenthash (decode and serve)
    if (resolution.contenthash) {
      const decoded = decodeContenthash(resolution.contenthash)
      if (decoded) {
        return `${this.settings.ipfsGateway}/ipfs/${decoded}${path}`
      }
    }

    // Fallback: Gateway proxy
    return `${this.settings.gatewayUrl}/cdn/jns/${resolution.domain}${path}`
  }

  /**
   * Check gateway connectivity status
   */
  async checkStatus(): Promise<{
    localDws: 'online' | 'offline'
    publicGateway: 'online' | 'offline'
    localDwsLatency: number | null
    publicGatewayLatency: number | null
  }> {
    await this.init()

    const status = {
      localDws: 'offline' as 'online' | 'offline',
      publicGateway: 'offline' as 'online' | 'offline',
      localDwsLatency: null as number | null,
      publicGatewayLatency: null as number | null,
    }

    // Check local DWS
    try {
      const localStart = Date.now()
      const localResponse = await fetch(`${this.settings.localDwsUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      })
      if (localResponse.ok) {
        status.localDws = 'online'
        status.localDwsLatency = Date.now() - localStart
      }
    } catch {
      // Local DWS offline
    }

    // Check public gateway
    try {
      const publicStart = Date.now()
      const publicResponse = await fetch(`${this.settings.gatewayUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      })
      if (publicResponse.ok) {
        status.publicGateway = 'online'
        status.publicGatewayLatency = Date.now() - publicStart
      }
    } catch {
      // Public gateway offline
    }

    return status
  }

  /**
   * Save cache to storage
   */
  private async saveCache(): Promise<void> {
    const cacheObj: Record<string, CacheEntry> = {}
    for (const [domain, entry] of this.cache) {
      cacheObj[domain] = entry
    }
    await storage.set('jns_cache', JSON.stringify(cacheObj))
  }
}

/** Singleton instance */
export const jnsResolver = new JNSResolver()
