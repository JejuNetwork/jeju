/**
 * DWS Moderation Routes
 *
 * Decentralized moderation system integration:
 * - Ban requests from email, messaging, and other services
 * - Integration with ModerationMarketplace contract
 * - Queue management for offline/async processing
 * - Appeal handling
 * - Content screening with multi-provider pipeline
 */

import {
  getChainId,
  getCurrentNetwork,
  getRpcUrl,
  tryGetContract,
} from '@jejunetwork/config'
import { getContentModerationPipeline, moderateName } from '@jejunetwork/shared'
import {
  DETERRENCE_MESSAGES,
  getAllTrustedFlaggers,
  getCSAMReportStats,
  getMetricsSummary,
  getPersistenceMode,
  getTrustedFlagger,
  getUserReportStats,
  getUserReports,
  registerTrustedFlagger,
  saveUserReport,
  type TrustedFlagger,
  type UserReport,
  updateUserReportStatus,
} from '@jejunetwork/shared/moderation'
import { Elysia, t } from 'elysia'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  parseAbiItem,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

interface ModerationConfig {
  rpcUrl: string
  chainId: number
  moderationMarketplaceAddress: Address
  banManagerAddress: Address
  operatorPrivateKey?: Hex
}

const getConfig = (): ModerationConfig => {
  const network = getCurrentNetwork()
  return {
    rpcUrl: getRpcUrl(network),
    chainId: getChainId(network),
    moderationMarketplaceAddress: ((typeof process !== 'undefined'
      ? process.env.MODERATION_MARKETPLACE_ADDRESS
      : undefined) ??
      tryGetContract('moderation', 'marketplace', network) ??
      '0x0') as Address,
    banManagerAddress: ((typeof process !== 'undefined'
      ? process.env.BAN_MANAGER_ADDRESS
      : undefined) ??
      tryGetContract('moderation', 'banManager', network) ??
      '0x0') as Address,
    operatorPrivateKey:
      typeof process !== 'undefined'
        ? (process.env.OPERATOR_PRIVATE_KEY as Hex | undefined)
        : undefined,
  }
}
const BAN_MANAGER_ABI = [
  parseAbiItem('function isAddressBanned(address target) view returns (bool)'),
  parseAbiItem(
    'function applyAddressBan(address target, bytes32 caseId, string reason)',
  ),
  parseAbiItem(
    'function addressBans(address) view returns (bool isBanned, uint8 banType, uint256 bannedAt, uint256 expiresAt, string reason, bytes32 proposalId, address reporter, bytes32 caseId)',
  ),
] as const

const MODERATION_MARKETPLACE_ABI = [
  parseAbiItem(
    'function reportAndBan(address target, string reason) returns (bytes32)',
  ),
  parseAbiItem(
    'function createBanCase(address target, string evidence, uint256 stake) payable returns (bytes32)',
  ),
  parseAbiItem('function getBanStatus(address target) view returns (uint8)'),
  parseAbiItem('function requestReReview(bytes32 caseId) payable'),
] as const
interface QueuedAction {
  id: string
  type: 'ban' | 'review' | 'appeal'
  target: Address
  reason: string
  service: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  createdAt: number
  attempts: number
  lastError?: string
  data: Record<string, unknown>
}

const moderationQueue: QueuedAction[] = []
export function createModerationRouter() {
  const config = getConfig()

  const publicClient = createPublicClient({
    transport: http(config.rpcUrl),
  })

  const getWalletClient = () => {
    if (!config.operatorPrivateKey) {
      throw new Error('Operator private key not configured')
    }
    const account = privateKeyToAccount(config.operatorPrivateKey)
    return createWalletClient({
      account,
      transport: http(config.rpcUrl),
    })
  }

  return (
    new Elysia({ name: 'moderation', prefix: '/moderation' })

      .get('/health', () => ({
        status: 'ok',
        queueLength: moderationQueue.length,
        moderationMarketplace: config.moderationMarketplaceAddress,
        banManager: config.banManagerAddress,
      }))

      // ========== CONTENT SCREENING ENDPOINTS ==========

      .post(
        '/screen/text',
        async ({ body }) => {
          const pipeline = getContentModerationPipeline()
          const result = await pipeline.moderate({
            content: body.content,
            contentType: 'text',
            senderAddress: body.senderAddress as Address | undefined,
          })

          return {
            safe: result.safe,
            action: result.action,
            severity: result.severity,
            category: result.primaryCategory,
            categories: result.categories.map((c) => ({
              name: c.category,
              score: c.score,
              confidence: c.confidence,
            })),
            processingTimeMs: result.processingTimeMs,
          }
        },
        {
          body: t.Object({
            content: t.String({ minLength: 1, maxLength: 50000 }),
            senderAddress: t.Optional(
              t.String({ pattern: '^0x[a-fA-F0-9]{40}$' }),
            ),
          }),
          detail: { tags: ['moderation'], summary: 'Screen text content' },
        },
      )

      .post(
        '/screen/image',
        async ({ body }) => {
          const pipeline = getContentModerationPipeline()
          const imageBuffer = Buffer.from(body.imageBase64, 'base64')

          const result = await pipeline.moderate({
            content: imageBuffer,
            contentType: 'image',
            senderAddress: body.senderAddress as Address | undefined,
          })

          return {
            safe: result.safe,
            action: result.action,
            severity: result.severity,
            category: result.primaryCategory,
            categories: result.categories.map((c) => ({
              name: c.category,
              score: c.score,
              confidence: c.confidence,
            })),
            hashMatches: result.hashMatches,
            processingTimeMs: result.processingTimeMs,
          }
        },
        {
          body: t.Object({
            imageBase64: t.String({ minLength: 1 }),
            senderAddress: t.Optional(
              t.String({ pattern: '^0x[a-fA-F0-9]{40}$' }),
            ),
          }),
          detail: { tags: ['moderation'], summary: 'Screen image content' },
        },
      )

      .post(
        '/screen/name',
        async ({ body }) => {
          const result = moderateName(body.name)

          return {
            safe: result.safe,
            action: result.action,
            severity: result.severity,
            category: result.primaryCategory,
            blockedReason: result.blockedReason,
            canRegister: result.action === 'allow' || result.action === 'warn',
          }
        },
        {
          body: t.Object({
            name: t.String({ minLength: 1, maxLength: 100 }),
          }),
          detail: { tags: ['moderation'], summary: 'Screen JNS/DNS name' },
        },
      )

      .get('/screen/stats', () => {
        const pipeline = getContentModerationPipeline()
        return pipeline.getStats()
      })

      // ========== END CONTENT SCREENING ==========
      .post(
        '/ban',
        async ({ body, set }) => {
          const target = body.target as Address

          // Check if already banned
          const isBanned = await publicClient.readContract({
            address: config.banManagerAddress,
            abi: BAN_MANAGER_ABI,
            functionName: 'isAddressBanned',
            args: [target],
          })

          if (isBanned) {
            return {
              success: true,
              alreadyBanned: true,
              message: 'Target is already banned',
            }
          }

          // For critical severity with autoban, execute immediately
          if (body.severity === 'critical' && body.autoban) {
            try {
              const walletClient = getWalletClient()

              const hash = await walletClient.writeContract({
                address: config.moderationMarketplaceAddress,
                abi: MODERATION_MARKETPLACE_ABI,
                functionName: 'reportAndBan',
                args: [target, body.reason],
                chain: null,
              })

              console.log(
                `[Moderation] Immediate ban executed for ${target}: ${hash}`,
              )

              return {
                success: true,
                transactionHash: hash,
                message: 'Ban executed immediately due to critical severity',
              }
            } catch (e) {
              console.error('[Moderation] Immediate ban failed:', e)
              // Fall through to queue
            }
          }

          // Queue for processing
          const queueItem: QueuedAction = {
            id: `ban-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            type: 'ban',
            target,
            reason: body.reason,
            service: body.service,
            priority:
              body.severity === 'critical'
                ? 'urgent'
                : body.severity === 'high'
                  ? 'high'
                  : 'normal',
            createdAt: Date.now(),
            attempts: 0,
            data: { evidence: body.evidence },
          }

          moderationQueue.push(queueItem)

          // Sort by priority
          moderationQueue.sort((a, b) => {
            const priorities = { urgent: 0, high: 1, normal: 2, low: 3 }
            return priorities[a.priority] - priorities[b.priority]
          })

          console.log(`[Moderation] Ban request queued: ${queueItem.id}`)

          set.status = 202
          return {
            success: true,
            queued: true,
            queueId: queueItem.id,
            message: 'Ban request queued for processing',
          }
        },
        {
          body: t.Object({
            target: t.String({ pattern: '^0x[a-fA-F0-9]{40}$' }),
            reason: t.String({ minLength: 10, maxLength: 1000 }),
            service: t.Union([
              t.Literal('email'),
              t.Literal('messaging'),
              t.Literal('content'),
              t.Literal('general'),
            ]),
            severity: t.Union([
              t.Literal('low'),
              t.Literal('medium'),
              t.Literal('high'),
              t.Literal('critical'),
            ]),
            autoban: t.Optional(t.Boolean()),
            evidence: t.Optional(
              t.Object({
                timestamp: t.Number(),
                type: t.String(),
                contentHashes: t.Optional(t.Array(t.String())),
                screenshotUrls: t.Optional(t.Array(t.String())),
              }),
            ),
          }),
        },
      )
      .post(
        '/submit-review',
        async ({ body, set }) => {
          const target = body.target as Address

          // If high-confidence ban recommendation with autoAction, execute
          if (
            body.review.recommendation === 'ban' &&
            body.review.confidence > 0.9 &&
            body.autoAction
          ) {
            try {
              const walletClient = getWalletClient()

              const reasonWithAnalysis = `${body.review.reason} | Analysis: ${body.review.analysis.overallAssessment}`

              const hash = await walletClient.writeContract({
                address: config.moderationMarketplaceAddress,
                abi: MODERATION_MARKETPLACE_ABI,
                functionName: 'reportAndBan',
                args: [target, reasonWithAnalysis],
                chain: null,
              })

              console.log(
                `[Moderation] Auto-ban from review executed for ${target}: ${hash}`,
              )

              return {
                success: true,
                transactionHash: hash,
                action: 'banned',
                message: 'Auto-ban executed based on review recommendation',
              }
            } catch (e) {
              console.error('[Moderation] Auto-ban from review failed:', e)
              // Fall through to queue
            }
          }

          // Queue review for manual/async processing
          const queueItem: QueuedAction = {
            id: `review-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            type: 'review',
            target,
            reason: body.review.reason,
            service: body.service,
            priority: body.review.recommendation === 'ban' ? 'high' : 'normal',
            createdAt: Date.now(),
            attempts: 0,
            data: { review: body.review },
          }

          moderationQueue.push(queueItem)

          console.log(`[Moderation] Review submitted: ${queueItem.id}`)

          set.status = 202
          return {
            success: true,
            queued: true,
            queueId: queueItem.id,
            recommendation: body.review.recommendation,
            confidence: body.review.confidence,
          }
        },
        {
          body: t.Object({
            service: t.String(),
            target: t.String({ pattern: '^0x[a-fA-F0-9]{40}$' }),
            review: t.Object({
              reason: t.String(),
              analysis: t.Object({
                totalEmails: t.Optional(t.Number()),
                flaggedEmails: t.Optional(t.Number()),
                flaggedPercentage: t.Optional(t.Number()),
                violations: t.Optional(
                  t.Array(
                    t.Object({
                      type: t.String(),
                      count: t.Number(),
                      severity: t.String(),
                      description: t.String(),
                    }),
                  ),
                ),
                overallAssessment: t.String(),
                llmReasoning: t.Optional(t.String()),
              }),
              recommendation: t.Union([
                t.Literal('allow'),
                t.Literal('warn'),
                t.Literal('suspend'),
                t.Literal('ban'),
              ]),
              confidence: t.Number({ minimum: 0, maximum: 1 }),
              timestamp: t.Number(),
            }),
            autoAction: t.Optional(t.Boolean()),
          }),
        },
      )
      .post(
        '/queue',
        async ({ body, set }) => {
          const queueItem: QueuedAction = {
            id: `queue-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            type: 'review',
            target: body.target as Address,
            reason: body.reason,
            service: body.service,
            priority: body.priority,
            createdAt: Date.now(),
            attempts: 0,
            data: { evidence: body.evidence },
          }

          moderationQueue.push(queueItem)

          set.status = 201
          return { success: true, queueId: queueItem.id }
        },
        {
          body: t.Object({
            target: t.String({ pattern: '^0x[a-fA-F0-9]{40}$' }),
            reason: t.String(),
            service: t.String(),
            priority: t.Union([
              t.Literal('low'),
              t.Literal('normal'),
              t.Literal('high'),
              t.Literal('urgent'),
            ]),
            evidence: t.Optional(
              t.Object({
                timestamp: t.Number(),
                type: t.String(),
              }),
            ),
          }),
        },
      )

      .get('/queue', () => ({
        length: moderationQueue.length,
        items: moderationQueue.slice(0, 100),
      }))
      .get(
        '/status/:address',
        async ({ params }) => {
          const address = params.address as Address

          const [isBanned, banStatus] = await Promise.all([
            publicClient.readContract({
              address: config.banManagerAddress,
              abi: BAN_MANAGER_ABI,
              functionName: 'isAddressBanned',
              args: [address],
            }),
            publicClient.readContract({
              address: config.moderationMarketplaceAddress,
              abi: MODERATION_MARKETPLACE_ABI,
              functionName: 'getBanStatus',
              args: [address],
            }),
          ])

          // Status enum: 0=NONE, 1=ON_NOTICE, 2=CHALLENGED, 3=BANNED, 4=CLEARED, 5=APPEALING
          const statusNames = [
            'none',
            'on_notice',
            'challenged',
            'banned',
            'cleared',
            'appealing',
          ] as const

          const statusIndex =
            typeof banStatus === 'number'
              ? banStatus
              : typeof banStatus === 'bigint'
                ? Number(banStatus)
                : 0

          return {
            address,
            isBanned,
            status: statusNames[statusIndex] ?? 'unknown',
            statusCode: statusIndex,
          }
        },
        {
          params: t.Object({
            address: t.String({ pattern: '^0x[a-fA-F0-9]{40}$' }),
          }),
        },
      )
      .post(
        '/appeal',
        async ({ body, set }) => {
          const queueItem: QueuedAction = {
            id: `appeal-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            type: 'appeal',
            target: '0x0' as Address, // Will be resolved from caseId
            reason: body.reason,
            service: 'appeal',
            priority: 'normal',
            createdAt: Date.now(),
            attempts: 0,
            data: {
              caseId: body.caseId,
              evidence: body.evidence,
              stakeAmount: body.stakeAmount,
            },
          }

          moderationQueue.push(queueItem)

          set.status = 202
          return {
            success: true,
            queueId: queueItem.id,
            message: 'Appeal queued for processing',
          }
        },
        {
          body: t.Object({
            caseId: t.String(),
            reason: t.String({ minLength: 50, maxLength: 2000 }),
            evidence: t.Optional(t.String()),
            stakeAmount: t.Optional(t.String()),
          }),
        },
      )
      .post(
        '/process-queue',
        async ({ headers, set }) => {
          // This would typically be called by a cron job or worker
          const authHeader = headers.authorization
          if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
            set.status = 401
            return { error: 'Unauthorized' }
          }

          let processed = 0
          const errors: string[] = []

          while (moderationQueue.length > 0 && processed < 10) {
            const item = moderationQueue.shift()
            if (!item) break

            try {
              const walletClient = getWalletClient()

              if (item.type === 'ban') {
                await walletClient.writeContract({
                  address: config.moderationMarketplaceAddress,
                  abi: MODERATION_MARKETPLACE_ABI,
                  functionName: 'reportAndBan',
                  args: [item.target, item.reason],
                  chain: null,
                })
              }
              // Add other type handlers as needed

              processed++
            } catch (e) {
              item.attempts++
              item.lastError = String(e)

              if (item.attempts < 3) {
                // Re-queue with lower priority
                item.priority = 'low'
                moderationQueue.push(item)
              } else {
                errors.push(`Failed ${item.id}: ${e}`)
              }
            }
          }

          return {
            processed,
            remaining: moderationQueue.length,
            errors: errors.length > 0 ? errors : undefined,
          }
        },
        {
          headers: t.Object({
            authorization: t.Optional(t.String()),
          }),
        },
      )

      // ========== TRANSPARENCY & COMPLIANCE ENDPOINTS ==========

      .get(
        '/transparency',
        async ({ query }) => {
          const now = Date.now()
          const day = 24 * 60 * 60 * 1000

          const period = (query.period as string) ?? '30d'
          let sinceTimestamp: number
          switch (period) {
            case '24h':
              sinceTimestamp = now - day
              break
            case '7d':
              sinceTimestamp = now - 7 * day
              break
            case '30d':
              sinceTimestamp = now - 30 * day
              break
            case '90d':
              sinceTimestamp = now - 90 * day
              break
            default:
              sinceTimestamp = now - 30 * day
          }

          const [metricsSummary, csamStats, pipeline] = await Promise.all([
            getMetricsSummary(sinceTimestamp),
            getCSAMReportStats(),
            Promise.resolve(getContentModerationPipeline()),
          ])

          const pipelineStats = pipeline.getStats()

          return {
            period,
            generatedAt: new Date().toISOString(),
            persistenceMode: getPersistenceMode(),
            contentModeration: metricsSummary,
            csamReports: csamStats,
            hashDatabase: {
              csamHashCount: pipelineStats.csamHashes,
              perceptualHashCount: pipelineStats.phashCount,
              malwareHashCount: pipelineStats.malwareHashes,
            },
            detectionCapabilities: {
              nsfwModel: pipelineStats.nsfwModel,
              externalProviders: pipelineStats.providers,
            },
          }
        },
        {
          query: t.Object({
            period: t.Optional(
              t.Union([
                t.Literal('24h'),
                t.Literal('7d'),
                t.Literal('30d'),
                t.Literal('90d'),
              ]),
            ),
          }),
          detail: { tags: ['moderation'], summary: 'Get transparency report' },
        },
      )

      .get(
        '/transparency/deterrence',
        () => ({
          warning: DETERRENCE_MESSAGES.warning,
          blocked: DETERRENCE_MESSAGES.blocked,
          support: DETERRENCE_MESSAGES.support,
        }),
        {
          detail: { tags: ['moderation'], summary: 'Get deterrence messages' },
        },
      )

      // ========== USER REPORTS ==========

      .post(
        '/user-report',
        async ({ body, set, headers }) => {
          const reporterIp = headers['x-forwarded-for'] ?? headers['x-real-ip']

          const report: UserReport = {
            reportId: crypto.randomUUID(),
            reporterAddress: body.reporterAddress as Address | undefined,
            reporterIp: typeof reporterIp === 'string' ? reporterIp : undefined,
            targetType: body.targetType,
            targetId: body.targetId,
            category: body.category,
            description: body.description,
            evidence: body.evidence,
            timestamp: Date.now(),
            status: 'pending',
          }

          await saveUserReport(report)

          set.status = 201
          return {
            success: true,
            reportId: report.reportId,
            message: 'Report submitted successfully',
          }
        },
        {
          body: t.Object({
            reporterAddress: t.Optional(
              t.String({ pattern: '^0x[a-fA-F0-9]{40}$' }),
            ),
            targetType: t.Union([
              t.Literal('content'),
              t.Literal('user'),
              t.Literal('domain'),
            ]),
            targetId: t.String({ minLength: 1, maxLength: 500 }),
            category: t.Union([
              t.Literal('csam'),
              t.Literal('spam'),
              t.Literal('scam'),
              t.Literal('harassment'),
              t.Literal('hate'),
              t.Literal('violence'),
              t.Literal('adult'),
              t.Literal('other'),
            ]),
            description: t.String({ minLength: 10, maxLength: 2000 }),
            evidence: t.Optional(t.Array(t.String())),
          }),
          detail: { tags: ['moderation'], summary: 'Submit a user report' },
        },
      )

      .get(
        '/user-reports',
        async ({ query, headers, set }) => {
          // Require internal auth for viewing reports
          const authHeader = headers.authorization
          if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
            set.status = 401
            return { error: 'Unauthorized' }
          }

          const reports = await getUserReports({
            status: query.status as UserReport['status'] | undefined,
            limit: query.limit ? parseInt(query.limit, 10) : 100,
          })

          return { reports, total: reports.length }
        },
        {
          query: t.Object({
            status: t.Optional(
              t.Union([
                t.Literal('pending'),
                t.Literal('reviewed'),
                t.Literal('actioned'),
                t.Literal('dismissed'),
              ]),
            ),
            limit: t.Optional(t.String()),
          }),
          headers: t.Object({
            authorization: t.Optional(t.String()),
          }),
          detail: { tags: ['moderation'], summary: 'Get user reports (admin)' },
        },
      )

      .post(
        '/user-reports/:reportId/review',
        async ({ params, body, headers, set }) => {
          const authHeader = headers.authorization
          if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
            set.status = 401
            return { error: 'Unauthorized' }
          }

          await updateUserReportStatus(
            params.reportId,
            body.status,
            body.reviewedBy as Address | undefined,
            body.action,
          )

          return { success: true, reportId: params.reportId }
        },
        {
          params: t.Object({
            reportId: t.String(),
          }),
          body: t.Object({
            status: t.Union([
              t.Literal('reviewed'),
              t.Literal('actioned'),
              t.Literal('dismissed'),
            ]),
            reviewedBy: t.Optional(
              t.String({ pattern: '^0x[a-fA-F0-9]{40}$' }),
            ),
            action: t.Optional(
              t.Union([
                t.Literal('none'),
                t.Literal('warning'),
                t.Literal('removed'),
                t.Literal('banned'),
              ]),
            ),
          }),
          headers: t.Object({
            authorization: t.Optional(t.String()),
          }),
          detail: {
            tags: ['moderation'],
            summary: 'Review a user report (admin)',
          },
        },
      )

      .get(
        '/user-reports/stats',
        async ({ headers, set }) => {
          const authHeader = headers.authorization
          if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
            set.status = 401
            return { error: 'Unauthorized' }
          }

          return getUserReportStats()
        },
        {
          headers: t.Object({
            authorization: t.Optional(t.String()),
          }),
          detail: {
            tags: ['moderation'],
            summary: 'Get user report stats (admin)',
          },
        },
      )

      // ========== TRUSTED FLAGGERS ==========

      .post(
        '/trusted-flagger',
        async ({ body, headers, set }) => {
          const authHeader = headers.authorization
          if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
            set.status = 401
            return { error: 'Unauthorized' }
          }

          const flagger: TrustedFlagger = {
            id: body.id ?? crypto.randomUUID(),
            name: body.name,
            type: body.type,
            apiKey: body.apiKey ?? crypto.randomUUID(),
            enabled: body.enabled ?? true,
            priority: body.priority,
            contactEmail: body.contactEmail,
            jurisdiction: body.jurisdiction,
          }

          await registerTrustedFlagger(flagger)

          set.status = 201
          return {
            success: true,
            id: flagger.id,
            apiKey: flagger.apiKey, // Return once on creation
            message: 'Trusted flagger registered',
          }
        },
        {
          body: t.Object({
            id: t.Optional(t.String()),
            name: t.String({ minLength: 1, maxLength: 200 }),
            type: t.Union([
              t.Literal('ngo'),
              t.Literal('law_enforcement'),
              t.Literal('regulatory'),
            ]),
            apiKey: t.Optional(t.String()),
            enabled: t.Optional(t.Boolean()),
            priority: t.Union([t.Literal('high'), t.Literal('urgent')]),
            contactEmail: t.String({ format: 'email' }),
            jurisdiction: t.Optional(t.Array(t.String())),
          }),
          headers: t.Object({
            authorization: t.Optional(t.String()),
          }),
          detail: {
            tags: ['moderation'],
            summary: 'Register a trusted flagger (admin)',
          },
        },
      )

      .get(
        '/trusted-flaggers',
        async ({ headers, set }) => {
          const authHeader = headers.authorization
          if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
            set.status = 401
            return { error: 'Unauthorized' }
          }

          const flaggers = await getAllTrustedFlaggers()
          return { flaggers }
        },
        {
          headers: t.Object({
            authorization: t.Optional(t.String()),
          }),
          detail: {
            tags: ['moderation'],
            summary: 'List trusted flaggers (admin)',
          },
        },
      )

      .post(
        '/trusted-flagger/report',
        async ({ body, headers, set }) => {
          // Authenticate trusted flagger by API key
          const apiKey = headers['x-flagger-api-key']
          if (!apiKey || typeof apiKey !== 'string') {
            set.status = 401
            return { error: 'Missing X-Flagger-API-Key header' }
          }

          const flagger = await getTrustedFlagger(apiKey)
          if (!flagger) {
            set.status = 401
            return { error: 'Invalid or disabled API key' }
          }

          // Create prioritized report
          const report: UserReport = {
            reportId: crypto.randomUUID(),
            targetType: body.targetType,
            targetId: body.targetId,
            category: body.category,
            description: `[TRUSTED FLAGGER: ${flagger.name}] ${body.description}`,
            evidence: body.evidence,
            timestamp: Date.now(),
            status: 'pending',
          }

          await saveUserReport(report)

          // For urgent priority, auto-escalate
          if (flagger.priority === 'urgent') {
            // Queue for immediate action
            const queueItem: QueuedAction = {
              id: `flagger-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              type: 'review',
              target: '0x0' as Address,
              reason: report.description,
              service: 'trusted-flagger',
              priority: 'urgent',
              createdAt: Date.now(),
              attempts: 0,
              data: { reportId: report.reportId, flaggerId: flagger.id },
            }
            moderationQueue.unshift(queueItem) // Add to front
          }

          return {
            success: true,
            reportId: report.reportId,
            priority: flagger.priority,
            message:
              flagger.priority === 'urgent'
                ? 'Urgent report queued for immediate review'
                : 'Report submitted with high priority',
          }
        },
        {
          body: t.Object({
            targetType: t.Union([
              t.Literal('content'),
              t.Literal('user'),
              t.Literal('domain'),
            ]),
            targetId: t.String({ minLength: 1, maxLength: 500 }),
            category: t.Union([
              t.Literal('csam'),
              t.Literal('spam'),
              t.Literal('scam'),
              t.Literal('harassment'),
              t.Literal('hate'),
              t.Literal('violence'),
              t.Literal('adult'),
              t.Literal('other'),
            ]),
            description: t.String({ minLength: 10, maxLength: 5000 }),
            evidence: t.Optional(t.Array(t.String())),
          }),
          headers: t.Object({
            'x-flagger-api-key': t.Optional(t.String()),
          }),
          detail: {
            tags: ['moderation'],
            summary: 'Submit report as trusted flagger',
          },
        },
      )
  )
}

export type ModerationRoutes = ReturnType<typeof createModerationRouter>
export default createModerationRouter
