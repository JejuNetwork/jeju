/**
 * TEE Service for Council CEO Decisions
 *
 * Provides encrypted AI decision-making with:
 * - Hardware TEE (Phala Cloud) for production
 * - Simulated TEE for development
 * - Lit Protocol integration for distributed key management
 * - DA layer backup for persistence
 */

import { keccak256, toUtf8Bytes } from 'ethers';
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import {
  encryptDecision,
  backupToDA,
  getLitStatus,
  type DecisionData,
  type LitEncryptedData,
} from './lit-encryption';

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
  litEncrypted?: LitEncryptedData;
  daBackupHash?: string;
}

export interface TEEAttestation {
  provider: 'hardware' | 'simulated';
  quote?: string;
  measurement?: string;
  timestamp: number;
  verified: boolean;
}

export type TEEMode = 'hardware' | 'simulated';

const TEE_API_KEY = process.env.TEE_API_KEY ?? process.env.PHALA_API_KEY;
const TEE_CLOUD_URL = process.env.TEE_CLOUD_URL ?? process.env.PHALA_CLOUD_URL ?? 'https://cloud.phala.network/api/v1';
const DCAP_ENDPOINT = process.env.DCAP_ENDPOINT ?? 'https://dcap.phala.network/verify';
const REQUIRE_HARDWARE_TEE = process.env.REQUIRE_HARDWARE_TEE === 'true';
const USE_LIT_ENCRYPTION = process.env.USE_LIT_ENCRYPTION !== 'false';
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

function makeDecision(context: TEEDecisionContext): { approved: boolean; reasoning: string; confidence: number; alignment: number } {
  const { approves, rejects, total, consensusRatio } = analyzeVotes(context.councilVotes);
  const approved = approves > rejects && approves >= total / 2;
  return {
    approved,
    reasoning: approved
      ? `Approved with ${approves}/${total} council votes in favor.`
      : `Rejected with ${rejects}/${total} council votes against.`,
    confidence: Math.round(50 + consensusRatio * 50),
    alignment: approved ? 80 : 40,
  };
}

async function callHardwareTEE(context: TEEDecisionContext): Promise<TEEDecisionResult> {
  if (!TEE_API_KEY) throw new Error('TEE_API_KEY required for hardware TEE');

  const prompt = `You are the AI CEO of Jeju DAO. Make a final decision on this proposal.

Proposal ID: ${context.proposalId}

Council Votes:
${context.councilVotes.map(v => `- ${v.role}: ${v.vote} - ${v.reasoning}`).join('\n')}

${context.researchReport ? `Research Report:\n${context.researchReport}` : ''}

Return JSON: { "approved": boolean, "reasoning": string, "confidence": 0-100, "alignment": 0-100, "recommendations": string[] }`;

  const response = await fetch(`${TEE_CLOUD_URL}/inference`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TEE_API_KEY}` },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 1000, attestation: true }),
  });

  if (!response.ok) throw new Error(`TEE inference failed: ${response.status} - ${await response.text()}`);

  const data = await response.json() as { choices: Array<{ message: { content: string } }>; attestation?: { quote: string; measurement: string } };
  const decision = JSON.parse(data.choices[0]?.message.content ?? '{}') as { approved: boolean; reasoning: string; confidence: number; alignment: number; recommendations: string[] };

  const internalData = JSON.stringify({ context, decision, model: 'claude-sonnet-4-20250514', timestamp: Date.now(), attestation: data.attestation });
  const encrypted = encrypt(internalData);
  const encryptedReasoning = JSON.stringify(encrypted);

  let verified = false;
  if (data.attestation?.quote) {
    const verifyResp = await fetch(DCAP_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quote: data.attestation.quote }),
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);
    if (verifyResp?.ok) {
      verified = ((await verifyResp.json()) as { verified: boolean }).verified;
    }
  }

  return {
    approved: decision.approved,
    publicReasoning: decision.reasoning,
    encryptedReasoning,
    encryptedHash: keccak256(toUtf8Bytes(encryptedReasoning)),
    confidenceScore: decision.confidence,
    alignmentScore: decision.alignment,
    recommendations: decision.recommendations,
    attestation: { provider: 'hardware', quote: data.attestation?.quote, measurement: data.attestation?.measurement, timestamp: Date.now(), verified },
  };
}

function makeSimulatedDecision(context: TEEDecisionContext): TEEDecisionResult {
  const { approved, reasoning, confidence, alignment } = makeDecision(context);
  const internalData = JSON.stringify({ context, decision: approved ? 'APPROVE' : 'REJECT', timestamp: Date.now(), mode: 'simulated' });
  const encrypted = encrypt(internalData);
  const encryptedReasoning = JSON.stringify(encrypted);

  return {
    approved,
    publicReasoning: reasoning,
    encryptedReasoning,
    encryptedHash: keccak256(toUtf8Bytes(encryptedReasoning)),
    confidenceScore: confidence,
    alignmentScore: alignment,
    recommendations: approved ? ['Proceed with implementation'] : ['Address council concerns', 'Resubmit with modifications'],
    attestation: { provider: 'simulated', timestamp: Date.now(), verified: false },
  };
}

export function getTEEMode(): TEEMode {
  return TEE_API_KEY ? 'hardware' : 'simulated';
}

export async function makeTEEDecision(context: TEEDecisionContext): Promise<TEEDecisionResult> {
  const mode = getTEEMode();

  if (REQUIRE_HARDWARE_TEE && mode !== 'hardware') {
    throw new Error('Hardware TEE required but TEE_API_KEY not configured');
  }

  let result: TEEDecisionResult;

  if (mode === 'hardware') {
    console.log('[TEE] Using hardware TEE');
    result = await callHardwareTEE(context);
  } else {
    console.log('[TEE] Using simulated TEE (set TEE_API_KEY for hardware)');
    result = makeSimulatedDecision(context);
  }

  // Encrypt with Lit Protocol for distributed key management
  if (USE_LIT_ENCRYPTION) {
    const litStatus = getLitStatus();
    console.log(`[TEE] Lit Protocol: ${litStatus.connected ? 'connected' : 'fallback mode'}`);

    const decisionData: DecisionData = {
      proposalId: context.proposalId,
      approved: result.approved,
      reasoning: result.publicReasoning,
      confidenceScore: result.confidenceScore,
      alignmentScore: result.alignmentScore,
      councilVotes: context.councilVotes,
      researchSummary: context.researchReport,
      model: mode === 'hardware' ? 'claude-sonnet-4-20250514' : 'simulated',
      timestamp: Date.now(),
    };

    try {
      result.litEncrypted = await encryptDecision(decisionData);
      console.log('[TEE] Decision encrypted with Lit Protocol');
    } catch (error) {
      console.error('[TEE] Lit encryption failed:', (error as Error).message);
    }
  }

  // Backup to DA layer for persistence
  if (BACKUP_TO_DA && result.litEncrypted) {
    try {
      const backup = await backupToDA(context.proposalId, result.litEncrypted);
      if (backup.success) {
        result.daBackupHash = backup.hash;
        console.log('[TEE] Decision backed up to DA:', backup.hash);
      }
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

export async function verifyAttestation(quote: string): Promise<boolean> {
  const response = await fetch(DCAP_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quote }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return false;
  return ((await response.json()) as { verified: boolean }).verified;
}
