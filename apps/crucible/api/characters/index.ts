import type { AgentCharacter } from '../../lib/types'
import type { AutonomousAgentConfig } from '../autonomous/types'
import { baseWatcherCharacter } from './base-watcher'
import { communityManagerCharacter } from './community-manager'
import { dailyDigestCharacter } from './daily-digest'
import { infraMonitorCharacter } from './infra-monitor'
import { registrationWatcherCharacter } from './registration-watcher'
import { securityAnalystCharacter } from './security-analyst'
import { testComputerCharacter } from './test-computer'
import { testCoordinatorCharacter } from './test-coordinator'
import { testTraderCharacter } from './test-trader'
import { testVoterCharacter } from './test-voter'

export const characters: Record<string, AgentCharacter> = {
  'community-manager': communityManagerCharacter,
  'daily-digest': dailyDigestCharacter,
  'security-analyst': securityAnalystCharacter,
  'base-watcher': baseWatcherCharacter,
  'infra-monitor': infraMonitorCharacter,
  'registration-watcher': registrationWatcherCharacter,
  'test-trader': testTraderCharacter,
  'test-coordinator': testCoordinatorCharacter,
  'test-voter': testVoterCharacter,
  'test-computer': testComputerCharacter,
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
  // Registration watcher - announces new agent registrations
  'registration-watcher': {
    postToRoom: 'infra-monitoring',
    tickIntervalMs: 120000, // 2 minutes
    executionMode: 'code-first',
    codeFirstConfig: {
      primaryAction: 'CHECK_NEW_REGISTRATIONS',
      llmTriggerStatuses: [], // Fully deterministic - no LLM needed
      healthyTemplate: '[REGISTRATION_CHECK | t={timestamp}] No new registrations',
    },
    capabilities: { canChat: true, a2a: false, canTrade: false, canPropose: false, canVote: false, canDelegate: false, canStake: false, canBridge: false, compute: true },
  },
  // Test agents for capability showcase (localnet bootstrap)
  'test-trader': {
    postToRoom: 'capability-demos',
    tickIntervalMs: 300000, // 5 minutes (infrequent for demo)
    executionMode: 'llm-driven',
    capabilities: { canChat: true, canTrade: true, a2a: false, compute: false, canVote: false, canPropose: false, canDelegate: false, canStake: false, canBridge: false },
  },
  'test-coordinator': {
    postToRoom: 'capability-demos',
    tickIntervalMs: 300000, // 5 minutes
    executionMode: 'llm-driven',
    capabilities: { canChat: true, canTrade: false, a2a: true, compute: false, canVote: false, canPropose: false, canDelegate: false, canStake: false, canBridge: false },
  },
  'test-voter': {
    postToRoom: 'capability-demos',
    tickIntervalMs: 300000, // 5 minutes
    executionMode: 'llm-driven',
    capabilities: { canChat: true, canTrade: false, a2a: false, compute: false, canVote: true, canPropose: false, canDelegate: false, canStake: false, canBridge: false },
  },
  'test-computer': {
    postToRoom: 'capability-demos',
    schedule: '*/2 * * * *', // Every 2 minutes (cron-based for testing)
    executionMode: 'llm-driven',
    capabilities: { canChat: true, canTrade: false, a2a: false, compute: true, canVote: false, canPropose: false, canDelegate: false, canStake: false, canBridge: false },
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
export { infraMonitorCharacter } from './infra-monitor'
export { securityAnalystCharacter } from './security-analyst'
export { registrationWatcherCharacter } from './registration-watcher'
export { testComputerCharacter } from './test-computer'
export { testCoordinatorCharacter } from './test-coordinator'
export { testTraderCharacter } from './test-trader'
export { testVoterCharacter } from './test-voter'
