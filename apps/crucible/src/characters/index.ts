/**
 * Crucible Agent Characters
 * 
 * Pre-built character definitions for common agent types.
 * These can be stored on IPFS and used as templates.
 */

export { projectManagerCharacter } from './project-manager';
export { communityManagerCharacter } from './community-manager';
export { devRelCharacter } from './devrel';
export { liaisonCharacter } from './liaison';
export { socialMediaManagerCharacter } from './social-media-manager';
export { redTeamCharacter } from './red-team';
export { blueTeamCharacter } from './blue-team';

import { projectManagerCharacter } from './project-manager';
import { communityManagerCharacter } from './community-manager';
import { devRelCharacter } from './devrel';
import { liaisonCharacter } from './liaison';
import { socialMediaManagerCharacter } from './social-media-manager';
import { redTeamCharacter } from './red-team';
import { blueTeamCharacter } from './blue-team';
import type { AgentCharacter } from '../types';

/**
 * All available characters
 */
export const characters: Record<string, AgentCharacter> = {
  'project-manager': projectManagerCharacter,
  'community-manager': communityManagerCharacter,
  'devrel': devRelCharacter,
  'liaison': liaisonCharacter,
  'social-media-manager': socialMediaManagerCharacter,
  'red-team': redTeamCharacter,
  'blue-team': blueTeamCharacter,
};

/**
 * Get character by ID
 */
export function getCharacter(id: string): AgentCharacter | null {
  return characters[id] ?? null;
}

/**
 * List all character IDs
 */
export function listCharacters(): string[] {
  return Object.keys(characters);
}
