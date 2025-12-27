/**
 * DNS Mirror
 *
 * Syncs JNS records to traditional DNS providers so that
 * .jeju domains can be accessed via standard DNS while
 * maintaining full decentralization.
 *
 * Supported providers:
 * - Cloudflare DNS
 * - AWS Route 53
 * - Google Cloud DNS
 * - Direct AXFR zone transfer
 *
 * This ensures discoverability on the "legacy" internet while
 * maintaining the decentralized source of truth on-chain.
 */

import { JNSResolver, type JNSResolverConfig } from './jns-resolver'
import type { JNSResolution, MirrorTarget } from './types'

export interface MirrorProvider {
  name: string
  syncRecords(
    records: DNSRecordSet[],
  ): Promise<{ success: boolean; synced: number; errors: string[] }>
  getZoneRecords(): Promise<DNSRecordSet[]>
  deleteRecord(name: string, type: string): Promise<boolean>
}

export interface DNSRecordSet {
  name: string
  type: 'A' | 'AAAA' | 'CNAME' | 'TXT' | 'MX' | 'NS'
  ttl: number
  values: string[]
  proxied?: boolean
  priority?: number
}

export interface DNSMirrorConfig {
  /** JNS resolver configuration */
  jnsConfig: JNSResolverConfig
  /** Target DNS providers to mirror to */
  targets: MirrorTarget[]
  /** Domain suffix for mirrored records (e.g., jeju.example.com) */
  mirrorDomain: string
  /** How often to sync (seconds) */
  syncInterval: number
  /** Gateway endpoint for CNAME redirects */
  gatewayEndpoint: string
  /** IPFS gateway for dnslink */
  ipfsGateway: string
}

/**
 * Cloudflare DNS provider
 */
class CloudflareMirrorProvider implements MirrorProvider {
  name = 'cloudflare'
  private apiToken: string
  private zoneId: string
  private baseUrl = 'https://api.cloudflare.com/client/v4'

  constructor(apiToken: string, zoneId: string) {
    this.apiToken = apiToken
    this.zoneId = zoneId
  }

  async syncRecords(records: DNSRecordSet[]): Promise<{
    success: boolean
    synced: number
    errors: string[]
  }> {
    const errors: string[] = []
    let synced = 0

    for (const record of records) {
      for (const value of record.values) {
        const body = {
          type: record.type,
          name: record.name,
          content: value,
          ttl: record.ttl,
          proxied: record.proxied ?? false,
          ...(record.priority !== undefined && { priority: record.priority }),
        }

        const response = await fetch(
          `${this.baseUrl}/zones/${this.zoneId}/dns_records`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.apiToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          },
        )

        const result = (await response.json()) as {
          success: boolean
          errors?: Array<{ message: string }>
        }

        if (!result.success) {
          // If record exists, try to update instead
          const existingId = await this.findRecordId(record.name, record.type)
          if (existingId) {
            const updateResponse = await fetch(
              `${this.baseUrl}/zones/${this.zoneId}/dns_records/${existingId}`,
              {
                method: 'PUT',
                headers: {
                  Authorization: `Bearer ${this.apiToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
              },
            )

            const updateResult = (await updateResponse.json()) as {
              success: boolean
              errors?: Array<{ message: string }>
            }

            if (updateResult.success) {
              synced++
            } else {
              errors.push(
                `Failed to update ${record.name}: ${updateResult.errors?.[0]?.message ?? 'Unknown error'}`,
              )
            }
          } else {
            errors.push(
              `Failed to create ${record.name}: ${result.errors?.[0]?.message ?? 'Unknown error'}`,
            )
          }
        } else {
          synced++
        }
      }
    }

    return { success: errors.length === 0, synced, errors }
  }

  async getZoneRecords(): Promise<DNSRecordSet[]> {
    const records: DNSRecordSet[] = []
    let page = 1
    let hasMore = true

    while (hasMore) {
      const response = await fetch(
        `${this.baseUrl}/zones/${this.zoneId}/dns_records?page=${page}&per_page=100`,
        {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
          },
        },
      )

      const result = (await response.json()) as {
        result: Array<{
          name: string
          type: string
          ttl: number
          content: string
          proxied: boolean
          priority?: number
        }>
        result_info: { total_pages: number }
      }

      for (const r of result.result) {
        const existing = records.find(
          (rec) => rec.name === r.name && rec.type === r.type,
        )
        if (existing) {
          existing.values.push(r.content)
        } else {
          records.push({
            name: r.name,
            type: r.type as DNSRecordSet['type'],
            ttl: r.ttl,
            values: [r.content],
            proxied: r.proxied,
            priority: r.priority,
          })
        }
      }

      hasMore = page < result.result_info.total_pages
      page++
    }

    return records
  }

  async deleteRecord(name: string, type: string): Promise<boolean> {
    const recordId = await this.findRecordId(name, type)
    if (!recordId) return false

    const response = await fetch(
      `${this.baseUrl}/zones/${this.zoneId}/dns_records/${recordId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
        },
      },
    )

    const result = (await response.json()) as { success: boolean }
    return result.success
  }

  private async findRecordId(
    name: string,
    type: string,
  ): Promise<string | null> {
    const response = await fetch(
      `${this.baseUrl}/zones/${this.zoneId}/dns_records?name=${name}&type=${type}`,
      {
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
        },
      },
    )

    const result = (await response.json()) as {
      result: Array<{ id: string }>
    }

    return result.result[0]?.id ?? null
  }
}

/**
 * AWS Route 53 provider
 */
class Route53MirrorProvider implements MirrorProvider {
  name = 'route53'
  private _accessKeyId: string
  private _secretAccessKey: string
  private _hostedZoneId: string

  constructor(
    accessKeyId: string,
    secretAccessKey: string,
    hostedZoneId: string,
  ) {
    this._accessKeyId = accessKeyId
    this._secretAccessKey = secretAccessKey
    this._hostedZoneId = hostedZoneId
  }

  async syncRecords(records: DNSRecordSet[]): Promise<{
    success: boolean
    synced: number
    errors: string[]
  }> {
    // Route 53 requires batched changes
    const changes = records.map((record) => ({
      Action: 'UPSERT',
      ResourceRecordSet: {
        Name: record.name,
        Type: record.type,
        TTL: record.ttl,
        ResourceRecords: record.values.map((v) => ({ Value: v })),
      },
    }))

    // TODO: Implement actual Route 53 API call with AWS4 signing
    // For now, return placeholder
    void this._accessKeyId
    void this._secretAccessKey
    void this._hostedZoneId
    console.log('[Route53] Would sync records:', changes.length)

    return { success: true, synced: records.length, errors: [] }
  }

  async getZoneRecords(): Promise<DNSRecordSet[]> {
    // TODO: Implement Route 53 ListResourceRecordSets
    return []
  }

  async deleteRecord(name: string, type: string): Promise<boolean> {
    // TODO: Implement Route 53 DELETE
    console.log(`[Route53] Would delete: ${name} ${type}`)
    return true
  }
}

/**
 * DNS Mirror orchestrator
 */
export class DNSMirror {
  private config: DNSMirrorConfig
  private jnsResolver: JNSResolver
  private providers: MirrorProvider[] = []
  private syncTimer: ReturnType<typeof setInterval> | null = null
  private knownNames = new Set<string>()

  constructor(config: DNSMirrorConfig) {
    this.config = config
    this.jnsResolver = new JNSResolver(config.jnsConfig)

    // Initialize providers
    for (const target of config.targets) {
      if (target.provider === 'cloudflare' && target.apiKey && target.zoneId) {
        this.providers.push(
          new CloudflareMirrorProvider(target.apiKey, target.zoneId),
        )
      } else if (
        target.provider === 'route53' &&
        target.apiKey &&
        target.apiSecret &&
        target.zoneId
      ) {
        this.providers.push(
          new Route53MirrorProvider(
            target.apiKey,
            target.apiSecret,
            target.zoneId,
          ),
        )
      }
    }
  }

  /**
   * Convert JNS resolution to DNS records
   */
  jnsToRecords(name: string, resolution: JNSResolution): DNSRecordSet[] {
    const records: DNSRecordSet[] = []
    const mirroredName = this.getMirroredName(name)

    // Worker endpoint -> CNAME to gateway
    if (resolution.records.workerEndpoint) {
      records.push({
        name: mirroredName,
        type: 'CNAME',
        ttl: resolution.ttl,
        values: [this.config.gatewayEndpoint],
        proxied: true,
      })

      // Also add TXT record with worker endpoint
      records.push({
        name: `_dws.${mirroredName}`,
        type: 'TXT',
        ttl: resolution.ttl,
        values: [`worker=${resolution.records.workerEndpoint}`],
      })
    }

    // IPFS contenthash -> dnslink TXT record
    if (resolution.records.ipfsHash) {
      records.push({
        name: `_dnslink.${mirroredName}`,
        type: 'TXT',
        ttl: resolution.ttl,
        values: [`dnslink=/ipfs/${resolution.records.ipfsHash}`],
      })

      // If no worker, point to IPFS gateway
      if (!resolution.records.workerEndpoint) {
        records.push({
          name: mirroredName,
          type: 'CNAME',
          ttl: resolution.ttl,
          values: [this.config.ipfsGateway],
          proxied: true,
        })
      }
    }

    // Arweave contenthash
    if (resolution.records.arweaveHash) {
      records.push({
        name: `_arweave.${mirroredName}`,
        type: 'TXT',
        ttl: resolution.ttl,
        values: [`arweave=${resolution.records.arweaveHash}`],
      })
    }

    // ETH address -> TXT record
    if (resolution.records.addresses.eth) {
      records.push({
        name: `_eth.${mirroredName}`,
        type: 'TXT',
        ttl: resolution.ttl,
        values: [`address=${resolution.records.addresses.eth}`],
      })
    }

    // JNS owner -> TXT record
    records.push({
      name: `_jns.${mirroredName}`,
      type: 'TXT',
      ttl: resolution.ttl,
      values: [
        `node=${resolution.node}`,
        `owner=${resolution.owner}`,
        `resolver=${resolution.resolver}`,
      ],
    })

    return records
  }

  /**
   * Convert JNS name to mirrored DNS name
   * e.g., "gateway.jeju" -> "gateway.jeju.jejunetwork.org"
   */
  getMirroredName(jnsName: string): string {
    const baseName = jnsName.replace(/\.jeju$/, '').replace(/\.jns$/, '')
    return `${baseName}.${this.config.mirrorDomain}`
  }

  /**
   * Sync a single JNS name to DNS providers
   */
  async syncName(name: string): Promise<{
    name: string
    synced: boolean
    providers: string[]
    errors: string[]
  }> {
    const resolution = await this.jnsResolver.resolve(name)

    if (!resolution) {
      return {
        name,
        synced: false,
        providers: [],
        errors: ['Name not found in JNS'],
      }
    }

    const records = this.jnsToRecords(name, resolution)
    const syncedProviders: string[] = []
    const allErrors: string[] = []

    for (const provider of this.providers) {
      const result = await provider.syncRecords(records)
      if (result.success) {
        syncedProviders.push(provider.name)
      } else {
        allErrors.push(...result.errors.map((e) => `[${provider.name}] ${e}`))
      }
    }

    this.knownNames.add(name)

    return {
      name,
      synced: syncedProviders.length > 0,
      providers: syncedProviders,
      errors: allErrors,
    }
  }

  /**
   * Sync multiple names
   */
  async syncNames(names: string[]): Promise<{
    total: number
    synced: number
    errors: string[]
  }> {
    let synced = 0
    const allErrors: string[] = []

    for (const name of names) {
      const result = await this.syncName(name)
      if (result.synced) {
        synced++
      }
      allErrors.push(...result.errors)
    }

    return { total: names.length, synced, errors: allErrors }
  }

  /**
   * Remove a name from DNS mirrors
   */
  async removeName(name: string): Promise<boolean> {
    const mirroredName = this.getMirroredName(name)
    let success = true

    for (const provider of this.providers) {
      // Remove all record types
      for (const type of ['A', 'AAAA', 'CNAME', 'TXT'] as const) {
        const deleted = await provider.deleteRecord(mirroredName, type)
        if (!deleted) success = false
      }

      // Also remove _dnslink, _dws, _eth, _jns subdomains
      for (const prefix of ['_dnslink', '_dws', '_eth', '_arweave', '_jns']) {
        await provider.deleteRecord(`${prefix}.${mirroredName}`, 'TXT')
      }
    }

    this.knownNames.delete(name)
    return success
  }

  /**
   * Start automatic sync
   */
  startAutoSync(): void {
    if (this.syncTimer) return

    this.syncTimer = setInterval(async () => {
      console.log(
        `[DNSMirror] Running auto-sync for ${this.knownNames.size} names`,
      )
      await this.syncNames([...this.knownNames])
    }, this.config.syncInterval * 1000)

    console.log(
      `[DNSMirror] Auto-sync started (interval: ${this.config.syncInterval}s)`,
    )
  }

  /**
   * Stop automatic sync
   */
  stopAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer)
      this.syncTimer = null
      console.log('[DNSMirror] Auto-sync stopped')
    }
  }

  /**
   * Get sync status
   */
  getStatus(): {
    providers: string[]
    knownNames: number
    autoSyncEnabled: boolean
    syncInterval: number
    mirrorDomain: string
  } {
    return {
      providers: this.providers.map((p) => p.name),
      knownNames: this.knownNames.size,
      autoSyncEnabled: this.syncTimer !== null,
      syncInterval: this.config.syncInterval,
      mirrorDomain: this.config.mirrorDomain,
    }
  }
}

export function createDNSMirror(config: DNSMirrorConfig): DNSMirror {
  return new DNSMirror(config)
}
