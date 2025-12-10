/**
 * Content Moderation System for Jeju Compute Marketplace
 *
 * Provides multi-layer content filtering for inference requests:
 * 1. Fast local filters (expletives, patterns)
 * 2. AI-based classification via inference registry
 * 3. Incident recording for training data
 * 4. Integration with governance/ban system
 *
 * All moderation incidents are recorded for:
 * - Evidence in dispute resolution
 * - Training data for improving filters
 * - Analytics and reporting
 */

import type { Address } from 'viem';

// ============================================================================
// Types
// ============================================================================

/** Content categories that can be flagged */
export const ContentCategoryEnum = {
  SAFE: 0,
  PROFANITY: 1,
  HATE_SPEECH: 2,
  HARASSMENT: 3,
  SEXUAL_CONTENT: 4,
  VIOLENCE: 5,
  SELF_HARM: 6,
  ILLEGAL_ACTIVITY: 7,
  CHILD_SAFETY: 8,
  SPAM: 9,
  MISINFORMATION: 10,
  PII_EXPOSURE: 11,
  COPYRIGHT: 12,
} as const;

export type ContentCategory = typeof ContentCategoryEnum[keyof typeof ContentCategoryEnum];

/** Severity levels for flagged content */
export const SeverityEnum = {
  NONE: 0,
  LOW: 1,      // Warning only, allow through
  MEDIUM: 2,  // Block but don't escalate
  HIGH: 3,    // Block and flag for review
  CRITICAL: 4, // Block, flag, and potentially auto-ban
} as const;

export type Severity = typeof SeverityEnum[keyof typeof SeverityEnum];

/** Source of the moderation decision */
export const ModerationSourceEnum = {
  LOCAL_FILTER: 0,     // Expletives/pattern matching
  AI_CLASSIFIER: 1,    // AI-based classification
  HUMAN_REVIEW: 2,     // Manual moderator review
  USER_REPORT: 3,      // Community report
  AUTO_POLICY: 4,      // Automated policy enforcement
} as const;

export type ModerationSource = typeof ModerationSourceEnum[keyof typeof ModerationSourceEnum];

/** Single moderation flag */
export interface ModerationFlag {
  category: ContentCategory;
  severity: Severity;
  confidence: number;  // 0-100
  source: ModerationSource;
  matchedTerms?: string[];  // What triggered the flag
  explanation?: string;     // AI explanation
}

/** Result of content moderation check */
export interface ModerationResult {
  allowed: boolean;
  flags: ModerationFlag[];
  highestSeverity: Severity;
  processingTimeMs: number;
  incidentId?: string;  // Set if incident was recorded
}

/** Moderation incident record (for database storage) */
export interface ModerationIncident {
  id: string;
  timestamp: number;
  
  // Request context
  userAddress: Address;
  providerAddress?: Address;
  modelId: string;
  requestType: 'inference' | 'image' | 'video' | 'audio';
  
  // Content
  inputContent: string;
  inputHash: string;  // SHA256 hash for deduplication
  outputContent?: string;
  
  // Moderation result
  flags: ModerationFlag[];
  blocked: boolean;
  highestSeverity: Severity;
  
  // Review status
  reviewed: boolean;
  reviewedBy?: Address;
  reviewedAt?: number;
  reviewOutcome?: 'confirmed' | 'false_positive' | 'escalated';
  reviewNotes?: string;
  
  // Training data
  useForTraining: boolean;
  trainingLabel?: ContentCategory;
}

/** Configuration for content moderation */
export interface ContentModerationConfig {
  // Feature flags
  enableLocalFilter: boolean;
  enableAIClassifier: boolean;
  recordIncidents: boolean;
  
  // Thresholds
  minConfidenceToFlag: number;     // 0-100, default 70
  minConfidenceToBlock: number;    // 0-100, default 85
  
  // AI classifier endpoint (from inference registry)
  aiClassifierEndpoint?: string;
  aiClassifierModel?: string;
  
  // Incident storage callback
  onIncident?: (incident: ModerationIncident) => Promise<void>;
  
  // Custom word lists
  customBlockedTerms?: string[];
  customAllowedTerms?: string[];  // Override blocked terms
}

// ============================================================================
// AI Classifier Response Types
// ============================================================================

interface AIClassifierResponse {
  choices: AIClassifierChoice[];
}

interface AIClassifierChoice {
  message: {
    content: string;
  };
}

interface AIClassifierParsedResponse {
  safe: boolean;
  categories?: AIClassifierCategory[];
}

interface AIClassifierCategory {
  category: string;
  confidence: number;
  explanation?: string;
}

// ============================================================================
// Expletives Filter (Local)
// ============================================================================

/** Terms that indicate high severity regardless of context */
const HIGH_SEVERITY_TERMS = [
  'child porn', 'cp', 'pedo', 'loli', 'minor nude',
  'bomb making', 'how to make explosives',
  'suicide method', 'kill myself',
];

/** Category mappings for pattern matches */
const CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: ContentCategory; severity: Severity }> = [
  // Profanity - low severity
  { pattern: /\b(f+u+c+k+|sh+i+t+|damn|crap)\b/gi, category: ContentCategoryEnum.PROFANITY, severity: SeverityEnum.LOW },
  
  // Hate speech - high severity
  { pattern: /\b(n+i+g+g+[ae]+r?|f+a+g+g?[oi]t?|r+e+t+a+r+d+)\b/gi, category: ContentCategoryEnum.HATE_SPEECH, severity: SeverityEnum.HIGH },
  { pattern: /\b(k+[yi]+k+e+|sp+i+c+|ch+i+n+k+)\b/gi, category: ContentCategoryEnum.HATE_SPEECH, severity: SeverityEnum.HIGH },
  
  // Violence - medium to high
  { pattern: /\b(kill|murder|assassinate)\s+(you|them|him|her)\b/gi, category: ContentCategoryEnum.VIOLENCE, severity: SeverityEnum.HIGH },
  { pattern: /\bhow\s+to\s+(make|build)\s+.*bomb\b/gi, category: ContentCategoryEnum.ILLEGAL_ACTIVITY, severity: SeverityEnum.CRITICAL },
  
  // Self-harm - high (trigger support resources)
  { pattern: /\b(suicide|kill\s+myself|end\s+my\s+life)\b/gi, category: ContentCategoryEnum.SELF_HARM, severity: SeverityEnum.HIGH },
  
  // Child safety - critical (immediate block)
  { pattern: /\b(child\s+porn|cp|pedo|loli)\b/gi, category: ContentCategoryEnum.CHILD_SAFETY, severity: SeverityEnum.CRITICAL },
  { pattern: /\bunderage\s+(sex|nude|porn)/gi, category: ContentCategoryEnum.CHILD_SAFETY, severity: SeverityEnum.CRITICAL },
  
  // Illegal activity - high
  { pattern: /\b(buy|sell)\s+(drugs|cocaine|heroin|meth|fentanyl)/gi, category: ContentCategoryEnum.ILLEGAL_ACTIVITY, severity: SeverityEnum.HIGH },
  { pattern: /\bhow\s+to\s+hack\s+(bank|account)/gi, category: ContentCategoryEnum.ILLEGAL_ACTIVITY, severity: SeverityEnum.MEDIUM },
  
  // PII exposure - medium
  { pattern: /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g, category: ContentCategoryEnum.PII_EXPOSURE, severity: SeverityEnum.MEDIUM }, // SSN pattern
  { pattern: /\b\d{16}\b/g, category: ContentCategoryEnum.PII_EXPOSURE, severity: SeverityEnum.MEDIUM }, // Credit card
];

// ============================================================================
// Content Moderator
// ============================================================================

export class ContentModerator {
  private config: ContentModerationConfig;
  private customBlockedSet: Set<string>;
  private customAllowedSet: Set<string>;

  constructor(config: Partial<ContentModerationConfig> = {}) {
    this.config = {
      enableLocalFilter: true,
      enableAIClassifier: true,
      recordIncidents: true,
      minConfidenceToFlag: 70,
      minConfidenceToBlock: 85,
      ...config,
    };

    this.customBlockedSet = new Set(
      (config.customBlockedTerms ?? []).map(t => t.toLowerCase())
    );
    this.customAllowedSet = new Set(
      (config.customAllowedTerms ?? []).map(t => t.toLowerCase())
    );
  }

  /**
   * Check content for policy violations
   */
  async moderate(
    content: string,
    context: {
      userAddress: Address;
      providerAddress?: Address;
      modelId: string;
      requestType: 'inference' | 'image' | 'video' | 'audio';
    }
  ): Promise<ModerationResult> {
    const startTime = Date.now();
    const flags: ModerationFlag[] = [];

    // Layer 1: Local pattern matching (fast)
    if (this.config.enableLocalFilter) {
      const localFlags = this.runLocalFilter(content);
      flags.push(...localFlags);
    }

    // Layer 2: AI classification (slower but more accurate)
    if (this.config.enableAIClassifier && this.config.aiClassifierEndpoint) {
      const aiFlags = await this.runAIClassifier(content);
      flags.push(...aiFlags);
    }

    // Determine highest severity
    let highestSeverity: Severity = SeverityEnum.NONE;
    for (const flag of flags) {
      if (flag.severity > highestSeverity) {
        highestSeverity = flag.severity;
      }
    }

    // Determine if content should be blocked
    const shouldBlock = flags.some(
      f => f.confidence >= this.config.minConfidenceToBlock &&
           f.severity >= SeverityEnum.MEDIUM
    );

    const result: ModerationResult = {
      allowed: !shouldBlock,
      flags,
      highestSeverity,
      processingTimeMs: Date.now() - startTime,
    };

    // Record incident if configured and content was flagged
    if (this.config.recordIncidents && flags.length > 0) {
      const incident = await this.recordIncident(content, context, result);
      result.incidentId = incident.id;
    }

    return result;
  }

  /**
   * Run local pattern-based filtering
   */
  private runLocalFilter(content: string): ModerationFlag[] {
    const flags: ModerationFlag[] = [];
    const contentLower = content.toLowerCase();

    // Check custom blocked terms
    for (const term of this.customBlockedSet) {
      if (contentLower.includes(term) && !this.customAllowedSet.has(term)) {
        flags.push({
          category: ContentCategoryEnum.PROFANITY,
          severity: SeverityEnum.MEDIUM,
          confidence: 100,
          source: ModerationSourceEnum.LOCAL_FILTER,
          matchedTerms: [term],
        });
      }
    }

    // Check category patterns
    for (const { pattern, category, severity } of CATEGORY_PATTERNS) {
      const matches = content.match(pattern);
      if (matches) {
        // Check if any matched term is in the allowed list
        const filteredMatches = matches.filter(
          m => !this.customAllowedSet.has(m.toLowerCase())
        );
        
        if (filteredMatches.length > 0) {
          flags.push({
            category,
            severity,
            confidence: 95, // High confidence for exact matches
            source: ModerationSourceEnum.LOCAL_FILTER,
            matchedTerms: filteredMatches,
          });
        }
      }
    }

    // Check high severity terms (critical - always flag)
    for (const term of HIGH_SEVERITY_TERMS) {
      if (contentLower.includes(term.toLowerCase())) {
        flags.push({
          category: ContentCategoryEnum.ILLEGAL_ACTIVITY,
          severity: SeverityEnum.CRITICAL,
          confidence: 100,
          source: ModerationSourceEnum.LOCAL_FILTER,
          matchedTerms: [term],
        });
      }
    }

    // Deduplicate flags by category
    return this.deduplicateFlags(flags);
  }

  /**
   * Run AI-based content classification
   */
  private async runAIClassifier(content: string): Promise<ModerationFlag[]> {
    if (!this.config.aiClassifierEndpoint) {
      return [];
    }

    const prompt = `You are a content moderation system. Analyze the following text and respond with a JSON object containing:
- "safe": boolean (true if content is safe)
- "categories": array of objects with:
  - "category": one of ["profanity", "hate_speech", "harassment", "sexual_content", "violence", "self_harm", "illegal_activity", "child_safety", "spam", "misinformation", "pii_exposure", "copyright"]
  - "confidence": number 0-100
  - "explanation": brief explanation

Only include categories with confidence > 50. Be conservative - when in doubt, flag for review.

Text to analyze:
"""
${content.slice(0, 2000)}
"""

Respond with valid JSON only:`;

    const response = await fetch(`${this.config.aiClassifierEndpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.aiClassifierModel ?? 'moderation',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);

    if (!response?.ok) {
      return [];
    }

    const data = await response.json().catch(() => null) as AIClassifierResponse | null;
    if (!data) return [];

    const aiResponse = data.choices[0]?.message?.content ?? '';
    
    // Parse JSON response
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = this.parseAIResponse(jsonMatch[0]);
    if (!parsed || parsed.safe || !parsed.categories) {
      return [];
    }

    return parsed.categories
      .filter(c => c.confidence >= this.config.minConfidenceToFlag)
      .map(c => ({
        category: this.mapCategoryName(c.category),
        severity: this.inferSeverity(c.category, c.confidence),
        confidence: c.confidence,
        source: ModerationSourceEnum.AI_CLASSIFIER,
        explanation: c.explanation,
      }));
  }

  /**
   * Parse AI classifier JSON response safely
   */
  private parseAIResponse(json: string): AIClassifierParsedResponse | null {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    
    if (typeof parsed.safe !== 'boolean') {
      return null;
    }

    const result: AIClassifierParsedResponse = {
      safe: parsed.safe,
    };

    if (Array.isArray(parsed.categories)) {
      result.categories = parsed.categories
        .filter((c): c is Record<string, unknown> => 
          typeof c === 'object' && c !== null &&
          typeof (c as Record<string, unknown>).category === 'string' &&
          typeof (c as Record<string, unknown>).confidence === 'number'
        )
        .map(c => ({
          category: c.category as string,
          confidence: c.confidence as number,
          explanation: typeof c.explanation === 'string' ? c.explanation : undefined,
        }));
    }

    return result;
  }

  /**
   * Map category name string to enum value
   */
  private mapCategoryName(name: string): ContentCategory {
    const mapping: Record<string, ContentCategory> = {
      'profanity': ContentCategoryEnum.PROFANITY,
      'hate_speech': ContentCategoryEnum.HATE_SPEECH,
      'harassment': ContentCategoryEnum.HARASSMENT,
      'sexual_content': ContentCategoryEnum.SEXUAL_CONTENT,
      'violence': ContentCategoryEnum.VIOLENCE,
      'self_harm': ContentCategoryEnum.SELF_HARM,
      'illegal_activity': ContentCategoryEnum.ILLEGAL_ACTIVITY,
      'child_safety': ContentCategoryEnum.CHILD_SAFETY,
      'spam': ContentCategoryEnum.SPAM,
      'misinformation': ContentCategoryEnum.MISINFORMATION,
      'pii_exposure': ContentCategoryEnum.PII_EXPOSURE,
      'copyright': ContentCategoryEnum.COPYRIGHT,
    };
    return mapping[name.toLowerCase()] ?? ContentCategoryEnum.SAFE;
  }

  /**
   * Infer severity based on category and confidence
   */
  private inferSeverity(category: string, confidence: number): Severity {
    // Critical categories always high/critical
    if (['child_safety', 'illegal_activity'].includes(category.toLowerCase())) {
      return confidence > 90 ? SeverityEnum.CRITICAL : SeverityEnum.HIGH;
    }
    
    // High severity categories
    if (['hate_speech', 'violence', 'self_harm'].includes(category.toLowerCase())) {
      return confidence > 85 ? SeverityEnum.HIGH : SeverityEnum.MEDIUM;
    }
    
    // Medium severity
    if (['harassment', 'sexual_content'].includes(category.toLowerCase())) {
      return confidence > 80 ? SeverityEnum.MEDIUM : SeverityEnum.LOW;
    }
    
    // Low severity (profanity, spam, etc.)
    return confidence > 90 ? SeverityEnum.MEDIUM : SeverityEnum.LOW;
  }

  /**
   * Deduplicate flags by keeping highest severity per category
   */
  private deduplicateFlags(flags: ModerationFlag[]): ModerationFlag[] {
    const byCategory = new Map<ContentCategory, ModerationFlag>();
    
    for (const flag of flags) {
      const existing = byCategory.get(flag.category);
      if (!existing || flag.severity > existing.severity || 
          (flag.severity === existing.severity && flag.confidence > existing.confidence)) {
        byCategory.set(flag.category, flag);
      }
    }
    
    return Array.from(byCategory.values());
  }

  /**
   * Record moderation incident for training and evidence
   */
  private async recordIncident(
    content: string,
    context: {
      userAddress: Address;
      providerAddress?: Address;
      modelId: string;
      requestType: 'inference' | 'image' | 'video' | 'audio';
    },
    result: ModerationResult
  ): Promise<ModerationIncident> {
    const incident: ModerationIncident = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      
      userAddress: context.userAddress,
      providerAddress: context.providerAddress,
      modelId: context.modelId,
      requestType: context.requestType,
      
      inputContent: content,
      inputHash: await this.hashContent(content),
      
      flags: result.flags,
      blocked: !result.allowed,
      highestSeverity: result.highestSeverity,
      
      reviewed: false,
      useForTraining: result.highestSeverity >= SeverityEnum.MEDIUM,
    };

    // Call incident callback if configured
    if (this.config.onIncident) {
      await this.config.onIncident(incident);
    }

    return incident;
  }

  /**
   * Hash content for deduplication
   */
  private async hashContent(content: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Update incident after human review
   */
  async reviewIncident(
    incident: ModerationIncident,
    review: {
      reviewedBy: Address;
      outcome: 'confirmed' | 'false_positive' | 'escalated';
      notes?: string;
      useForTraining?: boolean;
      trainingLabel?: ContentCategory;
    }
  ): Promise<ModerationIncident> {
    return {
      ...incident,
      reviewed: true,
      reviewedBy: review.reviewedBy,
      reviewedAt: Date.now(),
      reviewOutcome: review.outcome,
      reviewNotes: review.notes,
      useForTraining: review.useForTraining ?? incident.useForTraining,
      trainingLabel: review.trainingLabel,
    };
  }

  /**
   * Get category name from enum value
   */
  static getCategoryName(category: ContentCategory): string {
    const names: Record<ContentCategory, string> = {
      [ContentCategoryEnum.SAFE]: 'Safe',
      [ContentCategoryEnum.PROFANITY]: 'Profanity',
      [ContentCategoryEnum.HATE_SPEECH]: 'Hate Speech',
      [ContentCategoryEnum.HARASSMENT]: 'Harassment',
      [ContentCategoryEnum.SEXUAL_CONTENT]: 'Sexual Content',
      [ContentCategoryEnum.VIOLENCE]: 'Violence',
      [ContentCategoryEnum.SELF_HARM]: 'Self-Harm',
      [ContentCategoryEnum.ILLEGAL_ACTIVITY]: 'Illegal Activity',
      [ContentCategoryEnum.CHILD_SAFETY]: 'Child Safety',
      [ContentCategoryEnum.SPAM]: 'Spam',
      [ContentCategoryEnum.MISINFORMATION]: 'Misinformation',
      [ContentCategoryEnum.PII_EXPOSURE]: 'PII Exposure',
      [ContentCategoryEnum.COPYRIGHT]: 'Copyright',
    };
    return names[category] ?? 'Unknown';
  }

  /**
   * Get severity name from enum value
   */
  static getSeverityName(severity: Severity): string {
    const names: Record<Severity, string> = {
      [SeverityEnum.NONE]: 'None',
      [SeverityEnum.LOW]: 'Low',
      [SeverityEnum.MEDIUM]: 'Medium',
      [SeverityEnum.HIGH]: 'High',
      [SeverityEnum.CRITICAL]: 'Critical',
    };
    return names[severity] ?? 'Unknown';
  }
}

// ============================================================================
// Incident Storage Interface
// ============================================================================

/**
 * Interface for incident storage backends
 */
export interface IncidentStorage {
  save(incident: ModerationIncident): Promise<void>;
  get(id: string): Promise<ModerationIncident | null>;
  getByUser(userAddress: Address, limit?: number): Promise<ModerationIncident[]>;
  getUnreviewed(limit?: number): Promise<ModerationIncident[]>;
  getForTraining(category?: ContentCategory, limit?: number): Promise<ModerationIncident[]>;
  update(incident: ModerationIncident): Promise<void>;
}

/**
 * In-memory incident storage (for development/testing)
 */
export class MemoryIncidentStorage implements IncidentStorage {
  private incidents: Map<string, ModerationIncident> = new Map();

  async save(incident: ModerationIncident): Promise<void> {
    this.incidents.set(incident.id, incident);
  }

  async get(id: string): Promise<ModerationIncident | null> {
    return this.incidents.get(id) ?? null;
  }

  async getByUser(userAddress: Address, limit = 100): Promise<ModerationIncident[]> {
    return Array.from(this.incidents.values())
      .filter(i => i.userAddress === userAddress)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  async getUnreviewed(limit = 100): Promise<ModerationIncident[]> {
    return Array.from(this.incidents.values())
      .filter(i => !i.reviewed)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  async getForTraining(category?: ContentCategory, limit = 1000): Promise<ModerationIncident[]> {
    return Array.from(this.incidents.values())
      .filter(i => i.useForTraining && i.reviewed)
      .filter(i => category === undefined || i.trainingLabel === category)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  async update(incident: ModerationIncident): Promise<void> {
    this.incidents.set(incident.id, incident);
  }

  // For testing
  clear(): void {
    this.incidents.clear();
  }

  size(): number {
    return this.incidents.size;
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a content moderator with default configuration
 */
export function createContentModerator(
  config?: Partial<ContentModerationConfig>
): ContentModerator {
  return new ContentModerator(config);
}

/**
 * Create a content moderator with incident storage
 */
export function createModerationSystem(config: {
  storage: IncidentStorage;
  aiEndpoint?: string;
  aiModel?: string;
  customBlockedTerms?: string[];
}): ContentModerator {
  return new ContentModerator({
    enableLocalFilter: true,
    enableAIClassifier: !!config.aiEndpoint,
    recordIncidents: true,
    aiClassifierEndpoint: config.aiEndpoint,
    aiClassifierModel: config.aiModel,
    customBlockedTerms: config.customBlockedTerms,
    onIncident: async (incident) => {
      await config.storage.save(incident);
    },
  });
}
