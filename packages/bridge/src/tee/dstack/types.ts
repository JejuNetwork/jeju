/**
 * dstack SDK Types
 *
 * Type definitions for Phala Cloud dstack API integration.
 * dstack provides TEE container orchestration on Phala Network.
 */

import { z } from 'zod'

// ============================================================================
// Container Types
// ============================================================================

export type ContainerStatus =
  | 'pending'
  | 'creating'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'failed'
  | 'terminated'

export type TEEType = 'tdx' | 'sgx' | 'sev-snp' | 'none'

export interface ContainerSpec {
  /** Container image */
  image: string
  /** Container name */
  name: string
  /** Environment variables */
  env?: Record<string, string>
  /** Command to run */
  command?: string[]
  /** Arguments to command */
  args?: string[]
  /** CPU cores (fractional allowed) */
  cpu?: number
  /** Memory in MB */
  memory?: number
  /** GPU count */
  gpu?: number
  /** TEE type to use */
  teeType?: TEEType
  /** Ports to expose */
  ports?: PortMapping[]
  /** Volume mounts */
  volumes?: VolumeMount[]
  /** Health check configuration */
  healthCheck?: HealthCheck
  /** Auto-restart policy */
  restartPolicy?: 'always' | 'on-failure' | 'never'
  /** Maximum retries for on-failure */
  maxRetries?: number
}

export interface PortMapping {
  /** Container port */
  containerPort: number
  /** Host port (0 for random) */
  hostPort?: number
  /** Protocol */
  protocol?: 'tcp' | 'udp'
}

export interface VolumeMount {
  /** Volume name or path */
  source: string
  /** Mount path in container */
  target: string
  /** Read-only mount */
  readOnly?: boolean
}

export interface HealthCheck {
  /** Health check command */
  command?: string[]
  /** HTTP health check path */
  httpPath?: string
  /** HTTP health check port */
  httpPort?: number
  /** Interval between checks (seconds) */
  interval?: number
  /** Timeout for check (seconds) */
  timeout?: number
  /** Retries before unhealthy */
  retries?: number
  /** Start period (seconds) */
  startPeriod?: number
}

export interface Container {
  /** Unique container ID */
  id: string
  /** Container name */
  name: string
  /** Current status */
  status: ContainerStatus
  /** Container image */
  image: string
  /** TEE type */
  teeType: TEEType
  /** Creation timestamp */
  createdAt: string
  /** Start timestamp */
  startedAt?: string
  /** Stopped timestamp */
  stoppedAt?: string
  /** Assigned node ID */
  nodeId?: string
  /** Public endpoint (if ports exposed) */
  endpoint?: string
  /** Port mappings */
  ports: PortMapping[]
  /** Resource usage */
  resources: ResourceUsage
  /** TEE attestation */
  attestation?: ContainerAttestation
  /** Last error message */
  error?: string
}

export interface ResourceUsage {
  /** CPU usage (0-100%) */
  cpuPercent: number
  /** Memory usage in MB */
  memoryMb: number
  /** Network RX bytes */
  networkRxBytes: number
  /** Network TX bytes */
  networkTxBytes: number
  /** Disk read bytes */
  diskReadBytes: number
  /** Disk write bytes */
  diskWriteBytes: number
}

export interface ContainerAttestation {
  /** Attestation quote */
  quote: string
  /** Enclave measurement */
  mrEnclave: string
  /** Signer measurement */
  mrSigner: string
  /** Attestation timestamp */
  timestamp: number
  /** Verification status */
  verified: boolean
}

// ============================================================================
// Node Types
// ============================================================================

export type NodeStatus = 'online' | 'offline' | 'maintenance' | 'draining'

export interface Node {
  /** Unique node ID */
  id: string
  /** Node name */
  name: string
  /** Current status */
  status: NodeStatus
  /** TEE capabilities */
  teeCapabilities: TEEType[]
  /** Total resources */
  totalResources: NodeResources
  /** Available resources */
  availableResources: NodeResources
  /** Running containers */
  containerCount: number
  /** Node region */
  region: string
  /** Node zone */
  zone?: string
  /** Last heartbeat timestamp */
  lastHeartbeat: string
  /** Node attestation */
  attestation?: NodeAttestation
}

export interface NodeResources {
  /** CPU cores */
  cpu: number
  /** Memory in MB */
  memory: number
  /** GPU count */
  gpu: number
  /** Disk in GB */
  disk: number
}

export interface NodeAttestation {
  /** Attestation quote */
  quote: string
  /** Platform measurement */
  measurement: string
  /** Attestation timestamp */
  timestamp: number
  /** Valid until */
  expiresAt: number
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface CreateContainerRequest {
  spec: ContainerSpec
  /** Preferred region */
  region?: string
  /** Preferred zone */
  zone?: string
  /** Node affinity labels */
  nodeSelector?: Record<string, string>
  /** Wait for container to be running */
  waitForReady?: boolean
  /** Timeout for waitForReady (ms) */
  waitTimeout?: number
}

export interface CreateContainerResponse {
  container: Container
  /** Request ID for tracking */
  requestId: string
}

export interface ListContainersRequest {
  /** Filter by status */
  status?: ContainerStatus[]
  /** Filter by name prefix */
  namePrefix?: string
  /** Filter by image */
  image?: string
  /** Page size */
  limit?: number
  /** Pagination cursor */
  cursor?: string
}

export interface ListContainersResponse {
  containers: Container[]
  /** Next page cursor */
  nextCursor?: string
  /** Total count */
  total: number
}

export interface GetContainerRequest {
  /** Container ID */
  id: string
}

export interface GetContainerResponse {
  container: Container
}

export interface DeleteContainerRequest {
  /** Container ID */
  id: string
  /** Force stop if running */
  force?: boolean
}

export interface DeleteContainerResponse {
  /** Whether deletion was successful */
  success: boolean
  /** Request ID for tracking */
  requestId: string
}

export interface GetContainerLogsRequest {
  /** Container ID */
  id: string
  /** Number of lines to return */
  tail?: number
  /** Return logs since this timestamp */
  since?: string
  /** Include timestamps */
  timestamps?: boolean
  /** Stream logs (not supported yet) */
  follow?: boolean
}

export interface GetContainerLogsResponse {
  logs: string
  /** Next available cursor for pagination */
  nextCursor?: string
}

export interface ExecContainerRequest {
  /** Container ID */
  id: string
  /** Command to execute */
  command: string[]
  /** Working directory */
  workingDir?: string
  /** Environment variables */
  env?: Record<string, string>
  /** Timeout in ms */
  timeout?: number
}

export interface ExecContainerResponse {
  /** Exit code */
  exitCode: number
  /** Standard output */
  stdout: string
  /** Standard error */
  stderr: string
}

export interface ListNodesRequest {
  /** Filter by status */
  status?: NodeStatus[]
  /** Filter by TEE capability */
  teeType?: TEEType
  /** Filter by region */
  region?: string
  /** Page size */
  limit?: number
  /** Pagination cursor */
  cursor?: string
}

export interface ListNodesResponse {
  nodes: Node[]
  /** Next page cursor */
  nextCursor?: string
  /** Total count */
  total: number
}

export interface GetAttestationRequest {
  /** Container ID */
  containerId: string
  /** Force refresh attestation */
  refresh?: boolean
}

export interface GetAttestationResponse {
  attestation: ContainerAttestation
}

// ============================================================================
// Event Types
// ============================================================================

export type EventType =
  | 'container.created'
  | 'container.started'
  | 'container.stopped'
  | 'container.failed'
  | 'container.deleted'
  | 'container.health_changed'
  | 'node.online'
  | 'node.offline'
  | 'attestation.refreshed'
  | 'attestation.expired'

export interface Event {
  /** Event ID */
  id: string
  /** Event type */
  type: EventType
  /** Event timestamp */
  timestamp: string
  /** Container ID (if applicable) */
  containerId?: string
  /** Node ID (if applicable) */
  nodeId?: string
  /** Event data */
  data: Record<string, unknown>
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface DStackConfig {
  /** dstack API endpoint */
  endpoint: string
  /** API key for authentication */
  apiKey: string
  /** Project ID */
  projectId?: string
  /** Request timeout (ms) */
  timeout?: number
  /** Retry configuration */
  retry?: RetryConfig
  /** Custom headers */
  headers?: Record<string, string>
}

export interface RetryConfig {
  /** Maximum retries */
  maxRetries: number
  /** Initial delay (ms) */
  initialDelay: number
  /** Maximum delay (ms) */
  maxDelay: number
  /** Backoff multiplier */
  backoffMultiplier: number
}

// ============================================================================
// Zod Schemas for Validation
// ============================================================================

export const ContainerStatusSchema = z.enum([
  'pending',
  'creating',
  'running',
  'stopping',
  'stopped',
  'failed',
  'terminated',
])

export const TEETypeSchema = z.enum(['tdx', 'sgx', 'sev-snp', 'none'])

export const PortMappingSchema = z.object({
  containerPort: z.number().int().positive(),
  hostPort: z.number().int().nonnegative().optional(),
  protocol: z.enum(['tcp', 'udp']).optional(),
})

export const VolumeMountSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  readOnly: z.boolean().optional(),
})

export const HealthCheckSchema = z.object({
  command: z.array(z.string()).optional(),
  httpPath: z.string().optional(),
  httpPort: z.number().int().positive().optional(),
  interval: z.number().int().positive().optional(),
  timeout: z.number().int().positive().optional(),
  retries: z.number().int().positive().optional(),
  startPeriod: z.number().int().nonnegative().optional(),
})

export const ContainerSpecSchema = z.object({
  image: z.string().min(1),
  name: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
  env: z.record(z.string(), z.string()).optional(),
  command: z.array(z.string()).optional(),
  args: z.array(z.string()).optional(),
  cpu: z.number().positive().optional(),
  memory: z.number().int().positive().optional(),
  gpu: z.number().int().nonnegative().optional(),
  teeType: TEETypeSchema.optional(),
  ports: z.array(PortMappingSchema).optional(),
  volumes: z.array(VolumeMountSchema).optional(),
  healthCheck: HealthCheckSchema.optional(),
  restartPolicy: z.enum(['always', 'on-failure', 'never']).optional(),
  maxRetries: z.number().int().positive().optional(),
})

export const ResourceUsageSchema = z.object({
  cpuPercent: z.number().nonnegative(),
  memoryMb: z.number().nonnegative(),
  networkRxBytes: z.number().nonnegative(),
  networkTxBytes: z.number().nonnegative(),
  diskReadBytes: z.number().nonnegative(),
  diskWriteBytes: z.number().nonnegative(),
})

export const ContainerAttestationSchema = z.object({
  quote: z.string(),
  mrEnclave: z.string(),
  mrSigner: z.string(),
  timestamp: z.number(),
  verified: z.boolean(),
})

export const ContainerSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: ContainerStatusSchema,
  image: z.string(),
  teeType: TEETypeSchema,
  createdAt: z.string(),
  startedAt: z.string().optional(),
  stoppedAt: z.string().optional(),
  nodeId: z.string().optional(),
  endpoint: z.string().optional(),
  ports: z.array(PortMappingSchema),
  resources: ResourceUsageSchema,
  attestation: ContainerAttestationSchema.optional(),
  error: z.string().optional(),
})

export const DStackConfigSchema = z.object({
  endpoint: z.string().url(),
  apiKey: z.string().min(1),
  projectId: z.string().optional(),
  timeout: z.number().int().positive().optional(),
  retry: z
    .object({
      maxRetries: z.number().int().nonnegative(),
      initialDelay: z.number().int().positive(),
      maxDelay: z.number().int().positive(),
      backoffMultiplier: z.number().positive(),
    })
    .optional(),
  headers: z.record(z.string(), z.string()).optional(),
})
