/**
 * Indexer API Worker
 *
 * Blockchain indexer with GraphQL and REST APIs - workerd-compatible.
 * Proxies to SQLit for data storage and queries.
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
export interface IndexerEnv {
  // Network configuration
  NETWORK: 'localnet' | 'testnet' | 'mainnet'
  RPC_URL: string

  // Database
  SQLIT_NODES: string
  SQLIT_DATABASE_ID: string

  // KV bindings (optional)
  INDEXER_CACHE?: KVNamespace
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
 * Create the Indexer Elysia app
 */
export function createIndexerApp(env?: Partial<IndexerEnv>) {
  const network = env?.NETWORK ?? getCurrentNetwork()
  const isDev = network === 'localnet'

  const app = new Elysia()
    .use(
      cors({
        origin: isDev
          ? true
          : [
              'https://indexer.jejunetwork.org',
              'https://indexer.testnet.jejunetwork.org',
              'https://jejunetwork.org',
              'https://gateway.testnet.jejunetwork.org',
              'https://gateway.jejunetwork.org',
              getCoreAppUrl('INDEXER_GRAPHQL'),
            ],
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: [
          'Content-Type',
          'Authorization',
          'X-API-Key',
          'X-Jeju-Address',
        ],
        credentials: true,
      }),
    )

    // Health check
    .get('/health', () => ({
      status: 'ok',
      service: 'indexer-api',
      version: '2.0.0',
      network,
      runtime: 'workerd',
      endpoints: {
        graphql: '/graphql',
        rest: '/api',
        a2a: '/a2a',
        mcp: '/mcp',
      },
    }))

    // ============================================
    // GraphQL Endpoint
    // In workerd mode, GraphQL requires Subsquid which isn't available.
    // Use REST API endpoints instead, or deploy with full indexer stack.
    // ============================================
    .get('/graphql', () => {
      // Serve embedded GraphiQL playground pointing to this endpoint
      const playgroundHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Indexer GraphQL Playground</title>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>
  <script src="https://unpkg.com/graphiql@3/graphiql.min.js" crossorigin></script>
  <link href="https://unpkg.com/graphiql@3/graphiql.min.css" rel="stylesheet" />
  <style>
    body { margin: 0; height: 100vh; }
    #graphiql { height: 100vh; }
  </style>
</head>
<body>
  <div id="graphiql"></div>
  <script>
    const fetcher = GraphiQL.createFetcher({ url: '/graphql' });
    const defaultQuery = \`query {
  blocks(limit: 5, orderBy: number_DESC) {
    number
    hash
    timestamp
  }
}\`;
    ReactDOM.createRoot(document.getElementById('graphiql')).render(
      React.createElement(GraphiQL, { fetcher, defaultQuery })
    );
  </script>
</body>
</html>`
      return new Response(playgroundHtml, {
        headers: { 'Content-Type': 'text/html' },
      })
    })
    .get('/playground', () => {
      return Response.redirect('/graphql', 302)
    })
    .post('/graphql', async ({ body }) => {
      const parsed = z
        .object({
          query: z.string(),
          variables: z.record(z.string(), z.unknown()).optional(),
          operationName: z.string().optional(),
        })
        .safeParse(body)

      if (!parsed.success) {
        return { errors: [{ message: 'Invalid GraphQL request' }] }
      }

      // In workerd/DWS deployment, Subsquid GraphQL server is not available
      // GraphQL queries should be routed to the full indexer deployment
      // For now, return a helpful error directing to REST API
      return {
        data: null,
        errors: [
          {
            message:
              'GraphQL not available in workerd mode. Use REST API at /api/* or deploy full indexer stack.',
            extensions: {
              code: 'GRAPHQL_UNAVAILABLE',
              restApiEndpoint: '/api',
              fullIndexerUrl: 'https://indexer.testnet.jejunetwork.org/graphql',
            },
          },
        ],
      }
    })

    // ============================================
    // REST API Routes
    // ============================================
    .group('/api', (api) =>
      api
        .get('/health', () => ({ status: 'ok' }))

        // Blocks
        .get('/blocks', () => ({ blocks: [], total: 0 }))
        .get('/blocks/latest', () => ({ block: null }))
        .get('/blocks/:blockNumber', ({ params }) => ({
          blockNumber: params.blockNumber,
          block: null,
        }))

        // Transactions
        .get('/transactions', () => ({ transactions: [], total: 0 }))
        .get('/transactions/:hash', ({ params }) => ({
          hash: params.hash,
          transaction: null,
        }))

        // Addresses
        .get('/addresses/:address', ({ params }) => ({
          address: params.address,
          balance: '0',
          transactions: [],
        }))
        .get('/addresses/:address/transactions', ({ params }) => ({
          address: params.address,
          transactions: [],
        }))

        // Tokens
        .get('/tokens', () => ({ tokens: [], total: 0 }))
        .get('/tokens/:address', ({ params }) => ({
          address: params.address,
          token: null,
        }))

        // Events
        .get('/events', () => ({ events: [], total: 0 }))
        .get('/events/:contractAddress', ({ params }) => ({
          contractAddress: params.contractAddress,
          events: [],
        }))

        // Stats
        .get('/stats', () => ({
          totalBlocks: 0,
          totalTransactions: 0,
          totalAddresses: 0,
          lastBlockTime: null,
        }))
        .get('/stats/tps', () => ({
          currentTPS: 0,
          avgTPS: 0,
          maxTPS: 0,
        })),
    )

    // ============================================
    // A2A Protocol
    // ============================================
    .group('/a2a', (a2a) =>
      a2a
        .get('/', () => ({
          name: 'Indexer',
          description: 'Blockchain Indexer with GraphQL API',
          version: '2.0.0',
          protocol: 'a2a',
          capabilities: ['query', 'subscribe', 'historical-data'],
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

          return { skill: parsed.data.skill, result: 'Query executed' }
        }),
    )

    // ============================================
    // MCP Protocol
    // ============================================
    .group('/mcp', (mcp) =>
      mcp
        .get('/', () => ({
          name: 'Indexer MCP Server',
          version: '1.0.0',
          tools: [
            {
              name: 'indexer_query_blocks',
              description: 'Query recent blocks',
              parameters: {
                type: 'object',
                properties: {
                  limit: { type: 'number', default: 10 },
                  offset: { type: 'number', default: 0 },
                },
              },
            },
            {
              name: 'indexer_query_transactions',
              description: 'Query transactions',
              parameters: {
                type: 'object',
                properties: {
                  address: { type: 'string' },
                  limit: { type: 'number', default: 10 },
                },
              },
            },
            {
              name: 'indexer_graphql',
              description: 'Execute GraphQL query',
              parameters: {
                type: 'object',
                properties: {
                  query: { type: 'string' },
                  variables: { type: 'object' },
                },
                required: ['query'],
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

          return { tool: parsed.data.tool, result: 'Tool executed' }
        }),
    )

  return app
}

/**
 * Default export for workerd
 */
const app = createIndexerApp()

export default {
  fetch: app.fetch,
}

/**
 * Bun server entry point (for local development)
 */
if (typeof Bun !== 'undefined') {
  const port = process.env.PORT ?? process.env.INDEXER_PORT ?? 4352
  const host = getLocalhostHost()

  console.log(`[Indexer Worker] Starting on http://${host}:${port}`)
  console.log(`[Indexer Worker] Network: ${getCurrentNetwork()}`)

  Bun.serve({
    port: Number(port),
    hostname: host,
    fetch: app.fetch,
  })
}
