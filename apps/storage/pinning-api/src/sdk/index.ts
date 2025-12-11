/**
 * Jeju Storage SDK
 *
 * Decentralized storage marketplace with:
 * - Multi-provider support (IPFS, Cloud, Arweave)
 * - Automatic best provider selection
 * - x402 micropayments
 * - ERC-4337 multi-token payments
 * - A2A and MCP integration
 */

// SDK
export * from './types';
export * from './sdk';
export * from './payment';
export * from './router';
export * from './x402';
export * from './compute-integration';

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

