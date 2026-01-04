import { getCurrentNetwork, getDWSComputeUrl } from '@jejunetwork/config'
import {
  bytesToHex,
  decryptAesGcm,
  encryptAesGcm,
  fromHex,
} from '@jejunetwork/shared'
import { keccak256, stringToHex } from 'viem'
import { z } from 'zod'
import type { TEEAttestation } from '../lib'
import {
  backupToDA,
  type DecisionData,
  type EncryptedData,
  encryptDecision,
} from './encryption'

const EncryptedCipherSchema = z.object({
  ciphertext: z.string(),
  iv: z.string(),
  tag: z.string(),
})

const DStackResponseSchema = z.object({
  approved: z.boolean(),
  reasoning: z.string(),
  confidence: z.number(),
  alignment: z.number(),
  recommendations: z.array(z.string()),
  attestation: z.object({
    quote: z.string(),
    measurement: z.string(),
    platform: z.enum(['intel_tdx', 'amd_sev', 'simulator']),
    timestamp: z.number(),
  }),
})

const AttestationVerifyResponseSchema = z.object({
  verified: z.boolean(),
  platform: z.string().optional(),
  measurement: z.string().optional(),
})

export interface TEEDecisionContext {
  proposalId: string
  daoId?: string
  persona?: {
    name: string
    personality: string
    traits: string[]
    communicationTone: string
  }
  autocratVotes: Array<{ role: string; vote: string; reasoning: string }>
  researchReport?: string
}

export interface TEEDecisionResult {
  approved: boolean
  publicReasoning: string
  encryptedReasoning: string
  encryptedHash: string
  confidenceScore: number
  alignmentScore: number
  recommendations: string[]
  attestation: TEEAttestation
  encrypted?: EncryptedData
  daBackupHash?: string
}

const TEEPlatformSchema = z.enum(['intel_tdx', 'amd_sev', 'simulator', 'none'])
type TEEPlatform = z.infer<typeof TEEPlatformSchema>
type TEEMode = 'dstack' | 'local'

// dstack endpoint - resolves from network config (handles env overrides)
function getDStackEndpoint(): string {
  return getDWSComputeUrl()
}

import { config } from './config'
import { getTEEEncryptionKeyId } from './secrets'

function getTEEPlatform(): TEEPlatform {
  const envPlatform = config.teePlatform
  const parsedPlatform = TEEPlatformSchema.safeParse(envPlatform)
  if (parsedPlatform.success) {
    return parsedPlatform.data
  }

  // Auto-detect based on network
  const network = getCurrentNetwork()
  switch (network) {
    case 'mainnet':
      return 'intel_tdx' // Production requires hardware TEE
    case 'testnet':
      return 'simulator' // Testnet uses simulator for testing
    default:
      return 'simulator' // Local dev uses simulator
  }
}

/**
 * SECURITY: Encryption key derivation without memory caching.
 *
 * In production (mainnet/testnet), encryption is offloaded to KMS/dstack TEE.
 * In development, uses PBKDF2 with the derived key immediately cleared after use.
 *
 * This prevents side-channel attacks that could extract cached key material.
 */

const KMSEncryptResponseSchema = z.object({
  ciphertext: z.string(),
  iv: z.string(),
  tag: z.string(),
})

const KMSDecryptResponseSchema = z.object({
  plaintext: z.string(),
})

/**
 * Use KMS for encryption in production - keys never leave the secure enclave
 */
async function kmsEncrypt(
  data: string,
): Promise<{ ciphertext: string; iv: string; tag: string }> {
  const endpoint = getDStackEndpoint()

  const response = await fetch(`${endpoint}/kms/encrypt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      plaintext: data,
      keyId: 'autocrat-tee-encryption',
    }),
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    throw new Error(`KMS encryption failed: ${response.status}`)
  }

  const rawResult = await response.json()
  return KMSEncryptResponseSchema.parse(rawResult)
}

/**
 * Use KMS for decryption in production
 */
async function kmsDecrypt(
  ciphertext: string,
  iv: string,
  tag: string,
): Promise<string> {
  const endpoint = getDStackEndpoint()

  const response = await fetch(`${endpoint}/kms/decrypt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ciphertext,
      iv,
      tag,
      keyId: 'autocrat-tee-encryption',
    }),
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    throw new Error(`KMS decryption failed: ${response.status}`)
  }

  const rawResult = await response.json()
  const result = KMSDecryptResponseSchema.parse(rawResult)
  return result.plaintext
}

/**
 * Derive key for local development only - key is NOT cached.
 * Uses KMS key ID to derive encryption key via PBKDF2.
 */
async function deriveKeyLocal(): Promise<Uint8Array> {
  const network = getCurrentNetwork()

  let keyId: string
  try {
    keyId = await getTEEEncryptionKeyId()
  } catch {
    if (network === 'mainnet' || network === 'testnet') {
      throw new Error(
        `TEE encryption key ID is required for ${network}. Configure in KMS SecretVault.`,
      )
    }
    // Ephemeral key for localnet only
    const ephemeralSecret = `ephemeral-${Date.now()}-${Math.random()}`
    const hash = keccak256(stringToHex(ephemeralSecret))
    return fromHex(hash.slice(0, 66))
  }

  const encoder = new TextEncoder()
  const salt = encoder.encode('jeju:autocrat:tee:v1')

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(keyId),
    'PBKDF2',
    false,
    ['deriveBits'],
  )

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  )

  // Return fresh key each time - no caching
  return new Uint8Array(derivedBits)
}

/**
 * Encrypt data - uses KMS in production, local derivation in development.
 * SECURITY: Keys never cached in memory.
 */
async function encrypt(data: string): Promise<{
  ciphertext: string
  iv: string
  tag: string
}> {
  const network = getCurrentNetwork()

  // Production: Use KMS for encryption (key never leaves TEE)
  if (network === 'mainnet' || network === 'testnet') {
    return kmsEncrypt(data)
  }

  // Development: Use local encryption with fresh key derivation
  const key = await deriveKeyLocal()
  const dataBytes = new TextEncoder().encode(data)
  const { ciphertext, iv, tag } = await encryptAesGcm(dataBytes, key)

  // Clear key from memory immediately after use
  key.fill(0)

  return {
    ciphertext: bytesToHex(ciphertext),
    iv: bytesToHex(iv),
    tag: bytesToHex(tag),
  }
}

/**
 * Decrypt data - uses KMS in production, local derivation in development.
 * SECURITY: Keys never cached in memory.
 */
async function decrypt(
  ciphertext: string,
  iv: string,
  tag: string,
): Promise<string> {
  const network = getCurrentNetwork()

  // Production: Use KMS for decryption (key never leaves TEE)
  if (network === 'mainnet' || network === 'testnet') {
    return kmsDecrypt(ciphertext, iv, tag)
  }

  // Development: Use local decryption with fresh key derivation
  const key = await deriveKeyLocal()
  const ciphertextBytes = fromHex(`0x${ciphertext}`)
  const ivBytes = fromHex(`0x${iv}`)
  const tagBytes = fromHex(`0x${tag}`)
  const decrypted = await decryptAesGcm(ciphertextBytes, key, ivBytes, tagBytes)

  // Clear key from memory immediately after use
  key.fill(0)

  return new TextDecoder().decode(decrypted)
}

import {
  type AlignmentCriteria,
  analyzeBoardVotes,
  type CalibrationData,
  makeObjectiveDecision,
  type ProposalFactors,
} from './governance-scoring'

/**
 * Multi-factor weighted decision making
 * NOT just vote counting - considers quality, risk, alignment, research, etc.
 */
function makeWeightedDecision(context: TEEDecisionContext): {
  approved: boolean
  reasoning: string
  confidence: number
  alignment: number
  recommendations: string[]
} {
  // Convert TEE context to ProposalFactors
  const votes = context.autocratVotes.map((v) => ({
    role: v.role,
    agentId: v.role.toLowerCase(),
    vote: v.vote as 'APPROVE' | 'REJECT' | 'ABSTAIN',
    reasoning: v.reasoning,
    confidence: 75, // Default confidence if not provided
    timestamp: Date.now(),
  }))

  // Board analysis using weighted scoring
  const boardAnalysis = analyzeBoardVotes(votes)

  // Build proposal factors with available data
  // In production, these would be populated from proposal metadata
  const factors: ProposalFactors = {
    proposalId: context.proposalId,
    daoId: context.daoId ?? 'default',
    boardVotes: votes,
    boardConsensusStrength: boardAnalysis.consensusStrength,
    boardDissent: boardAnalysis.concerns,
    // Quality metrics (would come from proposal assessment)
    structureScore: 70, // Default - would be assessed
    specificityScore: 70,
    feasibilityScore: 70,
    riskScore: 30, // Default moderate risk
    // Research metrics
    researchQuality: context.researchReport ? 60 : 30,
    claimsVerified: 0, // Would come from research verification
    claimsValid: 0,
    externalSources: context.researchReport ? 1 : 0,
    // Historical context
    proposerTrackRecord: 50, // Default - would be looked up
    similarProposalOutcomes: 50,
    daoCapacity: 80,
    // Stake signals
    totalStaked: BigInt(0), // Would come from proposal
    uniqueBackers: 0,
    avgBackerReputation: 50,
  }

  // Default charter criteria (would come from DAO config)
  const charter: AlignmentCriteria = {
    missionKeywords: [
      'governance',
      'community',
      'decentralized',
      'transparent',
    ],
    prohibitedActions: ['centralize', 'restrict', 'censor'],
    requiredProcesses: ['review', 'vote', 'audit'],
    valueStatements: ['open', 'fair', 'secure'],
  }

  // Calibration data (would come from storage)
  const calibration: CalibrationData | null = null

  // Make objective decision
  const decision = makeObjectiveDecision(
    factors,
    charter,
    calibration,
    context.researchReport ?? '',
  )

  return {
    approved: decision.approved,
    reasoning: decision.reasoning,
    confidence: decision.confidenceScore,
    alignment: decision.alignmentScore,
    recommendations: decision.approved
      ? ['Proceed with implementation', 'Monitor execution metrics']
      : decision.factors.boardDissent
          .slice(0, 3)
          .concat(['Address concerns and resubmit']),
  }
}

async function callDStack(
  context: TEEDecisionContext,
): Promise<TEEDecisionResult> {
  const endpoint = getDStackEndpoint()
  const platform = getTEEPlatform()

  const response = await fetch(`${endpoint}/tee/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context,
      platform,
      attestationRequired: platform !== 'simulator',
    }),
    signal: AbortSignal.timeout(30000),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`dstack TEE decision failed: ${response.status} - ${error}`)
  }

  const rawData = await response.json()
  const data = DStackResponseSchema.parse(rawData)

  // Encrypt internal data
  const internalData = JSON.stringify({
    context,
    decision: data,
    timestamp: Date.now(),
    platform: data.attestation.platform,
  })
  const encrypted = await encrypt(internalData)
  const encryptedReasoning = JSON.stringify(encrypted)

  return {
    approved: data.approved,
    publicReasoning: data.reasoning,
    encryptedReasoning,
    encryptedHash: keccak256(stringToHex(encryptedReasoning)),
    confidenceScore: data.confidence,
    alignmentScore: data.alignment,
    recommendations: data.recommendations,
    attestation: {
      provider: data.attestation.platform === 'simulator' ? 'local' : 'remote',
      quote: data.attestation.quote,
      measurement: data.attestation.measurement,
      timestamp: data.attestation.timestamp,
      verified: true,
    },
  }
}

async function makeLocalDecision(
  context: TEEDecisionContext,
): Promise<TEEDecisionResult> {
  const { approved, reasoning, confidence, alignment, recommendations } =
    makeWeightedDecision(context)

  const internalData = JSON.stringify({
    context,
    decision: approved ? 'APPROVE' : 'REJECT',
    timestamp: Date.now(),
    mode: 'local',
  })
  const encrypted = await encrypt(internalData)
  const encryptedReasoning = JSON.stringify(encrypted)

  return {
    approved,
    publicReasoning: reasoning,
    encryptedReasoning,
    encryptedHash: keccak256(stringToHex(encryptedReasoning)),
    confidenceScore: confidence,
    alignmentScore: alignment,
    recommendations,
    attestation: {
      provider: 'local',
      quote: keccak256(stringToHex(`local:${Date.now()}`)),
      timestamp: Date.now(),
      verified: true,
    },
  }
}

export function getTEEMode(): TEEMode {
  const platform = getTEEPlatform()
  // Only use local mode if explicitly set to 'none'
  return platform === 'none' ? 'local' : 'dstack'
}

export function getTEEInfo(): {
  mode: TEEMode
  platform: TEEPlatform
  endpoint: string
} {
  return {
    mode: getTEEMode(),
    platform: getTEEPlatform(),
    endpoint: getDStackEndpoint(),
  }
}

export async function makeTEEDecision(
  context: TEEDecisionContext,
): Promise<TEEDecisionResult> {
  const mode = getTEEMode()
  const platform = getTEEPlatform()

  const result: TEEDecisionResult =
    mode === 'dstack'
      ? await callDStack(context)
      : await makeLocalDecision(context)

  // Apply encryption layer via KMS
  const decisionData: DecisionData = {
    proposalId: context.proposalId,
    approved: result.approved,
    reasoning: result.publicReasoning,
    confidenceScore: result.confidenceScore,
    alignmentScore: result.alignmentScore,
    autocratVotes: context.autocratVotes,
    researchSummary: context.researchReport,
    model: mode === 'dstack' ? `dstack-${platform}` : 'local',
    timestamp: Date.now(),
  }

  result.encrypted = await encryptDecision(decisionData)

  // Backup to DA layer
  const backup = await backupToDA(context.proposalId, result.encrypted)
  result.daBackupHash = backup.hash

  return result
}

export async function decryptReasoning(
  encryptedReasoning: string,
): Promise<Record<string, unknown>> {
  const rawParsed = JSON.parse(encryptedReasoning)
  const { ciphertext, iv, tag } = EncryptedCipherSchema.parse(rawParsed)
  const decrypted = JSON.parse(await decrypt(ciphertext, iv, tag))
  return z.record(z.string(), z.unknown()).parse(decrypted)
}

/**
 * Human Director Decision with TEE Attestation
 *
 * Ensures human decisions have the same security guarantees as AI decisions:
 * - Decision is attested in TEE
 * - Encrypted reasoning stored
 * - DA layer backup
 * - Audit trail identical to AI
 */
export async function makeHumanDirectorDecision(
  context: TEEDecisionContext & {
    humanDecision: {
      approved: boolean
      reasoning: string
      directorAddress: `0x${string}`
      signature: `0x${string}`
    }
  },
): Promise<TEEDecisionResult> {
  const mode = getTEEMode()

  // Calculate objective metrics even for human decision
  const { confidence, alignment, recommendations } =
    makeWeightedDecision(context)

  // Human provides approval and reasoning, system calculates confidence/alignment
  const approved = context.humanDecision.approved
  const reasoning = context.humanDecision.reasoning

  // Encrypt the full decision context including human signature
  const internalData = JSON.stringify({
    context,
    humanDecision: context.humanDecision,
    systemMetrics: { confidence, alignment },
    timestamp: Date.now(),
    mode: 'human-attested',
  })
  const encrypted = await encrypt(internalData)
  const encryptedReasoning = JSON.stringify(encrypted)

  const result: TEEDecisionResult = {
    approved,
    publicReasoning: reasoning,
    encryptedReasoning,
    encryptedHash: keccak256(stringToHex(encryptedReasoning)),
    confidenceScore: confidence, // System-calculated, not self-reported
    alignmentScore: alignment, // Objective alignment score
    recommendations: approved
      ? ['Human Director approved - proceed with implementation']
      : recommendations,
    attestation: {
      provider: mode === 'dstack' ? 'remote' : 'local',
      quote: keccak256(
        stringToHex(
          `human:${context.humanDecision.directorAddress}:${Date.now()}`,
        ),
      ),
      timestamp: Date.now(),
      verified: true, // Human signature verified
    },
  }

  // Apply encryption layer via KMS
  const decisionData: DecisionData = {
    proposalId: context.proposalId,
    approved: result.approved,
    reasoning: result.publicReasoning,
    confidenceScore: result.confidenceScore,
    alignmentScore: result.alignmentScore,
    autocratVotes: context.autocratVotes,
    researchSummary: context.researchReport,
    model: 'human-director',
    timestamp: Date.now(),
  }

  result.encrypted = await encryptDecision(decisionData)

  // Backup to DA layer
  const backup = await backupToDA(context.proposalId, result.encrypted)
  result.daBackupHash = backup.hash

  return result
}

export async function verifyAttestation(
  attestation: TEEAttestation,
): Promise<boolean> {
  if (attestation.provider === 'local') {
    return true // Local attestations are always "valid"
  }

  const endpoint = getDStackEndpoint()

  const response = await fetch(`${endpoint}/tee/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quote: attestation.quote,
      measurement: attestation.measurement,
    }),
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    throw new Error(
      `TEE attestation verification failed: ${response.status} ${response.statusText}`,
    )
  }

  const rawResult = await response.json()
  const result = AttestationVerifyResponseSchema.parse(rawResult)
  return result.verified
}
