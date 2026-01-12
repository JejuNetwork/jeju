/**
 * dstack SDK Module
 *
 * Phala Cloud TEE container orchestration.
 */

export {
  type BillingConfig,
  type BillingStats,
  BillingTracker,
  type ContainerCosts,
  createBillingTracker,
  type WithdrawalRecord,
} from './billing.js'
export {
  createDStackClient,
  createDStackClientFromEnv,
  DStackAuthError,
  DStackClient,
  DStackError,
  DStackNotFoundError,
  DStackQuotaError,
} from './client.js'
export {
  createTEEProvisioner,
  type ManagedContainer,
  type ProvisionerConfig,
  type ProvisionerMetrics,
  type ProvisionerState,
  type ScalingDecision,
  TEEProvisioner,
} from './provisioner.js'

export type {
  Container,
  ContainerAttestation,
  ContainerSpec,
  ContainerStatus,
  CreateContainerRequest,
  CreateContainerResponse,
  DeleteContainerRequest,
  DeleteContainerResponse,
  DStackConfig,
  Event,
  EventType,
  ExecContainerRequest,
  ExecContainerResponse,
  GetAttestationRequest,
  GetAttestationResponse,
  GetContainerLogsRequest,
  GetContainerLogsResponse,
  GetContainerRequest,
  GetContainerResponse,
  HealthCheck,
  ListContainersRequest,
  ListContainersResponse,
  ListNodesRequest,
  ListNodesResponse,
  Node,
  NodeAttestation,
  NodeResources,
  NodeStatus,
  PortMapping,
  ResourceUsage,
  RetryConfig,
  TEEType,
  VolumeMount,
} from './types.js'

export {
  ContainerAttestationSchema,
  ContainerSchema,
  ContainerSpecSchema,
  ContainerStatusSchema,
  DStackConfigSchema,
  HealthCheckSchema,
  PortMappingSchema,
  ResourceUsageSchema,
  TEETypeSchema,
  VolumeMountSchema,
} from './types.js'
