/**
 * Jeju Storage SDK
 *
 * Decentralized storage marketplace with:
 * - Multi-provider support (IPFS, Cloud, Arweave)
 * - Automatic best provider selection
 * - x402 micropayments
 * - ERC-4337 multi-token payments
 * - A2A and MCP integration
 *
 * ARCHITECTURE:
 * - provider-interface.ts: Defines the interface ALL providers must implement
 * - marketplace-client.ts: Client for compute/other services to discover and use providers
 * - Vendor code (Vercel, S3, R2) is in backends/ and wrapped to implement the interface
 */

// Core SDK
export * from './types';
export * from './sdk';
export * from './payment';
export * from './router';
export * from './x402';
export * from './compute-integration';

// Provider Interface (for implementing new providers)
export * from './provider-interface';

// Marketplace Client (for consuming storage)
export * from './marketplace-client';

// Re-export commonly used items
export { JejuStorageSDK, createStorageSDK, StorageSDK } from './sdk';
export { StoragePaymentClient, createStoragePaymentClient, ZERO_ADDRESS } from './payment';
export { StorageRouter, createStorageRouter, createBackendForProvider } from './router';
export {
  StorageX402Client,
  calculateStorageCost,
  calculateRetrievalCost,
  formatStorageCost,
  createStoragePaymentRequirement,
  STORAGE_PRICING,
} from './x402';
export {
  StorageComputeIntegration,
  createComputeIntegration,
  type ComputeProviderInfo,
  type ComputeQuote,
  type ContainerCompatibility,
  type ComputeRentalForFile,
} from './compute-integration';

// Marketplace Client (for compute and other services)
export {
  StorageMarketplaceClient,
  createStorageMarketplaceClient,
  createComputeStorageClient,
} from './marketplace-client';

// Provider Interface Types
export type {
  ContentId,
  ProviderType,
  StorageTier,
  StorageUploadResult,
  StorageUploadOptions,
  ProviderCapabilities,
  ProviderPricing,
  ProviderHealth,
  RegisteredProvider,
  StorageProviderInterface,
  StorageProviderRegistry,
} from './provider-interface';

