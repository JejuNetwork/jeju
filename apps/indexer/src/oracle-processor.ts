/**
 * Oracle Processor - Indexes Jeju Oracle Network (JON) events
 */

import { ethers } from 'ethers';
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
import { createAccountFactory } from './lib/entities';

// Event signatures - only those we actually process
const EVENTS = {
  FEED_CREATED: ethers.id('FeedCreated(bytes32,string,string,string,uint8,uint256,uint8,uint8)'),
  FEED_DEACTIVATED: ethers.id('FeedDeactivated(bytes32)'),
  FEED_REACTIVATED: ethers.id('FeedReactivated(bytes32)'),
  OPERATOR_REGISTERED: ethers.id('OperatorRegistered(address,uint256,uint256)'),
  OPERATOR_STAKED: ethers.id('OperatorStaked(address,uint256,uint256)'),
  OPERATOR_JAILED: ethers.id('OperatorJailed(address,string)'),
  OPERATOR_UNJAILED: ethers.id('OperatorUnjailed(address)'),
  OPERATOR_SLASHED: ethers.id('OperatorSlashed(address,uint256,string)'),
  COMMITTEE_MEMBER_ADDED: ethers.id('CommitteeMemberAdded(bytes32,address)'),
  COMMITTEE_MEMBER_REMOVED: ethers.id('CommitteeMemberRemoved(bytes32,address)'),
  REPORT_SUBMITTED: ethers.id('ReportSubmitted(bytes32,bytes32,uint256,int256,uint256,uint256)'),
  REPORT_INVALIDATED: ethers.id('ReportInvalidated(bytes32,bytes32,string)'),
  DISPUTE_OPENED: ethers.id('DisputeOpened(bytes32,bytes32,address,uint256,string)'),
  DISPUTE_CHALLENGED: ethers.id('DisputeChallenged(bytes32,address,uint256)'),
  DISPUTE_RESOLVED: ethers.id('DisputeResolved(bytes32,uint8,uint256)'),
  DISPUTE_ESCALATED: ethers.id('DisputeEscalated(bytes32)'),
  SUBSCRIPTION_CREATED: ethers.id('SubscriptionCreated(uint256,address,bytes32[],uint256,uint256)'),
  SUBSCRIPTION_CANCELLED: ethers.id('SubscriptionCancelled(uint256)'),
  ATTESTATION_SUBMITTED: ethers.id('AttestationSubmitted(address,uint256,uint256,uint256,uint256,uint256)'),
} as const;

const ORACLE_EVENT_SET = new Set(Object.values(EVENTS));

// Consolidated ABI interfaces
const ABI = {
  registry: new ethers.Interface([
    'event FeedCreated(bytes32 indexed feedId, string symbol, string baseToken, string quoteToken, uint8 decimals, uint256 heartbeatSeconds, uint8 minOracles, uint8 quorumThreshold)',
  ]),
  operator: new ethers.Interface([
    'event OperatorRegistered(address indexed operator, uint256 identityId, uint256 stake)',
    'event OperatorStaked(address indexed operator, uint256 amount, uint256 newTotal)',
    'event OperatorSlashed(address indexed operator, uint256 amount, string reason)',
  ]),
  reporting: new ethers.Interface([
    'event ReportSubmitted(bytes32 indexed reportId, bytes32 indexed feedId, uint256 round, int256 price, uint256 confidence, uint256 timestamp)',
  ]),
  dispute: new ethers.Interface([
    'event DisputeOpened(bytes32 indexed disputeId, bytes32 indexed reportId, address indexed disputer, uint256 bond, string reason)',
    'event DisputeChallenged(bytes32 indexed disputeId, address indexed challenger, uint256 bond)',
    'event DisputeResolved(bytes32 indexed disputeId, uint8 outcome, uint256 slashedAmount)',
  ]),
  subscription: new ethers.Interface([
    'event SubscriptionCreated(uint256 indexed subscriptionId, address indexed subscriber, bytes32[] feedIds, uint256 startTime, uint256 endTime)',
  ]),
  attestation: new ethers.Interface([
    'event AttestationSubmitted(address indexed operator, uint256 epoch, uint256 feedsServed, uint256 reportsSubmitted, uint256 reportsAccepted, uint256 disputesReceived)',
  ]),
};

interface LogData {
  address: string;
  topics: string[];
  data: string;
  logIndex: number;
  transactionIndex: number;
  transaction?: { hash: string };
}

interface BlockHeader {
  hash: string;
  height: number;
  timestamp: number;
}

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
        const [feedId, symbol, baseToken, quoteToken] = decoded.args as unknown as [string, string, string, string];
        feeds.set(feedId, new OracleFeed({
          id: feedId, feedId, symbol, baseToken, quoteToken,
          decimals: Number(decoded.args[4]), heartbeatSeconds: Number(decoded.args[5]),
          minOracles: Number(decoded.args[6]), quorumThreshold: Number(decoded.args[7]),
          category: categoryFromSymbol(symbol), isActive: true,
          createdAt: blockTimestamp, createdTxHash: txHash, lastUpdated: blockTimestamp,
          totalReports: 0, totalDisputes: 0,
        }));
        ctx.log.info(`Oracle feed: ${symbol}`);
      }

      if (eventSig === EVENTS.FEED_DEACTIVATED || eventSig === EVENTS.FEED_REACTIVATED) {
        const feed = feeds.get(log.topics[1]) || await ctx.store.get(OracleFeed, log.topics[1]);
        if (feed) {
          feed.isActive = eventSig === EVENTS.FEED_REACTIVATED;
          feed.lastUpdated = blockTimestamp;
          feeds.set(log.topics[1], feed);
        }
      }

      // Operator Events
      if (eventSig === EVENTS.OPERATOR_REGISTERED) {
        const decoded = ABI.operator.parseLog({ topics: log.topics, data: log.data });
        if (!decoded) continue;
        const addr = (decoded.args[0] as string).toLowerCase();
        accountFactory.getOrCreate(addr, header.height, blockTimestamp);
        operators.set(addr, new OracleOperator({
          id: addr, address: addr,
          identityId: BigInt(decoded.args[1].toString()),
          stakedAmount: BigInt(decoded.args[2].toString()),
          isActive: true, isJailed: false, delegatedAmount: 0n, totalSlashed: 0n,
          reportsSubmitted: 0, reportsAccepted: 0, disputesAgainst: 0, disputesLost: 0,
          participationScore: 10000, accuracyScore: 10000, uptimeScore: 10000,
          totalEarnings: 0n, pendingRewards: 0n,
          registeredAt: blockTimestamp, lastActiveAt: blockTimestamp,
        }));
      }

      if (eventSig === EVENTS.OPERATOR_STAKED) {
        const decoded = ABI.operator.parseLog({ topics: log.topics, data: log.data });
        if (!decoded) continue;
        const addr = (decoded.args[0] as string).toLowerCase();
        const op = operators.get(addr) || await ctx.store.get(OracleOperator, addr);
        if (op) {
          op.stakedAmount = BigInt(decoded.args[2].toString());
          op.lastActiveAt = blockTimestamp;
          operators.set(addr, op);
        }
      }

      if (eventSig === EVENTS.OPERATOR_JAILED || eventSig === EVENTS.OPERATOR_UNJAILED) {
        const addr = ('0x' + log.topics[1].slice(26)).toLowerCase();
        const op = operators.get(addr) || await ctx.store.get(OracleOperator, addr);
        if (op) {
          op.isJailed = eventSig === EVENTS.OPERATOR_JAILED;
          op.lastActiveAt = blockTimestamp;
          operators.set(addr, op);
        }
      }

      if (eventSig === EVENTS.OPERATOR_SLASHED) {
        const decoded = ABI.operator.parseLog({ topics: log.topics, data: log.data });
        if (!decoded) continue;
        const addr = (decoded.args[0] as string).toLowerCase();
        const amount = BigInt(decoded.args[1].toString());
        const op = operators.get(addr) || await ctx.store.get(OracleOperator, addr);
        if (op) {
          op.totalSlashed += amount;
          op.stakedAmount = op.stakedAmount > amount ? op.stakedAmount - amount : 0n;
          op.lastActiveAt = blockTimestamp;
          operators.set(addr, op);
        }
      }

      // Committee Events
      if (eventSig === EVENTS.COMMITTEE_MEMBER_ADDED) {
        const feedId = log.topics[1];
        const addr = ('0x' + log.topics[2].slice(26)).toLowerCase();
        const memberId = `${feedId}-${addr}`;
        const feed = feeds.get(feedId) || await ctx.store.get(OracleFeed, feedId);
        const op = operators.get(addr) || await ctx.store.get(OracleOperator, addr);
        if (feed && op) {
          committeeMembers.set(memberId, new OracleCommitteeMember({
            id: memberId, feed, operator: op, isActive: true, addedAt: blockTimestamp, reportsInFeed: 0,
          }));
        }
      }

      if (eventSig === EVENTS.COMMITTEE_MEMBER_REMOVED) {
        const memberId = `${log.topics[1]}-${('0x' + log.topics[2].slice(26)).toLowerCase()}`;
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
        const [reportId, feedId] = decoded.args as unknown as [string, string];
        const round = BigInt(decoded.args[2].toString());
        const price = BigInt(decoded.args[3].toString());
        const confidence = BigInt(decoded.args[4].toString());
        const ts = Number(decoded.args[5]);
        const feed = feeds.get(feedId) || await ctx.store.get(OracleFeed, feedId);
        const submitter = accountFactory.getOrCreate(log.address.toLowerCase(), header.height, blockTimestamp);

        reports.set(reportId, new OracleReport({
          id: reportId, reportId, feed, round, price, confidence,
          timestamp: new Date(ts * 1000), signers: [], signatureCount: 0,
          isDisputed: false, isValid: true, submittedAt: blockTimestamp, submittedBy: submitter,
          txHash, blockNumber: header.height,
        }));

        if (feed) {
          feed.totalReports++;
          feed.latestPrice = price;
          feed.latestConfidence = confidence;
          feed.latestTimestamp = new Date(ts * 1000);
          feed.latestRound = round;
          feed.lastUpdated = blockTimestamp;
          feeds.set(feedId, feed);
        }
      }

      if (eventSig === EVENTS.REPORT_INVALIDATED) {
        const report = reports.get(log.topics[1]) || await ctx.store.get(OracleReport, log.topics[1]);
        if (report) {
          report.isValid = false;
          reports.set(log.topics[1], report);
        }
      }

      // Dispute Events
      if (eventSig === EVENTS.DISPUTE_OPENED) {
        const decoded = ABI.dispute.parseLog({ topics: log.topics, data: log.data });
        if (!decoded) continue;
        const [disputeId, reportId, disputerAddr] = decoded.args as unknown as [string, string, string];
        const bond = BigInt(decoded.args[3].toString());
        const reason = decoded.args[4] as string;
        const report = reports.get(reportId) || await ctx.store.get(OracleReport, reportId);
        const disputer = accountFactory.getOrCreate(disputerAddr, header.height, blockTimestamp);

        const dispute = new OracleDispute({
          id: disputeId, disputeId, report, feed: report?.feed, disputer, bond, reason,
          status: OracleDisputeStatus.OPEN, openedAt: blockTimestamp,
          challengeDeadline: new Date(blockTimestamp.getTime() + 86400000),
          txHash, blockNumber: header.height,
        });
        disputes.set(disputeId, dispute);

        if (report) {
          report.isDisputed = true;
          report.dispute = dispute;
          reports.set(reportId, report);
          if (report.feed) {
            const feed = feeds.get(report.feed.id) || await ctx.store.get(OracleFeed, report.feed.id);
            if (feed) { feed.totalDisputes++; feeds.set(feed.id, feed); }
          }
        }
      }

      if (eventSig === EVENTS.DISPUTE_CHALLENGED) {
        const decoded = ABI.dispute.parseLog({ topics: log.topics, data: log.data });
        if (!decoded) continue;
        const disputeId = decoded.args[0] as string;
        const dispute = disputes.get(disputeId) || await ctx.store.get(OracleDispute, disputeId);
        if (dispute) {
          dispute.status = OracleDisputeStatus.CHALLENGED;
          dispute.challenger = accountFactory.getOrCreate(decoded.args[1] as string, header.height, blockTimestamp);
          dispute.challengeBond = BigInt(decoded.args[2].toString());
          disputes.set(disputeId, dispute);
        }
      }

      if (eventSig === EVENTS.DISPUTE_RESOLVED) {
        const decoded = ABI.dispute.parseLog({ topics: log.topics, data: log.data });
        if (!decoded) continue;
        const disputeId = decoded.args[0] as string;
        const dispute = disputes.get(disputeId) || await ctx.store.get(OracleDispute, disputeId);
        if (dispute) {
          dispute.status = OracleDisputeStatus.RESOLVED;
          dispute.resolvedAt = blockTimestamp;
          const outcome = Number(decoded.args[1]);
          dispute.outcome = outcome === 0 ? OracleDisputeOutcome.VALID : 
                           outcome === 1 ? OracleDisputeOutcome.INVALID : OracleDisputeOutcome.PENDING;
          dispute.slashedAmount = BigInt(decoded.args[2].toString());
          disputes.set(disputeId, dispute);
        }
      }

      if (eventSig === EVENTS.DISPUTE_ESCALATED) {
        const dispute = disputes.get(log.topics[1]) || await ctx.store.get(OracleDispute, log.topics[1]);
        if (dispute) {
          dispute.status = OracleDisputeStatus.ESCALATED;
          disputes.set(log.topics[1], dispute);
        }
      }

      // Subscription Events
      if (eventSig === EVENTS.SUBSCRIPTION_CREATED) {
        const decoded = ABI.subscription.parseLog({ topics: log.topics, data: log.data });
        if (!decoded) continue;
        const subId = BigInt(decoded.args[0].toString());
        const [startTime, endTime] = [Number(decoded.args[3]), Number(decoded.args[4])];
        subscriptions.set(subId.toString(), new OracleSubscription({
          id: subId.toString(), subscriptionId: subId,
          subscriber: getOrCreateAccount(decoded.args[1] as string, header.height, blockTimestamp),
          feedIds: decoded.args[2] as string[],
          startTime: new Date(startTime * 1000), endTime: new Date(endTime * 1000),
          monthsPaid: Math.ceil((endTime - startTime) / 2592000),
          totalPaid: 0n, isActive: true, createdAt: blockTimestamp, txHash,
        }));
      }

      if (eventSig === EVENTS.SUBSCRIPTION_CANCELLED) {
        const id = BigInt(log.topics[1]).toString();
        const sub = subscriptions.get(id) || await ctx.store.get(OracleSubscription, id);
        if (sub) {
          sub.isActive = false;
          sub.cancelledAt = blockTimestamp;
          subscriptions.set(id, sub);
        }
      }

      // Attestation Events
      if (eventSig === EVENTS.ATTESTATION_SUBMITTED) {
        const decoded = ABI.attestation.parseLog({ topics: log.topics, data: log.data });
        if (!decoded) continue;
        const addr = (decoded.args[0] as string).toLowerCase();
        const epoch = BigInt(decoded.args[1].toString());
        const [feedsServed, reportsSubmitted, reportsAccepted, disputesReceived] = 
          [2, 3, 4, 5].map(i => Number(decoded.args[i]));
        const op = operators.get(addr) || await ctx.store.get(OracleOperator, addr);

        if (op) {
          const participationScore = feedsServed > 0 ? Math.min(10000, feedsServed * 100) : 0;
          const accuracyScore = reportsSubmitted > 0 ? Math.floor((reportsAccepted / reportsSubmitted) * 10000) : 0;
          const attestationId = `${epoch}-${addr}`;

          attestations.set(attestationId, new OracleAttestation({
            id: attestationId, operator: op, epoch, feedsServed, reportsSubmitted, reportsAccepted,
            disputesReceived, participationScore, accuracyScore, attestedAt: blockTimestamp, txHash,
          }));

          op.reportsSubmitted += reportsSubmitted;
          op.reportsAccepted += reportsAccepted;
          op.disputesAgainst += disputesReceived;
          op.participationScore = participationScore;
          op.accuracyScore = accuracyScore;
          op.lastActiveAt = blockTimestamp;
          operators.set(addr, op);
        }
      }
    }
  }

  // Persist entities (order matters for FK dependencies)
  if (accounts.size) await ctx.store.upsert([...accounts.values()]);
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

