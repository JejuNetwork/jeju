/**
 * Council Agent Runtime Manager
 * 
 * Manages ElizaOS agent runtimes for council deliberation.
 * Supports Ollama (local) and cloud providers (Anthropic, OpenAI, Groq).
 */

import { AgentRuntime, type Character, type UUID, type Plugin } from '@elizaos/core';
import { councilAgentTemplates, ceoAgent, type CouncilAgentTemplate } from './templates';
import { councilPlugin } from './council-plugin';
import { ceoPlugin } from './ceo-plugin';

// Types
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

// Config
const INFERENCE_MODE = process.env.INFERENCE_MODE ?? 'auto';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
export const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';

function getModelSettings(): Record<string, string> {
  const settings: Record<string, string> = {};
  if (ANTHROPIC_API_KEY) {
    settings.ANTHROPIC_API_KEY = ANTHROPIC_API_KEY;
    settings.ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
  }
  if (OPENAI_API_KEY) settings.OPENAI_API_KEY = OPENAI_API_KEY;
  if (GROQ_API_KEY) {
    settings.GROQ_API_KEY = GROQ_API_KEY;
    settings.LARGE_GROQ_MODEL = 'llama-3.3-70b-versatile';
  }
  return settings;
}

export async function checkOllama(): Promise<boolean> {
  try {
    return (await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

export async function ollamaGenerate(prompt: string, systemPrompt: string): Promise<string> {
  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      system: systemPrompt,
      stream: false,
      options: { temperature: 0.7, num_predict: 500 }
    }),
  });
  if (!response.ok) throw new Error(`Ollama error: ${response.status}`);
  return ((await response.json()) as { response: string }).response;
}

// ============================================================================
// Agent Runtime Manager
// ============================================================================

/**
 * Manages ElizaOS agent runtimes for council governance
 */
export class CouncilAgentRuntimeManager {
  private static instance: CouncilAgentRuntimeManager;
  private runtimes: Map<string, AgentRuntime> = new Map();
  private initialized = false;

  private constructor() {}

  static getInstance(): CouncilAgentRuntimeManager {
    if (!CouncilAgentRuntimeManager.instance) {
      CouncilAgentRuntimeManager.instance = new CouncilAgentRuntimeManager();
    }
    return CouncilAgentRuntimeManager.instance;
  }

  /**
   * Initialize all council agent runtimes
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('[AgentRuntime] Initializing council agents...');
    const modelSettings = getModelSettings();

    // Create runtime for each council agent
    for (const template of councilAgentTemplates) {
      const runtime = await this.createRuntime(template, modelSettings);
      this.runtimes.set(template.id, runtime);
      console.log(`[AgentRuntime] ${template.name} initialized`);
    }

    // Create CEO runtime
    const ceoRuntime = await this.createRuntime(ceoAgent, modelSettings);
    this.runtimes.set('ceo', ceoRuntime);
    console.log('[AgentRuntime] CEO Agent initialized');

    this.initialized = true;
    console.log(`[AgentRuntime] All ${this.runtimes.size} agents ready`);
  }

  /**
   * Create an ElizaOS runtime for a council agent
   */
  private async createRuntime(
    template: CouncilAgentTemplate,
    modelSettings: Record<string, string>
  ): Promise<AgentRuntime> {
    const character: Character = {
      ...template.character,
      settings: {
        ...template.character.settings,
        ...modelSettings,
      },
    };

    // Use appropriate plugin based on agent role
    const plugins: Plugin[] = template.role === 'CEO' ? [ceoPlugin] : [councilPlugin];
    
    const runtime = new AgentRuntime({
      character,
      agentId: template.id as UUID,
      plugins,
    });

    // Register plugins
    for (const plugin of plugins) {
      await runtime.registerPlugin(plugin);
    }

    // Configure minimal logger
    if (!runtime.logger?.log) {
      const prefix = `[${template.name}]`;
      const noop = () => undefined;
      const customLogger = {
        log: (msg: string) => console.log(prefix, msg),
        info: (msg: string) => console.log(prefix, msg),
        warn: (msg: string) => console.warn(prefix, msg),
        error: (msg: string) => console.error(prefix, msg),
        debug: noop, success: noop, notice: noop, trace: noop, fatal: noop, progress: noop, clear: noop,
        level: 'info' as const,
        child: () => customLogger,
      };
      runtime.logger = customLogger as typeof runtime.logger;
    }

    return runtime;
  }

  /**
   * Get agent runtime by ID
   */
  getRuntime(agentId: string): AgentRuntime | undefined {
    return this.runtimes.get(agentId);
  }

  /**
   * Get all council (non-CEO) agent runtimes
   */
  getCouncilRuntimes(): AgentRuntime[] {
    return councilAgentTemplates
      .map(t => this.runtimes.get(t.id))
      .filter((r): r is AgentRuntime => r !== undefined);
  }

  /**
   * Get CEO runtime
   */
  getCEORuntime(): AgentRuntime | undefined {
    return this.runtimes.get('ceo');
  }

  /**
   * Have a council agent deliberate on a proposal
   */
  async deliberate(agentId: string, request: DeliberationRequest): Promise<AgentVote> {
    const runtime = this.getRuntime(agentId);
    const template = councilAgentTemplates.find(t => t.id === agentId);
    
    if (!runtime || !template) {
      throw new Error(`Agent ${agentId} not found`);
    }

    const prompt = this.buildDeliberationPrompt(template, request);
    
    // Use local inference if forced or no provider available
    if (INFERENCE_MODE === 'local') {
      return this.localDeliberation(template, request);
    }
    
    const hasProvider = await this.hasInferenceProvider();
    if (!hasProvider) {
      return this.localDeliberation(template, request);
    }

    // Use Ollama or ElizaOS runtime for AI inference
    const response = await this.generateAgentResponse(runtime, prompt, template.character.system ?? '');
    return this.parseDeliberationResponse(template, response, request.proposalId);
  }

  /**
   * Have all council agents deliberate on a proposal
   */
  async deliberateAll(request: DeliberationRequest): Promise<AgentVote[]> {
    const votes: AgentVote[] = [];
    
    for (const template of councilAgentTemplates) {
      const vote = await this.deliberate(template.id, request);
      votes.push(vote);
    }
    
    return votes;
  }

  /**
   * Have CEO make final decision based on council votes
   */
  async ceoDecision(request: CEODecisionRequest): Promise<CEODecision> {
    const ceoRuntime = this.getCEORuntime();
    
    if (!ceoRuntime) {
      throw new Error('CEO agent not initialized');
    }

    const prompt = this.buildCEOPrompt(request);
    
    // Use local inference if forced or no provider available
    if (INFERENCE_MODE === 'local') {
      return this.localCEODecision(request);
    }
    
    const hasProvider = await this.hasInferenceProvider();
    if (!hasProvider) {
      return this.localCEODecision(request);
    }

    const systemPrompt = ceoAgent.character.system ?? 'You are the AI CEO of a DAO. Make decisions that benefit the organization.';
    const response = await this.generateAgentResponse(ceoRuntime, prompt, systemPrompt);
    return this.parseCEOResponse(response);
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private ollamaAvailable: boolean | null = null;

  private async hasInferenceProvider(): Promise<boolean> {
    // Check cloud providers first
    if (ANTHROPIC_API_KEY || OPENAI_API_KEY || GROQ_API_KEY) {
      return true;
    }
    
    // Check Ollama (cache the result)
    if (this.ollamaAvailable === null) {
      this.ollamaAvailable = await checkOllama();
      if (this.ollamaAvailable) {
        console.log(`[AgentRuntime] Using Ollama (${OLLAMA_MODEL}) for inference`);
      }
    }
    
    return this.ollamaAvailable;
  }

  private buildDeliberationPrompt(template: CouncilAgentTemplate, request: DeliberationRequest): string {
    return `PROPOSAL FOR REVIEW:

Title: ${request.title}
Type: ${request.proposalType}

Description:
${request.description}

---

As the ${template.role} agent, evaluate this proposal and vote. State your vote clearly at the start of your response.

Your assessment:`;
  }

  private buildCEOPrompt(request: CEODecisionRequest): string {
    const voteSummary = request.councilVotes
      .map(v => `- ${v.role}: ${v.vote} (confidence: ${v.confidence}%)\n  Reasoning: ${v.reasoning}`)
      .join('\n\n');

    return `COUNCIL DELIBERATION COMPLETE

Proposal ID: ${request.proposalId}

COUNCIL VOTES:
${voteSummary}

${request.researchReport ? `\nRESEARCH REPORT:\n${request.researchReport}` : ''}

---

As CEO, synthesize the council's input and make your final decision.
Consider all perspectives and the DAO's long-term interests.

Respond in JSON format:
{
  "approved": true | false,
  "reasoning": "Your public decision explanation",
  "confidence": 0-100,
  "alignment": 0-100,
  "recommendations": ["Next step 1", "Next step 2"]
}`;
  }

  private async generateAgentResponse(runtime: AgentRuntime, prompt: string, systemPrompt: string): Promise<string> {
    const agentName = runtime.character.name;
    console.log(`[AgentRuntime] Generating response for ${agentName} (ollama: ${this.ollamaAvailable})`);
    
    // Check Ollama availability if not already checked
    if (this.ollamaAvailable === null) {
      this.ollamaAvailable = await checkOllama();
      if (this.ollamaAvailable) {
        console.log(`[AgentRuntime] Ollama available at ${OLLAMA_URL}`);
      }
    }
    
    // Try Ollama first (local, fast, no API key needed)
    if (this.ollamaAvailable) {
      try {
        console.log(`[AgentRuntime] Calling Ollama for ${agentName}...`);
        const response = await ollamaGenerate(prompt, systemPrompt);
        console.log(`[AgentRuntime] ${agentName} responded via Ollama (${response.length} chars)`);
        return response;
      } catch (error) {
        console.warn(`[AgentRuntime] Ollama failed for ${agentName}:`, error);
        this.ollamaAvailable = false; // Mark as unavailable
      }
    }
    
    // TODO: Add cloud provider fallbacks (Anthropic, OpenAI, Groq)
    // For now, return empty to trigger local heuristic fallback
    console.log(`[AgentRuntime] No LLM available for ${agentName}, using heuristic`);
    return '';
  }

  private parseDeliberationResponse(
    template: CouncilAgentTemplate,
    response: string,
    proposalId: string
  ): AgentVote {
    if (!response) {
      return this.localDeliberation(template, { proposalId } as DeliberationRequest);
    }

    // First try to parse as JSON
    try {
      const parsed = JSON.parse(response) as { vote: string; reasoning: string; confidence: number };
      return {
        role: template.role,
        agentId: template.id,
        vote: (parsed.vote as 'APPROVE' | 'REJECT' | 'ABSTAIN') || 'ABSTAIN',
        reasoning: parsed.reasoning || 'No reasoning provided',
        confidence: parsed.confidence || 50,
        timestamp: Date.now(),
      };
    } catch {
      // Parse natural language response
      const lowerResponse = response.toLowerCase();
      
      // Detect vote from text
      let vote: 'APPROVE' | 'REJECT' | 'ABSTAIN' = 'ABSTAIN';
      if (lowerResponse.includes('approve') || lowerResponse.includes('in favor') || lowerResponse.includes('support')) {
        vote = 'APPROVE';
      } else if (lowerResponse.includes('reject') || lowerResponse.includes('against') || lowerResponse.includes('oppose') || lowerResponse.includes('concern')) {
        vote = 'REJECT';
      }
      
      // Extract confidence if mentioned
      let confidence = 70;
      const confidenceMatch = response.match(/confidence[:\s]+(\d+)/i);
      if (confidenceMatch) {
        confidence = Math.min(100, parseInt(confidenceMatch[1], 10));
      }
      
      // Take first 500 chars as reasoning
      const reasoning = response.slice(0, 500).replace(/\n+/g, ' ').trim();
      
      return {
        role: template.role,
        agentId: template.id,
        vote,
        reasoning: reasoning || response.slice(0, 200),
        confidence,
        timestamp: Date.now(),
      };
    }
  }

  private parseCEOResponse(response: string): CEODecision {
    if (!response) {
      return {
        approved: false,
        reasoning: 'Unable to process decision - no response from inference',
        confidence: 0,
        alignment: 0,
        recommendations: ['Retry with valid inference provider'],
      };
    }

    try {
      return JSON.parse(response) as CEODecision;
    } catch {
      return {
        approved: false,
        reasoning: 'Unable to parse decision response',
        confidence: 0,
        alignment: 0,
        recommendations: ['Check response format'],
      };
    }
  }

  /**
   * Local heuristic-based deliberation when no inference provider available
   */
  private localDeliberation(template: CouncilAgentTemplate, request: DeliberationRequest): AgentVote {
    // Deterministic vote based on role and content
    const hasDescription = (request.description?.length ?? 0) > 100;
    const hasSummary = (request.summary?.length ?? 0) > 20;
    const hasTitle = (request.title?.length ?? 0) > 5;
    const quality = (hasDescription ? 40 : 0) + (hasSummary ? 30 : 0) + (hasTitle ? 30 : 0);

    let vote: 'APPROVE' | 'REJECT' | 'ABSTAIN' = 'ABSTAIN';
    let reasoning: string;
    let confidence: number;

    switch (template.role) {
      case 'TREASURY':
        vote = quality >= 60 ? 'APPROVE' : 'REJECT';
        reasoning = quality >= 60 
          ? 'Proposal has sufficient detail for financial assessment.'
          : 'Proposal lacks sufficient detail for budget evaluation.';
        confidence = quality;
        break;
      case 'CODE':
        vote = quality >= 70 ? 'APPROVE' : quality >= 40 ? 'ABSTAIN' : 'REJECT';
        reasoning = quality >= 70
          ? 'Technical requirements are adequately specified.'
          : 'Need more technical details for proper assessment.';
        confidence = Math.min(quality + 10, 100);
        break;
      case 'COMMUNITY':
        vote = quality >= 50 ? 'APPROVE' : 'ABSTAIN';
        reasoning = quality >= 50
          ? 'Proposal appears to benefit the community.'
          : 'Community impact unclear from proposal.';
        confidence = Math.max(quality - 10, 30);
        break;
      case 'SECURITY':
        vote = quality >= 80 ? 'APPROVE' : quality >= 50 ? 'ABSTAIN' : 'REJECT';
        reasoning = quality >= 80
          ? 'No obvious security concerns identified.'
          : 'Insufficient detail to assess security implications.';
        confidence = quality;
        break;
      case 'LEGAL':
        vote = quality >= 60 ? 'ABSTAIN' : 'ABSTAIN';
        reasoning = 'Legal review requires additional documentation.';
        confidence = 40;
        break;
      default:
        reasoning = 'Unable to assess.';
        confidence = 0;
    }

    return {
      role: template.role,
      agentId: template.id,
      vote,
      reasoning,
      confidence,
      timestamp: Date.now(),
    };
  }

  /**
   * Local heuristic-based CEO decision when no inference provider available
   */
  private localCEODecision(request: CEODecisionRequest): CEODecision {
    const votes = request.councilVotes;
    const approves = votes.filter(v => v.vote === 'APPROVE').length;
    const rejects = votes.filter(v => v.vote === 'REJECT').length;
    const total = votes.length;
    
    const approved = approves > rejects && approves >= total / 2;
    const avgConfidence = votes.reduce((sum, v) => sum + v.confidence, 0) / Math.max(total, 1);
    
    return {
      approved,
      reasoning: approved
        ? `Approved with ${approves}/${total} council votes in favor. Council consensus supports this proposal.`
        : `Rejected with ${rejects}/${total} council votes against. Council has significant concerns.`,
      confidence: Math.round(avgConfidence),
      alignment: approved ? 75 : 35,
      recommendations: approved
        ? ['Proceed with implementation', 'Monitor execution milestones']
        : ['Address council concerns', 'Revise and resubmit'],
    };
  }

  /**
   * Cleanup all runtimes
   */
  async shutdown(): Promise<void> {
    this.runtimes.clear();
    this.initialized = false;
    console.log('[AgentRuntime] All agents shutdown');
  }
}

// Export singleton accessor
export const councilAgentRuntime = CouncilAgentRuntimeManager.getInstance();
