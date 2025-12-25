/**
 * Experience Plugin
 *
 * Plugin for managing agent experience and learning.
 *
 * @packageDocumentation
 */

import type { Plugin } from '@elizaos/core'

/**
 * Experience plugin configuration
 */
export interface ExperiencePluginConfig {
  enableTrajectoryLogging?: boolean
  enableFeedbackCollection?: boolean
}

/**
 * Create the experience plugin for ElizaOS
 */
export function createExperiencePlugin(
  _config: ExperiencePluginConfig = {},
): Plugin {
  return {
    name: 'jeju-agent-experience',
    description: 'Agent experience and learning - trajectory logging, feedback',
    actions: [],
    providers: [],
    evaluators: [],
    services: [],
  }
}

/** Default experience plugin */
export const experiencePlugin = createExperiencePlugin()
