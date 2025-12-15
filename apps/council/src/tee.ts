/**
 * TEE Service for Council CEO Decisions
 *
 * Provides encrypted AI decision-making with:
 * - Local TEE simulation (or connect to your own TEE_ENDPOINT)
 * - Jeju KMS for encryption
 * - DA layer backup for persistence
 */

import { keccak256, toUtf8Bytes } from 'ethers';
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import {
  encryptDecision,
  backupToDA,
  getEncryptionStatus,
  type DecisionData,
  type EncryptedData,
} from './encryption';

export interface TEEDecisionContext {
  proposalId: string;
  councilVotes: Array<{ role: string; vote: string; reasoning: string }>;
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

export interface TEEAttestation {
  provider: 'local' | 'remote';
  quote?: string;
  measurement?: string;
  timestamp: number;
  verified: boolean;
}

const TEE_ENDPOINT = process.env.TEE_ENDPOINT;
const USE_ENCRYPTION = process.env.USE_ENCRYPTION !== 'false';
const BACKUP_TO_DA = process.env.BACKUP_TO_DA !== 'false';

function getDerivedKey(): Buffer {
  const secret = process.env.TEE_ENCRYPTION_SECRET ?? 'council-local-dev-key';
  const hash = keccak256(toUtf8Bytes(secret));
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

function analyzeVotes(votes: TEEDecisionContext['councilVotes']): { approves: number; rejects: number; total: number; consensusRatio: number } {
  const approves = votes.filter(v => v.vote === 'APPROVE').length;
  const rejects = votes.filter(v => v.vote === 'REJECT').length;
  const total = votes.length;
  return { approves, rejects, total, consensusRatio: Math.max(approves, rejects) / Math.max(total, 1) };
}

function makeDecision(context: TEEDecisionContext): { approved: boolean; reasoning: string; confidence: number; alignment: number; recommendations: string[] } {
  const { approves, rejects, total, consensusRatio } = analyzeVotes(context.councilVotes);
  const approved = approves > rejects && approves >= total / 2;
  return {
    approved,
    reasoning: approved
      ? `Approved with ${approves}/${total} council votes in favor.`
      : `Rejected with ${rejects}/${total} council votes against.`,
    confidence: Math.round(50 + consensusRatio * 50),
    alignment: approved ? 80 : 40,
    recommendations: approved ? ['Proceed with implementation'] : ['Address council concerns', 'Resubmit with modifications'],
  };
}

async function callRemoteTEE(context: TEEDecisionContext): Promise<TEEDecisionResult> {
  if (!TEE_ENDPOINT) throw new Error('TEE_ENDPOINT required for remote TEE');

  const response = await fetch(`${TEE_ENDPOINT}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) throw new Error(`TEE decision failed: ${response.status}`);

  const data = await response.json() as { 
    approved: boolean; 
    reasoning: string; 
    confidence: number; 
    alignment: number; 
    recommendations: string[];
    attestation?: { quote: string; measurement: string };
  };

  const internalData = JSON.stringify({ context, decision: data, timestamp: Date.now() });
  const encrypted = encrypt(internalData);
  const encryptedReasoning = JSON.stringify(encrypted);

  return {
    approved: data.approved,
    publicReasoning: data.reasoning,
    encryptedReasoning,
    encryptedHash: keccak256(toUtf8Bytes(encryptedReasoning)),
    confidenceScore: data.confidence,
    alignmentScore: data.alignment,
    recommendations: data.recommendations,
    attestation: { provider: 'remote', quote: data.attestation?.quote, measurement: data.attestation?.measurement, timestamp: Date.now(), verified: true },
  };
}

function makeLocalDecision(context: TEEDecisionContext): TEEDecisionResult {
  const { approved, reasoning, confidence, alignment, recommendations } = makeDecision(context);
  const internalData = JSON.stringify({ context, decision: approved ? 'APPROVE' : 'REJECT', timestamp: Date.now(), mode: 'local' });
  const encrypted = encrypt(internalData);
  const encryptedReasoning = JSON.stringify(encrypted);

  return {
    approved,
    publicReasoning: reasoning,
    encryptedReasoning,
    encryptedHash: keccak256(toUtf8Bytes(encryptedReasoning)),
    confidenceScore: confidence,
    alignmentScore: alignment,
    recommendations,
    attestation: { provider: 'local', quote: keccak256(toUtf8Bytes(`local:${Date.now()}`)), timestamp: Date.now(), verified: true },
  };
}

export function getTEEMode(): 'local' | 'remote' {
  return TEE_ENDPOINT ? 'remote' : 'local';
}

export async function makeTEEDecision(context: TEEDecisionContext): Promise<TEEDecisionResult> {
  const mode = getTEEMode();
  let result: TEEDecisionResult;

  if (mode === 'remote') {
    console.log('[TEE] Using remote TEE at', TEE_ENDPOINT);
    result = await callRemoteTEE(context);
  } else {
    console.log('[TEE] Using local encrypted mode');
    result = makeLocalDecision(context);
  }

  if (USE_ENCRYPTION) {
    const encryptionStatus = getEncryptionStatus();
    console.log(`[TEE] Encryption: ${encryptionStatus.provider}`);

    const decisionData: DecisionData = {
      proposalId: context.proposalId,
      approved: result.approved,
      reasoning: result.publicReasoning,
      confidenceScore: result.confidenceScore,
      alignmentScore: result.alignmentScore,
      councilVotes: context.councilVotes,
      researchSummary: context.researchReport,
      model: mode === 'remote' ? 'remote-tee' : 'local',
      timestamp: Date.now(),
    };

    try {
      result.encrypted = await encryptDecision(decisionData);
      console.log('[TEE] Decision encrypted');
    } catch (error) {
      console.error('[TEE] Encryption failed:', (error as Error).message);
    }
  }

  if (BACKUP_TO_DA && result.encrypted) {
    try {
      const backup = await backupToDA(context.proposalId, result.encrypted);
      result.daBackupHash = backup.hash;
      console.log('[TEE] Decision backed up to DA:', backup.hash);
    } catch (error) {
      console.error('[TEE] DA backup failed:', (error as Error).message);
    }
  }

  return result;
}

export function decryptReasoning(encryptedReasoning: string): Record<string, unknown> {
  const { ciphertext, iv, tag } = JSON.parse(encryptedReasoning) as { ciphertext: string; iv: string; tag: string };
  return JSON.parse(decrypt(ciphertext, iv, tag)) as Record<string, unknown>;
}

export async function verifyAttestation(attestation: TEEAttestation): Promise<boolean> {
  if (attestation.provider === 'local') return true;
  if (!TEE_ENDPOINT) return false;
  
  const response = await fetch(`${TEE_ENDPOINT}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quote: attestation.quote }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  
  if (!response?.ok) return false;
  return ((await response.json()) as { verified: boolean }).verified;
}
