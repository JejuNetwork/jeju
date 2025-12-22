/**
 * DA Gateway
 *
 * HTTP API for DA layer integration:
 * - Blob submission
 * - Blob retrieval
 * - Sampling queries
 * - Operator management
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Hex } from 'viem'
import { toBytes, toHex } from 'viem'
import {
  blobSampleRequestSchema,
  blobSubmitRequestSchema,
  daOperatorInfoSchema,
} from '../shared/schemas'
import { expectValid } from '../shared/validation'
import { createDisperser, type Disperser } from './disperser'
import type {
  BlobRetrievalRequest,
  BlobSubmissionRequest,
  BlobSubmissionResult,
  DAConfig,
  DAOperatorInfo,
} from './types'

// ============================================================================
// Gateway Configuration
// ============================================================================

export interface DAGatewayConfig {
  /** Base path for API routes */
  basePath?: string
  /** DA configuration */
  daConfig?: Partial<DAConfig>
  /** Enable CORS */
  enableCors?: boolean
  /** Max blob size (bytes) */
  maxBlobSize?: number
}

// ============================================================================
// DA Gateway
// ============================================================================

export class DAGateway {
  private readonly app: Hono
  private readonly disperser: Disperser
  private readonly config: DAGatewayConfig

  constructor(config: DAGatewayConfig = {}) {
    this.config = {
      basePath: '/da',
      enableCors: true,
      maxBlobSize: 128 * 1024 * 1024,
      ...config,
    }

    this.disperser = createDisperser()
    this.app = new Hono()

    this.setupRoutes()
  }

  /**
   * Get Hono app instance
   */
  getApp(): Hono {
    return this.app
  }

  /**
   * Get disperser
   */
  getDisperser(): Disperser {
    return this.disperser
  }

  /**
   * Register an operator
   */
  registerOperator(operator: DAOperatorInfo): void {
    this.disperser.registerOperator(operator)
  }

  /**
   * Setup HTTP routes
   */
  private setupRoutes(): void {
    const basePath = this.config.basePath ?? '/da'

    if (this.config.enableCors) {
      this.app.use('*', cors())
    }

    // Health check
    this.app.get(`${basePath}/health`, (c) => {
      return c.json({
        status: 'healthy',
        operators: this.disperser.getActiveOperators().length,
        timestamp: Date.now(),
      })
    })

    // Submit blob
    this.app.post(`${basePath}/blob`, async (c) => {
      const body = expectValid(
        blobSubmitRequestSchema,
        await c.req.json(),
        'Blob submit request',
      )

      // Decode data
      let data: Uint8Array
      if (body.data.startsWith('0x')) {
        // Validate hex format before decoding
        if (!/^0x[a-fA-F0-9]*$/.test(body.data)) {
          return c.json({ error: 'Invalid hex data format' }, 400)
        }
        data = toBytes(body.data as Hex)
      } else {
        // Validate base64 format
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body.data)) {
          return c.json({ error: 'Invalid base64 data format' }, 400)
        }
        data = Uint8Array.from(atob(body.data), (c) => c.charCodeAt(0))
      }

      // Check size
      if (data.length > (this.config.maxBlobSize ?? 128 * 1024 * 1024)) {
        return c.json({ error: 'Blob too large' }, 400)
      }

      // Validate data is not empty
      if (data.length === 0) {
        return c.json({ error: 'Blob data cannot be empty' }, 400)
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
      const result = await this.disperser.disperse(request)

      if (!result.success) {
        return c.json(
          {
            error: result.error ?? 'Dispersal failed',
            blobId: result.blobId,
          },
          500,
        )
      }

      if (!result.attestation) {
        return c.json(
          {
            error: 'Dispersal succeeded but attestation missing',
            blobId: result.blobId,
          },
          500,
        )
      }

      const response: BlobSubmissionResult = {
        blobId: result.blobId,
        commitment: result.commitment,
        attestation: result.attestation,
        operators: result.assignments.flatMap((a) => a.operators),
        chunkAssignments: result.assignments,
      }

      return c.json(response)
    })

    // Get blob status
    this.app.get(`${basePath}/blob/:id`, (c) => {
      const blobId = c.req.param('id') as Hex
      const metadata = this.disperser.getBlobManager().getMetadata(blobId)

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

    // Retrieve blob data
    this.app.get(`${basePath}/blob/:id/data`, (c) => {
      const blobId = c.req.param('id') as Hex
      const metadata = this.disperser.getBlobManager().getMetadata(blobId)

      if (!metadata) {
        return c.json({ error: 'Blob not found' }, 404)
      }

      const request: BlobRetrievalRequest = {
        blobId,
        commitment: metadata.commitment,
      }

      const result = this.disperser.getBlobManager().retrieve(request)

      return c.json({
        blobId,
        data: toHex(result.data),
        verified: result.verified,
        chunksUsed: result.chunksUsed,
        latencyMs: result.latencyMs,
      })
    })

    // Sample blob
    this.app.post(`${basePath}/sample`, async (c) => {
      const body = expectValid(
        blobSampleRequestSchema,
        await c.req.json(),
        'Blob sample request',
      )

      const metadata = this.disperser.getBlobManager().getMetadata(body.blobId)
      if (!metadata) {
        return c.json({ error: 'Blob not found' }, 404)
      }

      const result = await this.disperser
        .getSampler()
        .sample(body.blobId, metadata.commitment, body.requester)

      return c.json(result)
    })

    // List operators
    this.app.get(`${basePath}/operators`, (c) => {
      const operators = this.disperser.getActiveOperators()
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

    // Register operator
    this.app.post(`${basePath}/operators`, async (c) => {
      const body = expectValid(
        daOperatorInfoSchema,
        await c.req.json(),
        'Register operator request',
      )
      this.disperser.registerOperator(body as DAOperatorInfo)
      return c.json({ success: true })
    })

    // Get stats
    this.app.get(`${basePath}/stats`, (c) => {
      const blobStats = this.disperser.getBlobManager().getStats()
      const operators = this.disperser.getActiveOperators()

      return c.json({
        blobs: blobStats,
        operators: {
          active: operators.length,
          totalCapacityGB: operators.reduce((sum, o) => sum + o.capacityGB, 0),
          usedCapacityGB: operators.reduce((sum, o) => sum + o.usedGB, 0),
        },
      })
    })
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createDAGateway(config?: DAGatewayConfig): DAGateway {
  return new DAGateway(config)
}

/**
 * Create Hono router for DA gateway
 */
export function createDARouter(config?: DAGatewayConfig): Hono {
  const gateway = new DAGateway(config)
  return gateway.getApp()
}
