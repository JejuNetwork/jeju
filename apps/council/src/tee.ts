/**
 * TEE Service for Council CEO Decisions
 * 
 * Uses hardware TEE when TEE_API_KEY is configured,
 * otherwise falls back to local simulation for development.
 */

import { keccak256, toUtf8Bytes } from 'ethers';
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';

// ============================================================================
// Types
// ============================================================================

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
  attestation?: TEEAttestation;
}

export interface TEEAttestation {
  provider: 'hardware' | 'simulated';
  quote?: string;
  measurement?: string;
  timestamp: number;
  verified: boolean;
}

export type TEEMode = 'hardware' | 'simulated';

// ============================================================================
// Configuration
// ============================================================================

// TEE provider configuration (supports multiple backends)
const TEE_API_KEY = process.env.TEE_API_KEY ?? process.env.PHALA_API_KEY;
const TEE_CLOUD_URL = process.env.TEE_CLOUD_URL ?? process.env.PHALA_CLOUD_URL ?? 'https://cloud.phala.network/api/v1';
const DCAP_ENDPOINT = process.env.DCAP_ENDPOINT ?? 'https://dcap.phala.network/verify';

// Derive encryption key from env or generate one for simulated mode
function getDerivedKey(): Buffer {
  const secret = process.env.TEE_ENCRYPTION_SECRET ?? 'council-local-dev-key';
  const hash = keccak256(toUtf8Bytes(secret));
  return Buffer.from(hash.slice(2, 66), 'hex'); // 32 bytes for AES-256
}

// ============================================================================
// Hardware TEE Client
// ============================================================================

interface TEEInferenceRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
}

interface TEEInferenceResponse {
  choices: Array<{ message: { content: string } }>;
  attestation?: {
    quote: string;
    measurement: string;
  };
}

async function callHardwareTEEInference(request: TEEInferenceRequest): Promise<TEEInferenceResponse> {
  if (!TEE_API_KEY) {
    throw new Error('TEE_API_KEY not configured');
  }

  const response = await fetch(`${TEE_CLOUD_URL}/inference`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TEE_API_KEY}`,
    },
    body: JSON.stringify({
      ...request,
      attestation: true, // Request attestation with response
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`TEE inference failed: ${response.status} - ${error}`);
  }

  return response.json() as Promise<TEEInferenceResponse>;
}

async function verifyTEEAttestation(quote: string): Promise<boolean> {
  const response = await fetch(DCAP_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quote }),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    console.warn('[TEE] DCAP verification unavailable, attestation not verified');
    return false;
  }

  const result = await response.json() as { verified: boolean };
  return result.verified;
}

// ============================================================================
// Encryption (AES-256-GCM)
// ============================================================================

function encrypt(data: string): { ciphertext: string; iv: string; tag: string } {
  const key = getDerivedKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  };
}

function decrypt(ciphertext: string, iv: string, tag: string): string {
  const key = getDerivedKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ============================================================================
// Decision Logic
// ============================================================================

function analyzeVotes(votes: TEEDecisionContext['councilVotes']): {
  approves: number;
  rejects: number;
  total: number;
  consensusRatio: number;
} {
  const approves = votes.filter(v => v.vote === 'APPROVE').length;
  const rejects = votes.filter(v => v.vote === 'REJECT').length;
  const total = votes.length;
  const consensusRatio = Math.max(approves, rejects) / Math.max(total, 1);
  
  return { approves, rejects, total, consensusRatio };
}

function makeDecision(context: TEEDecisionContext): {
  approved: boolean;
  reasoning: string;
  confidence: number;
  alignment: number;
} {
  const { approves, rejects, total, consensusRatio } = analyzeVotes(context.councilVotes);
  
  // Decision: majority approve AND at least half voted approve
  const approved = approves > rejects && approves >= total / 2;
  
  const confidence = Math.round(50 + consensusRatio * 50);
  const alignment = approved ? 80 : 40;
  
  const reasoning = approved
    ? `Approved with ${approves}/${total} council votes in favor.`
    : `Rejected with ${rejects}/${total} council votes against.`;

  return { approved, reasoning, confidence, alignment };
}

// ============================================================================
// TEE Decision Functions
// ============================================================================

/**
 * Make a CEO decision using hardware TEE
 * The decision reasoning is processed inside the TEE and encrypted
 */
async function makeHardwareTEEDecision(context: TEEDecisionContext): Promise<TEEDecisionResult> {
  // Build prompt for AI decision in TEE
  const prompt = `You are the AI CEO of Jeju DAO. Make a final decision on this proposal.

Proposal ID: ${context.proposalId}

Council Votes:
${context.councilVotes.map(v => `- ${v.role}: ${v.vote} - ${v.reasoning}`).join('\n')}

${context.researchReport ? `Research Report:\n${context.researchReport}` : ''}

Based on the council votes and any research, provide your decision.
Return JSON: { "approved": boolean, "reasoning": string, "confidence": 0-100, "alignment": 0-100, "recommendations": string[] }`;

  const response = await callHardwareTEEInference({
    model: 'claude-sonnet-4-20250514',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 1000,
  });

  const content = response.choices[0]?.message.content ?? '{}';
  const decision = JSON.parse(content) as {
    approved: boolean;
    reasoning: string;
    confidence: number;
    alignment: number;
    recommendations: string[];
  };

  // Encrypt internal reasoning
  const internalData = JSON.stringify({
    context,
    decision,
    model: 'claude-sonnet-4-20250514',
    timestamp: Date.now(),
    attestation: response.attestation,
  });
  const encrypted = encrypt(internalData);
  const encryptedReasoning = JSON.stringify(encrypted);
  const encryptedHash = keccak256(toUtf8Bytes(encryptedReasoning));

  // Verify attestation if available
  let verified = false;
  if (response.attestation?.quote) {
    verified = await verifyTEEAttestation(response.attestation.quote);
  }

  return {
    approved: decision.approved,
    publicReasoning: decision.reasoning,
    encryptedReasoning,
    encryptedHash,
    confidenceScore: decision.confidence,
    alignmentScore: decision.alignment,
    recommendations: decision.recommendations,
    attestation: {
      provider: 'hardware',
      quote: response.attestation?.quote,
      measurement: response.attestation?.measurement,
      timestamp: Date.now(),
      verified,
    },
  };
}

/**
 * Make a CEO decision using local simulation
 * Uses deterministic logic and AES-256-GCM encryption
 */
function makeSimulatedTEEDecision(context: TEEDecisionContext): TEEDecisionResult {
  const { approved, reasoning, confidence, alignment } = makeDecision(context);

  // Encrypt internal reasoning with real AES-256-GCM
  const internalData = JSON.stringify({
    context,
    decision: approved ? 'APPROVE' : 'REJECT',
    timestamp: Date.now(),
    mode: 'simulated',
  });
  const encrypted = encrypt(internalData);
  const encryptedReasoning = JSON.stringify(encrypted);
  const encryptedHash = keccak256(toUtf8Bytes(encryptedReasoning));

  return {
    approved,
    publicReasoning: reasoning,
    encryptedReasoning,
    encryptedHash,
    confidenceScore: confidence,
    alignmentScore: alignment,
    recommendations: approved
      ? ['Proceed with implementation']
      : ['Address council concerns', 'Resubmit with modifications'],
    attestation: {
      provider: 'simulated',
      timestamp: Date.now(),
      verified: false,
    },
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get current TEE mode based on configuration
 */
export function getTEEMode(): TEEMode {
  return TEE_API_KEY ? 'hardware' : 'simulated';
}

/**
 * Make a CEO decision using available TEE
 * Automatically uses hardware TEE if TEE_API_KEY is set, otherwise simulated
 */
export async function makeTEEDecision(context: TEEDecisionContext): Promise<TEEDecisionResult> {
  const mode = getTEEMode();
  
  if (mode === 'hardware') {
    console.log('[TEE] Using hardware TEE for decision');
    return makeHardwareTEEDecision(context);
  }
  
  console.log('[TEE] Using simulated TEE (set TEE_API_KEY for hardware TEE)');
  return makeSimulatedTEEDecision(context);
}

/**
 * Decrypt CEO decision reasoning (requires TEE key)
 */
export function decryptReasoning(encryptedReasoning: string): Record<string, unknown> {
  const { ciphertext, iv, tag } = JSON.parse(encryptedReasoning) as {
    ciphertext: string;
    iv: string;
    tag: string;
  };
  const decrypted = decrypt(ciphertext, iv, tag);
  return JSON.parse(decrypted) as Record<string, unknown>;
}

/**
 * Verify an attestation quote with DCAP
 */
export async function verifyAttestation(quote: string): Promise<boolean> {
  return verifyTEEAttestation(quote);
}

// For backwards compatibility with local-services.ts
export { makeSimulatedTEEDecision as simulateTEEDecision };
