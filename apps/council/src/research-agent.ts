/**
 * Research Agent - Deep analysis for DAO proposals
 */

import { keccak256, toUtf8Bytes } from 'ethers';
import { checkOllama, ollamaGenerate, OLLAMA_MODEL } from './local-services';

export interface ResearchRequest {
  proposalId: string;
  title: string;
  description: string;
  proposalType?: string;
  references?: string[];
  depth?: 'quick' | 'standard' | 'deep';
}

export interface ResearchSection {
  title: string;
  content: string;
  confidence: number;
  sources?: string[];
}

export interface ResearchReport {
  proposalId: string;
  requestHash: string;
  model: string;
  sections: ResearchSection[];
  recommendation: 'proceed' | 'reject' | 'modify';
  confidenceLevel: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  summary: string;
  keyFindings: string[];
  concerns: string[];
  alternatives: string[];
  startedAt: number;
  completedAt: number;
  executionTime: number;
}

export interface QuickScreenResult {
  proposalId: string;
  passesScreen: boolean;
  redFlags: string[];
  score: number;
  recommendation: string;
}

export interface FactCheckResult {
  claim: string;
  verified: boolean;
  confidence: number;
  explanation: string;
  sources?: string[];
}

// Bounded LRU cache - evicts oldest when full
const CACHE_MAX = 1000;
const cache = new Map<string, ResearchReport>();
const evictOldest = () => { if (cache.size >= CACHE_MAX) { const first = cache.keys().next().value; if (first) cache.delete(first); } };

const parseJson = <T>(response: string): T | null => {
  const match = response.replace(/```json\s*/gi, '').replace(/```\s*/g, '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
};

export class ResearchAgent {
  async conductResearch(request: ResearchRequest): Promise<ResearchReport> {
    const requestHash = keccak256(toUtf8Bytes(JSON.stringify(request)));
    if (cache.has(requestHash)) return cache.get(requestHash)!;

    const startedAt = Date.now();
    const ollamaUp = await checkOllama();
    
    if (!ollamaUp) {
      console.warn('[ResearchAgent] Ollama unavailable - using keyword-based heuristics for research');
    }
    
    const report = ollamaUp
      ? await this.generateAIReport(request, requestHash, startedAt, request.depth ?? 'standard')
      : this.generateHeuristicReport(request, requestHash, startedAt);

    evictOldest();
    cache.set(requestHash, report);
    return report;
  }

  private async generateAIReport(request: ResearchRequest, requestHash: string, startedAt: number, depth: string): Promise<ResearchReport> {
    const prompt = `Conduct ${depth} research on this DAO proposal:

ID: ${request.proposalId}
Title: ${request.title}
Type: ${request.proposalType ?? 'GENERAL'}
Description: ${request.description}
${request.references?.length ? `References: ${request.references.join(', ')}` : ''}

Return JSON:
{"summary":"...","recommendation":"proceed|reject|modify","confidenceLevel":0-100,"riskLevel":"low|medium|high|critical","keyFindings":[],"concerns":[],"alternatives":[],"sections":[{"title":"...","content":"...","confidence":0-100}]}`;

    const response = await ollamaGenerate(prompt, 'DAO research analyst. Thorough, objective. Return only valid JSON.');

    type ParsedReport = { summary: string; recommendation: string; confidenceLevel: number; riskLevel: string; keyFindings: string[]; concerns: string[]; alternatives: string[]; sections: ResearchSection[] };
    const parsed = parseJson<ParsedReport>(response);

    if (!parsed) {
      console.warn('[ResearchAgent] AI response parsing failed - falling back to heuristics');
      console.warn('[ResearchAgent] Raw response:', response.slice(0, 200));
      return this.generateHeuristicReport(request, requestHash, startedAt);
    }

    const completedAt = Date.now();
    const rec = ['proceed', 'reject', 'modify'].includes(parsed.recommendation) ? parsed.recommendation : 'modify';
    const risk = ['low', 'medium', 'high', 'critical'].includes(parsed.riskLevel) ? parsed.riskLevel : 'medium';

    return {
      proposalId: request.proposalId, requestHash, model: OLLAMA_MODEL,
      sections: parsed.sections ?? [],
      recommendation: rec as ResearchReport['recommendation'],
      confidenceLevel: typeof parsed.confidenceLevel === 'number' ? parsed.confidenceLevel : 60,
      riskLevel: risk as ResearchReport['riskLevel'],
      summary: parsed.summary ?? 'Analysis complete.',
      keyFindings: parsed.keyFindings ?? [], concerns: parsed.concerns ?? [], alternatives: parsed.alternatives ?? [],
      startedAt, completedAt, executionTime: completedAt - startedAt,
    };
  }

  private generateHeuristicReport(request: ResearchRequest, requestHash: string, startedAt: number): ResearchReport {
    const desc = request.description.toLowerCase();
    const sections: ResearchSection[] = [];
    const concerns: string[] = [];
    const findings: string[] = [];
    let risk = 30, feas = 50;

    const checks: Array<{ kw: string[]; sec: string; rd: number; fd: number; finding: string | null; concern: string }> = [
      { kw: ['security', 'audit'], sec: 'Security', rd: -10, fd: 10, finding: null, concern: 'No security considerations' },
      { kw: ['timeline', 'milestone'], sec: 'Timeline', rd: 0, fd: 15, finding: 'Timeline provided', concern: 'No timeline specified' },
      { kw: ['budget', 'cost'], sec: 'Budget', rd: -10, fd: 0, finding: 'Budget provided', concern: 'No budget breakdown' },
      { kw: ['risk'], sec: 'Risk', rd: -10, fd: 0, finding: null, concern: 'Risk assessment missing' },
    ];

    for (const { kw, sec, rd, fd, finding, concern } of checks) {
      if (kw.some(k => desc.includes(k))) {
        sections.push({ title: sec, content: `Addresses ${sec.toLowerCase()}.`, confidence: 60 });
        risk += rd; feas += fd;
        if (finding) findings.push(finding);
      } else {
        concerns.push(concern);
        risk += Math.abs(rd);
      }
    }

    sections.push({ title: 'Technical Feasibility', content: desc.length > 500 ? 'Detailed.' : 'Limited.', confidence: feas });
    const completedAt = Date.now();

    return {
      proposalId: request.proposalId, requestHash, model: 'heuristic', sections,
      recommendation: concerns.length > 2 ? 'modify' : 'proceed',
      confidenceLevel: Math.round((100 - risk + feas) / 2),
      riskLevel: risk > 60 ? 'high' : risk > 40 ? 'medium' : 'low',
      summary: `Heuristic: ${concerns.length} concerns, ${findings.length} findings.`,
      keyFindings: findings, concerns,
      alternatives: concerns.length > 2 ? ['Address concerns first'] : [],
      startedAt, completedAt, executionTime: completedAt - startedAt,
    };
  }

  async quickScreen(request: ResearchRequest): Promise<QuickScreenResult> {
    const flags: string[] = [];
    let score = 100;
    const desc = request.description.toLowerCase(), title = request.title.toLowerCase();

    if (request.description.length < 100) { flags.push('Description too short'); score -= 30; }
    if (title.length < 10) { flags.push('Title too vague'); score -= 15; }

    for (const spam of ['guaranteed', 'moon', '100x', 'free money', 'no risk']) {
      if (desc.includes(spam) || title.includes(spam)) { flags.push(`Spam: "${spam}"`); score -= 25; }
    }

    if (/\b1000%\b|\binstant\b|\bguaranteed returns\b/.test(desc)) { flags.push('Unrealistic claims'); score -= 20; }
    if (!/problem|issue|challenge/.test(desc)) { flags.push('No problem statement'); score -= 10; }
    if (!/solution|propose|implement/.test(desc)) { flags.push('No clear solution'); score -= 10; }

    score = Math.max(0, score);
    const pass = score >= 50 && flags.length < 3;
    return { proposalId: request.proposalId, passesScreen: pass, redFlags: flags, score, recommendation: pass ? 'Proceed' : 'Revise' };
  }

  async factCheck(claim: string, context: string): Promise<FactCheckResult> {
    if (!await checkOllama()) {
      console.warn('[ResearchAgent] Ollama unavailable - fact-check returning unverified');
      return { claim, verified: false, confidence: 0, explanation: 'Fact-checking requires LLM. Ollama unavailable.' };
    }

    const prompt = `Fact-check this claim:

Claim: ${claim}
Context: ${context}

Return JSON: {"verified":true/false,"confidence":0-100,"explanation":"...","sources":["..."]}`;

    const response = await ollamaGenerate(prompt, 'Fact-checker. Be objective and cite reasoning.');
    const parsed = parseJson<Omit<FactCheckResult, 'claim'>>(response);

    return parsed
      ? { claim, verified: parsed.verified, confidence: parsed.confidence, explanation: parsed.explanation, sources: parsed.sources }
      : { claim, verified: false, confidence: 30, explanation: response.slice(0, 500) };
  }
}

let instance: ResearchAgent | null = null;

export function getResearchAgent(): ResearchAgent {
  return instance ??= new ResearchAgent();
}

export async function generateResearchReport(request: ResearchRequest): Promise<ResearchReport> {
  return getResearchAgent().conductResearch(request);
}

export async function quickScreenProposal(request: ResearchRequest): Promise<QuickScreenResult> {
  return getResearchAgent().quickScreen(request);
}
