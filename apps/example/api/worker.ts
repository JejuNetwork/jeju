/**
 * Example App Worker
 *
 * Production-ready template for Jeju Network apps - workerd-compatible.
 * Demonstrates SQLit, IPFS storage, KMS, Cron, JNS, A2A, MCP, x402, OAuth3.
 *
 * @see https://elysiajs.com/integrations/cloudflare-worker
 */

import { cors } from '@elysiajs/cors'
import {
  getCoreAppUrl,
  getCurrentNetwork,
  getLocalhostHost,
} from '@jejunetwork/config'
import { Elysia } from 'elysia'
import { z } from 'zod'

/**
 * Worker Environment Types
 */
export interface ExampleEnv {
  // Network configuration
  NETWORK: 'localnet' | 'testnet' | 'mainnet'
  RPC_URL: string

  // Service URLs
  DWS_URL: string
  KMS_URL: string

  // Database
  SQLIT_NODES: string
  SQLIT_DATABASE_ID: string

  // KV bindings (optional)
  EXAMPLE_CACHE?: KVNamespace
}

interface KVNamespace {
  get(key: string): Promise<string | null>
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>
  delete(key: string): Promise<void>
}

/**
 * Create the Example Elysia app
 */
export function createExampleApp(env?: Partial<ExampleEnv>) {
  const network = env?.NETWORK ?? getCurrentNetwork()
  const isDev = network === 'localnet'

  const app = new Elysia()
    .use(
      cors({
        origin: isDev
          ? true
          : [
              'https://example.jejunetwork.org',
              'https://jejunetwork.org',
              getCoreAppUrl('EXAMPLE'),
            ],
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
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
      service: 'example-api',
      version: '1.0.0',
      network,
      runtime: 'workerd',
      features: [
        'sqlit',
        'storage',
        'kms',
        'cron',
        'jns',
        'a2a',
        'mcp',
        'x402',
        'oauth3',
      ],
    }))

    // ============================================
    // REST API Routes
    // ============================================
    .group('/api', (api) =>
      api
        .get('/health', () => ({ status: 'ok' }))

        // Items CRUD (example resource)
        .get('/items', () => ({ items: [], total: 0 }))
        .get('/items/:id', ({ params }) => ({
          id: params.id,
          item: null,
        }))
        .post('/items', async ({ body }) => {
          const parsed = z
            .object({
              name: z.string(),
              description: z.string().optional(),
              data: z.record(z.string(), z.unknown()).optional(),
            })
            .safeParse(body)

          if (!parsed.success) {
            return { error: 'Invalid item data', details: parsed.error.issues }
          }

          return { success: true, id: crypto.randomUUID() }
        })
        .put('/items/:id', async ({ params, body }) => {
          const parsed = z
            .object({
              name: z.string().optional(),
              description: z.string().optional(),
              data: z.record(z.string(), z.unknown()).optional(),
            })
            .safeParse(body)

          if (!parsed.success) {
            return {
              error: 'Invalid update data',
              details: parsed.error.issues,
            }
          }

          return { success: true, id: params.id }
        })
        .delete('/items/:id', ({ params }) => ({
          success: true,
          id: params.id,
        })),
    )

    // ============================================
    // Storage Routes (IPFS via DWS)
    // ============================================
    .group('/storage', (storage) =>
      storage
        .post('/upload', async () => {
          // Upload to DWS storage
          return {
            cid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
          }
        })
        .get('/:cid', ({ params }) => ({
          cid: params.cid,
          message: 'Download from DWS storage',
        })),
    )

    // ============================================
    // KMS Routes (Encryption)
    // ============================================
    .group('/kms', (kms) =>
      kms
        .post('/encrypt', async ({ body }) => {
          const parsed = z.object({ data: z.string() }).safeParse(body)
          if (!parsed.success) {
            return { error: 'Invalid data' }
          }
          return { encrypted: 'base64-encrypted-data' }
        })
        .post('/decrypt', async ({ body }) => {
          const parsed = z.object({ encrypted: z.string() }).safeParse(body)
          if (!parsed.success) {
            return { error: 'Invalid encrypted data' }
          }
          return { decrypted: 'original-data' }
        }),
    )

    // ============================================
    // Cron Routes (Scheduled Tasks)
    // ============================================
    .group('/cron', (cron) =>
      cron
        .post('/cleanup', () => ({
          status: 'executed',
          message: 'Cleanup completed',
        }))
        .post('/reminders', () => ({
          status: 'executed',
          message: 'Reminders sent',
        }))
        .post('/sync', () => ({
          status: 'executed',
          message: 'Sync completed',
        })),
    )

    // ============================================
    // x402 Payment Routes
    // ============================================
    .group('/x402', (x402) =>
      x402
        .get('/balance', () => ({ balance: '0' }))
        .post('/deposit', async ({ headers }) => {
          const address = headers['x-jeju-address']
          if (!address) {
            return { error: 'x-jeju-address header required' }
          }
          return { status: 'pending', message: 'Deposit initiated' }
        }),
    )

    // ============================================
    // A2A Protocol
    // ============================================
    .group('/a2a', (a2a) =>
      a2a
        .get('/', () => ({
          name: 'Example App',
          description: 'Template app for Jeju Network',
          version: '1.0.0',
          protocol: 'a2a',
          capabilities: ['crud', 'storage', 'kms', 'cron', 'x402'],
        }))
        .post('/invoke', async ({ body }) => {
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

          return { skill: parsed.data.skill, result: 'Skill executed' }
        }),
    )

    // ============================================
    // MCP Protocol
    // ============================================
    .group('/mcp', (mcp) =>
      mcp
        .get('/', () => ({
          name: 'Example MCP Server',
          version: '1.0.0',
          tools: [
            {
              name: 'example_create_item',
              description: 'Create a new item',
              parameters: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                },
                required: ['name'],
              },
            },
            {
              name: 'example_list_items',
              description: 'List all items',
              parameters: { type: 'object', properties: {} },
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

          return { tool: parsed.data.tool, result: 'Tool executed' }
        }),
    )

  return app
}

/**
 * Default export for workerd
 */
const app = createExampleApp()

export default {
  fetch: app.fetch,
}

/**
 * Bun server entry point (for local development)
 */
if (typeof Bun !== 'undefined') {
  const port = process.env.PORT ?? process.env.EXAMPLE_PORT ?? 4500
  const host = getLocalhostHost()

  console.log(`[Example Worker] Starting on http://${host}:${port}`)
  console.log(`[Example Worker] Network: ${getCurrentNetwork()}`)

  Bun.serve({
    port: Number(port),
    hostname: host,
    fetch: app.fetch,
  })
}
