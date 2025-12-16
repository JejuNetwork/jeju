/**
 * Decentralized Services - storage and inference for council
 * Uses CovenantSQL for storage and DWS for compute
 */

import {
  initializeState,
  storageState,
  autocratVoteState,
  proposalIndexState,
  type AutocratVote,
} from './state.js';

// DWS endpoints for decentralized compute
const DWS_URL = process.env.DWS_URL ?? 'http://localhost:4030';
const DWS_COMPUTE = `${DWS_URL}/compute`;

// Fallback to local Ollama if DWS compute unavailable
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';

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
  const r = await fetch(`${DWS_COMPUTE}/health`, { signal: AbortSignal.timeout(2000) }).catch(() => null);
  return r?.ok ?? false;
}

async function checkOllama(): Promise<boolean> {
  const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) }).catch(() => null);
  return r?.ok ?? false;
}

async function ollamaGenerate(prompt: string, system: string): Promise<string> {
  const r = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt, system, stream: false, options: { temperature: 0.7, num_predict: 500 } }),
  });
  if (!r.ok) throw new Error(`Ollama error: ${r.status}`);
  return ((await r.json()) as { response: string }).response;
}

interface InferenceRequest {
  messages: Array<{ role: string; content: string }>;
  systemPrompt?: string;
}

async function dwsGenerate(prompt: string, system: string): Promise<string> {
  const r = await fetch(`${DWS_COMPUTE}/chat`, {
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
  if (!r.ok) throw new Error(`DWS compute error: ${r.status}`);
  const data = await r.json() as { choices?: Array<{ message?: { content: string } }>; content?: string };
  return data.choices?.[0]?.message?.content ?? data.content ?? '';
}

export async function inference(request: InferenceRequest): Promise<string> {
  // Try DWS compute first for decentralized inference
  const dwsAvailable = await checkDWSCompute();
  if (dwsAvailable) {
    const prompt = request.messages.map(m => `${m.role}: ${m.content}`).join('\n');
    const system = request.systemPrompt ?? 'You are a helpful AI assistant for DAO governance.';
    return dwsGenerate(prompt, system);
  }

  // Fallback to local Ollama
  const ollamaAvailable = await checkOllama();
  if (!ollamaAvailable) {
    throw new Error('LLM unavailable: Neither DWS compute nor Ollama available');
  }

  const prompt = request.messages.map(m => `${m.role}: ${m.content}`).join('\n');
  const system = request.systemPrompt ?? 'You are a helpful AI assistant for DAO governance.';
  return ollamaGenerate(prompt, system);
}

// Vote storage - persisted to CQL
export async function storeVote(proposalId: string, vote: { role: string; vote: string; reasoning: string; confidence: number }): Promise<void> {
  const voteWithTime: AutocratVote = { ...vote, timestamp: Date.now() };
  await autocratVoteState.save(proposalId, voteWithTime);
  
  // Also store as generic object for audit trail
  await store({ type: 'vote', proposalId, ...voteWithTime });
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

  // Try DWS compute first
  const dwsAvailable = await checkDWSCompute();
  if (dwsAvailable) {
    const report = await dwsGenerate(prompt, system);
    const result = { report, model: 'dws-compute', completedAt: Date.now() };
    evict(researchCache);
    researchCache.set(proposalId, result);
    await store({ type: 'research', proposalId, ...result });
    return result;
  }

  // Fallback to Ollama
  const ollamaAvailable = await checkOllama();
  if (!ollamaAvailable) {
    throw new Error('LLM unavailable: Cannot generate research');
  }

  const report = await ollamaGenerate(prompt, system);
  const result = { report, model: OLLAMA_MODEL, completedAt: Date.now() };
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
  const ollamaUp = await checkOllama();
  const proposalIndex = await proposalIndexState.getAll();
  console.log(`[Services] Storage: CovenantSQL (decentralized)`);
  console.log(`[Services] Proposal index: ${proposalIndex.size} entries`);
  console.log(`[Services] DWS Compute: ${dwsUp ? 'ready' : 'NOT AVAILABLE'}`);
  console.log(`[Services] Ollama fallback: ${ollamaUp ? `ready (${OLLAMA_MODEL})` : 'NOT AVAILABLE'}`);
  initialized = true;
}

export function isInitialized(): boolean {
  return initialized;
}

export { checkOllama, ollamaGenerate, OLLAMA_URL, OLLAMA_MODEL };
