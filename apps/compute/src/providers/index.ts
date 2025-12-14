/**
 * Compute Providers Module
 *
 * Exports all external compute provider integrations.
 */

// Akash Network
export * from './akash';

// Bridge Node
export {
  BridgeNodeService,
  createBridgeNodeFromEnv,
  getBridgeNodeService,
  resetBridgeNodeService,
} from './bridge-node';
export type { BridgeNodeServiceConfig } from './bridge-node';

// Payment Bridge
export {
  PaymentBridge,
  createPaymentBridgeFromEnv,
  getPaymentBridge,
  resetPaymentBridge,
} from './payment-bridge';
export type { PaymentBridgeConfig } from './payment-bridge';

// Container Registry
export {
  ContainerRegistryClient,
  createContainerRegistryFromEnv,
  getContainerRegistry,
  resetContainerRegistry,
} from './container-registry';
export type { ContainerRegistryConfig, ContainerReference } from './container-registry';

// Unified Compute
export {
  UnifiedComputeService,
  createUnifiedComputeFromEnv,
  getUnifiedCompute,
  resetUnifiedCompute,
} from './unified-compute';
export type {
  UnifiedComputeConfig,
  ComputeOffering,
  UnifiedDeployment,
  DeploymentRequest,
} from './unified-compute';

// Server
export { createServer, startServer } from './server';

// Re-export types from @jejunetwork/types
export type {
  ExternalProviderType,
  ExternalComputeProvider,
  DeploymentConfig,
  ExternalDeployment,
  BridgeNodeCredential,
  HardwareRequirements,
  HardwareCapabilities,
  ExternalProviderPricing,
} from '@jejunetwork/types';

export { ExternalProviderTypes, ProviderStatus, GPUTypes } from '@jejunetwork/types';

