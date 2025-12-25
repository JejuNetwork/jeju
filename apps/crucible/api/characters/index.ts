/**
 * Crucible Agent Characters
 *
 * Pre-built character definitions for common agent types.
 * Organized into red team (adversarial) and blue team (defensive).
 */

import type { AgentCharacter } from '../../lib/types'

// Character imports
import { blueTeamCharacter } from './blue-team'
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

// Red team character IDs (for adversarial testing)
const _RED_TEAM_CHARACTERS = [
  'red-team',
  'scammer',
  'security-researcher',
  'contracts-expert',
  'fuzz-tester',
] as const

// Blue team character IDs (for defense/moderation)
const _BLUE_TEAM_CHARACTERS = [
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
