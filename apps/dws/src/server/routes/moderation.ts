/**
 * DWS Moderation Routes
 *
 * Decentralized moderation system integration:
 * - Ban requests from email, messaging, and other services
 * - Integration with ModerationMarketplace contract
 * - Queue management for offline/async processing
 * - Appeal handling
 */

import { Hono } from 'hono'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  parseAbiItem,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'
import { expectValid } from '../../shared/validation'

// ============ Configuration ============

interface ModerationConfig {
  rpcUrl: string
  chainId: number
  moderationMarketplaceAddress: Address
  banManagerAddress: Address
  operatorPrivateKey?: Hex
}

const getConfig = (): ModerationConfig => ({
  rpcUrl: process.env.JEJU_RPC_URL ?? 'http://localhost:6545',
  chainId: parseInt(process.env.CHAIN_ID ?? '31337', 10),
  moderationMarketplaceAddress: (process.env.MODERATION_MARKETPLACE_ADDRESS ??
    '0x0') as Address,
  banManagerAddress: (process.env.BAN_MANAGER_ADDRESS ?? '0x0') as Address,
  operatorPrivateKey: process.env.OPERATOR_PRIVATE_KEY as Hex | undefined,
})

// ============ Schemas ============

const banRequestSchema = z.object({
  target: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  reason: z.string().min(10).max(1000),
  service: z.enum(['email', 'messaging', 'content', 'general']),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  autoban: z.boolean().default(false),
  evidence: z
    .object({
      timestamp: z.number(),
      type: z.string(),
      contentHashes: z.array(z.string()).optional(),
      screenshotUrls: z.array(z.string()).optional(),
    })
    .optional(),
})

const reviewRequestSchema = z.object({
  service: z.string(),
  target: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  review: z.object({
    reason: z.string(),
    analysis: z.object({
      totalEmails: z.number().optional(),
      flaggedEmails: z.number().optional(),
      flaggedPercentage: z.number().optional(),
      violations: z
        .array(
          z.object({
            type: z.string(),
            count: z.number(),
            severity: z.string(),
            description: z.string(),
          }),
        )
        .optional(),
      overallAssessment: z.string(),
      llmReasoning: z.string().optional(),
    }),
    recommendation: z.enum(['allow', 'warn', 'suspend', 'ban']),
    confidence: z.number().min(0).max(1),
    timestamp: z.number(),
  }),
  autoAction: z.boolean().default(false),
})

const appealSchema = z.object({
  caseId: z.string(),
  reason: z.string().min(50).max(2000),
  evidence: z.string().optional(),
  stakeAmount: z.string().optional(), // BigInt as string
})

const queueItemSchema = z.object({
  target: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  reason: z.string(),
  service: z.string(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  evidence: z
    .object({
      timestamp: z.number(),
      type: z.string(),
    })
    .optional(),
})

// ============ Contract ABIs ============

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

// ============ Moderation Queue ============

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

// ============ Router ============

export function createModerationRouter(): Hono {
  const app = new Hono()
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

  // ============ Health Check ============

  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      queueLength: moderationQueue.length,
      moderationMarketplace: config.moderationMarketplaceAddress,
      banManager: config.banManagerAddress,
    })
  })

  // ============ Ban Endpoint ============

  app.post('/ban', async (c) => {
    const body = await c.req.json()
    const request = expectValid(banRequestSchema, body, 'Ban request')

    const target = request.target as Address

    // Check if already banned
    const isBanned = await publicClient
      .readContract({
        address: config.banManagerAddress,
        abi: BAN_MANAGER_ABI,
        functionName: 'isAddressBanned',
        args: [target],
      })
      .catch(() => false)

    if (isBanned) {
      return c.json({
        success: true,
        alreadyBanned: true,
        message: 'Target is already banned',
      })
    }

    // For critical severity with autoban, execute immediately
    if (request.severity === 'critical' && request.autoban) {
      try {
        const walletClient = getWalletClient()

        const hash = await walletClient.writeContract({
          address: config.moderationMarketplaceAddress,
          abi: MODERATION_MARKETPLACE_ABI,
          functionName: 'reportAndBan',
          args: [target, request.reason],
          chain: null,
        })

        console.log(
          `[Moderation] Immediate ban executed for ${target}: ${hash}`,
        )

        return c.json({
          success: true,
          transactionHash: hash,
          message: 'Ban executed immediately due to critical severity',
        })
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
      reason: request.reason,
      service: request.service,
      priority:
        request.severity === 'critical'
          ? 'urgent'
          : request.severity === 'high'
            ? 'high'
            : 'normal',
      createdAt: Date.now(),
      attempts: 0,
      data: { evidence: request.evidence },
    }

    moderationQueue.push(queueItem)

    // Sort by priority
    moderationQueue.sort((a, b) => {
      const priorities = { urgent: 0, high: 1, normal: 2, low: 3 }
      return priorities[a.priority] - priorities[b.priority]
    })

    console.log(`[Moderation] Ban request queued: ${queueItem.id}`)

    return c.json({
      success: true,
      queued: true,
      queueId: queueItem.id,
      message: 'Ban request queued for processing',
    })
  })

  // ============ Review Submission ============

  app.post('/submit-review', async (c) => {
    const body = await c.req.json()
    const request = expectValid(reviewRequestSchema, body, 'Review request')

    const target = request.target as Address

    // If high-confidence ban recommendation with autoAction, execute
    if (
      request.review.recommendation === 'ban' &&
      request.review.confidence > 0.9 &&
      request.autoAction
    ) {
      try {
        const walletClient = getWalletClient()

        const reasonWithAnalysis = `${request.review.reason} | Analysis: ${request.review.analysis.overallAssessment}`

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

        return c.json({
          success: true,
          transactionHash: hash,
          action: 'banned',
          message: 'Auto-ban executed based on review recommendation',
        })
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
      reason: request.review.reason,
      service: request.service,
      priority: request.review.recommendation === 'ban' ? 'high' : 'normal',
      createdAt: Date.now(),
      attempts: 0,
      data: { review: request.review },
    }

    moderationQueue.push(queueItem)

    console.log(`[Moderation] Review submitted: ${queueItem.id}`)

    return c.json({
      success: true,
      queued: true,
      queueId: queueItem.id,
      recommendation: request.review.recommendation,
      confidence: request.review.confidence,
    })
  })

  // ============ Queue Management ============

  app.post('/queue', async (c) => {
    const body = await c.req.json()
    const request = expectValid(queueItemSchema, body, 'Queue request')

    const queueItem: QueuedAction = {
      id: `queue-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: 'review',
      target: request.target as Address,
      reason: request.reason,
      service: request.service,
      priority: request.priority,
      createdAt: Date.now(),
      attempts: 0,
      data: { evidence: request.evidence },
    }

    moderationQueue.push(queueItem)

    return c.json({ success: true, queueId: queueItem.id })
  })

  app.get('/queue', (c) => {
    return c.json({
      length: moderationQueue.length,
      items: moderationQueue.slice(0, 100),
    })
  })

  // ============ Ban Status ============

  app.get('/status/:address', async (c) => {
    const address = c.req.param('address') as Address

    const [isBanned, banStatus] = await Promise.all([
      publicClient
        .readContract({
          address: config.banManagerAddress,
          abi: BAN_MANAGER_ABI,
          functionName: 'isAddressBanned',
          args: [address],
        })
        .catch(() => false),
      publicClient
        .readContract({
          address: config.moderationMarketplaceAddress,
          abi: MODERATION_MARKETPLACE_ABI,
          functionName: 'getBanStatus',
          args: [address],
        })
        .catch(() => 0),
    ])

    // Status enum: 0=NONE, 1=ON_NOTICE, 2=CHALLENGED, 3=BANNED, 4=CLEARED, 5=APPEALING
    const statusNames = [
      'none',
      'on_notice',
      'challenged',
      'banned',
      'cleared',
      'appealing',
    ]

    return c.json({
      address,
      isBanned,
      status: statusNames[banStatus as number] ?? 'unknown',
      statusCode: banStatus,
    })
  })

  // ============ Appeal ============

  app.post('/appeal', async (c) => {
    const body = await c.req.json()
    const request = expectValid(appealSchema, body, 'Appeal request')

    const queueItem: QueuedAction = {
      id: `appeal-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: 'appeal',
      target: '0x0' as Address, // Will be resolved from caseId
      reason: request.reason,
      service: 'appeal',
      priority: 'normal',
      createdAt: Date.now(),
      attempts: 0,
      data: {
        caseId: request.caseId,
        evidence: request.evidence,
        stakeAmount: request.stakeAmount,
      },
    }

    moderationQueue.push(queueItem)

    return c.json({
      success: true,
      queueId: queueItem.id,
      message: 'Appeal queued for processing',
    })
  })

  // ============ Process Queue (internal) ============

  app.post('/process-queue', async (c) => {
    // This would typically be called by a cron job or worker
    const authHeader = c.req.header('Authorization')
    if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
      return c.json({ error: 'Unauthorized' }, 401)
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

    return c.json({
      processed,
      remaining: moderationQueue.length,
      errors: errors.length > 0 ? errors : undefined,
    })
  })

  return app
}

export default createModerationRouter
