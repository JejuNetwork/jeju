import type { AgentCharacter } from '../../lib/types'
import { baseWatcherCharacter } from './base-watcher'
import { communityManagerCharacter } from './community-manager'
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

export const WATCHER_CHARACTERS = [
  'base-watcher',
  'node-monitor',
  'infra-analyzer',
  'endpoint-prober',
] as const

export async function loadWatcherCharacters(): Promise<AgentCharacter[]> {
  return WATCHER_CHARACTERS.map((id) => characters[id]).filter(
    (c): c is AgentCharacter => c !== undefined,
  )
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
export { devRelCharacter } from './devrel'
export { endpointProberCharacter } from './endpoint-prober'
export { infraAnalyzerCharacter } from './infra-analyzer'
export { liaisonCharacter } from './liaison'
export { moderatorCharacter } from './moderator'
export { nodeMonitorCharacter } from './node-monitor'
export { projectManagerCharacter } from './project-manager'
export { securityAnalystCharacter } from './security-analyst'
export { socialMediaManagerCharacter } from './social-media-manager'
