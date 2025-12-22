/**
 * Crucible Agent Characters
 *
 * Pre-built character definitions for common agent types.
 * Organized into red team (adversarial) and blue team (defensive).
 */

import type { AgentCharacter } from '../types'

// Original characters
export { blueTeamCharacter } from './blue-team'
// Blue Team (Defensive) Characters
export {
  contractsAuditorCharacter,
  moderatorCharacter,
  networkGuardianCharacter,
} from './blue-team/index'
export { communityManagerCharacter } from './community-manager'
export { devRelCharacter } from './devrel'
export { liaisonCharacter } from './liaison'
export { projectManagerCharacter } from './project-manager'
export { redTeamCharacter } from './red-team'

// Red Team (Adversarial) Characters
export {
  contractsExpertCharacter,
  fuzzTesterCharacter,
  scammerCharacter,
  securityResearcherCharacter,
} from './red-team/index'
export { socialMediaManagerCharacter } from './social-media-manager'

// Import all for character registry
import { blueTeamCharacter } from './blue-team'
// Blue team imports
import {
  contractsAuditorCharacter,
  moderatorCharacter,
  networkGuardianCharacter,
} from './blue-team/index'
import { communityManagerCharacter } from './community-manager'
import { devRelCharacter } from './devrel'
import { liaisonCharacter } from './liaison'
import { projectManagerCharacter } from './project-manager'
import { redTeamCharacter } from './red-team'

// Red team imports
import {
  contractsExpertCharacter,
  fuzzTesterCharacter,
  scammerCharacter,
  securityResearcherCharacter,
} from './red-team/index'
import { socialMediaManagerCharacter } from './social-media-manager'

/**
 * All available characters by ID
 */
export const characters: Record<string, AgentCharacter> = {
  // General purpose agents
  'project-manager': projectManagerCharacter,
  'community-manager': communityManagerCharacter,
  devrel: devRelCharacter,
  liaison: liaisonCharacter,
  'social-media-manager': socialMediaManagerCharacter,

  // Red Team (adversarial security testing)
  'red-team': redTeamCharacter,
  scammer: scammerCharacter,
  'security-researcher': securityResearcherCharacter,
  'contracts-expert': contractsExpertCharacter,
  'fuzz-tester': fuzzTesterCharacter,

  // Blue Team (defensive protection)
  'blue-team': blueTeamCharacter,
  moderator: moderatorCharacter,
  'network-guardian': networkGuardianCharacter,
  'contracts-auditor': contractsAuditorCharacter,
}

/**
 * Red team character IDs (for adversarial testing)
 */
export const RED_TEAM_CHARACTERS = [
  'red-team',
  'scammer',
  'security-researcher',
  'contracts-expert',
  'fuzz-tester',
] as const

/**
 * Blue team character IDs (for defense/moderation)
 */
export const BLUE_TEAM_CHARACTERS = [
  'blue-team',
  'moderator',
  'network-guardian',
  'contracts-auditor',
] as const

/**
 * Get character by ID
 */
export function getCharacter(id: string): AgentCharacter | null {
  const character = characters[id]
  return character !== undefined ? character : null
}

/**
 * List all character IDs
 */
export function listCharacters(): string[] {
  return Object.keys(characters)
}

/**
 * Get all red team characters
 */
export function getRedTeamCharacters(): AgentCharacter[] {
  return RED_TEAM_CHARACTERS.map((id) => characters[id]).filter(
    (c): c is AgentCharacter => c !== undefined,
  )
}

/**
 * Get all blue team characters
 */
export function getBlueTeamCharacters(): AgentCharacter[] {
  return BLUE_TEAM_CHARACTERS.map((id) => characters[id]).filter(
    (c): c is AgentCharacter => c !== undefined,
  )
}
