import { Elysia } from 'elysia'
import { type Address, createPublicClient, type Hex, http } from 'viem'
import { baseSepolia } from 'viem/chains'
import {
  BAN_MANAGER_ADDRESS,
  MODERATION_MARKETPLACE_ADDRESS,
  REPORTING_SYSTEM_ADDRESS,
  REPUTATION_LABEL_MANAGER_ADDRESS,
} from '../config/contracts.js'
import { getRpcUrl } from '../config/networks.js'
import { clearBanCache } from '../middleware/ban-check.js'

const BAN_MANAGER_ABI = [
  {
    name: 'isAddressBanned',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'target', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'isOnNotice',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'target', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'isAgentBanned',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'getAddressBan',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'target', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'isBanned', type: 'bool' },
          { name: 'banType', type: 'uint8' },
          { name: 'bannedAt', type: 'uint256' },
          { name: 'expiresAt', type: 'uint256' },
          { name: 'reason', type: 'string' },
          { name: 'proposalId', type: 'bytes32' },
          { name: 'reporter', type: 'address' },
          { name: 'caseId', type: 'bytes32' },
        ],
      },
    ],
  },
] as const

const MODERATION_MARKETPLACE_ABI = [
  {
    name: 'getBanCase',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'caseId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'caseId', type: 'bytes32' },
          { name: 'reporter', type: 'address' },
          { name: 'target', type: 'address' },
          { name: 'reporterStake', type: 'uint256' },
          { name: 'targetStake', type: 'uint256' },
          { name: 'reason', type: 'string' },
          { name: 'evidenceHash', type: 'bytes32' },
          { name: 'status', type: 'uint8' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'marketOpenUntil', type: 'uint256' },
          { name: 'yesVotes', type: 'uint256' },
          { name: 'noVotes', type: 'uint256' },
          { name: 'totalPot', type: 'uint256' },
          { name: 'resolved', type: 'bool' },
          { name: 'outcome', type: 'uint8' },
          { name: 'appealCount', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'getModeratorReputation',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'moderator', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'successfulBans', type: 'uint256' },
          { name: 'unsuccessfulBans', type: 'uint256' },
          { name: 'totalSlashedFrom', type: 'uint256' },
          { name: 'totalSlashedOthers', type: 'uint256' },
          { name: 'reputationScore', type: 'uint256' },
          { name: 'lastReportTimestamp', type: 'uint256' },
          { name: 'reportCooldownUntil', type: 'uint256' },
          { name: 'dailyReportCount', type: 'uint256' },
          { name: 'weeklyReportCount', type: 'uint256' },
          { name: 'reportDayStart', type: 'uint256' },
          { name: 'reportWeekStart', type: 'uint256' },
          { name: 'consecutiveWins', type: 'uint256' },
          { name: 'lastActivityTimestamp', type: 'uint256' },
          { name: 'activeReportCount', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'stakes',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'staker', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'amount', type: 'uint256' },
          { name: 'stakedAt', type: 'uint256' },
          { name: 'stakedBlock', type: 'uint256' },
          { name: 'lastActivityBlock', type: 'uint256' },
          { name: 'isStaked', type: 'bool' },
        ],
      },
    ],
  },
  {
    name: 'getReputationTier',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'getRequiredStakeForReporter',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'reporter', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

const REPORTING_SYSTEM_ABI = [
  {
    name: 'getReport',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'reportId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'reportId', type: 'uint256' },
          { name: 'reportType', type: 'uint8' },
          { name: 'severity', type: 'uint8' },
          { name: 'targetAgentId', type: 'uint256' },
          { name: 'sourceAppId', type: 'bytes32' },
          { name: 'reporter', type: 'address' },
          { name: 'reporterStake', type: 'uint256' },
          { name: 'evidenceHash', type: 'bytes32' },
          { name: 'details', type: 'string' },
          { name: 'status', type: 'uint8' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'resolvedAt', type: 'uint256' },
          { name: 'caseId', type: 'bytes32' },
        ],
      },
    ],
  },
  {
    name: 'reportCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

const REPUTATION_LABEL_ABI = [
  {
    name: 'getLabels',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }], // Bitmask of labels
  },
  {
    name: 'hasLabel',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'label', type: 'uint8' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

interface BanRecord {
  isBanned: boolean
  banType: number
  bannedAt: bigint
  expiresAt: bigint
  reason: string
  proposalId: Hex
  reporter: Address
  caseId: Hex
}

interface CaseRecord {
  caseId: Hex
  reporter: Address
  target: Address
  reporterStake: bigint
  targetStake: bigint
  reason: string
  evidenceHash: Hex
  status: number
  createdAt: bigint
  marketOpenUntil: bigint
  yesVotes: bigint
  noVotes: bigint
  totalPot: bigint
  resolved: boolean
  outcome: number
  appealCount: bigint
}

interface ReputationRecord {
  successfulBans: bigint
  unsuccessfulBans: bigint
  totalSlashedFrom: bigint
  totalSlashedOthers: bigint
  reputationScore: bigint
  lastReportTimestamp: bigint
  reportCooldownUntil: bigint
  dailyReportCount: bigint
  weeklyReportCount: bigint
  reportDayStart: bigint
  reportWeekStart: bigint
  consecutiveWins: bigint
  lastActivityTimestamp: bigint
  activeReportCount: bigint
}

interface StakeRecord {
  amount: bigint
  stakedAt: bigint
  stakedBlock: bigint
  lastActivityBlock: bigint
  isStaked: boolean
}

interface ReportRecord {
  reportId: bigint
  reportType: number
  severity: number
  targetAgentId: bigint
  sourceAppId: Hex
  reporter: Address
  reporterStake: bigint
  evidenceHash: Hex
  details: string
  status: number
  createdAt: bigint
  resolvedAt: bigint
  caseId: Hex
}

interface CacheClearBody {
  address?: Address
}

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(getRpcUrl(84532)),
})

export const moderationPlugin = new Elysia({
  name: 'moderation',
  prefix: '/api/moderation',
})
  // ============ BAN STATUS ENDPOINTS ============

  /**
   * GET /api/moderation/ban/:address
   * Check if an address is banned
   */
  .get('/ban/:address', async ({ params, set }) => {
    const { address } = params

    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      set.status = 400
      return { error: 'Invalid address format' }
    }

    const [isBanned, isOnNotice, banRecord] = await Promise.all([
      publicClient.readContract({
        address: BAN_MANAGER_ADDRESS,
        abi: BAN_MANAGER_ABI,
        functionName: 'isAddressBanned',
        args: [address as Address],
      }),
      publicClient.readContract({
        address: BAN_MANAGER_ADDRESS,
        abi: BAN_MANAGER_ABI,
        functionName: 'isOnNotice',
        args: [address as Address],
      }),
      publicClient.readContract({
        address: BAN_MANAGER_ADDRESS,
        abi: BAN_MANAGER_ABI,
        functionName: 'getAddressBan',
        args: [address as Address],
      }),
    ])

    const record = banRecord as BanRecord

    return {
      address,
      isBanned,
      isOnNotice,
      banDetails: {
        banType: record.banType,
        bannedAt: record.bannedAt.toString(),
        expiresAt: record.expiresAt.toString(),
        reason: record.reason,
        caseId: record.caseId,
        reporter: record.reporter,
      },
    }
  })

  /**
   * GET /api/moderation/agent/:agentId/banned
   * Check if an agent is banned
   */
  .get('/agent/:agentId/banned', async ({ params }) => {
    const { agentId } = params

    const isBanned = await publicClient.readContract({
      address: BAN_MANAGER_ADDRESS,
      abi: BAN_MANAGER_ABI,
      functionName: 'isAgentBanned',
      args: [BigInt(agentId)],
    })

    return {
      agentId,
      isBanned,
    }
  })

  // ============ CASE ENDPOINTS ============

  /**
   * GET /api/moderation/case/:caseId
   * Get details of a moderation case
   */
  .get('/case/:caseId', async ({ params, set }) => {
    const { caseId } = params

    if (!/^0x[a-fA-F0-9]{64}$/.test(caseId)) {
      set.status = 400
      return { error: 'Invalid caseId format' }
    }

    const caseData = await publicClient.readContract({
      address: MODERATION_MARKETPLACE_ADDRESS,
      abi: MODERATION_MARKETPLACE_ABI,
      functionName: 'getBanCase',
      args: [caseId as Hex],
    })

    const record = caseData as CaseRecord

    return {
      caseId: record.caseId,
      reporter: record.reporter,
      target: record.target,
      reporterStake: record.reporterStake.toString(),
      targetStake: record.targetStake.toString(),
      reason: record.reason,
      evidenceHash: record.evidenceHash,
      status: [
        'NONE',
        'ON_NOTICE',
        'CHALLENGED',
        'BANNED',
        'CLEARED',
        'APPEALING',
      ][record.status],
      createdAt: record.createdAt.toString(),
      marketOpenUntil: record.marketOpenUntil.toString(),
      votingEndsIn: Math.max(
        0,
        Number(record.marketOpenUntil) - Math.floor(Date.now() / 1000),
      ),
      yesVotes: record.yesVotes.toString(),
      noVotes: record.noVotes.toString(),
      totalPot: record.totalPot.toString(),
      resolved: record.resolved,
      outcome: ['PENDING', 'BAN_UPHELD', 'BAN_REJECTED'][record.outcome],
      appealCount: Number(record.appealCount),
    }
  })

  // ============ REPUTATION ENDPOINTS ============

  /**
   * GET /api/moderation/reputation/:address
   * Get moderator reputation
   */
  .get('/reputation/:address', async ({ params, set }) => {
    const { address } = params

    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      set.status = 400
      return { error: 'Invalid address format' }
    }

    const [reputation, tier, requiredStake, stakeInfo] = await Promise.all([
      publicClient.readContract({
        address: MODERATION_MARKETPLACE_ADDRESS,
        abi: MODERATION_MARKETPLACE_ABI,
        functionName: 'getModeratorReputation',
        args: [address as Address],
      }),
      publicClient.readContract({
        address: MODERATION_MARKETPLACE_ADDRESS,
        abi: MODERATION_MARKETPLACE_ABI,
        functionName: 'getReputationTier',
        args: [address as Address],
      }),
      publicClient.readContract({
        address: MODERATION_MARKETPLACE_ADDRESS,
        abi: MODERATION_MARKETPLACE_ABI,
        functionName: 'getRequiredStakeForReporter',
        args: [address as Address],
      }),
      publicClient.readContract({
        address: MODERATION_MARKETPLACE_ADDRESS,
        abi: MODERATION_MARKETPLACE_ABI,
        functionName: 'stakes',
        args: [address as Address],
      }),
    ])

    const rep = reputation as ReputationRecord
    const stake = stakeInfo as StakeRecord

    const tierNames = ['UNTRUSTED', 'LOW', 'MEDIUM', 'HIGH', 'TRUSTED']

    return {
      address,
      reputation: {
        score: Number(rep.reputationScore),
        tier: tierNames[tier as number] || 'UNKNOWN',
        successfulBans: Number(rep.successfulBans),
        unsuccessfulBans: Number(rep.unsuccessfulBans),
        winRate:
          rep.successfulBans + rep.unsuccessfulBans > 0n
            ? Number(
                (rep.successfulBans * 100n) /
                  (rep.successfulBans + rep.unsuccessfulBans),
              )
            : 0,
        pnl: {
          earned: rep.totalSlashedOthers.toString(),
          lost: rep.totalSlashedFrom.toString(),
          net: (rep.totalSlashedOthers - rep.totalSlashedFrom).toString(),
        },
        consecutiveWins: Number(rep.consecutiveWins),
        activeReports: Number(rep.activeReportCount),
      },
      stake: {
        amount: stake.amount.toString(),
        stakedAt: stake.stakedAt.toString(),
        isStaked: stake.isStaked,
      },
      requiredStakeToReport: (requiredStake as bigint).toString(),
      canReport: stake.amount >= (requiredStake as bigint),
    }
  })

  // ============ REPORT ENDPOINTS ============

  /**
   * GET /api/moderation/report/:reportId
   * Get details of a report
   */
  .get('/report/:reportId', async ({ params }) => {
    const { reportId } = params

    const report = await publicClient.readContract({
      address: REPORTING_SYSTEM_ADDRESS,
      abi: REPORTING_SYSTEM_ABI,
      functionName: 'getReport',
      args: [BigInt(reportId)],
    })

    const r = report as ReportRecord

    const reportTypes = [
      'NETWORK_BAN',
      'APP_BAN',
      'LABEL_HACKER',
      'LABEL_SCAMMER',
    ]
    const severities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
    const statuses = ['PENDING', 'RESOLVED_YES', 'RESOLVED_NO', 'EXECUTED']

    return {
      reportId: r.reportId.toString(),
      reportType: reportTypes[r.reportType] || 'UNKNOWN',
      severity: severities[r.severity] || 'UNKNOWN',
      targetAgentId: r.targetAgentId.toString(),
      sourceAppId: r.sourceAppId,
      reporter: r.reporter,
      reporterStake: r.reporterStake.toString(),
      evidenceHash: r.evidenceHash,
      details: r.details,
      status: statuses[r.status] || 'UNKNOWN',
      createdAt: r.createdAt.toString(),
      resolvedAt: r.resolvedAt.toString(),
      caseId: r.caseId,
    }
  })

  /**
   * GET /api/moderation/stats
   * Get moderation system stats
   */
  .get('/stats', async () => {
    const reportCount = await publicClient.readContract({
      address: REPORTING_SYSTEM_ADDRESS,
      abi: REPORTING_SYSTEM_ABI,
      functionName: 'reportCount',
      args: [],
    })

    return {
      totalReports: reportCount.toString(),
      contracts: {
        banManager: BAN_MANAGER_ADDRESS,
        moderationMarketplace: MODERATION_MARKETPLACE_ADDRESS,
        reportingSystem: REPORTING_SYSTEM_ADDRESS,
        reputationLabelManager: REPUTATION_LABEL_MANAGER_ADDRESS,
      },
      network: 'base-sepolia',
      chainId: 84532,
    }
  })

  // ============ LABELS ENDPOINTS ============

  /**
   * GET /api/moderation/labels/:agentId
   * Get reputation labels for an agent
   */
  .get('/labels/:agentId', async ({ params }) => {
    const { agentId } = params

    const labelBitmask = (await publicClient.readContract({
      address: REPUTATION_LABEL_MANAGER_ADDRESS,
      abi: REPUTATION_LABEL_ABI,
      functionName: 'getLabels',
      args: [BigInt(agentId)],
    })) as bigint

    const labels: string[] = []
    const labelNames = [
      'NONE',
      'HACKER',
      'SCAMMER',
      'SPAM_BOT',
      'TRUSTED',
      'VERIFIED',
    ]

    for (let i = 0; i < labelNames.length; i++) {
      if (labelBitmask & (1n << BigInt(i))) {
        labels.push(labelNames[i])
      }
    }

    return {
      agentId,
      labelBitmask: labelBitmask.toString(),
      labels,
      hasNegativeLabel:
        labels.includes('HACKER') ||
        labels.includes('SCAMMER') ||
        labels.includes('SPAM_BOT'),
      hasPositiveLabel:
        labels.includes('TRUSTED') || labels.includes('VERIFIED'),
    }
  })

  // ============ CACHE MANAGEMENT ============

  /**
   * POST /api/moderation/cache/clear
   * Clear ban cache (admin only)
   */
  .post('/cache/clear', ({ body }) => {
    const { address } = body as CacheClearBody
    clearBanCache(address)
    return { success: true, cleared: address || 'all' }
  })

export { moderationPlugin as moderationRouter }
