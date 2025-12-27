/**
 * TEE Service for Council CEO Decisions
 *
 * Provides encrypted AI decision-making with:
 * - dstack TEE (hardware or simulator mode)
 * - Jeju KMS for encryption
 * - DA layer backup for persistence
 *
 * In local development, uses dstack in simulator mode.
 * In production, requires hardware TEE (Intel TDX or AMD SEV).
 */

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

function getDerivedKey(): Uint8Array {
  const secret = config.teeEncryptionSecret
  const network = getCurrentNetwork()

  if (!secret) {
    // Require proper secret for mainnet AND testnet - both handle real/valuable data
    if (network === 'mainnet' || network === 'testnet') {
      throw new Error(
        `TEE_ENCRYPTION_SECRET is required for ${network}. Set a strong, random secret.`,
      )
    }
    // Localnet only: use ephemeral key (changes each process restart)
    // This ensures local dev works but data isn't recoverable across restarts
    console.warn(
      '[TEE] No TEE_ENCRYPTION_SECRET set. Using ephemeral key for localnet development only.',
    )
    const ephemeralSecret = `ephemeral-${Date.now()}-${Math.random()}`
    const hash = keccak256(stringToHex(ephemeralSecret))
    return fromHex(hash.slice(0, 66))
  }

  // Validate secret strength
  if (secret.length < 32) {
    throw new Error(
      'TEE_ENCRYPTION_SECRET must be at least 32 characters for adequate security',
    )
  }

  const hash = keccak256(stringToHex(secret))
  return fromHex(hash.slice(0, 66))
}

async function encrypt(data: string): Promise<{
  ciphertext: string
  iv: string
  tag: string
}> {
  const key = getDerivedKey()
  const dataBytes = new TextEncoder().encode(data)
  const { ciphertext, iv, tag } = await encryptAesGcm(dataBytes, key)
  return {
    ciphertext: bytesToHex(ciphertext),
    iv: bytesToHex(iv),
    tag: bytesToHex(tag),
  }
}

async function decrypt(
  ciphertext: string,
  iv: string,
  tag: string,
): Promise<string> {
  const key = getDerivedKey()
  const ciphertextBytes = fromHex(`0x${ciphertext}`)
  const ivBytes = fromHex(`0x${iv}`)
  const tagBytes = fromHex(`0x${tag}`)
  const decrypted = await decryptAesGcm(ciphertextBytes, key, ivBytes, tagBytes)
  return new TextDecoder().decode(decrypted)
}

function analyzeVotes(votes: TEEDecisionContext['autocratVotes']): {
  approves: number
  rejects: number
  total: number
  consensusRatio: number
} {
  const approves = votes.filter((v) => v.vote === 'APPROVE').length
  const rejects = votes.filter((v) => v.vote === 'REJECT').length
  const total = votes.length
  return {
    approves,
    rejects,
    total,
    consensusRatio: Math.max(approves, rejects) / Math.max(total, 1),
  }
}

function makeDecision(context: TEEDecisionContext): {
  approved: boolean
  reasoning: string
  confidence: number
  alignment: number
  recommendations: string[]
} {
  const { approves, rejects, total, consensusRatio } = analyzeVotes(
    context.autocratVotes,
  )
  const approved = approves > rejects && approves >= total / 2
  return {
    approved,
    reasoning: approved
      ? `Approved with ${approves}/${total} council votes in favor.`
      : `Rejected with ${rejects}/${total} council votes against.`,
    confidence: Math.round(50 + consensusRatio * 50),
    alignment: approved ? 80 : 40,
    recommendations: approved
      ? ['Proceed with implementation']
      : ['Address council concerns', 'Resubmit with modifications'],
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
    makeDecision(context)

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
