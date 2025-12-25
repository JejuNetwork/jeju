/**
 * DWS Moderation Routes
 *
 * Decentralized moderation system integration:
 * - Ban requests from email, messaging, and other services
 * - Integration with ModerationMarketplace contract
 * - Queue management for offline/async processing
 * - Appeal handling
 */

import { getChainId, getRpcUrl } from '@jejunetwork/config'
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

const getConfig = (): ModerationConfig => ({
  rpcUrl: getRpcUrl(),
  chainId: getChainId(),
  moderationMarketplaceAddress: (process.env.MODERATION_MARKETPLACE_ADDRESS ??
    '0x0') as Address,
  banManagerAddress: (process.env.BAN_MANAGER_ADDRESS ?? '0x0') as Address,
  operatorPrivateKey: process.env.OPERATOR_PRIVATE_KEY as Hex | undefined,
})
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

  return new Elysia({ name: 'moderation', prefix: '/moderation' })

    .get('/health', () => ({
      status: 'ok',
      queueLength: moderationQueue.length,
      moderationMarketplace: config.moderationMarketplaceAddress,
      banManager: config.banManagerAddress,
    }))
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
}

export type ModerationRoutes = ReturnType<typeof createModerationRouter>
export default createModerationRouter
