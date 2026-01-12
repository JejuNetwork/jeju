import type { AgentCharacter } from '../../lib/types'
import type { AutonomousAgentConfig } from '../autonomous/types'
import { baseWatcherCharacter } from './base-watcher'
import { communityManagerCharacter } from './community-manager'
import { dailyDigestCharacter } from './daily-digest'
import { devRelCharacter } from './devrel'
import { endpointProberCharacter } from './endpoint-prober'
import { infraAnalyzerCharacter } from './infra-analyzer'
import { liaisonCharacter } from './liaison'
import { moderatorCharacter } from './moderator'
import { nodeMonitorCharacter } from './node-monitor'
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
  'node-monitor': nodeMonitorCharacter,
  'infra-analyzer': infraAnalyzerCharacter,
  'endpoint-prober': endpointProberCharacter,
}

// Partial config - agentId and character are derived from the key
type AutonomousAgentOverrides = Partial<
  Pick<
    AutonomousAgentConfig,
    'schedule' | 'urgencyTriggers' | 'capabilities' | 'watchRoom' | 'postToRoom' | 'tickIntervalMs'
  >
>

/**
 * Single source of truth for autonomous agent configuration.
 * Keys must match character IDs in the `characters` record above.
 */
export const AUTONOMOUS_AGENTS: Record<string, AutonomousAgentOverrides> = {
  // 'base-watcher': {
  //   postToRoom: 'base-contract-reviews',
  //   capabilities: { canChat: true, a2a: true, canTrade: false, canPropose: false, canVote: false, canDelegate: false, canStake: false, canBridge: false, compute: true },
  // },
  // 'security-analyst': {
  //   watchRoom: 'base-contract-reviews',
  //   postToRoom: 'base-contract-reviews',
  //   capabilities: { canChat: true, a2a: true, canTrade: false, canPropose: false, canVote: false, canDelegate: false, canStake: false, canBridge: false, compute: false },
  // },
  'node-monitor': {
    postToRoom: 'infra-monitoring',
    capabilities: { canChat: true, a2a: true, canTrade: false, canPropose: false, canVote: true, canDelegate: true, canStake: true, canBridge: false, compute: true },
  },
  'infra-analyzer': {
    watchRoom: 'infra-monitoring',
    postToRoom: 'infra-monitoring',
    capabilities: { canChat: true, a2a: true, canTrade: false, canPropose: false, canVote: true, canDelegate: true, canStake: true, canBridge: false, compute: true },
  },
  'endpoint-prober': {
    postToRoom: 'endpoint-monitoring',
    capabilities: { canChat: true, a2a: true, canTrade: false, canPropose: false, canVote: true, canDelegate: true, canStake: true, canBridge: false, compute: true },
  },
  'daily-digest': {
    schedule: '* * * * *',
    watchRoom: 'infra-monitoring',
    postToRoom: 'infra-monitoring',
    capabilities: { canChat: true, a2a: true, canTrade: false, canPropose: false, canVote: true, canDelegate: true, canStake: true, canBridge: false, compute: true },
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
export { endpointProberCharacter } from './endpoint-prober'
export { infraAnalyzerCharacter } from './infra-analyzer'
export { liaisonCharacter } from './liaison'
export { moderatorCharacter } from './moderator'
export { nodeMonitorCharacter } from './node-monitor'
export { projectManagerCharacter } from './project-manager'
export { securityAnalystCharacter } from './security-analyst'
export { socialMediaManagerCharacter } from './social-media-manager'
