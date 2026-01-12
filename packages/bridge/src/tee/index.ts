/**
 * TEE Module
 *
 * Unified TEE provider management with support for:
 * - AWS Nitro Enclaves (production)
 * - GCP Confidential Computing (production)
 * - Phala Network (optional)
 * - Mock provider (local development)
 *
 * Auto-detects the best available provider based on environment.
 */

// AWS Nitro provider
export {
  AWSNitroProvider,
  createAWSNitroProvider,
} from './aws-nitro-provider.js'
// Core batcher
export { createTEEBatcher, TEEBatcher } from './batcher.js'
// DCAP Verifier (Intel SGX/TDX quote verification)
export {
  createDCAPVerifier,
  DCAPVerifier,
  type DCAPVerifierConfig,
  type ParsedQuote,
  parseQuote,
  type QuoteHeader,
  type QuoteSignature,
  type SGXReportBody,
  type TDXReportBody,
  type TEEPlatformType,
  type TrustedMeasurement,
  type VerificationResult,
  validateCertChain,
  verifyQuoteSignature,
} from './dcap-verifier.js'
// Billing Tracker (container cost and earnings management)
export {
  type BillingConfig,
  type BillingStats,
  BillingTracker,
  type ContainerCosts,
  createBillingTracker,
  type WithdrawalRecord,
} from './dstack/billing.js'
// dstack SDK (Phala Cloud container orchestration)
export {
  type Container,
  type ContainerAttestation,
  type ContainerSpec,
  type ContainerStatus,
  type CreateContainerRequest,
  type CreateContainerResponse,
  createDStackClient,
  createDStackClientFromEnv,
  DStackAuthError,
  DStackClient,
  type DStackConfig,
  DStackError,
  DStackNotFoundError,
  DStackQuotaError,
  type Node as DStackNode,
  type TEEType as DStackTEEType,
} from './dstack/index.js'
// TEE Provisioner (auto-scaling container management)
export {
  createTEEProvisioner,
  type ManagedContainer,
  type ProvisionerConfig,
  type ProvisionerMetrics,
  type ProvisionerState,
  type ScalingDecision,
  TEEProvisioner,
} from './dstack/provisioner.js'
// GCP Confidential provider
export {
  createGCPConfidentialProvider,
  GCPConfidentialProvider,
} from './gcp-confidential-provider.js'
// Mock provider (for local dev)
export { createMockProvider, MockTEEProvider } from './mock-provider.js'
// Phala provider (optional)
export {
  createPhalaClient,
  type PhalaAttestationRequest,
  type PhalaAttestationResponse,
  type PhalaBatchAttestation,
  PhalaClient,
  type PhalaConfig,
} from './phala-client.js'
// TEE Manager (unified interface)
export {
  createTEEManager,
  getTEEManager,
  resetTEEManager,
  TEEManager,
} from './tee-manager.js'
// Types
export type {
  AttestationRequest,
  AttestationResponse,
  AttestationVerification,
  AWSNitroConfig,
  GCPAttestationToken,
  GCPConfidentialConfig,
  ITEEProvider,
  NitroAttestationDocument,
  TEECapability,
  TEEEnvironment,
  TEEProvider,
  TEEProviderConfig,
} from './types.js'
