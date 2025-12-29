/**
 * Content Moderation Types
 */

import type { Address } from 'viem'

export type ModerationCategory =
  | 'clean' | 'spam' | 'scam' | 'malware' | 'csam' | 'adult'
  | 'violence' | 'hate' | 'harassment' | 'self_harm' | 'illegal'
  | 'copyright' | 'pii' | 'drugs'

export type ModerationSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical'

/**
 * Moderation actions:
 * - allow: Content is safe, proceed normally
 * - warn: Content may be sensitive, show warning to recipient
 * - queue: Content flagged for manual review - MUST be held until reviewed
 * - block: Content blocked, do not deliver/store
 * - ban: Content blocked and user should be banned
 */
export type ModerationAction = 'allow' | 'warn' | 'queue' | 'block' | 'ban'

export type ContentType = 'text' | 'image' | 'video' | 'audio' | 'file' | 'code' | 'name'

export type ModerationProvider =
  | 'local' | 'openai' | 'hive' | 'aws_rekognition' | 'aws-rekognition'
  | 'cloudflare' | 'llm' | 'hash' | 'nsfwjs' | 'nsfw_local' | 'obscenity'

export interface CategoryScore {
  category: ModerationCategory
  score: number
  confidence: number
  provider: ModerationProvider
  details?: string
}

export interface ModerationResult {
  safe: boolean
  action: ModerationAction
  severity: ModerationSeverity
  categories: CategoryScore[]
  primaryCategory?: ModerationCategory
  blockedReason?: string
  reviewRequired: boolean
  processingTimeMs: number
  providers: ModerationProvider[]
  hashMatches?: HashMatch[]
}

export interface HashMatch {
  hashType: 'sha256' | 'md5' | 'phash' | 'photodna'
  database: 'ncmec' | 'virustotal' | 'internal' | 'csam' | 'malware'
  matchConfidence: number
  category: ModerationCategory
}

export interface ModerationRequest {
  content: Buffer | string
  contentType: ContentType
  senderAddress?: Address
}

// Used by pipeline config
export interface ModerationPipelineConfig {
  enabled: boolean
  thresholds: {
    csam: number
    adult: number
    violence: number
    hate: number
    harassment: number
    spam: number
    scam: number
    malware: number
    self_harm: number
  }
}
