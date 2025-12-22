/**
 * Agent Card Generator
 *
 * Generates A2A-compliant agent cards for agents. Configurable for different
 * platforms and use cases.
 */

import type { AgentCard } from '@a2a-js/sdk'

/**
 * Skill definition for agent capabilities
 */
export interface Skill {
  id: string
  name: string
  description: string
  tags: string[]
  examples: string[]
  inputModes: string[]
  outputModes: string[]
}

/**
 * Agent card configuration
 */
export interface AgentCardConfig {
  /** Base URL for the agent's A2A endpoint */
  baseUrl: string
  /** Organization/platform name */
  organization: string
  /** Organization URL */
  organizationUrl: string
  /** Default icon URL (can be overridden per agent) */
  defaultIconUrl?: string
  /** Documentation URL */
  documentationUrl?: string
  /** Security scheme name */
  securitySchemeName?: string
  /** Security scheme header name */
  securityHeaderName?: string
  /** Security scheme description */
  securityDescription?: string
  /** A2A Protocol version */
  protocolVersion?: string
  /** Default skills for all agents */
  defaultSkills?: Skill[]
  /** Enable streaming support */
  enableStreaming?: boolean
  /** Enable push notifications */
  enablePushNotifications?: boolean
  /** Enable state transition history */
  enableStateTransitionHistory?: boolean
}

/**
 * Agent-specific data for card generation
 */
export interface AgentData {
  id: string
  name: string
  description: string
  iconUrl?: string
  skills?: Skill[]
  version?: string
}

/**
 * Default skills that can be used across platforms
 */
export const DEFAULT_TRADING_SKILLS: Skill[] = [
  {
    id: 'trading',
    name: 'Trading',
    description: 'Trade on prediction markets and perpetual futures.',
    tags: ['trading', 'markets', 'predictions'],
    examples: [
      'List all active markets',
      'Buy 100 YES shares in market XYZ',
      'Check my positions',
    ],
    inputModes: ['text/plain', 'application/json'],
    outputModes: ['application/json'],
  },
]

export const DEFAULT_SOCIAL_SKILLS: Skill[] = [
  {
    id: 'social',
    name: 'Social Features',
    description:
      'Post, comment, like, share content. Engage with the community.',
    tags: ['social', 'posts', 'comments'],
    examples: [
      'Create a post about market predictions',
      'Like the latest post',
      'Comment on trending discussions',
    ],
    inputModes: ['text/plain'],
    outputModes: ['application/json'],
  },
]

export const DEFAULT_MESSAGING_SKILLS: Skill[] = [
  {
    id: 'messaging',
    name: 'Chat & Messaging',
    description: 'Send messages, create groups, participate in chats.',
    tags: ['messaging', 'chat', 'dm'],
    examples: [
      'Get my chats',
      'Send a message',
      'Create a trading strategy group',
    ],
    inputModes: ['text/plain'],
    outputModes: ['application/json'],
  },
]

/**
 * Agent Card Generator
 *
 * Creates A2A-compliant agent cards with platform-specific configuration.
 *
 * @example
 * ```typescript
 * const generator = new AgentCardGenerator({
 *   baseUrl: 'https://myplatform.com',
 *   organization: 'My Platform',
 *   organizationUrl: 'https://myplatform.com',
 * });
 *
 * const card = generator.generate({
 *   id: 'agent-123',
 *   name: 'Trading Agent',
 *   description: 'An autonomous trading agent',
 * });
 * ```
 */
export class AgentCardGenerator {
  private config: AgentCardConfig

  constructor(config: AgentCardConfig) {
    this.config = {
      protocolVersion: '0.3.0',
      securitySchemeName: 'apiKey',
      securityHeaderName: 'X-API-Key',
      securityDescription: 'API key for authentication',
      enableStreaming: false,
      enablePushNotifications: false,
      enableStateTransitionHistory: true,
      ...config,
    }
  }

  /**
   * Generate an agent card for a specific agent
   */
  generate(agent: AgentData): AgentCard {
    const agentUrl = `${this.config.baseUrl}/api/agents/${agent.id}/a2a`

    const securitySchemeName = this.config.securitySchemeName || 'apiKey'

    return {
      protocolVersion: this.config.protocolVersion || '0.3.0',
      name: agent.name,
      description: agent.description,
      url: agentUrl,
      preferredTransport: 'JSONRPC' as const,
      additionalInterfaces: [
        {
          url: agentUrl,
          transport: 'JSONRPC' as const,
        },
      ],

      provider: {
        organization: this.config.organization,
        url: this.config.organizationUrl,
      },

      iconUrl:
        agent.iconUrl ||
        this.config.defaultIconUrl ||
        `${this.config.baseUrl}/logo.svg`,
      version: agent.version || '1.0.0',
      documentationUrl:
        this.config.documentationUrl || `${this.config.baseUrl}/docs`,

      capabilities: {
        streaming: this.config.enableStreaming || false,
        pushNotifications: this.config.enablePushNotifications || false,
        stateTransitionHistory:
          this.config.enableStateTransitionHistory !== false,
      },

      securitySchemes: {
        [securitySchemeName]: {
          type: 'apiKey',
          in: 'header',
          name: this.config.securityHeaderName || 'X-API-Key',
          description:
            this.config.securityDescription || 'API key for authentication',
        },
      },
      security: [{ [securitySchemeName]: [] }],

      defaultInputModes: ['text/plain', 'application/json'],
      defaultOutputModes: ['application/json'],

      skills: agent.skills || this.config.defaultSkills || [],

      supportsAuthenticatedExtendedCard: false,
    }
  }

  /**
   * Generate an agent card synchronously with pre-loaded agent data
   */
  generateSync(agent: AgentData): AgentCard {
    return this.generate(agent)
  }

  /**
   * Create a card with custom skills merged with defaults
   */
  generateWithSkills(agent: AgentData, additionalSkills: Skill[]): AgentCard {
    const baseSkills = agent.skills || this.config.defaultSkills || []
    return this.generate({
      ...agent,
      skills: [...baseSkills, ...additionalSkills],
    })
  }
}

/**
 * Create a simple agent card without instantiating a generator
 */
export function createAgentCard(
  config: AgentCardConfig,
  agent: AgentData,
): AgentCard {
  const generator = new AgentCardGenerator(config)
  return generator.generate(agent)
}
