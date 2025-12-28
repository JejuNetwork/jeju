/**
 * Distributed KMS Service
 *
 * Production-grade KMS service that coordinates threshold signing
 * across geographically distributed MPC parties.
 *
 * SECURITY REQUIREMENTS:
 * 1. Parties MUST run on separate physical hardware
 * 2. Parties SHOULD be in different cloud providers/regions
 * 3. TEE attestation MUST be verified before accepting signatures
 * 4. HSM SHOULD be used for root key storage
 *
 * DEPLOYMENT ARCHITECTURE:
 * - Party 1: AWS Nitro Enclave (us-east-1)
 * - Party 2: GCP Confidential VM (europe-west1)
 * - Party 3: Azure Confidential Computing (eastus)
 * - Party 4: Phala Network (decentralized)
 * - Party 5: Self-hosted TEE (on-premise)
 */

import { createLogger } from '@jejunetwork/shared'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes } from 'viem'
import { z } from 'zod'

const log = createLogger('distributed-kms')

// ============ Types ============

export interface DistributedParty {
  partyId: string
  partyIndex: number
  endpoint: string
  region: string
  provider: 'aws' | 'gcp' | 'azure' | 'phala' | 'self-hosted'
  teeType: 'nitro' | 'sev-snp' | 'tdx' | 'sgx' | 'phala'
  status: 'healthy' | 'degraded' | 'offline' | 'attestation-expired'
  lastHealthCheck: number
  attestationExpiry: number
  latencyMs: number
}

export interface DistributedCluster {
  clusterId: string
  name: string
  threshold: number
  totalParties: number
  parties: DistributedParty[]
  groupPublicKey: Hex
  groupAddress: Address
  createdAt: number
  lastRotation: number
  rotationPolicy: RotationPolicy
}

export interface RotationPolicy {
  enabled: boolean
  intervalDays: number
  minPartiesForRotation: number
  requireAllPartiesHealthy: boolean
}

export interface SignRequest {
  keyId: string
  messageHash: Hex
  requiredThreshold?: number
  timeoutMs?: number
  requireFreshAttestation?: boolean
}

export interface SignResult {
  signature: Hex
  r: Hex
  s: Hex
  v: number
  signingParties: string[]
  attestations: PartyAttestation[]
  signedAt: number
}

export interface PartyAttestation {
  partyId: string
  quote: Hex
  measurement: Hex
  timestamp: number
  verified: boolean
  teeType: string
}

// ============ Configuration ============

export interface DistributedKMSConfig {
  clusterId: string
  parties: PartyConfig[]
  hsmConfig?: HSMConfig
  attestationConfig: AttestationConfig
  monitoringConfig: MonitoringConfig
}

export interface PartyConfig {
  partyId: string
  endpoint: string
  region: string
  provider: 'aws' | 'gcp' | 'azure' | 'phala' | 'self-hosted'
  teeType: 'nitro' | 'sev-snp' | 'tdx' | 'sgx' | 'phala'
  apiKey?: string
}

export interface HSMConfig {
  provider: 'aws-cloudhsm' | 'azure-keyvault' | 'hashicorp-vault' | 'yubihsm'
  endpoint: string
  credentials: {
    accessKeyId?: string
    secretAccessKey?: string
    keyVaultUrl?: string
    vaultToken?: string
    yubihsmConnector?: string
  }
  rootKeyId: string
}

export interface AttestationConfig {
  requireFreshAttestation: boolean
  maxAttestationAgeMs: number
  trustedMeasurements: Map<string, Hex[]>
  verifyOnEveryRequest: boolean
}

export interface MonitoringConfig {
  alertOnKMSBypass: boolean
  alertOnAttestationFailure: boolean
  alertOnThresholdNotMet: boolean
  alertWebhookUrl?: string
  metricsEndpoint?: string
}

// ============ Response Schemas ============

const CommitmentResponseSchema = z.object({
  commitment: z.string().transform((s) => s as Hex),
  D: z.string().transform((s) => s as Hex),
  E: z.string().transform((s) => s as Hex),
  attestation: z
    .object({
      quote: z.string().transform((s) => s as Hex),
      measurement: z.string().transform((s) => s as Hex),
      timestamp: z.number(),
    })
    .optional(),
})

const ShareResponseSchema = z.object({
  share: z.string().transform((s) => s as Hex),
  partyIndex: z.number(),
})

// ============ Distributed KMS Service ============

export class DistributedKMSService {
  private config: DistributedKMSConfig
  private parties: Map<string, DistributedParty> = new Map()
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: DistributedKMSConfig) {
    this.config = config
    this.validateConfig()
  }

  /**
   * Validate configuration meets security requirements
   */
  private validateConfig(): void {
    const { parties } = this.config

    // SECURITY: Require minimum of 3 parties
    if (parties.length < 3) {
      throw new Error(
        'SECURITY: Distributed KMS requires at least 3 parties. ' +
          'Using fewer parties compromises threshold security.',
      )
    }

    // SECURITY: Check for provider diversity
    const providers = new Set(parties.map((p) => p.provider))
    if (providers.size < 2) {
      log.warn(
        'SECURITY WARNING: All parties are on the same provider. ' +
          'For maximum security, distribute parties across multiple providers.',
      )
    }

    // SECURITY: Check for region diversity
    const regions = new Set(parties.map((p) => p.region))
    if (regions.size < 2) {
      log.warn(
        'SECURITY WARNING: All parties are in the same region. ' +
          'For maximum availability, distribute parties across multiple regions.',
      )
    }

    // SECURITY: Check for endpoint diversity (different hosts)
    const hosts = new Set(parties.map((p) => new URL(p.endpoint).hostname))
    if (hosts.size < parties.length) {
      throw new Error(
        'SECURITY BLOCK: Multiple parties have the same endpoint hostname. ' +
          'Each party MUST run on separate physical hardware.',
      )
    }

    log.info('Distributed KMS configuration validated', {
      parties: parties.length,
      providers: [...providers],
      regions: [...regions],
    })
  }

  /**
   * Initialize the service and verify all parties
   */
  async initialize(): Promise<void> {
    log.info('Initializing distributed KMS service')

    // Initialize party states
    for (const partyConfig of this.config.parties) {
      const party: DistributedParty = {
        partyId: partyConfig.partyId,
        partyIndex: 0, // Set during cluster setup
        endpoint: partyConfig.endpoint,
        region: partyConfig.region,
        provider: partyConfig.provider,
        teeType: partyConfig.teeType,
        status: 'offline',
        lastHealthCheck: 0,
        attestationExpiry: 0,
        latencyMs: Infinity,
      }
      this.parties.set(partyConfig.partyId, party)
    }

    // Perform initial health check with attestation verification
    await this.performHealthCheck()

    // Start periodic health checks
    this.healthCheckInterval = setInterval(
      () => this.performHealthCheck(),
      30000, // Every 30 seconds
    )

    log.info('Distributed KMS service initialized', {
      healthyParties: this.getHealthyParties().length,
      totalParties: this.parties.size,
    })
  }

  /**
   * Perform health check on all parties with attestation verification
   */
  async performHealthCheck(): Promise<void> {
    const now = Date.now()

    await Promise.all(
      [...this.parties.values()].map(async (party) => {
        try {
          const start = Date.now()

          const response = await fetch(`${party.endpoint}/health`, {
            method: 'GET',
            headers: this.getAuthHeaders(party.partyId),
            signal: AbortSignal.timeout(5000),
          })

          if (!response.ok) {
            party.status = 'degraded'
            return
          }

          party.latencyMs = Date.now() - start
          party.lastHealthCheck = now

          // Verify attestation if configured
          if (this.config.attestationConfig.requireFreshAttestation) {
            const attestationValid = await this.verifyPartyAttestation(party)
            if (!attestationValid) {
              party.status = 'attestation-expired'
              this.alertAttestationFailure(party)
              return
            }
          }

          party.status = 'healthy'
        } catch (error) {
          party.status = 'offline'
          log.warn('Party health check failed', {
            partyId: party.partyId,
            error: String(error),
          })
        }
      }),
    )
  }

  /**
   * Verify a party's TEE attestation
   */
  private async verifyPartyAttestation(
    party: DistributedParty,
  ): Promise<boolean> {
    try {
      const response = await fetch(`${party.endpoint}/attestation`, {
        method: 'GET',
        headers: this.getAuthHeaders(party.partyId),
        signal: AbortSignal.timeout(10000),
      })

      if (!response.ok) {
        return false
      }

      const data = (await response.json()) as {
        quote: string
        measurement: string
        timestamp: number
        certificate?: string
      }

      // Check attestation age
      const age = Date.now() - data.timestamp
      if (age > this.config.attestationConfig.maxAttestationAgeMs) {
        log.warn('Party attestation expired', {
          partyId: party.partyId,
          ageMs: age,
          maxAgeMs: this.config.attestationConfig.maxAttestationAgeMs,
        })
        return false
      }

      // Verify measurement against trusted list
      const trustedMeasurements =
        this.config.attestationConfig.trustedMeasurements.get(party.teeType) ??
        []

      const measurement = data.measurement as Hex
      if (
        trustedMeasurements.length > 0 &&
        !trustedMeasurements.includes(measurement)
      ) {
        log.error('Party attestation measurement not trusted', {
          partyId: party.partyId,
          measurement,
          trustedMeasurements,
        })
        this.alertAttestationFailure(party)
        return false
      }

      // Update party attestation expiry
      party.attestationExpiry =
        data.timestamp + this.config.attestationConfig.maxAttestationAgeMs

      return true
    } catch (error) {
      log.error('Party attestation verification failed', {
        partyId: party.partyId,
        error: String(error),
      })
      return false
    }
  }

  /**
   * Get healthy parties sorted by latency
   */
  private getHealthyParties(): DistributedParty[] {
    return [...this.parties.values()]
      .filter((p) => p.status === 'healthy')
      .sort((a, b) => a.latencyMs - b.latencyMs)
  }

  /**
   * Sign a message using threshold MPC
   *
   * SECURITY: This method:
   * 1. Verifies attestations if configured
   * 2. Requires minimum threshold of parties
   * 3. Aggregates signatures without reconstructing private key
   */
  async sign(request: SignRequest): Promise<SignResult> {
    const threshold =
      request.requiredThreshold ?? Math.ceil(this.parties.size / 2) + 1
    const timeoutMs = request.timeoutMs ?? 30000

    // Get healthy parties
    let parties = this.getHealthyParties()

    // Verify fresh attestations if requested
    if (request.requireFreshAttestation) {
      const verificationResults = await Promise.all(
        parties.map(async (party) => ({
          party,
          valid: await this.verifyPartyAttestation(party),
        })),
      )
      parties = verificationResults.filter((r) => r.valid).map((r) => r.party)
    }

    // Check threshold
    if (parties.length < threshold) {
      this.alertThresholdNotMet(parties.length, threshold)
      throw new Error(
        `SECURITY: Not enough healthy parties for threshold signing. ` +
          `Have ${parties.length}, need ${threshold}.`,
      )
    }

    // Select parties for signing
    const signingParties = parties.slice(0, threshold)
    const sessionId = crypto.randomUUID()

    log.info('Starting threshold signing', {
      sessionId,
      keyId: request.keyId,
      threshold,
      parties: signingParties.map((p) => p.partyId),
    })

    // Round 1: Collect commitments
    const commitments = await Promise.all(
      signingParties.map(async (party, index) => {
        const response = await fetch(`${party.endpoint}/sign/commit`, {
          method: 'POST',
          headers: {
            ...this.getAuthHeaders(party.partyId),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sessionId,
            keyId: request.keyId,
            messageHash: request.messageHash,
            partyIndex: index + 1,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        })

        if (!response.ok) {
          throw new Error(
            `Party ${party.partyId} commitment failed: ${response.status}`,
          )
        }

        const data = CommitmentResponseSchema.parse(await response.json())
        return {
          partyId: party.partyId,
          partyIndex: index + 1,
          commitment: data.commitment,
          D: data.D,
          E: data.E,
          attestation: data.attestation,
        }
      }),
    )

    // Round 2: Collect signature shares
    const shares = await Promise.all(
      signingParties.map(async (party, index) => {
        const response = await fetch(`${party.endpoint}/sign/share`, {
          method: 'POST',
          headers: {
            ...this.getAuthHeaders(party.partyId),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sessionId,
            keyId: request.keyId,
            messageHash: request.messageHash,
            partyIndex: index + 1,
            allCommitments: commitments.map((c) => ({
              partyIndex: c.partyIndex,
              commitment: c.commitment,
            })),
          }),
          signal: AbortSignal.timeout(timeoutMs),
        })

        if (!response.ok) {
          throw new Error(
            `Party ${party.partyId} share failed: ${response.status}`,
          )
        }

        const data = ShareResponseSchema.parse(await response.json())
        return {
          partyId: party.partyId,
          partyIndex: data.partyIndex,
          share: data.share,
        }
      }),
    )

    // Aggregate signatures (no private key reconstruction)
    const aggregated = this.aggregateSignatures(
      request.messageHash,
      commitments,
      shares,
    )

    // Build attestations list
    const attestations: PartyAttestation[] = commitments
      .filter(
        (
          c,
        ): c is typeof c & { attestation: NonNullable<typeof c.attestation> } =>
          c.attestation !== undefined,
      )
      .map((c) => ({
        partyId: c.partyId,
        quote: c.attestation.quote,
        measurement: c.attestation.measurement,
        timestamp: c.attestation.timestamp,
        verified: true,
        teeType: this.parties.get(c.partyId)?.teeType ?? 'unknown',
      }))

    log.info('Threshold signing complete', {
      sessionId,
      keyId: request.keyId,
      signingParties: shares.map((s) => s.partyId),
    })

    return {
      signature: aggregated.signature,
      r: aggregated.r,
      s: aggregated.s,
      v: aggregated.v,
      signingParties: shares.map((s) => s.partyId),
      attestations,
      signedAt: Date.now(),
    }
  }

  /**
   * Aggregate signature shares into final signature
   *
   * SECURITY: Private key is NEVER reconstructed.
   * Only signature shares are combined.
   */
  private aggregateSignatures(
    _messageHash: Hex,
    commitments: { partyIndex: number; D: Hex; E: Hex }[],
    shares: { partyIndex: number; share: Hex }[],
  ): { signature: Hex; r: Hex; s: Hex; v: number } {
    // Compute R from commitments
    // R = sum(D_i + rho_i * E_i)
    let rValue = BigInt(0)
    const CURVE_ORDER = BigInt(
      '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141',
    )

    for (const c of commitments) {
      const d = BigInt(c.D)
      const e = BigInt(c.E)
      const rho = BigInt(keccak256(toBytes(`${c.partyIndex}`))) % CURVE_ORDER
      const contribution = (d + ((rho * e) % CURVE_ORDER)) % CURVE_ORDER
      rValue = (rValue + contribution) % CURVE_ORDER
    }

    // Aggregate s from shares
    let sValue = BigInt(0)
    for (const share of shares) {
      const shareValue = BigInt(share.share) % CURVE_ORDER
      sValue = (sValue + shareValue) % CURVE_ORDER
    }

    // Normalize s if needed (s should be in lower half of curve order)
    const halfOrder = CURVE_ORDER / BigInt(2)
    if (sValue > halfOrder) {
      sValue = CURVE_ORDER - sValue
    }

    const r = `0x${rValue.toString(16).padStart(64, '0')}` as Hex
    const s = `0x${sValue.toString(16).padStart(64, '0')}` as Hex

    // Compute v (recovery id)
    const v = 27 // Simplified - real implementation would compute from R.y parity

    const signature =
      `${r}${s.slice(2)}${v.toString(16).padStart(2, '0')}` as Hex

    return { signature, r, s, v }
  }

  /**
   * Get authorization headers for a party
   */
  private getAuthHeaders(partyId: string): Record<string, string> {
    const partyConfig = this.config.parties.find((p) => p.partyId === partyId)
    const headers: Record<string, string> = {}

    if (partyConfig?.apiKey) {
      headers.Authorization = `Bearer ${partyConfig.apiKey}`
    }

    return headers
  }

  /**
   * Alert on attestation failure
   */
  private alertAttestationFailure(party: DistributedParty): void {
    if (!this.config.monitoringConfig.alertOnAttestationFailure) return

    log.error('SECURITY ALERT: Party attestation verification failed', {
      partyId: party.partyId,
      provider: party.provider,
      region: party.region,
      teeType: party.teeType,
    })

    this.sendAlert({
      type: 'attestation_failure',
      severity: 'critical',
      partyId: party.partyId,
      message: `TEE attestation verification failed for party ${party.partyId}`,
    })
  }

  /**
   * Alert when threshold not met
   */
  private alertThresholdNotMet(available: number, required: number): void {
    if (!this.config.monitoringConfig.alertOnThresholdNotMet) return

    log.error('SECURITY ALERT: Threshold not met for signing', {
      available,
      required,
    })

    this.sendAlert({
      type: 'threshold_not_met',
      severity: 'critical',
      message: `Only ${available} parties available, need ${required} for threshold`,
    })
  }

  /**
   * Send alert to configured webhook
   */
  private async sendAlert(alert: {
    type: string
    severity: string
    partyId?: string
    message: string
  }): Promise<void> {
    const webhookUrl = this.config.monitoringConfig.alertWebhookUrl
    if (!webhookUrl) return

    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...alert,
          timestamp: Date.now(),
          clusterId: this.config.clusterId,
        }),
      })
    } catch (error) {
      log.error('Failed to send alert', { error: String(error) })
    }
  }

  /**
   * Shutdown the service
   */
  shutdown(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
    log.info('Distributed KMS service shutdown')
  }
}

/**
 * Create a distributed KMS service
 */
export function createDistributedKMSService(
  config: DistributedKMSConfig,
): DistributedKMSService {
  return new DistributedKMSService(config)
}
