/**
 * Proof-of-Cloud Types
 * 
 * Types for TEE attestation verification against Proof-of-Cloud registry
 * to ensure hardware is running in verified, secure cloud facilities.
 */

import type { Address, Hex } from 'viem';

// ============================================================================
// TEE Types
// ============================================================================

/**
 * Supported TEE platforms
 */
export type TEEPlatform = 'intel_tdx' | 'intel_sgx' | 'amd_sev' | 'nvidia_cc';

/**
 * TEE attestation quote structure (parsed from raw bytes)
 */
export interface TEEQuote {
  /** Raw quote bytes (hex encoded) */
  raw: Hex;
  /** TEE platform type */
  platform: TEEPlatform;
  /** Hardware ID (PPID for Intel, Chip ID for AMD) */
  hardwareId: Hex;
  /** Enclave measurement (MRENCLAVE/MRTD) */
  measurement: Hex;
  /** Report data (user-provided nonce) */
  reportData: Hex;
  /** Security version numbers */
  securityVersion: {
    cpu: number;
    tcb: number;
  };
  /** Quote signature */
  signature: Hex;
  /** Certificate chain (PEM encoded) */
  certChain: string[];
  /** Quote generation timestamp (if available) */
  timestamp: number | null;
}

/**
 * Intel DCAP Quote header structure
 * Based on Intel SGX DCAP spec
 */
export interface DCAPQuoteHeader {
  version: number;
  attestationKeyType: number;
  teeType: number;
  reserved: Hex;
  vendorId: Hex;
  userData: Hex;
}

/**
 * Intel TDX Report body
 */
export interface TDXReportBody {
  teeTcbSvn: Hex;
  mrSeam: Hex;
  mrSignerSeam: Hex;
  seamAttributes: Hex;
  tdAttributes: Hex;
  xfam: Hex;
  mrTd: Hex;
  mrConfigId: Hex;
  mrOwner: Hex;
  mrOwnerConfig: Hex;
  rtMr0: Hex;
  rtMr1: Hex;
  rtMr2: Hex;
  rtMr3: Hex;
  reportData: Hex;
}

/**
 * AMD SEV-SNP attestation report
 */
export interface SEVSNPReport {
  version: number;
  guestSvn: number;
  policy: bigint;
  familyId: Hex;
  imageId: Hex;
  vmpl: number;
  signatureAlgo: number;
  currentTcb: bigint;
  platformInfo: bigint;
  measurement: Hex;
  hostData: Hex;
  idKeyDigest: Hex;
  authorKeyDigest: Hex;
  reportId: Hex;
  reportIdMa: Hex;
  reportedTcb: bigint;
  chipId: Hex;
  signature: Hex;
}

// ============================================================================
// Proof-of-Cloud Types
// ============================================================================

/**
 * PoC verification levels as defined by the alliance
 */
export type PoCVerificationLevel = 1 | 2 | 3;

/**
 * PoC verification status
 */
export type PoCStatus = 'verified' | 'pending' | 'rejected' | 'revoked' | 'unknown';

/**
 * PoC registry entry for verified hardware
 */
export interface PoCRegistryEntry {
  /** Salted hash of hardware ID (public) */
  hardwareIdHash: Hex;
  /** Verification level (1=human, 2=automated, 3=continuous) */
  level: PoCVerificationLevel;
  /** Cloud provider (e.g., "aws", "gcp", "azure") */
  cloudProvider: string;
  /** Data center region/location */
  region: string;
  /** Evidence hashes (IPFS CIDs or similar) */
  evidenceHashes: string[];
  /** Alliance member endorsements */
  endorsements: PoCEndorsement[];
  /** First verification timestamp */
  verifiedAt: number;
  /** Last verification timestamp */
  lastVerifiedAt: number;
  /** Monitoring cadence in seconds */
  monitoringCadence: number;
  /** Whether entry is currently active */
  active: boolean;
}

/**
 * PoC endorsement from an alliance member
 */
export interface PoCEndorsement {
  /** Alliance member identifier */
  memberId: string;
  /** Endorsement signature */
  signature: Hex;
  /** Endorsement timestamp */
  timestamp: number;
}

/**
 * PoC verification request (submitted to oracle)
 */
export interface PoCVerificationRequest {
  /** Agent ID in ERC-8004 registry */
  agentId: bigint;
  /** Raw attestation quote */
  quote: Hex;
  /** Expected measurement (optional, for code integrity check) */
  expectedMeasurement?: Hex;
  /** Nonce for freshness */
  nonce: Hex;
  /** Request timestamp */
  timestamp: number;
  /** Requester address */
  requester: Address;
}

/**
 * PoC verification result
 */
export interface PoCVerificationResult {
  /** Request hash */
  requestHash: Hex;
  /** Agent ID */
  agentId: bigint;
  /** Verification status */
  status: PoCStatus;
  /** Verification level (if verified) */
  level: PoCVerificationLevel | null;
  /** Hardware ID hash (salted) */
  hardwareIdHash: Hex;
  /** Cloud provider (if verified) */
  cloudProvider: string | null;
  /** Region (if verified) */
  region: string | null;
  /** Evidence hash */
  evidenceHash: Hex;
  /** Verification timestamp */
  timestamp: number;
  /** Oracle signature */
  oracleSignature: Hex;
  /** Verification score (0-100 for on-chain) */
  score: number;
}

/**
 * PoC revocation event
 */
export interface PoCRevocation {
  /** Hardware ID hash */
  hardwareIdHash: Hex;
  /** Reason for revocation */
  reason: string;
  /** Evidence of compromise */
  evidenceHash: Hex;
  /** Revocation timestamp */
  timestamp: number;
  /** Alliance members who approved revocation */
  approvers: string[];
}

// ============================================================================
// Oracle Types
// ============================================================================

/**
 * PoC oracle configuration
 */
export interface PoCOracleConfig {
  /** Oracle signer addresses (for multisig) */
  signers: Address[];
  /** Required signatures threshold */
  threshold: number;
  /** Registry contract address */
  validatorContract: Address;
  /** Identity registry address */
  identityRegistry: Address;
  /** Validation registry address */
  validationRegistry: Address;
  /** PoC registry API endpoint (if available) */
  registryEndpoint: string | null;
  /** Verification timeout in ms */
  verificationTimeout: number;
  /** Re-verification interval in ms */
  reverificationInterval: number;
}

/**
 * Oracle signer role
 */
export interface OracleSigner {
  address: Address;
  name: string;
  publicKey: Hex;
  active: boolean;
  addedAt: number;
}

/**
 * Pending multisig verification
 */
export interface PendingVerification {
  requestHash: Hex;
  request: PoCVerificationRequest;
  result: PoCVerificationResult | null;
  signatures: Map<Address, Hex>;
  createdAt: number;
  expiresAt: number;
}

// ============================================================================
// On-Chain Types
// ============================================================================

/**
 * Validation request tag constants
 */
export const POC_TAGS = {
  PROVIDER: 'ProofOfCloud',
  LEVEL_1: 'Level1',
  LEVEL_2: 'Level2',
  LEVEL_3: 'Level3',
  REVOKED: 'Revoked',
  HARDWARE_INTEL_TDX: 'IntelTDX',
  HARDWARE_INTEL_SGX: 'IntelSGX',
  HARDWARE_AMD_SEV: 'AmdSEV',
  HARDWARE_NVIDIA_CC: 'NvidiaCc',
} as const;

/**
 * Validation response scores
 */
export const POC_SCORES = {
  VERIFIED: 100,
  PENDING: 50,
  REJECTED: 0,
  REVOKED: 0,
} as const;

/**
 * Agent PoC status (derived from on-chain data)
 */
export interface AgentPoCStatus {
  agentId: bigint;
  verified: boolean;
  level: PoCVerificationLevel | null;
  platform: TEEPlatform | null;
  hardwareIdHash: Hex | null;
  lastVerifiedAt: number | null;
  score: number;
  requestHash: Hex | null;
}

// ============================================================================
// Quote Parsing Types
// ============================================================================

/**
 * Quote parsing result
 */
export interface QuoteParseResult {
  success: boolean;
  quote: TEEQuote | null;
  error: string | null;
}

/**
 * Quote verification result
 */
export interface QuoteVerificationResult {
  valid: boolean;
  quote: TEEQuote;
  certificateValid: boolean;
  signatureValid: boolean;
  measurementMatch: boolean;
  tcbStatus: 'upToDate' | 'outOfDate' | 'revoked' | 'unknown';
  error: string | null;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * PoC-specific error codes
 */
export enum PoCErrorCode {
  INVALID_QUOTE = 'INVALID_QUOTE',
  QUOTE_EXPIRED = 'QUOTE_EXPIRED',
  UNSUPPORTED_PLATFORM = 'UNSUPPORTED_PLATFORM',
  SIGNATURE_INVALID = 'SIGNATURE_INVALID',
  CERTIFICATE_INVALID = 'CERTIFICATE_INVALID',
  TCB_OUT_OF_DATE = 'TCB_OUT_OF_DATE',
  HARDWARE_NOT_REGISTERED = 'HARDWARE_NOT_REGISTERED',
  HARDWARE_REVOKED = 'HARDWARE_REVOKED',
  ORACLE_UNAVAILABLE = 'ORACLE_UNAVAILABLE',
  INSUFFICIENT_SIGNATURES = 'INSUFFICIENT_SIGNATURES',
  VERIFICATION_TIMEOUT = 'VERIFICATION_TIMEOUT',
  AGENT_NOT_FOUND = 'AGENT_NOT_FOUND',
}

/**
 * PoC error with code and context
 */
export class PoCError extends Error {
  constructor(
    public readonly code: PoCErrorCode,
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(`[${code}] ${message}`);
    this.name = 'PoCError';
  }
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * PoC verification event for logging/monitoring
 */
export interface PoCVerificationEvent {
  type: 'request' | 'result' | 'revocation' | 'error';
  timestamp: number;
  agentId: bigint | null;
  requestHash: Hex | null;
  status: PoCStatus | null;
  level: PoCVerificationLevel | null;
  error: string | null;
  metadata: Record<string, unknown>;
}

/**
 * Event listener type
 */
export type PoCEventListener = (event: PoCVerificationEvent) => void;


