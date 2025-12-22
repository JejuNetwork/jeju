/**
 * Data Availability Layer Routes
 *
 * HTTP API for DA layer integration:
 * - Blob submission and retrieval
 * - Sampling queries
 * - Operator management
 * - Metrics and monitoring
 */

import { Hono } from 'hono'
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
import { expectValid } from '../../shared/validation'

// ============================================================================
// Context
// ============================================================================

export interface DARouterContext {
  operatorPrivateKey?: Hex
  operatorEndpoint?: string
  operatorRegion?: string
  operatorCapacityGB?: number
  daContractAddress?: Address
  rpcUrl?: string
}

// ============================================================================
// State
// ============================================================================

let disperser: Disperser | null = null
let localOperator: DAOperator | null = null
let isInitialized = false

// ============================================================================
// Initialization
// ============================================================================

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

// ============================================================================
// Router
// ============================================================================

export function createDARouter(ctx: DARouterContext = {}): Hono {
  const router = new Hono()

  // Initialize on first request if not already done
  router.use('*', async (_c, next) => {
    if (!isInitialized) {
      initializeDA(ctx)
    }
    return next()
  })

  // ============ Health ============

  router.get('/health', (c) => {
    const operatorCount = disperser?.getActiveOperators().length ?? 0
    const blobStats = disperser?.getBlobManager().getStats()

    return c.json({
      status: 'healthy',
      initialized: isInitialized,
      localOperator: localOperator?.getAddress() ?? null,
      localOperatorStatus: localOperator?.getStatus() ?? 'stopped',
      operators: operatorCount,
      blobs: blobStats,
      timestamp: Date.now(),
    })
  })

  // ============ Blob Submission ============

  router.post('/blob', async (c) => {
    if (!disperser) {
      return c.json({ error: 'DA layer not initialized' }, 503)
    }

    const body = expectValid(
      blobSubmitRequestSchema,
      await c.req.json(),
      'Blob submit request',
    )

    // Decode data
    let data: Uint8Array
    if (body.data.startsWith('0x')) {
      data = toBytes(body.data as Hex)
    } else {
      data = Uint8Array.from(atob(body.data), (ch) => ch.charCodeAt(0))
    }

    // Check size (128MB max)
    const maxSize = 128 * 1024 * 1024
    if (data.length > maxSize) {
      return c.json(
        { error: `Blob too large: ${data.length} bytes (max: ${maxSize})` },
        400,
      )
    }

    // Prepare request
    const request: BlobSubmissionRequest = {
      data,
      submitter: body.submitter,
      namespace: body.namespace,
      quorumPercent: body.quorumPercent,
      retentionPeriod: body.retentionPeriod,
    }

    // Disperse
    const result = await disperser.disperse(request)

    if (!result.success) {
      return c.json(
        {
          error: result.error ?? 'Dispersal failed',
          blobId: result.blobId,
          quorumReached: result.quorumReached,
          operatorCount: result.operatorCount,
        },
        500,
      )
    }

    return c.json({
      blobId: result.blobId,
      commitment: result.commitment,
      attestation: result.attestation,
      operators: result.assignments.flatMap((a) => a.operators),
      chunkAssignments: result.assignments,
    })
  })

  // ============ Blob Status ============

  router.get('/blob/:id', (c) => {
    if (!disperser) {
      return c.json({ error: 'DA layer not initialized' }, 503)
    }

    const blobId = c.req.param('id') as Hex
    const metadata = disperser.getBlobManager().getMetadata(blobId)

    if (!metadata) {
      return c.json({ error: 'Blob not found' }, 404)
    }

    return c.json({
      id: metadata.id,
      status: metadata.status,
      size: metadata.size,
      commitment: metadata.commitment,
      submitter: metadata.submitter,
      submittedAt: metadata.submittedAt,
      confirmedAt: metadata.confirmedAt,
      expiresAt: metadata.expiresAt,
    })
  })

  // ============ Blob Retrieval ============

  router.get('/blob/:id/data', (c) => {
    if (!disperser) {
      return c.json({ error: 'DA layer not initialized' }, 503)
    }

    const blobId = c.req.param('id') as Hex
    const metadata = disperser.getBlobManager().getMetadata(blobId)

    if (!metadata) {
      return c.json({ error: 'Blob not found' }, 404)
    }

    const result = disperser.getBlobManager().retrieve({
      blobId,
      commitment: metadata.commitment,
    })

    return c.json({
      blobId,
      data: toHex(result.data),
      verified: result.verified,
      chunksUsed: result.chunksUsed,
      latencyMs: result.latencyMs,
    })
  })

  // ============ Sampling ============

  router.post('/sample', async (c) => {
    if (!disperser) {
      return c.json({ error: 'DA layer not initialized' }, 503)
    }

    const body = expectValid(
      blobSampleRequestSchema,
      await c.req.json(),
      'Blob sample request',
    )

    const metadata = disperser.getBlobManager().getMetadata(body.blobId)
    if (!metadata) {
      return c.json({ error: 'Blob not found' }, 404)
    }

    const result = await disperser
      .getSampler()
      .sample(body.blobId, metadata.commitment, body.requester)

    return c.json(result)
  })

  // ============ Chunk Storage (for operators) ============

  router.post('/chunk', async (c) => {
    if (!localOperator) {
      return c.json({ error: 'Local operator not running' }, 503)
    }

    const body = expectValid(
      storeChunkRequestSchema,
      await c.req.json(),
      'Store chunk request',
    )

    const stored = localOperator.storeChunk(
      body.blobId,
      body.index,
      toBytes(body.data),
      body.proof,
      body.commitment,
    )

    if (!stored) {
      return c.json(
        { error: 'Failed to store chunk (proof verification failed)' },
        400,
      )
    }

    return c.json({ success: true, blobId: body.blobId, index: body.index })
  })

  // ============ Sample Request (for operators) ============

  router.post('/chunk/sample', async (c) => {
    if (!localOperator) {
      return c.json({ error: 'Local operator not running' }, 503)
    }

    const request = expectValid(
      sampleRequestSchema,
      await c.req.json(),
      'Sample request',
    )
    const response = localOperator.handleSampleRequest(request as SampleRequest)

    return c.json(response)
  })

  // ============ Attestation (for operators) ============

  router.post('/attest', async (c) => {
    if (!localOperator) {
      return c.json({ error: 'Local operator not running' }, 503)
    }

    const body = expectValid(
      attestRequestSchema,
      await c.req.json(),
      'Attest request',
    )

    const signature = await localOperator.signAttestation(
      body.blobId,
      body.commitment,
      body.chunkIndices,
    )

    return c.json({ signature })
  })

  // ============ Operator Management ============

  router.get('/operators', (c) => {
    if (!disperser) {
      return c.json({ error: 'DA layer not initialized' }, 503)
    }

    const operators = disperser.getActiveOperators()
    return c.json({
      count: operators.length,
      operators: operators.map((o) => ({
        address: o.address,
        endpoint: o.endpoint,
        region: o.region,
        status: o.status,
        capacityGB: o.capacityGB,
        usedGB: o.usedGB,
      })),
    })
  })

  router.post('/operators', async (c) => {
    if (!disperser) {
      return c.json({ error: 'DA layer not initialized' }, 503)
    }

    const operator = expectValid(
      daOperatorInfoSchema,
      await c.req.json(),
      'Register operator request',
    )
    disperser.registerOperator(operator as DAOperatorInfo)

    return c.json({ success: true, address: operator.address })
  })

  router.delete('/operators/:address', (c) => {
    if (!disperser) {
      return c.json({ error: 'DA layer not initialized' }, 503)
    }

    const address = c.req.param('address') as Address
    disperser.removeOperator(address)

    return c.json({ success: true })
  })

  // ============ Stats ============

  router.get('/stats', (c) => {
    if (!disperser) {
      return c.json({ error: 'DA layer not initialized' }, 503)
    }

    const blobStats = disperser.getBlobManager().getStats()
    const operators = disperser.getActiveOperators()
    const localMetrics = localOperator?.getMetrics()

    return c.json({
      blobs: blobStats,
      operators: {
        active: operators.length,
        totalCapacityGB: operators.reduce((sum, o) => sum + o.capacityGB, 0),
        usedCapacityGB: operators.reduce((sum, o) => sum + o.usedGB, 0),
      },
      localOperator: localMetrics
        ? {
            address: localOperator?.getAddress(),
            status: localOperator?.getStatus(),
            metrics: localMetrics,
          }
        : null,
    })
  })

  // ============ Blob List ============

  router.get('/blobs', (c) => {
    if (!disperser) {
      return c.json({ error: 'DA layer not initialized' }, 503)
    }

    const status = c.req.query('status') as string | undefined
    const submitter = c.req.query('submitter') as Address | undefined
    const limit = parseInt(c.req.query('limit') ?? '100', 10)

    let blobs = status
      ? disperser
          .getBlobManager()
          .listByStatus(
            status as
              | 'pending'
              | 'dispersing'
              | 'available'
              | 'expired'
              | 'unavailable',
          )
      : submitter
        ? disperser.getBlobManager().listBySubmitter(submitter)
        : []

    // Apply limit
    blobs = blobs.slice(0, limit)

    return c.json({
      count: blobs.length,
      blobs: blobs.map((b) => ({
        id: b.id,
        status: b.status,
        size: b.size,
        submitter: b.submitter,
        submittedAt: b.submittedAt,
        expiresAt: b.expiresAt,
      })),
    })
  })

  return router
}
