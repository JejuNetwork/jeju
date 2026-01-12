/**
 * dstack SDK Client
 *
 * Client for Phala Cloud dstack API - TEE container orchestration.
 * Provides container lifecycle management, attestation, and monitoring.
 *
 * ⚠️ IMPORTANT: This client is based on assumed API structure.
 * The actual Phala Cloud / dstack API documentation should be consulted
 * and this client updated to match the real endpoints.
 *
 * Required before production use:
 * 1. Verify API endpoint paths match dstack documentation
 * 2. Verify request/response schemas match actual API
 * 3. Test against real dstack deployment
 * 4. Update error handling for actual API error responses
 *
 * Current API assumptions that need verification:
 * - GET /health -> { ok: boolean, version: string }
 * - POST /containers -> CreateContainerResponse
 * - GET /containers -> ListContainersResponse
 * - GET /containers/:id -> GetContainerResponse
 * - DELETE /containers/:id -> DeleteContainerResponse
 * - GET /nodes -> ListNodesResponse
 * - GET /containers/:id/attestation -> GetAttestationResponse
 */

import { createLogger } from '../../utils/logger.js'
import {
  type Container,
  type ContainerAttestation,
  type ContainerStatus,
  type CreateContainerRequest,
  type CreateContainerResponse,
  type DeleteContainerRequest,
  type DeleteContainerResponse,
  type DStackConfig,
  DStackConfigSchema,
  type Event,
  type ExecContainerRequest,
  type ExecContainerResponse,
  type GetAttestationRequest,
  type GetAttestationResponse,
  type GetContainerLogsRequest,
  type GetContainerLogsResponse,
  type GetContainerRequest,
  type GetContainerResponse,
  type ListContainersRequest,
  type ListContainersResponse,
  type ListNodesRequest,
  type ListNodesResponse,
  type Node,
  type TEEType,
} from './types.js'

const log = createLogger('dstack-client')

// ============================================================================
// Error Types
// ============================================================================

export class DStackError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'DStackError'
  }
}

export class DStackAuthError extends DStackError {
  constructor(message: string) {
    super(message, 'AUTH_ERROR', 401)
    this.name = 'DStackAuthError'
  }
}

export class DStackNotFoundError extends DStackError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND', 404)
    this.name = 'DStackNotFoundError'
  }
}

export class DStackQuotaError extends DStackError {
  constructor(message: string) {
    super(message, 'QUOTA_EXCEEDED', 429)
    this.name = 'DStackQuotaError'
  }
}

// ============================================================================
// Client Class
// ============================================================================

export class DStackClient {
  private config: DStackConfig
  private initialized = false

  constructor(config: DStackConfig) {
    DStackConfigSchema.parse(config)
    this.config = {
      timeout: 30000,
      retry: {
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 10000,
        backoffMultiplier: 2,
      },
      ...config,
    }
  }

  /**
   * Initialize client and verify credentials
   *
   * ⚠️ WARNING: This client uses assumed API endpoints.
   * Set DSTACK_SKIP_API_VALIDATION=true to bypass validation in development.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    log.info('Initializing dstack client', { endpoint: this.config.endpoint })

    // Warn about unverified API structure
    log.warn(
      'dstack client uses assumed API structure - verify against actual dstack documentation before production use',
    )

    // Verify API connectivity and credentials
    const response = await this.request<{ ok: boolean; version: string }>(
      'GET',
      '/health',
    )

    if (!response.ok) {
      throw new DStackError('Failed to connect to dstack API', 'INIT_FAILED')
    }

    log.info('dstack client initialized', { version: response.version })
    this.initialized = true
  }

  // ============================================================================
  // Container Operations
  // ============================================================================

  /**
   * Create a new TEE container
   */
  async createContainer(
    request: CreateContainerRequest,
  ): Promise<CreateContainerResponse> {
    if (!this.initialized) await this.initialize()

    log.info('Creating container', {
      name: request.spec.name,
      image: request.spec.image,
      teeType: request.spec.teeType ?? 'none',
    })

    const response = await this.request<CreateContainerResponse>(
      'POST',
      '/containers',
      request,
    )

    // Wait for container to be ready if requested
    if (request.waitForReady) {
      const timeout = request.waitTimeout ?? 60000
      const container = await this.waitForStatus(
        response.container.id,
        'running',
        timeout,
      )
      return { ...response, container }
    }

    return response
  }

  /**
   * List containers with optional filters
   */
  async listContainers(
    request?: ListContainersRequest,
  ): Promise<ListContainersResponse> {
    if (!this.initialized) await this.initialize()

    const params = new URLSearchParams()
    if (request?.status) {
      params.set('status', request.status.join(','))
    }
    if (request?.namePrefix) {
      params.set('name_prefix', request.namePrefix)
    }
    if (request?.image) {
      params.set('image', request.image)
    }
    if (request?.limit) {
      params.set('limit', request.limit.toString())
    }
    if (request?.cursor) {
      params.set('cursor', request.cursor)
    }

    const queryString = params.toString()
    const path = queryString ? `/containers?${queryString}` : '/containers'

    return this.request<ListContainersResponse>('GET', path)
  }

  /**
   * Get container details
   */
  async getContainer(
    request: GetContainerRequest,
  ): Promise<GetContainerResponse> {
    if (!this.initialized) await this.initialize()

    return this.request<GetContainerResponse>(
      'GET',
      `/containers/${request.id}`,
    )
  }

  /**
   * Delete a container
   */
  async deleteContainer(
    request: DeleteContainerRequest,
  ): Promise<DeleteContainerResponse> {
    if (!this.initialized) await this.initialize()

    log.info('Deleting container', {
      id: request.id,
      force: request.force ?? false,
    })

    const params = request.force ? '?force=true' : ''
    return this.request<DeleteContainerResponse>(
      'DELETE',
      `/containers/${request.id}${params}`,
    )
  }

  /**
   * Start a stopped container
   */
  async startContainer(containerId: string): Promise<Container> {
    if (!this.initialized) await this.initialize()

    log.info('Starting container', { id: containerId })

    const response = await this.request<{ container: Container }>(
      'POST',
      `/containers/${containerId}/start`,
    )
    return response.container
  }

  /**
   * Stop a running container
   */
  async stopContainer(
    containerId: string,
    timeout?: number,
  ): Promise<Container> {
    if (!this.initialized) await this.initialize()

    log.info('Stopping container', { id: containerId, timeout: timeout ?? 30 })

    const params = timeout ? `?timeout=${timeout}` : ''
    const response = await this.request<{ container: Container }>(
      'POST',
      `/containers/${containerId}/stop${params}`,
    )
    return response.container
  }

  /**
   * Restart a container
   */
  async restartContainer(containerId: string): Promise<Container> {
    if (!this.initialized) await this.initialize()

    log.info('Restarting container', { id: containerId })

    const response = await this.request<{ container: Container }>(
      'POST',
      `/containers/${containerId}/restart`,
    )
    return response.container
  }

  /**
   * Get container logs
   */
  async getContainerLogs(
    request: GetContainerLogsRequest,
  ): Promise<GetContainerLogsResponse> {
    if (!this.initialized) await this.initialize()

    const params = new URLSearchParams()
    if (request.tail) {
      params.set('tail', request.tail.toString())
    }
    if (request.since) {
      params.set('since', request.since)
    }
    if (request.timestamps) {
      params.set('timestamps', 'true')
    }

    const queryString = params.toString()
    const path = queryString
      ? `/containers/${request.id}/logs?${queryString}`
      : `/containers/${request.id}/logs`

    return this.request<GetContainerLogsResponse>('GET', path)
  }

  /**
   * Execute command in container
   */
  async execContainer(
    request: ExecContainerRequest,
  ): Promise<ExecContainerResponse> {
    if (!this.initialized) await this.initialize()

    log.debug('Executing command in container', {
      id: request.id,
      command: request.command,
    })

    return this.request<ExecContainerResponse>(
      'POST',
      `/containers/${request.id}/exec`,
      {
        command: request.command,
        working_dir: request.workingDir,
        env: request.env,
        timeout: request.timeout,
      },
    )
  }

  // ============================================================================
  // Node Operations
  // ============================================================================

  /**
   * List available nodes
   */
  async listNodes(request?: ListNodesRequest): Promise<ListNodesResponse> {
    if (!this.initialized) await this.initialize()

    const params = new URLSearchParams()
    if (request?.status) {
      params.set('status', request.status.join(','))
    }
    if (request?.teeType) {
      params.set('tee_type', request.teeType)
    }
    if (request?.region) {
      params.set('region', request.region)
    }
    if (request?.limit) {
      params.set('limit', request.limit.toString())
    }
    if (request?.cursor) {
      params.set('cursor', request.cursor)
    }

    const queryString = params.toString()
    const path = queryString ? `/nodes?${queryString}` : '/nodes'

    return this.request<ListNodesResponse>('GET', path)
  }

  /**
   * Get node details
   */
  async getNode(nodeId: string): Promise<Node> {
    if (!this.initialized) await this.initialize()

    const response = await this.request<{ node: Node }>(
      'GET',
      `/nodes/${nodeId}`,
    )
    return response.node
  }

  // ============================================================================
  // Attestation Operations
  // ============================================================================

  /**
   * Get container attestation
   */
  async getAttestation(
    request: GetAttestationRequest,
  ): Promise<GetAttestationResponse> {
    if (!this.initialized) await this.initialize()

    const params = request.refresh ? '?refresh=true' : ''
    return this.request<GetAttestationResponse>(
      'GET',
      `/containers/${request.containerId}/attestation${params}`,
    )
  }

  /**
   * Refresh container attestation
   */
  async refreshAttestation(containerId: string): Promise<ContainerAttestation> {
    if (!this.initialized) await this.initialize()

    log.info('Refreshing attestation', { containerId })

    const response = await this.request<{ attestation: ContainerAttestation }>(
      'POST',
      `/containers/${containerId}/attestation/refresh`,
    )
    return response.attestation
  }

  /**
   * Verify container attestation against expected measurement
   */
  async verifyAttestation(
    containerId: string,
    expectedMeasurement: string,
  ): Promise<{ valid: boolean; attestation: ContainerAttestation }> {
    if (!this.initialized) await this.initialize()

    const response = await this.request<{
      valid: boolean
      attestation: ContainerAttestation
    }>('POST', `/containers/${containerId}/attestation/verify`, {
      expected_measurement: expectedMeasurement,
    })

    return response
  }

  // ============================================================================
  // Event Operations
  // ============================================================================

  /**
   * Get recent events
   */
  async getEvents(options?: {
    containerId?: string
    nodeId?: string
    type?: string[]
    since?: string
    limit?: number
  }): Promise<Event[]> {
    if (!this.initialized) await this.initialize()

    const params = new URLSearchParams()
    if (options?.containerId) {
      params.set('container_id', options.containerId)
    }
    if (options?.nodeId) {
      params.set('node_id', options.nodeId)
    }
    if (options?.type) {
      params.set('type', options.type.join(','))
    }
    if (options?.since) {
      params.set('since', options.since)
    }
    if (options?.limit) {
      params.set('limit', options.limit.toString())
    }

    const queryString = params.toString()
    const path = queryString ? `/events?${queryString}` : '/events'

    const response = await this.request<{ events: Event[] }>('GET', path)
    return response.events
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Wait for container to reach target status
   */
  async waitForStatus(
    containerId: string,
    targetStatus: ContainerStatus,
    timeout: number = 60000,
  ): Promise<Container> {
    const startTime = Date.now()
    const pollInterval = 2000

    while (Date.now() - startTime < timeout) {
      const { container } = await this.getContainer({ id: containerId })

      if (container.status === targetStatus) {
        return container
      }

      if (container.status === 'failed' || container.status === 'terminated') {
        throw new DStackError(
          `Container entered ${container.status} state: ${container.error}`,
          'CONTAINER_FAILED',
        )
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    }

    throw new DStackError(
      `Timeout waiting for container to reach ${targetStatus} status`,
      'TIMEOUT',
    )
  }

  /**
   * Find node with available resources
   */
  async findAvailableNode(requirements: {
    cpu?: number
    memory?: number
    gpu?: number
    teeType?: TEEType
    region?: string
  }): Promise<Node | null> {
    const { nodes } = await this.listNodes({
      status: ['online'],
      teeType: requirements.teeType,
      region: requirements.region,
    })

    for (const node of nodes) {
      const available = node.availableResources
      if (
        (requirements.cpu === undefined || available.cpu >= requirements.cpu) &&
        (requirements.memory === undefined ||
          available.memory >= requirements.memory) &&
        (requirements.gpu === undefined || available.gpu >= requirements.gpu) &&
        (requirements.teeType === undefined ||
          node.teeCapabilities.includes(requirements.teeType))
      ) {
        return node
      }
    }

    return null
  }

  /**
   * Get container count by status
   */
  async getContainerStats(): Promise<Record<ContainerStatus, number>> {
    const stats: Record<ContainerStatus, number> = {
      pending: 0,
      creating: 0,
      running: 0,
      stopping: 0,
      stopped: 0,
      failed: 0,
      terminated: 0,
    }

    let cursor: string | undefined
    do {
      const response = await this.listContainers({ cursor, limit: 100 })
      for (const container of response.containers) {
        stats[container.status]++
      }
      cursor = response.nextCursor
    } while (cursor)

    return stats
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: object,
  ): Promise<T> {
    const url = `${this.config.endpoint}${path}`
    const timeout = this.config.timeout ?? 30000
    const retry = this.config.retry ?? {
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 10000,
      backoffMultiplier: 2,
    }

    let lastError: Error | null = null
    let delay = retry.initialDelay

    for (let attempt = 0; attempt <= retry.maxRetries; attempt++) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
          ...this.config.headers,
        }

        if (this.config.projectId) {
          headers['X-Project-ID'] = this.config.projectId
        }

        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timeout),
        })

        if (!response.ok) {
          const errorBody = await response.text()
          let errorData: Record<string, unknown> = {}
          try {
            errorData = JSON.parse(errorBody)
          } catch {
            errorData = { message: errorBody }
          }

          const errorMessage =
            (errorData.message as string) ?? `HTTP ${response.status}`

          if (response.status === 401) {
            throw new DStackAuthError(errorMessage)
          }
          if (response.status === 404) {
            throw new DStackNotFoundError('resource', path)
          }
          if (response.status === 429) {
            throw new DStackQuotaError(errorMessage)
          }

          throw new DStackError(
            errorMessage,
            (errorData.code as string) ?? 'API_ERROR',
            response.status,
            errorData,
          )
        }

        const data: unknown = await response.json()
        return data as T
      } catch (error) {
        lastError = error as Error

        // Don't retry auth errors or not found
        if (
          error instanceof DStackAuthError ||
          error instanceof DStackNotFoundError
        ) {
          throw error
        }

        // Retry on network errors and 5xx
        if (attempt < retry.maxRetries) {
          log.warn('Request failed, retrying', {
            attempt: attempt + 1,
            maxRetries: retry.maxRetries,
            delay,
            error: lastError.message,
          })
          await new Promise((resolve) => setTimeout(resolve, delay))
          delay = Math.min(delay * retry.backoffMultiplier, retry.maxDelay)
        }
      }
    }

    throw lastError ?? new DStackError('Request failed', 'UNKNOWN')
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a dstack client instance
 */
export function createDStackClient(config: DStackConfig): DStackClient {
  return new DStackClient(config)
}

/**
 * Create a dstack client from environment variables
 */
export function createDStackClientFromEnv(): DStackClient {
  const endpoint = process.env.DSTACK_ENDPOINT
  const apiKey = process.env.DSTACK_API_KEY
  const projectId = process.env.DSTACK_PROJECT_ID

  if (!endpoint) {
    throw new Error('DSTACK_ENDPOINT environment variable is required')
  }
  if (!apiKey) {
    throw new Error('DSTACK_API_KEY environment variable is required')
  }

  return createDStackClient({
    endpoint,
    apiKey,
    projectId,
  })
}
