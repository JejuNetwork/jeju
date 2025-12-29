/**
 * Content Moderation Types
 *
 * Shared types for the moderation pipeline across all services.
 */

import type { Address, Hex } from 'viem'

// ============ Content Categories ============

export type ModerationCategory =
  | 'clean' // Safe content
  | 'spam' // Unsolicited bulk content
  | 'scam' // Phishing, fraud attempts
  | 'malware' // Malicious code/links
  | 'csam' // Child sexual abuse material - IMMEDIATE BLOCK
  | 'adult' // Adult/sexual content (legal)
  | 'violence' // Graphic violence
  | 'hate' // Hate speech, discrimination
  | 'harassment' // Targeted harassment
  | 'self_harm' // Self-harm or suicide content
  | 'illegal' // Other illegal content
  | 'copyright' // Copyright infringement
  | 'pii' // Personal identifiable information leak
  | 'drugs' // Drug-related content

export type ModerationSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical'

export type ModerationAction =
  | 'allow' // Content is safe
  | 'warn' // Show warning but allow
  | 'queue' // Queue for human review
  | 'block' // Block content
  | 'ban' // Block and ban user

// ============ Content Types ============

export type ContentType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'file'
  | 'code'
  | 'name' // JNS/DNS names

export interface ContentMetadata {
  filename?: string
  mimeType?: string
  size?: number
  sha256?: Hex
  md5?: string
  cid?: string
  senderAddress?: Address
  recipientAddresses?: Address[]
  context?: 'storage' | 'messaging' | 'inference' | 'compute' | 'names'
}

// ============ Provider Types ============

export type ModerationProvider =
  | 'local' // Local pattern matching (free, fast)
  | 'openai' // OpenAI Moderation API (free for text)
  | 'hive' // Hive Moderation (image/video)
  | 'aws_rekognition' // AWS Rekognition (image)
  | 'aws-rekognition' // Alias for AWS Rekognition
  | 'cloudflare' // Cloudflare Images
  | 'llm' // LLM deep analysis
  | 'hash' // Hash-based detection (CSAM/malware)
  | 'nsfwjs' // NSFW.js local detection
  | 'nsfw_local' // NSFW local detection (no ML)
  | 'obscenity' // Obscenity library for name filtering

export interface ProviderConfig {
  provider: ModerationProvider
  enabled: boolean
  apiKey?: string
  endpoint?: string
  timeout?: number
  priority?: number // Lower = checked first
  categories?: ModerationCategory[] // Categories this provider handles
  contentTypes?: ContentType[] // Content types this provider handles
}

// ============ Results ============

export interface CategoryScore {
  category: ModerationCategory
  score: number // 0.0 - 1.0
  confidence: number // 0.0 - 1.0
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
  attestation?: ModerationAttestation
}

export interface HashMatch {
  hashType: 'sha256' | 'md5' | 'phash' | 'photodna'
  database: 'ncmec' | 'virustotal' | 'internal' | 'csam' | 'malware'
  matchConfidence: number
  category: ModerationCategory
}

export interface ModerationAttestation {
  timestamp: number
  resultHash: Hex
  teeSignature?: Hex
  teePlatform?: 'sgx' | 'nitro' | 'sev-snp'
}

// ============ Pipeline Configuration ============

export interface ModerationPipelineConfig {
  enabled: boolean
  providers: ProviderConfig[]
  
  // Thresholds - score above threshold triggers action
  thresholds: {
    csam: number // Default: 0.01 - VERY sensitive
    adult: number
    violence: number
    hate: number
    harassment: number
    spam: number
    scam: number
    malware: number
    self_harm: number
  }
  
  // Actions per category
  actions: Record<ModerationCategory, ModerationAction>
  
  // Reputation settings
  reputation: {
    /** Minimum trust level for reduced scanning */
    reducedScanningLevel: 'verified' | 'elite'
    /** Categories that NEVER bypass scanning regardless of reputation */
    neverBypass: ModerationCategory[]
    /** Enable exponential backoff for good users */
    exponentialBackoff: boolean
    /** Successful checks before reducing scan depth */
    successesForBackoff: number
  }
  
  // TEE settings
  tee: {
    enabled: boolean
    platforms: Array<'sgx' | 'nitro' | 'sev-snp'>
    endpoint?: string
    requireAttestation: boolean
  }
  
  // Queue settings
  queue: {
    enabled: boolean
    maxPendingReviews: number
    reviewTimeoutMs: number
  }
}

// ============ Request/Response ============

export interface ModerationRequest {
  content: Buffer | string
  contentType: ContentType
  metadata?: ContentMetadata
  senderAddress?: Address
  context?: 'public' | 'private'
  skipReputation?: boolean // Force full scan even for high-rep users
}

export interface ModerationReviewItem {
  id: string
  contentHash: Hex
  contentPreview?: string // Sanitized/blurred preview
  senderAddress: Address
  category: ModerationCategory
  scores: CategoryScore[]
  createdAt: number
  priority: 'low' | 'normal' | 'high' | 'urgent'
  status: 'pending' | 'approved' | 'rejected'
  reviewerAddress?: Address
  resolvedAt?: number
  notes?: string
}

// ============ Events ============

export interface ModerationEvent {
  type: 'content_blocked' | 'content_queued' | 'user_warned' | 'user_banned' | 'review_completed'
  timestamp: number
  contentHash?: Hex
  senderAddress?: Address
  category?: ModerationCategory
  action: ModerationAction
  provider?: ModerationProvider
  details?: string
}

