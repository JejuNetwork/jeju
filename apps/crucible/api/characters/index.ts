import type { AgentCharacter } from '../../lib/types'
import type { AutonomousAgentConfig } from '../autonomous/types'
import { baseWatcherCharacter } from './base-watcher'
import { communityManagerCharacter } from './community-manager'
import { dailyDigestCharacter } from './daily-digest'
import { devRelCharacter } from './devrel'
import { infraMonitorCharacter } from './infra-monitor'
import { liaisonCharacter } from './liaison'
import { moderatorCharacter } from './moderator'
import { projectManagerCharacter } from './project-manager'
import { securityAnalystCharacter } from './security-analyst'
import { socialMediaManagerCharacter } from './social-media-manager'

export const characters: Record<string, AgentCharacter> = {
  'project-manager': projectManagerCharacter,
  'community-manager': communityManagerCharacter,
  'daily-digest': dailyDigestCharacter,
  devrel: devRelCharacter,
  liaison: liaisonCharacter,
  'social-media-manager': socialMediaManagerCharacter,
  moderator: moderatorCharacter,
  'security-analyst': securityAnalystCharacter,
  'base-watcher': baseWatcherCharacter,
  'infra-monitor': infraMonitorCharacter,
}

// Partial config - agentId and character are derived from the key
type AutonomousAgentOverrides = Partial<
  Pick<
    AutonomousAgentConfig,
    'schedule' | 'urgencyTriggers' | 'capabilities' | 'watchRoom' | 'postToRoom' | 'tickIntervalMs' | 'executionMode' | 'codeFirstConfig'
  >
>

/**
 * Single source of truth for autonomous agent configuration.
 * Keys must match character IDs in the `characters` record above.
 */
export const AUTONOMOUS_AGENTS: Record<string, AutonomousAgentOverrides> = {
  // Real-time infrastructure monitoring - probes + alerts when issues detected
  'infra-monitor': {
    postToRoom: 'infra-monitoring',
    tickIntervalMs: 60000,
    executionMode: 'code-first',
    codeFirstConfig: {
      primaryAction: 'GET_INFRA_STATUS',
      llmTriggerStatuses: ['DEGRADED', 'CRITICAL'],
      healthyTemplate: '[HEALTH | t={timestamp} | status={status}] dws={dws_latency}ms crucible={crucible_latency}ms indexer={indexer_latency}ms inference={inference_nodes}',
    },
    capabilities: { canChat: true, a2a: false, canTrade: false, canPropose: false, canVote: false, canDelegate: false, canStake: false, canBridge: false, compute: true },
  },
  // Daily digest - summarizes alerts and posts to GitHub
  'daily-digest': {
    schedule: '0 9 * * *', // 9 AM daily
    watchRoom: 'infra-monitoring',
    postToRoom: 'infra-monitoring',
    executionMode: 'code-first',
    codeFirstConfig: {
      primaryAction: 'GENERATE_DAILY_DIGEST',
      llmTriggerStatuses: [], // Fully deterministic - no LLM needed
    },
    capabilities: { canChat: true, a2a: false, canTrade: false, canPropose: false, canVote: false, canDelegate: false, canStake: false, canBridge: false, compute: true },
  },
}

export function getCharacter(id: string): AgentCharacter | null {
  const character = characters[id]
  return character !== undefined ? character : null
}

export function listCharacters(): string[] {
  return Object.keys(characters)
}

export { baseWatcherCharacter } from './base-watcher'
export { communityManagerCharacter } from './community-manager'
export { dailyDigestCharacter } from './daily-digest'
export { devRelCharacter } from './devrel'
export { infraMonitorCharacter } from './infra-monitor'
export { liaisonCharacter } from './liaison'
export { moderatorCharacter } from './moderator'
export { projectManagerCharacter } from './project-manager'
export { securityAnalystCharacter } from './security-analyst'
export { socialMediaManagerCharacter } from './social-media-manager'
