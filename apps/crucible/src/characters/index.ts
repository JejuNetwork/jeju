/**
 * Crucible Agent Characters
 *
 * Pre-built character definitions for common agent types.
 * These can be stored on IPFS and used as templates.
 */

export { blueTeamCharacter } from './blue-team'
export { communityManagerCharacter } from './community-manager'
export { devRelCharacter } from './devrel'
export { liaisonCharacter } from './liaison'
export { projectManagerCharacter } from './project-manager'
export { redTeamCharacter } from './red-team'
export { socialMediaManagerCharacter } from './social-media-manager'

import type { AgentCharacter } from '../types'
import { blueTeamCharacter } from './blue-team'
import { communityManagerCharacter } from './community-manager'
import { devRelCharacter } from './devrel'
import { liaisonCharacter } from './liaison'
import { projectManagerCharacter } from './project-manager'
import { redTeamCharacter } from './red-team'
import { socialMediaManagerCharacter } from './social-media-manager'

/**
 * All available characters
 */
export const characters: Record<string, AgentCharacter> = {
  'project-manager': projectManagerCharacter,
  'community-manager': communityManagerCharacter,
  devrel: devRelCharacter,
  liaison: liaisonCharacter,
  'social-media-manager': socialMediaManagerCharacter,
  'red-team': redTeamCharacter,
  'blue-team': blueTeamCharacter,
}

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
