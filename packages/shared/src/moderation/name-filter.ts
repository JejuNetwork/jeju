/**
 * JNS/DNS Name Moderation
 *
 * Blocks obvious slurs and reserved names. Free speech otherwise.
 * Uses obscenity library + explicit patterns for slurs/Nazi references.
 */

import {
  englishDataset,
  englishRecommendedTransformers,
  RegExpMatcher,
} from 'obscenity'
import type { ModerationResult } from './types'

const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
})

// Explicit slur/Nazi patterns
const SLUR_PATTERNS = [
  /n[i1!][gq]{2}[ae3]r?/i,
  /k[i1]ke/i,
  /sp[i1]c/i,
  /ch[i1]nk/i,
  /gook/i,
  /wetback/i,
  /hitler/i,
  /nazi/i,
  /1488/i,
  /14\/88/i,
  /heil/i,
]

// Reserved protocol names
const RESERVED = new Set([
  'admin',
  'administrator',
  'support',
  'help',
  'official',
  'jeju',
  'jejunetwork',
  'system',
  'root',
  'moderator',
  'mod',
  'staff',
  'security',
  'treasury',
  'governance',
  'protocol',
])

export interface NameModerationResult extends ModerationResult {
  suggestion?: string
}

export function moderateName(name: string): NameModerationResult {
  const start = Date.now()
  const normalized = name.toLowerCase().replace(/[-_.]/g, '')

  if (name.length < 3) {
    return blocked('Name too short (min 3)', start)
  }

  if (RESERVED.has(normalized)) {
    return blocked('Reserved name', start)
  }

  if (matcher.hasMatch(name)) {
    return blocked('Prohibited content', start, 'hate')
  }

  for (const p of SLUR_PATTERNS) {
    if (p.test(normalized)) {
      return blocked('Prohibited content', start, 'hate')
    }
  }

  return {
    safe: true,
    action: 'allow',
    severity: 'none',
    categories: [],
    reviewRequired: false,
    processingTimeMs: Date.now() - start,
    providers: ['obscenity', 'local'],
  }
}

function blocked(
  reason: string,
  start: number,
  category?: 'hate',
): NameModerationResult {
  return {
    safe: false,
    action: 'block',
    severity: category ? 'medium' : 'low',
    categories: category
      ? [{ category, score: 0.95, confidence: 0.95, provider: 'local' }]
      : [],
    primaryCategory: category,
    blockedReason: reason,
    reviewRequired: false,
    processingTimeMs: Date.now() - start,
    providers: category ? ['obscenity'] : ['local'],
  }
}

export function canRegisterName(result: NameModerationResult): boolean {
  return result.action === 'allow' || result.action === 'warn'
}
