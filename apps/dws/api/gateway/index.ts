/**
 * JNS Gateway
 */

import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
import { LRUCache } from 'lru-cache'

function getCorsConfig() {
  const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',').filter(Boolean)
  const isProduction = process.env.NODE_ENV === 'production'
  return {
    origin: isProduction && CORS_ORIGINS?.length ? CORS_ORIGINS : true,
    credentials: true,
  }
}

const cache = new LRUCache<
  string,
  { content: Buffer; type: string; expiresAt: number }
>({
  max: 5000,
  maxSize: 500 * 1024 * 1024,
  sizeCalculation: (v) => v.content.length,
})

const app = new Elysia()
  .use(cors(getCorsConfig()))
  .get('/health', () => ({
    status: 'healthy',
    service: 'dws-gateway',
    cache: { size: cache.size },
  }))
  .all('*', async ({ request, set }) => {
    const url = new URL(request.url)
    const host = request.headers.get('host') || ''
    const path = url.pathname

    if (host.endsWith('.jns') || host.includes('.jns.')) {
      const jnsName = host.split('.')[0]
      const cacheKey = `${jnsName}:${path}`
      const cached = cache.get(cacheKey)
      if (cached && cached.expiresAt > Date.now()) {
        return new Response(new Uint8Array(cached.content), {
          headers: {
            'Content-Type': cached.type,
            'X-Cache': 'HIT',
            'X-JNS-Name': jnsName,
          },
        })
      }
      set.status = 502
      return { error: 'JNS resolution not configured', jnsName, path }
    }

    if (path.startsWith('/ipfs/')) {
      const cid = path.replace('/ipfs/', '').split('/')[0]
      const subpath = path.replace(`/ipfs/${cid}`, '') || '/'
      const cacheKey = `/ipfs/${cid}${subpath}`
      const cached = cache.get(cacheKey)
      if (cached && cached.expiresAt > Date.now()) {
        return new Response(new Uint8Array(cached.content), {
          headers: { 'Content-Type': cached.type, 'X-Cache': 'HIT' },
        })
      }
      const ipfsGateway = process.env.IPFS_GATEWAY_URL || 'https://ipfs.io'
      const response = await fetch(`${ipfsGateway}/ipfs/${cid}${subpath}`)
      if (!response.ok) {
        set.status = 404
        return { error: 'Content not found' }
      }
      const content = Buffer.from(await response.arrayBuffer())
      const type =
        response.headers.get('content-type') || 'application/octet-stream'
      cache.set(cacheKey, {
        content,
        type,
        expiresAt: Date.now() + 31536000000,
      })
      return new Response(content, {
        headers: {
          'Content-Type': type,
          'X-Cache': 'MISS',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      })
    }

    return {
      name: 'DWS Gateway',
      version: '1.0.0',
      endpoints: ['/ipfs/:cid', '*.jns domains'],
    }
  })

const PORT = parseInt(process.env.DWS_GATEWAY_PORT || '4032', 10)

if (import.meta.main) {
  console.log(`[DWS Gateway] Running at http://localhost:${PORT}`)
  app.listen(PORT)
}

export type GatewayApp = typeof app
export { app as gatewayApp }
