import type { Hex } from 'viem'
import type { TEEBatchAttestation } from '../types/index.js'

export type TEEProvider = 'auto' | 'mock' | 'phala' | 'gcp' | 'dstack' | 'azure'

export type TEECapability = 'attestation' | 'key_gen' | 'gpu' | 'persistent'

export interface TEEProviderConfig {
  provider: TEEProvider
  endpoint?: string
  apiKey?: string
  gcpProject?: string
  gcpZone?: string
  useGpu?: boolean
  timeoutMs?: number
  requireRealTEE?: boolean
  operatorAddress?: `0x${string}`
}

export interface AttestationRequest {
  data: Hex
  nonce?: bigint
  userData?: Hex
}

export interface AttestationResponse {
  quote: Uint8Array
  measurement: Hex
  reportData: Hex
  signature: Hex
  timestamp: number
  enclaveId: string
  provider: TEEProvider
  publicKey?: Uint8Array
}

export interface AttestationVerification {
  valid: boolean
  provider: TEEProvider
  measurement: Hex
  timestamp: number
  errors: string[]
}

export interface ITEEProvider {
  readonly provider: TEEProvider
  readonly capabilities: TEECapability[]
  initialize(): Promise<void>
  isAvailable(): Promise<boolean>
  requestAttestation(request: AttestationRequest): Promise<AttestationResponse>
  verifyAttestation(
    attestation: AttestationResponse,
  ): Promise<AttestationVerification>
  toTEEAttestation(attestation: AttestationResponse): TEEBatchAttestation
  getStatus(): Promise<{
    available: boolean
    enclaveId?: string
    capabilities: TEECapability[]
    lastAttestationTime?: number
  }>
}

export interface GCPConfidentialConfig {
  project: string
  zone: string
  machineType?: string
  teeType?: 'sev' | 'tdx'
  enableVtpm?: boolean
  gpuType?: string
}

export interface GCPAttestationToken {
  token: string
  claims: {
    iss: string
    sub: string
    aud: string
    exp: number
    iat: number
    secboot: boolean
    swname: string
    hwmodel: string
    dbgstat: string
  }
}

export interface TEEEnvironment {
  provider: TEEProvider
  inTEE: boolean
  capabilities: TEECapability[]
  details: {
    platform?: string
    region?: string
    instanceId?: string
    enclaveId?: string
  }
}
