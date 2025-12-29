/**
 * Local CSAM Keyword Detection
 *
 * Fast first-line-of-defense. Detects keywords → AI verification → manual review.
 *
 * DESIGN: Better false positives than false negatives for CSAM.
 * Ambiguous terms (like "cheese pizza") trigger AI review, not immediate block.
 */

import type {
  CategoryScore,
  ContentType,
  ModerationProvider,
  ModerationResult,
} from '../types'

// Unambiguous CSAM keywords - always flag
const HIGH_CONFIDENCE_KEYWORDS = new Set([
  'childporn',
  'child porn',
  'child pornography',
  'kiddie porn',
  'pedo',
  'pedophile',
  'pedophilia',
  'pthc',
  'ptsc',
  'hussyfan',
  'preteen',
  'pre-teen',
  'jailbait',
  'toddlercon',
  'underage sex',
  'underage porn',
  'underage nude',
  'minor sex',
  'minor porn',
  'minor nude',
  'child sex',
  'child nude',
  'kid sex',
  'kid nude',
])

// Ambiguous keywords - only flag with supporting context
const CONTEXT_REQUIRED_KEYWORDS = new Set([
  'cp', // Could be "control panel", "copy", etc
  'cheese pizza', // Could be actual pizza
  'pizza lover', // Could be food preference
  'lolita', // Could be the novel
  'loli', // Anime term, sometimes innocent
  'shota',
  'shotacon', // Anime terms
  'age play',
  'ageplay',
  'dd/lg',
  'ddlg',
  'cgl', // Could be adult roleplay
  'young lover',
  'little lover', // Could be age-gap adult relationship
])

// Context words that make ambiguous keywords suspicious
const SUSPICIOUS_CONTEXT = [
  'trade',
  'trading',
  'swap',
  'swapping',
  'share',
  'sharing',
  'link',
  'links',
  'pic',
  'pics',
  'photo',
  'photos',
  'video',
  'videos',
  'content',
  'collection',
  'nude',
  'naked',
  'sex',
  'porn',
  'fuck',
  'hot',
  'sexy',
  'want',
  'looking for',
  'anyone have',
  'anyone got',
  'where to find',
  'dm',
  'telegram',
  'wickr',
  'onion',
  'tor',
  'mega',
  'download',
]

// Regex patterns - always flag
const CSAM_PATTERNS = [
  // Age + sexual content
  /\b([1-9]|1[0-2])\s*(year|yr|yo)\s*old\b.*\b(sex|fuck|nude|naked|porn|hot|sexy)\b/gi,
  /\b(sex|fuck|nude|naked|porn)\b.*\b([1-9]|1[0-2])\s*(year|yr|yo)\s*old\b/gi,
  // CP evasion with separators (c p, c.p, c-p, c/p, c_p)
  /\bc[\s.\-_/\\]+p\b/gi,
  // CP leetspeak (ch1ldp0rn, k1dd1e, p3d0)
  /ch[i1!]ld\s*p[o0]rn/gi,
  /k[i1!]dd[i1!][e3]/gi,
  /p[e3]d[o0]/gi,
  // Young + explicit
  /\b(young|little|small)\s*(boy|girl|child|kid)\s*(pic|video|content|nude|naked|sex|porn)\b/gi,
  // Trading/sharing requests
  /\b(trade|trading|share|sharing|swap|looking for|anyone have)\s*(cp|pthc|young|child|preteen|underage)\b/gi,
  // Telegram/wickr solicitation with child terms
  /\b(telegram|wickr|signal)\b.*\b(cp|child|preteen|underage|young)\b/gi,
  /\b(cp|child|preteen|underage)\b.*\b(telegram|wickr|signal)\b/gi,
]

export interface LocalProviderConfig {
  additionalKeywords?: string[]
  additionalPatterns?: RegExp[]
}

export class LocalModerationProvider {
  readonly name: ModerationProvider = 'local'
  readonly supportedTypes: ContentType[] = ['text', 'code', 'name']

  private highConfidence: Set<string>
  private contextRequired: Set<string>
  private patterns: RegExp[]

  constructor(config: LocalProviderConfig = {}) {
    this.highConfidence = new Set([
      ...HIGH_CONFIDENCE_KEYWORDS,
      ...(config.additionalKeywords ?? []).map((k) => k.toLowerCase()),
    ])
    this.contextRequired = CONTEXT_REQUIRED_KEYWORDS
    this.patterns = [...CSAM_PATTERNS, ...(config.additionalPatterns ?? [])]
  }

  async moderate(content: string): Promise<ModerationResult> {
    const start = Date.now()
    const lower = content.toLowerCase()
    const matches: string[] = []
    let confidence = 0

    // Check high-confidence keywords (always flag)
    for (const kw of this.highConfidence) {
      if (lower.includes(kw)) {
        matches.push(kw)
        confidence = Math.max(confidence, 0.9)
      }
    }

    // Check context-required keywords (only flag with suspicious context)
    for (const kw of this.contextRequired) {
      if (lower.includes(kw)) {
        const hasContext = SUSPICIOUS_CONTEXT.some((ctx) => lower.includes(ctx))
        if (hasContext) {
          matches.push(`${kw}+context`)
          confidence = Math.max(confidence, 0.7)
        }
      }
    }

    // Check patterns (always flag)
    for (const p of this.patterns) {
      p.lastIndex = 0 // Reset regex state
      if (p.test(content)) {
        matches.push(`pattern:${p.source.slice(0, 20)}`)
        confidence = Math.max(confidence, 0.8)
      }
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

    const categories: CategoryScore[] = [
      {
        category: 'csam',
        score: confidence,
        confidence,
        provider: 'local',
        details: matches.join(', '),
      },
    ]

    return {
      safe: false,
      action: 'queue',
      severity: confidence >= 0.9 ? 'critical' : 'high',
      categories,
      primaryCategory: 'csam',
      blockedReason: 'Flagged for review',
      reviewRequired: true,
      processingTimeMs: Date.now() - start,
      providers: ['local'],
    }
  }
}
