/**
 * Local Services - storage and inference for council
 */

import { keccak256, toUtf8Bytes } from 'ethers';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const storageDir = join(process.cwd(), '.council-storage');

// Bounded caches to prevent memory exhaustion
const CACHE_MAX = 1000;
const evict = <K, V>(m: Map<K, V>) => { if (m.size >= CACHE_MAX) { const first = m.keys().next().value; if (first !== undefined) m.delete(first); } };
const storageCache = new Map<string, unknown>();

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';

export async function initStorage(): Promise<void> {
  if (!existsSync(storageDir)) await mkdir(storageDir, { recursive: true });
}

export async function store(data: unknown): Promise<string> {
  const content = JSON.stringify(data);
  const hash = keccak256(toUtf8Bytes(content)).slice(2, 50);
  await writeFile(join(storageDir, `${hash}.json`), content, 'utf-8');
  evict(storageCache);
  storageCache.set(hash, data);
  return hash;
}

export async function retrieve<T>(hash: string): Promise<T | null> {
  if (storageCache.has(hash)) return storageCache.get(hash) as T;
  const path = join(storageDir, `${hash}.json`);
  if (!existsSync(path)) return null;
  const data = JSON.parse(await readFile(path, 'utf-8')) as T;
  storageCache.set(hash, data);
  return data;
}

async function checkOllama(): Promise<boolean> {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
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

export async function inference(request: InferenceRequest): Promise<string> {
  const available = await checkOllama();
  if (!available) {
    throw new Error('LLM unavailable: Ollama not running. Start with: ollama serve');
  }

  const prompt = request.messages.map(m => `${m.role}: ${m.content}`).join('\n');
  const system = request.systemPrompt ?? 'You are a helpful AI assistant for DAO governance.';
  return ollamaGenerate(prompt, system);
}

// Vote storage (bounded)
const voteStore = new Map<string, Array<{ role: string; vote: string; reasoning: string; confidence: number; timestamp: number }>>();
const pendingPersistence = new Map<string, { data: unknown; retries: number; lastAttempt: number }>();
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

async function persistWithRetry(key: string, data: unknown): Promise<void> {
  let retries = 0;
  while (retries < MAX_RETRIES) {
    try {
      await store(data);
      pendingPersistence.delete(key);
      return;
    } catch (err) {
      retries++;
      console.error(`[Vote] Persistence failed (attempt ${retries}/${MAX_RETRIES}):`, (err as Error).message);
      if (retries < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * retries));
      }
    }
  }
  // Store for later retry
  pendingPersistence.set(key, { data, retries: MAX_RETRIES, lastAttempt: Date.now() });
  console.error(`[Vote] Persistence exhausted retries for ${key}, queued for later`);
}

export function storeVote(proposalId: string, vote: { role: string; vote: string; reasoning: string; confidence: number }): void {
  const votes = voteStore.get(proposalId) ?? [];
  const voteWithTime = { ...vote, timestamp: Date.now() };
  votes.push(voteWithTime);
  evict(voteStore);
  voteStore.set(proposalId, votes);
  
  // Persist to disk with retry
  const persistKey = `vote-${proposalId}-${voteWithTime.timestamp}`;
  persistWithRetry(persistKey, { type: 'vote', proposalId, ...voteWithTime });
}

export function getPendingPersistence(): number {
  return pendingPersistence.size;
}

export function getVotes(proposalId: string): Array<{ role: string; vote: string; reasoning: string; confidence: number; timestamp: number }> {
  return voteStore.get(proposalId) ?? [];
}

// Research storage (bounded)
const researchStore = new Map<string, { report: string; model: string; completedAt: number }>();

export async function generateResearch(proposalId: string, description: string): Promise<{ report: string; model: string }> {
  const available = await checkOllama();
  if (!available) {
    throw new Error('LLM unavailable: Cannot generate research without Ollama');
  }

  const prompt = `Analyze this DAO proposal and provide a research report:

Proposal ID: ${proposalId}
Description: ${description}

Provide analysis covering:
1. Technical feasibility
2. Economic impact
3. Risk assessment
4. Recommendation (proceed/reject/modify)

Be specific and actionable.`;

  const report = await ollamaGenerate(prompt, 'You are a research analyst for DAO governance. Provide thorough, objective analysis.');
  const result = { report, model: OLLAMA_MODEL, completedAt: Date.now() };
  evict(researchStore);
  researchStore.set(proposalId, result);
  await store({ type: 'research', proposalId, ...result });
  return result;
}

export function getResearch(proposalId: string): { report: string; model: string; completedAt: number } | null {
  return researchStore.get(proposalId) ?? null;
}

// Proposal content index for duplicate detection (persisted to disk)
interface ProposalContent { title: string; description: string; proposalType: number; createdAt: number; contentHash: string }
const proposalIndex = new Map<string, ProposalContent>();
const PROPOSAL_INDEX_FILE = 'proposal-index.json';

async function indexProposal(contentHash: string, title: string, description: string, proposalType: number): Promise<void> {
  evict(proposalIndex);
  proposalIndex.set(contentHash, { title, description, proposalType, createdAt: Date.now(), contentHash });
  await saveProposalIndex();
}

function findSimilarProposals(title: string, threshold = 30): Array<{ contentHash: string; title: string; similarity: number }> {
  const words = new Set(title.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  if (words.size === 0) return [];

  const results: Array<{ contentHash: string; title: string; similarity: number }> = [];
  for (const [hash, p] of proposalIndex) {
    const pWords = new Set(p.title.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const matches = [...words].filter(w => pWords.has(w)).length;
    const similarity = Math.round((matches / Math.max(words.size, 1)) * 100);
    if (similarity >= threshold) results.push({ contentHash: hash, title: p.title, similarity });
  }
  return results.sort((a, b) => b.similarity - a.similarity).slice(0, 5);
}

async function saveProposalIndex(): Promise<void> {
  const data = Object.fromEntries(proposalIndex);
  await writeFile(join(storageDir, PROPOSAL_INDEX_FILE), JSON.stringify(data), 'utf-8');
}

async function loadProposalIndex(): Promise<void> {
  const path = join(storageDir, PROPOSAL_INDEX_FILE);
  if (!existsSync(path)) return;
  const data = JSON.parse(await readFile(path, 'utf-8')) as Record<string, ProposalContent>;
  for (const [k, v] of Object.entries(data)) proposalIndex.set(k, v);
}

let initialized = false;

export async function initLocalServices(): Promise<void> {
  if (initialized) return;
  await initStorage();
  await loadProposalIndex();
  const ollamaUp = await checkOllama();
  console.log(`[Services] Storage: ${storageDir}`);
  console.log(`[Services] Proposal index: ${proposalIndex.size} entries`);
  console.log(`[Services] Ollama: ${ollamaUp ? `ready (${OLLAMA_MODEL})` : 'NOT AVAILABLE'}`);
  initialized = true;
}

export function isInitialized(): boolean {
  return initialized;
}

export { checkOllama, ollamaGenerate, OLLAMA_URL, OLLAMA_MODEL, indexProposal, findSimilarProposals };
