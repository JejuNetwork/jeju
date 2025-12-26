/**
 * Agent Runtime Factory
 *
 * Creates ElizaOS runtime instances for agents with Jeju plugins.
 *
 * @packageDocumentation
 */

import type { Character, IAgentRuntime, Plugin } from '@elizaos/core'
import { getJejuApiKey } from '@jejunetwork/config'
import { logger } from '@jejunetwork/shared'
import { createAutonomyPlugin } from '../plugins/autonomy'
import { createCorePlugin } from '../plugins/core'
import { createExperiencePlugin } from '../plugins/experience'
import { createTrajectoryPlugin } from '../plugins/trajectory'
import type { AgentConfig, AgentTemplate } from '../types'

/**
 * Runtime creation options
 */
export interface RuntimeCreationOptions {
  /** Additional plugins to include */
  plugins?: Plugin[]
  /** Override the default model */
  modelOverride?: string
  /** Skip adding Jeju enhancement plugins */
  skipEnhancement?: boolean
  /** Enable trading capabilities */
  enableTrading?: boolean
  /** Enable social capabilities */
  enableSocial?: boolean
  /** Enable trajectory logging */
  enableTrajectoryLogging?: boolean
}

/**
 * Agent Runtime Factory
 *
 * Creates configured ElizaOS runtime instances with Jeju plugins.
 */
export class AgentRuntimeFactory {
  /**
   * Create runtime from agent config
   */
  async createFromConfig(
    agent: AgentConfig,
    options: RuntimeCreationOptions = {},
  ): Promise<IAgentRuntime> {
    logger.info('Creating runtime from config', {
      agentId: agent.id,
      modelTier: agent.modelTier,
    })

    // Build character from agent config
    const character = this.createCharacter(agent)

    // Enhance with Jeju plugins
    const enhancedCharacter = options.skipEnhancement
      ? character
      : this.enhanceCharacter(character, options)

    // Use dynamic import to avoid circular dependency issues
    const { AgentRuntime } = await import('@elizaos/core')

    // Configure API key in character settings
    const existingSecrets =
      (enhancedCharacter.settings?.secrets as Record<string, string>) ?? {}
    enhancedCharacter.settings = {
      ...(enhancedCharacter.settings ?? {}),
      secrets: {
        ...existingSecrets,
        OPENAI_API_KEY: getJejuApiKey(),
      },
    }

    const runtime = new AgentRuntime({
      agentId: agent.id as `${string}-${string}-${string}-${string}-${string}`,
      character: enhancedCharacter,
    })

    logger.info('Runtime created successfully', { agentId: agent.id })

    return runtime
  }

  /**
   * Create runtime from template
   */
  async createFromTemplate(
    template: AgentTemplate,
    agentId: string,
    options: RuntimeCreationOptions = {},
  ): Promise<IAgentRuntime> {
    logger.info('Creating runtime from template', {
      agentId,
      archetype: template.archetype,
    })

    // Build character from template
    const character: Character = {
      name: template.name,
      bio: [template.bio],
      system: template.system,
      adjectives: template.personality.split(',').map((a) => a.trim()),
      topics: [],
      style: {
        all: [template.personality],
        chat: [],
        post: [],
      },
      plugins: [],
    }

    // Enhance with Jeju plugins
    const enhancedCharacter = options.skipEnhancement
      ? character
      : this.enhanceCharacter(character, options)

    const { AgentRuntime } = await import('@elizaos/core')

    // Configure API key in character settings
    const existingSecretsTemplate =
      (enhancedCharacter.settings?.secrets as Record<string, string>) ?? {}
    enhancedCharacter.settings = {
      ...(enhancedCharacter.settings ?? {}),
      secrets: {
        ...existingSecretsTemplate,
        OPENAI_API_KEY: getJejuApiKey(),
      },
    }

    const runtime = new AgentRuntime({
      agentId: agentId as `${string}-${string}-${string}-${string}-${string}`,
      character: enhancedCharacter,
    })

    logger.info('Runtime created from template', {
      agentId,
      archetype: template.archetype,
    })

    return runtime
  }

  /**
   * Create character from agent config
   */
  createCharacter(agent: AgentConfig): Character {
    return {
      name: agent.name,
      bio: agent.description ? [agent.description] : [],
      system: agent.character.system ?? '',
      adjectives: agent.character.adjectives ?? [],
      topics: agent.character.topics ?? [],
      style: agent.character.style ?? {
        all: [],
        chat: [],
        post: [],
      },
      plugins: agent.character.plugins ?? [],
    }
  }

  /**
   * Enhance character with Jeju capabilities
   */
  enhanceCharacter(
    character: Character,
    options: RuntimeCreationOptions = {},
  ): Character {
    const plugins: Plugin[] = []

    // Add core plugin
    plugins.push(
      createCorePlugin({
        enableTrading: options.enableTrading !== false,
        enableSocial: options.enableSocial !== false,
        enableA2A: true,
      }),
    )

    // Add autonomy plugin
    plugins.push(
      createAutonomyPlugin({
        enableTrading: options.enableTrading !== false,
        enablePosting: options.enableSocial !== false,
        enableCommenting: options.enableSocial !== false,
        enableDMs: options.enableSocial !== false,
      }),
    )

    // Add experience plugin
    plugins.push(
      createExperiencePlugin({
        enableTrajectoryLogging: options.enableTrajectoryLogging !== false,
        enableFeedbackCollection: true,
      }),
    )

    // Add trajectory plugin if enabled
    if (options.enableTrajectoryLogging !== false) {
      plugins.push(
        createTrajectoryPlugin({
          batchSize: 50,
          flushInterval: 60000,
        }),
      )
    }

    // Add any custom plugins from options
    if (options.plugins) {
      plugins.push(...options.plugins)
    }

    // Enhance system prompt with Jeju context
    const enhancedSystem = `${character.system ?? ''}

You are an AI agent on Jeju Network - a decentralized platform for prediction markets and social trading.

Your capabilities include:
- Trading on prediction markets and perpetual futures
- Creating social posts and engaging with the community
- Communicating with other AI agents via A2A protocol
- Learning and improving from your experiences

Always act in accordance with your goals and directives while respecting risk limits.`

    // Note: Character.plugins is for plugin names (string[]), not Plugin objects
    // The actual Plugin objects are passed to the runtime separately via options.plugins
    const pluginNames = plugins.map((p) => p.name)

    return {
      ...character,
      system: enhancedSystem,
      plugins: [...(character.plugins ?? []), ...pluginNames],
    }
  }


  /**
   * Create a minimal runtime for testing
   */
  async createTestRuntime(agentId: string): Promise<IAgentRuntime> {
    const { AgentRuntime } = await import('@elizaos/core')

    return new AgentRuntime({
      agentId: agentId as `${string}-${string}-${string}-${string}-${string}`,
      character: {
        name: 'Test Agent',
        bio: ['A test agent'],
        system: 'You are a test agent.',
        adjectives: [],
        topics: [],
        style: { all: [], chat: [], post: [] },
        plugins: [],
      },
    })
  }
}

/** Singleton instance */
export const agentRuntimeFactory = new AgentRuntimeFactory()
