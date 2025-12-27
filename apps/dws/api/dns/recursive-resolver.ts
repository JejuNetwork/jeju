/**
 * Recursive DNS Resolver
 *
 * Unified resolver that:
 * 1. Routes .jeju/.jns to JNS on-chain resolution
 * 2. Routes .eth to ENS bridge
 * 3. Routes other TLDs to traditional DNS
 *
 * This is the main entry point for all DNS queries in DWS nodes.
 */

import type { Address } from 'viem'
import { ENSBridge } from './ens-bridge'
import { JNSResolver } from './jns-resolver'
import {
  type DNSQuestion,
  DNSRecordType,
  type DNSResolutionResult,
  type DNSResourceRecord,
  DNSResponseCode,
  type DoHResponse,
  ResolverType,
} from './types'

export interface RecursiveResolverConfig {
  /** JNS configuration for .jeju domains */
  jns?: {
    rpcUrl: string
    registryAddress: Address
  }
  /** ENS configuration for .eth domains */
  ens?: {
    ethRpcUrl: string
  }
  /** Upstream DoH servers for fallback */
  upstreamServers: string[]
  /** Enable local zone for testing */
  localZone?: Map<string, DNSResourceRecord[]>
  /** Cache TTL in seconds */
  cacheTTL?: number
}

interface CacheEntry {
  result: DNSResolutionResult
  expiresAt: number
}

export class RecursiveResolver {
  private config: RecursiveResolverConfig
  private jnsResolver?: JNSResolver
  private ensBridge?: ENSBridge
  private cache = new Map<string, CacheEntry>()
  private defaultTTL: number

  constructor(config: RecursiveResolverConfig) {
    this.config = config
    this.defaultTTL = config.cacheTTL ?? 300

    // Initialize JNS resolver if configured
    if (config.jns) {
      this.jnsResolver = new JNSResolver({
        rpcUrl: config.jns.rpcUrl,
        registryAddress: config.jns.registryAddress,
        cacheTTL: this.defaultTTL,
      })
    }

    // Initialize ENS bridge if configured
    if (config.ens) {
      this.ensBridge = new ENSBridge({
        ethRpcUrl: config.ens.ethRpcUrl,
        cacheTTL: this.defaultTTL,
      })
    }
  }

  /**
   * Resolve a DNS question through the appropriate resolver
   */
  async resolve(question: DNSQuestion): Promise<DNSResolutionResult> {
    const startTime = Date.now()
    const cacheKey = `${question.name}:${question.type}`

    // Check cache
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return {
        ...cached.result,
        source: {
          ...cached.result.source,
          cached: true,
          latencyMs: Date.now() - startTime,
        },
      }
    }

    // Determine TLD and route to appropriate resolver
    const tld = this.getTLD(question.name)
    let result: DNSResolutionResult

    // Check local zone first (for testing/development)
    if (this.config.localZone) {
      const localRecords = this.config.localZone.get(question.name)
      if (localRecords) {
        result = {
          name: question.name,
          records: localRecords.filter((r) => r.type === question.type),
          source: {
            resolver: ResolverType.LOCAL,
            latencyMs: Date.now() - startTime,
            cached: false,
          },
          authenticated: false,
        }
        return result
      }
    }

    // Route based on TLD
    if (tld === 'jeju' || tld === 'jns') {
      result = await this.resolveJNS(question, startTime)
    } else if (tld === 'eth') {
      result = await this.resolveENS(question, startTime)
    } else {
      result = await this.resolveUpstream(question, startTime)
    }

    // Cache the result
    const minTTL =
      result.records.length > 0
        ? Math.min(...result.records.map((r) => r.ttl))
        : this.defaultTTL

    this.cache.set(cacheKey, {
      result,
      expiresAt: Date.now() + minTTL * 1000,
    })

    return result
  }

  /**
   * Resolve via JNS
   */
  private async resolveJNS(
    question: DNSQuestion,
    startTime: number,
  ): Promise<DNSResolutionResult> {
    if (!this.jnsResolver) {
      return this.createErrorResult(question, 'JNS not configured', startTime)
    }

    const resolution = await this.jnsResolver.resolve(question.name)

    if (!resolution) {
      return {
        name: question.name,
        records: [],
        source: {
          resolver: ResolverType.JNS,
          latencyMs: Date.now() - startTime,
          cached: false,
        },
        authenticated: true, // On-chain is always authenticated
      }
    }

    const records: DNSResourceRecord[] = []

    // Convert JNS resolution to DNS records based on query type
    if (question.type === DNSRecordType.A) {
      // If there's a worker endpoint, return gateway IP
      // In production, this would be the node's public IP
      if (resolution.records.workerEndpoint) {
        records.push({
          name: question.name,
          type: DNSRecordType.A,
          class: 1,
          ttl: resolution.ttl,
          data: '127.0.0.1', // Placeholder - should be DWS node IP
        })
      }
    } else if (question.type === DNSRecordType.TXT) {
      // Return contenthash as dnslink
      if (resolution.records.ipfsHash) {
        records.push({
          name: question.name,
          type: DNSRecordType.TXT,
          class: 1,
          ttl: resolution.ttl,
          data: `dnslink=/ipfs/${resolution.records.ipfsHash}`,
        })
      }

      // Return worker endpoint
      if (resolution.records.workerEndpoint) {
        records.push({
          name: question.name,
          type: DNSRecordType.TXT,
          class: 1,
          ttl: resolution.ttl,
          data: `dws-worker=${resolution.records.workerEndpoint}`,
        })
      }

      // Return text records
      for (const [key, value] of Object.entries(resolution.records.text)) {
        records.push({
          name: question.name,
          type: DNSRecordType.TXT,
          class: 1,
          ttl: resolution.ttl,
          data: `${key}=${value}`,
        })
      }
    } else if (question.type === DNSRecordType.CNAME) {
      // Return gateway as CNAME if there's content to serve
      if (resolution.records.workerEndpoint || resolution.records.ipfsHash) {
        records.push({
          name: question.name,
          type: DNSRecordType.CNAME,
          class: 1,
          ttl: resolution.ttl,
          data: 'gateway.jejunetwork.org', // Gateway domain
        })
      }
    }

    return {
      name: question.name,
      records,
      source: {
        resolver: ResolverType.JNS,
        latencyMs: Date.now() - startTime,
        cached: false,
      },
      authenticated: true,
    }
  }

  /**
   * Resolve via ENS bridge
   */
  private async resolveENS(
    question: DNSQuestion,
    startTime: number,
  ): Promise<DNSResolutionResult> {
    if (!this.ensBridge) {
      return this.createErrorResult(question, 'ENS not configured', startTime)
    }

    const resolution = await this.ensBridge.resolve(question.name)

    if (!resolution) {
      return {
        name: question.name,
        records: [],
        source: {
          resolver: ResolverType.ENS,
          latencyMs: Date.now() - startTime,
          cached: false,
        },
        authenticated: true,
      }
    }

    const records: DNSResourceRecord[] = []

    if (question.type === DNSRecordType.TXT) {
      if (resolution.contenthash) {
        records.push({
          name: question.name,
          type: DNSRecordType.TXT,
          class: 1,
          ttl: resolution.ttl,
          data: `contenthash=${resolution.contenthash}`,
        })
      }

      for (const [key, value] of Object.entries(resolution.text)) {
        records.push({
          name: question.name,
          type: DNSRecordType.TXT,
          class: 1,
          ttl: resolution.ttl,
          data: `${key}=${value}`,
        })
      }
    }

    return {
      name: question.name,
      records,
      source: {
        resolver: ResolverType.ENS,
        latencyMs: Date.now() - startTime,
        cached: false,
      },
      authenticated: true,
    }
  }

  /**
   * Resolve via upstream DNS
   */
  private async resolveUpstream(
    question: DNSQuestion,
    startTime: number,
  ): Promise<DNSResolutionResult> {
    const params = new URLSearchParams({
      name: question.name,
      type: String(question.type),
    })

    for (const upstream of this.config.upstreamServers) {
      try {
        const response = await fetch(`${upstream}?${params}`, {
          headers: { Accept: 'application/dns-json' },
        })

        if (!response.ok) continue

        const json = (await response.json()) as DoHResponse

        if (json.Status !== DNSResponseCode.NOERROR) continue

        const records: DNSResourceRecord[] =
          json.Answer?.map((a) => ({
            name: a.name,
            type: a.type,
            class: 1,
            ttl: a.TTL,
            data: a.data,
          })) ?? []

        return {
          name: question.name,
          records,
          source: {
            resolver: ResolverType.ICANN,
            latencyMs: Date.now() - startTime,
            cached: false,
            upstreamServer: upstream,
          },
          authenticated: false,
          dnssecValid: json.AD,
        }
      } catch {}
    }

    // All upstreams failed
    return {
      name: question.name,
      records: [],
      source: {
        resolver: ResolverType.ICANN,
        latencyMs: Date.now() - startTime,
        cached: false,
      },
      authenticated: false,
    }
  }

  /**
   * Create error result
   */
  private createErrorResult(
    question: DNSQuestion,
    _error: string,
    startTime: number,
  ): DNSResolutionResult {
    return {
      name: question.name,
      records: [],
      source: {
        resolver: ResolverType.LOCAL,
        latencyMs: Date.now() - startTime,
        cached: false,
      },
      authenticated: false,
    }
  }

  /**
   * Extract TLD from domain name
   */
  private getTLD(name: string): string {
    const parts = name.replace(/\.$/, '').split('.')
    return parts[parts.length - 1].toLowerCase()
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear()
    this.jnsResolver?.clearCache()
    this.ensBridge?.clearCache()
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number
    jnsConfigured: boolean
    ensConfigured: boolean
  } {
    return {
      size: this.cache.size,
      jnsConfigured: !!this.jnsResolver,
      ensConfigured: !!this.ensBridge,
    }
  }
}

export function createRecursiveResolver(
  config: RecursiveResolverConfig,
): RecursiveResolver {
  return new RecursiveResolver(config)
}
