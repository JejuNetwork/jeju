/**
 * Local Services - storage, inference for development without external dependencies
 */

import { keccak256, toUtf8Bytes } from 'ethers';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// Storage
const storageDir = join(process.cwd(), '.council-storage');
const storageCache = new Map<string, unknown>();

export async function initStorage(): Promise<void> {
  if (!existsSync(storageDir)) await mkdir(storageDir, { recursive: true });
  console.log(`[Storage] Local storage at ${storageDir}`);
}

export async function store(data: unknown): Promise<string> {
  const content = JSON.stringify(data);
  const hash = keccak256(toUtf8Bytes(content)).slice(2, 50);
  await writeFile(join(storageDir, `${hash}.json`), content, 'utf-8');
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

// Local Inference
interface InferenceRequest {
  messages: Array<{ role: string; content: string }>;
}

export async function inference(request: InferenceRequest): Promise<string> {
  const content = request.messages.at(-1)?.content ?? '';
  
  if (content.includes('vote on this proposal')) return generateCouncilVote(content);
  if (content.includes('Assess this DAO proposal')) return generateQualityAssessment(content);
  if (content.includes('research')) return generateResearchReport(content);
  
  return JSON.stringify({ response: 'Acknowledged', timestamp: Date.now() });
}

function generateCouncilVote(prompt: string): string {
  const lower = prompt.toLowerCase();
  const concerns: string[] = [];
  let vote: 'APPROVE' | 'REJECT' | 'ABSTAIN' | 'REQUEST_CHANGES' = 'APPROVE';

  if ((prompt.includes('Treasury') || prompt.includes('financial')) && 
      (lower.includes('high cost') || lower.includes('expensive'))) {
    concerns.push('Budget concerns noted');
    vote = 'REQUEST_CHANGES';
  }
  if ((prompt.includes('Security') || prompt.includes('security')) && 
      (lower.includes('untested') || lower.includes('risk'))) {
    concerns.push('Security review recommended');
  }
  if ((prompt.includes('Code') || prompt.includes('technical')) && 
      (lower.includes('complex') || lower.includes('breaking'))) {
    concerns.push('Technical complexity noted');
  }

  return JSON.stringify({
    vote,
    reasoning: `Proposal ${vote === 'APPROVE' ? 'aligns with' : 'needs review for'} DAO objectives.`,
    concerns,
  });
}

function generateQualityAssessment(prompt: string): string {
  const lower = prompt.toLowerCase();
  const hasField = (field: string, minLen: number) => 
    prompt.includes(`${field}:`) && (prompt.split(`${field}:`)[1]?.trim().length ?? 0) > minLen;
  
  const titleBonus = hasField('Title', 5) ? 15 : 0;
  const summaryBonus = hasField('Summary', 20) ? 15 : 0;
  const descBonus = hasField('Description', 50) ? 20 : 0;
  const keywordBonus = ['problem', 'solution', 'timeline', 'cost', 'benefit', 'risk']
    .filter(k => lower.includes(k)).length * 5;
  
  const clarity = Math.min(100, 50 + titleBonus + summaryBonus);
  const completeness = Math.min(100, 50 + descBonus + keywordBonus);

  return JSON.stringify({
    clarity, completeness,
    feasibility: 70, alignment: 75, impact: 70,
    riskAssessment: lower.includes('risk') ? 80 : 50,
    costBenefit: lower.includes('cost') && lower.includes('benefit') ? 85 : 60,
    feedback: [],
    blockers: completeness < 70 ? ['Add more implementation details'] : [],
    suggestions: clarity < 80 ? ['Improve title clarity'] : [],
  });
}

function generateResearchReport(prompt: string): string {
  const proposalId = prompt.match(/proposal[:\s]+([a-f0-9]+)/i)?.[1] ?? 'unknown';
  
  return JSON.stringify({
    proposalId,
    sections: [
      { title: 'Background', content: 'Addresses common DAO needs.', confidence: 85 },
      { title: 'Technical', content: 'Sound implementation approach.', confidence: 80 },
      { title: 'Economic', content: 'Positive ROI expected.', confidence: 75 },
    ],
    recommendation: 'proceed',
    riskLevel: 'medium',
    keyFindings: ['Aligns with objectives', 'Realistic timeline', 'Reasonable resources'],
    model: 'local-inference',
    completedAt: Date.now(),
  });
}

// Initialize
let initialized = false;

export async function initLocalServices(): Promise<void> {
  if (initialized) return;
  console.log('\n[Local Services] Initializing...');
  await initStorage();
  console.log('[Local Services] Storage: ready');
  console.log('[Local Services] Inference: ready (local mock)');
  console.log('[Local Services] Ready\n');
  initialized = true;
}

export function isInitialized(): boolean {
  return initialized;
}
