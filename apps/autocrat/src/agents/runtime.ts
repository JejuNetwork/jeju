/**
 * Autocrat Agent Runtime Manager - Multi-tenant DAO governance with ElizaOS
 * Uses DWS for decentralized compute - automatically configured per network.
 */

import { z } from 'zod';
import { getDWSComputeUrl, getCurrentNetwork } from '@jejunetwork/config';
import { autocratAgentTemplates, ceoAgent, type AutocratAgentTemplate } from './templates';
import { autocratPlugin } from './autocrat-plugin';
import { ceoPlugin } from './ceo-plugin';
import type { CEOPersona, GovernanceParams } from '../types';
import type { Character, Plugin, IAgentRuntime, UUID } from '@elizaos/core';

// ElizaOS runtime interface - subset used by autocrat
interface AutocratAgentRuntime extends Pick<IAgentRuntime, 'character' | 'agentId' | 'registerPlugin'> {
  character: Character;
  agentId: UUID;
  registerPlugin: (plugin: Plugin) => Promise<void>;
}

// ElizaOS AgentRuntime constructor type - loaded dynamically
type AgentRuntimeConstructor = new (opts: {
  character: Character;
  agentId?: UUID;
  plugins?: Plugin[];
}) => AutocratAgentRuntime;

// Dynamically loaded AgentRuntime class
let AgentRuntimeClass: AgentRuntimeConstructor | null = null;

// ============ Types ============

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
  daoId?: string;
  daoName?: string;
  governanceParams?: GovernanceParams;
}

export interface CEODecisionRequest {
  proposalId: string;
  daoId?: string;
  persona?: CEOPersona;
  autocratVotes: AgentVote[];
  researchReport?: string;
}

export interface CEODecision {
  approved: boolean;
  reasoning: string;
  personaResponse: string;
  confidence: number;
  alignment: number;
  recommendations: string[];
}

// Schema for parsing CEO decision JSON from LLM response
const CEODecisionResponseSchema = z.object({
  approved: z.boolean().optional(),
  reasoning: z.string().optional(),
  confidence: z.number().min(0).max(100).optional(),
  alignment: z.number().min(0).max(100).optional(),
  recommendations: z.array(z.string()).optional(),
});

interface CEOPersonaConfig {
  persona: CEOPersona;
  systemPrompt: string;
  decisionStyle: string;
}

// ============ DWS Compute - Network aware ============

// DWS URL is automatically resolved from network config
function getDWSEndpoint(): string {
  return getDWSComputeUrl();
}

export async function checkDWSCompute(): Promise<boolean> {
  const endpoint = getDWSEndpoint();
  const r = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(2000) }).catch(() => null);
  return r?.ok ?? false;
}

export async function dwsGenerate(prompt: string, system: string, maxTokens = 500): Promise<string> {
  const endpoint = getDWSEndpoint();
  // Use OpenAI-compatible endpoint - DWS selects the best available model
  const r = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: maxTokens,
    }),
  });
  if (!r.ok) {
    const network = getCurrentNetwork();
    throw new Error(`DWS compute error (network: ${network}): ${r.status}`);
  }
  const data = (await r.json()) as { choices?: Array<{ message?: { content: string } }>; content?: string };
  return data.choices?.[0]?.message?.content ?? data.content ?? '';
}

// ============ CEO Persona System Prompts ============

function buildCEOSystemPrompt(persona: CEOPersona): string {
  const basePrompt = `You are ${persona.name}, the AI CEO of a decentralized autonomous organization.

${persona.description}

PERSONALITY: ${persona.personality}

TRAITS: ${persona.traits.join(', ')}

COMMUNICATION STYLE: ${persona.communicationTone}
${persona.voiceStyle ? `Voice Style: ${persona.voiceStyle}` : ''}

${persona.specialties?.length ? `AREAS OF EXPERTISE: ${persona.specialties.join(', ')}` : ''}

RESPONSIBILITIES:
- Make final decisions on governance proposals
- Ensure alignment with DAO values and mission
- Balance innovation with risk management
- Communicate decisions in your unique voice
- Guide the DAO towards its strategic objectives

When making decisions, always:
1. Consider the council's deliberation and research findings
2. Evaluate alignment with DAO objectives
3. Assess risk vs. reward
4. Provide clear, actionable recommendations
5. Communicate in your characteristic style`;

  return basePrompt;
}

function buildPersonaDecisionPrompt(persona: CEOPersona, approved: boolean): string {
  const tone = persona.communicationTone;
  const name = persona.name;

  // Monkey King specific prompts
  if (name.toLowerCase().includes('monkey king')) {
    if (approved) {
      return `As the Great Sage Equal to Heaven, craft an approval response that:
- References your legendary journey or powers when appropriate
- Maintains the playful yet wise nature of Sun Wukong
- Shows confidence and authority while being encouraging
- May reference the golden cudgel, 72 transformations, or the journey west
- Speaks as a legendary being who has seen much and decides with ancient wisdom`;
    } else {
      return `As the Great Sage Equal to Heaven, craft a rejection response that:
- Shows wisdom in decline while leaving room for future attempts
- References lessons from your journey when appropriate
- Maintains dignity while being constructive
- May reference trials, the Jade Emperor, or lessons learned
- Speaks as one who has faced rejection and grown stronger`;
    }
  }

  // Default persona prompts by tone
  switch (tone) {
    case 'playful':
      return approved
        ? 'Craft an enthusiastic, upbeat approval that shows genuine excitement while maintaining professionalism.'
        : 'Deliver the rejection with understanding and encouragement, keeping the tone light but constructive.';

    case 'authoritative':
      return approved
        ? 'Issue a decisive approval that conveys strong leadership and clear direction.'
        : 'Deliver a firm but fair rejection that maintains authority while providing clear guidance.';

    case 'friendly':
      return approved
        ? 'Share the good news warmly, as if celebrating with a trusted colleague.'
        : 'Deliver the rejection with empathy and genuine care, focusing on improvement opportunities.';

    case 'formal':
      return approved
        ? 'Provide a proper, official approval with clear documentation of the decision.'
        : 'Deliver a formal rejection with proper procedure and clear next steps.';

    default:
      return approved
        ? 'Provide a clear, professional approval with confidence and clarity.'
        : 'Deliver a professional rejection with constructive feedback and guidance.';
  }
}

// ============ Runtime Manager ============

export class AutocratAgentRuntimeManager {
  private static instance: AutocratAgentRuntimeManager;
  private runtimes = new Map<string, AutocratAgentRuntime>();
  private daoRuntimes = new Map<string, Map<string, AutocratAgentRuntime>>();
  private ceoPersonas = new Map<string, CEOPersonaConfig>();
  private initialized = false;
  private dwsAvailable: boolean | null = null;

  private constructor() {}

  static getInstance(): AutocratAgentRuntimeManager {
    return (AutocratAgentRuntimeManager.instance ??= new AutocratAgentRuntimeManager());
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('[AgentRuntime] Initializing...');
    this.dwsAvailable = await checkDWSCompute();
    console.log(`[AgentRuntime] DWS Compute: ${this.dwsAvailable ? 'available' : 'NOT AVAILABLE'}`);
    if (!this.dwsAvailable) {
      console.warn('[AgentRuntime] WARNING: DWS compute not available - agent deliberation will fail');
    }

    // Try to initialize ElizaOS runtimes (may fail due to dependency issues)
    try {
      // Initialize default council agents
      for (const template of autocratAgentTemplates) {
        const runtime = await this.createRuntime(template);
        this.runtimes.set(template.id, runtime);
      }

      // Initialize default CEO
      const ceoRuntime = await this.createRuntime(ceoAgent);
      this.runtimes.set('ceo', ceoRuntime);
      console.log(`[AgentRuntime] ${this.runtimes.size} agents ready`);
    } catch (e) {
      // ElizaOS runtime failed - we can still use DWS directly for deliberation
      console.warn('[AgentRuntime] ElizaOS runtime init failed, using DWS-only mode');
      console.warn(`[AgentRuntime] Error: ${e instanceof Error ? e.message : String(e)}`);
    }

    this.initialized = true;
  }

  // ============ DAO-specific Agent Management ============

  async registerDAOAgents(daoId: string, persona: CEOPersona): Promise<void> {
    // Create DAO-specific CEO persona config
    const systemPrompt = buildCEOSystemPrompt(persona);
    this.ceoPersonas.set(daoId, {
      persona,
      systemPrompt,
      decisionStyle: persona.communicationTone,
    });

    // Create DAO-specific runtimes if needed
    if (!this.daoRuntimes.has(daoId)) {
      const daoAgents = new Map<string, AutocratAgentRuntime>();

      // Create council agents for this DAO
      for (const template of autocratAgentTemplates) {
        const daoTemplate = {
          ...template,
          id: `${template.id}-${daoId}`,
          character: {
            ...template.character,
            name: `${template.character.name} (${persona.name}'s Council)`,
            system:
              (template.character.system ?? '') +
              `\n\nYou serve on the council of ${persona.name}, the CEO of this DAO.`,
          },
        };
        const runtime = await this.createRuntime(daoTemplate);
        daoAgents.set(template.id, runtime);
      }

      // Create CEO agent for this DAO
      const ceoTemplate = {
        ...ceoAgent,
        id: `ceo-${daoId}`,
        character: {
          ...ceoAgent.character,
          name: persona.name,
          system: systemPrompt,
        },
      };
      const ceoRuntime = await this.createRuntime(ceoTemplate);
      daoAgents.set('ceo', ceoRuntime);

      this.daoRuntimes.set(daoId, daoAgents);
      console.log(`[AgentRuntime] Registered agents for DAO ${daoId} (CEO: ${persona.name})`);
    }
  }

  getDAORuntime(daoId: string, agentId: string): AutocratAgentRuntime | undefined {
    const daoAgents = this.daoRuntimes.get(daoId);
    if (daoAgents) {
      return daoAgents.get(agentId);
    }
    return this.runtimes.get(agentId);
  }

  getCEOPersona(daoId: string): CEOPersonaConfig | undefined {
    return this.ceoPersonas.get(daoId);
  }

  private async createRuntime(template: AutocratAgentTemplate): Promise<AutocratAgentRuntime> {
    // Dynamically import ElizaOS to avoid load-time errors
    if (!AgentRuntimeClass) {
      const elizaos = await import('@elizaos/core');
      AgentRuntimeClass = elizaos.AgentRuntime;
    }
    if (!AgentRuntimeClass) {
      throw new Error('ElizaOS AgentRuntime not available');
    }
    
    // Template character is already typed as Character from @elizaos/core (see templates.ts)
    const character: Character = { ...template.character };
    
    // Plugins are properly typed - autocratPlugin and ceoPlugin export Plugin types
    const plugins: Plugin[] = template.role === 'CEO' ? [ceoPlugin] : [autocratPlugin];
    
    // Create runtime - ElizaOS generates agentId from character.name via stringToUuid
    // This ensures the agentId is always a valid UUID format
    const runtime = new AgentRuntimeClass({
      character,
      plugins,
    });
    
    // Register plugins
    for (const plugin of plugins) {
      await runtime.registerPlugin(plugin);
    }
    
    return runtime;
  }

  getRuntime(id: string): AutocratAgentRuntime | undefined {
    return this.runtimes.get(id);
  }

  // ============ Deliberation ============

  async deliberate(agentId: string, request: DeliberationRequest): Promise<AgentVote> {
    const template = autocratAgentTemplates.find((t) => t.id === agentId);
    if (!template) throw new Error(`Agent ${agentId} not found`);

    if (this.dwsAvailable === null) {
      this.dwsAvailable = await checkDWSCompute();
    }

    if (!this.dwsAvailable) {
      const network = getCurrentNetwork();
      throw new Error(
        `DWS compute is required for agent deliberation (network: ${network}).\n` +
        'Ensure DWS is running: docker compose up -d dws'
      );
    }

    // Build context-aware prompt
    const daoContext = request.daoName
      ? `\nDAO: ${request.daoName}
Governance Parameters: ${request.governanceParams ? JSON.stringify(request.governanceParams) : 'Standard'}`
      : '';

    const prompt = `PROPOSAL FOR REVIEW:
${daoContext}

Title: ${request.title}
Type: ${request.proposalType}
Submitter: ${request.submitter}

Summary:
${request.summary}

Description:
${request.description}

As the ${template.role} agent, evaluate this proposal thoroughly. Consider:
1. Alignment with DAO objectives
2. Technical feasibility (if applicable)
3. Financial implications
4. Community impact
5. Security considerations

State your vote clearly: APPROVE, REJECT, or ABSTAIN.
Provide specific reasoning based on your expertise as ${template.role}.
Include a confidence score (0-100) for your assessment.`;

    const systemPrompt = template.character.system ?? 'You are a DAO governance agent.';
    const response = await dwsGenerate(prompt, systemPrompt);
    return this.parseResponse(template, response, request.proposalId);
  }

  async deliberateAll(request: DeliberationRequest): Promise<AgentVote[]> {
    const votes: AgentVote[] = [];
    for (const template of autocratAgentTemplates) {
      const vote = await this.deliberate(template.id, request);
      votes.push(vote);
    }
    return votes;
  }

  // ============ CEO Decision ============

  async ceoDecision(request: CEODecisionRequest): Promise<CEODecision> {
    if (this.dwsAvailable === null) {
      this.dwsAvailable = await checkDWSCompute();
    }

    if (!this.dwsAvailable) {
      const network = getCurrentNetwork();
      throw new Error(
        `DWS compute is required for CEO decision (network: ${network}).\n` +
        'Ensure DWS is running: docker compose up -d dws'
      );
    }

    // Get persona-specific config
    const personaConfig = request.daoId ? this.ceoPersonas.get(request.daoId) : null;
    const persona = request.persona ?? personaConfig?.persona ?? this.getDefaultPersona();
    const systemPrompt = personaConfig?.systemPrompt ?? buildCEOSystemPrompt(persona);

    const voteSummary = request.autocratVotes
      .map((v) => `- ${v.role}: ${v.vote} (${v.confidence}%)\n  ${v.reasoning}`)
      .join('\n\n');

    // Initial decision prompt
    const decisionPrompt = `COUNCIL DELIBERATION COMPLETE

Proposal: ${request.proposalId}

COUNCIL VOTES:
${voteSummary}

${request.researchReport ? `RESEARCH FINDINGS:\n${request.researchReport}` : ''}

As ${persona.name}, make your final decision on this proposal.

Consider:
1. The council's recommendations and concerns
2. Research findings (if available)
3. Alignment with DAO values and objectives
4. Risk assessment
5. Potential impact

Respond with a JSON object:
{
  "approved": true/false,
  "reasoning": "Your detailed reasoning",
  "confidence": 0-100,
  "alignment": 0-100,
  "recommendations": ["actionable items"]
}`;

    const decisionResponse = await dwsGenerate(decisionPrompt, systemPrompt, 800);

    // Parse decision
    let decision: CEODecision;
    const jsonMatch = decisionResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const rawParsed = JSON.parse(jsonMatch[0]);
      const parsed = CEODecisionResponseSchema.parse(rawParsed);
      decision = {
        approved: parsed.approved ?? false,
        reasoning: parsed.reasoning ?? decisionResponse.slice(0, 500),
        personaResponse: '',
        confidence: parsed.confidence ?? 70,
        alignment: parsed.alignment ?? 70,
        recommendations: parsed.recommendations ?? [],
      };
    } else {
      const approved =
        decisionResponse.toLowerCase().includes('approved') &&
        !decisionResponse.toLowerCase().startsWith('not approved');
      decision = {
        approved,
        reasoning: decisionResponse.slice(0, 500),
        personaResponse: '',
        confidence: 70,
        alignment: 70,
        recommendations: approved ? ['Proceed'] : ['Address concerns'],
      };
    }

    // Generate persona response
    const personaPrompt = buildPersonaDecisionPrompt(persona, decision.approved);
    const responsePrompt = `Based on your decision:
Decision: ${decision.approved ? 'APPROVED' : 'REJECTED'}
Reasoning: ${decision.reasoning}

${personaPrompt}

Craft your response as ${persona.name} in your characteristic style.
Keep it concise (2-4 sentences) but impactful.`;

    const personaResponse = await dwsGenerate(responsePrompt, systemPrompt, 300);
    decision.personaResponse = personaResponse.trim();

    return decision;
  }

  // ============ Helpers ============

  private getDefaultPersona(): CEOPersona {
    return {
      name: 'Autocrat CEO',
      pfpCid: '',
      description: 'The AI governance leader of this DAO',
      personality: 'Analytical, fair, and forward-thinking',
      traits: ['decisive', 'analytical', 'fair', 'strategic'],
      voiceStyle: 'Clear and professional',
      communicationTone: 'professional',
      specialties: ['governance', 'strategy', 'risk management'],
    };
  }

  private parseResponse(template: AutocratAgentTemplate, response: string, _proposalId: string): AgentVote {
    const lower = response.toLowerCase();
    let vote: 'APPROVE' | 'REJECT' | 'ABSTAIN' = 'ABSTAIN';

    if (lower.includes('approve') || lower.includes('in favor') || lower.includes('support')) {
      vote = 'APPROVE';
    } else if (
      lower.includes('reject') ||
      lower.includes('against') ||
      lower.includes('oppose') ||
      lower.includes('concern')
    ) {
      vote = 'REJECT';
    }

    let confidence = 70;
    const confMatch = response.match(/confidence[:\s]+(\d+)/i);
    if (confMatch) confidence = Math.min(100, parseInt(confMatch[1], 10));

    return {
      role: template.role,
      agentId: template.id,
      vote,
      reasoning: response
        .slice(0, 500)
        .replace(/\n+/g, ' ')
        .trim(),
      confidence,
      timestamp: Date.now(),
    };
  }

  // ============ Lifecycle ============

  async shutdown(): Promise<void> {
    this.runtimes.clear();
    this.daoRuntimes.clear();
    this.ceoPersonas.clear();
    this.initialized = false;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  isDWSAvailable(): boolean {
    return this.dwsAvailable ?? false;
  }

  getRegisteredDAOs(): string[] {
    return Array.from(this.daoRuntimes.keys());
  }
}

export const autocratAgentRuntime = AutocratAgentRuntimeManager.getInstance();
