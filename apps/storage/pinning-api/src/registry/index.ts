/**
 * Registry Services Index
 * 
 * Exports all decentralized developer infrastructure services:
 * - OCI Container Registry (Docker V2 API)
 * - NPM Package Registry
 * - Git Repository Registry
 * - ERC-8004 Reputation Integration
 */

// OCI Container Registry
export {
  OCIRegistry,
  createOCIRegistry,
  createRegistryRouter,
  type RegistryConfig,
  type Manifest,
  type BlobDescriptor,
  type RegistryAccount,
  type ImageRecord,
  type StorageBackend,
} from './oci-registry';

// NPM Package Registry
export {
  NPMRegistry,
  createNPMRegistry,
  createNPMRegistryRouter,
  type NPMRegistryConfig,
  type PackageVersion,
  type PackageManifest,
  type PackageRecord,
  type PublisherAccount,
} from './npm-registry';

// Reputation Integration
export {
  ReputationIntegration,
  createReputationIntegration,
  type ReputationConfig,
  type ReputationScore,
  type PackageMetrics,
  type RepoMetrics,
} from './reputation-integration';

// Re-export A2A and MCP servers
export { createRegistryA2AServer } from './registry-a2a';
export { createRegistryMCPServer } from './registry-mcp';
