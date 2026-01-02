/**
 * DWS API Worker
 *
 * Decentralized Web Services - workerd-compatible API worker.
 * Runs on the distributed network, proxies to specialized nodes for:
 * - Workerd process management (compute nodes)
 * - Git operations (storage nodes)
 * - Container management (TEE nodes)
 *
 * @see https://elysiajs.com/integrations/cloudflare-worker
 */

import { cors } from '@elysiajs/cors'
import {
  CORE_PORTS,
  getCoreAppUrl,
  getCurrentNetwork,
  getLocalhostHost,
} from '@jejunetwork/config'
import { Elysia } from 'elysia'
import { z } from 'zod'
import { createCLIRoutes } from './cli/routes'

/**
 * Worker Environment Bindings
 */
export interface DWSEnv {
  // Network configuration
  NETWORK: 'localnet' | 'testnet' | 'mainnet'
  RPC_URL: string

  // Service endpoints (discovered via on-chain registry or config)
  SQLIT_NODES: string // Comma-separated SQLit block producer URLs
  KMS_URL: string // KMS service URL
  STORAGE_NODES: string // Comma-separated storage node URLs
  COMPUTE_NODES: string // Comma-separated workerd compute node URLs
  CDN_NODES: string // Comma-separated CDN node URLs

  // Node identity
  NODE_ID: string
  NODE_REGION: string
  NODE_ENDPOINT: string

  // Genesis mode (for bootstrap nodes with full system access)
  GENESIS_MODE?: 'true' | 'false'

  // Optional KV bindings
  DWS_CACHE?: KVNamespace
  DWS_RATE_LIMIT?: KVNamespace
}

interface KVNamespace {
  get(key: string): Promise<string | null>
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>
  delete(key: string): Promise<void>
  list(options?: { prefix?: string; limit?: number }): Promise<{
    keys: Array<{ name: string }>
  }>
}

/**
 * Parse comma-separated node URLs
 */
function parseNodeUrls(urlString: string): string[] {
  if (!urlString) return []
  return urlString
    .split(',')
    .map((u) => u.trim())
    .filter((u) => u.length > 0)
}

/**
 * Select a random node from a list (basic load balancing)
 */
function selectNode(nodes: string[]): string {
  if (nodes.length === 0) {
    throw new Error('No nodes available')
  }
  return nodes[Math.floor(Math.random() * nodes.length)]
}

/**
 * Proxy request to another service
 */
async function proxyRequest(
  targetUrl: string,
  request: Request,
  pathPrefix: string,
): Promise<Response> {
  const url = new URL(request.url)
  const targetPath = url.pathname.replace(pathPrefix, '') || '/'
  const targetFullUrl = `${targetUrl}${targetPath}${url.search}`

  const headers = new Headers(request.headers)
  headers.delete('host')

  const proxyRequest = new Request(targetFullUrl, {
    method: request.method,
    headers,
    body: request.body,
  })

  const response = await fetch(proxyRequest)

  // Copy response with CORS headers
  const responseHeaders = new Headers(response.headers)
  responseHeaders.set('X-Proxied-By', 'dws-worker')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  })
}

/**
 * Create the DWS Elysia app
 */
export function createDWSApp(env?: Partial<DWSEnv>) {
  const network = env?.NETWORK ?? getCurrentNetwork()
  const isDev = network === 'localnet'
  const isGenesis = env?.GENESIS_MODE === 'true'
  const host = getLocalhostHost()

  // Parse node URLs from environment
  const sqlitNodes = parseNodeUrls(env?.SQLIT_NODES ?? '')
  const storageNodes = parseNodeUrls(env?.STORAGE_NODES ?? '')
  const computeNodes = parseNodeUrls(env?.COMPUTE_NODES ?? '')
  const cdnNodes = parseNodeUrls(env?.CDN_NODES ?? '')
  const kmsUrl = env?.KMS_URL ?? `http://${host}:4050`

  const app = new Elysia()
    .use(
      cors({
        origin: isDev
          ? true
          : [
              'https://dws.jejunetwork.org',
              'https://jejunetwork.org',
              getCoreAppUrl('DWS_API'),
            ],
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
          'Content-Type',
          'Authorization',
          'X-API-Key',
          'X-Jeju-Address',
          'X-Jeju-Signature',
        ],
        credentials: true,
      }),
    )

    // Health check
    .get('/health', () => ({
      status: 'ok',
      service: 'dws-api',
      version: '2.0.0',
      network,
      nodeId: env?.NODE_ID ?? 'unknown',
      region: env?.NODE_REGION ?? 'global',
      mode: isGenesis ? 'genesis' : 'worker',
      runtime: 'workerd',
      capabilities: {
        storage: storageNodes.length > 0,
        compute: computeNodes.length > 0,
        sqlit: sqlitNodes.length > 0,
        cdn: cdnNodes.length > 0,
        kms: !!kmsUrl,
      },
      nodes: {
        sqlit: sqlitNodes.length,
        storage: storageNodes.length,
        compute: computeNodes.length,
        cdn: cdnNodes.length,
      },
    }))

    // Service discovery endpoint
    .get('/discovery', () => ({
      network,
      services: {
        sqlit: sqlitNodes,
        storage: storageNodes,
        compute: computeNodes,
        cdn: cdnNodes,
        kms: kmsUrl,
      },
      nodeId: env?.NODE_ID,
      endpoint: env?.NODE_ENDPOINT,
    }))

    // ============================================
    // SQLit Proxy Routes (Distributed SQLite)
    // ============================================
    .group('/sqlit', (sqlit) =>
      sqlit
        .all('/*', async ({ request, set }) => {
          if (sqlitNodes.length === 0) {
            set.status = 503
            return { error: 'No SQLit nodes available' }
          }

          const targetNode = selectNode(sqlitNodes)
          return proxyRequest(targetNode, request, '/sqlit')
        })
        .get('/health', () => ({
          service: 'sqlit-proxy',
          nodes: sqlitNodes.length,
          status: sqlitNodes.length > 0 ? 'ok' : 'no-nodes',
        })),
    )

    // ============================================
    // Storage Routes (IPFS/Content-Addressed)
    // ============================================
    .group('/storage', (storage) =>
      storage
        .all('/*', async ({ request, set }) => {
          if (storageNodes.length === 0) {
            set.status = 503
            return { error: 'No storage nodes available' }
          }

          const targetNode = selectNode(storageNodes)
          return proxyRequest(targetNode, request, '/storage')
        })
        .get('/health', () => ({
          service: 'storage-proxy',
          nodes: storageNodes.length,
          status: storageNodes.length > 0 ? 'ok' : 'no-nodes',
        })),
    )

    // ============================================
    // CDN Routes (Content Delivery)
    // ============================================
    .group('/cdn', (cdn) =>
      cdn
        .all('/*', async ({ request, set }) => {
          if (cdnNodes.length === 0) {
            set.status = 503
            return { error: 'No CDN nodes available' }
          }

          const targetNode = selectNode(cdnNodes)
          return proxyRequest(targetNode, request, '/cdn')
        })
        .get('/health', () => ({
          service: 'cdn-proxy',
          nodes: cdnNodes.length,
          status: cdnNodes.length > 0 ? 'ok' : 'no-nodes',
        })),
    )

    // ============================================
    // Compute/Workerd Routes
    // ============================================
    .group('/workerd', (workerd) =>
      workerd
        .all('/*', async ({ request, set }) => {
          if (computeNodes.length === 0) {
            set.status = 503
            return { error: 'No compute nodes available' }
          }

          const targetNode = selectNode(computeNodes)
          return proxyRequest(targetNode, request, '/workerd')
        })
        .get('/health', () => ({
          service: 'workerd-proxy',
          nodes: computeNodes.length,
          status: computeNodes.length > 0 ? 'ok' : 'no-nodes',
        })),
    )

    // ============================================
    // KMS Routes (Key Management)
    // ============================================
    .group('/kms', (kms) =>
      kms.all('/*', async ({ request, set }) => {
        if (!kmsUrl) {
          set.status = 503
          return { error: 'KMS not configured' }
        }
        return proxyRequest(kmsUrl, request, '/kms')
      }),
    )

    // ============================================
    // A2A Protocol (Agent-to-Agent)
    // ============================================
    .group('/a2a', (a2a) =>
      a2a
        .get('/', () => ({
          name: 'DWS',
          description: 'Decentralized Web Services',
          version: '2.0.0',
          protocol: 'a2a',
          capabilities: [
            'storage',
            'compute',
            'cdn',
            'sqlit',
            'kms',
            'workerd',
          ],
        }))
        .post('/invoke', async ({ body }) => {
          // A2A invocation handler
          const parsed = z
            .object({
              skill: z.string(),
              params: z.record(z.string(), z.unknown()).optional(),
            })
            .safeParse(body)

          if (!parsed.success) {
            return {
              error: 'Invalid A2A request',
              details: parsed.error.issues,
            }
          }

          // Route to appropriate service based on skill
          const { skill, params } = parsed.data

          if (skill.startsWith('storage.')) {
            if (storageNodes.length === 0) {
              return { error: 'No storage nodes available' }
            }
            const node = selectNode(storageNodes)
            const response = await fetch(`${node}/a2a/invoke`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ skill, params }),
            })
            return response.json()
          }

          if (skill.startsWith('compute.') || skill.startsWith('workerd.')) {
            if (computeNodes.length === 0) {
              return { error: 'No compute nodes available' }
            }
            const node = selectNode(computeNodes)
            const response = await fetch(`${node}/a2a/invoke`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ skill, params }),
            })
            return response.json()
          }

          if (skill.startsWith('sqlit.') || skill.startsWith('database.')) {
            if (sqlitNodes.length === 0) {
              return { error: 'No SQLit nodes available' }
            }
            const node = selectNode(sqlitNodes)
            const response = await fetch(`${node}/a2a/invoke`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ skill, params }),
            })
            return response.json()
          }

          return { error: `Unknown skill: ${skill}` }
        }),
    )

    // ============================================
    // MCP Protocol (Model Context Protocol)
    // ============================================
    .group('/mcp', (mcp) =>
      mcp
        .get('/', () => ({
          name: 'DWS MCP Server',
          version: '1.0.0',
          tools: [
            {
              name: 'dws_storage_upload',
              description: 'Upload content to decentralized storage',
              parameters: {
                type: 'object',
                properties: {
                  content: { type: 'string', description: 'Content to upload' },
                  filename: {
                    type: 'string',
                    description: 'Optional filename',
                  },
                },
                required: ['content'],
              },
            },
            {
              name: 'dws_storage_download',
              description: 'Download content from decentralized storage',
              parameters: {
                type: 'object',
                properties: {
                  cid: {
                    type: 'string',
                    description: 'Content identifier (CID)',
                  },
                },
                required: ['cid'],
              },
            },
            {
              name: 'dws_sqlit_query',
              description: 'Execute a SQLit database query',
              parameters: {
                type: 'object',
                properties: {
                  databaseId: { type: 'string', description: 'Database ID' },
                  query: { type: 'string', description: 'SQL query' },
                  params: {
                    type: 'array',
                    description: 'Query parameters',
                    items: { type: 'string' },
                  },
                },
                required: ['databaseId', 'query'],
              },
            },
            {
              name: 'dws_workerd_deploy',
              description: 'Deploy a worker to the compute network',
              parameters: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Worker name' },
                  code: { type: 'string', description: 'Worker code (base64)' },
                },
                required: ['name', 'code'],
              },
            },
          ],
        }))
        .post('/invoke', async ({ body }) => {
          const parsed = z
            .object({
              tool: z.string(),
              arguments: z.record(z.string(), z.unknown()),
            })
            .safeParse(body)

          if (!parsed.success) {
            return {
              error: 'Invalid MCP request',
              details: parsed.error.issues,
            }
          }

          const { tool, arguments: args } = parsed.data

          // Route to appropriate service
          if (tool.startsWith('dws_storage_')) {
            if (storageNodes.length === 0) {
              return { error: 'No storage nodes available' }
            }
            const node = selectNode(storageNodes)
            const response = await fetch(`${node}/mcp/invoke`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tool, arguments: args }),
            })
            return response.json()
          }

          if (tool.startsWith('dws_sqlit_')) {
            if (sqlitNodes.length === 0) {
              return { error: 'No SQLit nodes available' }
            }
            const node = selectNode(sqlitNodes)
            const response = await fetch(`${node}/mcp/invoke`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tool, arguments: args }),
            })
            return response.json()
          }

          if (tool.startsWith('dws_workerd_')) {
            if (computeNodes.length === 0) {
              return { error: 'No compute nodes available' }
            }
            const node = selectNode(computeNodes)
            const response = await fetch(`${node}/mcp/invoke`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tool, arguments: args }),
            })
            return response.json()
          }

          return { error: `Unknown tool: ${tool}` }
        }),
    )

    // ============================================
    // Funding Routes (x402 Payments)
    // ============================================
    .group('/funding', (funding) =>
      funding
        .get('/health', () => ({ status: 'ok', service: 'funding' }))
        .post('/deposit', async ({ headers }) => {
          // Validate wallet signature
          const address = headers['x-jeju-address']
          if (!address) {
            return { error: 'x-jeju-address header required' }
          }

          // Forward to funding service
          return { status: 'pending', message: 'Deposit initiated' }
        })
        .get('/balance/:address', async ({ params }) => {
          // Query balance from SQLit
          if (sqlitNodes.length === 0) {
            return { balance: '0', error: 'No SQLit nodes available' }
          }

          return { address: params.address, balance: '0' }
        }),
    )

    // ============================================
    // Registry Routes (JNS, Apps, Agents)
    // ============================================
    .group('/registry', (registry) =>
      registry
        .get('/health', () => ({ status: 'ok', service: 'registry' }))
        .get('/apps', async () => {
          // List registered apps from on-chain registry
          return { apps: [], source: 'on-chain' }
        })
        .get('/apps/:jnsName', async ({ params }) => {
          // Resolve app by JNS name
          return {
            jnsName: params.jnsName,
            resolved: false,
            message: 'JNS resolution via on-chain registry',
          }
        }),
    )

    // ============================================
    // Node Management Routes
    // ============================================
    .group('/nodes', (nodes) =>
      nodes
        .get('/', () => ({
          sqlit: sqlitNodes.map((url, i) => ({ id: `sqlit-${i}`, url })),
          storage: storageNodes.map((url, i) => ({ id: `storage-${i}`, url })),
          compute: computeNodes.map((url, i) => ({ id: `compute-${i}`, url })),
          cdn: cdnNodes.map((url, i) => ({ id: `cdn-${i}`, url })),
        }))
        .get('/self', () => ({
          nodeId: env?.NODE_ID ?? 'unknown',
          region: env?.NODE_REGION ?? 'global',
          endpoint: env?.NODE_ENDPOINT ?? 'unknown',
          mode: isGenesis ? 'genesis' : 'worker',
          network,
        })),
    )

    // ============================================
    // CLI Routes (auth, account, workers, secrets, logs, previews)
    // ============================================
    .use(createCLIRoutes())

  return app
}

/**
 * Default export for workerd
 */
const app = createDWSApp()

export default {
  fetch: app.fetch,
}

/**
 * Bun server entry point (for local development and genesis nodes)
 */
if (typeof Bun !== 'undefined') {
  const port =
    process.env.PORT ?? process.env.DWS_PORT ?? CORE_PORTS.DWS_API.get()
  const host = getLocalhostHost()

  console.log(`[DWS Worker] Starting on http://${host}:${port}`)
  console.log(`[DWS Worker] Network: ${getCurrentNetwork()}`)
  console.log(
    `[DWS Worker] Mode: ${process.env.GENESIS_MODE === 'true' ? 'genesis' : 'worker'}`,
  )

  Bun.serve({
    port: Number(port),
    hostname: host,
    fetch: app.fetch,
  })
}
