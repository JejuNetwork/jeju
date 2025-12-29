import { cors } from '@elysiajs/cors'
import {
  CORE_PORTS,
  getLocalhostHost,
  getNetworkName,
} from '@jejunetwork/config'
import { type CacheClient, getCacheClient } from '@jejunetwork/shared'
import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  getPageContent,
  listTopics,
  type SearchResult,
  searchDocumentation,
  type Topic,
} from '../lib/a2a'

const PORT = CORE_PORTS.DOCUMENTATION_A2A.get()
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_REQUESTS = 100

// Distributed cache for rate limiting
let rateLimitCache: CacheClient | null = null
function getRateLimitCache(): CacheClient {
  if (!rateLimitCache) {
    rateLimitCache = getCacheClient('docs-a2a-ratelimit')
  }
  return rateLimitCache
}

async function checkRateLimit(clientIp: string): Promise<boolean> {
  const now = Date.now()
  const cache = getRateLimitCache()
  const cacheKey = `docs-rl:${clientIp}`

  const cached = await cache.get(cacheKey)
  let entry: { count: number; resetTime: number } | null = cached
    ? JSON.parse(cached)
    : null

  if (!entry || now > entry.resetTime) {
    entry = { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS }
    await cache.set(
      cacheKey,
      JSON.stringify(entry),
      Math.ceil(RATE_LIMIT_WINDOW_MS / 1000),
    )
    return true
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false
  }

  entry.count++
  const ttl = Math.max(1, Math.ceil((entry.resetTime - now) / 1000))
  await cache.set(cacheKey, JSON.stringify(entry), ttl)
  return true
}

const ALLOWED_ORIGINS = (() => {
  const host = getLocalhostHost()
  return (
    process.env.ALLOWED_ORIGINS?.split(',') || [
      `http://${host}:${CORE_PORTS.DOCUMENTATION.DEFAULT}`,
      `http://${host}:3000`,
      'https://docs.jejunetwork.org',
      'https://jejunetwork.org',
    ]
  )
})()

const SkillParamsSchema = z.record(z.string(), z.string())

const SkillDataSchema = z.object({
  skillId: z.string(),
  params: SkillParamsSchema.optional(),
})

const A2AMessagePartSchema = z.object({
  kind: z.string(),
  text: z.string().optional(),
  data: SkillDataSchema.optional(),
})

const A2AMessageSchema = z.object({
  messageId: z.string(),
  parts: z.array(A2AMessagePartSchema),
})

const A2ARequestSchema = z.object({
  jsonrpc: z.string(),
  method: z.string(),
  params: z
    .object({
      message: A2AMessageSchema.optional(),
    })
    .optional(),
  id: z.union([z.number(), z.string()]),
})

interface SkillResult {
  message: string
  data: Record<string, string | number | SearchResult[] | Topic[]>
}

const AGENT_CARD = {
  protocolVersion: '0.3.0',
  name: `${getNetworkName()} Documentation`,
  description: 'Search and query the network documentation programmatically',
  url: `http://${getLocalhostHost()}:${PORT}/api/a2a`,
  preferredTransport: 'http',
  provider: { organization: 'the network', url: 'https://jejunetwork.org' },
  version: '1.0.0',
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: false,
  },
  defaultInputModes: ['text', 'data'],
  defaultOutputModes: ['text', 'data'],
  skills: [
    {
      id: 'search-docs',
      name: 'Search Documentation',
      description: 'Search documentation for keywords or topics',
      tags: ['query', 'search', 'documentation'],
      examples: ['Search for oracle', 'Find information about paymasters'],
    },
    {
      id: 'get-page',
      name: 'Get Documentation Page',
      description: 'Retrieve content of a specific documentation page',
      tags: ['query', 'documentation'],
      examples: ['Get contract documentation', 'Show deployment guide'],
    },
    {
      id: 'list-topics',
      name: 'List Documentation Topics',
      description: 'Get organized list of documentation topics',
      tags: ['query', 'navigation'],
      examples: ['List all topics', 'Documentation structure'],
    },
  ],
} as const

/** Validate documentation page path (no traversal allowed) */
function validateDocPath(pagePath: string): string {
  // Normalize and check for path traversal
  const normalized = pagePath.replace(/\\/g, '/').replace(/\/+/g, '/')

  if (normalized.includes('..') || normalized.startsWith('/')) {
    throw new Error('Invalid path: path traversal not allowed')
  }

  if (!normalized.endsWith('.md') && !normalized.endsWith('.mdx')) {
    throw new Error('Invalid path: only .md and .mdx files are allowed')
  }

  return normalized
}

async function executeSkill(
  skillId: string,
  params: Record<string, string>,
): Promise<SkillResult> {
  switch (skillId) {
    case 'search-docs': {
      const query = (params.query || '').toLowerCase()
      if (query.length > 200) {
        throw new Error('Query too long: maximum 200 characters')
      }
      const results = await searchDocumentation(query)
      return {
        message: `Found ${results.length} results for "${query}"`,
        data: { results, query },
      }
    }
    case 'get-page': {
      const pagePath = params.page || ''
      if (!pagePath) {
        throw new Error('Page parameter is required')
      }
      const safePath = validateDocPath(pagePath)
      const content = await getPageContent(safePath)
      if (!content) {
        throw new Error(`Page not found: ${pagePath}`)
      }
      return {
        message: `Retrieved ${pagePath}`,
        data: { page: pagePath, content },
      }
    }
    case 'list-topics': {
      const topics = await listTopics()
      return {
        message: `${topics.length} documentation topics`,
        data: { topics },
      }
    }
    default:
      throw new Error(`Unknown skill: ${skillId}`)
  }
}

export const app = new Elysia()
  .use(
    cors({
      origin: (request) => {
        const origin = request.headers.get('origin')
        if (!origin) return true
        return ALLOWED_ORIGINS.includes(origin)
      },
      credentials: true,
    }),
  )
  .derive(({ request, server }) => {
    const forwarded = request.headers.get('x-forwarded-for')
    const clientIp =
      forwarded || server?.requestIP(request)?.address || 'unknown'
    return { clientIp }
  })
  .onBeforeHandle(async ({ clientIp, set }) => {
    if (!(await checkRateLimit(clientIp))) {
      set.status = 429
      return { error: 'Too many requests' }
    }
    return undefined
  })
  .get('/.well-known/agent-card.json', () => AGENT_CARD)
  .post('/api/a2a', async ({ body, set }) => {
    const parseResult = A2ARequestSchema.safeParse(body)

    if (!parseResult.success) {
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid request format' },
      }
    }

    const { method, params, id } = parseResult.data
    const jsonRpcError = (code: number, message: string) => ({
      jsonrpc: '2.0',
      id,
      error: { code, message },
    })

    if (method !== 'message/send') {
      return jsonRpcError(-32601, 'Method not found')
    }

    const message = params?.message
    if (!message?.parts) {
      return jsonRpcError(-32602, 'Invalid params')
    }

    const dataPart = message.parts.find((p) => p.kind === 'data')
    if (!dataPart?.data) {
      return jsonRpcError(-32602, 'No data part found')
    }

    const skillId = dataPart.data.skillId
    const skillParams = dataPart.data.params ?? {}

    const result = await executeSkill(skillId, skillParams).catch(
      (err: Error) => {
        set.status = 200
        return { error: err.message }
      },
    )

    if ('error' in result) {
      return jsonRpcError(-32603, result.error)
    }

    return {
      jsonrpc: '2.0',
      id,
      result: {
        role: 'agent',
        parts: [
          { kind: 'text', text: result.message },
          { kind: 'data', data: result.data },
        ],
        messageId: message.messageId,
        kind: 'message',
      },
    }
  })
  .listen(PORT)
