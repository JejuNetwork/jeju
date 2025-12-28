/**
 * Deployment Content Moderation
 *
 * AI-powered content moderation for container/worker deployments:
 * - Scans container images for prohibited content
 * - Analyzes code for malware/cryptominers
 * - Checks environment variables for sensitive data leaks
 * - Validates against cloud provider ToS compliance
 * - Implements graduated trust based on user reputation
 *
 * Architecture:
 * 1. Pre-deployment scan (blocking)
 * 2. Runtime monitoring (async)
 * 3. Periodic re-verification
 */

import { getDWSComputeUrl, getIpfsGatewayUrl } from '@jejunetwork/config'
import { type EQLiteClient, getEQLite } from '@jejunetwork/db'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes } from 'viem'
import { z } from 'zod'

// ============ Types ============

export type ModerationCategory =
  | 'clean' // No issues found
  | 'suspicious' // Needs manual review
  | 'malware' // Contains malicious code
  | 'cryptominer' // Cryptocurrency mining code
  | 'phishing' // Phishing/scam content
  | 'csam' // Child exploitation content (immediate block)
  | 'copyright' // Copyright infringement
  | 'tos_violation' // Violates cloud provider ToS
  | 'data_leak' // Leaks sensitive data

export type ModerationAction =
  | 'allow' // Proceed with deployment
  | 'review' // Queue for manual review
  | 'block' // Reject deployment
  | 'quarantine' // Allow but monitor closely
  | 'report' // Report to authorities (CSAM)

export type ReputationTier =
  | 'untrusted' // New accounts, full scanning
  | 'low' // Some history, most scanning
  | 'medium' // Established, reduced scanning
  | 'high' // Trusted, minimal scanning
  | 'verified' // KYC/verified, fast-track

export interface DeploymentScanRequest {
  deploymentId: string
  owner: Address
  type: 'container' | 'worker' | 'function'
  image?: string // Container image reference
  codeCid?: string // IPFS CID of code
  entrypoint?: string
  environment?: Record<string, string>
  secrets?: string[] // Secret names (not values)
  resources?: {
    cpuCores: number
    memoryMb: number
    gpuType?: string
  }
}

export interface ModerationResult {
  deploymentId: string
  timestamp: number
  action: ModerationAction
  categories: Array<{
    category: ModerationCategory
    confidence: number
    details: string
  }>
  overallScore: number // 0-100, higher = safer
  scanDurationMs: number
  attestationHash: Hex
  reviewRequired: boolean
  blockedReasons: string[]
}

export interface DeploymentReputationData {
  address: Address
  tier: ReputationTier
  totalDeployments: number
  successfulDeployments: number
  blockedDeployments: number
  reviewedDeployments: number
  lastDeploymentAt: number
  reputationScore: number // 0-10000 basis points
  linkedIdentity?: {
    type: 'github' | 'google' | 'twitter'
    verifiedAt: number
    accountAge: number
  }
}

// ============ Schemas ============

const AIClassificationResponseSchema = z.object({
  classifications: z.array(
    z.object({
      category: z.string(),
      confidence: z.number().min(0).max(1),
      reasoning: z.string(),
    }),
  ),
  overallAssessment: z.string(),
  recommendedAction: z.enum([
    'allow',
    'review',
    'block',
    'quarantine',
    'report',
  ]),
  riskScore: z.number().min(0).max(100),
})

const ChatCompletionResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string(),
      }),
    }),
  ),
})

// ============ Database ============

const MODERATION_DATABASE_ID = 'dws-deployment-moderation'
let eqliteClient: EQLiteClient | null = null

async function getEQLiteClient(): Promise<EQLiteClient> {
  if (!eqliteClient) {
    eqliteClient = getEQLite()
    await ensureModerationTables()
  }
  return eqliteClient
}

async function ensureModerationTables(): Promise<void> {
  if (!eqliteClient) return

  const tables = [
    `CREATE TABLE IF NOT EXISTS deployment_scans (
      id TEXT PRIMARY KEY,
      deployment_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      scan_type TEXT NOT NULL,
      action TEXT NOT NULL,
      overall_score INTEGER NOT NULL,
      categories TEXT NOT NULL,
      blocked_reasons TEXT,
      attestation_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS deployment_reputation (
      address TEXT PRIMARY KEY,
      tier TEXT NOT NULL DEFAULT 'untrusted',
      total_deployments INTEGER DEFAULT 0,
      successful_deployments INTEGER DEFAULT 0,
      blocked_deployments INTEGER DEFAULT 0,
      reviewed_deployments INTEGER DEFAULT 0,
      reputation_score INTEGER DEFAULT 0,
      last_deployment_at INTEGER,
      linked_identity_type TEXT,
      linked_identity_verified_at INTEGER,
      linked_identity_account_age INTEGER,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS moderation_queue (
      id TEXT PRIMARY KEY,
      deployment_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      reason TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'pending',
      assigned_to TEXT,
      created_at INTEGER NOT NULL,
      resolved_at INTEGER
    )`,
  ]

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_deployment_scans_owner ON deployment_scans(owner)',
    'CREATE INDEX IF NOT EXISTS idx_deployment_scans_deployment ON deployment_scans(deployment_id)',
    'CREATE INDEX IF NOT EXISTS idx_moderation_queue_status ON moderation_queue(status)',
  ]

  for (const ddl of tables) {
    await eqliteClient.exec(ddl, [], MODERATION_DATABASE_ID)
  }

  for (const idx of indexes) {
    await eqliteClient.exec(idx, [], MODERATION_DATABASE_ID)
  }

  console.log('[DeploymentModeration] EQLite tables ensured')
}

// ============ Configuration ============

interface ModerationConfig {
  aiModelEndpoint: string
  aiModel: string
  enableImageScanning: boolean
  enableCodeScanning: boolean
  enableEnvScanning: boolean
  malwareThreshold: number
  cryptominerThreshold: number
  blockOnSuspicious: boolean
  quarantineUnverified: boolean
  maxCodeSizeBytes: number
  scanTimeoutMs: number
}

const DEFAULT_CONFIG: ModerationConfig = {
  aiModelEndpoint: `${getDWSComputeUrl()}/chat/completions`,
  aiModel: 'claude-sonnet-4-5',
  enableImageScanning: true,
  enableCodeScanning: true,
  enableEnvScanning: true,
  malwareThreshold: 0.7,
  cryptominerThreshold: 0.8,
  blockOnSuspicious: false,
  quarantineUnverified: true,
  maxCodeSizeBytes: 50 * 1024 * 1024, // 50MB
  scanTimeoutMs: 60000,
}

// ============ Known Patterns ============

// Malware/cryptominer signatures (simplified patterns)
const MALWARE_PATTERNS = [
  /eval\s*\(\s*atob\s*\(/gi, // Base64 encoded eval
  /document\.write\s*\(\s*unescape/gi, // Obfuscated document.write
  /new\s+Function\s*\(\s*['"][^'"]*['"]\.split/gi, // Obfuscated Function constructor
  /xmrig|monero|coinhive|cryptoloot|minero/gi, // Known cryptominer references
  /stratum\+tcp:\/\//gi, // Mining pool protocol
  /--donate-level|--threads|--cpu-priority/gi, // Mining CLI args
  /SHA256|KECCAK256.*while.*nonce/gi, // Mining loop patterns
]

// Environment variable patterns that might indicate data leaks
const SENSITIVE_ENV_PATTERNS = [
  /^(AWS|AZURE|GCP|GOOGLE)_.*_(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)/i,
  /^DATABASE_.*PASSWORD/i,
  /^(PRIVATE_KEY|SECRET_KEY|API_KEY|AUTH_TOKEN)$/i,
  /^STRIPE_.*KEY/i,
  /^TWILIO_.*TOKEN/i,
]

// Known bad container images
const BLOCKED_IMAGES = new Set([
  'coinhive/miner',
  'cryptominer/xmr',
  // Add more as identified
])

// ============ Main Service ============

export class DeploymentModerationService {
  private config: ModerationConfig

  constructor(config: Partial<ModerationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Scan a deployment before it goes live
   */
  async scanDeployment(
    request: DeploymentScanRequest,
  ): Promise<ModerationResult> {
    const startTime = Date.now()
    console.log(
      `[DeploymentModeration] Scanning deployment ${request.deploymentId} for ${request.owner}`,
    )

    const categories: ModerationResult['categories'] = []
    const blockedReasons: string[] = []

    // Get user reputation
    const reputation = await this.getReputation(request.owner)
    const skipDetailedScan =
      reputation.tier === 'verified' || reputation.tier === 'high'

    // 1. Check container image against blocklist
    if (request.image && this.config.enableImageScanning) {
      const imageResult = await this.scanContainerImage(
        request.image,
        skipDetailedScan,
      )
      categories.push(...imageResult.categories)
      blockedReasons.push(...imageResult.blockedReasons)
    }

    // 2. Scan code for malware/cryptominer patterns
    if (request.codeCid && this.config.enableCodeScanning) {
      const codeResult = await this.scanCode(request.codeCid, skipDetailedScan)
      categories.push(...codeResult.categories)
      blockedReasons.push(...codeResult.blockedReasons)
    }

    // 3. Check environment variables for sensitive data
    if (request.environment && this.config.enableEnvScanning) {
      const envResult = this.scanEnvironment(request.environment)
      categories.push(...envResult.categories)
      blockedReasons.push(...envResult.blockedReasons)
    }

    // 4. AI-powered deep analysis for suspicious or untrusted users
    if (
      !skipDetailedScan &&
      (reputation.tier === 'untrusted' ||
        reputation.tier === 'low' ||
        categories.some((c) => c.confidence > 0.5))
    ) {
      const aiResult = await this.runAIAnalysis(request)
      categories.push(...aiResult.categories)
      blockedReasons.push(...aiResult.blockedReasons)
    }

    // Calculate overall score and determine action
    const overallScore = this.calculateOverallScore(categories)
    const action = this.determineAction(categories, overallScore, reputation)
    const reviewRequired =
      action === 'review' ||
      (action === 'quarantine' && reputation.tier === 'untrusted')

    // Generate attestation hash
    const attestationData = {
      deploymentId: request.deploymentId,
      owner: request.owner,
      timestamp: startTime,
      action,
      overallScore,
      categories: categories.map((c) => c.category),
    }
    const attestationHash = keccak256(
      toBytes(JSON.stringify(attestationData)),
    ) as Hex

    const result: ModerationResult = {
      deploymentId: request.deploymentId,
      timestamp: startTime,
      action,
      categories,
      overallScore,
      scanDurationMs: Date.now() - startTime,
      attestationHash,
      reviewRequired,
      blockedReasons,
    }

    // Store scan result
    await this.storeScanResult(request, result)

    // Update user reputation
    await this.updateReputation(request.owner, result)

    // Queue for manual review if needed
    if (reviewRequired) {
      await this.queueForReview(request, result)
    }

    console.log(
      `[DeploymentModeration] Scan complete for ${request.deploymentId}: action=${action}, score=${overallScore}, duration=${result.scanDurationMs}ms`,
    )

    return result
  }

  /**
   * Get user reputation data
   */
  async getReputation(address: Address): Promise<DeploymentReputationData> {
    const client = await getEQLiteClient()
    const result = await client.query<{
      tier: string
      total_deployments: number
      successful_deployments: number
      blocked_deployments: number
      reviewed_deployments: number
      reputation_score: number
      last_deployment_at: number | null
      linked_identity_type: string | null
      linked_identity_verified_at: number | null
      linked_identity_account_age: number | null
    }>(
      'SELECT * FROM deployment_reputation WHERE address = ?',
      [address.toLowerCase()],
      MODERATION_DATABASE_ID,
    )

    if (result.rows.length === 0) {
      // New user - create default reputation
      return {
        address,
        tier: 'untrusted',
        totalDeployments: 0,
        successfulDeployments: 0,
        blockedDeployments: 0,
        reviewedDeployments: 0,
        lastDeploymentAt: 0,
        reputationScore: 0,
      }
    }

    const row = result.rows[0]
    return {
      address,
      tier: row.tier as ReputationTier,
      totalDeployments: row.total_deployments,
      successfulDeployments: row.successful_deployments,
      blockedDeployments: row.blocked_deployments,
      reviewedDeployments: row.reviewed_deployments,
      lastDeploymentAt: row.last_deployment_at ?? 0,
      reputationScore: row.reputation_score,
      linkedIdentity: row.linked_identity_type
        ? {
            type: row.linked_identity_type as 'github' | 'google' | 'twitter',
            verifiedAt: row.linked_identity_verified_at ?? 0,
            accountAge: row.linked_identity_account_age ?? 0,
          }
        : undefined,
    }
  }

  /**
   * Link external identity for reputation boost
   */
  async linkIdentity(
    address: Address,
    identity: {
      type: 'github' | 'google' | 'twitter'
      accountAge: number
    },
  ): Promise<void> {
    const client = await getEQLiteClient()
    const now = Date.now()

    await client.exec(
      `INSERT INTO deployment_reputation 
        (address, tier, linked_identity_type, linked_identity_verified_at, linked_identity_account_age, updated_at)
       VALUES (?, 'low', ?, ?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET
        linked_identity_type = excluded.linked_identity_type,
        linked_identity_verified_at = excluded.linked_identity_verified_at,
        linked_identity_account_age = excluded.linked_identity_account_age,
        tier = CASE 
          WHEN deployment_reputation.tier = 'untrusted' THEN 'low'
          ELSE deployment_reputation.tier
        END,
        reputation_score = deployment_reputation.reputation_score + 1000,
        updated_at = excluded.updated_at`,
      [address.toLowerCase(), identity.type, now, identity.accountAge, now],
      MODERATION_DATABASE_ID,
    )

    console.log(
      `[DeploymentModeration] Linked ${identity.type} identity for ${address}`,
    )
  }

  /**
   * Get pending review queue
   */
  async getPendingReviews(limit = 50): Promise<
    Array<{
      id: string
      deploymentId: string
      owner: Address
      reason: string
      priority: string
      createdAt: number
    }>
  > {
    const client = await getEQLiteClient()
    const result = await client.query<{
      id: string
      deployment_id: string
      owner: string
      reason: string
      priority: string
      created_at: number
    }>(
      `SELECT * FROM moderation_queue 
       WHERE status = 'pending' 
       ORDER BY 
         CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
         created_at ASC
       LIMIT ?`,
      [limit],
      MODERATION_DATABASE_ID,
    )

    return result.rows.map((row) => ({
      id: row.id,
      deploymentId: row.deployment_id,
      owner: row.owner as Address,
      reason: row.reason,
      priority: row.priority,
      createdAt: row.created_at,
    }))
  }

  /**
   * Resolve a review
   */
  async resolveReview(
    reviewId: string,
    action: 'approve' | 'reject',
    reviewerAddress: Address,
  ): Promise<void> {
    const client = await getEQLiteClient()

    await client.exec(
      `UPDATE moderation_queue 
       SET status = ?, assigned_to = ?, resolved_at = ?
       WHERE id = ?`,
      [
        action === 'approve' ? 'approved' : 'rejected',
        reviewerAddress.toLowerCase(),
        Date.now(),
        reviewId,
      ],
      MODERATION_DATABASE_ID,
    )

    console.log(`[DeploymentModeration] Review ${reviewId} resolved: ${action}`)
  }

  // ============ Internal Methods ============

  private async scanContainerImage(
    image: string,
    skipDetailed: boolean,
  ): Promise<{
    categories: ModerationResult['categories']
    blockedReasons: string[]
  }> {
    const categories: ModerationResult['categories'] = []
    const blockedReasons: string[] = []

    // Check against blocklist
    if (BLOCKED_IMAGES.has(image.toLowerCase())) {
      categories.push({
        category: 'malware',
        confidence: 1.0,
        details: `Image ${image} is on the blocklist`,
      })
      blockedReasons.push(`Blocked image: ${image}`)
      return { categories, blockedReasons }
    }

    // Check for suspicious image names
    const suspiciousPatterns = [
      /miner/i,
      /crypto/i,
      /xmr/i,
      /monero/i,
      /hack/i,
      /exploit/i,
    ]

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(image)) {
        categories.push({
          category: 'suspicious',
          confidence: 0.6,
          details: `Image name matches suspicious pattern: ${pattern}`,
        })
      }
    }

    // Skip detailed scanning for trusted users
    if (skipDetailed) {
      return { categories, blockedReasons }
    }

    // For full scan, we would pull the image manifest and analyze layers
    // This is a placeholder for actual container scanning

    return { categories, blockedReasons }
  }

  private async scanCode(
    codeCid: string,
    skipDetailed: boolean,
  ): Promise<{
    categories: ModerationResult['categories']
    blockedReasons: string[]
  }> {
    const categories: ModerationResult['categories'] = []
    const blockedReasons: string[] = []

    // Skip detailed scanning for trusted users
    if (skipDetailed) {
      return { categories, blockedReasons }
    }

    // Fetch code from IPFS
    let code: string
    try {
      const ipfsGateway = process.env.IPFS_GATEWAY ?? getIpfsGatewayUrl()
      const response = await fetch(`${ipfsGateway}/ipfs/${codeCid}`, {
        signal: AbortSignal.timeout(this.config.scanTimeoutMs),
      })

      if (!response.ok) {
        categories.push({
          category: 'suspicious',
          confidence: 0.3,
          details: `Could not fetch code from IPFS: ${codeCid}`,
        })
        return { categories, blockedReasons }
      }

      code = await response.text()
    } catch (error) {
      categories.push({
        category: 'suspicious',
        confidence: 0.3,
        details: `Error fetching code: ${error}`,
      })
      return { categories, blockedReasons }
    }

    // Check file size
    if (code.length > this.config.maxCodeSizeBytes) {
      categories.push({
        category: 'suspicious',
        confidence: 0.5,
        details: `Code exceeds maximum size: ${code.length} bytes`,
      })
    }

    // Pattern-based malware detection
    for (const pattern of MALWARE_PATTERNS) {
      const matches = code.match(pattern)
      if (matches) {
        const isCryptominer =
          pattern.source.includes('xmrig') ||
          pattern.source.includes('monero') ||
          pattern.source.includes('stratum')

        categories.push({
          category: isCryptominer ? 'cryptominer' : 'malware',
          confidence: 0.85,
          details: `Code matches ${isCryptominer ? 'cryptominer' : 'malware'} pattern: ${pattern.source.slice(0, 50)}...`,
        })

        if (isCryptominer && 0.85 >= this.config.cryptominerThreshold) {
          blockedReasons.push('Detected cryptocurrency mining code')
        } else if (0.85 >= this.config.malwareThreshold) {
          blockedReasons.push('Detected malware patterns')
        }
      }
    }

    return { categories, blockedReasons }
  }

  private scanEnvironment(env: Record<string, string>): {
    categories: ModerationResult['categories']
    blockedReasons: string[]
  } {
    const categories: ModerationResult['categories'] = []
    const blockedReasons: string[] = []

    for (const [key, value] of Object.entries(env)) {
      // Check for sensitive environment variable names
      for (const pattern of SENSITIVE_ENV_PATTERNS) {
        if (pattern.test(key)) {
          // Check if value looks like an actual secret
          const looksLikeSecret =
            value.length > 20 ||
            /^[A-Za-z0-9+/=_-]{20,}$/.test(value) ||
            value.startsWith('sk-') ||
            value.startsWith('pk_')

          if (looksLikeSecret) {
            categories.push({
              category: 'data_leak',
              confidence: 0.9,
              details: `Potential secret exposure in environment variable: ${key}`,
            })
            blockedReasons.push(
              `Sensitive data detected in environment: ${key}`,
            )
          }
        }
      }
    }

    return { categories, blockedReasons }
  }

  private async runAIAnalysis(request: DeploymentScanRequest): Promise<{
    categories: ModerationResult['categories']
    blockedReasons: string[]
  }> {
    const categories: ModerationResult['categories'] = []
    const blockedReasons: string[] = []

    const prompt = `Analyze this deployment for security risks and ToS violations.

Deployment Details:
- Type: ${request.type}
- Image: ${request.image ?? 'N/A'}
- Code CID: ${request.codeCid ?? 'N/A'}
- Entrypoint: ${request.entrypoint ?? 'N/A'}
- Resources: ${JSON.stringify(request.resources ?? {})}
- Environment Variables: ${Object.keys(request.environment ?? {}).join(', ')}

Analyze for:
1. Malware or malicious code
2. Cryptocurrency mining
3. Phishing or scam content
4. Cloud provider ToS violations
5. Resource abuse potential
6. Data exfiltration risks

Return JSON:
{
  "classifications": [
    { "category": "category_name", "confidence": 0.0-1.0, "reasoning": "explanation" }
  ],
  "overallAssessment": "summary",
  "recommendedAction": "allow|review|block|quarantine|report",
  "riskScore": 0-100
}`

    try {
      const response = await fetch(this.config.aiModelEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.aiModel,
          messages: [
            {
              role: 'system',
              content:
                'You are a security analyst reviewing cloud deployments for malicious content and policy violations.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
          max_tokens: 1000,
        }),
        signal: AbortSignal.timeout(this.config.scanTimeoutMs),
      })

      if (response.ok) {
        const rawData: unknown = await response.json()
        const dataResult = ChatCompletionResponseSchema.safeParse(rawData)

        if (dataResult.success) {
          const content = dataResult.data.choices[0]?.message.content ?? ''
          const jsonMatch = content.match(/\{[\s\S]*\}/)

          if (jsonMatch) {
            const parsed: unknown = JSON.parse(jsonMatch[0])
            const parseResult = AIClassificationResponseSchema.safeParse(parsed)

            if (parseResult.success) {
              for (const classification of parseResult.data.classifications) {
                const category = this.mapAICategory(classification.category)
                categories.push({
                  category,
                  confidence: classification.confidence,
                  details: classification.reasoning,
                })

                if (classification.confidence > 0.85 && category !== 'clean') {
                  blockedReasons.push(
                    `AI detected ${category}: ${classification.reasoning}`,
                  )
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('[DeploymentModeration] AI analysis failed:', error)
      // Don't block on AI failure - use pattern-based detection
    }

    return { categories, blockedReasons }
  }

  private mapAICategory(category: string): ModerationCategory {
    const normalized = category.toLowerCase()
    if (normalized.includes('malware')) return 'malware'
    if (normalized.includes('crypto') || normalized.includes('miner'))
      return 'cryptominer'
    if (normalized.includes('phish') || normalized.includes('scam'))
      return 'phishing'
    if (normalized.includes('csam') || normalized.includes('child'))
      return 'csam'
    if (normalized.includes('copyright')) return 'copyright'
    if (normalized.includes('tos') || normalized.includes('violation'))
      return 'tos_violation'
    if (normalized.includes('leak') || normalized.includes('sensitive'))
      return 'data_leak'
    if (normalized.includes('suspicious')) return 'suspicious'
    return 'clean'
  }

  private calculateOverallScore(
    categories: ModerationResult['categories'],
  ): number {
    if (categories.length === 0) return 100

    // Start with 100, deduct based on findings
    let score = 100

    for (const cat of categories) {
      const deduction = this.getCategoryDeduction(cat.category) * cat.confidence
      score -= deduction
    }

    return Math.max(0, Math.round(score))
  }

  private getCategoryDeduction(category: ModerationCategory): number {
    switch (category) {
      case 'csam':
        return 100 // Immediate full deduction
      case 'malware':
        return 80
      case 'cryptominer':
        return 70
      case 'phishing':
        return 60
      case 'tos_violation':
        return 50
      case 'data_leak':
        return 40
      case 'copyright':
        return 30
      case 'suspicious':
        return 15
      case 'clean':
        return 0
    }
  }

  private determineAction(
    categories: ModerationResult['categories'],
    score: number,
    reputation: DeploymentReputationData,
  ): ModerationAction {
    // CSAM = immediate report and block
    if (categories.some((c) => c.category === 'csam' && c.confidence > 0.5)) {
      return 'report'
    }

    // High confidence malware/cryptominer = block
    if (
      categories.some(
        (c) =>
          (c.category === 'malware' || c.category === 'cryptominer') &&
          c.confidence > this.config.malwareThreshold,
      )
    ) {
      return 'block'
    }

    // Score-based decisions
    if (score < 30) {
      return 'block'
    }

    if (score < 50) {
      return reputation.tier === 'verified' || reputation.tier === 'high'
        ? 'quarantine'
        : 'block'
    }

    if (score < 70) {
      return this.config.blockOnSuspicious ? 'block' : 'review'
    }

    if (score < 85) {
      return reputation.tier === 'untrusted' && this.config.quarantineUnverified
        ? 'quarantine'
        : 'allow'
    }

    return 'allow'
  }

  private async storeScanResult(
    request: DeploymentScanRequest,
    result: ModerationResult,
  ): Promise<void> {
    const client = await getEQLiteClient()
    const scanId = `scan-${Date.now()}-${Math.random().toString(36).slice(2)}`

    await client.exec(
      `INSERT INTO deployment_scans 
        (id, deployment_id, owner, scan_type, action, overall_score, categories, blocked_reasons, attestation_hash, created_at, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        scanId,
        request.deploymentId,
        request.owner.toLowerCase(),
        request.type,
        result.action,
        result.overallScore,
        JSON.stringify(result.categories),
        JSON.stringify(result.blockedReasons),
        result.attestationHash,
        result.timestamp,
        result.scanDurationMs,
      ],
      MODERATION_DATABASE_ID,
    )
  }

  private async updateReputation(
    address: Address,
    result: ModerationResult,
  ): Promise<void> {
    const client = await getEQLiteClient()
    const now = Date.now()

    // Calculate reputation change
    let reputationDelta = 0
    if (result.action === 'allow') {
      reputationDelta = 10 // Small boost for clean deployment
    } else if (result.action === 'block' || result.action === 'report') {
      reputationDelta = -500 // Significant penalty
    } else if (result.action === 'review') {
      reputationDelta = -50 // Small penalty
    }

    await client.exec(
      `INSERT INTO deployment_reputation 
        (address, tier, total_deployments, successful_deployments, blocked_deployments, reviewed_deployments, reputation_score, last_deployment_at, updated_at)
       VALUES (?, 'untrusted', 1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET
        total_deployments = deployment_reputation.total_deployments + 1,
        successful_deployments = deployment_reputation.successful_deployments + ?,
        blocked_deployments = deployment_reputation.blocked_deployments + ?,
        reviewed_deployments = deployment_reputation.reviewed_deployments + ?,
        reputation_score = MAX(0, MIN(10000, deployment_reputation.reputation_score + ?)),
        tier = CASE
          WHEN deployment_reputation.reputation_score + ? >= 8000 THEN 'high'
          WHEN deployment_reputation.reputation_score + ? >= 5000 THEN 'medium'
          WHEN deployment_reputation.reputation_score + ? >= 2000 THEN 'low'
          ELSE 'untrusted'
        END,
        last_deployment_at = ?,
        updated_at = ?`,
      [
        address.toLowerCase(),
        result.action === 'allow' ? 1 : 0,
        result.action === 'block' || result.action === 'report' ? 1 : 0,
        result.action === 'review' ? 1 : 0,
        reputationDelta,
        now,
        now,
        // For ON CONFLICT update
        result.action === 'allow' ? 1 : 0,
        result.action === 'block' || result.action === 'report' ? 1 : 0,
        result.action === 'review' ? 1 : 0,
        reputationDelta,
        reputationDelta,
        reputationDelta,
        reputationDelta,
        now,
        now,
      ],
      MODERATION_DATABASE_ID,
    )
  }

  private async queueForReview(
    request: DeploymentScanRequest,
    result: ModerationResult,
  ): Promise<void> {
    const client = await getEQLiteClient()
    const reviewId = `review-${Date.now()}-${Math.random().toString(36).slice(2)}`

    const priority = result.categories.some(
      (c) =>
        c.category === 'csam' ||
        (c.category === 'malware' && c.confidence > 0.9),
    )
      ? 'critical'
      : result.overallScore < 50
        ? 'high'
        : 'normal'

    await client.exec(
      `INSERT INTO moderation_queue (id, deployment_id, owner, reason, priority, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      [
        reviewId,
        request.deploymentId,
        request.owner.toLowerCase(),
        result.blockedReasons.join('; ') || 'Manual review required',
        priority,
        Date.now(),
      ],
      MODERATION_DATABASE_ID,
    )

    console.log(
      `[DeploymentModeration] Queued ${reviewId} for review (priority: ${priority})`,
    )
  }
}

// ============ Singleton ============

let moderationService: DeploymentModerationService | null = null

export function getDeploymentModerationService(): DeploymentModerationService {
  if (!moderationService) {
    moderationService = new DeploymentModerationService()
  }
  return moderationService
}

export function createDeploymentModerationService(
  config?: Partial<ModerationConfig>,
): DeploymentModerationService {
  moderationService = new DeploymentModerationService(config)
  return moderationService
}
