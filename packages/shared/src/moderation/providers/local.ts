/**
 * Local CSAM Keyword Detection
 *
 * Fast first-line-of-defense for CSAM keywords. Free speech respected.
 * Detects keywords → triggers AI verification → manual review if needed.
 */

import type { CategoryScore, ContentType, ModerationProvider, ModerationResult } from '../types'

// CSAM keywords and coded language
const CSAM_KEYWORDS = new Set([
  'cp', 'childporn', 'child porn', 'child pornography', 'kiddie porn',
  'pedo', 'pedophile', 'pedophilia', 'pthc', 'ptsc', 'hussyfan',
  'cheese pizza', 'pizza lover', 'little lover', 'young lover',
  'preteen', 'pre-teen', 'jailbait', 'lolita', 'loli', 'shota', 'shotacon', 'toddlercon',
  'underage sex', 'underage porn', 'underage nude', 'minor sex', 'minor porn',
  'minor nude', 'child sex', 'child nude', 'kid sex', 'kid nude',
  'age play', 'ageplay', 'dd/lg', 'ddlg', 'cgl',
])

// Regex patterns for complex CSAM detection
const CSAM_PATTERNS = [
  /\b([1-9]|1[0-2])\s*(year|yr|yo)\s*old\b.*\b(sex|fuck|nude|naked|porn)\b/gi,
  /\b(sex|fuck|nude|naked|porn)\b.*\b([1-9]|1[0-2])\s*(year|yr|yo)\s*old\b/gi,
  /\bc[\s.\-]*p\b/gi,
  /\b(young|little|small)\s*(boy|girl|child)\s*(pic|video|content|nude|naked|sex)\b/gi,
  /\b(trade|share|swap)\s*(cp|young|child|preteen)\b/gi,
]

export interface LocalProviderConfig {
  additionalKeywords?: string[]
  additionalPatterns?: RegExp[]
}

export class LocalModerationProvider {
  readonly name: ModerationProvider = 'local'
  readonly supportedTypes: ContentType[] = ['text', 'code', 'name']

  private keywords: Set<string>
  private patterns: RegExp[]

  constructor(config: LocalProviderConfig = {}) {
    this.keywords = new Set([
      ...CSAM_KEYWORDS,
      ...(config.additionalKeywords ?? []).map(k => k.toLowerCase()),
    ])
    this.patterns = [...CSAM_PATTERNS, ...(config.additionalPatterns ?? [])]
  }

  async moderate(content: string): Promise<ModerationResult> {
    const start = Date.now()
    const lower = content.toLowerCase()
    const matches: string[] = []

    // Check keywords
    for (const kw of this.keywords) {
      if (lower.includes(kw)) matches.push(kw)
    }

    // Check patterns
    for (const p of this.patterns) {
      if (p.test(content)) matches.push(`pattern:${p.source.slice(0, 15)}`)
    }

    if (matches.length === 0) {
      return {
        safe: true,
        action: 'allow',
        severity: 'none',
        categories: [],
        reviewRequired: false,
        processingTimeMs: Date.now() - start,
        providers: ['local'],
      }
    }

    // CSAM detected - flag for AI review
    const categories: CategoryScore[] = [{
      category: 'csam',
      score: matches.length > 2 ? 0.9 : 0.7,
      confidence: 0.7,
      provider: 'local',
      details: matches.join(', '),
    }]

    return {
      safe: false,
      action: 'queue',
      severity: 'high',
      categories,
      primaryCategory: 'csam',
      blockedReason: 'Flagged for review',
      reviewRequired: true,
      processingTimeMs: Date.now() - start,
      providers: ['local'],
    }
  }
}
