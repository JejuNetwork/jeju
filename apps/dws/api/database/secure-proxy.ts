/**
 * Secure SQLit Proxy
 *
 * All SQLit queries must go through this proxy which:
 * 1. Verifies request signatures
 * 2. Checks database ownership/ACL
 * 3. Forwards authenticated requests to SQLit
 * 4. Logs access for audit
 */

import { getSQLit } from '@jejunetwork/db'
import { Elysia } from 'elysia'
import type { Address, Hex } from 'viem'
import { verifyMessage } from 'viem'
import { z } from 'zod'
import { verifySignedRequest } from './provisioning'

// Constants

const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000 // 5 minutes

// Schemas

const queryParamSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
])

const signedQuerySchema = z.object({
  database: z.string().min(1),
  type: z.enum(['query', 'exec']),
  sql: z.string().min(1),
  params: z.array(queryParamSchema).default([]),
  timestamp: z.number().int().positive(),
  // Authentication - REQUIRED for all requests
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
  signer: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
})

// Secure Query Execution

interface QueryResultData {
  rows: Record<string, string | number | boolean | null>[]
  rowCount: number
  columns: string[]
  executionTime: number
  blockHeight: number
}

interface ExecResultData {
  rowsAffected: number
  lastInsertId: string | undefined
  txHash: string
  blockHeight: number
  gasUsed: string
}

interface SecureQueryResult {
  success: boolean
  data?: QueryResultData | ExecResultData
  error?: string
}

async function executeSecureQuery(params: {
  database: string
  type: 'query' | 'exec'
  sql: string
  params: (string | number | boolean | null)[]
  signer: Address
}): Promise<SecureQueryResult> {
  const client = getSQLit()

  if (params.type === 'query') {
    const result = await client.query<
      Record<string, string | number | boolean | null>
    >(params.sql, params.params, params.database)
    return {
      success: true,
      data: {
        rows: result.rows,
        rowCount: result.rowCount,
        columns: result.columns.map((c) => c.name),
        executionTime: result.executionTime,
        blockHeight: result.blockHeight,
      },
    }
  } else {
    const result = await client.exec(params.sql, params.params, params.database)
    return {
      success: true,
      data: {
        rowsAffected: result.rowsAffected,
        lastInsertId: result.lastInsertId?.toString(),
        txHash: result.txHash,
        blockHeight: result.blockHeight,
        gasUsed: result.gasUsed.toString(),
      },
    }
  }
}

// Internal Query (for DWS system use only)

/**
 * Execute a query without authentication (internal use only)
 * This should NEVER be exposed to external requests
 */
export async function internalQuery<T>(
  database: string,
  sql: string,
  params: (string | number | boolean | null)[] = [],
): Promise<T[]> {
  const client = getSQLit()
  const result = await client.query<T>(sql, params, database)
  return result.rows
}

export async function internalExec(
  database: string,
  sql: string,
  params: (string | number | boolean | null)[] = [],
): Promise<{ rowsAffected: number; txHash: string }> {
  const client = getSQLit()
  const result = await client.exec(sql, params, database)
  return {
    rowsAffected: result.rowsAffected,
    txHash: result.txHash,
  }
}

// Router

export function createSecureSQLitRouter() {
  return (
    new Elysia({ prefix: '/sqlit' })
      /**
       * Secure query endpoint - requires signature
       */
      .post('/query', async ({ body, set }) => {
        // SECURITY: All requests MUST be signed - no localhost bypass
        const parsed = signedQuerySchema.safeParse(body)

        if (!parsed.success) {
          set.status = 400
          return {
            error: 'Invalid request: signature required',
            details: parsed.error.issues,
          }
        }

        const { database, type, sql, params, timestamp, signature, signer } =
          parsed.data

        // Verify signature
        const payload = { database, type, sql, params, timestamp }
        const message = JSON.stringify(payload)
        const isValid = await verifyMessage({
          address: signer as Address,
          message,
          signature: signature as Hex,
        })

        if (!isValid) {
          set.status = 401
          return { error: 'Invalid signature' }
        }

        // Check timestamp
        if (Math.abs(Date.now() - timestamp) > SIGNATURE_MAX_AGE_MS) {
          set.status = 401
          return { error: 'Request expired' }
        }

        // Verify access
        const verification = await verifySignedRequest({
          payload,
          signature: signature as Hex,
          signer: signer as Address,
        })

        if (!verification.valid) {
          set.status = 403
          return { error: verification.error ?? 'Access denied' }
        }

        // Execute query
        const result = await executeSecureQuery({
          database,
          type,
          sql,
          params,
          signer: signer as Address,
        })

        if (!result.success) {
          set.status = 500
          return { error: result.error }
        }

        return result.data
      })

      .get('/health', () => ({
        service: 'dws-secure-sqlit',
        status: 'healthy',
      }))
  )
}
