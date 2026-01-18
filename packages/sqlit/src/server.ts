/**
 * SQLit v2 HTTP Server
 *
 * Exposes the SQLit node as an HTTP/WebSocket service for:
 * - Query execution (compatible with v1 API)
 * - Database management
 * - Replication sync
 * - Health checks
 */

// @ts-nocheck - Temporary: Elysia handler type inference issues with destructured params
// TODO: Convert to proper Elysia schema validation with t.Object()
import { cors } from '@elysiajs/cors'
import { Elysia, t } from 'elysia'
import { SQLitNode } from './node'
import type {
  CreateDatabaseRequest,
  ExecuteRequest,
  SQLitNodeConfig,
  SQLitServiceConfig,
  WALSyncRequest,
} from './types'
import { SQLitError } from './types'

const DEFAULT_PORT = 8546

export interface SQLitServerConfig {
  port: number
  host: string
  nodeConfig: SQLitNodeConfig
  serviceConfig?: Partial<SQLitServiceConfig>
}

/**
 * Create and start SQLit v2 HTTP server
 */
export async function createSQLitServer(config: SQLitServerConfig) {
  const node = new SQLitNode(config.nodeConfig, config.serviceConfig)

  // Error handler
  const handleError = (error: unknown) => {
    if (error instanceof SQLitError) {
      return {
        success: false,
        status: 'error',
        error: error.message,
        code: error.code,
        details: error.details,
      }
    }
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      status: 'error',
      error: message,
    }
  }

  // Helper to serialize BigInt values in objects
  const serializeDatabase = (db: import('./types').DatabaseInstance) => ({
    ...db,
    sizeBytes: db.sizeBytes.toString(),
    rowCount: db.rowCount.toString(),
    walPosition: db.walPosition.toString(),
  })

  // Helper to serialize query results
  const serializeQueryResult = (result: import('./types').ExecuteResponse) => ({
    ...result,
    walPosition: (result.walPosition ?? BigInt(0)).toString(),
    lastInsertId: result.lastInsertId.toString(),
  })

  // Helper to serialize batch results
  const serializeBatchResult = (
    result: import('./types').BatchExecuteResponse,
  ) => ({
    ...result,
    walPosition: result.walPosition.toString(),
    results: result.results.map((r) => ({
      ...r,
      walPosition: (r.walPosition ?? BigInt(0)).toString(),
      lastInsertId: r.lastInsertId.toString(),
    })),
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app = new Elysia()
    .use(cors() as any)

    // ============ Health & Status ============

    .get('/', () => ({ success: true, version: 'v2' }))

    .get('/health', () => ({
      success: true,
      status: 'healthy',
      node: {
        nodeId: node.getNodeInfo().nodeId,
        role: node.getNodeInfo().role,
        status: node.getNodeInfo().status,
        databaseCount: node.getNodeInfo().databaseCount,
      },
    }))

    .get('/v1/status', () => ({
      success: true,
      status: 'ok',
      blockHeight: 1,
      databases: node.listDatabases().length,
    }))

    .get('/v2/node', () => ({
      success: true,
      node: node.getNodeInfo(),
    }))

    // ============ V1 Compatible Query API ============

    .post(
      '/v1/query',
      async (context) => {
        const body = context.body
        try {
          const database = body.database ?? 'default'
          const sql = body.query ?? body.sql

          if (!sql) {
            return {
              success: false,
              status: 'error',
              error: 'No query provided',
            }
          }

          const result = await node.execute({
            databaseId: database,
            sql,
            params: body.args as
              | (string | number | boolean | null | bigint)[]
              | undefined,
          })

          // V1 compatible response format
          return {
            success: true,
            status: 'ok',
            data: {
              rows: result.rows,
            },
          }
        } catch (error) {
          return handleError(error)
        }
      },
      {
        body: t.Object({
          database: t.Optional(t.String()),
          query: t.Optional(t.String()),
          sql: t.Optional(t.String()),
          args: t.Optional(t.Array(t.Any())),
          assoc: t.Optional(t.Boolean()),
        }),
      },
    )

    .post(
      '/v1/exec',
      async (context) => {
        const body = context.body
        try {
          const database = body.database ?? 'default'
          const sql = body.query ?? body.sql

          if (!sql) {
            return {
              success: false,
              status: 'error',
              error: 'No query provided',
            }
          }

          const result = await node.execute({
            databaseId: database,
            sql,
            params: body.args as
              | (string | number | boolean | null | bigint)[]
              | undefined,
          })

          return {
            success: true,
            status: 'ok',
            data: {
              last_insert_id: Number(result.lastInsertId),
              affected_rows: result.rowsAffected,
            },
          }
        } catch (error) {
          return handleError(error)
        }
      },
      {
        body: t.Object({
          database: t.Optional(t.String()),
          query: t.Optional(t.String()),
          sql: t.Optional(t.String()),
          args: t.Optional(t.Array(t.Any())),
        }),
      },
    )

    // ============ V2 Query API ============

    .post('/v2/execute', async (context) => {
      const body = context.body
      try {
        const reqBody = body as {
          databaseId: string
          sql: string
          params?: (string | number | boolean | null | bigint)[]
          queryType?: string
          requiredWalPosition?: string
          signature?: string
          timestamp?: number
        }
        const request: ExecuteRequest = {
          databaseId: reqBody.databaseId,
          sql: reqBody.sql,
          params: reqBody.params,
          queryType: reqBody.queryType as 'read' | 'write' | 'ddl' | undefined,
          requiredWalPosition: reqBody.requiredWalPosition
            ? BigInt(reqBody.requiredWalPosition)
            : undefined,
          signature: reqBody.signature as `0x${string}` | undefined,
          timestamp: reqBody.timestamp,
        }
        const result = await node.execute(request)
        const serialized = serializeQueryResult(result)
        return { ...serialized, success: true }
      } catch (error) {
        return handleError(error)
      }
    })

    .post('/v2/batch', async (context) => {
      const body = context.body
      try {
        const reqBody = body as {
          databaseId: string
          queries: Array<{
            sql: string
            params?: (string | number | boolean | null | bigint)[]
          }>
          transactional: boolean
        }
        const result = await node.batchExecute(reqBody)
        const serialized = serializeBatchResult(result)
        return { ...serialized, success: true }
      } catch (error) {
        return handleError(error)
      }
    })

    // ============ Database Management ============

    .get('/v2/databases', () => ({
      success: true,
      databases: node.listDatabases().map(serializeDatabase),
    }))

    .get('/v2/databases/:id', (context) => {
      const params = context.params
      const db = node.getDatabase(params.id)
      if (!db) {
        return { success: false, error: 'Database not found' }
      }
      return { success: true, database: serializeDatabase(db) }
    })

    .post(
      '/v2/databases',
      async (context) => {
        const body = context.body
        try {
          const result = await node.createDatabase(
            body as CreateDatabaseRequest,
          )
          return { success: true, ...result }
        } catch (error) {
          return handleError(error)
        }
      },
      {
        body: t.Object({
          name: t.String(),
          databaseId: t.Optional(t.String()),
          encryptionMode: t.Optional(
            t.Union([
              t.Literal('none'),
              t.Literal('at_rest'),
              t.Literal('tee_encrypted'),
            ]),
          ),
          replication: t.Optional(
            t.Object({
              replicaCount: t.Optional(t.Number()),
              maxLagMs: t.Optional(t.Number()),
              preferredRegions: t.Optional(t.Array(t.String())),
              syncReplication: t.Optional(t.Boolean()),
              readConsistency: t.Optional(t.String()),
            }),
          ),
          schema: t.Optional(t.String()),
        }),
      },
    )

    .delete('/v2/databases/:id', async (context) => {
      const params = context.params
      try {
        await node.deleteDatabase(params.id)
        return { success: true }
      } catch (error) {
        return handleError(error)
      }
    })

    // ============ V1 Admin API (backwards compatible) ============

    .post('/v1/admin/create', async (context) => {
      const query = context.query
      try {
        const nodeCount = parseInt(query.node ?? '1', 10)
        const result = await node.createDatabase({
          name: `db_${Date.now()}`,
          encryptionMode: 'none',
          replication: { replicaCount: Math.max(1, nodeCount - 1) },
        })
        return {
          success: true,
          status: 'created',
          data: { database: result.databaseId },
        }
      } catch (error) {
        return handleError(error)
      }
    })

    .delete('/v1/admin/drop', async (context) => {
      const query = context.query
      try {
        const database = query.database
        if (!database) {
          return {
            success: false,
            status: 'error',
            error: 'No database specified',
          }
        }
        await node.deleteDatabase(database)
        return { success: true, status: 'ok' }
      } catch (error) {
        return handleError(error)
      }
    })

    // ============ Replication API ============

    .post(
      '/v2/wal/sync',
      (context) => {
        const body = context.body
        try {
          const request: WALSyncRequest = {
            databaseId: body.databaseId,
            fromPosition: BigInt(body.fromPosition),
            toPosition: body.toPosition ? BigInt(body.toPosition) : undefined,
            limit: body.limit ?? 1000,
          }
          const result = node.getWALEntries(request)

          // Serialize bigints for JSON
          return {
            success: true,
            entries: result.entries.map((e) => ({
              ...e,
              position: e.position.toString(),
            })),
            hasMore: result.hasMore,
            currentPosition: result.currentPosition.toString(),
          }
        } catch (error) {
          return handleError(error)
        }
      },
      {
        body: t.Object({
          databaseId: t.String(),
          fromPosition: t.String(),
          toPosition: t.Optional(t.String()),
          limit: t.Optional(t.Number()),
        }),
      },
    )

    .get('/v2/replication/:databaseId', (context) => {
      const params = context.params
      try {
        const status = node.getReplicationStatus(params.databaseId)
        const statusArray = Array.from(status.entries()).map(([_, s]) => ({
          ...s,
          walPosition: s.walPosition.toString(),
        }))
        return { success: true, replication: statusArray }
      } catch (error) {
        return handleError(error)
      }
    })

    // ============ Query by database path ============

    .post(
      '/v2/:databaseId/query',
      async (context) => {
        const params = context.params
        const body = context.body
        try {
          const result = await node.execute({
            databaseId: params.databaseId,
            sql: body.sql,
            params: body.params as
              | (string | number | boolean | null | bigint)[]
              | undefined,
          })
          const serialized = serializeQueryResult(result)
          return { ...serialized, success: true }
        } catch (error) {
          return handleError(error)
        }
      },
      {
        body: t.Object({
          sql: t.String(),
          params: t.Optional(t.Array(t.Any())),
        }),
      },
    )

    // ============ Vector API ============

    .post('/v2/vector/create-index', async (context) => {
      const body = context.body
      try {
        const reqBody = body as {
          databaseId: string
          tableName: string
          dimensions: number
          vectorType?: 'float32' | 'int8' | 'bit'
          metadataColumns?: Array<{ name: string; type: string }>
          partitionKey?: string
        }
        await node.createVectorIndex(reqBody.databaseId, {
          tableName: reqBody.tableName,
          dimensions: reqBody.dimensions,
          vectorType: reqBody.vectorType,
          metadataColumns: reqBody.metadataColumns as Array<{
            name: string
            type: 'TEXT' | 'INTEGER' | 'REAL' | 'BLOB'
          }>,
          partitionKey: reqBody.partitionKey,
        })
        return { success: true, status: 'created' }
      } catch (error) {
        return handleError(error)
      }
    })

    .post('/v2/vector/insert', async (context) => {
      const body = context.body
      try {
        const reqBody = body as {
          databaseId: string
          tableName: string
          vector: number[]
          rowid?: number
          metadata?: Record<string, string | number | boolean | null>
          partitionValue?: string | number
        }
        const result = await node.insertVector(reqBody.databaseId, {
          tableName: reqBody.tableName,
          vector: reqBody.vector,
          rowid: reqBody.rowid,
          metadata: reqBody.metadata,
          partitionValue: reqBody.partitionValue,
        })
        return { success: true, ...result }
      } catch (error) {
        return handleError(error)
      }
    })

    .post('/v2/vector/batch-insert', async (context) => {
      const body = context.body
      try {
        const reqBody = body as {
          databaseId: string
          tableName: string
          vectors: Array<{
            vector: number[]
            rowid?: number
            metadata?: Record<string, string | number | boolean | null>
            partitionValue?: string | number
          }>
        }
        const result = await node.batchInsertVectors(reqBody.databaseId, {
          tableName: reqBody.tableName,
          vectors: reqBody.vectors,
        })
        return { success: true, ...result }
      } catch (error) {
        return handleError(error)
      }
    })

    .post('/v2/vector/search', async (context) => {
      const body = context.body
      try {
        const reqBody = body as {
          databaseId: string
          tableName: string
          vector: number[]
          k: number
          partitionValue?: string | number
          metadataFilter?: string
          includeMetadata?: boolean
        }
        const results = await node.searchVectors(reqBody.databaseId, {
          tableName: reqBody.tableName,
          vector: reqBody.vector,
          k: reqBody.k,
          partitionValue: reqBody.partitionValue,
          metadataFilter: reqBody.metadataFilter,
          includeMetadata: reqBody.includeMetadata,
        })
        return { success: true, results }
      } catch (error) {
        return handleError(error)
      }
    })

    .get('/v2/vector/check/:databaseId', async (context) => {
      const params = context.params
      try {
        const supported = await node.checkVectorSupport(params.databaseId)
        return { success: true, vectorSupported: supported }
      } catch (error) {
        return handleError(error)
      }
    })

    // ============ ACL API ============

    .post('/v2/acl/grant', async (context) => {
      const body = context.body
      try {
        const reqBody = body as {
          databaseId: string
          grantee: `0x${string}`
          permissions: Array<'read' | 'write' | 'admin'>
          expiresAt?: number
        }
        await node.grant(reqBody.databaseId, {
          grantee: reqBody.grantee,
          permissions: reqBody.permissions,
          expiresAt: reqBody.expiresAt,
        })
        return { success: true, status: 'granted' }
      } catch (error) {
        return handleError(error)
      }
    })

    .post('/v2/acl/revoke', async (context) => {
      const body = context.body
      try {
        const reqBody = body as {
          databaseId: string
          grantee: `0x${string}`
          permissions?: Array<'read' | 'write' | 'admin'>
        }
        await node.revoke(reqBody.databaseId, {
          grantee: reqBody.grantee,
          permissions: reqBody.permissions,
        })
        return { success: true, status: 'revoked' }
      } catch (error) {
        return handleError(error)
      }
    })

    .get('/v2/acl/list/:databaseId', (context) => {
      const params = context.params
      try {
        const rules = node.listACL(params.databaseId)
        return { success: true, rules }
      } catch (error) {
        return handleError(error)
      }
    })

    .get('/v2/acl/check/:databaseId/:address/:permission', (context) => {
      const params = context.params
      try {
        const hasPermission = node.hasPermission(
          params.databaseId,
          params.address as `0x${string}`,
          params.permission as 'read' | 'write' | 'admin',
        )
        return { success: true, hasPermission }
      } catch (error) {
        return handleError(error)
      }
    })

  // Start the node
  await node.start()

  // Start the server
  app.listen({
    port: config.port,
    hostname: config.host,
  })

  console.log(`[SQLit v2] Server listening on ${config.host}:${config.port}`)

  // Return control object
  return {
    app,
    node,
    stop: async () => {
      await node.stop()
      app.stop()
    },
  }
}

// CLI entry point
if (import.meta.main) {
  const port = parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10)
  const host = process.env.HOST ?? '0.0.0.0'
  const dataDir = process.env.DATA_DIR ?? '.data/sqlit'
  const l2RpcUrl =
    process.env.L2_RPC_URL ??
    process.env.JEJU_RPC_URL ??
    process.env.RPC_URL ??
    'http://localhost:6546'
  const registryAddress = (process.env.SQLIT_REGISTRY_ADDRESS ??
    process.env.REGISTRY_ADDRESS ??
    '0x0000000000000000000000000000000000000000') as `0x${string}`
  const operatorPrivateKey = (process.env.SQLIT_OPERATOR_PRIVATE_KEY ??
    process.env.OPERATOR_PRIVATE_KEY ??
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as `0x${string}`

  let server: Awaited<ReturnType<typeof createSQLitServer>> | null = null
  let isShuttingDown = false

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return
    isShuttingDown = true
    console.log(`[SQLit v2] Received ${signal}, shutting down gracefully...`)
    if (server) {
      await server.stop()
    }
    // Use setTimeout to ensure all async operations complete
    setTimeout(() => {
      process.exit(0)
    }, 100)
  }

  // Ensure signal handlers wait for async shutdown
  process.on('SIGTERM', () => {
    shutdown('SIGTERM').catch((error) => {
      console.error('[SQLit v2] Error during shutdown:', error)
      process.exit(1)
    })
  })
  process.on('SIGINT', () => {
    shutdown('SIGINT').catch((error) => {
      console.error('[SQLit v2] Error during shutdown:', error)
      process.exit(1)
    })
  })

  // Handle unhandled errors to prevent crashes
  process.on('unhandledRejection', (reason) => {
    console.error('[SQLit v2] Unhandled rejection:', reason)
    // Don't exit - log and continue
  })

  process.on('uncaughtException', (error) => {
    console.error('[SQLit v2] Uncaught exception:', error)
    // Don't exit - log and continue (server should keep running)
  })

  createSQLitServer({
    port,
    host,
    nodeConfig: {
      operatorPrivateKey,
      endpoint: `http://${host}:${port}`,
      wsEndpoint: `ws://${host}:${port}/ws`,
      dataDir,
      region: 'global',
      teeEnabled: false,
      l2RpcUrl,
      registryAddress,
      version: '2.0.0',
    },
    serviceConfig: {
      heartbeatIntervalMs: 30000,
      maxDatabasesPerNode: 100,
    },
  })
    .then((s) => {
      server = s
    })
    .catch((error) => {
      console.error('[SQLit v2] Failed to start server:', error)
      process.exit(1)
    })
}
