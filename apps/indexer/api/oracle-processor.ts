/**
 * Oracle Processor - Indexes Oracle Network (JON) events
 */

import type { Store } from '@subsquid/typeorm-store'
import type { Hex } from 'viem'
import { keccak256, parseAbi, stringToHex } from 'viem'
import {
  OracleAttestation,
  OracleCommitteeMember,
  OracleDispute,
  OracleDisputeOutcome,
  OracleDisputeStatus,
  OracleFeed,
  OracleFeedCategory,
  OracleOperator,
  OracleReport,
  OracleSubscription,
} from './model'
import type { ProcessorContext } from './processor'
import { createAccountFactory } from './utils/entities'
import { decodeEventArgs, isEventInSet } from './utils/hex'

const EVENTS = {
  FEED_CREATED: keccak256(
    stringToHex('FeedCreated(bytes32,string,address,address,address)'),
  ),
  FEED_ACTIVATED: keccak256(stringToHex('FeedActivated(bytes32)')),
  FEED_DEACTIVATED: keccak256(stringToHex('FeedDeactivated(bytes32)')),
  FEED_UPDATED: keccak256(stringToHex('FeedUpdated(bytes32,string)')),
  OPERATOR_REGISTERED: keccak256(
    stringToHex('OperatorRegistered(bytes32,bytes32,uint256,address)'),
  ),
  OPERATOR_DEACTIVATED: keccak256(
    stringToHex('OperatorDeactivated(bytes32,string)'),
  ),
  PERFORMANCE_RECORDED: keccak256(
    stringToHex('PerformanceRecorded(bytes32,uint256,uint256,uint256)'),
  ),
  ATTESTATION_WRITTEN: keccak256(
    stringToHex('AttestationWritten(bytes32,uint256,bytes32,int8)'),
  ),
  EPOCH_ADVANCED: keccak256(stringToHex('EpochAdvanced(uint256,uint256)')),
  COMMITTEE_FORMED: keccak256(
    stringToHex('CommitteeFormed(bytes32,uint256,address[],address,uint256)'),
  ),
  COMMITTEE_ROTATED: keccak256(
    stringToHex('CommitteeRotated(bytes32,uint256,uint256)'),
  ),
  MEMBER_ADDED: keccak256(stringToHex('MemberAdded(bytes32,uint256,address)')),
  MEMBER_REMOVED: keccak256(
    stringToHex('MemberRemoved(bytes32,uint256,address,string)'),
  ),
  LEADER_ROTATED: keccak256(
    stringToHex('LeaderRotated(bytes32,uint256,address)'),
  ),

  // ReportVerifier events
  REPORT_SUBMITTED: keccak256(
    stringToHex(
      'ReportSubmitted(bytes32,bytes32,uint256,uint256,uint256,uint256)',
    ),
  ),
  REPORT_VERIFIED: keccak256(
    stringToHex('ReportVerified(bytes32,bytes32,uint256,uint256)'),
  ),
  REPORT_REJECTED: keccak256(
    stringToHex('ReportRejected(bytes32,bytes32,string)'),
  ),
  CONSENSUS_UPDATED: keccak256(
    stringToHex('ConsensusUpdated(bytes32,uint256,uint256,uint256)'),
  ),

  // DisputeGame events
  DISPUTE_OPENED: keccak256(
    stringToHex('DisputeOpened(bytes32,bytes32,bytes32,address,uint256,uint8)'),
  ),
  DISPUTE_CHALLENGED: keccak256(
    stringToHex('DisputeChallenged(bytes32,address,uint256)'),
  ),
  DISPUTE_RESOLVED: keccak256(
    stringToHex('DisputeResolved(bytes32,uint8,uint256,uint256)'),
  ),
  DISPUTE_ESCALATED: keccak256(
    stringToHex('DisputeEscalated(bytes32,bytes32)'),
  ),
  DISPUTE_EXPIRED: keccak256(stringToHex('DisputeExpired(bytes32)')),
  SIGNERS_SLASHED: keccak256(
    stringToHex('SignersSlashed(bytes32,address[],uint256)'),
  ),
  DISPUTER_REWARDED: keccak256(
    stringToHex('DisputerRewarded(bytes32,address,uint256)'),
  ),

  // OracleFeeRouter events
  SUBSCRIPTION_CREATED: keccak256(
    stringToHex(
      'SubscriptionCreated(bytes32,address,bytes32[],uint256,uint256)',
    ),
  ),
  SUBSCRIPTION_RENEWED: keccak256(
    stringToHex('SubscriptionRenewed(bytes32,uint256,uint256)'),
  ),
  SUBSCRIPTION_CANCELLED: keccak256(
    stringToHex('SubscriptionCancelled(bytes32,uint256)'),
  ),
  READ_FEE_PAID: keccak256(stringToHex('ReadFeePaid(bytes32,address,uint256)')),
  REWARDS_DISTRIBUTED: keccak256(
    stringToHex('RewardsDistributed(uint256,uint256,uint256,uint256)'),
  ),
  REWARDS_CLAIMED: keccak256(
    stringToHex('RewardsClaimed(bytes32,address,uint256)'),
  ),
  DELEGATOR_REWARDS_CLAIMED: keccak256(
    stringToHex('DelegatorRewardsClaimed(address,bytes32,uint256)'),
  ),
} as const

const ORACLE_EVENT_SET: Set<Hex> = new Set(Object.values(EVENTS))

// ABI interfaces for oracle events
const ABI = {
  registry: parseAbi([
    'event FeedCreated(bytes32 indexed feedId, string symbol, address baseToken, address quoteToken, address creator)',
    'event FeedActivated(bytes32 indexed feedId)',
    'event FeedDeactivated(bytes32 indexed feedId)',
  ]),
  connector: parseAbi([
    'event OperatorRegistered(bytes32 indexed operatorId, bytes32 indexed stakingOracleId, uint256 agentId, address workerKey)',
    'event OperatorDeactivated(bytes32 indexed operatorId, string reason)',
    'event PerformanceRecorded(bytes32 indexed operatorId, uint256 indexed epoch, uint256 reportsSubmitted, uint256 reportsAccepted)',
    'event AttestationWritten(bytes32 indexed operatorId, uint256 indexed agentId, bytes32 tag, int8 score)',
  ]),
  committee: parseAbi([
    'event CommitteeFormed(bytes32 indexed feedId, uint256 indexed round, address[] members, address leader, uint256 activeUntil)',
    'event MemberAdded(bytes32 indexed feedId, uint256 indexed round, address indexed member)',
    'event MemberRemoved(bytes32 indexed feedId, uint256 indexed round, address indexed member, string reason)',
  ]),
  reporting: parseAbi([
    'event ReportSubmitted(bytes32 indexed feedId, bytes32 reportHash, uint256 price, uint256 confidence, uint256 round, uint256 signatureCount)',
    'event ReportVerified(bytes32 indexed feedId, bytes32 indexed reportHash, uint256 price, uint256 timestamp)',
    'event ConsensusUpdated(bytes32 indexed feedId, uint256 price, uint256 confidence, uint256 round)',
  ]),
  dispute: parseAbi([
    'event DisputeOpened(bytes32 indexed disputeId, bytes32 reportHash, bytes32 feedId, address disputer, uint256 bond, uint8 reason)',
    'event DisputeChallenged(bytes32 indexed disputeId, address challenger, uint256 additionalBond)',
    'event DisputeResolved(bytes32 indexed disputeId, uint8 outcome, uint256 slashedAmount, uint256 reward)',
    'event DisputeExpired(bytes32 indexed disputeId)',
  ]),
  subscription: parseAbi([
    'event SubscriptionCreated(bytes32 indexed subscriptionId, address indexed subscriber, bytes32[] feedIds, uint256 duration, uint256 amountPaid)',
    'event SubscriptionCancelled(bytes32 indexed subscriptionId, uint256 refundAmount)',
    'event RewardsClaimed(bytes32 indexed operatorId, address indexed recipient, uint256 amount)',
  ]),
}

export function isOracleEvent(topic0: string): boolean {
  return isEventInSet(topic0, ORACLE_EVENT_SET)
}

// Category detection via keyword matching
// Event argument interfaces
interface FeedCreatedArgs {
  feedId: string
  symbol: string
  baseToken: string
  quoteToken: string
  creator: string
}

interface OperatorRegisteredArgs {
  operatorId: string
  stakingOracleId: string
  agentId: bigint
  workerKey: string
}

interface PerformanceRecordedArgs {
  operatorId: string
  epoch: bigint
  reportsSubmitted: bigint
  reportsAccepted: bigint
}

interface CommitteeFormedArgs {
  feedId: string
  round: bigint
  members: readonly string[]
  leader: string
  activeUntil: bigint
}

interface ReportSubmittedArgs {
  feedId: string
  reportHash: string
  price: bigint
  confidence: bigint
  round: bigint
  signatureCount: bigint
}

interface DisputeOpenedArgs {
  disputeId: string
  reportHash: string
  feedId: string
  disputer: string
  bond: bigint
  reason: number
}

interface DisputeChallengedArgs {
  disputeId: string
  challenger: string
  additionalBond: bigint
}

interface DisputeResolvedArgs {
  disputeId: string
  outcome: number
  slashedAmount: bigint
  reward: bigint
}

interface SubscriptionCreatedArgs {
  subscriptionId: string
  subscriber: string
  feedIds: readonly string[]
  duration: bigint
  amountPaid: bigint
}

interface AttestationWrittenArgs {
  operatorId: string
  agentId: bigint
  tag: string
  score: number
}

const CATEGORY_PATTERNS: Array<[RegExp, OracleFeedCategory]> = [
  [/TWAP/i, OracleFeedCategory.TWAP],
  [/FX|EUR|GBP|JPY|CHF/i, OracleFeedCategory.FX_RATE],
  [/USDC|USDT|DAI|PEG/i, OracleFeedCategory.STABLECOIN_PEG],
  [/STETH|RETH|CBETH|LST/i, OracleFeedCategory.LST_RATE],
  [/GAS/i, OracleFeedCategory.L2_GAS],
  [/UPTIME|SEQUENCER/i, OracleFeedCategory.SEQUENCER_UPTIME],
  [/FINALITY/i, OracleFeedCategory.FINALITY],
  [/MARKET.*STATUS|STATUS/i, OracleFeedCategory.MARKET_STATUS],
]

function categoryFromSymbol(symbol: string): OracleFeedCategory {
  // Limit input length to prevent potential regex performance issues
  const trimmedSymbol = symbol.slice(0, 100)
  for (const [pattern, category] of CATEGORY_PATTERNS) {
    if (pattern.test(trimmedSymbol)) return category
  }
  return OracleFeedCategory.SPOT_PRICE
}

export async function processOracleEvents(
  ctx: ProcessorContext<Store>,
): Promise<void> {
  const feeds = new Map<string, OracleFeed>()
  const operators = new Map<string, OracleOperator>()
  const reports = new Map<string, OracleReport>()
  const disputes = new Map<string, OracleDispute>()
  const committeeMembers = new Map<string, OracleCommitteeMember>()
  const subscriptions = new Map<string, OracleSubscription>()
  const attestations = new Map<string, OracleAttestation>()
  const accountFactory = createAccountFactory()

  // Load existing entities
  const existingFeeds = await ctx.store.find(OracleFeed)
  for (const f of existingFeeds) feeds.set(f.id, f)

  const existingOperators = await ctx.store.find(OracleOperator)
  for (const o of existingOperators) operators.set(o.id, o)

  for (const block of ctx.blocks) {
    const header = block.header
    const blockTimestamp = new Date(header.timestamp)

    for (const log of block.logs) {
      const eventSig = log.topics[0]

      if (!eventSig || !isEventInSet(eventSig, ORACLE_EVENT_SET)) continue
      const txHash =
        log.transaction?.hash ?? `${header.hash}-${log.transactionIndex}`

      // Feed Events
      if (eventSig === EVENTS.FEED_CREATED) {
        const args = decodeEventArgs<FeedCreatedArgs>(
          ABI.registry,
          log.data,
          log.topics,
        )
        const feedId = log.topics[1]
        const [symbol, baseToken, quoteToken] = [
          args.symbol,
          args.baseToken,
          args.quoteToken,
        ]
        feeds.set(
          feedId,
          new OracleFeed({
            id: feedId,
            feedId,
            symbol,
            baseToken,
            quoteToken,
            decimals: 8,
            heartbeatSeconds: 3600, // defaults, can be fetched from contract if needed
            minOracles: 3,
            quorumThreshold: 2,
            category: categoryFromSymbol(symbol),
            isActive: true,
            createdAt: blockTimestamp,
            createdTxHash: txHash,
            lastUpdated: blockTimestamp,
            totalReports: 0,
            totalDisputes: 0,
          }),
        )
        ctx.log.info(`Oracle feed: ${symbol}`)
      }

      if (
        eventSig === EVENTS.FEED_DEACTIVATED ||
        eventSig === EVENTS.FEED_ACTIVATED
      ) {
        const feedId = log.topics[1]
        const feed =
          feeds.get(feedId) || (await ctx.store.get(OracleFeed, feedId))
        if (feed) {
          feed.isActive = eventSig === EVENTS.FEED_ACTIVATED
          feed.lastUpdated = blockTimestamp
          feeds.set(feedId, feed)
        }
      }

      // Operator Events
      if (eventSig === EVENTS.OPERATOR_REGISTERED) {
        const args = decodeEventArgs<OperatorRegisteredArgs>(
          ABI.connector,
          log.data,
          log.topics,
        )
        const operatorId = log.topics[1]
        const workerKey = args.workerKey.toLowerCase()
        accountFactory.getOrCreate(workerKey, header.height, blockTimestamp)
        operators.set(
          operatorId,
          new OracleOperator({
            id: operatorId,
            address: workerKey,
            identityId: BigInt(args.agentId.toString()),
            stakedAmount: 0n,
            isActive: true,
            isJailed: false,
            delegatedAmount: 0n,
            totalSlashed: 0n,
            reportsSubmitted: 0,
            reportsAccepted: 0,
            disputesAgainst: 0,
            disputesLost: 0,
            participationScore: 10000,
            accuracyScore: 10000,
            uptimeScore: 10000,
            totalEarnings: 0n,
            pendingRewards: 0n,
            registeredAt: blockTimestamp,
            lastActiveAt: blockTimestamp,
          }),
        )
      }

      if (eventSig === EVENTS.OPERATOR_DEACTIVATED) {
        const operatorId = log.topics[1]
        const op =
          operators.get(operatorId) ||
          (await ctx.store.get(OracleOperator, operatorId))
        if (op) {
          op.isActive = false
          op.lastActiveAt = blockTimestamp
          operators.set(operatorId, op)
        }
      }

      if (eventSig === EVENTS.PERFORMANCE_RECORDED) {
        const args = decodeEventArgs<PerformanceRecordedArgs>(
          ABI.connector,
          log.data,
          log.topics,
        )
        const operatorId = log.topics[1]
        const op =
          operators.get(operatorId) ||
          (await ctx.store.get(OracleOperator, operatorId))
        if (op) {
          op.reportsSubmitted += Number(args.reportsSubmitted)
          op.reportsAccepted += Number(args.reportsAccepted)
          op.lastActiveAt = blockTimestamp
          operators.set(operatorId, op)
        }
      }

      // Committee Events
      if (eventSig === EVENTS.COMMITTEE_FORMED) {
        const args = decodeEventArgs<CommitteeFormedArgs>(
          ABI.committee,
          log.data,
          log.topics,
        )
        const feedId = log.topics[1]
        const members = args.members
        const feed =
          feeds.get(feedId) || (await ctx.store.get(OracleFeed, feedId))

        for (const memberAddr of members) {
          const addr = memberAddr.toLowerCase()
          const memberId = `${feedId}-${addr}`
          const op =
            operators.get(addr) || (await ctx.store.get(OracleOperator, addr))
          if (feed && op) {
            committeeMembers.set(
              memberId,
              new OracleCommitteeMember({
                id: memberId,
                feed,
                operator: op,
                isActive: true,
                addedAt: blockTimestamp,
                reportsInFeed: 0,
              }),
            )
          }
        }
      }

      if (eventSig === EVENTS.MEMBER_ADDED) {
        const feedId = log.topics[1]
        const addr = `0x${log.topics[3].slice(26)}`.toLowerCase()
        const memberId = `${feedId}-${addr}`
        const feed =
          feeds.get(feedId) || (await ctx.store.get(OracleFeed, feedId))
        const op =
          operators.get(addr) || (await ctx.store.get(OracleOperator, addr))
        if (feed && op) {
          committeeMembers.set(
            memberId,
            new OracleCommitteeMember({
              id: memberId,
              feed,
              operator: op,
              isActive: true,
              addedAt: blockTimestamp,
              reportsInFeed: 0,
            }),
          )
        }
      }

      if (eventSig === EVENTS.MEMBER_REMOVED) {
        const feedId = log.topics[1]
        const addr = `0x${log.topics[3].slice(26)}`.toLowerCase()
        const memberId = `${feedId}-${addr}`
        const member =
          committeeMembers.get(memberId) ||
          (await ctx.store.get(OracleCommitteeMember, memberId))
        if (member) {
          member.isActive = false
          member.removedAt = blockTimestamp
          committeeMembers.set(memberId, member)
        }
      }

      // Report Events
      if (eventSig === EVENTS.REPORT_SUBMITTED) {
        const args = decodeEventArgs<ReportSubmittedArgs>(
          ABI.reporting,
          log.data,
          log.topics,
        )
        const feedId = log.topics[1]
        const reportHash = args.reportHash
        const price = BigInt(args.price.toString())
        const confidence = BigInt(args.confidence.toString())
        const round = BigInt(args.round.toString())
        const signatureCount = Number(args.signatureCount)
        const feed =
          feeds.get(feedId) || (await ctx.store.get(OracleFeed, feedId))
        const submitter = accountFactory.getOrCreate(
          log.address.toLowerCase(),
          header.height,
          blockTimestamp,
        )

        reports.set(
          reportHash,
          new OracleReport({
            id: reportHash,
            reportId: reportHash,
            feed,
            round,
            price,
            confidence,
            timestamp: blockTimestamp,
            signers: [],
            signatureCount,
            isDisputed: false,
            isValid: true,
            submittedAt: blockTimestamp,
            submittedBy: submitter,
            txHash,
            blockNumber: header.height,
          }),
        )

        if (feed) {
          feed.totalReports++
          feed.latestPrice = price
          feed.latestConfidence = confidence
          feed.latestTimestamp = blockTimestamp
          feed.latestRound = round
          feed.lastUpdated = blockTimestamp
          feeds.set(feedId, feed)
        }
      }

      if (eventSig === EVENTS.REPORT_REJECTED) {
        const reportHash = log.topics[2]
        const report =
          reports.get(reportHash) ||
          (await ctx.store.get(OracleReport, reportHash))
        if (report) {
          report.isValid = false
          reports.set(reportHash, report)
        }
      }

      // Dispute Events
      if (eventSig === EVENTS.DISPUTE_OPENED) {
        const args = decodeEventArgs<DisputeOpenedArgs>(
          ABI.dispute,
          log.data,
          log.topics,
        )
        const disputeId = log.topics[1]
        const reportHash = args.reportHash
        const feedId = args.feedId
        const disputerAddr = args.disputer.toLowerCase()
        const bond = BigInt(args.bond.toString())
        const reasonCode = Number(args.reason)
        const reasonLabels = [
          'PRICE_DEVIATION',
          'STALE_DATA',
          'INVALID_SIGNATURES',
          'SOURCE_MANIPULATION',
          'OTHER',
        ]
        const reason = reasonLabels[reasonCode] ?? 'UNKNOWN'

        const report =
          reports.get(reportHash) ||
          (await ctx.store.get(OracleReport, reportHash))
        const feed =
          feeds.get(feedId) || (await ctx.store.get(OracleFeed, feedId))
        const disputer = accountFactory.getOrCreate(
          disputerAddr,
          header.height,
          blockTimestamp,
        )

        const dispute = new OracleDispute({
          id: disputeId,
          disputeId,
          report,
          feed,
          disputer,
          bond,
          reason,
          status: OracleDisputeStatus.OPEN,
          openedAt: blockTimestamp,
          challengeDeadline: new Date(blockTimestamp.getTime() + 86400000),
          txHash,
          blockNumber: header.height,
        })
        disputes.set(disputeId, dispute)

        if (report) {
          report.isDisputed = true
          report.dispute = dispute
          reports.set(reportHash, report)
        }
        if (feed) {
          feed.totalDisputes++
          feeds.set(feedId, feed)
        }
      }

      if (eventSig === EVENTS.DISPUTE_CHALLENGED) {
        const args = decodeEventArgs<DisputeChallengedArgs>(
          ABI.dispute,
          log.data,
          log.topics,
        )
        const disputeId = log.topics[1]
        const dispute =
          disputes.get(disputeId) ||
          (await ctx.store.get(OracleDispute, disputeId))
        if (dispute) {
          dispute.status = OracleDisputeStatus.CHALLENGED
          dispute.challenger = accountFactory.getOrCreate(
            args.challenger.toLowerCase(),
            header.height,
            blockTimestamp,
          )
          dispute.challengeBond = BigInt(args.additionalBond.toString())
          disputes.set(disputeId, dispute)
        }
      }

      if (eventSig === EVENTS.DISPUTE_RESOLVED) {
        const args = decodeEventArgs<DisputeResolvedArgs>(
          ABI.dispute,
          log.data,
          log.topics,
        )
        const disputeId = log.topics[1]
        const dispute =
          disputes.get(disputeId) ||
          (await ctx.store.get(OracleDispute, disputeId))
        if (dispute) {
          dispute.status = OracleDisputeStatus.RESOLVED
          dispute.resolvedAt = blockTimestamp
          const outcome = Number(args.outcome)
          dispute.outcome =
            outcome === 0
              ? OracleDisputeOutcome.VALID
              : outcome === 1
                ? OracleDisputeOutcome.INVALID
                : OracleDisputeOutcome.PENDING
          dispute.slashedAmount = BigInt(args.slashedAmount.toString())
          disputes.set(disputeId, dispute)
        }
      }

      if (eventSig === EVENTS.DISPUTE_ESCALATED) {
        const disputeId = log.topics[1]
        const dispute =
          disputes.get(disputeId) ||
          (await ctx.store.get(OracleDispute, disputeId))
        if (dispute) {
          dispute.status = OracleDisputeStatus.ESCALATED
          disputes.set(disputeId, dispute)
        }
      }

      if (eventSig === EVENTS.DISPUTE_EXPIRED) {
        const disputeId = log.topics[1]
        const dispute =
          disputes.get(disputeId) ||
          (await ctx.store.get(OracleDispute, disputeId))
        if (dispute) {
          dispute.status = OracleDisputeStatus.EXPIRED
          dispute.resolvedAt = blockTimestamp
          disputes.set(disputeId, dispute)
        }
      }

      // Subscription Events
      if (eventSig === EVENTS.SUBSCRIPTION_CREATED) {
        const args = decodeEventArgs<SubscriptionCreatedArgs>(
          ABI.subscription,
          log.data,
          log.topics,
        )
        const subId = log.topics[1]
        const subscriberAddr = `0x${log.topics[2].slice(26)}`.toLowerCase()
        const feedIdsList = [...args.feedIds]
        const duration = Number(args.duration)
        const amountPaid = BigInt(args.amountPaid.toString())

        subscriptions.set(
          subId,
          new OracleSubscription({
            id: subId,
            subscriptionId: BigInt(subId),
            subscriber: accountFactory.getOrCreate(
              subscriberAddr,
              header.height,
              blockTimestamp,
            ),
            feedIds: feedIdsList,
            startTime: blockTimestamp,
            endTime: new Date(
              blockTimestamp.getTime() + duration * 30 * 24 * 60 * 60 * 1000,
            ),
            monthsPaid: duration,
            totalPaid: amountPaid,
            isActive: true,
            createdAt: blockTimestamp,
            txHash,
          }),
        )
      }

      if (eventSig === EVENTS.SUBSCRIPTION_CANCELLED) {
        const subId = log.topics[1]
        const sub =
          subscriptions.get(subId) ||
          (await ctx.store.get(OracleSubscription, subId))
        if (sub) {
          sub.isActive = false
          sub.cancelledAt = blockTimestamp
          subscriptions.set(subId, sub)
        }
      }

      if (eventSig === EVENTS.REWARDS_CLAIMED) {
        const operatorId = log.topics[1]
        const op =
          operators.get(operatorId) ||
          (await ctx.store.get(OracleOperator, operatorId))
        if (op) {
          op.lastActiveAt = blockTimestamp
          operators.set(operatorId, op)
        }
      }

      // Attestation Events
      if (eventSig === EVENTS.ATTESTATION_WRITTEN) {
        const args = decodeEventArgs<AttestationWrittenArgs>(
          ABI.connector,
          log.data,
          log.topics,
        )
        const operatorId = log.topics[1]
        const tag = args.tag
        const score = Number(args.score)
        const op =
          operators.get(operatorId) ||
          (await ctx.store.get(OracleOperator, operatorId))

        if (op) {
          const attestationId = `${operatorId}-${tag}-${header.height}`
          const epoch = BigInt(Math.floor(header.height / 7200)) // Approximate epoch from block

          attestations.set(
            attestationId,
            new OracleAttestation({
              id: attestationId,
              operator: op,
              epoch,
              feedsServed: 0,
              reportsSubmitted: 0,
              reportsAccepted: 0,
              disputesReceived: 0,
              participationScore: score > 0 ? score * 100 : 0,
              accuracyScore: 10000,
              attestedAt: blockTimestamp,
              txHash,
            }),
          )

          // Update operator scores based on tag
          if (tag.includes('participation'))
            op.participationScore = Math.max(
              0,
              Math.min(10000, 5000 + score * 100),
            )
          if (tag.includes('accuracy'))
            op.accuracyScore = Math.max(0, Math.min(10000, 5000 + score * 100))
          if (tag.includes('uptime'))
            op.uptimeScore = Math.max(0, Math.min(10000, 5000 + score * 100))
          op.lastActiveAt = blockTimestamp
          operators.set(operatorId, op)
        }
      }
    }
  }

  // Persist entities (order matters for FK dependencies)
  if (accountFactory.hasAccounts())
    await ctx.store.upsert(accountFactory.getAll())
  if (feeds.size) await ctx.store.upsert([...feeds.values()])
  if (operators.size) await ctx.store.upsert([...operators.values()])
  if (committeeMembers.size)
    await ctx.store.upsert([...committeeMembers.values()])
  if (reports.size) await ctx.store.upsert([...reports.values()])
  if (disputes.size) await ctx.store.upsert([...disputes.values()])
  if (subscriptions.size) await ctx.store.upsert([...subscriptions.values()])
  if (attestations.size) await ctx.store.upsert([...attestations.values()])

  const total = feeds.size + operators.size + reports.size + disputes.size
  if (total)
    ctx.log.info(
      `Oracle: ${feeds.size} feeds, ${operators.size} ops, ${reports.size} reports, ${disputes.size} disputes`,
    )
}
