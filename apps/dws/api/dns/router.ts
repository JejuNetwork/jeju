/**
 * DNS Router
 *
 * Elysia routes for the DNS gateway and management APIs.
 */

import { Elysia, t } from 'elysia'
import type { Address } from 'viem'
import { type CertConfig, CertificateManager } from './certificate-manager'
import { ContentRouter, type ContentSource } from './content-router'
import { DNSGateway, type DNSGatewayConfig } from './gateway'
import { JNSResolver } from './resolver'

export interface DNSRouterConfig {
  rpcUrl: string
  jnsRegistryAddress: Address
  jnsResolverAddress: Address
  gatewayDomain: string
  ipfsGatewayUrl: string
  dataDir: string
  acmeEmail?: string
}

export function createDNSRouter(config: DNSRouterConfig) {
  // Initialize components
  const resolver = new JNSResolver({
    rpcUrl: config.rpcUrl,
    registryAddress: config.jnsRegistryAddress,
    resolverAddress: config.jnsResolverAddress,
  })

  const gatewayConfig: DNSGatewayConfig = {
    rpcUrl: config.rpcUrl,
    jnsRegistryAddress: config.jnsRegistryAddress,
    jnsResolverAddress: config.jnsResolverAddress,
    gatewayDomain: config.gatewayDomain,
    ipfsGatewayUrl: config.ipfsGatewayUrl,
    cacheEnabled: true,
    cacheTtl: 300,
  }
  const gateway = new DNSGateway(gatewayConfig)

  const contentRouter = new ContentRouter([
    {
      type: 'ipfs',
      endpoint: config.ipfsGatewayUrl,
      priority: 1,
      healthy: true,
      latency: 0,
    },
  ])

  const certConfig: CertConfig = {
    dataDir: config.dataDir,
    acmeEmail: config.acmeEmail ?? 'admin@jeju.network',
    acmeDirectory: 'https://acme-v02.api.letsencrypt.org/directory',
    gatewayDomain: config.gatewayDomain,
  }
  const certManager = new CertificateManager(certConfig)

  // Start services
  contentRouter.start()
  certManager.start().catch(console.error)

  return (
    new Elysia({ prefix: '/dns' })
      // Gateway handler
      .get('/gateway/*', async ({ request }) => {
        return gateway.handleRequest(request)
      })
      .post('/gateway/*', async ({ request }) => {
        return gateway.handleRequest(request)
      })

      // DNS-over-HTTPS endpoint
      .get(
        '/query',
        async ({ query }) => {
          const record = await resolver.resolve(query.name)
          if (!record) {
            return {
              Status: 3, // NXDOMAIN
              Question: [{ name: query.name, type: 1 }],
              Answer: [],
            }
          }

          const answers: Array<{
            name: string
            type: number
            TTL: number
            data: string
          }> = []

          if (query.type === 'A' && record.address) {
            answers.push({
              name: query.name,
              type: 1,
              TTL: record.ttl,
              data: record.address,
            })
          }

          if (query.type === 'TXT') {
            for (const [key, value] of Object.entries(record.texts)) {
              answers.push({
                name: query.name,
                type: 16,
                TTL: record.ttl,
                data: `"${key}=${value}"`,
              })
            }
          }

          return {
            Status: 0,
            Question: [{ name: query.name, type: query.type === 'A' ? 1 : 16 }],
            Answer: answers,
          }
        },
        {
          query: t.Object({
            name: t.String(),
            type: t.Optional(t.String()),
          }),
        },
      )

      // Resolve endpoint
      .get('/resolve/:name', async ({ params }) => {
        const record = await resolver.resolve(params.name)
        if (!record) {
          return { error: 'Name not found' }
        }
        return {
          name: record.name,
          owner: record.owner,
          address: record.address,
          contentHash: record.contentHash,
          texts: record.texts,
          appRecord: record.appRecord
            ? {
                appContract: record.appRecord.appContract,
                appId: record.appRecord.appId,
                agentId: record.appRecord.agentId.toString(),
              }
            : null,
          ttl: record.ttl,
          resolvedAt: record.resolvedAt,
        }
      })

      // Check availability
      .get('/available/:name', async ({ params }) => {
        const available = await resolver.isAvailable(params.name)
        return { name: params.name, available }
      })

      // Get text record
      .get('/text/:name/:key', async ({ params }) => {
        const value = await resolver.getText(params.name, params.key)
        return { name: params.name, key: params.key, value }
      })

      // Certificate endpoints
      .get('/certs', () => {
        const certs = certManager.listCertificates()
        return {
          certificates: certs.map((c) => ({
            domain: c.domain,
            issuer: c.issuer,
            issuedAt: c.issuedAt,
            expiresAt: c.expiresAt,
          })),
        }
      })

      .get('/certs/:domain', async ({ params }) => {
        const cert = await certManager.getCertificate(params.domain)
        if (!cert) {
          return { error: 'Certificate not found' }
        }
        return {
          domain: cert.domain,
          issuer: cert.issuer,
          issuedAt: cert.issuedAt,
          expiresAt: cert.expiresAt,
          // Don't expose private key
        }
      })

      .post('/certs/:domain', async ({ params }) => {
        const cert = await certManager.getCertificate(params.domain)
        if (!cert) {
          return { error: 'Failed to provision certificate' }
        }
        return {
          domain: cert.domain,
          issuer: cert.issuer,
          issuedAt: cert.issuedAt,
          expiresAt: cert.expiresAt,
        }
      })

      // ACME HTTP-01 challenge
      .get('/.well-known/acme-challenge/:token', ({ params }) => {
        const challenge = certManager.getChallenge(params.token)
        if (!challenge) {
          return new Response('Challenge not found', { status: 404 })
        }
        return new Response(challenge, {
          headers: { 'Content-Type': 'text/plain' },
        })
      })

      // Content sources
      .get('/sources', () => {
        return { sources: contentRouter.getSources() }
      })

      .post('/sources', ({ body }) => {
        const source = body as ContentSource
        contentRouter.addSource(source)
        return { success: true }
      })

      .delete('/sources/:endpoint', ({ params }) => {
        contentRouter.removeSource(decodeURIComponent(params.endpoint))
        return { success: true }
      })

      // Health check
      .get('/health', () => ({
        status: 'healthy',
        service: 'dns',
        gateway: config.gatewayDomain,
        certificates: certManager.listCertificates().length,
        contentSources: contentRouter.getSources().filter((s) => s.healthy)
          .length,
      }))
  )
}
