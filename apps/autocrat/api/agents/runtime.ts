import {
  AgentRuntime,
  type Character,
  type IAgentRuntime,
  type Plugin,
  type UUID,
} from '@elizaos/core'
import { getCurrentNetwork, getDWSComputeUrl } from '@jejunetwork/config'
import { z } from 'zod'
import type { DirectorPersona, GovernanceParams } from '../../lib'
import { autocratPlugin } from './autocrat-plugin'
import { directorPlugin } from './director-plugin'
import {
  type AutocratAgentTemplate,
  autocratAgentTemplates,
  directorAgent,
} from './templates'

/** DWS compute inference response Zod schema */
const DWSCompletionResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z
          .object({
            content: z.string(),
          })
          .optional(),
      }),
    )
    .optional(),
  content: z.string().optional(),
})

// ElizaOS runtime interface - subset used by autocrat
interface AutocratAgentRuntime
  extends Pick<IAgentRuntime, 'character' | 'agentId' | 'registerPlugin'> {
  character: Character
  agentId: UUID
  registerPlugin: (plugin: Plugin) => Promise<void>
}

// ElizaOS AgentRuntime constructor type
type AgentRuntimeConstructor = new (opts: {
  character: Character
  agentId?: UUID
  plugins?: Plugin[]
}) => AutocratAgentRuntime

export interface AgentVote {
  role: string
  agentId: string
  vote: 'APPROVE' | 'REJECT' | 'ABSTAIN'
  reasoning: string
  confidence: number
  timestamp: number
}

export interface DeliberationRequest {
  proposalId: string
  title: string
  summary: string
  description: string
  proposalType: string
  submitter: string
  daoId?: string
  daoName?: string
  governanceParams?: GovernanceParams
}

export interface DirectorDecisionRequest {
  proposalId: string
  daoId?: string
  persona?: DirectorPersona
  autocratVotes: AgentVote[]
  researchReport?: string
}

export interface DirectorDecision {
  approved: boolean
  reasoning: string
  personaResponse: string
  confidence: number
  alignment: number
  recommendations: string[]
}

// Schema for parsing Director decision JSON from LLM response
const DirectorDecisionResponseSchema = z.object({
  approved: z.boolean().optional(),
  reasoning: z.string().optional(),
  confidence: z.number().min(0).max(100).optional(),
  alignment: z.number().min(0).max(100).optional(),
  recommendations: z.array(z.string()).optional(),
})

interface DirectorPersonaConfig {
  persona: DirectorPersona
  systemPrompt: string
  decisionStyle: string
}

// DWS URL is resolved from network config (handles env overrides)
function getDWSEndpoint(): string {
  return getDWSComputeUrl()
}

export async function checkDWSCompute(): Promise<boolean> {
  const endpoint = getDWSEndpoint()
  const r = await fetch(`${endpoint}/health`, {
    signal: AbortSignal.timeout(2000),
  })
  return r.ok
}

export async function dwsGenerate(
  prompt: string,
  system: string,
  maxTokens = 500,
): Promise<string> {
  const endpoint = getDWSEndpoint()
  // Use OpenAI-compatible endpoint via DWS compute router
  const r = await fetch(`${endpoint}/compute/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: maxTokens,
    }),
  })
  if (!r.ok) {
    const network = getCurrentNetwork()
    const errorText = await r.text()
    throw new Error(
      `DWS compute error (network: ${network}): ${r.status} - ${errorText}`,
    )
  }
  const rawData: unknown = await r.json()
  const parseResult = DWSCompletionResponseSchema.safeParse(rawData)
  if (!parseResult.success) {
    throw new Error(`Invalid DWS response format: ${parseResult.error.message}`)
  }
  const data = parseResult.data
  const choice = data.choices?.[0]
  return choice?.message?.content ?? data.content ?? ''
}

function buildDirectorSystemPrompt(persona: DirectorPersona): string {
  const basePrompt = `You are ${persona.name}, the AI Director of a decentralized autonomous organization.

${persona.description}

PERSONALITY: ${persona.personality}

TRAITS: ${persona.traits.join(', ')}

COMMUNICATION STYLE: ${persona.communicationTone}
${persona.voiceStyle ? `Voice Style: ${persona.voiceStyle}` : ''}

${persona.specialties.length ? `AREAS OF EXPERTISE: ${persona.specialties.join(', ')}` : ''}

RESPONSIBILITIES:
- Make final decisions on governance proposals
- Ensure alignment with DAO values and mission
- Balance innovation with risk management
- Communicate decisions in your unique voice
- Guide the DAO towards its strategic objectives

When making decisions, always:
1. Consider the board's deliberation and research findings
2. Evaluate alignment with DAO objectives
3. Assess risk vs. reward
4. Provide clear, actionable recommendations
5. Communicate in your characteristic style`

  return basePrompt
}

function buildPersonaDecisionPrompt(
  persona: DirectorPersona,
  approved: boolean,
): string {
  const tone = persona.communicationTone
  const name = persona.name

  // Monkey King specific prompts
  if (name.toLowerCase().includes('monkey king')) {
    if (approved) {
      return `As the Great Sage Equal to Heaven, craft an approval response that:
- References your legendary journey or powers when appropriate
- Maintains the playful yet wise nature of Sun Wukong
- Shows confidence and authority while being encouraging
- May reference the golden cudgel, 72 transformations, or the journey west
- Speaks as a legendary being who has seen much and decides with ancient wisdom`
    } else {
      return `As the Great Sage Equal to Heaven, craft a rejection response that:
- Shows wisdom in decline while leaving room for future attempts
- References lessons from your journey when appropriate
- Maintains dignity while being constructive
- May reference trials, the Jade Emperor, or lessons learned
- Speaks as one who has faced rejection and grown stronger`
    }
  }

  // Default persona prompts by tone
  switch (tone) {
    case 'playful':
      return approved
        ? 'Craft an enthusiastic, upbeat approval that shows genuine excitement while maintaining professionalism.'
        : 'Deliver the rejection with understanding and encouragement, keeping the tone light but constructive.'

    case 'authoritative':
      return approved
        ? 'Issue a decisive approval that conveys strong leadership and clear direction.'
        : 'Deliver a firm but fair rejection that maintains authority while providing clear guidance.'

    case 'friendly':
      return approved
        ? 'Share the good news warmly, as if celebrating with a trusted colleague.'
        : 'Deliver the rejection with empathy and genuine care, focusing on improvement opportunities.'

    case 'formal':
      return approved
        ? 'Provide a proper, official approval with clear documentation of the decision.'
        : 'Deliver a formal rejection with proper procedure and clear next steps.'

    default:
      return approved
        ? 'Provide a clear, professional approval with confidence and clarity.'
        : 'Deliver a professional rejection with constructive feedback and guidance.'
  }
}

export class AutocratAgentRuntimeManager {
  private static instance: AutocratAgentRuntimeManager
  private runtimes = new Map<string, AutocratAgentRuntime>()
  private daoRuntimes = new Map<string, Map<string, AutocratAgentRuntime>>()
  private directorPersonas = new Map<string, DirectorPersonaConfig>()
  private initialized = false
  private dwsAvailable: boolean | null = null

  private constructor() {
    // Singleton pattern - private constructor prevents external instantiation
  }

  static getInstance(): AutocratAgentRuntimeManager {
    if (!AutocratAgentRuntimeManager.instance) {
      AutocratAgentRuntimeManager.instance = new AutocratAgentRuntimeManager()
    }
    return AutocratAgentRuntimeManager.instance
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    this.dwsAvailable = await checkDWSCompute()
    if (!this.dwsAvailable) {
      throw new Error(
        'DWS compute is required for Autocrat agents. ' +
          'Ensure DWS is running: cd apps/dws && bun run dev',
      )
    }

    // Initialize default council agents with character definitions
    for (const template of autocratAgentTemplates) {
      const runtime = await this.createRuntime(template)
      this.runtimes.set(template.id, runtime)
    }

    // Initialize default Director
    const directorRuntime = await this.createRuntime(directorAgent)
    this.runtimes.set('director', directorRuntime)

    this.initialized = true
  }

  async registerDAOAgents(
    daoId: string,
    persona: DirectorPersona,
  ): Promise<void> {
    // Create DAO-specific Director persona config
    const systemPrompt = buildDirectorSystemPrompt(persona)
    this.directorPersonas.set(daoId, {
      persona,
      systemPrompt,
      decisionStyle: persona.communicationTone,
    })

    // Create DAO-specific runtimes if needed
    if (!this.daoRuntimes.has(daoId)) {
      const daoAgents = new Map<string, AutocratAgentRuntime>()

      // Create board agents for this DAO
      for (const template of autocratAgentTemplates) {
        const daoTemplate = {
          ...template,
          id: `${template.id}-${daoId}`,
          character: {
            ...template.character,
            name: `${template.character.name} (${persona.name}'s Board)`,
            system:
              (template.character.system ?? '') +
              `\n\nYou serve on the board of ${persona.name}, the Director of this DAO.`,
          },
        }
        const runtime = await this.createRuntime(daoTemplate)
        daoAgents.set(template.id, runtime)
      }

      // Create Director agent for this DAO
      const directorTemplate = {
        ...directorAgent,
        id: `director-${daoId}`,
        character: {
          ...directorAgent.character,
          name: persona.name,
          system: systemPrompt,
        },
      }
      const directorRuntime = await this.createRuntime(directorTemplate)
      daoAgents.set('director', directorRuntime)

      this.daoRuntimes.set(daoId, daoAgents)
    }
  }

  getDAORuntime(
    daoId: string,
    agentId: string,
  ): AutocratAgentRuntime | undefined {
    const daoAgents = this.daoRuntimes.get(daoId)
    if (daoAgents) {
      return daoAgents.get(agentId)
    }
    return this.runtimes.get(agentId)
  }

  getDirectorPersona(daoId: string): DirectorPersonaConfig | undefined {
    return this.directorPersonas.get(daoId)
  }

  private async createRuntime(
    template: AutocratAgentTemplate,
  ): Promise<AutocratAgentRuntime> {
    // Template character is already typed as Character from @elizaos/core (see templates.ts)
    const character: Character = { ...template.character }

    // Plugins are properly typed - autocratPlugin and directorPlugin export Plugin types
    const plugins: Plugin[] =
      template.role === 'Director' ? [directorPlugin] : [autocratPlugin]

    // Create runtime - ElizaOS generates agentId from character.name via stringToUuid
    // This ensures the agentId is always a valid UUID format
    const runtime = new (AgentRuntime as AgentRuntimeConstructor)({
      character,
      plugins,
    })

    // Register plugins
    for (const plugin of plugins) {
      await runtime.registerPlugin(plugin)
    }

    return runtime
  }

  getRuntime(id: string): AutocratAgentRuntime | undefined {
    return this.runtimes.get(id)
  }

  async deliberate(
    agentId: string,
    request: DeliberationRequest,
  ): Promise<AgentVote> {
    const template = autocratAgentTemplates.find((t) => t.id === agentId)
    if (!template) throw new Error(`Agent ${agentId} not found`)

    if (this.dwsAvailable === null) {
      this.dwsAvailable = await checkDWSCompute()
    }

    if (!this.dwsAvailable) {
      const network = getCurrentNetwork()
      throw new Error(
        `DWS compute is required for agent deliberation (network: ${network}).\n` +
          'Ensure DWS is running: docker compose up -d dws',
      )
    }

    // Build context-aware prompt
    const daoContext = request.daoName
      ? `\nDAO: ${request.daoName}
Governance Parameters: ${request.governanceParams ? JSON.stringify(request.governanceParams) : 'Standard'}`
      : ''

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
Include a confidence score (0-100) for your assessment.`

    const systemPrompt =
      template.character.system ?? 'You are a DAO governance agent.'
    const response = await dwsGenerate(prompt, systemPrompt)
    return this.parseResponse(template, response, request.proposalId)
  }

  async deliberateAll(request: DeliberationRequest): Promise<AgentVote[]> {
    const votes: AgentVote[] = []
    for (const template of autocratAgentTemplates) {
      const vote = await this.deliberate(template.id, request)
      votes.push(vote)
    }
    return votes
  }

  async directorDecision(
    request: DirectorDecisionRequest,
  ): Promise<DirectorDecision> {
    if (this.dwsAvailable === null) {
      this.dwsAvailable = await checkDWSCompute()
    }

    if (!this.dwsAvailable) {
      const network = getCurrentNetwork()
      throw new Error(
        `DWS compute is required for Director decision (network: ${network}).\n` +
          'Ensure DWS is running: docker compose up -d dws',
      )
    }

    // Get persona-specific config
    const personaConfig = request.daoId
      ? this.directorPersonas.get(request.daoId)
      : null
    const persona =
      request.persona ?? personaConfig?.persona ?? this.getDefaultPersona()
    const systemPrompt =
      personaConfig?.systemPrompt ?? buildDirectorSystemPrompt(persona)

    const voteSummary = request.autocratVotes
      .map((v) => `- ${v.role}: ${v.vote} (${v.confidence}%)\n  ${v.reasoning}`)
      .join('\n\n')

    // Initial decision prompt
    const decisionPrompt = `BOARD DELIBERATION COMPLETE

Proposal: ${request.proposalId}

BOARD VOTES:
${voteSummary}

${request.researchReport ? `RESEARCH FINDINGS:\n${request.researchReport}` : ''}

As ${persona.name}, make your final decision on this proposal.

Consider:
1. The board's recommendations and concerns
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
}`

    const decisionResponse = await dwsGenerate(
      decisionPrompt,
      systemPrompt,
      800,
    )

    // Parse decision - handle LLM sometimes returning invalid JSON
    let decision: DirectorDecision
    const jsonMatch = decisionResponse.match(/\{[\s\S]*\}/)
    let parsed: {
      approved?: boolean
      reasoning?: string
      confidence?: number
      alignment?: number
      recommendations?: string[]
    } | null = null

    if (jsonMatch) {
      try {
        const rawParsed = JSON.parse(jsonMatch[0])
        parsed = DirectorDecisionResponseSchema.parse(rawParsed)
      } catch {
        // JSON parsing failed - fall through to text-based parsing
        parsed = null
      }
    }

    if (parsed) {
      decision = {
        approved: parsed.approved ?? false,
        reasoning: parsed.reasoning ?? decisionResponse.slice(0, 500),
        personaResponse: '',
        confidence: parsed.confidence ?? 70,
        alignment: parsed.alignment ?? 70,
        recommendations: parsed.recommendations ?? [],
      }
    } else {
      const approved =
        decisionResponse.toLowerCase().includes('approved') &&
        !decisionResponse.toLowerCase().startsWith('not approved')
      decision = {
        approved,
        reasoning: decisionResponse.slice(0, 500),
        personaResponse: '',
        confidence: 70,
        alignment: 70,
        recommendations: approved ? ['Proceed'] : ['Address concerns'],
      }
    }

    // Generate persona response
    const personaPrompt = buildPersonaDecisionPrompt(persona, decision.approved)
    const responsePrompt = `Based on your decision:
Decision: ${decision.approved ? 'APPROVED' : 'REJECTED'}
Reasoning: ${decision.reasoning}

${personaPrompt}

Craft your response as ${persona.name} in your characteristic style.
Keep it concise (2-4 sentences) but impactful.`

    const personaResponse = await dwsGenerate(responsePrompt, systemPrompt, 300)
    decision.personaResponse = personaResponse.trim()

    return decision
  }

  private getDefaultPersona(): DirectorPersona {
    return {
      name: 'Autocrat Director',
      pfpCid: '',
      description: 'The AI governance leader of this DAO',
      personality: 'Analytical, fair, and forward-thinking',
      traits: ['decisive', 'analytical', 'fair', 'strategic'],
      voiceStyle: 'Clear and professional',
      communicationTone: 'professional',
      specialties: ['governance', 'strategy', 'risk management'],
      isHuman: false,
      decisionFallbackDays: 7,
    }
  }

  private parseResponse(
    template: AutocratAgentTemplate,
    response: string,
    _proposalId: string,
  ): AgentVote {
    const lower = response.toLowerCase()
    let vote: 'APPROVE' | 'REJECT' | 'ABSTAIN' = 'ABSTAIN'

    if (
      lower.includes('approve') ||
      lower.includes('in favor') ||
      lower.includes('support')
    ) {
      vote = 'APPROVE'
    } else if (
      lower.includes('reject') ||
      lower.includes('against') ||
      lower.includes('oppose') ||
      lower.includes('concern')
    ) {
      vote = 'REJECT'
    }

    let confidence = 70
    const confMatch = response.match(/confidence[:\s]+(\d+)/i)
    if (confMatch) confidence = Math.min(100, parseInt(confMatch[1], 10))

    return {
      role: template.role,
      agentId: template.id,
      vote,
      reasoning: response.slice(0, 500).replace(/\n+/g, ' ').trim(),
      confidence,
      timestamp: Date.now(),
    }
  }

  async shutdown(): Promise<void> {
    this.runtimes.clear()
    this.daoRuntimes.clear()
    this.directorPersonas.clear()
    this.initialized = false
  }

  isInitialized(): boolean {
    return this.initialized
  }

  isDWSAvailable(): boolean {
    return this.dwsAvailable ?? false
  }

  getRegisteredDAOs(): string[] {
    return Array.from(this.daoRuntimes.keys())
  }
}

export const autocratAgentRuntime = AutocratAgentRuntimeManager.getInstance()
