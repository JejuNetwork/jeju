/**
 * Email Content Screening Pipeline
 *
 * Multi-tier content moderation for email:
 * 1. Hash-based detection (PhotoDNA-style for CSAM)
 * 2. ML classifiers for spam/scam/phishing
 * 3. LLM review for flagged content
 * 4. Full account review for repeat offenders
 *
 * All screening happens in TEE when available.
 * Content is NEVER stored if flagged as CSAM.
 */

import { getDWSComputeUrl } from '@jejunetwork/config'
import { type CQLClient, getCQL } from '@jejunetwork/db'
import type { Address, Hex } from 'viem'
import { z } from 'zod'
import {
  accountBansTotal,
  contentScreeningDuration,
  contentScreeningTotal,
  moderationReviewsTotal,
} from './metrics'
import type {
  AccountReview,
  ContentFlag,
  ContentFlagType,
  ContentScores,
  EmailContent,
  EmailEnvelope,
  ScreeningAction,
  ScreeningResult,
  ViolationSummary,
} from './types'

// ============ CQL Database Setup ============

const EMAIL_SCREENING_DATABASE_ID = 'dws-email-screening'
let cqlClient: CQLClient | null = null

async function getCQLClient(): Promise<CQLClient> {
  if (!cqlClient) {
    cqlClient = getCQL()
    await ensureScreeningTables()
  }
  return cqlClient
}

async function ensureScreeningTables(): Promise<void> {
  if (!cqlClient) return

  const createAccountFlagsTable = `
    CREATE TABLE IF NOT EXISTS email_account_flags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      address TEXT NOT NULL,
      flag_type TEXT NOT NULL,
      confidence REAL NOT NULL,
      details TEXT NOT NULL,
      evidence_hash TEXT,
      created_at INTEGER NOT NULL
    )
  `
  const createAccountFlagsIndex = `
    CREATE INDEX IF NOT EXISTS idx_account_flags_address ON email_account_flags(address)
  `

  const createAccountStatsTable = `
    CREATE TABLE IF NOT EXISTS email_account_stats (
      address TEXT PRIMARY KEY,
      email_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )
  `

  const createModerationQueueTable = `
    CREATE TABLE IF NOT EXISTS email_moderation_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account TEXT NOT NULL,
      email_address TEXT NOT NULL,
      review_reason TEXT NOT NULL,
      content_analysis TEXT NOT NULL,
      recommendation TEXT NOT NULL,
      confidence REAL NOT NULL,
      created_at INTEGER NOT NULL,
      processed INTEGER NOT NULL DEFAULT 0
    )
  `
  const createModerationQueueIndex = `
    CREATE INDEX IF NOT EXISTS idx_moderation_queue_processed ON email_moderation_queue(processed, created_at)
  `

  await cqlClient.exec(createAccountFlagsTable, [], EMAIL_SCREENING_DATABASE_ID)
  await cqlClient.exec(createAccountFlagsIndex, [], EMAIL_SCREENING_DATABASE_ID)
  await cqlClient.exec(createAccountStatsTable, [], EMAIL_SCREENING_DATABASE_ID)
  await cqlClient.exec(
    createModerationQueueTable,
    [],
    EMAIL_SCREENING_DATABASE_ID,
  )
  await cqlClient.exec(
    createModerationQueueIndex,
    [],
    EMAIL_SCREENING_DATABASE_ID,
  )
}

// CQL row types
interface AccountFlagRow {
  id: number
  address: string
  flag_type: string
  confidence: number
  details: string
  evidence_hash: string | null
  created_at: number
}

interface AccountStatsRow {
  address: string
  email_count: number
  updated_at: number
}

interface ModerationQueueRow {
  id: number
  account: string
  email_address: string
  review_reason: string
  content_analysis: string
  recommendation: string
  confidence: number
  created_at: number
  processed: number
}

// ============ Zod Schemas for JSON Parsing ============

// Schema for AI classification response content
const ContentScoresSchema = z.object({
  spam: z.number().min(0).max(1).default(0),
  scam: z.number().min(0).max(1).default(0),
  csam: z.number().min(0).max(1).default(0),
  malware: z.number().min(0).max(1).default(0),
  harassment: z.number().min(0).max(1).default(0),
})

// Schema for OpenAI-style chat completion response
const ChatCompletionResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string(),
      }),
    }),
  ),
})

// Schema for account review AI response
const AccountReviewResponseSchema = z.object({
  assessment: z.string(),
  reasoning: z.string(),
  recommendation: z.enum(['allow', 'warn', 'suspend', 'ban']),
  confidence: z.number().min(0).max(1),
})

// Schema for hash list response - can be array or newline-separated
const HashListSchema = z.array(z.string())

// Schema for moderation queue validation (can be used for external API responses)
const _AccountReviewSchema = z.object({
  account: z.string(),
  emailAddress: z.string(),
  reviewReason: z.string(),
  contentAnalysis: z.object({
    totalEmails: z.number(),
    flaggedEmails: z.number(),
    flaggedPercentage: z.number(),
    violations: z.array(
      z.object({
        type: z.string(),
        count: z.number(),
        severity: z.enum(['low', 'medium', 'high', 'critical']),
        description: z.string(),
      }),
    ),
    overallAssessment: z.string(),
    llmReasoning: z.string(),
  }),
  recommendation: z.enum(['allow', 'warn', 'suspend', 'ban']),
  confidence: z.number().min(0).max(1),
  timestamp: z.number(),
})
// Export type for external use
export type AccountReviewData = z.infer<typeof _AccountReviewSchema>

// ============ Configuration ============

interface ContentScreeningConfig {
  enabled: boolean
  aiModelEndpoint: string
  csamHashListUrl?: string

  // Thresholds
  spamThreshold: number // 0.9 = block if spam score > 90%
  scamThreshold: number // 0.85 = block if scam score > 85%
  csamThreshold: number // 0.01 = VERY low threshold, any suspicion triggers review
  malwareThreshold: number // 0.8 = block if malware score > 80%

  // Account review
  flaggedPercentageThreshold: number // 0.1 = review if >10% of emails flagged
  minEmailsForReview: number // 3 = minimum emails before account review

  // TEE
  teeEnabled: boolean
  teeEndpoint?: string
}

const DEFAULT_CONFIG: ContentScreeningConfig = {
  enabled: true,
  aiModelEndpoint: `${getDWSComputeUrl()}/chat/completions`,
  spamThreshold: 0.9,
  scamThreshold: 0.85,
  csamThreshold: 0.01,
  malwareThreshold: 0.8,
  flaggedPercentageThreshold: 0.1,
  minEmailsForReview: 3,
  teeEnabled: false,
}

// ============ Hash Lists ============

// CSAM hash list (PhotoDNA-style perceptual hashes)
// In production, this would be fetched from NCMEC or similar
const csamHashList = new Set<string>()
const malwareHashList = new Set<string>()

// ============ Main Screening Class ============

export class ContentScreeningPipeline {
  private config: ContentScreeningConfig

  constructor(config: Partial<ContentScreeningConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Screen an email before delivery
   * Returns screening result with action to take
   */
  async screenEmail(
    envelope: EmailEnvelope,
    content: EmailContent,
    senderAddress: Address,
  ): Promise<ScreeningResult> {
    const startTime = Date.now()
    const messageId = envelope.id

    // If screening is disabled, allow all emails
    if (!this.config.enabled) {
      return this.createResult(
        messageId,
        true,
        { spam: 0, scam: 0, csam: 0, malware: 0, harassment: 0 },
        [],
        'allow',
        false,
        Date.now() - startTime,
      )
    }

    const flags: ContentFlag[] = []
    let scores: ContentScores = {
      spam: 0,
      scam: 0,
      csam: 0,
      malware: 0,
      harassment: 0,
    }

    const hashFlags = await this.checkHashes(content)
    flags.push(...hashFlags)

    // If CSAM hash detected, immediately block and ban
    if (hashFlags.some((f) => f.type === 'csam' && f.confidence > 0.99)) {
      return this.createResult(
        messageId,
        false,
        scores,
        flags,
        'block_and_ban',
        true,
      )
    }

    // Tier 2: ML classifiers
    scores = await this.runClassifiers(content)

    // Add flags based on scores
    if (scores.spam > this.config.spamThreshold) {
      flags.push({
        type: 'spam',
        confidence: scores.spam,
        details: 'High spam probability detected',
      })
    }

    if (scores.scam > this.config.scamThreshold) {
      flags.push({
        type: 'scam',
        confidence: scores.scam,
        details: 'Potential scam/phishing detected',
      })
    }

    if (scores.csam > this.config.csamThreshold) {
      flags.push({
        type: 'csam',
        confidence: scores.csam,
        details: 'Potential CSAM detected - requires review',
      })
    }

    if (scores.malware > this.config.malwareThreshold) {
      flags.push({
        type: 'malware',
        confidence: scores.malware,
        details: 'Potential malware attachment detected',
      })
    }

    // Track flags for account (CQL-backed)
    await this.trackAccountFlag(senderAddress, flags)
    await this.incrementAccountEmailCount(senderAddress)

    // Determine action
    const action = await this.determineAction(flags, scores, senderAddress)
    const reviewRequired =
      action === 'review' || flags.some((f) => f.type === 'csam')

    if (await this.shouldTriggerAccountReview(senderAddress)) {
      await this.performAccountReview(senderAddress)
    }

    const durationSeconds = (Date.now() - startTime) / 1000
    contentScreeningDuration.observe(durationSeconds)
    contentScreeningTotal.inc({
      result: action === 'allow' ? 'passed' : 'failed',
      action,
    })

    return this.createResult(
      messageId,
      action === 'allow',
      scores,
      flags,
      action,
      reviewRequired,
    )
  }

  /**
   * Check content against hash lists
   */
  private async checkHashes(content: EmailContent): Promise<ContentFlag[]> {
    const flags: ContentFlag[] = []

    // Check attachment hashes
    for (const attachment of content.attachments ?? []) {
      // Check against CSAM hash list
      if (csamHashList.has(attachment.checksum)) {
        flags.push({
          type: 'csam',
          confidence: 0.999, // Hash match = very high confidence
          details: `Attachment "${attachment.filename}" matches known CSAM hash`,
          evidenceHash: attachment.checksum,
        })
      }

      // Check against malware hash list
      if (malwareHashList.has(attachment.checksum)) {
        flags.push({
          type: 'malware',
          confidence: 0.999,
          details: `Attachment "${attachment.filename}" matches known malware hash`,
          evidenceHash: attachment.checksum,
        })
      }
    }

    return flags
  }

  /**
   * Run ML classifiers on content
   * FAIL-FAST: If AI is unavailable, throws error - content must be screened
   */
  private async runClassifiers(content: EmailContent): Promise<ContentScores> {
    const text = [
      content.subject,
      content.bodyText,
      ...(content.attachments?.map((a) => a.filename) ?? []),
    ].join('\n')

    const response = await fetch(this.config.aiModelEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: `You are a content classification system. Analyze the following email content and return JSON with scores from 0-1 for:
- spam: Unsolicited bulk email, advertising
- scam: Phishing, fraud attempts, financial scams
- csam: Child sexual abuse material (any indication)
- malware: Malicious links or attachments
- harassment: Bullying, threats, hate speech

Be conservative with csam scores - even slight suspicion should result in a non-zero score.
Return ONLY valid JSON: {"spam": 0.0, "scam": 0.0, "csam": 0.0, "malware": 0.0, "harassment": 0.0}`,
          },
          {
            role: 'user',
            content: `Classify this email content:\n\n${text.slice(0, 4000)}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 200,
      }),
    })

    if (!response.ok) {
      throw new Error(`AI classification failed: ${response.status}`)
    }

    const rawData: unknown = await response.json()
    const data = ChatCompletionResponseSchema.parse(rawData)
    const firstChoice = data.choices[0]
    if (!firstChoice) {
      throw new Error('No choices in AI response')
    }

    const content_response = firstChoice.message.content

    const jsonMatch = content_response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('AI response did not contain valid JSON')
    }

    const parseResult = ContentScoresSchema.safeParse(JSON.parse(jsonMatch[0]))
    if (!parseResult.success) {
      throw new Error('AI response did not match expected schema')
    }

    return {
      spam: Math.max(0, Math.min(1, parseResult.data.spam)),
      scam: Math.max(0, Math.min(1, parseResult.data.scam)),
      csam: Math.max(0, Math.min(1, parseResult.data.csam)),
      malware: Math.max(0, Math.min(1, parseResult.data.malware)),
      harassment: Math.max(0, Math.min(1, parseResult.data.harassment)),
    }
  }

  /**
   * Track flags for an account (CQL-backed)
   */
  private async trackAccountFlag(
    address: Address,
    flags: ContentFlag[],
  ): Promise<void> {
    if (flags.length === 0) return

    const client = await getCQLClient()
    const now = Date.now()
    const normalizedAddress = address.toLowerCase()

    for (const flag of flags) {
      await client.exec(
        `INSERT INTO email_account_flags (address, flag_type, confidence, details, evidence_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          normalizedAddress,
          flag.type,
          flag.confidence,
          flag.details,
          flag.evidenceHash ?? null,
          now,
        ],
        EMAIL_SCREENING_DATABASE_ID,
      )
    }
  }

  /**
   * Increment account email count (CQL-backed)
   */
  private async incrementAccountEmailCount(address: Address): Promise<void> {
    const client = await getCQLClient()
    const normalizedAddress = address.toLowerCase()
    const now = Date.now()

    await client.exec(
      `INSERT INTO email_account_stats (address, email_count, updated_at)
       VALUES (?, 1, ?)
       ON CONFLICT(address) DO UPDATE SET
         email_count = email_count + 1,
         updated_at = ?`,
      [normalizedAddress, now, now],
      EMAIL_SCREENING_DATABASE_ID,
    )
  }

  /**
   * Check if account review is needed (CQL-backed)
   */
  private async shouldTriggerAccountReview(address: Address): Promise<boolean> {
    const client = await getCQLClient()
    const normalizedAddress = address.toLowerCase()

    // Get email count
    const statsResult = await client.query<
      Pick<AccountStatsRow, 'email_count'>
    >(
      `SELECT email_count FROM email_account_stats WHERE address = ?`,
      [normalizedAddress],
      EMAIL_SCREENING_DATABASE_ID,
    )
    const emailCount = statsResult.rows[0]?.email_count ?? 0

    if (emailCount < this.config.minEmailsForReview) {
      return false
    }

    // Get flags for this account
    const flagsResult = await client.query<
      Pick<AccountFlagRow, 'flag_type' | 'evidence_hash'>
    >(
      `SELECT flag_type, evidence_hash FROM email_account_flags WHERE address = ?`,
      [normalizedAddress],
      EMAIL_SCREENING_DATABASE_ID,
    )

    // Check for multiple CSAM flags
    const csamFlags = flagsResult.rows.filter((f) => f.flag_type === 'csam')
    if (csamFlags.length >= 3) {
      return true
    }

    // Check flagged percentage
    const uniqueHashes = new Set(
      flagsResult.rows.map((f) => f.evidence_hash).filter(Boolean),
    )
    const flaggedPercentage = uniqueHashes.size / emailCount

    return flaggedPercentage > this.config.flaggedPercentageThreshold
  }

  /**
   * Perform full account review with LLM and submit to moderation system (CQL-backed)
   */
  async performAccountReview(address: Address): Promise<AccountReview> {
    const flags = await this.getAccountFlags(address)
    const emailCount = await this.getAccountEmailCount(address)

    // Categorize violations
    const violationCounts: Record<ContentFlagType, number> = {
      spam: 0,
      phishing: 0,
      scam: 0,
      malware: 0,
      csam: 0,
      illegal: 0,
      harassment: 0,
      adult: 0,
    }

    for (const flag of flags) {
      violationCounts[flag.type]++
    }

    const violations: ViolationSummary[] = Object.entries(violationCounts)
      .filter(([_, count]) => count > 0)
      .map(([type, count]) => ({
        type: type as ContentFlagType,
        count,
        severity: this.getSeverity(type as ContentFlagType, count),
        description: this.getViolationDescription(
          type as ContentFlagType,
          count,
        ),
      }))

    const flaggedPercentage = flags.length / Math.max(emailCount, 1)

    // Build review prompt for LLM
    const reviewPrompt = `You are reviewing an email account for potential violations.

Account Statistics:
- Total emails sent: ${emailCount}
- Flagged emails: ${flags.length}
- Flagged percentage: ${(flaggedPercentage * 100).toFixed(1)}%

Violations detected:
${violations.map((v) => `- ${v.type}: ${v.count} instances (${v.severity} severity) - ${v.description}`).join('\n')}

Based on this analysis, provide:
1. An overall assessment of the account behavior
2. Your reasoning for the recommendation
3. A recommendation: "allow" (continue monitoring), "warn" (send warning), "suspend" (temporary), or "ban" (permanent)

For CSAM violations, ANY confirmed instance should result in "ban".
For spam, only recommend "ban" if it's systematic abuse.

Return ONLY valid JSON:
{
  "assessment": "your assessment",
  "reasoning": "your reasoning",
  "recommendation": "allow|warn|suspend|ban",
  "confidence": 0.0-1.0
}`

    let recommendation: 'allow' | 'warn' | 'suspend' | 'ban' = 'allow'
    let confidence = 0.5
    let assessment = 'Review pending'
    let reasoning = ''

    try {
      const response = await fetch(this.config.aiModelEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-opus-4-5', // Use best model for critical decisions
          messages: [
            {
              role: 'system',
              content:
                'You are a content moderation expert reviewing account behavior.',
            },
            { role: 'user', content: reviewPrompt },
          ],
          temperature: 0.2,
          max_tokens: 500,
        }),
      })

      if (response.ok) {
        const rawData: unknown = await response.json()
        const dataResult = ChatCompletionResponseSchema.safeParse(rawData)

        if (dataResult.success) {
          const firstChoice = dataResult.data.choices[0]
          const content = firstChoice?.message.content ?? ''
          const jsonMatch = content.match(/\{[\s\S]*\}/)

          if (jsonMatch) {
            const parsed: unknown = JSON.parse(jsonMatch[0])
            const parseResult = AccountReviewResponseSchema.safeParse(parsed)
            if (parseResult.success) {
              assessment = parseResult.data.assessment
              reasoning = parseResult.data.reasoning
              confidence = parseResult.data.confidence
              recommendation = parseResult.data.recommendation
            }
          }
        }
      }
    } catch (error) {
      console.error('[ContentScreening] Account review AI call failed:', error)
      // Default to manual review when AI unavailable
      recommendation = 'warn'
      assessment = 'AI review unavailable - manual review required'
      reasoning = 'Automated system could not complete review'
    }

    // Override: ANY CSAM violation with high confidence = ban
    const csamViolations = violations.find((v) => v.type === 'csam')
    if (csamViolations && csamViolations.count >= 1) {
      const avgCsamConfidence =
        flags
          .filter((f) => f.type === 'csam')
          .reduce((sum, f) => sum + f.confidence, 0) / csamViolations.count

      if (avgCsamConfidence > 0.5) {
        recommendation = 'ban'
        confidence = 0.99
        reasoning = `CSAM content detected with high confidence (${(avgCsamConfidence * 100).toFixed(1)}%). Automatic ban applied.`
      }
    }

    const review: AccountReview = {
      account: address,
      emailAddress: '',
      reviewReason: 'Automated content screening triggered review',
      contentAnalysis: {
        totalEmails: emailCount,
        flaggedEmails: flags.length,
        flaggedPercentage,
        violations,
        overallAssessment: assessment,
        llmReasoning: reasoning,
      },
      recommendation,
      confidence,
      timestamp: Date.now(),
    }

    moderationReviewsTotal.inc({ recommendation })
    if (recommendation === 'ban') {
      accountBansTotal.inc({ reason: 'content_violation' })
    }

    await this.submitToModerationSystem(review)

    return review
  }

  /**
   * Submit account review to decentralized moderation system via DWS
   */
  private async submitToModerationSystem(review: AccountReview): Promise<void> {
    const moderationEndpoint = process.env.DWS_ENDPOINT
      ? `${process.env.DWS_ENDPOINT}/moderation`
      : 'http://localhost:4000/moderation'

    try {
      const response = await fetch(`${moderationEndpoint}/submit-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service: 'email',
          target: review.account,
          review: {
            reason: review.reviewReason,
            analysis: review.contentAnalysis,
            recommendation: review.recommendation,
            confidence: review.confidence,
            timestamp: review.timestamp,
          },
          // If recommendation is ban with high confidence, request automatic action
          autoAction:
            review.recommendation === 'ban' && review.confidence > 0.9,
        }),
      })

      if (!response.ok) {
        console.error(
          `[ContentScreening] Failed to submit to moderation: ${response.status}`,
        )
        // Queue locally for retry
        await this.queueModerationReview(review)
      } else {
        console.log(
          `[ContentScreening] Review submitted for ${review.account}: ${review.recommendation}`,
        )
      }
    } catch (error) {
      console.error('[ContentScreening] Moderation submission failed:', error)
      await this.queueModerationReview(review)
    }
  }

  /**
   * Queue review in CQL when moderation endpoint is unavailable
   */
  private async queueModerationReview(review: AccountReview): Promise<void> {
    const client = await getCQLClient()
    const now = Date.now()

    await client.exec(
      `INSERT INTO email_moderation_queue (account, email_address, review_reason, content_analysis, recommendation, confidence, created_at, processed)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        review.account,
        review.emailAddress,
        review.reviewReason,
        JSON.stringify(review.contentAnalysis),
        review.recommendation,
        review.confidence,
        now,
      ],
      EMAIL_SCREENING_DATABASE_ID,
    )

    console.log(`[ContentScreening] Review queued in CQL for ${review.account}`)
    console.warn(
      `[ContentScreening] Moderation review pending for ${review.account}: ${review.recommendation}`,
    )
  }

  /**
   * Get pending moderation reviews from CQL (for retry processing)
   */
  async getPendingModerationReviews(): Promise<AccountReview[]> {
    const client = await getCQLClient()

    const result = await client.query<ModerationQueueRow>(
      `SELECT * FROM email_moderation_queue WHERE processed = 0 ORDER BY created_at ASC`,
      [],
      EMAIL_SCREENING_DATABASE_ID,
    )

    return result.rows.map((row) => ({
      account: row.account as Address,
      emailAddress: row.email_address,
      reviewReason: row.review_reason,
      contentAnalysis: JSON.parse(row.content_analysis),
      recommendation: row.recommendation as
        | 'allow'
        | 'warn'
        | 'suspend'
        | 'ban',
      confidence: row.confidence,
      timestamp: row.created_at,
    }))
  }

  /**
   * Clear a review from the queue after successful submission (CQL-backed)
   */
  async clearModerationReview(account: string): Promise<void> {
    const client = await getCQLClient()
    const normalizedAccount = account.toLowerCase()

    await client.exec(
      `UPDATE email_moderation_queue SET processed = 1 WHERE account = ? AND processed = 0`,
      [normalizedAccount],
      EMAIL_SCREENING_DATABASE_ID,
    )
  }

  /**
   * Retry submitting pending reviews to moderation system (CQL-backed)
   */
  async retryPendingReviews(): Promise<{ submitted: number; failed: number }> {
    const pending = await this.getPendingModerationReviews()
    let submitted = 0
    let failed = 0

    for (const review of pending) {
      try {
        await this.submitToModerationSystem(review)
        await this.clearModerationReview(review.account)
        submitted++
      } catch {
        failed++
      }
    }

    return { submitted, failed }
  }

  /**
   * Determine screening action based on flags and scores (CQL-backed)
   */
  private async determineAction(
    flags: ContentFlag[],
    scores: ContentScores,
    address: Address,
  ): Promise<ScreeningAction> {
    // CSAM = immediate block and ban
    if (flags.some((f) => f.type === 'csam' && f.confidence > 0.5)) {
      return 'block_and_ban'
    }

    // High malware = reject
    if (scores.malware > this.config.malwareThreshold) {
      return 'reject'
    }

    // High scam/phishing = reject
    if (scores.scam > this.config.scamThreshold) {
      return 'reject'
    }

    // High spam = quarantine
    if (scores.spam > this.config.spamThreshold) {
      return 'quarantine'
    }

    // Multiple flags = review
    if (flags.length >= 2) {
      return 'review'
    }

    // Check account history (CQL-backed)
    const accountFlags = await this.getAccountFlags(address)
    if (accountFlags.length > 5) {
      return 'review'
    }

    return 'allow'
  }

  private getSeverity(
    type: ContentFlagType,
    count: number,
  ): 'low' | 'medium' | 'high' | 'critical' {
    if (type === 'csam') return 'critical'
    if (type === 'malware' || type === 'illegal') return 'high'
    if (count > 10) return 'high'
    if (count > 5) return 'medium'
    return 'low'
  }

  private getViolationDescription(
    type: ContentFlagType,
    count: number,
  ): string {
    const descriptions: Record<ContentFlagType, string> = {
      spam: `${count} spam emails detected`,
      phishing: `${count} phishing attempts detected`,
      scam: `${count} scam/fraud emails detected`,
      malware: `${count} malware attachments detected`,
      csam: `${count} potential CSAM instances detected - CRITICAL`,
      illegal: `${count} potentially illegal content detected`,
      harassment: `${count} harassment/abuse emails detected`,
      adult: `${count} adult content emails detected`,
    }
    return descriptions[type]
  }

  private createResult(
    messageId: Hex,
    passed: boolean,
    scores: ContentScores,
    flags: ContentFlag[],
    action: ScreeningAction,
    reviewRequired: boolean,
    _processingTimeMs?: number,
  ): ScreeningResult {
    return {
      messageId,
      passed,
      scores,
      flags,
      action,
      reviewRequired,
      timestamp: Date.now(),
    }
  }

  // ============ Hash List Management ============

  /**
   * Load CSAM hash list (from NCMEC, PhotoDNA, or internal database)
   */
  async loadCsamHashList(url: string): Promise<void> {
    console.log(`[ContentScreening] Loading CSAM hash list from ${url}`)

    try {
      const response = await fetch(url, {
        headers: {
          // Add authentication if required by the hash list provider
          Authorization: `Bearer ${process.env.HASH_LIST_API_KEY ?? ''}`,
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch CSAM hash list: ${response.status}`)
      }

      const data = await response.text()

      // Parse hash list - supports newline-separated or JSON array format
      let hashes: string[]
      try {
        const parseResult = HashListSchema.safeParse(JSON.parse(data))
        if (parseResult.success) {
          hashes = parseResult.data
        } else {
          // Valid JSON but wrong schema - treat as newline-separated
          hashes = data
            .split('\n')
            .map((h) => h.trim())
            .filter((h) => h.length > 0)
        }
      } catch {
        // Not valid JSON - newline-separated format
        hashes = data
          .split('\n')
          .map((h) => h.trim())
          .filter((h) => h.length > 0)
      }

      // Add to set
      for (const hash of hashes) {
        csamHashList.add(hash.toLowerCase())
      }

      console.log(`[ContentScreening] Loaded ${hashes.length} CSAM hashes`)
    } catch (error) {
      console.error('[ContentScreening] Failed to load CSAM hash list:', error)
      throw error // Don't silently fail - this is critical
    }
  }

  /**
   * Load malware hash list (from VirusTotal, MalwareBazaar, etc.)
   */
  async loadMalwareHashList(url: string): Promise<void> {
    console.log(`[ContentScreening] Loading malware hash list from ${url}`)

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${process.env.MALWARE_HASH_API_KEY ?? ''}`,
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch malware hash list: ${response.status}`)
      }

      const data = await response.text()

      let hashes: string[]
      try {
        const parseResult = HashListSchema.safeParse(JSON.parse(data))
        if (parseResult.success) {
          hashes = parseResult.data
        } else {
          // Valid JSON but wrong schema - treat as newline-separated
          hashes = data
            .split('\n')
            .map((h) => h.trim())
            .filter((h) => h.length > 0)
        }
      } catch {
        // Not valid JSON - newline-separated format
        hashes = data
          .split('\n')
          .map((h) => h.trim())
          .filter((h) => h.length > 0)
      }

      for (const hash of hashes) {
        malwareHashList.add(hash.toLowerCase())
      }

      console.log(`[ContentScreening] Loaded ${hashes.length} malware hashes`)
    } catch (error) {
      console.error(
        '[ContentScreening] Failed to load malware hash list:',
        error,
      )
      // Malware is less critical than CSAM - log but don't throw
    }
  }

  /**
   * Initialize hash lists from environment-configured URLs
   */
  async initializeHashLists(): Promise<void> {
    const csamUrl = process.env.CSAM_HASH_LIST_URL
    const malwareUrl = process.env.MALWARE_HASH_LIST_URL

    if (csamUrl) {
      await this.loadCsamHashList(csamUrl)
    } else {
      console.warn(
        '[ContentScreening] CSAM_HASH_LIST_URL not configured - hash detection disabled',
      )
    }

    if (malwareUrl) {
      await this.loadMalwareHashList(malwareUrl)
    }
  }

  /**
   * Add hash to CSAM list (for NCMEC reporting integration)
   */
  addCsamHash(hash: string): void {
    csamHashList.add(hash)
  }

  /**
   * Add hash to malware list
   */
  addMalwareHash(hash: string): void {
    malwareHashList.add(hash)
  }

  // ============ Account Management ============

  /**
   * Clear flags for an account (after moderation resolution) (CQL-backed)
   */
  async clearAccountFlags(address: Address): Promise<void> {
    const client = await getCQLClient()
    const normalizedAddress = address.toLowerCase()

    await client.exec(
      `DELETE FROM email_account_flags WHERE address = ?`,
      [normalizedAddress],
      EMAIL_SCREENING_DATABASE_ID,
    )

    await client.exec(
      `DELETE FROM email_account_stats WHERE address = ?`,
      [normalizedAddress],
      EMAIL_SCREENING_DATABASE_ID,
    )
  }

  /**
   * Get account flags for review (CQL-backed)
   */
  async getAccountFlags(address: Address): Promise<ContentFlag[]> {
    const client = await getCQLClient()
    const normalizedAddress = address.toLowerCase()

    const result = await client.query<AccountFlagRow>(
      `SELECT * FROM email_account_flags WHERE address = ? ORDER BY created_at DESC`,
      [normalizedAddress],
      EMAIL_SCREENING_DATABASE_ID,
    )

    return result.rows.map((row) => ({
      type: row.flag_type as ContentFlagType,
      confidence: row.confidence,
      details: row.details,
      evidenceHash: row.evidence_hash as Hex | undefined,
    }))
  }

  /**
   * Get account email count (CQL-backed)
   */
  async getAccountEmailCount(address: Address): Promise<number> {
    const client = await getCQLClient()
    const normalizedAddress = address.toLowerCase()

    const result = await client.query<Pick<AccountStatsRow, 'email_count'>>(
      `SELECT email_count FROM email_account_stats WHERE address = ?`,
      [normalizedAddress],
      EMAIL_SCREENING_DATABASE_ID,
    )

    return result.rows[0]?.email_count ?? 0
  }
}

// ============ Exports ============

export function createContentScreeningPipeline(
  config: Partial<ContentScreeningConfig> = {},
): ContentScreeningPipeline {
  return new ContentScreeningPipeline(config)
}

// Singleton for DWS
let _screeningPipeline: ContentScreeningPipeline | null = null

export function getContentScreeningPipeline(): ContentScreeningPipeline {
  if (!_screeningPipeline) {
    _screeningPipeline = new ContentScreeningPipeline()
  }
  return _screeningPipeline
}

export function resetContentScreeningPipeline(): void {
  _screeningPipeline = null
}
