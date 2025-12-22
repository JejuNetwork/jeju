/**
 * Moderation Event Processor
 * 
 * Indexes moderation-related events:
 * - Ban events (network + app level)
 * - Moderation cases and votes
 * - Evidence submissions
 * - Report resolutions
 * - Label proposals
 */

import { decodeEventLog, type Hex, type Address, hexToBytes } from 'viem';
import type { Store } from '@subsquid/typeorm-store';
import {
  ModerationReport,
  AgentBanEvent,
  RegisteredAgent,
  ReportType,
  ReportSeverity,
  ReportStatus,
} from './model';

// Subsquid log type for compatibility
interface SubsquidLog {
  address: string;
  data: string;
  topics: string[];
  logIndex: number;
  transactionHash: string;
}

// ============ Event Signatures ============

const EVENT_SIGNATURES = {
  // BanManager events
  NetworkBanApplied: 'NetworkBanApplied(uint256,string,bytes32,uint256)',
  AppBanApplied: 'AppBanApplied(uint256,bytes32,string,bytes32,uint256)',
  NetworkBanRemoved: 'NetworkBanRemoved(uint256,uint256)',
  AppBanRemoved: 'AppBanRemoved(uint256,bytes32,uint256)',
  OnNoticeBanApplied: 'OnNoticeBanApplied(address,address,bytes32,string)',
  AddressBanApplied: 'AddressBanApplied(address,uint8,bytes32,string)',
  AddressBanRemoved: 'AddressBanRemoved(address)',
  
  // ModerationMarketplace events
  CaseCreated: 'CaseCreated(bytes32,address,address,string,bytes32,uint8)',
  CaseResolved: 'CaseResolved(bytes32,uint8,uint256,uint256)',
  VoteCast: 'VoteCast(bytes32,address,uint8,uint256)',
  StakeDeposited: 'StakeDeposited(address,uint256)',
  StakeWithdrawn: 'StakeWithdrawn(address,uint256)',
  RewardDistributed: 'RewardDistributed(bytes32,address,uint256)',
  
  // EvidenceRegistry events
  EvidenceSubmitted: 'EvidenceSubmitted(bytes32,bytes32,address,uint256,uint8,string,uint256)',
  EvidenceSupported: 'EvidenceSupported(bytes32,address,uint256,bool,string,uint256)',
  CaseRegistered: 'CaseRegistered(bytes32,uint256,uint256)',
  
  // ReportingSystem events
  ReportSubmitted: 'ReportSubmitted(uint256,uint8,uint8,uint256,bytes32,address)',
  ReportResolved: 'ReportResolved(uint256,uint8)',
  
  // ReputationLabelManager events
  LabelProposed: 'LabelProposed(bytes32,uint256,uint8,address,uint256)',
  LabelApproved: 'LabelApproved(bytes32,uint256,uint8)',
  LabelRejected: 'LabelRejected(bytes32,uint256)',
} as const;

// ============ ABIs ============

const BAN_MANAGER_ABI = [
  {
    type: 'event',
    name: 'NetworkBanApplied',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'reason', type: 'string', indexed: false },
      { name: 'proposalId', type: 'bytes32', indexed: true },
      { name: 'timestamp', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'AppBanApplied',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'appId', type: 'bytes32', indexed: true },
      { name: 'reason', type: 'string', indexed: false },
      { name: 'proposalId', type: 'bytes32', indexed: true },
      { name: 'timestamp', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'NetworkBanRemoved',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'timestamp', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'AppBanRemoved',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'appId', type: 'bytes32', indexed: true },
      { name: 'timestamp', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'AddressBanApplied',
    inputs: [
      { name: 'target', type: 'address', indexed: true },
      { name: 'banType', type: 'uint8', indexed: false },
      { name: 'caseId', type: 'bytes32', indexed: true },
      { name: 'reason', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'AddressBanRemoved',
    inputs: [
      { name: 'target', type: 'address', indexed: true },
    ],
  },
] as const;

const MODERATION_MARKETPLACE_ABI = [
  {
    type: 'event',
    name: 'CaseCreated',
    inputs: [
      { name: 'caseId', type: 'bytes32', indexed: true },
      { name: 'reporter', type: 'address', indexed: true },
      { name: 'target', type: 'address', indexed: true },
      { name: 'reason', type: 'string', indexed: false },
      { name: 'evidenceHash', type: 'bytes32', indexed: false },
      { name: 'status', type: 'uint8', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'CaseResolved',
    inputs: [
      { name: 'caseId', type: 'bytes32', indexed: true },
      { name: 'outcome', type: 'uint8', indexed: false },
      { name: 'yesVotes', type: 'uint256', indexed: false },
      { name: 'noVotes', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'VoteCast',
    inputs: [
      { name: 'caseId', type: 'bytes32', indexed: true },
      { name: 'voter', type: 'address', indexed: true },
      { name: 'position', type: 'uint8', indexed: false },
      { name: 'weight', type: 'uint256', indexed: false },
    ],
  },
] as const;

const REPORTING_SYSTEM_ABI = [
  {
    type: 'event',
    name: 'ReportSubmitted',
    inputs: [
      { name: 'reportId', type: 'uint256', indexed: true },
      { name: 'reportType', type: 'uint8', indexed: false },
      { name: 'severity', type: 'uint8', indexed: false },
      { name: 'targetAgentId', type: 'uint256', indexed: true },
      { name: 'sourceAppId', type: 'bytes32', indexed: false },
      { name: 'reporter', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'ReportResolved',
    inputs: [
      { name: 'reportId', type: 'uint256', indexed: true },
      { name: 'status', type: 'uint8', indexed: false },
    ],
  },
] as const;

// ============ Contract Addresses ============

interface ModerationContracts {
  banManager: Address;
  moderationMarketplace: Address;
  evidenceRegistry: Address;
  reportingSystem: Address;
  reputationLabelManager: Address;
}

let contracts: ModerationContracts | null = null;

export function initModerationContracts(config: ModerationContracts): void {
  contracts = config;
}

// ============ Event Handlers ============

export async function processNetworkBanApplied(
  log: SubsquidLog,
  store: Store,
  blockNumber: number,
  timestamp: Date,
  txHash: string
): Promise<void> {
  const decoded = decodeEventLog({
    abi: BAN_MANAGER_ABI,
    data: log.data as Hex,
    topics: log.topics as [Hex, ...Hex[]],
  });

  if (decoded.eventName !== 'NetworkBanApplied') return;

  const { agentId, reason, proposalId } = decoded.args as {
    agentId: bigint;
    reason: string;
    proposalId: Hex;
  };

  // Update agent ban status
  const agent = await store.get(RegisteredAgent, { where: { agentId } });
  if (agent) {
    agent.isBanned = true;
    await store.save(agent);
  }

  // Create ban event
  const banEvent = new AgentBanEvent();
  banEvent.id = `${txHash}-${log.logIndex}`;
  banEvent.agent = agent!;
  banEvent.isBan = true;
  banEvent.banType = 'network';
  banEvent.reason = reason;
  banEvent.proposalId = proposalId;
  banEvent.timestamp = timestamp;
  banEvent.txHash = txHash;
  banEvent.blockNumber = blockNumber;

  await store.save(banEvent);
}

export async function processNetworkBanRemoved(
  log: SubsquidLog,
  store: Store,
  blockNumber: number,
  timestamp: Date,
  txHash: string
): Promise<void> {
  const decoded = decodeEventLog({
    abi: BAN_MANAGER_ABI,
    data: log.data as Hex,
    topics: log.topics as [Hex, ...Hex[]],
  });

  if (decoded.eventName !== 'NetworkBanRemoved') return;

  const { agentId } = decoded.args as { agentId: bigint };

  // Update agent ban status
  const agent = await store.get(RegisteredAgent, { where: { agentId } });
  if (agent) {
    agent.isBanned = false;
    await store.save(agent);
  }

  // Create unban event
  const banEvent = new AgentBanEvent();
  banEvent.id = `${txHash}-${log.logIndex}`;
  banEvent.agent = agent!;
  banEvent.isBan = false;
  banEvent.banType = 'network';
  banEvent.timestamp = timestamp;
  banEvent.txHash = txHash;
  banEvent.blockNumber = blockNumber;

  await store.save(banEvent);
}

export async function processAppBanApplied(
  log: SubsquidLog,
  store: Store,
  blockNumber: number,
  timestamp: Date,
  txHash: string
): Promise<void> {
  const decoded = decodeEventLog({
    abi: BAN_MANAGER_ABI,
    data: log.data as Hex,
    topics: log.topics as [Hex, ...Hex[]],
  });

  if (decoded.eventName !== 'AppBanApplied') return;

  const { agentId, appId, reason, proposalId } = decoded.args as {
    agentId: bigint;
    appId: Hex;
    reason: string;
    proposalId: Hex;
  };

  const agent = await store.get(RegisteredAgent, { where: { agentId } });

  const banEvent = new AgentBanEvent();
  banEvent.id = `${txHash}-${log.logIndex}`;
  banEvent.agent = agent!;
  banEvent.isBan = true;
  banEvent.banType = 'app';
  banEvent.appId = appId;
  banEvent.reason = reason;
  banEvent.proposalId = proposalId;
  banEvent.timestamp = timestamp;
  banEvent.txHash = txHash;
  banEvent.blockNumber = blockNumber;

  await store.save(banEvent);
}

export async function processReportSubmitted(
  log: SubsquidLog,
  store: Store,
  _blockNumber: number,
  timestamp: Date,
  _txHash: string
): Promise<void> {
  const decoded = decodeEventLog({
    abi: REPORTING_SYSTEM_ABI,
    data: log.data as Hex,
    topics: log.topics as [Hex, ...Hex[]],
  });

  if (decoded.eventName !== 'ReportSubmitted') return;

  const { reportId, reportType, severity, targetAgentId, reporter } = 
    decoded.args as {
      reportId: bigint;
      reportType: number;
      severity: number;
      targetAgentId: bigint;
      sourceAppId: Hex;
      reporter: Address;
    };

  const report = new ModerationReport();
  report.id = reportId.toString();
  report.reportId = reportId;
  report.targetAgentId = targetAgentId;
  report.reporter = hexToBytes(reporter);
  report.reportType = mapReportType(reportType);
  report.severity = mapSeverity(severity);
  report.status = ReportStatus.PENDING;
  report.details = '';
  report.createdAt = timestamp;

  await store.save(report);
}

export async function processReportResolved(
  log: SubsquidLog,
  store: Store,
  _blockNumber: number,
  _timestamp: Date,
  _txHash: string
): Promise<void> {
  const decoded = decodeEventLog({
    abi: REPORTING_SYSTEM_ABI,
    data: log.data as Hex,
    topics: log.topics as [Hex, ...Hex[]],
  });

  if (decoded.eventName !== 'ReportResolved') return;

  const { reportId, status } = decoded.args as {
    reportId: bigint;
    status: number;
  };

  const report = await store.get(ModerationReport, reportId.toString());
  if (report) {
    report.status = mapReportStatus(status);
    await store.save(report);
  }
}

// ============ Helpers ============

function mapReportType(type: number): ReportType {
  switch (type) {
    case 0: return ReportType.NETWORK_BAN;
    case 1: return ReportType.APP_BAN;
    case 2: return ReportType.LABEL_HACKER;
    case 3: return ReportType.LABEL_SCAMMER;
    default: return ReportType.NETWORK_BAN;
  }
}

function mapSeverity(severity: number): ReportSeverity {
  switch (severity) {
    case 0: return ReportSeverity.LOW;
    case 1: return ReportSeverity.MEDIUM;
    case 2: return ReportSeverity.HIGH;
    case 3: return ReportSeverity.CRITICAL;
    default: return ReportSeverity.LOW;
  }
}

function mapReportStatus(status: number): ReportStatus {
  switch (status) {
    case 0: return ReportStatus.PENDING;
    case 1: return ReportStatus.RESOLVED_YES;
    case 2: return ReportStatus.RESOLVED_NO;
    case 3: return ReportStatus.EXECUTED;
    default: return ReportStatus.PENDING;
  }
}

// ============ Main Processor ============

export async function processModerationEvent(
  log: SubsquidLog,
  store: Store,
  blockNumber: number,
  timestamp: Date,
  txHash: string
): Promise<void> {
  if (!contracts) {
    console.warn('Moderation contracts not initialized');
    return;
  }

  const address = log.address?.toLowerCase();
  
  // Route to appropriate handler based on contract address
  if (address === contracts.banManager.toLowerCase()) {
    const topic0 = log.topics[0];
    
    // Match by topic signature
    if (topic0?.includes('NetworkBanApplied')) {
      await processNetworkBanApplied(log, store, blockNumber, timestamp, txHash);
    } else if (topic0?.includes('NetworkBanRemoved')) {
      await processNetworkBanRemoved(log, store, blockNumber, timestamp, txHash);
    } else if (topic0?.includes('AppBanApplied')) {
      await processAppBanApplied(log, store, blockNumber, timestamp, txHash);
    }
  } else if (address === contracts.reportingSystem.toLowerCase()) {
    const topic0 = log.topics[0];
    
    if (topic0?.includes('ReportSubmitted')) {
      await processReportSubmitted(log, store, blockNumber, timestamp, txHash);
    } else if (topic0?.includes('ReportResolved')) {
      await processReportResolved(log, store, blockNumber, timestamp, txHash);
    }
  }
}

export { EVENT_SIGNATURES };

