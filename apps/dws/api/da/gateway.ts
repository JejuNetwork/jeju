/**
 * DA Gateway
 *
 * HTTP API for DA layer integration:
 * - Blob submission
 * - Blob retrieval
 * - Sampling queries
 * - Operator management
 */

import { cors } from '@elysiajs/cors'
import { expectValid } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import type { Hex } from 'viem'
import { toBytes, toHex } from 'viem'
import {
  blobSampleRequestSchema,
  blobSubmitRequestSchema,
  daOperatorInfoSchema,
} from '../shared/schemas'
import { createDisperser, type Disperser } from './disperser'
import type {
  BlobRetrievalRequest,
  BlobSubmissionRequest,
  BlobSubmissionResult,
  DAConfig,
  DAOperatorInfo,
} from './types'

// Gateway Configuration

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

// DA Gateway

export class DAGateway {
  private readonly app: Elysia
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
    this.app = new Elysia()

    this.setupRoutes()
  }

  /**
   * Get Elysia app instance
   */
  getApp(): Elysia {
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
      this.app.use(cors())
    }

    // Health check
    this.app.get(`${basePath}/health`, () => {
      return {
        status: 'healthy',
        operators: this.disperser.getActiveOperators().length,
        timestamp: Date.now(),
      }
    })

    // Submit blob
    this.app.post(`${basePath}/blob`, async ({ body, set }) => {
      const validatedBody = expectValid(
        blobSubmitRequestSchema,
        body,
        'Blob submit request',
      )

      // Decode data
      let data: Uint8Array
      if (validatedBody.data.startsWith('0x')) {
        // Validate hex format before decoding
        if (!/^0x[a-fA-F0-9]*$/.test(validatedBody.data)) {
          set.status = 400
          return { error: 'Invalid hex data format' }
        }
        data = toBytes(validatedBody.data as Hex)
      } else {
        // Validate base64 format
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(validatedBody.data)) {
          set.status = 400
          return { error: 'Invalid base64 data format' }
        }
        data = Uint8Array.from(atob(validatedBody.data), (c) => c.charCodeAt(0))
      }

      // Check size
      if (data.length > (this.config.maxBlobSize ?? 128 * 1024 * 1024)) {
        set.status = 400
        return { error: 'Blob too large' }
      }

      // Validate data is not empty
      if (data.length === 0) {
        set.status = 400
        return { error: 'Blob data cannot be empty' }
      }

      // Prepare request
      const request: BlobSubmissionRequest = {
        data,
        submitter: validatedBody.submitter,
        namespace: validatedBody.namespace,
        quorumPercent: validatedBody.quorumPercent,
        retentionPeriod: validatedBody.retentionPeriod,
      }

      // Disperse
      const result = await this.disperser.disperse(request)

      if (!result.success) {
        set.status = 500
        return {
          error: result.error ?? 'Dispersal failed',
          blobId: result.blobId,
        }
      }

      if (!result.attestation) {
        set.status = 500
        return {
          error: 'Dispersal succeeded but attestation missing',
          blobId: result.blobId,
        }
      }

      const response: BlobSubmissionResult = {
        blobId: result.blobId,
        commitment: result.commitment,
        attestation: result.attestation,
        operators: result.assignments.flatMap((a) => a.operators),
        chunkAssignments: result.assignments,
      }

      return response
    })

    // Get blob status
    this.app.get(`${basePath}/blob/:id`, ({ params, set }) => {
      const blobId = params.id as Hex
      const metadata = this.disperser.getBlobManager().getMetadata(blobId)

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

    // Retrieve blob data
    this.app.get(`${basePath}/blob/:id/data`, ({ params, set }) => {
      const blobId = params.id as Hex
      const metadata = this.disperser.getBlobManager().getMetadata(blobId)

      if (!metadata) {
        set.status = 404
        return { error: 'Blob not found' }
      }

      const request: BlobRetrievalRequest = {
        blobId,
        commitment: metadata.commitment,
      }

      const result = this.disperser.getBlobManager().retrieve(request)

      return {
        blobId,
        data: toHex(result.data),
        verified: result.verified,
        chunksUsed: result.chunksUsed,
        latencyMs: result.latencyMs,
      }
    })

    // Sample blob
    this.app.post(`${basePath}/sample`, async ({ body, set }) => {
      const validatedBody = expectValid(
        blobSampleRequestSchema,
        body,
        'Blob sample request',
      )

      const metadata = this.disperser
        .getBlobManager()
        .getMetadata(validatedBody.blobId)
      if (!metadata) {
        set.status = 404
        return { error: 'Blob not found' }
      }

      const result = await this.disperser
        .getSampler()
        .sample(
          validatedBody.blobId,
          metadata.commitment,
          validatedBody.requester,
        )

      return result
    })

    // List operators
    this.app.get(`${basePath}/operators`, () => {
      const operators = this.disperser.getActiveOperators()
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

    // Register operator
    this.app.post(`${basePath}/operators`, async ({ body }) => {
      const validatedBody = expectValid(
        daOperatorInfoSchema,
        body,
        'Register operator request',
      )
      this.disperser.registerOperator(validatedBody as DAOperatorInfo)
      return { success: true }
    })

    // Get stats
    this.app.get(`${basePath}/stats`, () => {
      const blobStats = this.disperser.getBlobManager().getStats()
      const operators = this.disperser.getActiveOperators()

      return {
        blobs: blobStats,
        operators: {
          active: operators.length,
          totalCapacityGB: operators.reduce((sum, o) => sum + o.capacityGB, 0),
          usedCapacityGB: operators.reduce((sum, o) => sum + o.usedGB, 0),
        },
      }
    })
  }
}

// Factory

export function createDAGateway(config?: DAGatewayConfig): DAGateway {
  return new DAGateway(config)
}

/**
 * Create Elysia router for DA gateway
 */
export function createDARouter(config?: DAGatewayConfig): Elysia {
  const gateway = new DAGateway(config)
  return gateway.getApp()
}
