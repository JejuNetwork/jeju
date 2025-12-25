/**
 * Archetype Evaluation Rubrics
 *
 * LLM judge rubrics for each agent archetype defining what "success" means.
 * Each archetype has specific scoring criteria tailored to its behavioral goals.
 *
 * @packageDocumentation
 */

import { createHash } from 'node:crypto'
import type { JudgeRubric } from '../index'
import { registerOrUpdateRubric } from '../index'
import { ASS_KISSER_PRIORITY_METRICS, ASS_KISSER_RUBRIC } from './ass-kisser'
import { DEGEN_PRIORITY_METRICS, DEGEN_RUBRIC } from './degen'
import {
  GOODY_TWOSHOES_PRIORITY_METRICS,
  GOODY_TWOSHOES_RUBRIC,
} from './goody-twoshoes'
import {
  INFORMATION_TRADER_PRIORITY_METRICS,
  INFORMATION_TRADER_RUBRIC,
} from './information-trader'
import { INFOSEC_PRIORITY_METRICS, INFOSEC_RUBRIC } from './infosec'
import { LIAR_PRIORITY_METRICS, LIAR_RUBRIC } from './liar'
import {
  PERPS_TRADER_PRIORITY_METRICS,
  PERPS_TRADER_RUBRIC,
} from './perps-trader'
import { RESEARCHER_PRIORITY_METRICS, RESEARCHER_RUBRIC } from './researcher'
import { SCAMMER_PRIORITY_METRICS, SCAMMER_RUBRIC } from './scammer'
import {
  SOCIAL_BUTTERFLY_PRIORITY_METRICS,
  SOCIAL_BUTTERFLY_RUBRIC,
} from './social-butterfly'
import {
  SUPER_PREDICTOR_PRIORITY_METRICS,
  SUPER_PREDICTOR_RUBRIC,
} from './super-predictor'
import { TRADER_PRIORITY_METRICS, TRADER_RUBRIC } from './trader'

/**
 * Default rubric for unknown archetypes
 */
export const DEFAULT_ARCHETYPE_RUBRIC = `
## General Agent Evaluation

You are evaluating an AI agent's performance in a prediction market simulation.

### Scoring Criteria (0.0 to 1.0)
- **Profitability**: Higher P&L should receive higher scores
- **Risk Management**: Balanced positions and avoiding excessive losses
- **Efficiency**: Achieving goals with fewer actions is better
- **Decision Quality**: Good reasoning and analysis before actions

### Scoring Guidelines
- 0.8-1.0: Excellent performance, consistent profits, good risk management
- 0.6-0.8: Good performance, positive P&L, reasonable decisions
- 0.4-0.6: Average performance, mixed results
- 0.2-0.4: Below average, some losses, questionable decisions
- 0.0-0.2: Poor performance, significant losses, poor decision making

Compare trajectories RELATIVE to each other within this group.
If one trajectory is significantly better, reflect that in score differences.
`

export const DEFAULT_ARCHETYPE_PRIORITY_METRICS = [
  'trading.totalPnL',
  'trading.winRate',
  'behavior.actionSuccessRate',
  'behavior.episodeLength',
]

/**
 * Registry of all archetype rubrics
 */
export const ARCHETYPE_RUBRICS: Record<string, string> = {
  trader: TRADER_RUBRIC,
  'social-butterfly': SOCIAL_BUTTERFLY_RUBRIC,
  scammer: SCAMMER_RUBRIC,
  degen: DEGEN_RUBRIC,
  researcher: RESEARCHER_RUBRIC,
  'information-trader': INFORMATION_TRADER_RUBRIC,
  'goody-twoshoes': GOODY_TWOSHOES_RUBRIC,
  'ass-kisser': ASS_KISSER_RUBRIC,
  'perps-trader': PERPS_TRADER_RUBRIC,
  'super-predictor': SUPER_PREDICTOR_RUBRIC,
  infosec: INFOSEC_RUBRIC,
  liar: LIAR_RUBRIC,
  // Aliases (no hyphens)
  socialbutterfly: SOCIAL_BUTTERFLY_RUBRIC,
  goodytwoshoes: GOODY_TWOSHOES_RUBRIC,
  asskisser: ASS_KISSER_RUBRIC,
  perpstrader: PERPS_TRADER_RUBRIC,
  superpredictor: SUPER_PREDICTOR_RUBRIC,
  informationtrader: INFORMATION_TRADER_RUBRIC,
}

/**
 * Priority metrics for each archetype
 */
export const ARCHETYPE_PRIORITY_METRICS: Record<string, string[]> = {
  trader: TRADER_PRIORITY_METRICS,
  'social-butterfly': SOCIAL_BUTTERFLY_PRIORITY_METRICS,
  scammer: SCAMMER_PRIORITY_METRICS,
  degen: DEGEN_PRIORITY_METRICS,
  researcher: RESEARCHER_PRIORITY_METRICS,
  'information-trader': INFORMATION_TRADER_PRIORITY_METRICS,
  'goody-twoshoes': GOODY_TWOSHOES_PRIORITY_METRICS,
  'ass-kisser': ASS_KISSER_PRIORITY_METRICS,
  'perps-trader': PERPS_TRADER_PRIORITY_METRICS,
  'super-predictor': SUPER_PREDICTOR_PRIORITY_METRICS,
  infosec: INFOSEC_PRIORITY_METRICS,
  liar: LIAR_PRIORITY_METRICS,
}

/**
 * Get the rubric text for an archetype
 */
export function getArchetypeRubric(archetype: string): string {
  const normalized = archetype.toLowerCase().trim()
  return ARCHETYPE_RUBRICS[normalized] ?? DEFAULT_ARCHETYPE_RUBRIC
}

/**
 * Get priority metrics for an archetype
 */
export function getArchetypePriorityMetrics(archetype: string): string[] {
  const normalized = archetype.toLowerCase().trim()
  return (
    ARCHETYPE_PRIORITY_METRICS[normalized] ?? DEFAULT_ARCHETYPE_PRIORITY_METRICS
  )
}

/**
 * Check if an archetype has a custom rubric
 */
export function hasArchetypeRubric(archetype: string): boolean {
  const normalized = archetype.toLowerCase().trim()
  return normalized in ARCHETYPE_RUBRICS
}

/**
 * Get all available archetype names (canonical names only, no aliases)
 */
export function getAvailableArchetypes(): string[] {
  return [
    'trader',
    'social-butterfly',
    'scammer',
    'degen',
    'researcher',
    'information-trader',
    'goody-twoshoes',
    'ass-kisser',
    'perps-trader',
    'super-predictor',
    'infosec',
    'liar',
  ]
}

/**
 * Rubrics version - increment when rubrics change significantly
 * Used for cache invalidation
 */
export const ARCHETYPE_RUBRICS_VERSION = '1.0.0'

/**
 * Get a hash of the rubric for an archetype
 * Used for cache invalidation when specific rubrics change
 */
export function getArchetypeRubricHash(archetype: string): string {
  const rubric = getArchetypeRubric(archetype)
  return createHash('sha256').update(rubric).digest('hex').substring(0, 16)
}

/**
 * Get the hash of all rubrics combined
 * Used for detecting any rubric changes
 */
export function getAllArchetypeRubricsHash(): string {
  const allRubrics =
    Object.values(ARCHETYPE_RUBRICS).join('::') + DEFAULT_ARCHETYPE_RUBRIC
  return createHash('sha256').update(allRubrics).digest('hex').substring(0, 16)
}

/**
 * Register all archetypes as JudgeRubrics in the global registry.
 * Call this once during application initialization.
 */
export function registerArchetypeRubrics(): void {
  const archetypes = getAvailableArchetypes()

  for (const archetype of archetypes) {
    const rubricText = getArchetypeRubric(archetype)
    const priorityMetrics = getArchetypePriorityMetrics(archetype)

    const rubric: JudgeRubric = {
      id: archetype,
      name: `${archetype.charAt(0).toUpperCase() + archetype.slice(1)} Archetype`,
      description: `LLM-as-judge rubric for ${archetype} archetype evaluation`,
      criteria: rubricText,
      priorityMetrics,
      version: ARCHETYPE_RUBRICS_VERSION,
    }

    registerOrUpdateRubric(rubric)
  }
}

// Export individual rubrics for direct access
export {
  ASS_KISSER_PRIORITY_METRICS,
  ASS_KISSER_RUBRIC,
  DEGEN_PRIORITY_METRICS,
  DEGEN_RUBRIC,
  GOODY_TWOSHOES_PRIORITY_METRICS,
  GOODY_TWOSHOES_RUBRIC,
  INFOSEC_PRIORITY_METRICS,
  INFOSEC_RUBRIC,
  INFORMATION_TRADER_PRIORITY_METRICS,
  INFORMATION_TRADER_RUBRIC,
  LIAR_PRIORITY_METRICS,
  LIAR_RUBRIC,
  PERPS_TRADER_PRIORITY_METRICS,
  PERPS_TRADER_RUBRIC,
  RESEARCHER_PRIORITY_METRICS,
  RESEARCHER_RUBRIC,
  SCAMMER_PRIORITY_METRICS,
  SCAMMER_RUBRIC,
  SOCIAL_BUTTERFLY_PRIORITY_METRICS,
  SOCIAL_BUTTERFLY_RUBRIC,
  SUPER_PREDICTOR_PRIORITY_METRICS,
  SUPER_PREDICTOR_RUBRIC,
  TRADER_PRIORITY_METRICS,
  TRADER_RUBRIC,
}
