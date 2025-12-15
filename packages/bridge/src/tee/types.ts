/**
 * TEE Types
 *
 * Common types for all TEE providers.
 */

import type { Hex } from 'viem';
import type { TEEAttestation } from '../types/index.js';

// =============================================================================
// PROVIDER TYPES
// =============================================================================

export type TEEProvider =
  | 'auto' // Auto-detect best available
  | 'mock' // Local development mock
  | 'phala' // Phala Network (optional)
  | 'aws' // AWS Nitro Enclaves
  | 'gcp' // GCP Confidential Computing
  | 'azure'; // Azure SGX/SEV

export type TEECapability =
  | 'attestation' // Can generate attestation quotes
  | 'key_gen' // Can generate keys in enclave
  | 'gpu' // Has GPU TEE support
  | 'persistent'; // Has persistent enclave storage

export interface TEEProviderConfig {
  provider: TEEProvider;
  /** Endpoint URL (for Phala or self-hosted) */
  endpoint?: string;
  /** API key (optional) */
  apiKey?: string;
  /** AWS region (for Nitro) */
  awsRegion?: string;
  /** GCP project (for Confidential VMs) */
  gcpProject?: string;
  /** GCP zone */
  gcpZone?: string;
  /** Use GPU TEE if available */
  useGpu?: boolean;
  /** Timeout in ms */
  timeoutMs?: number;
}

// =============================================================================
// ATTESTATION TYPES
// =============================================================================

export interface AttestationRequest {
  /** Data to attest */
  data: Hex;
  /** Nonce for replay protection */
  nonce?: bigint;
  /** Additional user data */
  userData?: Hex;
}

export interface AttestationResponse {
  /** Raw attestation quote/document */
  quote: Uint8Array;
  /** Enclave measurement (mrEnclave/PCR) */
  measurement: Hex;
  /** Report data / user data hash */
  reportData: Hex;
  /** Signature over the attestation */
  signature: Hex;
  /** Timestamp when generated */
  timestamp: number;
  /** Provider-specific enclave ID */
  enclaveId: string;
  /** Provider type */
  provider: TEEProvider;
  /** Public key from enclave (if key gen supported) */
  publicKey?: Uint8Array;
}

export interface AttestationVerification {
  valid: boolean;
  provider: TEEProvider;
  measurement: Hex;
  timestamp: number;
  errors: string[];
}

// =============================================================================
// PROVIDER INTERFACE
// =============================================================================

export interface ITEEProvider {
  /** Provider type */
  readonly provider: TEEProvider;

  /** Capabilities this provider supports */
  readonly capabilities: TEECapability[];

  /** Initialize the provider */
  initialize(): Promise<void>;

  /** Check if provider is available */
  isAvailable(): Promise<boolean>;

  /** Request attestation */
  requestAttestation(request: AttestationRequest): Promise<AttestationResponse>;

  /** Verify an attestation */
  verifyAttestation(
    attestation: AttestationResponse
  ): Promise<AttestationVerification>;

  /** Convert to standard TEEAttestation format */
  toTEEAttestation(attestation: AttestationResponse): TEEAttestation;

  /** Get provider status/info */
  getStatus(): Promise<{
    available: boolean;
    enclaveId?: string;
    capabilities: TEECapability[];
    lastAttestationTime?: number;
  }>;
}

// =============================================================================
// AWS NITRO TYPES
// =============================================================================

export interface AWSNitroConfig {
  region: string;
  enclaveImageUri?: string;
  /** Instance type for enclave */
  instanceType?: string;
  /** Memory allocation for enclave (MB) */
  enclaveMemory?: number;
  /** CPU count for enclave */
  enclaveCpus?: number;
}

export interface NitroAttestationDocument {
  moduleId: string;
  timestamp: number;
  digest: string;
  pcrs: Record<number, string>;
  certificate: string;
  cabundle: string[];
  userData?: string;
  nonce?: string;
  publicKey?: string;
}

// =============================================================================
// GCP CONFIDENTIAL VM TYPES
// =============================================================================

export interface GCPConfidentialConfig {
  project: string;
  zone: string;
  /** Machine type (must support SEV/TDX) */
  machineType?: string;
  /** Use AMD SEV or Intel TDX */
  teeType?: 'sev' | 'tdx';
  /** Enable vTPM */
  enableVtpm?: boolean;
  /** GPU type if using confidential GPU */
  gpuType?: string;
}

export interface GCPAttestationToken {
  /** JWT token */
  token: string;
  /** Token claims */
  claims: {
    iss: string;
    sub: string;
    aud: string;
    exp: number;
    iat: number;
    secboot: boolean;
    swname: string;
    hwmodel: string;
    dbgstat: string;
  };
}

// =============================================================================
// DETECTION
// =============================================================================

export interface TEEEnvironment {
  /** Detected provider */
  provider: TEEProvider;
  /** Whether we're in a TEE environment */
  inTEE: boolean;
  /** Available capabilities */
  capabilities: TEECapability[];
  /** Environment details */
  details: {
    platform?: string;
    region?: string;
    instanceId?: string;
    enclaveId?: string;
  };
}
