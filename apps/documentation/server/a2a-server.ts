/**
 * A2A Server for network Documentation
 * Enables agents to search and query documentation programmatically
 *
 * This is a secondary server for the Documentation app, providing A2A protocol support.
 * The main docs site runs on CORE_PORTS.DOCUMENTATION (4004), while this A2A server
 * runs on CORE_PORTS.DOCUMENTATION_A2A (7778 by default).
 */

import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { cors } from '@elysiajs/cors'
import { getNetworkName } from '@jejunetwork/config'
import { CORE_PORTS } from '@jejunetwork/config/ports'
import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  DOCS_ROOT,
  listTopics,
  type SearchResult,
  searchDocumentation,
  type Topic,
} from '../lib/a2a'

const PORT = CORE_PORTS.DOCUMENTATION_A2A.get()
const MAX_FILE_SIZE_BYTES = 1024 * 1024 // 1MB max file size
const RATE_LIMIT_WINDOW_MS = 60 * 1000 // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100

const rateLimitMap = new Map<string, { count: number; resetTime: number }>()

function checkRateLimit(clientIp: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(clientIp)

  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(clientIp, {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW_MS,
    })
    return true
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false
  }

  entry.count++
  return true
}

setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitMap.entries()) {
    if (now > entry.resetTime) {
      rateLimitMap.delete(key)
    }
  }
}, RATE_LIMIT_WINDOW_MS)

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || [
  `http://localhost:${CORE_PORTS.DOCUMENTATION.DEFAULT}`, // Main docs site
  'http://localhost:3000', // Common dev server port
  'https://docs.jejunetwork.org',
  'https://jejunetwork.org',
]

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
  url: `http://localhost:${PORT}/api/a2a`,
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

/**
 * Validates that a file path is safe and within the documentation root.
 * Prevents path traversal attacks by:
 * 1. Resolving the full path
 * 2. Verifying it starts with DOCS_ROOT
 * 3. Only allowing .md files
 * 4. Resolving symlinks to prevent escaping via symlink chains
 * 5. Checking file size to prevent memory exhaustion
 */
async function validateDocPath(pagePath: string): Promise<string> {
  const normalizedPath = path.normalize(pagePath)

  if (normalizedPath.includes('..') || path.isAbsolute(normalizedPath)) {
    throw new Error('Invalid path: path traversal not allowed')
  }

  if (!normalizedPath.endsWith('.md') && !normalizedPath.endsWith('.mdx')) {
    throw new Error('Invalid path: only .md and .mdx files are allowed')
  }

  const fullPath = path.resolve(DOCS_ROOT, normalizedPath)
  if (!fullPath.startsWith(path.resolve(DOCS_ROOT))) {
    throw new Error('Invalid path: access denied')
  }

  const realPath = await realpath(fullPath)
  const realDocsRoot = await realpath(DOCS_ROOT)

  if (!realPath.startsWith(realDocsRoot)) {
    throw new Error('Invalid path: symlink escape not allowed')
  }

  const fileStat = await stat(realPath)
  if (fileStat.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `File too large: maximum size is ${MAX_FILE_SIZE_BYTES} bytes`,
    )
  }

  return realPath
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
      const safePath = await validateDocPath(pagePath)
      const content = await readFile(safePath, 'utf-8')
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

const _app = new Elysia()
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
  .onBeforeHandle(({ clientIp, set }) => {
    if (!checkRateLimit(clientIp)) {
      set.status = 429
      return { error: 'Too many requests' }
    }
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
        set.status = 200 // JSON-RPC errors still return 200
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
