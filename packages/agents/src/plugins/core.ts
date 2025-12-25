/**
 * Core Agent Plugin
 *
 * Base plugin providing core agent capabilities.
 *
 * @packageDocumentation
 */

import type { Plugin } from '@elizaos/core'

/**
 * Core plugin configuration
 */
export interface CorePluginConfig {
  enableTrading?: boolean
  enableSocial?: boolean
  enableA2A?: boolean
}

/**
 * Create the core agent plugin for ElizaOS
 */
export function createCorePlugin(_config: CorePluginConfig = {}): Plugin {
  return {
    name: 'jeju-agent-core',
    description: 'Core Jeju agent capabilities - trading, social, A2A',
    actions: [],
    providers: [],
    evaluators: [],
    services: [],
  }
}

/** Default core plugin */
export const corePlugin = createCorePlugin()
