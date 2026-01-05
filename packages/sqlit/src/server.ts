/**
 * SQLit v2 HTTP Server
 *
 * Exposes the SQLit node as an HTTP/WebSocket service for:
 * - Query execution (compatible with v1 API)
 * - Database management
 * - Replication sync
 * - Health checks
 */

import { cors } from '@elysiajs/cors'
import { Elysia, t } from 'elysia'
import { SQLitNode } from './node'
import type {
  BatchExecuteRequest,
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
  const serializeDatabase = (
    db: import('@jejunetwork/types').DatabaseInstance,
  ) => ({
    ...db,
    sizeBytes: db.sizeBytes.toString(),
    rowCount: db.rowCount.toString(),
    walPosition: db.walPosition.toString(),
  })

  // Helper to serialize query results
  const serializeQueryResult = (result: import('./types').ExecuteResponse) => ({
    ...result,
    walPosition: result.walPosition.toString(),
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
      walPosition: r.walPosition.toString(),
      lastInsertId: r.lastInsertId.toString(),
    })),
  })

  const app = new Elysia()
    .use(cors())

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
      async ({
        body,
      }: {
        body: {
          database?: string
          query?: string
          sql?: string
          args?: unknown[]
          assoc?: boolean
        }
      }) => {
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
      async ({
        body,
      }: {
        body: {
          database?: string
          query?: string
          sql?: string
          args?: unknown[]
        }
      }) => {
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

    .post(
      '/v2/execute',
      async ({ body }) => {
        try {
          const result = await node.execute(body as ExecuteRequest)
          return { success: true, ...serializeQueryResult(result) }
        } catch (error) {
          return handleError(error)
        }
      },
      {
        body: t.Object({
          databaseId: t.String(),
          sql: t.String(),
          params: t.Optional(t.Array(t.Any())),
          queryType: t.Optional(t.String()),
          timeoutMs: t.Optional(t.Number()),
          sessionId: t.Optional(t.String()),
          requiredWalPosition: t.Optional(t.String()),
          signature: t.Optional(t.String()),
          timestamp: t.Optional(t.Number()),
        }),
      },
    )

    .post(
      '/v2/batch',
      async ({ body }) => {
        try {
          const result = await node.batchExecute(body as BatchExecuteRequest)
          return { success: true, ...serializeBatchResult(result) }
        } catch (error) {
          return handleError(error)
        }
      },
      {
        body: t.Object({
          databaseId: t.String(),
          queries: t.Array(
            t.Object({
              sql: t.String(),
              params: t.Optional(t.Array(t.Any())),
            }),
          ),
          transactional: t.Boolean(),
        }),
      },
    )

    // ============ Database Management ============

    .get('/v2/databases', () => ({
      success: true,
      databases: node.listDatabases().map(serializeDatabase),
    }))

    .get('/v2/databases/:id', ({ params }) => {
      const db = node.getDatabase(params.id)
      if (!db) {
        return { success: false, error: 'Database not found' }
      }
      return { success: true, database: serializeDatabase(db) }
    })

    .post(
      '/v2/databases',
      async ({ body }) => {
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

    .delete('/v2/databases/:id', async ({ params }) => {
      try {
        await node.deleteDatabase(params.id)
        return { success: true }
      } catch (error) {
        return handleError(error)
      }
    })

    // ============ V1 Admin API (backwards compatible) ============

    .post('/v1/admin/create', async ({ query }) => {
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

    .delete('/v1/admin/drop', async ({ query }) => {
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
      ({
        body,
      }: {
        body: {
          databaseId: string
          fromPosition: string
          toPosition?: string
          limit?: number
        }
      }) => {
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

    .get('/v2/replication/:databaseId', ({ params }) => {
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
      async ({
        params,
        body,
      }: {
        params: { databaseId: string }
        body: { sql: string; params?: unknown[] }
      }) => {
        try {
          const result = await node.execute({
            databaseId: params.databaseId,
            sql: body.sql,
            params: body.params as
              | (string | number | boolean | null | bigint)[]
              | undefined,
          })
          return { success: true, ...serializeQueryResult(result) }
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

    .post(
      '/v2/vector/create-index',
      async ({
        body,
      }: {
        body: {
          databaseId: string
          tableName: string
          dimensions: number
          vectorType?: 'float32' | 'int8' | 'bit'
          metadataColumns?: Array<{ name: string; type: string }>
          partitionKey?: string
        }
      }) => {
        try {
          await node.createVectorIndex(body.databaseId, {
            tableName: body.tableName,
            dimensions: body.dimensions,
            vectorType: body.vectorType,
            metadataColumns: body.metadataColumns as Array<{
              name: string
              type: 'TEXT' | 'INTEGER' | 'REAL' | 'BLOB'
            }>,
            partitionKey: body.partitionKey,
          })
          return { success: true, status: 'created' }
        } catch (error) {
          return handleError(error)
        }
      },
    )

    .post(
      '/v2/vector/insert',
      async ({
        body,
      }: {
        body: {
          databaseId: string
          tableName: string
          vector: number[]
          rowid?: number
          metadata?: Record<string, string | number | boolean | null>
          partitionValue?: string | number
        }
      }) => {
        try {
          const result = await node.insertVector(body.databaseId, {
            tableName: body.tableName,
            vector: body.vector,
            rowid: body.rowid,
            metadata: body.metadata,
            partitionValue: body.partitionValue,
          })
          return { success: true, ...result }
        } catch (error) {
          return handleError(error)
        }
      },
    )

    .post(
      '/v2/vector/batch-insert',
      async ({
        body,
      }: {
        body: {
          databaseId: string
          tableName: string
          vectors: Array<{
            vector: number[]
            rowid?: number
            metadata?: Record<string, string | number | boolean | null>
            partitionValue?: string | number
          }>
        }
      }) => {
        try {
          const result = await node.batchInsertVectors(body.databaseId, {
            tableName: body.tableName,
            vectors: body.vectors,
          })
          return { success: true, ...result }
        } catch (error) {
          return handleError(error)
        }
      },
    )

    .post(
      '/v2/vector/search',
      async ({
        body,
      }: {
        body: {
          databaseId: string
          tableName: string
          vector: number[]
          k: number
          partitionValue?: string | number
          metadataFilter?: string
          includeMetadata?: boolean
        }
      }) => {
        try {
          const results = await node.searchVectors(body.databaseId, {
            tableName: body.tableName,
            vector: body.vector,
            k: body.k,
            partitionValue: body.partitionValue,
            metadataFilter: body.metadataFilter,
            includeMetadata: body.includeMetadata,
          })
          return { success: true, results }
        } catch (error) {
          return handleError(error)
        }
      },
    )

    .get('/v2/vector/check/:databaseId', async ({ params }) => {
      try {
        const supported = await node.checkVectorSupport(params.databaseId)
        return { success: true, vectorSupported: supported }
      } catch (error) {
        return handleError(error)
      }
    })

    // ============ ACL API ============

    .post(
      '/v2/acl/grant',
      async ({
        body,
      }: {
        body: {
          databaseId: string
          grantee: `0x${string}`
          permissions: Array<'read' | 'write' | 'admin'>
          expiresAt?: number
        }
      }) => {
        try {
          await node.grant(body.databaseId, {
            grantee: body.grantee,
            permissions: body.permissions,
            expiresAt: body.expiresAt,
          })
          return { success: true, status: 'granted' }
        } catch (error) {
          return handleError(error)
        }
      },
    )

    .post(
      '/v2/acl/revoke',
      async ({
        body,
      }: {
        body: {
          databaseId: string
          grantee: `0x${string}`
          permissions?: Array<'read' | 'write' | 'admin'>
        }
      }) => {
        try {
          await node.revoke(body.databaseId, {
            grantee: body.grantee,
            permissions: body.permissions,
          })
          return { success: true, status: 'revoked' }
        } catch (error) {
          return handleError(error)
        }
      },
    )

    .get('/v2/acl/list/:databaseId', ({ params }) => {
      try {
        const rules = node.listACL(params.databaseId)
        return { success: true, rules }
      } catch (error) {
        return handleError(error)
      }
    })

    .get('/v2/acl/check/:databaseId/:address/:permission', ({ params }) => {
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
  const l2RpcUrl = process.env.L2_RPC_URL ?? 'http://localhost:8545'
  const registryAddress = (process.env.REGISTRY_ADDRESS ??
    '0x0000000000000000000000000000000000000000') as `0x${string}`
  const operatorPrivateKey = (process.env.OPERATOR_PRIVATE_KEY ??
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as `0x${string}`

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
  }).catch((error) => {
    console.error('[SQLit v2] Failed to start server:', error)
    process.exit(1)
  })
}
