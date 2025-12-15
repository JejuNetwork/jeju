/**
 * Oracle Processor - Indexes Oracle Network (JON) events
 */

import { keccak256, stringToHex } from 'viem';
import { Store } from '@subsquid/typeorm-store';
import { ProcessorContext } from './processor';
import {
  OracleFeed,
  OracleFeedCategory,
  OracleReport,
  OracleDispute,
  OracleDisputeStatus,
  OracleDisputeOutcome,
  OracleOperator,
  OracleCommitteeMember,
  OracleSubscription,
  OracleAttestation,
} from './model';
import { createAccountFactory, BlockHeader, LogData } from './lib/entities';

// Event signatures - matched to actual contract events in src/oracle
const EVENTS = {
  // FeedRegistry events
  FEED_CREATED: keccak256(stringToHex('FeedCreated(bytes32,string,address,address,address)')),
  FEED_ACTIVATED: keccak256(stringToHex('FeedActivated(bytes32)')),
  FEED_DEACTIVATED: keccak256(stringToHex('FeedDeactivated(bytes32)')),
  FEED_UPDATED: keccak256(stringToHex('FeedUpdated(bytes32,string)')),

  // OracleNetworkConnector events
  OPERATOR_REGISTERED: keccak256(stringToHex('OperatorRegistered(bytes32,bytes32,uint256,address)')),
  OPERATOR_DEACTIVATED: keccak256(stringToHex('OperatorDeactivated(bytes32,string)')),
  PERFORMANCE_RECORDED: keccak256(stringToHex('PerformanceRecorded(bytes32,uint256,uint256,uint256)')),
  ATTESTATION_WRITTEN: keccak256(stringToHex('AttestationWritten(bytes32,uint256,bytes32,int8)')),
  EPOCH_ADVANCED: keccak256(stringToHex('EpochAdvanced(uint256,uint256)')),

  // CommitteeManager events
  COMMITTEE_FORMED: keccak256(stringToHex('CommitteeFormed(bytes32,uint256,address[],address,uint256)')),
  COMMITTEE_ROTATED: keccak256(stringToHex('CommitteeRotated(bytes32,uint256,uint256)')),
  MEMBER_ADDED: keccak256(stringToHex('MemberAdded(bytes32,uint256,address)')),
  MEMBER_REMOVED: keccak256(stringToHex('MemberRemoved(bytes32,uint256,address,string)')),
  LEADER_ROTATED: keccak256(stringToHex('LeaderRotated(bytes32,uint256,address)')),

  // ReportVerifier events
  REPORT_SUBMITTED: keccak256(stringToHex('ReportSubmitted(bytes32,bytes32,uint256,uint256,uint256,uint256)')),
  REPORT_VERIFIED: keccak256(stringToHex('ReportVerified(bytes32,bytes32,uint256,uint256)')),
  REPORT_REJECTED: keccak256(stringToHex('ReportRejected(bytes32,bytes32,string)')),
  CONSENSUS_UPDATED: keccak256(stringToHex('ConsensusUpdated(bytes32,uint256,uint256,uint256)')),

  // DisputeGame events
  DISPUTE_OPENED: keccak256(stringToHex('DisputeOpened(bytes32,bytes32,bytes32,address,uint256,uint8)')),
  DISPUTE_CHALLENGED: keccak256(stringToHex('DisputeChallenged(bytes32,address,uint256)')),
  DISPUTE_RESOLVED: keccak256(stringToHex('DisputeResolved(bytes32,uint8,uint256,uint256)')),
  DISPUTE_ESCALATED: keccak256(stringToHex('DisputeEscalated(bytes32,bytes32)')),
  DISPUTE_EXPIRED: keccak256(stringToHex('DisputeExpired(bytes32)')),
  SIGNERS_SLASHED: keccak256(stringToHex('SignersSlashed(bytes32,address[],uint256)')),
  DISPUTER_REWARDED: keccak256(stringToHex('DisputerRewarded(bytes32,address,uint256)')),

  // OracleFeeRouter events
  SUBSCRIPTION_CREATED: keccak256(stringToHex('SubscriptionCreated(bytes32,address,bytes32[],uint256,uint256)')),
  SUBSCRIPTION_RENEWED: keccak256(stringToHex('SubscriptionRenewed(bytes32,uint256,uint256)')),
  SUBSCRIPTION_CANCELLED: keccak256(stringToHex('SubscriptionCancelled(bytes32,uint256)')),
  READ_FEE_PAID: keccak256(stringToHex('ReadFeePaid(bytes32,address,uint256)')),
  REWARDS_DISTRIBUTED: keccak256(stringToHex('RewardsDistributed(uint256,uint256,uint256,uint256)')),
  REWARDS_CLAIMED: keccak256(stringToHex('RewardsClaimed(bytes32,address,uint256)')),
  DELEGATOR_REWARDS_CLAIMED: keccak256(stringToHex('DelegatorRewardsClaimed(address,bytes32,uint256)')),
} as const;

const ORACLE_EVENT_SET = new Set(Object.values(EVENTS));

// Consolidated ABI interfaces - matched to actual contract events
const ABI = {
  registry: new ethers.Interface([
    'event FeedCreated(bytes32 indexed feedId, string symbol, address baseToken, address quoteToken, address creator)',
    'event FeedActivated(bytes32 indexed feedId)',
    'event FeedDeactivated(bytes32 indexed feedId)',
  ]),
  connector: new ethers.Interface([
    'event OperatorRegistered(bytes32 indexed operatorId, bytes32 indexed stakingOracleId, uint256 agentId, address workerKey)',
    'event OperatorDeactivated(bytes32 indexed operatorId, string reason)',
    'event PerformanceRecorded(bytes32 indexed operatorId, uint256 indexed epoch, uint256 reportsSubmitted, uint256 reportsAccepted)',
    'event AttestationWritten(bytes32 indexed operatorId, uint256 indexed agentId, bytes32 tag, int8 score)',
  ]),
  committee: new ethers.Interface([
    'event CommitteeFormed(bytes32 indexed feedId, uint256 indexed round, address[] members, address leader, uint256 activeUntil)',
    'event MemberAdded(bytes32 indexed feedId, uint256 indexed round, address indexed member)',
    'event MemberRemoved(bytes32 indexed feedId, uint256 indexed round, address indexed member, string reason)',
  ]),
  reporting: new ethers.Interface([
    'event ReportSubmitted(bytes32 indexed feedId, bytes32 reportHash, uint256 price, uint256 confidence, uint256 round, uint256 signatureCount)',
    'event ReportVerified(bytes32 indexed feedId, bytes32 indexed reportHash, uint256 price, uint256 timestamp)',
    'event ConsensusUpdated(bytes32 indexed feedId, uint256 price, uint256 confidence, uint256 round)',
  ]),
  dispute: new ethers.Interface([
    'event DisputeOpened(bytes32 indexed disputeId, bytes32 reportHash, bytes32 feedId, address disputer, uint256 bond, uint8 reason)',
    'event DisputeChallenged(bytes32 indexed disputeId, address challenger, uint256 additionalBond)',
    'event DisputeResolved(bytes32 indexed disputeId, uint8 outcome, uint256 slashedAmount, uint256 reward)',
    'event DisputeExpired(bytes32 indexed disputeId)',
  ]),
  subscription: new ethers.Interface([
    'event SubscriptionCreated(bytes32 indexed subscriptionId, address indexed subscriber, bytes32[] feedIds, uint256 duration, uint256 amountPaid)',
    'event SubscriptionCancelled(bytes32 indexed subscriptionId, uint256 refundAmount)',
    'event RewardsClaimed(bytes32 indexed operatorId, address indexed recipient, uint256 amount)',
  ]),
};

export function isOracleEvent(topic0: string): boolean {
  return ORACLE_EVENT_SET.has(topic0);
}

// Category detection via keyword matching
const CATEGORY_PATTERNS: Array<[RegExp, OracleFeedCategory]> = [
  [/TWAP/i, OracleFeedCategory.TWAP],
  [/FX|EUR|GBP|JPY|CHF/i, OracleFeedCategory.FX_RATE],
  [/USDC|USDT|DAI|PEG/i, OracleFeedCategory.STABLECOIN_PEG],
  [/STETH|RETH|CBETH|LST/i, OracleFeedCategory.LST_RATE],
  [/GAS/i, OracleFeedCategory.L2_GAS],
  [/UPTIME|SEQUENCER/i, OracleFeedCategory.SEQUENCER_UPTIME],
  [/FINALITY/i, OracleFeedCategory.FINALITY],
  [/MARKET.*STATUS|STATUS/i, OracleFeedCategory.MARKET_STATUS],
];

function categoryFromSymbol(symbol: string): OracleFeedCategory {
  for (const [pattern, category] of CATEGORY_PATTERNS) {
    if (pattern.test(symbol)) return category;
  }
  return OracleFeedCategory.SPOT_PRICE;
}

export async function processOracleEvents(ctx: ProcessorContext<Store>): Promise<void> {
  const feeds = new Map<string, OracleFeed>();
  const operators = new Map<string, OracleOperator>();
  const reports = new Map<string, OracleReport>();
  const disputes = new Map<string, OracleDispute>();
  const committeeMembers = new Map<string, OracleCommitteeMember>();
  const subscriptions = new Map<string, OracleSubscription>();
  const attestations = new Map<string, OracleAttestation>();
  const accountFactory = createAccountFactory();

  // Load existing entities
  const existingFeeds = await ctx.store.find(OracleFeed);
  for (const f of existingFeeds) feeds.set(f.id, f);
  
  const existingOperators = await ctx.store.find(OracleOperator);
  for (const o of existingOperators) operators.set(o.id, o);

  for (const block of ctx.blocks) {
    const header = block.header as unknown as BlockHeader;
    const blockTimestamp = new Date(header.timestamp);

    for (const rawLog of block.logs) {
      const log = rawLog as unknown as LogData;
      const eventSig = log.topics[0];

      if (!eventSig || !ORACLE_EVENT_SET.has(eventSig)) continue;
      const txHash = log.transaction?.hash || `${header.hash}-${log.transactionIndex}`;

      // Feed Events
      if (eventSig === EVENTS.FEED_CREATED) {
        const decoded = ABI.registry.parseLog({ topics: log.topics, data: log.data });
        if (!decoded) continue;
        const feedId = log.topics[1];
        const [symbol, baseToken, quoteToken] = [decoded.args[0], decoded.args[1], decoded.args[2]] as [string, string, string];
        feeds.set(feedId, new OracleFeed({
          id: feedId, feedId, symbol, baseToken, quoteToken,
          decimals: 8, heartbeatSeconds: 3600, // defaults, can be fetched from contract if needed
          minOracles: 3, quorumThreshold: 2,
          category: categoryFromSymbol(symbol), isActive: true,
          createdAt: blockTimestamp, createdTxHash: txHash, lastUpdated: blockTimestamp,
          totalReports: 0, totalDisputes: 0,
        }));
        ctx.log.info(`Oracle feed: ${symbol}`);
      }

      if (eventSig === EVENTS.FEED_DEACTIVATED || eventSig === EVENTS.FEED_ACTIVATED) {
        const feedId = log.topics[1];
        const feed = feeds.get(feedId) || await ctx.store.get(OracleFeed, feedId);
        if (feed) {
          feed.isActive = eventSig === EVENTS.FEED_ACTIVATED;
          feed.lastUpdated = blockTimestamp;
          feeds.set(feedId, feed);
        }
      }

      // Operator Events
      if (eventSig === EVENTS.OPERATOR_REGISTERED) {
        const decoded = ABI.connector.parseLog({ topics: log.topics, data: log.data });
        if (!decoded) continue;
        const operatorId = log.topics[1];
        const workerKey = (decoded.args[3] as string).toLowerCase();
        accountFactory.getOrCreate(workerKey, header.height, blockTimestamp);
        operators.set(operatorId, new OracleOperator({
          id: operatorId, address: workerKey,
          identityId: BigInt(decoded.args[2]?.toString() || '0'),
          stakedAmount: 0n,
          isActive: true, isJailed: false, delegatedAmount: 0n, totalSlashed: 0n,
          reportsSubmitted: 0, reportsAccepted: 0, disputesAgainst: 0, disputesLost: 0,
          participationScore: 10000, accuracyScore: 10000, uptimeScore: 10000,
          totalEarnings: 0n, pendingRewards: 0n,
          registeredAt: blockTimestamp, lastActiveAt: blockTimestamp,
        }));
      }

      if (eventSig === EVENTS.OPERATOR_DEACTIVATED) {
        const operatorId = log.topics[1];
        const op = operators.get(operatorId) || await ctx.store.get(OracleOperator, operatorId);
        if (op) {
          op.isActive = false;
          op.lastActiveAt = blockTimestamp;
          operators.set(operatorId, op);
        }
      }

      if (eventSig === EVENTS.PERFORMANCE_RECORDED) {
        const decoded = ABI.connector.parseLog({ topics: log.topics, data: log.data });
        if (!decoded) continue;
        const operatorId = log.topics[1];
        const op = operators.get(operatorId) || await ctx.store.get(OracleOperator, operatorId);
        if (op) {
          op.reportsSubmitted += Number(decoded.args[2]);
          op.reportsAccepted += Number(decoded.args[3]);
          op.lastActiveAt = blockTimestamp;
          operators.set(operatorId, op);
        }
      }

      // Committee Events
      if (eventSig === EVENTS.COMMITTEE_FORMED) {
        const decoded = ABI.committee.parseLog({ topics: log.topics, data: log.data });
        if (!decoded) continue;
        const feedId = log.topics[1];
        const members = decoded.args[0] as string[];
        const feed = feeds.get(feedId) || await ctx.store.get(OracleFeed, feedId);
        
        for (const memberAddr of members) {
          const addr = memberAddr.toLowerCase();
          const memberId = `${feedId}-${addr}`;
          const op = operators.get(addr) || await ctx.store.get(OracleOperator, addr);
          if (feed && op) {
            committeeMembers.set(memberId, new OracleCommitteeMember({
              id: memberId, feed, operator: op, isActive: true, addedAt: blockTimestamp, reportsInFeed: 0,
            }));
          }
        }
      }

      if (eventSig === EVENTS.MEMBER_ADDED) {
        const feedId = log.topics[1];
        const addr = ('0x' + log.topics[3].slice(26)).toLowerCase();
        const memberId = `${feedId}-${addr}`;
        const feed = feeds.get(feedId) || await ctx.store.get(OracleFeed, feedId);
        const op = operators.get(addr) || await ctx.store.get(OracleOperator, addr);
        if (feed && op) {
          committeeMembers.set(memberId, new OracleCommitteeMember({
            id: memberId, feed, operator: op, isActive: true, addedAt: blockTimestamp, reportsInFeed: 0,
          }));
        }
      }

      if (eventSig === EVENTS.MEMBER_REMOVED) {
        const feedId = log.topics[1];
        const addr = ('0x' + log.topics[3].slice(26)).toLowerCase();
        const memberId = `${feedId}-${addr}`;
        const member = committeeMembers.get(memberId) || await ctx.store.get(OracleCommitteeMember, memberId);
        if (member) {
          member.isActive = false;
          member.removedAt = blockTimestamp;
          committeeMembers.set(memberId, member);
        }
      }

      // Report Events
      if (eventSig === EVENTS.REPORT_SUBMITTED) {
        const decoded = ABI.reporting.parseLog({ topics: log.topics, data: log.data });
        if (!decoded) continue;
        const feedId = log.topics[1];
        const reportHash = decoded.args[0] as string;
        const price = BigInt(decoded.args[1].toString());
        const confidence = BigInt(decoded.args[2].toString());
        const round = BigInt(decoded.args[3].toString());
        const signatureCount = Number(decoded.args[4]);
        const feed = feeds.get(feedId) || await ctx.store.get(OracleFeed, feedId);
        const submitter = accountFactory.getOrCreate(log.address.toLowerCase(), header.height, blockTimestamp);

        reports.set(reportHash, new OracleReport({
          id: reportHash, reportId: reportHash, feed, round, price, confidence,
          timestamp: blockTimestamp, signers: [], signatureCount,
          isDisputed: false, isValid: true, submittedAt: blockTimestamp, submittedBy: submitter,
          txHash, blockNumber: header.height,
        }));

        if (feed) {
          feed.totalReports++;
          feed.latestPrice = price;
          feed.latestConfidence = confidence;
          feed.latestTimestamp = blockTimestamp;
          feed.latestRound = round;
          feed.lastUpdated = blockTimestamp;
          feeds.set(feedId, feed);
        }
      }

      if (eventSig === EVENTS.REPORT_REJECTED) {
        const feedId = log.topics[1];
        const reportHash = log.topics[2];
        const report = reports.get(reportHash) || await ctx.store.get(OracleReport, reportHash);
        if (report) {
          report.isValid = false;
          reports.set(reportHash, report);
        }
      }

      // Dispute Events
      if (eventSig === EVENTS.DISPUTE_OPENED) {
        const decoded = ABI.dispute.parseLog({ topics: log.topics, data: log.data });
        if (!decoded) continue;
        const disputeId = log.topics[1];
        const reportHash = decoded.args[0] as string;
        const feedId = decoded.args[1] as string;
        const disputerAddr = (decoded.args[2] as string).toLowerCase();
        const bond = BigInt(decoded.args[3].toString());
        const reasonCode = Number(decoded.args[4]);
        const reasonLabels = ['PRICE_DEVIATION', 'STALE_DATA', 'INVALID_SIGNATURES', 'SOURCE_MANIPULATION', 'OTHER'];
        const reason = reasonLabels[reasonCode] || 'UNKNOWN';

        const report = reports.get(reportHash) || await ctx.store.get(OracleReport, reportHash);
        const feed = feeds.get(feedId) || await ctx.store.get(OracleFeed, feedId);
        const disputer = accountFactory.getOrCreate(disputerAddr, header.height, blockTimestamp);

        const dispute = new OracleDispute({
          id: disputeId, disputeId, report, feed, disputer, bond, reason,
          status: OracleDisputeStatus.OPEN, openedAt: blockTimestamp,
          challengeDeadline: new Date(blockTimestamp.getTime() + 86400000),
          txHash, blockNumber: header.height,
        });
        disputes.set(disputeId, dispute);

        if (report) {
          report.isDisputed = true;
          report.dispute = dispute;
          reports.set(reportHash, report);
        }
        if (feed) {
          feed.totalDisputes++;
          feeds.set(feedId, feed);
        }
      }

      if (eventSig === EVENTS.DISPUTE_CHALLENGED) {
        const decoded = ABI.dispute.parseLog({ topics: log.topics, data: log.data });
        if (!decoded) continue;
        const disputeId = log.topics[1];
        const dispute = disputes.get(disputeId) || await ctx.store.get(OracleDispute, disputeId);
        if (dispute) {
          dispute.status = OracleDisputeStatus.CHALLENGED;
          dispute.challenger = accountFactory.getOrCreate((decoded.args[0] as string).toLowerCase(), header.height, blockTimestamp);
          dispute.challengeBond = BigInt(decoded.args[1].toString());
          disputes.set(disputeId, dispute);
        }
      }

      if (eventSig === EVENTS.DISPUTE_RESOLVED) {
        const decoded = ABI.dispute.parseLog({ topics: log.topics, data: log.data });
        if (!decoded) continue;
        const disputeId = log.topics[1];
        const dispute = disputes.get(disputeId) || await ctx.store.get(OracleDispute, disputeId);
        if (dispute) {
          dispute.status = OracleDisputeStatus.RESOLVED;
          dispute.resolvedAt = blockTimestamp;
          const outcome = Number(decoded.args[0]);
          dispute.outcome = outcome === 0 ? OracleDisputeOutcome.VALID : 
                           outcome === 1 ? OracleDisputeOutcome.INVALID : OracleDisputeOutcome.PENDING;
          dispute.slashedAmount = BigInt(decoded.args[1].toString());
          disputes.set(disputeId, dispute);
        }
      }

      if (eventSig === EVENTS.DISPUTE_ESCALATED) {
        const disputeId = log.topics[1];
        const dispute = disputes.get(disputeId) || await ctx.store.get(OracleDispute, disputeId);
        if (dispute) {
          dispute.status = OracleDisputeStatus.ESCALATED;
          disputes.set(disputeId, dispute);
        }
      }

      if (eventSig === EVENTS.DISPUTE_EXPIRED) {
        const disputeId = log.topics[1];
        const dispute = disputes.get(disputeId) || await ctx.store.get(OracleDispute, disputeId);
        if (dispute) {
          dispute.status = OracleDisputeStatus.EXPIRED;
          dispute.resolvedAt = blockTimestamp;
          disputes.set(disputeId, dispute);
        }
      }

      // Subscription Events
      if (eventSig === EVENTS.SUBSCRIPTION_CREATED) {
        const decoded = ABI.subscription.parseLog({ topics: log.topics, data: log.data });
        if (!decoded) continue;
        const subId = log.topics[1];
        const subscriberAddr = ('0x' + log.topics[2].slice(26)).toLowerCase();
        const feedIdsList = decoded.args[0] as string[];
        const duration = Number(decoded.args[1]);
        const amountPaid = BigInt(decoded.args[2].toString());

        subscriptions.set(subId, new OracleSubscription({
          id: subId, subscriptionId: BigInt(subId),
          subscriber: accountFactory.getOrCreate(subscriberAddr, header.height, blockTimestamp),
          feedIds: feedIdsList,
          startTime: blockTimestamp, 
          endTime: new Date(blockTimestamp.getTime() + duration * 30 * 24 * 60 * 60 * 1000),
          monthsPaid: duration,
          totalPaid: amountPaid, isActive: true, createdAt: blockTimestamp, txHash,
        }));
      }

      if (eventSig === EVENTS.SUBSCRIPTION_CANCELLED) {
        const subId = log.topics[1];
        const sub = subscriptions.get(subId) || await ctx.store.get(OracleSubscription, subId);
        if (sub) {
          sub.isActive = false;
          sub.cancelledAt = blockTimestamp;
          subscriptions.set(subId, sub);
        }
      }

      if (eventSig === EVENTS.REWARDS_CLAIMED) {
        const operatorId = log.topics[1];
        const op = operators.get(operatorId) || await ctx.store.get(OracleOperator, operatorId);
        if (op) {
          op.lastActiveAt = blockTimestamp;
          operators.set(operatorId, op);
        }
      }

      // Attestation Events
      if (eventSig === EVENTS.ATTESTATION_WRITTEN) {
        const decoded = ABI.connector.parseLog({ topics: log.topics, data: log.data });
        if (!decoded) continue;
        const operatorId = log.topics[1];
        const agentId = BigInt(log.topics[2]);
        const tag = decoded.args[0] as string;
        const score = Number(decoded.args[1]);
        const op = operators.get(operatorId) || await ctx.store.get(OracleOperator, operatorId);

        if (op) {
          const attestationId = `${operatorId}-${tag}-${header.height}`;
          const epoch = BigInt(Math.floor(header.height / 7200)); // Approximate epoch from block

          attestations.set(attestationId, new OracleAttestation({
            id: attestationId, operator: op, epoch, feedsServed: 0, reportsSubmitted: 0, reportsAccepted: 0,
            disputesReceived: 0, participationScore: score > 0 ? score * 100 : 0, accuracyScore: 10000, 
            attestedAt: blockTimestamp, txHash,
          }));

          // Update operator scores based on tag
          if (tag.includes('participation')) op.participationScore = Math.max(0, Math.min(10000, 5000 + score * 100));
          if (tag.includes('accuracy')) op.accuracyScore = Math.max(0, Math.min(10000, 5000 + score * 100));
          if (tag.includes('uptime')) op.uptimeScore = Math.max(0, Math.min(10000, 5000 + score * 100));
          op.lastActiveAt = blockTimestamp;
          operators.set(operatorId, op);
        }
      }
    }
  }

  // Persist entities (order matters for FK dependencies)
  if (accountFactory.hasAccounts()) await ctx.store.upsert(accountFactory.getAll());
  if (feeds.size) await ctx.store.upsert([...feeds.values()]);
  if (operators.size) await ctx.store.upsert([...operators.values()]);
  if (committeeMembers.size) await ctx.store.upsert([...committeeMembers.values()]);
  if (reports.size) await ctx.store.upsert([...reports.values()]);
  if (disputes.size) await ctx.store.upsert([...disputes.values()]);
  if (subscriptions.size) await ctx.store.upsert([...subscriptions.values()]);
  if (attestations.size) await ctx.store.upsert([...attestations.values()]);

  const total = feeds.size + operators.size + reports.size + disputes.size;
  if (total) ctx.log.info(`Oracle: ${feeds.size} feeds, ${operators.size} ops, ${reports.size} reports, ${disputes.size} disputes`);
}

