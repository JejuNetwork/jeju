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
} from "./aws-nitro-provider.js";
// Core batcher
export { createTEEBatcher, TEEBatcher } from "./batcher.js";
// GCP Confidential provider
export {
	createGCPConfidentialProvider,
	GCPConfidentialProvider,
} from "./gcp-confidential-provider.js";
// Mock provider (for local dev)
export { createMockProvider, MockTEEProvider } from "./mock-provider.js";
// Phala provider (optional)
export {
	createPhalaClient,
	type PhalaAttestationRequest,
	type PhalaAttestationResponse,
	type PhalaBatchAttestation,
	PhalaClient,
	type PhalaConfig,
} from "./phala-client.js";
// TEE Manager (unified interface)
export {
	createTEEManager,
	getTEEManager,
	resetTEEManager,
	TEEManager,
} from "./tee-manager.js";
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
} from "./types.js";
