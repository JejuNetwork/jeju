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

import { z } from 'zod';
import { keccak256, stringToHex, type Hex } from 'viem';
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { getCurrentNetwork, getDWSComputeUrl } from '@jejunetwork/config';
import {
  encryptDecision,
  backupToDA,
  getEncryptionStatus,
  type DecisionData,
  type EncryptedData,
} from './encryption';
import type { TEEAttestation } from './types';

// ============ Schemas ============

const EncryptedCipherSchema = z.object({
  ciphertext: z.string(),
  iv: z.string(),
  tag: z.string(),
});

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
});

const AttestationVerifyResponseSchema = z.object({
  verified: z.boolean(),
  platform: z.string().optional(),
  measurement: z.string().optional(),
});

// ============ Types ============

export interface TEEDecisionContext {
  proposalId: string;
  daoId?: string;
  persona?: { name: string; personality: string; traits: string[]; communicationTone: string };
  autocratVotes: Array<{ role: string; vote: string; reasoning: string }>;
  researchReport?: string;
}

export interface TEEDecisionResult {
  approved: boolean;
  publicReasoning: string;
  encryptedReasoning: string;
  encryptedHash: string;
  confidenceScore: number;
  alignmentScore: number;
  recommendations: string[];
  attestation: TEEAttestation;
  encrypted?: EncryptedData;
  daBackupHash?: string;
}

type TEEPlatform = 'intel_tdx' | 'amd_sev' | 'simulator' | 'none';
type TEEMode = 'dstack' | 'local';

// ============ Configuration ============

// dstack endpoint - defaults to DWS compute which runs dstack
function getDStackEndpoint(): string {
  return process.env.DSTACK_ENDPOINT ?? process.env.DWS_URL ?? getDWSComputeUrl();
}

function getTEEPlatform(): TEEPlatform {
  const platform = process.env.TEE_PLATFORM as TEEPlatform | undefined;
  if (platform && ['intel_tdx', 'amd_sev', 'simulator', 'none'].includes(platform)) {
    return platform;
  }
  
  // Auto-detect based on network
  const network = getCurrentNetwork();
  switch (network) {
    case 'mainnet':
      return 'intel_tdx'; // Production requires hardware TEE
    case 'testnet':
      return 'simulator'; // Testnet uses simulator for testing
    default:
      return 'simulator'; // Local dev uses simulator
  }
}

const USE_ENCRYPTION = process.env.USE_ENCRYPTION !== 'false';
const BACKUP_TO_DA = process.env.BACKUP_TO_DA !== 'false';

// ============ Encryption (for local encrypted mode) ============

function getDerivedKey(): Buffer {
  const secret = process.env.TEE_ENCRYPTION_SECRET;
  if (!secret) {
    const network = getCurrentNetwork();
    if (network === 'mainnet') {
      throw new Error('TEE_ENCRYPTION_SECRET is required in production');
    }
    // Dev/test mode - use derived key
    console.warn('[TEE] Using derived dev key (not for production)');
    const devSecret = `council-${network}-key`;
    const hash = keccak256(stringToHex(devSecret));
    return Buffer.from(hash.slice(2, 66), 'hex');
  }
  const hash = keccak256(stringToHex(secret));
  return Buffer.from(hash.slice(2, 66), 'hex');
}

function encrypt(data: string): { ciphertext: string; iv: string; tag: string } {
  const key = getDerivedKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return { ciphertext: encrypted, iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex') };
}

function decrypt(ciphertext: string, iv: string, tag: string): string {
  const key = getDerivedKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ============ Vote Analysis ============

function analyzeVotes(votes: TEEDecisionContext['autocratVotes']): { 
  approves: number; 
  rejects: number; 
  total: number; 
  consensusRatio: number;
} {
  const approves = votes.filter(v => v.vote === 'APPROVE').length;
  const rejects = votes.filter(v => v.vote === 'REJECT').length;
  const total = votes.length;
  return { 
    approves, 
    rejects, 
    total, 
    consensusRatio: Math.max(approves, rejects) / Math.max(total, 1) 
  };
}

function makeDecision(context: TEEDecisionContext): { 
  approved: boolean; 
  reasoning: string; 
  confidence: number; 
  alignment: number; 
  recommendations: string[];
} {
  const { approves, rejects, total, consensusRatio } = analyzeVotes(context.autocratVotes);
  const approved = approves > rejects && approves >= total / 2;
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
  };
}

// ============ dstack TEE Integration ============

async function callDStack(context: TEEDecisionContext): Promise<TEEDecisionResult> {
  const endpoint = getDStackEndpoint();
  const platform = getTEEPlatform();
  
  console.log(`[TEE] Calling dstack at ${endpoint} (platform: ${platform})`);
  
  const response = await fetch(`${endpoint}/tee/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      context,
      platform,
      attestationRequired: platform !== 'simulator',
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`dstack TEE decision failed: ${response.status} - ${error}`);
  }

  const rawData = await response.json();
  const data = DStackResponseSchema.parse(rawData);

  // Encrypt internal data
  const internalData = JSON.stringify({ 
    context, 
    decision: data, 
    timestamp: Date.now(),
    platform: data.attestation.platform,
  });
  const encrypted = encrypt(internalData);
  const encryptedReasoning = JSON.stringify(encrypted);

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
  };
}

// ============ Local Fallback (when dstack unavailable) ============

function makeLocalDecision(context: TEEDecisionContext): TEEDecisionResult {
  const { approved, reasoning, confidence, alignment, recommendations } = makeDecision(context);
  
  const internalData = JSON.stringify({ 
    context, 
    decision: approved ? 'APPROVE' : 'REJECT', 
    timestamp: Date.now(), 
    mode: 'local-fallback',
  });
  const encrypted = encrypt(internalData);
  const encryptedReasoning = JSON.stringify(encrypted);

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
  };
}

// ============ Public API ============

export function getTEEMode(): TEEMode {
  const platform = getTEEPlatform();
  // Only use local mode if explicitly set to 'none'
  return platform === 'none' ? 'local' : 'dstack';
}

export function getTEEInfo(): { mode: TEEMode; platform: TEEPlatform; endpoint: string } {
  return {
    mode: getTEEMode(),
    platform: getTEEPlatform(),
    endpoint: getDStackEndpoint(),
  };
}

export async function makeTEEDecision(context: TEEDecisionContext): Promise<TEEDecisionResult> {
  const mode = getTEEMode();
  const platform = getTEEPlatform();
  let result: TEEDecisionResult;

  if (mode === 'dstack') {
    console.log(`[TEE] Using dstack TEE (platform: ${platform})`);
    try {
      result = await callDStack(context);
    } catch (err) {
      // In local dev, fall back to local decision if dstack not running
      const network = getCurrentNetwork();
      if (network === 'localnet') {
        console.warn(`[TEE] dstack unavailable, using local mode: ${err instanceof Error ? err.message : 'unknown'}`);
        result = makeLocalDecision(context);
      } else {
        throw err; // In testnet/mainnet, don't fallback
      }
    }
  } else {
    console.log('[TEE] Using local encrypted mode (no TEE)');
    result = makeLocalDecision(context);
  }

  // Apply additional encryption layer via KMS
  if (USE_ENCRYPTION) {
    const encryptionStatus = getEncryptionStatus();
    console.log(`[TEE] KMS encryption: ${encryptionStatus.provider}`);

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
    };

    result.encrypted = await encryptDecision(decisionData);
    console.log('[TEE] Decision encrypted via KMS');
  }

  // Backup to DA layer
  if (BACKUP_TO_DA && result.encrypted) {
    const backup = await backupToDA(context.proposalId, result.encrypted);
    result.daBackupHash = backup.hash;
    console.log('[TEE] Decision backed up to DA:', backup.hash);
  }

  return result;
}

export function decryptReasoning(encryptedReasoning: string): Record<string, unknown> {
  const rawParsed = JSON.parse(encryptedReasoning);
  const { ciphertext, iv, tag } = EncryptedCipherSchema.parse(rawParsed);
  const decrypted = JSON.parse(decrypt(ciphertext, iv, tag));
  return z.record(z.string(), z.unknown()).parse(decrypted);
}

export async function verifyAttestation(attestation: TEEAttestation): Promise<boolean> {
  if (attestation.provider === 'local') {
    return true; // Local attestations are always "valid"
  }
  
  const endpoint = getDStackEndpoint();
  
  const response = await fetch(`${endpoint}/tee/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      quote: attestation.quote,
      measurement: attestation.measurement,
    }),
    signal: AbortSignal.timeout(10000),
  });
  
  if (!response.ok) {
    throw new Error(`TEE attestation verification failed: ${response.status} ${response.statusText}`);
  }
  
  const rawResult = await response.json();
  const result = AttestationVerifyResponseSchema.parse(rawResult);
  return result.verified;
}
