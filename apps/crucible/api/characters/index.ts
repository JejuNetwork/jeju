import type { AgentCharacter } from '../../lib/types'
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
import { securityAnalystCharacter } from './security-analyst'
import { testAgentCharacter } from './test-agent'
import {
  contractsExpertCharacter,
  fuzzTesterCharacter,
  scammerCharacter,
  securityResearcherCharacter,
} from './red-team/index'
import { socialMediaManagerCharacter } from './social-media-manager'

export const characters: Record<string, AgentCharacter> = {
  'project-manager': projectManagerCharacter,
  'community-manager': communityManagerCharacter,
  devrel: devRelCharacter,
  liaison: liaisonCharacter,
  'social-media-manager': socialMediaManagerCharacter,
  'red-team': redTeamCharacter,
  scammer: scammerCharacter,
  'security-researcher': securityResearcherCharacter,
  'contracts-expert': contractsExpertCharacter,
  'fuzz-tester': fuzzTesterCharacter,
  'blue-team': blueTeamCharacter,
  moderator: moderatorCharacter,
  'network-guardian': networkGuardianCharacter,
  'contracts-auditor': contractsAuditorCharacter,
  'security-analyst': securityAnalystCharacter,
  'test-agent': testAgentCharacter,
}

export const RED_TEAM_CHARACTERS = [
  'red-team',
  'scammer',
  'security-researcher',
  'contracts-expert',
  'fuzz-tester',
] as const

export const BLUE_TEAM_CHARACTERS = [
  'blue-team',
  'moderator',
  'network-guardian',
  'contracts-auditor',
] as const

export async function loadBlueTeamCharacters(): Promise<AgentCharacter[]> {
  return BLUE_TEAM_CHARACTERS.map((id) => characters[id]).filter(
    (c): c is AgentCharacter => c !== undefined,
  )
}

export async function loadRedTeamCharacters(): Promise<AgentCharacter[]> {
  return RED_TEAM_CHARACTERS.map((id) => characters[id]).filter(
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

export { blueTeamCharacter } from './blue-team'
export { communityManagerCharacter } from './community-manager'
export { devRelCharacter } from './devrel'
export { liaisonCharacter } from './liaison'
export { projectManagerCharacter } from './project-manager'
export { redTeamCharacter } from './red-team'
export { securityAnalystCharacter } from './security-analyst'
export { socialMediaManagerCharacter } from './social-media-manager'
export { testAgentCharacter } from './test-agent'
