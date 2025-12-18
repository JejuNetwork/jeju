/**
 * Decentralized Services - storage and inference for council
 * Uses CovenantSQL for storage and DWS for compute
 * Automatically configured per network from @jejunetwork/config
 */

import {
  initializeState,
  storageState,
  autocratVoteState,
  proposalIndexState,
  type AutocratVote,
} from './state.js';
import { getDWSComputeUrl, getCurrentNetwork } from '@jejunetwork/config';

// DWS endpoint is automatically resolved from network config
function getDWSEndpoint(): string {
  return getDWSComputeUrl();
}

// Bounded in-memory caches for performance (CQL is source of truth)
const CACHE_MAX = 1000;
const evict = <K, V>(m: Map<K, V>) => { if (m.size >= CACHE_MAX) { const first = m.keys().next().value; if (first !== undefined) m.delete(first); } };
const storageCache = new Map<string, unknown>();
const researchCache = new Map<string, { report: string; model: string; completedAt: number }>();

export async function initStorage(): Promise<void> {
  await initializeState();
}

export async function store(data: unknown): Promise<string> {
  const hash = await storageState.store(data);
  evict(storageCache);
  storageCache.set(hash, data);
  return hash;
}

export async function retrieve<T>(hash: string): Promise<T | null> {
  if (storageCache.has(hash)) return storageCache.get(hash) as T;
  const data = await storageState.retrieve<T>(hash);
  if (data) {
    evict(storageCache);
    storageCache.set(hash, data);
  }
  return data;
}

async function checkDWSCompute(): Promise<boolean> {
  const endpoint = getDWSEndpoint();
  const r = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(2000) }).catch(() => null);
  return r?.ok ?? false;
}

interface InferenceRequest {
  messages: Array<{ role: string; content: string }>;
  systemPrompt?: string;
}

async function dwsGenerate(prompt: string, system: string): Promise<string> {
  const endpoint = getDWSEndpoint();
  // Use OpenAI-compatible endpoint - DWS will select the best available model
  const r = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 500,
    }),
  });
  if (!r.ok) {
    const network = getCurrentNetwork();
    throw new Error(`DWS compute error (network: ${network}): ${r.status}`);
  }
  const data = await r.json() as { choices?: Array<{ message?: { content: string } }>; content?: string };
  return data.choices?.[0]?.message?.content ?? data.content ?? '';
}

export async function inference(request: InferenceRequest): Promise<string> {
  const dwsAvailable = await checkDWSCompute();
  if (!dwsAvailable) {
    const network = getCurrentNetwork();
    throw new Error(
      `DWS compute is required for decentralized inference (network: ${network}).\n` +
      'Ensure DWS is running: docker compose up -d dws'
    );
  }

  const prompt = request.messages.map(m => `${m.role}: ${m.content}`).join('\n');
  const system = request.systemPrompt ?? 'You are a helpful AI assistant for DAO governance.';
  return dwsGenerate(prompt, system);
}

// Vote storage - persisted to CQL
export async function storeVote(proposalId: string, vote: { role: string; vote: string; reasoning: string; confidence: number; daoId?: string }): Promise<void> {
  const voteWithTime: AutocratVote = { ...vote, timestamp: Date.now() };
  await autocratVoteState.save(proposalId, voteWithTime);
  
  // Also store as generic object for audit trail
  await store({ type: 'vote', proposalId, daoId: vote.daoId, ...voteWithTime });
}

export async function getVotes(proposalId: string): Promise<AutocratVote[]> {
  return autocratVoteState.getByProposal(proposalId);
}

// Research storage - persisted to CQL
export async function generateResearch(proposalId: string, description: string): Promise<{ report: string; model: string }> {
  const prompt = `Analyze this DAO proposal and provide a research report:

Proposal ID: ${proposalId}
Description: ${description}

Provide analysis covering:
1. Technical feasibility
2. Economic impact
3. Risk assessment
4. Recommendation (proceed/reject/modify)

Be specific and actionable.`;

  const system = 'You are a research analyst for DAO governance. Provide thorough, objective analysis.';

  const dwsAvailable = await checkDWSCompute();
  if (!dwsAvailable) {
    const network = getCurrentNetwork();
    throw new Error(
      `DWS compute is required for research generation (network: ${network}).\n` +
      'Ensure DWS is running: docker compose up -d dws'
    );
  }

  const report = await dwsGenerate(prompt, system);
  const result = { report, model: 'dws-compute', completedAt: Date.now() };
  evict(researchCache);
  researchCache.set(proposalId, result);
  await store({ type: 'research', proposalId, ...result });
  return result;
}

export function getResearch(proposalId: string): { report: string; model: string; completedAt: number } | null {
  return researchCache.get(proposalId) ?? null;
}

// Proposal content index for duplicate detection - persisted to CQL
export async function indexProposal(contentHash: string, title: string, description: string, proposalType: number): Promise<void> {
  await proposalIndexState.index(contentHash, title, description, proposalType);
}

export async function findSimilarProposals(title: string, threshold = 30): Promise<Array<{ contentHash: string; title: string; similarity: number }>> {
  return proposalIndexState.findSimilar(title, threshold);
}

let initialized = false;

export async function initLocalServices(): Promise<void> {
  if (initialized) return;
  await initStorage();
  const dwsUp = await checkDWSCompute();
  const proposalIndex = await proposalIndexState.getAll();
  console.log(`[Services] Storage: CovenantSQL (decentralized)`);
  console.log(`[Services] Proposal index: ${proposalIndex.size} entries`);
  console.log(`[Services] DWS Compute: ${dwsUp ? 'ready' : 'NOT AVAILABLE'}`);
  if (!dwsUp) {
    console.warn('[Services] WARNING: DWS compute not available - inference will fail');
  }
  initialized = true;
}

export function isInitialized(): boolean {
  return initialized;
}
