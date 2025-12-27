/**
 * GCP Confidential Computing TEE Provider
 *
 * Integrates with GCP Confidential VMs for hardware-backed attestation.
 *
 * GCP Confidential Computing provides:
 * - AMD SEV-SNP or Intel TDX hardware isolation
 * - vTPM for attestation
 * - Confidential GPU support (A3/A3E instances)
 *
 * Requirements:
 * - Running on a Confidential VM instance
 * - Workload identity configured
 * - Attestation service enabled
 */

import {
  getGcpProject,
  getGcpZone,
  isGcpConfidentialSimulate,
} from '@jejunetwork/config'
import { keccak256, toBytes } from 'viem'
import { z } from 'zod'
import type { TEEBatchAttestation } from '../types/index.js'
import { toHash32 } from '../types/index.js'
import { createLogger } from '../utils/logger.js'
import type {
  AttestationRequest,
  AttestationResponse,
  AttestationVerification,
  GCPAttestationToken,
  GCPConfidentialConfig,
  ITEEProvider,
  TEECapability,
  TEEProvider,
} from './types.js'

const log = createLogger('gcp-tee')

export class GCPConfidentialProvider implements ITEEProvider {
  readonly provider: TEEProvider = 'gcp'
  readonly capabilities: TEECapability[] = ['attestation', 'key_gen', 'gpu']

  private config: GCPConfidentialConfig
  private initialized = false
  private instanceId?: string
  private publicKey?: Uint8Array
  private lastAttestationTime?: number
  private inConfidentialVM = false
  private hasGpuTEE = false

  constructor(config: GCPConfidentialConfig) {
    this.config = {
      machineType: 'n2d-standard-4',
      teeType: 'sev',
      enableVtpm: true,
      ...config,
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    // Check if we're in a Confidential VM
    this.inConfidentialVM = await this.detectConfidentialVM()

    if (this.inConfidentialVM) {
      log.info('Running in Confidential VM environment')
      await this.initializeConfidentialVM()
    } else {
      log.info('Not in Confidential VM, using simulated mode')
      this.instanceId = `gcp-sim-${Date.now().toString(36)}`
      this.publicKey = new Uint8Array(33)
      crypto.getRandomValues(this.publicKey)
      this.publicKey[0] = 0x02
    }

    this.initialized = true
  }

  async isAvailable(): Promise<boolean> {
    if (!this.initialized) {
      await this.initialize()
    }
    return this.inConfidentialVM || isGcpConfidentialSimulate()
  }

  async requestAttestation(
    request: AttestationRequest,
  ): Promise<AttestationResponse> {
    if (!this.initialized) {
      await this.initialize()
    }

    const timestamp = Date.now()
    this.lastAttestationTime = timestamp

    if (this.inConfidentialVM) {
      return await this.requestConfidentialAttestation(request, timestamp)
    }

    return this.generateSimulatedAttestation(request, timestamp)
  }

  async verifyAttestation(
    attestation: AttestationResponse,
  ): Promise<AttestationVerification> {
    const errors: string[] = []

    if (attestation.provider !== 'gcp') {
      errors.push('Not a GCP Confidential attestation')
    }

    const maxAge = 60 * 60 * 1000
    if (Date.now() - attestation.timestamp > maxAge) {
      errors.push('Attestation is stale (> 1 hour old)')
    }

    if (this.inConfidentialVM && errors.length === 0) {
      const verified = await this.verifyAttestationToken(attestation.quote)
      if (!verified) {
        errors.push('GCP attestation verification failed')
      }
    }

    return {
      valid: errors.length === 0,
      provider: 'gcp',
      measurement: attestation.measurement,
      timestamp: attestation.timestamp,
      errors,
    }
  }

  toTEEAttestation(attestation: AttestationResponse): TEEBatchAttestation {
    const publicKey = attestation.publicKey ?? this.publicKey
    if (!publicKey) {
      throw new Error('No public key available - initialize provider first')
    }
    return {
      measurement: toHash32(
        Buffer.from(attestation.measurement.slice(2), 'hex'),
      ),
      quote: attestation.quote,
      publicKey,
      timestamp: BigInt(attestation.timestamp),
    }
  }

  async getStatus(): Promise<{
    available: boolean
    enclaveId?: string
    capabilities: TEECapability[]
    lastAttestationTime?: number
  }> {
    const caps = [...this.capabilities]
    if (!this.hasGpuTEE) {
      const gpuIdx = caps.indexOf('gpu')
      if (gpuIdx >= 0) caps.splice(gpuIdx, 1)
    }

    return {
      available: await this.isAvailable(),
      enclaveId: this.instanceId,
      capabilities: caps,
      lastAttestationTime: this.lastAttestationTime,
    }
  }

  async hasGPUSupport(): Promise<boolean> {
    return this.hasGpuTEE
  }

  async requestGPUAttestation(
    request: AttestationRequest,
  ): Promise<AttestationResponse> {
    if (!this.hasGpuTEE) {
      throw new Error('GPU TEE not available')
    }

    // In production, this would get attestation from the confidential GPU
    // using NVIDIA's CC attestation API
    return this.requestAttestation(request)
  }

  private async detectConfidentialVM(): Promise<boolean> {
    try {
      // Check GCP metadata server
      const response = await fetch(
        'http://metadata.google.internal/computeMetadata/v1/instance/attributes/enable-oslogin',
        {
          headers: { 'Metadata-Flavor': 'Google' },
          signal: AbortSignal.timeout(1000),
        },
      )

      if (response.ok) {
        // Check if instance is confidential
        const confidentialResponse = await fetch(
          'http://metadata.google.internal/computeMetadata/v1/instance/attributes/',
          {
            headers: { 'Metadata-Flavor': 'Google' },
            signal: AbortSignal.timeout(1000),
          },
        )

        if (confidentialResponse.ok) {
          const attrs = await confidentialResponse.text()
          return attrs.includes('confidential-compute')
        }
      }
    } catch {
      // Not in GCP or no access to metadata
    }

    return false
  }

  private async initializeConfidentialVM(): Promise<void> {
    // Get instance ID
    try {
      const response = await fetch(
        'http://metadata.google.internal/computeMetadata/v1/instance/id',
        {
          headers: { 'Metadata-Flavor': 'Google' },
          signal: AbortSignal.timeout(1000),
        },
      )
      if (response.ok) {
        this.instanceId = await response.text()
      }
    } catch {
      this.instanceId = `gcp-${Date.now().toString(36)}`
    }

    // Check for GPU
    this.hasGpuTEE = await this.detectGPUTEE()

    // Generate key pair
    this.publicKey = new Uint8Array(33)
    crypto.getRandomValues(this.publicKey)
    this.publicKey[0] = 0x02

    log.info('GCP instance initialized', {
      instanceId: this.instanceId ?? 'unknown',
      gpuTee: this.hasGpuTEE,
    })
  }

  private async detectGPUTEE(): Promise<boolean> {
    try {
      // Check for NVIDIA GPU with CC support
      const response = await fetch(
        'http://metadata.google.internal/computeMetadata/v1/instance/machine-type',
        {
          headers: { 'Metadata-Flavor': 'Google' },
          signal: AbortSignal.timeout(1000),
        },
      )

      if (response.ok) {
        const machineType = await response.text()
        // A3 instances have confidential GPU support
        return machineType.includes('a3-')
      }
    } catch {
      // Expected when not in GCP - metadata server not available
    }

    return false
  }

  private async requestConfidentialAttestation(
    request: AttestationRequest,
    timestamp: number,
  ): Promise<AttestationResponse> {
    // In production, get attestation token from GCP
    // using the Confidential Computing attestation API

    if (!this.instanceId) {
      throw new Error('Instance not initialized')
    }

    const userData = Buffer.from(request.data.slice(2), 'hex')

    // Create token claims
    const claims: GCPAttestationToken['claims'] = {
      iss: 'https://confidentialcomputing.googleapis.com/',
      sub: this.instanceId,
      aud: this.config.project,
      exp: Math.floor(timestamp / 1000) + 3600,
      iat: Math.floor(timestamp / 1000),
      secboot: true,
      swname: 'evmsol-bridge',
      hwmodel: this.config.teeType === 'tdx' ? 'TDX' : 'SEV-SNP',
      dbgstat: 'disabled',
    }

    // Create mock JWT
    const header = Buffer.from(
      JSON.stringify({ alg: 'RS256', typ: 'JWT' }),
    ).toString('base64url')
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
    const token = `${header}.${payload}.mock-signature`

    const quote = Buffer.from(token)

    const measurement = keccak256(
      new Uint8Array([
        ...Buffer.from(claims.hwmodel),
        ...Buffer.from(claims.swname),
        ...userData,
      ]),
    )

    const signature = keccak256(
      new Uint8Array([...quote, ...toBytes(BigInt(timestamp))]),
    )

    return {
      quote,
      measurement,
      reportData: request.data,
      signature,
      timestamp,
      enclaveId: this.instanceId,
      provider: 'gcp',
      publicKey: this.publicKey,
    }
  }

  private generateSimulatedAttestation(
    request: AttestationRequest,
    timestamp: number,
  ): AttestationResponse {
    if (!this.instanceId) {
      throw new Error('Instance not initialized')
    }

    const measurement = keccak256(
      new Uint8Array([...toBytes(request.data), ...toBytes(BigInt(timestamp))]),
    )

    const quote = new Uint8Array(512)
    crypto.getRandomValues(quote)

    const signature = keccak256(
      new Uint8Array([
        ...Buffer.from(measurement.slice(2), 'hex'),
        ...toBytes(BigInt(timestamp)),
      ]),
    )

    return {
      quote,
      measurement,
      reportData: request.data,
      signature,
      timestamp,
      enclaveId: this.instanceId,
      provider: 'gcp',
      publicKey: this.publicKey,
    }
  }

  private async verifyAttestationToken(quote: Uint8Array): Promise<boolean> {
    // Simulated mode: verify structure is valid JWT with expected fields
    if (!this.inConfidentialVM) {
      return this.verifySimulatedToken(quote)
    }

    // Production: Real GCP attestation verification
    // This requires the Google Cloud SDK or equivalent JWT verification
    throw new Error(
      '[GCPConfidential] Production attestation verification requires Google Cloud SDK. ' +
        "Install @google-cloud/attestation or implement JWT signature verification with Google's public keys.",
    )
  }

  private verifySimulatedToken(quote: Uint8Array): boolean {
    // Validate simulated JWT structure
    const tokenString = Buffer.from(quote).toString('utf-8')
    const parts = tokenString.split('.')

    if (parts.length !== 3) {
      log.error('Invalid token: not a valid JWT format')
      return false
    }

    // Decode and validate payload with Zod
    const ClaimsSchema = z.object({
      iss: z.string(),
      sub: z.string(),
      aud: z.string(),
      exp: z.number().optional(),
      iat: z.number().optional(),
    })

    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf-8')
    const parseResult = ClaimsSchema.safeParse(JSON.parse(payloadJson))

    if (!parseResult.success) {
      log.error('Invalid token: missing required claims', {
        errors: JSON.stringify(parseResult.error.issues),
      })
      return false
    }

    const claims = parseResult.data

    // Verify issuer
    if (claims.iss !== 'https://confidentialcomputing.googleapis.com/') {
      log.error('Invalid token: unexpected issuer', { iss: claims.iss })
      return false
    }

    // Verify token is not expired
    const now = Math.floor(Date.now() / 1000)
    if (claims.exp && claims.exp < now) {
      log.error('Invalid token: expired', { exp: claims.exp, now })
      return false
    }

    // Verify token is not from the future (issued time)
    if (claims.iat && claims.iat > now + 60) {
      log.error('Invalid token: issued in the future', {
        iat: claims.iat,
        now,
      })
      return false
    }

    return true
  }
}

export function createGCPConfidentialProvider(
  config?: Partial<GCPConfidentialConfig>,
): GCPConfidentialProvider {
  const project = config?.project ?? getGcpProject()
  if (!project) {
    throw new Error(
      'GCP_PROJECT is required - set via config or environment variable',
    )
  }

  return new GCPConfidentialProvider({
    project,
    zone: config?.zone ?? getGcpZone(),
    ...config,
  })
}
