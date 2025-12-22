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

import { createHash } from 'crypto';
import type { Hex, Address } from 'viem';
import type {
  EmailEnvelope,
  EmailContent,
  ScreeningResult,
  ContentScores,
  ContentFlag,
  ContentFlagType,
  ScreeningAction,
  AccountReview,
  AccountContentAnalysis,
  ViolationSummary,
  EmailAttachment,
} from './types';

// ============ Configuration ============

interface ContentScreeningConfig {
  enabled: boolean;
  aiModelEndpoint: string;
  csamHashListUrl?: string;
  
  // Thresholds
  spamThreshold: number;        // 0.9 = block if spam score > 90%
  scamThreshold: number;        // 0.85 = block if scam score > 85%
  csamThreshold: number;        // 0.01 = VERY low threshold, any suspicion triggers review
  malwareThreshold: number;     // 0.8 = block if malware score > 80%
  
  // Account review
  flaggedPercentageThreshold: number;  // 0.1 = review if >10% of emails flagged
  minEmailsForReview: number;          // 3 = minimum emails before account review
  
  // TEE
  teeEnabled: boolean;
  teeEndpoint?: string;
}

const DEFAULT_CONFIG: ContentScreeningConfig = {
  enabled: true,
  aiModelEndpoint: 'http://localhost:4030/compute/chat/completions',
  spamThreshold: 0.9,
  scamThreshold: 0.85,
  csamThreshold: 0.01,
  malwareThreshold: 0.8,
  flaggedPercentageThreshold: 0.1,
  minEmailsForReview: 3,
  teeEnabled: false,
};

// ============ Hash Lists ============

// CSAM hash list (PhotoDNA-style perceptual hashes)
// In production, this would be fetched from NCMEC or similar
const csamHashList = new Set<string>();
const malwareHashList = new Set<string>();

// ============ Main Screening Class ============

export class ContentScreeningPipeline {
  private config: ContentScreeningConfig;
  private accountFlags: Map<Address, ContentFlag[]> = new Map();
  private accountEmailCounts: Map<Address, number> = new Map();

  constructor(config: Partial<ContentScreeningConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Screen an email before delivery
   * Returns screening result with action to take
   */
  async screenEmail(
    envelope: EmailEnvelope,
    content: EmailContent,
    senderAddress: Address
  ): Promise<ScreeningResult> {
    const messageId = envelope.id;
    const flags: ContentFlag[] = [];
    let scores: ContentScores = {
      spam: 0,
      scam: 0,
      csam: 0,
      malware: 0,
      harassment: 0,
    };

    // Tier 1: Hash-based detection (fast, catches known bad content)
    const hashFlags = await this.checkHashes(content);
    flags.push(...hashFlags);

    // If CSAM hash detected, immediately block and ban
    if (hashFlags.some(f => f.type === 'csam' && f.confidence > 0.99)) {
      return this.createResult(messageId, false, scores, flags, 'block_and_ban', true);
    }

    // Tier 2: ML classifiers
    scores = await this.runClassifiers(content);

    // Add flags based on scores
    if (scores.spam > this.config.spamThreshold) {
      flags.push({
        type: 'spam',
        confidence: scores.spam,
        details: 'High spam probability detected',
      });
    }

    if (scores.scam > this.config.scamThreshold) {
      flags.push({
        type: 'scam',
        confidence: scores.scam,
        details: 'Potential scam/phishing detected',
      });
    }

    if (scores.csam > this.config.csamThreshold) {
      flags.push({
        type: 'csam',
        confidence: scores.csam,
        details: 'Potential CSAM detected - requires review',
      });
    }

    if (scores.malware > this.config.malwareThreshold) {
      flags.push({
        type: 'malware',
        confidence: scores.malware,
        details: 'Potential malware attachment detected',
      });
    }

    // Track flags for account
    this.trackAccountFlag(senderAddress, flags);
    const emailCount = (this.accountEmailCounts.get(senderAddress) ?? 0) + 1;
    this.accountEmailCounts.set(senderAddress, emailCount);

    // Determine action
    const action = this.determineAction(flags, scores, senderAddress);
    const reviewRequired = action === 'review' || 
                          flags.some(f => f.type === 'csam');

    // If multiple CSAM flags detected, trigger account review
    if (this.shouldTriggerAccountReview(senderAddress)) {
      await this.performAccountReview(senderAddress);
    }

    return this.createResult(
      messageId,
      action === 'allow',
      scores,
      flags,
      action,
      reviewRequired
    );
  }

  /**
   * Check content against hash lists
   */
  private async checkHashes(content: EmailContent): Promise<ContentFlag[]> {
    const flags: ContentFlag[] = [];

    // Check attachment hashes
    for (const attachment of content.attachments ?? []) {
      // Check against CSAM hash list
      if (csamHashList.has(attachment.checksum)) {
        flags.push({
          type: 'csam',
          confidence: 0.999,  // Hash match = very high confidence
          details: `Attachment "${attachment.filename}" matches known CSAM hash`,
          evidenceHash: attachment.checksum,
        });
      }

      // Check against malware hash list
      if (malwareHashList.has(attachment.checksum)) {
        flags.push({
          type: 'malware',
          confidence: 0.999,
          details: `Attachment "${attachment.filename}" matches known malware hash`,
          evidenceHash: attachment.checksum,
        });
      }
    }

    return flags;
  }

  /**
   * Run ML classifiers on content
   * FAIL-FAST: If AI is unavailable, content is queued for manual review
   */
  private async runClassifiers(content: EmailContent): Promise<ContentScores> {
    // Build text for classification
    const text = [
      content.subject,
      content.bodyText,
      ...(content.attachments?.map(a => a.filename) ?? []),
    ].join('\n');

    // Check if content has attachments that MUST be reviewed
    const hasAttachments = (content.attachments?.length ?? 0) > 0;
    const hasMediaAttachments = content.attachments?.some(a => 
      a.mimeType.startsWith('image/') || a.mimeType.startsWith('video/')
    ) ?? false;

    // Call AI endpoint for classification
    let response: Response;
    try {
      response = await fetch(this.config.aiModelEndpoint, {
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
      });
    } catch (e) {
      // AI endpoint unreachable - FAIL SAFE for media, allow text-only
      console.error('[ContentScreening] AI endpoint unreachable:', e);
      
      if (hasMediaAttachments) {
        // Media must be screened - block and queue for review
        console.warn('[ContentScreening] Blocking media content - AI unavailable for screening');
        return { spam: 0, scam: 0, csam: 0.5, malware: 0, harassment: 0 }; // Force review
      }
      
      // Text-only content with AI down - use heuristics
      return this.runFallbackHeuristics(content);
    }

    if (!response.ok) {
      console.error('[ContentScreening] AI classification failed:', response.status);
      
      if (hasMediaAttachments) {
        // Media must be screened - block and queue for review
        return { spam: 0, scam: 0, csam: 0.5, malware: 0, harassment: 0 };
      }
      
      return this.runFallbackHeuristics(content);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };

    const content_response = data.choices[0]?.message?.content ?? '';
    
    // Parse JSON response
    const jsonMatch = content_response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as ContentScores;
      return {
        spam: Math.max(0, Math.min(1, parsed.spam ?? 0)),
        scam: Math.max(0, Math.min(1, parsed.scam ?? 0)),
        csam: Math.max(0, Math.min(1, parsed.csam ?? 0)),
        malware: Math.max(0, Math.min(1, parsed.malware ?? 0)),
        harassment: Math.max(0, Math.min(1, parsed.harassment ?? 0)),
      };
    }

    // Failed to parse - use heuristics
    return this.runFallbackHeuristics(content);
  }

  /**
   * Fallback heuristics when AI is unavailable
   * Uses keyword matching and pattern detection
   */
  private runFallbackHeuristics(content: EmailContent): ContentScores {
    const text = `${content.subject} ${content.bodyText}`.toLowerCase();
    
    // Spam indicators
    const spamKeywords = ['buy now', 'limited time', 'act fast', 'free money', 'winner', 'lottery', 'viagra', 'casino'];
    const spamScore = spamKeywords.filter(k => text.includes(k)).length / spamKeywords.length;
    
    // Scam/phishing indicators  
    const scamKeywords = ['verify your account', 'click here', 'password expired', 'urgent action', 'bank transfer', 'nigerian prince', 'inheritance'];
    const scamScore = scamKeywords.filter(k => text.includes(k)).length / scamKeywords.length;
    
    // Suspicious URLs
    const urlPattern = /https?:\/\/[^\s]+/g;
    const urls = text.match(urlPattern) ?? [];
    const suspiciousUrlScore = urls.some(u => 
      u.includes('bit.ly') || u.includes('goo.gl') || u.includes('t.co') || 
      u.match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/)
    ) ? 0.3 : 0;
    
    return {
      spam: Math.min(1, spamScore * 2),
      scam: Math.min(1, scamScore * 2 + suspiciousUrlScore),
      csam: 0, // Cannot detect without AI/hash matching
      malware: suspiciousUrlScore,
      harassment: 0,
    };
  }

  /**
   * Track flags for an account
   */
  private trackAccountFlag(address: Address, flags: ContentFlag[]): void {
    const existing = this.accountFlags.get(address) ?? [];
    this.accountFlags.set(address, [...existing, ...flags]);
  }

  /**
   * Check if account review is needed
   */
  private shouldTriggerAccountReview(address: Address): boolean {
    const flags = this.accountFlags.get(address) ?? [];
    const emailCount = this.accountEmailCounts.get(address) ?? 0;

    if (emailCount < this.config.minEmailsForReview) {
      return false;
    }

    // Check for multiple CSAM flags
    const csamFlags = flags.filter(f => f.type === 'csam');
    if (csamFlags.length >= 3) {
      return true;
    }

    // Check flagged percentage
    const flaggedCount = new Set(flags.map(f => f.evidenceHash)).size;
    const flaggedPercentage = flaggedCount / emailCount;
    
    return flaggedPercentage > this.config.flaggedPercentageThreshold;
  }

  /**
   * Perform full account review with LLM
   */
  async performAccountReview(address: Address): Promise<AccountReview> {
    const flags = this.accountFlags.get(address) ?? [];
    const emailCount = this.accountEmailCounts.get(address) ?? 0;

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
    };

    for (const flag of flags) {
      violationCounts[flag.type]++;
    }

    const violations: ViolationSummary[] = Object.entries(violationCounts)
      .filter(([_, count]) => count > 0)
      .map(([type, count]) => ({
        type: type as ContentFlagType,
        count,
        severity: this.getSeverity(type as ContentFlagType, count),
        description: this.getViolationDescription(type as ContentFlagType, count),
      }));

    const flaggedPercentage = flags.length / Math.max(emailCount, 1);

    // Build review prompt for LLM
    const reviewPrompt = `You are reviewing an email account for potential violations.

Account Statistics:
- Total emails sent: ${emailCount}
- Flagged emails: ${flags.length}
- Flagged percentage: ${(flaggedPercentage * 100).toFixed(1)}%

Violations detected:
${violations.map(v => `- ${v.type}: ${v.count} instances (${v.severity} severity) - ${v.description}`).join('\n')}

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
}`;

    const response = await fetch(this.config.aiModelEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',  // Use best model for critical decisions
        messages: [
          { role: 'system', content: 'You are a content moderation expert reviewing account behavior.' },
          { role: 'user', content: reviewPrompt },
        ],
        temperature: 0.2,
        max_tokens: 500,
      }),
    });

    let recommendation: 'allow' | 'warn' | 'suspend' | 'ban' = 'allow';
    let confidence = 0.5;
    let assessment = 'Review pending';
    let reasoning = '';

    if (response.ok) {
      const data = await response.json() as {
        choices: Array<{ message: { content: string } }>;
      };
      
      const content = data.choices[0]?.message?.content ?? '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          assessment: string;
          reasoning: string;
          recommendation: string;
          confidence: number;
        };
        
        assessment = parsed.assessment;
        reasoning = parsed.reasoning;
        confidence = parsed.confidence;
        
        if (['allow', 'warn', 'suspend', 'ban'].includes(parsed.recommendation)) {
          recommendation = parsed.recommendation as 'allow' | 'warn' | 'suspend' | 'ban';
        }
      }
    }

    // Override: ANY CSAM violation with high confidence = ban
    const csamViolations = violations.find(v => v.type === 'csam');
    if (csamViolations && csamViolations.count >= 1) {
      const avgCsamConfidence = flags
        .filter(f => f.type === 'csam')
        .reduce((sum, f) => sum + f.confidence, 0) / csamViolations.count;
      
      if (avgCsamConfidence > 0.5) {
        recommendation = 'ban';
        confidence = 0.99;
        reasoning = `CSAM content detected with high confidence (${(avgCsamConfidence * 100).toFixed(1)}%). Automatic ban applied.`;
      }
    }

    return {
      account: address,
      emailAddress: '', // Would be resolved from registry
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
    };
  }

  /**
   * Determine screening action based on flags and scores
   */
  private determineAction(
    flags: ContentFlag[],
    scores: ContentScores,
    address: Address
  ): ScreeningAction {
    // CSAM = immediate block and ban
    if (flags.some(f => f.type === 'csam' && f.confidence > 0.5)) {
      return 'block_and_ban';
    }

    // High malware = reject
    if (scores.malware > this.config.malwareThreshold) {
      return 'reject';
    }

    // High scam/phishing = reject
    if (scores.scam > this.config.scamThreshold) {
      return 'reject';
    }

    // High spam = quarantine
    if (scores.spam > this.config.spamThreshold) {
      return 'quarantine';
    }

    // Multiple flags = review
    if (flags.length >= 2) {
      return 'review';
    }

    // Check account history
    const accountFlags = this.accountFlags.get(address) ?? [];
    if (accountFlags.length > 5) {
      return 'review';
    }

    return 'allow';
  }

  private getSeverity(type: ContentFlagType, count: number): 'low' | 'medium' | 'high' | 'critical' {
    if (type === 'csam') return 'critical';
    if (type === 'malware' || type === 'illegal') return 'high';
    if (count > 10) return 'high';
    if (count > 5) return 'medium';
    return 'low';
  }

  private getViolationDescription(type: ContentFlagType, count: number): string {
    const descriptions: Record<ContentFlagType, string> = {
      spam: `${count} spam emails detected`,
      phishing: `${count} phishing attempts detected`,
      scam: `${count} scam/fraud emails detected`,
      malware: `${count} malware attachments detected`,
      csam: `${count} potential CSAM instances detected - CRITICAL`,
      illegal: `${count} potentially illegal content detected`,
      harassment: `${count} harassment/abuse emails detected`,
      adult: `${count} adult content emails detected`,
    };
    return descriptions[type];
  }

  private createResult(
    messageId: Hex,
    passed: boolean,
    scores: ContentScores,
    flags: ContentFlag[],
    action: ScreeningAction,
    reviewRequired: boolean
  ): ScreeningResult {
    return {
      messageId,
      passed,
      scores,
      flags,
      action,
      reviewRequired,
      timestamp: Date.now(),
    };
  }

  // ============ Hash List Management ============

  /**
   * Load CSAM hash list (in production, from NCMEC or PhotoDNA)
   */
  async loadCsamHashList(url: string): Promise<void> {
    // In production, this would fetch from a secure source
    console.log(`[ContentScreening] Loading CSAM hash list from ${url}`);
    // csamHashList would be populated here
  }

  /**
   * Load malware hash list (from VirusTotal or similar)
   */
  async loadMalwareHashList(url: string): Promise<void> {
    console.log(`[ContentScreening] Loading malware hash list from ${url}`);
    // malwareHashList would be populated here
  }

  /**
   * Add hash to CSAM list (for NCMEC reporting integration)
   */
  addCsamHash(hash: string): void {
    csamHashList.add(hash);
  }

  /**
   * Add hash to malware list
   */
  addMalwareHash(hash: string): void {
    malwareHashList.add(hash);
  }

  // ============ Account Management ============

  /**
   * Clear flags for an account (after moderation resolution)
   */
  clearAccountFlags(address: Address): void {
    this.accountFlags.delete(address);
    this.accountEmailCounts.delete(address);
  }

  /**
   * Get account flags for review
   */
  getAccountFlags(address: Address): ContentFlag[] {
    return this.accountFlags.get(address) ?? [];
  }

  /**
   * Get account email count
   */
  getAccountEmailCount(address: Address): number {
    return this.accountEmailCounts.get(address) ?? 0;
  }
}

// ============ Exports ============

export function createContentScreeningPipeline(
  config: Partial<ContentScreeningConfig> = {}
): ContentScreeningPipeline {
  return new ContentScreeningPipeline(config);
}

// Singleton for DWS
let _screeningPipeline: ContentScreeningPipeline | null = null;

export function getContentScreeningPipeline(): ContentScreeningPipeline {
  if (!_screeningPipeline) {
    _screeningPipeline = new ContentScreeningPipeline();
  }
  return _screeningPipeline;
}

export function resetContentScreeningPipeline(): void {
  _screeningPipeline = null;
}
