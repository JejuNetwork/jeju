/**
 * Data Availability Layer Routes
 *
 * HTTP API for DA layer integration:
 * - Blob submission and retrieval
 * - Sampling queries
 * - Operator management
 * - Metrics and monitoring
 */

import { expectValid } from '@jejunetwork/types'
import { Elysia, t } from 'elysia'
import type { Address, Hex } from 'viem'
import { toBytes, toHex } from 'viem'
import {
  type BlobSubmissionRequest,
  createDAOperator,
  createDisperser,
  type DAOperator,
  type DAOperatorInfo,
  type Disperser,
  type SampleRequest,
} from '../../da'
import {
  attestRequestSchema,
  blobSampleRequestSchema,
  blobSubmitRequestSchema,
  daOperatorInfoSchema,
  sampleRequestSchema,
  storeChunkRequestSchema,
} from '../../shared/schemas'

// Context

export interface DARouterContext {
  operatorPrivateKey?: Hex
  operatorEndpoint?: string
  operatorRegion?: string
  operatorCapacityGB?: number
  daContractAddress?: Address
  rpcUrl?: string
}

// State

let disperser: Disperser | null = null
let localOperator: DAOperator | null = null
let isInitialized = false

// Initialization

export function initializeDA(ctx: DARouterContext): void {
  if (isInitialized) return

  // Create disperser
  disperser = createDisperser()

  // Create local operator if private key provided
  if (ctx.operatorPrivateKey) {
    localOperator = createDAOperator({
      privateKey: ctx.operatorPrivateKey,
      endpoint: ctx.operatorEndpoint ?? 'http://localhost:4030',
      capacityGB: ctx.operatorCapacityGB ?? 100,
      region: ctx.operatorRegion ?? 'default',
    })

    // Start operator
    localOperator
      .start()
      .then(() => {
        console.log('[DA] Local operator started:', localOperator?.getAddress())

        // Register local operator with disperser
        if (disperser && localOperator) {
          disperser.registerOperator(localOperator.getInfo())
        }
      })
      .catch((err) => {
        console.error('[DA] Failed to start local operator:', err)
      })
  }

  isInitialized = true
  console.log('[DA] Data Availability layer initialized')
}

export function shutdownDA(): void {
  if (localOperator) {
    localOperator.stop()
  }
  isInitialized = false
}

// Router

export function createDARouter(ctx: DARouterContext = {}) {
  return (
    new Elysia({ prefix: '/da' })
      // Initialize on first request if not already done
      .onBeforeHandle(() => {
        if (!isInitialized) {
          initializeDA(ctx)
        }
      })
      .get('/health', () => {
        const operatorCount = disperser?.getActiveOperators().length ?? 0
        const blobStats = disperser?.getBlobManager().getStats()

        return {
          status: 'healthy',
          initialized: isInitialized,
          localOperator: localOperator?.getAddress() ?? null,
          localOperatorStatus: localOperator?.getStatus() ?? 'stopped',
          operators: operatorCount,
          blobs: blobStats,
          timestamp: Date.now(),
        }
      })
      .post('/blob', async ({ body, set }) => {
        if (!disperser) {
          set.status = 503
          return { error: 'DA layer not initialized' }
        }

        const validBody = expectValid(
          blobSubmitRequestSchema,
          body,
          'Blob submit request',
        )

        // Decode data
        let data: Uint8Array
        if (validBody.data.startsWith('0x')) {
          data = toBytes(validBody.data as Hex)
        } else {
          data = Uint8Array.from(atob(validBody.data), (ch) => ch.charCodeAt(0))
        }

        // Check size (128MB max)
        const maxSize = 128 * 1024 * 1024
        if (data.length > maxSize) {
          set.status = 400
          return {
            error: `Blob too large: ${data.length} bytes (max: ${maxSize})`,
          }
        }

        // Prepare request
        const request: BlobSubmissionRequest = {
          data,
          submitter: validBody.submitter,
          namespace: validBody.namespace,
          quorumPercent: validBody.quorumPercent,
          retentionPeriod: validBody.retentionPeriod,
        }

        // Disperse
        const result = await disperser.disperse(request)

        if (!result.success) {
          set.status = 500
          return {
            error: result.error ?? 'Dispersal failed',
            blobId: result.blobId,
            quorumReached: result.quorumReached,
            operatorCount: result.operatorCount,
          }
        }

        return {
          blobId: result.blobId,
          commitment: result.commitment,
          attestation: result.attestation,
          operators: result.assignments.flatMap((a) => a.operators),
          chunkAssignments: result.assignments,
        }
      })
      .get('/blob/:id', ({ params, set }) => {
        if (!disperser) {
          set.status = 503
          return { error: 'DA layer not initialized' }
        }

        const blobId = params.id as Hex
        const metadata = disperser.getBlobManager().getMetadata(blobId)

        if (!metadata) {
          set.status = 404
          return { error: 'Blob not found' }
        }

        return {
          id: metadata.id,
          status: metadata.status,
          size: metadata.size,
          commitment: metadata.commitment,
          submitter: metadata.submitter,
          submittedAt: metadata.submittedAt,
          confirmedAt: metadata.confirmedAt,
          expiresAt: metadata.expiresAt,
        }
      })
      .get('/blob/:id/data', ({ params, set }) => {
        if (!disperser) {
          set.status = 503
          return { error: 'DA layer not initialized' }
        }

        const blobId = params.id as Hex
        const metadata = disperser.getBlobManager().getMetadata(blobId)

        if (!metadata) {
          set.status = 404
          return { error: 'Blob not found' }
        }

        const result = disperser.getBlobManager().retrieve({
          blobId,
          commitment: metadata.commitment,
        })

        return {
          blobId,
          data: toHex(result.data),
          verified: result.verified,
          chunksUsed: result.chunksUsed,
          latencyMs: result.latencyMs,
        }
      })
      .post('/sample', async ({ body, set }) => {
        if (!disperser) {
          set.status = 503
          return { error: 'DA layer not initialized' }
        }

        const validBody = expectValid(
          blobSampleRequestSchema,
          body,
          'Blob sample request',
        )

        const metadata = disperser
          .getBlobManager()
          .getMetadata(validBody.blobId)
        if (!metadata) {
          set.status = 404
          return { error: 'Blob not found' }
        }

        const result = await disperser
          .getSampler()
          .sample(validBody.blobId, metadata.commitment, validBody.requester)

        return result
      })
      .post('/chunk', async ({ body, set }) => {
        if (!localOperator) {
          set.status = 503
          return { error: 'Local operator not running' }
        }

        const validBody = expectValid(
          storeChunkRequestSchema,
          body,
          'Store chunk request',
        )

        const stored = localOperator.storeChunk(
          validBody.blobId,
          validBody.index,
          toBytes(validBody.data),
          validBody.proof,
          validBody.commitment,
        )

        if (!stored) {
          set.status = 400
          return { error: 'Failed to store chunk (proof verification failed)' }
        }

        return {
          success: true,
          blobId: validBody.blobId,
          index: validBody.index,
        }
      })
      .post('/chunk/sample', async ({ body, set }) => {
        if (!localOperator) {
          set.status = 503
          return { error: 'Local operator not running' }
        }

        const request = expectValid(sampleRequestSchema, body, 'Sample request')
        const response = localOperator.handleSampleRequest(
          request as SampleRequest,
        )

        return response
      })
      .post('/attest', async ({ body, set }) => {
        if (!localOperator) {
          set.status = 503
          return { error: 'Local operator not running' }
        }

        const validBody = expectValid(
          attestRequestSchema,
          body,
          'Attest request',
        )

        const signature = await localOperator.signAttestation(
          validBody.blobId,
          validBody.commitment,
          validBody.chunkIndices,
        )

        return { signature }
      })
      .get('/operators', ({ set }) => {
        if (!disperser) {
          set.status = 503
          return { error: 'DA layer not initialized' }
        }

        const operators = disperser.getActiveOperators()
        return {
          count: operators.length,
          operators: operators.map((o) => ({
            address: o.address,
            endpoint: o.endpoint,
            region: o.region,
            status: o.status,
            capacityGB: o.capacityGB,
            usedGB: o.usedGB,
          })),
        }
      })

      .post('/operators', async ({ body, set }) => {
        if (!disperser) {
          set.status = 503
          return { error: 'DA layer not initialized' }
        }

        const operator = expectValid(
          daOperatorInfoSchema,
          body,
          'Register operator request',
        )
        disperser.registerOperator(operator as DAOperatorInfo)

        return { success: true, address: operator.address }
      })

      .delete('/operators/:address', ({ params, set }) => {
        if (!disperser) {
          set.status = 503
          return { error: 'DA layer not initialized' }
        }

        const address = params.address as Address
        disperser.removeOperator(address)

        return { success: true }
      })
      .get('/stats', ({ set }) => {
        if (!disperser) {
          set.status = 503
          return { error: 'DA layer not initialized' }
        }

        const blobStats = disperser.getBlobManager().getStats()
        const operators = disperser.getActiveOperators()
        const localMetrics = localOperator?.getMetrics()

        return {
          blobs: blobStats,
          operators: {
            active: operators.length,
            totalCapacityGB: operators.reduce(
              (sum, o) => sum + o.capacityGB,
              0,
            ),
            usedCapacityGB: operators.reduce((sum, o) => sum + o.usedGB, 0),
          },
          localOperator: localMetrics
            ? {
                address: localOperator?.getAddress(),
                status: localOperator?.getStatus(),
                metrics: localMetrics,
              }
            : null,
        }
      })
      .get(
        '/blobs',
        ({ query, set }) => {
          if (!disperser) {
            set.status = 503
            return { error: 'DA layer not initialized' }
          }

          const limit = query.limit ?? 100

          let blobs = query.status
            ? disperser
                .getBlobManager()
                .listByStatus(
                  query.status as
                    | 'pending'
                    | 'dispersing'
                    | 'available'
                    | 'expired'
                    | 'unavailable',
                )
            : query.submitter
              ? disperser
                  .getBlobManager()
                  .listBySubmitter(query.submitter as `0x${string}`)
              : []

          // Apply limit
          blobs = blobs.slice(0, limit)

          return {
            count: blobs.length,
            blobs: blobs.map((b) => ({
              id: b.id,
              status: b.status,
              size: b.size,
              submitter: b.submitter,
              submittedAt: b.submittedAt,
              expiresAt: b.expiresAt,
            })),
          }
        },
        {
          query: t.Object({
            status: t.Optional(t.String()),
            submitter: t.Optional(t.String()),
            limit: t.Optional(t.Number({ default: 100 })),
          }),
        },
      )
  )
}

export type DARoutes = ReturnType<typeof createDARouter>
