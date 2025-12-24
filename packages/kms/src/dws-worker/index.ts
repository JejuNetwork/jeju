/**
 * MPC Party DWS Worker
 *
 * Dedicated worker that runs on TEE nodes to provide threshold signing.
 * This worker is SEPARATE from application services - it only handles
 * MPC key generation and signing operations.
 *
 * Architecture:
 * - Runs in TEE (Intel TDX, AMD SEV, or Phala CVM)
 * - Holds key shares for FROST threshold signing
 * - Provides signing-as-a-service to authorized applications
 * - Never exposes private key shares
 *
 * Deployment:
 * - Registered on-chain via MPCPartyRegistry contract
 * - Tagged with 'dws-mpc-party' for discovery
 * - Must maintain valid TEE attestation
 */

import { Elysia } from 'elysia'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes, toHex } from 'viem'
import { z } from 'zod'
import { FROSTCoordinator } from './frost-coordinator'

// TEE attestation response schema
const AttestationResponseSchema = z.object({
  quote: z.string(),
  mr_enclave: z.string(),
  mr_signer: z.string(),
  report_data: z.string(),
})

// ============ Types ============

export interface MPCPartyConfig {
  partyId: string
  partyIndex: number
  endpoint: string
  teePlatform: 'intel_tdx' | 'amd_sev' | 'phala' | 'local'
  mpcRegistryAddress: Address
  identityRegistryAddress: Address
  rpcUrl: string
  privateKey?: Hex
}

interface KeyShare {
  keyId: string
  clusterId: string
  share: Uint8Array
  publicKey: Hex
  groupPublicKey: Hex
  groupAddress: Address
  threshold: number
  totalParties: number
  partyIndex: number
  createdAt: number
  version: number
}

interface SigningCommitment {
  sessionId: string
  keyId: string
  nonce: Uint8Array
  commitment: Hex
  createdAt: number
  expiresAt: number
}

interface TEEAttestation {
  quote: Hex
  mrEnclave: Hex
  mrSigner: Hex
  reportData: Hex
  timestamp: number
  platform: string
}

// ============ MPC Party Worker ============

export function createMPCPartyWorker(config: MPCPartyConfig) {
  // Key share storage (in TEE secure memory)
  const keyShares = new Map<string, KeyShare>()

  // Active signing sessions
  const signingCommitments = new Map<string, SigningCommitment>()

  // FROST coordinators per key
  const frostCoordinators = new Map<string, FROSTCoordinator>()

  // Authorized service agent IDs (from on-chain registry)
  const authorizedServices = new Set<string>()

  // Stats
  let signaturesProvided = 0
  let keyGenParticipations = 0

  // ============ TEE Attestation ============

  async function generateAttestation(): Promise<TEEAttestation> {
    const timestamp = Date.now()

    if (config.teePlatform === 'local') {
      // Mock attestation for local development
      const mrEnclave = keccak256(toBytes(`${config.partyId}:${timestamp}`))
      return {
        quote: `0x${'00'.repeat(256)}` as Hex,
        mrEnclave,
        mrSigner: keccak256(toBytes(config.partyId)),
        reportData: keccak256(toBytes(`${mrEnclave}:mpc-party`)),
        timestamp,
        platform: 'local',
      }
    }

    // Real TEE attestation via platform-specific API
    // This would call the TEE runtime to generate a quote
    const response = await fetch(`http://localhost:8080/attestation/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        partyId: config.partyId,
        userData: config.partyId,
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to generate attestation: ${response.status}`)
    }

    const data = AttestationResponseSchema.parse(await response.json())

    return {
      quote: data.quote as Hex,
      mrEnclave: data.mr_enclave as Hex,
      mrSigner: data.mr_signer as Hex,
      reportData: data.report_data as Hex,
      timestamp,
      platform: config.teePlatform,
    }
  }

  // ============ Authorization ============

  async function verifyServiceAuthorization(
    serviceAgentId: string,
  ): Promise<boolean> {
    // In production, verify against on-chain MPCPartyRegistry
    // For now, check local authorized set
    return authorizedServices.has(serviceAgentId) || authorizedServices.has('*')
  }

  // ============ Key Generation ============

  async function contributeToKeyGen(params: {
    keyId: string
    clusterId: string
    threshold: number
    totalParties: number
    partyIndices: number[]
    serviceAgentId: string
  }): Promise<{
    publicShare: Hex
    commitment: Hex
  }> {
    if (!(await verifyServiceAuthorization(params.serviceAgentId))) {
      throw new Error('Unauthorized service')
    }

    // Create or get FROST coordinator for this key
    let coordinator = frostCoordinators.get(params.keyId)
    if (!coordinator) {
      coordinator = new FROSTCoordinator(
        params.keyId,
        params.threshold,
        params.totalParties,
      )
      frostCoordinators.set(params.keyId, coordinator)
    }

    // Generate this party's contribution to DKG
    const contribution = await coordinator.generateKeyGenContribution(
      config.partyIndex,
    )

    keyGenParticipations++

    return {
      publicShare: contribution.publicShare,
      commitment: contribution.commitment,
    }
  }

  async function finalizeKeyGen(params: {
    keyId: string
    clusterId: string
    allPublicShares: Hex[]
    allCommitments: Hex[]
    serviceAgentId: string
  }): Promise<{
    groupPublicKey: Hex
    groupAddress: Address
  }> {
    if (!(await verifyServiceAuthorization(params.serviceAgentId))) {
      throw new Error('Unauthorized service')
    }

    const coordinator = frostCoordinators.get(params.keyId)
    if (!coordinator) {
      throw new Error(`No keygen in progress for ${params.keyId}`)
    }

    // Finalize DKG with all parties' contributions
    const result = await coordinator.finalizeKeyGen(
      params.allPublicShares,
      params.allCommitments,
    )

    // Store key share securely
    keyShares.set(params.keyId, {
      keyId: params.keyId,
      clusterId: params.clusterId,
      share: result.privateShare,
      publicKey: result.publicShare,
      groupPublicKey: result.groupPublicKey,
      groupAddress: result.groupAddress,
      threshold: coordinator.threshold,
      totalParties: coordinator.totalParties,
      partyIndex: config.partyIndex,
      createdAt: Date.now(),
      version: 1,
    })

    return {
      groupPublicKey: result.groupPublicKey,
      groupAddress: result.groupAddress,
    }
  }

  // ============ Signing ============

  async function generateSigningCommitment(params: {
    sessionId: string
    keyId: string
    messageHash: Hex
    serviceAgentId: string
  }): Promise<{
    commitment: Hex
    nonce: Hex
  }> {
    if (!(await verifyServiceAuthorization(params.serviceAgentId))) {
      throw new Error('Unauthorized service')
    }

    const keyShare = keyShares.get(params.keyId)
    if (!keyShare) {
      throw new Error(`Key ${params.keyId} not found`)
    }

    const coordinator = frostCoordinators.get(params.keyId)
    if (!coordinator) {
      throw new Error(`FROST coordinator not found for ${params.keyId}`)
    }

    // Generate signing commitment (round 1 of FROST)
    const { nonce, commitment } = await coordinator.generateSigningCommitment(
      config.partyIndex,
      params.messageHash,
    )

    // Store commitment for round 2
    signingCommitments.set(params.sessionId, {
      sessionId: params.sessionId,
      keyId: params.keyId,
      nonce,
      commitment,
      createdAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    })

    return {
      commitment,
      nonce: toHex(nonce),
    }
  }

  async function generateSignatureShare(params: {
    sessionId: string
    keyId: string
    messageHash: Hex
    allCommitments: { partyIndex: number; commitment: Hex }[]
    serviceAgentId: string
  }): Promise<{
    partialSignature: Hex
    partyIndex: number
  }> {
    if (!(await verifyServiceAuthorization(params.serviceAgentId))) {
      throw new Error('Unauthorized service')
    }

    const keyShare = keyShares.get(params.keyId)
    if (!keyShare) {
      throw new Error(`Key ${params.keyId} not found`)
    }

    const storedCommitment = signingCommitments.get(params.sessionId)
    if (!storedCommitment) {
      throw new Error(`No commitment for session ${params.sessionId}`)
    }

    if (Date.now() > storedCommitment.expiresAt) {
      signingCommitments.delete(params.sessionId)
      throw new Error('Signing session expired')
    }

    const coordinator = frostCoordinators.get(params.keyId)
    if (!coordinator) {
      throw new Error(`FROST coordinator not found for ${params.keyId}`)
    }

    // Generate signature share (round 2 of FROST)
    const partialSignature = await coordinator.generateSignatureShare(
      config.partyIndex,
      params.messageHash,
      storedCommitment.nonce,
      params.allCommitments,
    )

    // Clean up commitment
    signingCommitments.delete(params.sessionId)
    signaturesProvided++

    return {
      partialSignature,
      partyIndex: config.partyIndex,
    }
  }

  // ============ Key Management ============

  function listKeys(): {
    keyId: string
    groupAddress: Address
    createdAt: number
  }[] {
    return Array.from(keyShares.values()).map((ks) => ({
      keyId: ks.keyId,
      groupAddress: ks.groupAddress,
      createdAt: ks.createdAt,
    }))
  }

  function hasKey(keyId: string): boolean {
    return keyShares.has(keyId)
  }

  // ============ Router ============

  return (
    new Elysia({ name: 'mpc-party', prefix: '/mpc' })
      // Health and attestation
      .get('/health', async () => ({
        status: 'healthy',
        partyId: config.partyId,
        partyIndex: config.partyIndex,
        teePlatform: config.teePlatform,
        keysManaged: keyShares.size,
        signaturesProvided,
        keyGenParticipations,
        activeSessions: signingCommitments.size,
      }))

      .get('/attestation', async () => {
        const attestation = await generateAttestation()
        return {
          ...attestation,
          partyId: config.partyId,
          partyIndex: config.partyIndex,
        }
      })

      // Key generation (distributed key generation protocol)
      .post('/keygen/contribute', async ({ body }) => {
        const params = body as {
          keyId: string
          clusterId: string
          threshold: number
          totalParties: number
          partyIndices: number[]
          serviceAgentId: string
        }

        return contributeToKeyGen(params)
      })

      .post('/keygen/finalize', async ({ body }) => {
        const params = body as {
          keyId: string
          clusterId: string
          allPublicShares: Hex[]
          allCommitments: Hex[]
          serviceAgentId: string
        }

        return finalizeKeyGen(params)
      })

      // Signing (FROST threshold signing protocol)
      .post('/sign/commit', async ({ body }) => {
        const params = body as {
          sessionId: string
          keyId: string
          messageHash: Hex
          serviceAgentId: string
        }

        return generateSigningCommitment(params)
      })

      .post('/sign/share', async ({ body }) => {
        const params = body as {
          sessionId: string
          keyId: string
          messageHash: Hex
          allCommitments: { partyIndex: number; commitment: Hex }[]
          serviceAgentId: string
        }

        return generateSignatureShare(params)
      })

      // Key queries
      .get('/keys', () => listKeys())

      .get('/keys/:keyId', ({ params }) => {
        const keyShare = keyShares.get(params.keyId)
        if (!keyShare) {
          throw new Error('Key not found')
        }

        return {
          keyId: keyShare.keyId,
          clusterId: keyShare.clusterId,
          groupPublicKey: keyShare.groupPublicKey,
          groupAddress: keyShare.groupAddress,
          threshold: keyShare.threshold,
          totalParties: keyShare.totalParties,
          partyIndex: keyShare.partyIndex,
          createdAt: keyShare.createdAt,
          version: keyShare.version,
          // Never expose the actual share
        }
      })

      .get('/keys/:keyId/exists', ({ params }) => ({
        exists: hasKey(params.keyId),
      }))

      // Authorization management (called by coordinator)
      .post('/authorize', async ({ body }) => {
        // In production, verify this comes from registry contract or admin
        const params = body as { serviceAgentId: string }
        authorizedServices.add(params.serviceAgentId)
        return { authorized: true }
      })

      .delete('/authorize/:serviceAgentId', async ({ params }) => {
        authorizedServices.delete(params.serviceAgentId)
        return { deauthorized: true }
      })
  )
}

// ============ Exports ============

export type MPCPartyWorker = ReturnType<typeof createMPCPartyWorker>
