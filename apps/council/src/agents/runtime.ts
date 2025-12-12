/**
 * Council Agent Runtime Manager - ElizaOS runtimes for governance
 */

import { AgentRuntime, type Character, type UUID, type Plugin } from '@elizaos/core';
import { councilAgentTemplates, ceoAgent, type CouncilAgentTemplate } from './templates';
import { councilPlugin } from './council-plugin';
import { ceoPlugin } from './ceo-plugin';

export interface AgentVote {
  role: string;
  agentId: string;
  vote: 'APPROVE' | 'REJECT' | 'ABSTAIN';
  reasoning: string;
  confidence: number;
  timestamp: number;
}

export interface DeliberationRequest {
  proposalId: string;
  title: string;
  summary: string;
  description: string;
  proposalType: string;
  submitter: string;
}

export interface CEODecisionRequest {
  proposalId: string;
  councilVotes: AgentVote[];
  researchReport?: string;
}

export interface CEODecision {
  approved: boolean;
  reasoning: string;
  confidence: number;
  alignment: number;
  recommendations: string[];
}

export const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';

export async function checkOllama(): Promise<boolean> {
  try {
    return (await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

export async function ollamaGenerate(prompt: string, system: string): Promise<string> {
  const r = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt, system, stream: false, options: { temperature: 0.7, num_predict: 500 } }),
  });
  if (!r.ok) throw new Error(`Ollama error: ${r.status}`);
  return ((await r.json()) as { response: string }).response;
}

export class CouncilAgentRuntimeManager {
  private static instance: CouncilAgentRuntimeManager;
  private runtimes = new Map<string, AgentRuntime>();
  private initialized = false;
  private ollamaAvailable: boolean | null = null;

  private constructor() {}

  static getInstance(): CouncilAgentRuntimeManager {
    return CouncilAgentRuntimeManager.instance ??= new CouncilAgentRuntimeManager();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('[AgentRuntime] Initializing...');
    this.ollamaAvailable = await checkOllama();
    console.log(`[AgentRuntime] Ollama: ${this.ollamaAvailable ? 'available' : 'NOT AVAILABLE'}`);

    for (const template of councilAgentTemplates) {
      const runtime = await this.createRuntime(template);
      this.runtimes.set(template.id, runtime);
    }

    const ceoRuntime = await this.createRuntime(ceoAgent);
    this.runtimes.set('ceo', ceoRuntime);

    this.initialized = true;
    console.log(`[AgentRuntime] ${this.runtimes.size} agents ready`);
  }

  private async createRuntime(template: CouncilAgentTemplate): Promise<AgentRuntime> {
    const character: Character = { ...template.character };
    const plugins: Plugin[] = template.role === 'CEO' ? [ceoPlugin] : [councilPlugin];
    const runtime = new AgentRuntime({ character, agentId: template.id as UUID, plugins });
    for (const plugin of plugins) await runtime.registerPlugin(plugin);
    return runtime;
  }

  getRuntime(id: string): AgentRuntime | undefined {
    return this.runtimes.get(id);
  }

  async deliberate(agentId: string, request: DeliberationRequest): Promise<AgentVote> {
    const template = councilAgentTemplates.find(t => t.id === agentId);
    if (!template) throw new Error(`Agent ${agentId} not found`);

    if (this.ollamaAvailable === null) {
      this.ollamaAvailable = await checkOllama();
    }

    if (!this.ollamaAvailable) {
      throw new Error('LLM unavailable: Deliberation requires Ollama. Start with: ollama serve');
    }

    const prompt = `PROPOSAL FOR REVIEW:

Title: ${request.title}
Type: ${request.proposalType}
Submitter: ${request.submitter}

Description:
${request.description}

As the ${template.role} agent, evaluate this proposal. State your vote clearly: APPROVE, REJECT, or ABSTAIN.
Provide specific reasoning based on your expertise.`;

    const response = await ollamaGenerate(prompt, template.character.system ?? 'You are a DAO governance agent.');
    return this.parseResponse(template, response, request.proposalId);
  }

  async deliberateAll(request: DeliberationRequest): Promise<AgentVote[]> {
    const votes: AgentVote[] = [];
    for (const template of councilAgentTemplates) {
      const vote = await this.deliberate(template.id, request);
      votes.push(vote);
    }
    return votes;
  }

  async ceoDecision(request: CEODecisionRequest): Promise<CEODecision> {
    if (this.ollamaAvailable === null) {
      this.ollamaAvailable = await checkOllama();
    }

    if (!this.ollamaAvailable) {
      throw new Error('LLM unavailable: CEO decision requires Ollama. Start with: ollama serve');
    }

    const voteSummary = request.councilVotes
      .map(v => `- ${v.role}: ${v.vote} (${v.confidence}%)\n  ${v.reasoning}`)
      .join('\n\n');

    const prompt = `COUNCIL DELIBERATION COMPLETE

Proposal: ${request.proposalId}

VOTES:
${voteSummary}

${request.researchReport ? `RESEARCH:\n${request.researchReport}` : ''}

As CEO, make your final decision. Return JSON:
{"approved": true/false, "reasoning": "...", "confidence": 0-100, "alignment": 0-100, "recommendations": [...]}`;

    const response = await ollamaGenerate(prompt, ceoAgent.character.system ?? 'You are the AI CEO of a DAO.');

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as CEODecision;
      }
    } catch {
      // Parse failed, extract from text
    }

    const approved = response.toLowerCase().includes('approved') && !response.toLowerCase().startsWith('not approved');
    return {
      approved,
      reasoning: response.slice(0, 500),
      confidence: 70,
      alignment: 70,
      recommendations: approved ? ['Proceed'] : ['Address concerns'],
    };
  }

  private parseResponse(template: CouncilAgentTemplate, response: string, _proposalId: string): AgentVote {
    const lower = response.toLowerCase();
    let vote: 'APPROVE' | 'REJECT' | 'ABSTAIN' = 'ABSTAIN';
    
    if (lower.includes('approve') || lower.includes('in favor') || lower.includes('support')) {
      vote = 'APPROVE';
    } else if (lower.includes('reject') || lower.includes('against') || lower.includes('oppose') || lower.includes('concern')) {
      vote = 'REJECT';
    }

    let confidence = 70;
    const confMatch = response.match(/confidence[:\s]+(\d+)/i);
    if (confMatch) confidence = Math.min(100, parseInt(confMatch[1], 10));

    return {
      role: template.role,
      agentId: template.id,
      vote,
      reasoning: response.slice(0, 500).replace(/\n+/g, ' ').trim(),
      confidence,
      timestamp: Date.now(),
    };
  }

  async shutdown(): Promise<void> {
    this.runtimes.clear();
    this.initialized = false;
  }
}

export const councilAgentRuntime = CouncilAgentRuntimeManager.getInstance();
