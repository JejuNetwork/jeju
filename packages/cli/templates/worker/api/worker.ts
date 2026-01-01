/**
 * {{DISPLAY_NAME}} Worker
 *
 * A minimal Jeju Network worker with Elysia.
 * Compatible with workerd for production deployment.
 */

import { cors } from '@elysiajs/cors'
import { getCurrentNetwork, getLocalhostHost } from '@jejunetwork/config'
import { Elysia } from 'elysia'
import { z } from 'zod'

/**
 * Worker Environment
 */
export interface WorkerEnv {
  NETWORK: 'localnet' | 'testnet' | 'mainnet'
  RPC_URL: string
  SQLIT_NODES?: string
  SQLIT_DATABASE_ID?: string
}

/**
 * Create the Elysia app
 */
export function createApp(env?: Partial<WorkerEnv>) {
  const network = env?.NETWORK ?? getCurrentNetwork()
  const isDev = network === 'localnet'

  const app = new Elysia()
    .use(
      cors({
        origin: isDev ? true : ['https://jejunetwork.org'],
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
        credentials: true,
      }),
    )

    // Health check
    .get('/health', () => ({
      status: 'ok',
      service: '{{APP_NAME}}',
      version: '1.0.0',
      network,
      timestamp: Date.now(),
    }))

    // API routes
    .group('/api', (api) =>
      api
        // List items
        .get('/items', () => {
          return { items: [], total: 0 }
        })

        // Get item by ID
        .get('/items/:id', ({ params }) => {
          return { id: params.id, item: null }
        })

        // Create item
        .post('/items', async ({ body }) => {
          const schema = z.object({
            name: z.string().min(1),
            data: z.record(z.string(), z.unknown()).optional(),
          })

          const parsed = schema.safeParse(body)
          if (!parsed.success) {
            return { error: 'Invalid data', details: parsed.error.issues }
          }

          const id = crypto.randomUUID()
          return { success: true, id }
        })

        // Delete item
        .delete('/items/:id', ({ params }) => {
          return { success: true, id: params.id }
        }),
    )

  return app
}

// Create the default app
const app = createApp()

/**
 * Default export for workerd
 */
export default {
  fetch: app.fetch,
}

/**
 * Bun server entry point (local development)
 */
if (typeof Bun !== 'undefined') {
  const port = process.env.PORT ?? 8787
  const host = getLocalhostHost()

  console.log(`[{{APP_NAME}}] Starting on http://${host}:${port}`)
  console.log(`[{{APP_NAME}}] Network: ${getCurrentNetwork()}`)

  Bun.serve({
    port: Number(port),
    hostname: host,
    fetch: app.fetch,
  })
}
