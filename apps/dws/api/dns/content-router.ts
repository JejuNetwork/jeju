/**
 * Content Router
 *
 * Routes content requests to appropriate sources:
 * - IPFS gateways
 * - CDN nodes
 * - Origin servers
 * - Durable storage
 */

export interface ContentSource {
  type: 'ipfs' | 'cdn' | 'origin' | 'storage'
  endpoint: string
  priority: number
  healthy: boolean
  latency: number
  region?: string
}

interface ContentResult {
  body: ArrayBuffer
  contentType: string
  cacheControl: string
  source: string
  latency: number
}

export class ContentRouter {
  private sources: ContentSource[] = []
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null

  constructor(sources: ContentSource[]) {
    this.sources = sources.sort((a, b) => a.priority - b.priority)
  }

  /**
   * Start health checks
   */
  start(): void {
    this.healthCheckInterval = setInterval(() => {
      this.healthCheck().catch(console.error)
    }, 30000)
    this.healthCheck().catch(console.error)
  }

  /**
   * Stop health checks
   */
  stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
  }

  /**
   * Fetch content from best available source
   */
  async fetch(
    path: string,
    contentHash?: string,
  ): Promise<ContentResult | null> {
    const healthySources = this.sources.filter((s) => s.healthy)

    for (const source of healthySources) {
      const result = await this.trySource(source, path, contentHash)
      if (result) return result
    }

    // All sources failed
    return null
  }

  /**
   * Try fetching from a specific source
   */
  private async trySource(
    source: ContentSource,
    path: string,
    contentHash?: string,
  ): Promise<ContentResult | null> {
    const startTime = performance.now()

    let url: string
    switch (source.type) {
      case 'ipfs': {
        if (!contentHash) return null
        const cid = contentHash.replace(/^ipfs:\/\//, '')
        url = `${source.endpoint}/ipfs/${cid}${path}`
        break
      }
      case 'cdn':
        url = `${source.endpoint}${path}`
        break
      case 'origin':
        url = `${source.endpoint}${path}`
        break
      case 'storage':
        url = `${source.endpoint}/storage${path}`
        break
    }

    const response = await fetch(url, {
      headers: { Accept: '*/*' },
      signal: AbortSignal.timeout(10000),
    }).catch(() => null)

    if (!response?.ok) return null

    const latency = performance.now() - startTime

    return {
      body: await response.arrayBuffer(),
      contentType:
        response.headers.get('content-type') ?? 'application/octet-stream',
      cacheControl:
        response.headers.get('cache-control') ?? 'public, max-age=3600',
      source: `${source.type}:${source.endpoint}`,
      latency,
    }
  }

  /**
   * Health check all sources
   */
  private async healthCheck(): Promise<void> {
    await Promise.all(
      this.sources.map(async (source) => {
        const start = performance.now()
        const response = await fetch(`${source.endpoint}/health`, {
          signal: AbortSignal.timeout(5000),
        }).catch(() => null)

        source.healthy = response?.ok ?? false
        source.latency = performance.now() - start
      }),
    )

    // Re-sort by latency
    this.sources.sort((a, b) => {
      if (a.healthy !== b.healthy) return a.healthy ? -1 : 1
      if (a.priority !== b.priority) return a.priority - b.priority
      return a.latency - b.latency
    })
  }

  /**
   * Add a new source
   */
  addSource(source: ContentSource): void {
    this.sources.push(source)
    this.sources.sort((a, b) => a.priority - b.priority)
  }

  /**
   * Remove a source
   */
  removeSource(endpoint: string): void {
    this.sources = this.sources.filter((s) => s.endpoint !== endpoint)
  }

  /**
   * Get all sources
   */
  getSources(): ContentSource[] {
    return [...this.sources]
  }
}
