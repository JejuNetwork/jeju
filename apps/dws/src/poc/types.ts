/**
 * Proof-of-Cloud Types
 */

import type { Address, Hex } from 'viem'

// TEE Types

export type TEEPlatform = 'intel_tdx' | 'intel_sgx' | 'amd_sev'

export interface TEEQuote {
  raw: Hex
  platform: TEEPlatform
  hardwareId: Hex
  measurement: Hex
  reportData: Hex
  securityVersion: { cpu: number; tcb: number }
  signature: Hex
  certChain: string[]
  timestamp: number | null
}

export interface DCAPQuoteHeader {
  version: number
  attestationKeyType: number
  teeType: number
  reserved: Hex
  vendorId: Hex
  userData: Hex
}

export interface TDXReportBody {
  teeTcbSvn: Hex
  mrSeam: Hex
  mrSignerSeam: Hex
  seamAttributes: Hex
  tdAttributes: Hex
  xfam: Hex
  mrTd: Hex
  mrConfigId: Hex
  mrOwner: Hex
  mrOwnerConfig: Hex
  rtMr0: Hex
  rtMr1: Hex
  rtMr2: Hex
  rtMr3: Hex
  reportData: Hex
}

export interface SEVSNPReport {
  version: number
  guestSvn: number
  policy: bigint
  familyId: Hex
  imageId: Hex
  vmpl: number
  signatureAlgo: number
  currentTcb: bigint
  platformInfo: bigint
  measurement: Hex
  hostData: Hex
  idKeyDigest: Hex
  authorKeyDigest: Hex
  reportId: Hex
  reportIdMa: Hex
  reportedTcb: bigint
  chipId: Hex
  signature: Hex
}

// Proof-of-Cloud Types

/** 1=human-supervised, 2=automated, 3=continuous */
export type PoCVerificationLevel = 1 | 2 | 3

export type PoCStatus =
  | 'verified'
  | 'pending'
  | 'rejected'
  | 'revoked'
  | 'unknown'

export interface PoCRegistryEntry {
  hardwareIdHash: Hex
  level: PoCVerificationLevel
  cloudProvider: string
  region: string
  evidenceHashes: string[]
  endorsements: PoCEndorsement[]
  verifiedAt: number
  lastVerifiedAt: number
  monitoringCadence: number
  active: boolean
}

export interface PoCEndorsement {
  memberId: string
  signature: Hex
  timestamp: number
}

export interface PoCVerificationRequest {
  agentId: bigint
  quote: Hex
  expectedMeasurement?: Hex
  nonce: Hex
  timestamp: number
  requester: Address
}

export interface PoCVerificationResult {
  requestHash: Hex
  agentId: bigint
  status: PoCStatus
  level: PoCVerificationLevel | null
  hardwareIdHash: Hex
  cloudProvider: string | null
  region: string | null
  evidenceHash: Hex
  timestamp: number
  oracleSignature: Hex
  score: number
}

export interface PoCRevocation {
  hardwareIdHash: Hex
  reason: string
  evidenceHash: Hex
  timestamp: number
  approvers: string[]
}

// On-Chain Constants

export const POC_TAGS = {
  PROVIDER: 'ProofOfCloud',
  LEVEL_1: 'Level1',
  LEVEL_2: 'Level2',
  LEVEL_3: 'Level3',
  REVOKED: 'Revoked',
  HARDWARE_INTEL_TDX: 'IntelTDX',
  HARDWARE_INTEL_SGX: 'IntelSGX',
  HARDWARE_AMD_SEV: 'AmdSEV',
} as const

export const POC_SCORES = {
  VERIFIED: 100,
  PENDING: 50,
  REJECTED: 0,
  REVOKED: 0,
} as const

export interface AgentPoCStatus {
  agentId: bigint
  verified: boolean
  level: PoCVerificationLevel | null
  platform: TEEPlatform | null
  hardwareIdHash: Hex | null
  lastVerifiedAt: number | null
  score: number
  requestHash: Hex | null
}

// Quote Parsing Types

export interface QuoteParseResult {
  success: boolean
  quote: TEEQuote | null
  error: string | null
}

export interface QuoteVerificationResult {
  valid: boolean
  quote: TEEQuote
  certificateValid: boolean
  signatureValid: boolean
  measurementMatch: boolean
  tcbStatus: 'upToDate' | 'outOfDate' | 'revoked' | 'unknown'
  error: string | null
}

// Errors

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

export class PoCError extends Error {
  constructor(
    public readonly code: PoCErrorCode,
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(`[${code}] ${message}`)
    this.name = 'PoCError'
  }
}

// Events

export interface PoCVerificationEvent {
  type: 'request' | 'result' | 'revocation' | 'error'
  timestamp: number
  agentId: bigint | null
  requestHash: Hex | null
  status: PoCStatus | null
  level: PoCVerificationLevel | null
  error: string | null
  metadata: Record<string, unknown>
}

export type PoCEventListener = (event: PoCVerificationEvent) => void
