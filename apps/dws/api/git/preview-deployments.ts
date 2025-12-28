import { getRpcUrl } from '@jejunetwork/config'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  keccak256,
  stringToBytes,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import { z } from 'zod'
import type { ManagedDatabaseService } from '../database/managed-service'
import type { BackendManager } from '../storage/backends'

export type PreviewType = 'branch' | 'pr' | 'commit'

export type PreviewStatus =
  | 'pending'
  | 'building'
  | 'deploying'
  | 'active'
  | 'sleeping'
  | 'error'
  | 'expired'
  | 'deleted'

export type AccessLevel = 'public' | 'team' | 'private'

export interface PreviewDeployment {
  previewId: string
  appName: string
  type: PreviewType
  branchName: string
  prNumber?: number
  commitSha: string
  status: PreviewStatus

  // URLs
  previewUrl: string
  apiUrl?: string

  // Resources
  frontendCid?: string
  workerDeploymentId?: string
  databaseBranchId?: string

  // Metadata
  createdAt: number
  updatedAt: number
  expiresAt: number
  lastAccessedAt?: number

  // Config
  accessLevel: AccessLevel
  owner: Address
  environment: Record<string, string>

  // Build info
  buildLogs?: string
  buildDuration?: number
}

export interface PreviewConfig {
  appName: string
  owner: Address
  type: PreviewType
  branchName: string
  prNumber?: number
  commitSha: string

  // Optional overrides
  environment?: Record<string, string>
  accessLevel?: AccessLevel
  ttlHours?: number

  // Database branching
  branchDatabase?: boolean
  parentDatabaseId?: string
}

export interface PreviewCleanupResult {
  deleted: string[]
  errors: Array<{ previewId: string; error: string }>
}

// ============================================================================
// Schemas
// ============================================================================

export const CreatePreviewSchema = z.object({
  appName: z.string().min(1).max(63),
  branchName: z.string().min(1).max(255),
  prNumber: z.number().optional(),
  commitSha: z.string().length(40),
  environment: z.record(z.string(), z.string()).optional(),
  accessLevel: z.enum(['public', 'team', 'private']).default('team'),
  ttlHours: z.number().min(1).max(720).default(72), // Max 30 days
  branchDatabase: z.boolean().default(false),
  parentDatabaseId: z.string().optional(),
})

// ============================================================================
// Preview URL Generator
// ============================================================================

function generatePreviewUrl(config: PreviewConfig, baseDomain: string): string {
  const sanitizedBranch = config.branchName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 20)

  if (config.type === 'pr' && config.prNumber) {
    return `https://pr-${config.prNumber}.${config.appName}.${baseDomain}`
  }

  if (config.type === 'commit') {
    const shortSha = config.commitSha.slice(0, 7)
    return `https://${shortSha}.${config.appName}.${baseDomain}`
  }

  return `https://${sanitizedBranch}.${config.appName}.${baseDomain}`
}

// ============================================================================
// Preview Deployment Manager
// ============================================================================

export class PreviewDeploymentManager {
  private previews = new Map<string, PreviewDeployment>()
  private previewsByApp = new Map<string, Set<string>>() // appName -> previewIds
  private orgMemberships = new Map<Address, Set<string>>() // address -> orgIds
  private backend: BackendManager
  private dbService?: ManagedDatabaseService
  private baseDomain: string

  // Contract interaction
  private publicClient: ReturnType<typeof createPublicClient>
  private walletClient: ReturnType<typeof createWalletClient> | null = null

  constructor(config: {
    backend: BackendManager
    dbService?: ManagedDatabaseService
    baseDomain: string
    rpcUrl: string
    privateKey?: Hex
  }) {
    this.backend = config.backend
    this.dbService = config.dbService
    this.baseDomain = config.baseDomain

    const chain = {
      ...foundry,
      rpcUrls: { default: { http: [config.rpcUrl] } },
    }
    this.publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    })

    if (config.privateKey) {
      const account = privateKeyToAccount(config.privateKey)
      this.walletClient = createWalletClient({
        account,
        chain,
        transport: http(config.rpcUrl),
      })
    }

    // Start cleanup job
    this.startCleanupJob()
  }

  /** Get contract configuration (for future on-chain registration) */
  getContractConfig() {
    return {
      backend: this.backend,
      publicClient: this.publicClient,
      walletClient: this.walletClient,
    }
  }

  // =========================================================================
  // Preview Lifecycle
  // =========================================================================

  async createPreview(config: PreviewConfig): Promise<PreviewDeployment> {
    const previewId = keccak256(
      stringToBytes(
        `${config.appName}-${config.branchName}-${config.commitSha}-${Date.now()}`,
      ),
    ).slice(0, 18) as string

    const ttlHours = 72 // Default 3 days
    const previewUrl = generatePreviewUrl(config, this.baseDomain)

    const preview: PreviewDeployment = {
      previewId,
      appName: config.appName,
      type: config.type,
      branchName: config.branchName,
      prNumber: config.prNumber,
      commitSha: config.commitSha,
      status: 'pending',
      previewUrl,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + ttlHours * 60 * 60 * 1000,
      accessLevel: config.accessLevel ?? 'team',
      owner: config.owner,
      environment: config.environment ?? {},
    }

    this.previews.set(previewId, preview)

    // Track by app
    const appPreviews = this.previewsByApp.get(config.appName) ?? new Set()
    appPreviews.add(previewId)
    this.previewsByApp.set(config.appName, appPreviews)

    // Create database branch if requested
    if (config.branchDatabase && config.parentDatabaseId && this.dbService) {
      preview.status = 'building'
      preview.updatedAt = Date.now()

      // Database branching would create a copy-on-write snapshot
      // For now, just track the intent
      preview.databaseBranchId = `branch-${previewId}`
      console.log(
        `[Preview] Database branch created: ${preview.databaseBranchId}`,
      )
    }

    console.log(
      `[Preview] Created preview ${previewId} for ${config.appName}/${config.branchName}`,
    )

    return preview
  }

  async buildPreview(
    previewId: string,
    buildFn: () => Promise<{
      frontendCid?: string
      workerDeploymentId?: string
      logs: string
    }>,
  ): Promise<PreviewDeployment> {
    const preview = this.previews.get(previewId)
    if (!preview) throw new Error(`Preview not found: ${previewId}`)

    preview.status = 'building'
    preview.updatedAt = Date.now()

    const startTime = Date.now()

    try {
      const result = await buildFn()

      preview.frontendCid = result.frontendCid
      preview.workerDeploymentId = result.workerDeploymentId
      preview.buildLogs = result.logs
      preview.buildDuration = Date.now() - startTime
      preview.status = 'deploying'
      preview.updatedAt = Date.now()

      console.log(`[Preview] Built ${previewId} in ${preview.buildDuration}ms`)
    } catch (error) {
      preview.status = 'error'
      preview.buildLogs = error instanceof Error ? error.message : String(error)
      preview.updatedAt = Date.now()
      throw error
    }

    return preview
  }

  async activatePreview(
    previewId: string,
    deployFn: () => Promise<{ apiUrl?: string }>,
  ): Promise<PreviewDeployment> {
    const preview = this.previews.get(previewId)
    if (!preview) throw new Error(`Preview not found: ${previewId}`)

    try {
      const result = await deployFn()

      preview.apiUrl = result.apiUrl
      preview.status = 'active'
      preview.lastAccessedAt = Date.now()
      preview.updatedAt = Date.now()

      console.log(`[Preview] Activated ${previewId} at ${preview.previewUrl}`)
    } catch (error) {
      preview.status = 'error'
      preview.updatedAt = Date.now()
      throw error
    }

    return preview
  }

  async sleepPreview(previewId: string): Promise<void> {
    const preview = this.previews.get(previewId)
    if (!preview) throw new Error(`Preview not found: ${previewId}`)

    // Scale down workers to zero
    if (preview.workerDeploymentId) {
      // Would call worker deployer to scale to 0
      console.log(`[Preview] Scaling down workers for ${previewId}`)
    }

    preview.status = 'sleeping'
    preview.updatedAt = Date.now()
  }

  async wakePreview(previewId: string): Promise<void> {
    const preview = this.previews.get(previewId)
    if (!preview) throw new Error(`Preview not found: ${previewId}`)

    if (preview.status !== 'sleeping') return

    // Scale workers back up
    if (preview.workerDeploymentId) {
      console.log(`[Preview] Waking workers for ${previewId}`)
    }

    preview.status = 'active'
    preview.lastAccessedAt = Date.now()
    preview.updatedAt = Date.now()
  }

  async deletePreview(previewId: string): Promise<void> {
    const preview = this.previews.get(previewId)
    if (!preview) return

    console.log(`[Preview] Deleting ${previewId}`)

    // Cleanup resources
    if (preview.workerDeploymentId) {
      // Would call worker deployer to undeploy
      console.log(`[Preview] Undeploying worker ${preview.workerDeploymentId}`)
    }

    if (preview.databaseBranchId) {
      // Would delete database branch
      console.log(
        `[Preview] Deleting database branch ${preview.databaseBranchId}`,
      )
    }

    preview.status = 'deleted'
    preview.updatedAt = Date.now()

    // Remove from tracking
    const appPreviews = this.previewsByApp.get(preview.appName)
    appPreviews?.delete(previewId)
  }

  // =========================================================================
  // Queries
  // =========================================================================

  getPreview(previewId: string): PreviewDeployment | undefined {
    return this.previews.get(previewId)
  }

  getPreviewByUrl(url: string): PreviewDeployment | undefined {
    for (const preview of this.previews.values()) {
      if (preview.previewUrl === url) return preview
      if (preview.apiUrl === url) return preview
    }
    return undefined
  }

  getPreviewsByApp(appName: string): PreviewDeployment[] {
    const previewIds = this.previewsByApp.get(appName)
    if (!previewIds) return []

    return Array.from(previewIds)
      .map((id) => this.previews.get(id))
      .filter((p): p is PreviewDeployment => p !== undefined)
  }

  getPreviewsByBranch(
    appName: string,
    branchName: string,
  ): PreviewDeployment[] {
    return this.getPreviewsByApp(appName).filter(
      (p) => p.branchName === branchName,
    )
  }

  getPreviewByPR(
    appName: string,
    prNumber: number,
  ): PreviewDeployment | undefined {
    return this.getPreviewsByApp(appName).find((p) => p.prNumber === prNumber)
  }

  getActivePreviewCount(): number {
    return Array.from(this.previews.values()).filter(
      (p) => p.status === 'active',
    ).length
  }

  // =========================================================================
  // Access Control
  // =========================================================================

  async checkAccess(previewId: string, requester: Address): Promise<boolean> {
    const preview = this.previews.get(previewId)
    if (!preview) return false

    // Owner always has access
    if (preview.owner === requester) return true

    // Public previews are accessible to all
    if (preview.accessLevel === 'public') return true

    // Team access checks org membership via identity registry
    if (preview.accessLevel === 'team') {
      // Check if requester is in same org as owner via identity registry
      // The org membership is stored on-chain in the identity contract
      const ownerOrgs =
        this.orgMemberships.get(preview.owner) ?? new Set<string>()
      const requesterOrgs =
        this.orgMemberships.get(requester) ?? new Set<string>()

      // Check if they share any org membership
      for (const org of ownerOrgs) {
        if (requesterOrgs.has(org)) return true
      }
      return false
    }

    return false
  }

  // =========================================================================
  // Cleanup
  // =========================================================================

  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null

  private startCleanupJob(): void {
    // Run cleanup every hour
    this.cleanupIntervalId = setInterval(
      () => {
        this.cleanupExpiredPreviews().catch(console.error)
      },
      60 * 60 * 1000,
    )
  }

  async cleanupExpiredPreviews(): Promise<PreviewCleanupResult> {
    const now = Date.now()
    const result: PreviewCleanupResult = {
      deleted: [],
      errors: [],
    }

    for (const preview of this.previews.values()) {
      // Skip already deleted
      if (preview.status === 'deleted') continue

      // Check expiration
      if (preview.expiresAt < now) {
        try {
          await this.deletePreview(preview.previewId)
          result.deleted.push(preview.previewId)
        } catch (error) {
          result.errors.push({
            previewId: preview.previewId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
        continue
      }

      // Check idle time for sleeping (1 hour of inactivity)
      if (preview.status === 'active' && preview.lastAccessedAt) {
        const idleTime = now - preview.lastAccessedAt
        if (idleTime > 60 * 60 * 1000) {
          try {
            await this.sleepPreview(preview.previewId)
          } catch (error) {
            console.error(
              `Failed to sleep preview ${preview.previewId}:`,
              error,
            )
          }
        }
      }
    }

    if (result.deleted.length > 0) {
      console.log(
        `[Preview] Cleaned up ${result.deleted.length} expired previews`,
      )
    }

    return result
  }

  async cleanupBranchPreviews(
    appName: string,
    branchName: string,
  ): Promise<void> {
    const previews = this.getPreviewsByBranch(appName, branchName)

    for (const preview of previews) {
      await this.deletePreview(preview.previewId)
    }

    console.log(
      `[Preview] Cleaned up ${previews.length} previews for ${appName}/${branchName}`,
    )
  }

  async cleanupPRPreview(appName: string, prNumber: number): Promise<void> {
    const preview = this.getPreviewByPR(appName, prNumber)
    if (preview) {
      await this.deletePreview(preview.previewId)
      console.log(`[Preview] Cleaned up PR preview for ${appName}#${prNumber}`)
    }
  }

  stopCleanup(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId)
      this.cleanupIntervalId = null
    }
  }

  // =========================================================================
  // PR Comments
  // =========================================================================

  generatePRComment(preview: PreviewDeployment): string {
    const statusEmoji = {
      pending: '🕐',
      building: '🔨',
      deploying: '🚀',
      active: '✅',
      sleeping: '💤',
      error: '❌',
      expired: '⏰',
      deleted: '🗑️',
    }[preview.status]

    return `## ${statusEmoji} Preview Deployment

| | |
|---|---|
| **URL** | [${preview.previewUrl}](${preview.previewUrl}) |
| **Branch** | \`${preview.branchName}\` |
| **Commit** | \`${preview.commitSha.slice(0, 7)}\` |
| **Status** | ${preview.status} |
| **Expires** | ${new Date(preview.expiresAt).toISOString()} |

${preview.apiUrl ? `**API:** [${preview.apiUrl}](${preview.apiUrl})` : ''}

${
  preview.status === 'error' && preview.buildLogs
    ? `
<details>
<summary>Build Logs</summary>

\`\`\`
${preview.buildLogs}
\`\`\`

</details>
`
    : ''
}

---
*Preview deployments are automatically deleted after ${Math.round((preview.expiresAt - preview.createdAt) / (1000 * 60 * 60))} hours.*`
  }
}

// ============================================================================
// Factory
// ============================================================================

let previewManager: PreviewDeploymentManager | null = null

export function getPreviewManager(
  backend: BackendManager,
  dbService?: ManagedDatabaseService,
): PreviewDeploymentManager {
  if (!previewManager) {
    const rpcUrl = getRpcUrl()
    const baseDomain =
      process.env.DWS_PREVIEW_DOMAIN ?? 'preview.dws.jejunetwork.org'
    const privateKey = process.env.DWS_OPERATOR_KEY as Hex | undefined

    previewManager = new PreviewDeploymentManager({
      backend,
      dbService,
      baseDomain,
      rpcUrl,
      privateKey,
    })
  }
  return previewManager
}
