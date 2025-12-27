/**
 * DNS API Routes for DWS
 *
 * Provides HTTP endpoints for DNS operations:
 * - DoH endpoints (RFC 8484)
 * - JNS resolution
 * - ENS bridge
 * - DNS mirroring management
 */

import { createAppConfig, getContract, getRpcUrl } from '@jejunetwork/config'
import { Elysia, t } from 'elysia'
import type { Address } from 'viem'
import { createDNSMirror } from './dns-mirror'
import { createDoHServer, type DoHServerConfig } from './doh-server'
import { createENSBridge } from './ens-bridge'
import { createJNSResolver } from './jns-resolver'
import { createRecursiveResolver } from './recursive-resolver'
import { DNSRecordType, type MirrorTarget } from './types'

interface DNSRouterConfig {
  ethRpcUrl?: string
  cfApiToken?: string
  cfZoneId?: string
  cfDomain?: string
  awsAccessKeyId?: string
  awsSecretAccessKey?: string
  awsHostedZoneId?: string
  awsDomain?: string
  dnsMirrorDomain?: string
  dnsSyncInterval?: number
  gatewayEndpoint?: string
  ipfsGateway?: string
  [key: string]: string | number | undefined
}

const { config: dnsRouterConfig, configure: configureDNSRouter } =
  createAppConfig<DNSRouterConfig>({
    cfDomain: 'jejunetwork.org',
    awsDomain: 'jejunetwork.org',
    dnsMirrorDomain: 'jeju.jejunetwork.org',
    dnsSyncInterval: 300,
    gatewayEndpoint: 'gateway.jejunetwork.org',
    ipfsGateway: 'ipfs.jejunetwork.org',
  })

export function configureDNSRouterConfig(
  config: Partial<DNSRouterConfig>,
): void {
  configureDNSRouter(config)
}

// Initialize resolvers
let dohServer: ReturnType<typeof createDoHServer> | null = null
let recursiveResolver: ReturnType<typeof createRecursiveResolver> | null = null
let dnsMirror: ReturnType<typeof createDNSMirror> | null = null

function getDoHServer(): ReturnType<typeof createDoHServer> {
  if (dohServer) return dohServer

  const jnsRegistry = getContract('jns', 'jnsRegistry') as Address | undefined

  const config: Partial<DoHServerConfig> = {
    port: 5353,
    upstreamServers: [
      'https://cloudflare-dns.com/dns-query',
      'https://dns.google/dns-query',
    ],
    jnsResolverAddress: jnsRegistry,
    rpcUrl: getRpcUrl(),
    customTLDs: ['jeju', 'jns'],
    cacheTTL: 300,
  }

  dohServer = createDoHServer(config)
  return dohServer
}

function getRecursiveResolver(): ReturnType<typeof createRecursiveResolver> {
  if (recursiveResolver) return recursiveResolver

  const jnsRegistry = getContract('jns', 'jnsRegistry') as Address | undefined

  recursiveResolver = createRecursiveResolver({
    jns: jnsRegistry
      ? {
          rpcUrl: getRpcUrl(),
          registryAddress: jnsRegistry,
        }
      : undefined,
    ens: dnsRouterConfig.ethRpcUrl
      ? {
          ethRpcUrl: dnsRouterConfig.ethRpcUrl,
        }
      : undefined,
    upstreamServers: [
      'https://cloudflare-dns.com/dns-query',
      'https://dns.google/dns-query',
    ],
    cacheTTL: 300,
  })

  return recursiveResolver
}

function getDNSMirror(): ReturnType<typeof createDNSMirror> | null {
  if (dnsMirror) return dnsMirror

  const jnsRegistry = getContract('jns', 'jnsRegistry') as Address | undefined
  if (!jnsRegistry) return null

  // Check for mirror configuration
  const targets: MirrorTarget[] = []

  // Cloudflare
  if (dnsRouterConfig.cfApiToken && dnsRouterConfig.cfZoneId) {
    targets.push({
      provider: 'cloudflare',
      apiKey: dnsRouterConfig.cfApiToken,
      zoneId: dnsRouterConfig.cfZoneId,
      domain: dnsRouterConfig.cfDomain ?? 'jejunetwork.org',
    })
  }

  // Route 53
  if (
    dnsRouterConfig.awsAccessKeyId &&
    dnsRouterConfig.awsSecretAccessKey &&
    dnsRouterConfig.awsHostedZoneId
  ) {
    targets.push({
      provider: 'route53',
      apiKey: dnsRouterConfig.awsAccessKeyId,
      apiSecret: dnsRouterConfig.awsSecretAccessKey,
      zoneId: dnsRouterConfig.awsHostedZoneId,
      domain: dnsRouterConfig.awsDomain ?? 'jejunetwork.org',
    })
  }

  if (targets.length === 0) return null

  dnsMirror = createDNSMirror({
    jnsConfig: {
      rpcUrl: getRpcUrl(),
      registryAddress: jnsRegistry,
    },
    targets,
    mirrorDomain: dnsRouterConfig.dnsMirrorDomain ?? 'jeju.jejunetwork.org',
    syncInterval: dnsRouterConfig.dnsSyncInterval ?? 300,
    gatewayEndpoint:
      dnsRouterConfig.gatewayEndpoint ?? 'gateway.jejunetwork.org',
    ipfsGateway: dnsRouterConfig.ipfsGateway ?? 'ipfs.jejunetwork.org',
  })

  return dnsMirror
}

export function createDNSRouter() {
  return (
    new Elysia({ prefix: '/dns' })
      .get('/health', () => {
        const resolver = getRecursiveResolver()
        const mirror = getDNSMirror()

        return {
          status: 'healthy',
          service: 'dws-dns',
          resolver: resolver.getCacheStats(),
          mirror: mirror?.getStatus() ?? null,
        }
      })

      // === DoH Endpoints (RFC 8484) ===

      .get(
        '/query',
        async ({ query, set, headers }) => {
          // RFC 8484 GET method with dns parameter
          const dnsParam = query.dns
          if (!dnsParam) {
            set.status = 400
            return { error: 'Missing dns parameter' }
          }

          const server = getDoHServer()
          const app = server.getApp()
          const req = new Request(
            `http://localhost/dns-query?dns=${dnsParam}`,
            {
              headers: { Accept: headers.accept ?? 'application/dns-json' },
            },
          )
          return app.fetch(req)
        },
        {
          query: t.Object({
            dns: t.Optional(t.String()),
          }),
        },
      )

      .post('/query', async ({ body, headers }) => {
        // RFC 8484 POST method
        const server = getDoHServer()
        const app = server.getApp()
        const req = new Request('http://localhost/dns-query', {
          method: 'POST',
          body: body as ArrayBuffer,
          headers: {
            'Content-Type': 'application/dns-message',
            Accept: headers.accept ?? 'application/dns-message',
          },
        })
        return app.fetch(req)
      })

      // === JSON API for easy consumption ===

      .get(
        '/resolve/:name',
        async ({ params, query }) => {
          const resolver = getRecursiveResolver()
          const typeStr = query.type ?? 'A'
          const type =
            DNSRecordType[typeStr as keyof typeof DNSRecordType] ??
            DNSRecordType.A

          return resolver.resolve({
            name: params.name,
            type,
            class: 1,
          })
        },
        {
          query: t.Object({
            type: t.Optional(t.String()),
          }),
        },
      )

      // === JNS-specific endpoints ===

      .get('/jns/:name', async ({ params, set }) => {
        const jnsRegistry = getContract('jns', 'jnsRegistry') as
          | Address
          | undefined
        if (!jnsRegistry) {
          set.status = 503
          return { error: 'JNS not configured' }
        }

        const jnsResolver = createJNSResolver({
          rpcUrl: getRpcUrl(),
          registryAddress: jnsRegistry,
        })

        const resolution = await jnsResolver.resolve(params.name)
        if (!resolution) {
          set.status = 404
          return { error: 'Name not found' }
        }

        return resolution
      })

      .get('/jns/:name/text/:key', async ({ params, set }) => {
        const jnsRegistry = getContract('jns', 'jnsRegistry') as
          | Address
          | undefined
        if (!jnsRegistry) {
          set.status = 503
          return { error: 'JNS not configured' }
        }

        const jnsResolver = createJNSResolver({
          rpcUrl: getRpcUrl(),
          registryAddress: jnsRegistry,
        })

        const value = await jnsResolver.getText(params.name, params.key)
        if (!value) {
          set.status = 404
          return { error: 'Text record not found' }
        }

        return { key: params.key, value }
      })

      .get('/jns/:name/contenthash', async ({ params, set }) => {
        const jnsRegistry = getContract('jns', 'jnsRegistry') as
          | Address
          | undefined
        if (!jnsRegistry) {
          set.status = 503
          return { error: 'JNS not configured' }
        }

        const jnsResolver = createJNSResolver({
          rpcUrl: getRpcUrl(),
          registryAddress: jnsRegistry,
        })

        const contenthash = await jnsResolver.getContenthash(params.name)
        if (!contenthash) {
          set.status = 404
          return { error: 'Contenthash not found' }
        }

        return contenthash
      })

      // === ENS Bridge endpoints ===

      .get('/ens/:name', async ({ params, set }) => {
        if (!process.env.ETH_RPC_URL) {
          set.status = 503
          return { error: 'ENS bridge not configured. Set ETH_RPC_URL.' }
        }

        const bridge = createENSBridge({
          ethRpcUrl: process.env.ETH_RPC_URL,
        })

        const resolution = await bridge.resolve(params.name)
        if (!resolution) {
          set.status = 404
          return { error: 'Name not found' }
        }

        return resolution
      })

      // === DNS Mirror endpoints ===

      .get('/mirror/status', ({ set }) => {
        const mirror = getDNSMirror()
        if (!mirror) {
          set.status = 503
          return { error: 'DNS mirroring not configured' }
        }

        return mirror.getStatus()
      })

      .post(
        '/mirror/sync',
        async ({ body, set }) => {
          const mirror = getDNSMirror()
          if (!mirror) {
            set.status = 503
            return { error: 'DNS mirroring not configured' }
          }

          const result = await mirror.syncNames(body.names)
          return result
        },
        {
          body: t.Object({
            names: t.Array(t.String(), { minItems: 1 }),
          }),
        },
      )

      .post('/mirror/sync/:name', async ({ params, set }) => {
        const mirror = getDNSMirror()
        if (!mirror) {
          set.status = 503
          return { error: 'DNS mirroring not configured' }
        }

        return mirror.syncName(params.name)
      })

      .delete('/mirror/:name', async ({ params, set }) => {
        const mirror = getDNSMirror()
        if (!mirror) {
          set.status = 503
          return { error: 'DNS mirroring not configured' }
        }

        const success = await mirror.removeName(params.name)
        return { success }
      })

      .post('/mirror/auto-sync/start', ({ set }) => {
        const mirror = getDNSMirror()
        if (!mirror) {
          set.status = 503
          return { error: 'DNS mirroring not configured' }
        }

        mirror.startAutoSync()
        return { success: true, message: 'Auto-sync started' }
      })

      .post('/mirror/auto-sync/stop', ({ set }) => {
        const mirror = getDNSMirror()
        if (!mirror) {
          set.status = 503
          return { error: 'DNS mirroring not configured' }
        }

        mirror.stopAutoSync()
        return { success: true, message: 'Auto-sync stopped' }
      })

      // === Cache management ===

      .post('/cache/clear', () => {
        const resolver = getRecursiveResolver()
        resolver.clearCache()
        return { success: true, message: 'Cache cleared' }
      })

      .get('/cache/stats', () => {
        const resolver = getRecursiveResolver()
        return resolver.getCacheStats()
      })
  )
}
