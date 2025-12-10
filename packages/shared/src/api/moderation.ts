/**
 * Shared Moderation API
 * Used by Gateway and Bazaar for A2A/MCP endpoints
 */

import { createPublicClient, http, formatEther, Address, parseEther, Chain } from 'viem';
import { baseSepolia } from 'viem/chains';

// ============ Types ============

export interface ModerationConfig {
  chain?: Chain;
  rpcUrl?: string;
  banManagerAddress?: Address;
  moderationMarketplaceAddress?: Address;
  reportingSystemAddress?: Address;
  reputationLabelManagerAddress?: Address;
}

export interface BanStatus {
  address: string;
  isBanned: boolean;
  isOnNotice: boolean;
  banType: string;
  reason: string;
  caseId: string | null;
  reporter: string | null;
  bannedAt: number | null;
  canAppeal: boolean;
}

export interface ModeratorProfile {
  address: string;
  stakeAmount: string;
  isStaked: boolean;
  stakedSince: number;
  reputationScore: number;
  tier: string;
  successfulBans: number;
  unsuccessfulBans: number;
  winRate: number;
  totalEarned: string;
  totalLost: string;
  netPnL: string;
  canReport: boolean;
  requiredStake: string;
  quorumRequired: number;
}

export interface ModerationCase {
  caseId: string;
  reporter: string;
  target: string;
  reporterStake: string;
  targetStake: string;
  reason: string;
  evidenceHash: string;
  status: string;
  createdAt: number;
  votingEndsAt: number;
  yesVotes: string;
  noVotes: string;
  totalPot: string;
  resolved: boolean;
  outcome: string;
  appealCount: number;
  votingActive: boolean;
}

export interface Report {
  reportId: number;
  reportType: string;
  severity: string;
  targetAgentId: number;
  sourceApp: string;
  reporter: string;
  evidenceHash: string;
  details: string;
  marketId: string;
  reportBond: string;
  createdAt: number;
  votingEndsAt: number;
  status: string;
}

export interface AgentLabels {
  agentId: number;
  labels: string[];
  isHacker: boolean;
  isScammer: boolean;
  isSpamBot: boolean;
  isTrusted: boolean;
}

export interface ModerationStats {
  totalCases: number;
  activeCases: number;
  resolvedCases: number;
  totalReports: number;
  totalStaked: string;
  minReporterStake: string;
  averageCaseDuration: number;
  banRate: number;
}

export interface TransactionRequest {
  to: string;
  value?: string;
  functionName: string;
  args?: (string | number | boolean)[];
  description: string;
}

// ============ Constants ============

export const BAN_TYPES = { NONE: 0, ON_NOTICE: 1, CHALLENGED: 2, PERMANENT: 3 } as const;
export const CASE_STATUS = { PENDING: 0, CHALLENGED: 1, RESOLVED_BAN: 2, RESOLVED_CLEAR: 3 } as const;
export const REPUTATION_TIERS = { UNTRUSTED: 0, LOW: 1, MEDIUM: 2, HIGH: 3, TRUSTED: 4 } as const;
export const REPORT_TYPES = { NETWORK_BAN: 0, APP_BAN: 1, HACKER_LABEL: 2, SCAMMER_LABEL: 3 } as const;
export const SEVERITY_LEVELS = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 } as const;
export const LABELS = { NONE: 0, HACKER: 1, SCAMMER: 2, SPAM_BOT: 3, TRUSTED: 4 } as const;

const BAN_TYPE_NAMES: Record<number, string> = { 0: 'NONE', 1: 'ON_NOTICE', 2: 'CHALLENGED', 3: 'PERMANENT' };
const CASE_STATUS_NAMES: Record<number, string> = { 0: 'PENDING', 1: 'CHALLENGED', 2: 'RESOLVED_BAN', 3: 'RESOLVED_CLEAR' };
const TIER_NAMES: Record<number, string> = { 0: 'UNTRUSTED', 1: 'LOW', 2: 'MEDIUM', 3: 'HIGH', 4: 'TRUSTED' };
const REPORT_TYPE_NAMES: Record<number, string> = { 0: 'NETWORK_BAN', 1: 'APP_BAN', 2: 'HACKER_LABEL', 3: 'SCAMMER_LABEL' };
const SEVERITY_NAMES: Record<number, string> = { 0: 'LOW', 1: 'MEDIUM', 2: 'HIGH', 3: 'CRITICAL' };
const REPORT_STATUS_NAMES: Record<number, string> = { 0: 'PENDING', 1: 'RESOLVED_YES', 2: 'RESOLVED_NO', 3: 'EXECUTED' };
const LABEL_NAMES: Record<number, string> = { 0: 'NONE', 1: 'HACKER', 2: 'SCAMMER', 3: 'SPAM_BOT', 4: 'TRUSTED' };

// ============ ABIs ============

const BAN_MANAGER_ABI = [
  { name: 'isAddressBanned', type: 'function', stateMutability: 'view', inputs: [{ name: 'target', type: 'address' }], outputs: [{ name: '', type: 'bool' }] },
  { name: 'isOnNotice', type: 'function', stateMutability: 'view', inputs: [{ name: 'target', type: 'address' }], outputs: [{ name: '', type: 'bool' }] },
  { name: 'getAddressBan', type: 'function', stateMutability: 'view', inputs: [{ name: 'target', type: 'address' }], outputs: [{ type: 'tuple', components: [{ name: 'isBanned', type: 'bool' }, { name: 'banType', type: 'uint8' }, { name: 'bannedAt', type: 'uint256' }, { name: 'expiresAt', type: 'uint256' }, { name: 'reason', type: 'string' }, { name: 'proposalId', type: 'bytes32' }, { name: 'reporter', type: 'address' }, { name: 'caseId', type: 'bytes32' }] }] },
] as const;

const MODERATION_MARKETPLACE_ABI = [
  { name: 'getStake', type: 'function', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'tuple', components: [{ name: 'amount', type: 'uint256' }, { name: 'stakedAt', type: 'uint256' }, { name: 'stakedBlock', type: 'uint256' }, { name: 'lastActivityBlock', type: 'uint256' }, { name: 'isStaked', type: 'bool' }] }] },
  { name: 'getModeratorReputation', type: 'function', stateMutability: 'view', inputs: [{ name: 'moderator', type: 'address' }], outputs: [{ type: 'tuple', components: [{ name: 'successfulBans', type: 'uint256' }, { name: 'unsuccessfulBans', type: 'uint256' }, { name: 'totalSlashedFrom', type: 'uint256' }, { name: 'totalSlashedOthers', type: 'uint256' }, { name: 'reputationScore', type: 'uint256' }, { name: 'lastReportTimestamp', type: 'uint256' }, { name: 'reportCooldownUntil', type: 'uint256' }] }] },
  { name: 'getModeratorPnL', type: 'function', stateMutability: 'view', inputs: [{ name: 'moderator', type: 'address' }], outputs: [{ name: '', type: 'int256' }] },
  { name: 'getReputationTier', type: 'function', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: '', type: 'uint8' }] },
  { name: 'canReport', type: 'function', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: '', type: 'bool' }] },
  { name: 'getAllCaseIds', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bytes32[]' }] },
  { name: 'getCase', type: 'function', stateMutability: 'view', inputs: [{ name: 'caseId', type: 'bytes32' }], outputs: [{ type: 'tuple', components: [{ name: 'caseId', type: 'bytes32' }, { name: 'reporter', type: 'address' }, { name: 'target', type: 'address' }, { name: 'reporterStake', type: 'uint256' }, { name: 'targetStake', type: 'uint256' }, { name: 'reason', type: 'string' }, { name: 'evidenceHash', type: 'bytes32' }, { name: 'status', type: 'uint8' }, { name: 'createdAt', type: 'uint256' }, { name: 'marketOpenUntil', type: 'uint256' }, { name: 'yesVotes', type: 'uint256' }, { name: 'noVotes', type: 'uint256' }, { name: 'totalPot', type: 'uint256' }, { name: 'resolved', type: 'bool' }, { name: 'outcome', type: 'uint8' }, { name: 'appealCount', type: 'uint256' }] }] },
  { name: 'minReporterStake', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'totalStaked', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'getRequiredStakeForReporter', type: 'function', stateMutability: 'view', inputs: [{ name: 'reporter', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'getQuorumRequired', type: 'function', stateMutability: 'view', inputs: [{ name: 'reporter', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
] as const;

const REPORTING_SYSTEM_ABI = [
  { name: 'getAllReports', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256[]' }] },
  { name: 'getReport', type: 'function', stateMutability: 'view', inputs: [{ name: 'reportId', type: 'uint256' }], outputs: [{ type: 'tuple', components: [{ name: 'reportId', type: 'uint256' }, { name: 'reportType', type: 'uint8' }, { name: 'severity', type: 'uint8' }, { name: 'targetAgentId', type: 'uint256' }, { name: 'sourceAppId', type: 'bytes32' }, { name: 'reporter', type: 'address' }, { name: 'reporterAgentId', type: 'uint256' }, { name: 'evidenceHash', type: 'bytes32' }, { name: 'details', type: 'string' }, { name: 'marketId', type: 'bytes32' }, { name: 'reportBond', type: 'uint256' }, { name: 'createdAt', type: 'uint256' }, { name: 'votingEnds', type: 'uint256' }, { name: 'status', type: 'uint8' }] }] },
] as const;

const REPUTATION_LABEL_MANAGER_ABI = [
  { name: 'getLabels', type: 'function', stateMutability: 'view', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ name: '', type: 'uint8[]' }] },
] as const;

// ============ Contract Return Types ============

type StakeData = {
  amount: bigint;
  stakedAt: bigint;
  stakedBlock: bigint;
  lastActivityBlock: bigint;
  isStaked: boolean;
};

type ReputationData = {
  successfulBans: bigint;
  unsuccessfulBans: bigint;
  totalSlashedFrom: bigint;
  totalSlashedOthers: bigint;
  reputationScore: bigint;
  lastReportTimestamp: bigint;
  reportCooldownUntil: bigint;
};

type CaseData = {
  caseId: `0x${string}`;
  reporter: `0x${string}`;
  target: `0x${string}`;
  reporterStake: bigint;
  targetStake: bigint;
  reason: string;
  evidenceHash: `0x${string}`;
  status: number;
  createdAt: bigint;
  marketOpenUntil: bigint;
  yesVotes: bigint;
  noVotes: bigint;
  totalPot: bigint;
  resolved: boolean;
  outcome: number;
  appealCount: bigint;
};

type ReportData = {
  reportId: bigint;
  reportType: number;
  severity: number;
  targetAgentId: bigint;
  sourceAppId: `0x${string}`;
  reporter: `0x${string}`;
  reporterAgentId: bigint;
  evidenceHash: `0x${string}`;
  details: string;
  marketId: `0x${string}`;
  reportBond: bigint;
  createdAt: bigint;
  votingEnds: bigint;
  status: number;
};

// ============ ModerationAPI Class ============

// Client type that works across viem versions
type ViemClient = {
  readContract: (params: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }) => Promise<unknown>;
};

export class ModerationAPI {
  private client: ViemClient;
  private config: ModerationConfig;

  constructor(config: ModerationConfig = {}) {
    this.config = config;
    this.client = createPublicClient({
      chain: config.chain || baseSepolia,
      transport: http(config.rpcUrl),
    }) as ViemClient;
  }

  async checkBanStatus(address: string): Promise<BanStatus> {
    const defaultResult: BanStatus = { address, isBanned: false, isOnNotice: false, banType: 'NONE', reason: '', caseId: null, reporter: null, bannedAt: null, canAppeal: false };
    if (!this.config.banManagerAddress) return defaultResult;

    const [isAddressBanned, isOnNotice, addressBan] = await Promise.all([
      this.client.readContract({ address: this.config.banManagerAddress, abi: BAN_MANAGER_ABI, functionName: 'isAddressBanned', args: [address as Address] }).catch(() => false),
      this.client.readContract({ address: this.config.banManagerAddress, abi: BAN_MANAGER_ABI, functionName: 'isOnNotice', args: [address as Address] }).catch(() => false),
      this.client.readContract({ address: this.config.banManagerAddress, abi: BAN_MANAGER_ABI, functionName: 'getAddressBan', args: [address as Address] }).catch(() => null),
    ]);

    const isBanned = isAddressBanned as boolean;
    const onNotice = isOnNotice as boolean;
    
    if (!isBanned && !onNotice) return defaultResult;

    const ban = addressBan as { banType: number; reason: string; caseId: `0x${string}`; reporter: Address; bannedAt: bigint } | null;
    return {
      address,
      isBanned,
      isOnNotice: onNotice,
      banType: BAN_TYPE_NAMES[ban?.banType ?? 0],
      reason: ban?.reason || (isOnNotice ? 'Account on notice - pending review' : 'Banned'),
      caseId: ban?.caseId && ban.caseId !== '0x0000000000000000000000000000000000000000000000000000000000000000' ? ban.caseId : null,
      reporter: ban?.reporter || null,
      bannedAt: ban?.bannedAt ? Number(ban.bannedAt) : null,
      canAppeal: ban?.banType === 3,
    };
  }

  async getModeratorProfile(address: string): Promise<ModeratorProfile | null> {
    if (!this.config.moderationMarketplaceAddress) return null;

    const [stake, rep, pnl, tier, canReport, requiredStake, quorum] = await Promise.all([
      this.client.readContract({ address: this.config.moderationMarketplaceAddress, abi: MODERATION_MARKETPLACE_ABI, functionName: 'getStake', args: [address as Address] }).catch(() => null),
      this.client.readContract({ address: this.config.moderationMarketplaceAddress, abi: MODERATION_MARKETPLACE_ABI, functionName: 'getModeratorReputation', args: [address as Address] }).catch(() => null),
      this.client.readContract({ address: this.config.moderationMarketplaceAddress, abi: MODERATION_MARKETPLACE_ABI, functionName: 'getModeratorPnL', args: [address as Address] }).catch(() => BigInt(0)),
      this.client.readContract({ address: this.config.moderationMarketplaceAddress, abi: MODERATION_MARKETPLACE_ABI, functionName: 'getReputationTier', args: [address as Address] }).catch(() => 2),
      this.client.readContract({ address: this.config.moderationMarketplaceAddress, abi: MODERATION_MARKETPLACE_ABI, functionName: 'canReport', args: [address as Address] }).catch(() => false),
      this.client.readContract({ address: this.config.moderationMarketplaceAddress, abi: MODERATION_MARKETPLACE_ABI, functionName: 'getRequiredStakeForReporter', args: [address as Address] }).catch(() => parseEther('0.01')),
      this.client.readContract({ address: this.config.moderationMarketplaceAddress, abi: MODERATION_MARKETPLACE_ABI, functionName: 'getQuorumRequired', args: [address as Address] }).catch(() => BigInt(1)),
    ]);

    if (!stake || !rep) return null;

    const stakeData = stake as StakeData;
    const repData = rep as ReputationData;
    const wins = Number(repData.successfulBans);
    const losses = Number(repData.unsuccessfulBans);
    const total = wins + losses;

    return {
      address,
      stakeAmount: formatEther(stakeData.amount),
      isStaked: stakeData.isStaked,
      stakedSince: Number(stakeData.stakedAt),
      reputationScore: Number(repData.reputationScore),
      tier: TIER_NAMES[tier as number] || 'MEDIUM',
      successfulBans: wins,
      unsuccessfulBans: losses,
      winRate: total > 0 ? Math.round((wins / total) * 100) : 50,
      totalEarned: formatEther(repData.totalSlashedOthers),
      totalLost: formatEther(repData.totalSlashedFrom),
      netPnL: formatEther(pnl as bigint),
      canReport: canReport as boolean,
      requiredStake: formatEther(requiredStake as bigint),
      quorumRequired: Number(quorum),
    };
  }

  async getModerationCases(options?: { activeOnly?: boolean; resolvedOnly?: boolean; limit?: number }): Promise<ModerationCase[]> {
    if (!this.config.moderationMarketplaceAddress) return [];

    const rawCaseIds = await this.client.readContract({ address: this.config.moderationMarketplaceAddress, abi: MODERATION_MARKETPLACE_ABI, functionName: 'getAllCaseIds' }).catch(() => []);
    const caseIds = (rawCaseIds || []) as `0x${string}`[];
    if (!caseIds.length) return [];

    const limit = options?.limit || 50;
    const now = Math.floor(Date.now() / 1000);

    const cases = await Promise.all(
      caseIds.slice(0, limit).map(async (caseId: `0x${string}`) => {
        const rawCaseData = await this.client.readContract({ address: this.config.moderationMarketplaceAddress!, abi: MODERATION_MARKETPLACE_ABI, functionName: 'getCase', args: [caseId] }).catch(() => null);
        if (!rawCaseData) return null;
        const caseData = rawCaseData as CaseData;

        return {
          caseId: caseData.caseId,
          reporter: caseData.reporter,
          target: caseData.target,
          reporterStake: formatEther(caseData.reporterStake),
          targetStake: formatEther(caseData.targetStake),
          reason: caseData.reason,
          evidenceHash: caseData.evidenceHash,
          status: CASE_STATUS_NAMES[caseData.status] || 'UNKNOWN',
          createdAt: Number(caseData.createdAt),
          votingEndsAt: Number(caseData.marketOpenUntil),
          yesVotes: formatEther(caseData.yesVotes),
          noVotes: formatEther(caseData.noVotes),
          totalPot: formatEther(caseData.totalPot),
          resolved: caseData.resolved,
          outcome: caseData.outcome === 1 ? 'BAN_UPHELD' : caseData.outcome === 2 ? 'BAN_REJECTED' : 'PENDING',
          appealCount: Number(caseData.appealCount),
          votingActive: !caseData.resolved && Number(caseData.marketOpenUntil) > now,
        } as ModerationCase;
      })
    );

    let filtered = cases.filter((c): c is ModerationCase => c !== null);
    if (options?.activeOnly) filtered = filtered.filter((c: ModerationCase) => !c.resolved);
    if (options?.resolvedOnly) filtered = filtered.filter((c: ModerationCase) => c.resolved);
    return filtered;
  }

  async getModerationCase(caseId: string): Promise<ModerationCase | null> {
    if (!this.config.moderationMarketplaceAddress) return null;

    const rawCaseData = await this.client.readContract({ address: this.config.moderationMarketplaceAddress, abi: MODERATION_MARKETPLACE_ABI, functionName: 'getCase', args: [caseId as `0x${string}`] }).catch(() => null);
    if (!rawCaseData) return null;
    const caseData = rawCaseData as CaseData;

    const now = Math.floor(Date.now() / 1000);
    return {
      caseId: caseData.caseId,
      reporter: caseData.reporter,
      target: caseData.target,
      reporterStake: formatEther(caseData.reporterStake),
      targetStake: formatEther(caseData.targetStake),
      reason: caseData.reason,
      evidenceHash: caseData.evidenceHash,
      status: CASE_STATUS_NAMES[caseData.status] || 'UNKNOWN',
      createdAt: Number(caseData.createdAt),
      votingEndsAt: Number(caseData.marketOpenUntil),
      yesVotes: formatEther(caseData.yesVotes),
      noVotes: formatEther(caseData.noVotes),
      totalPot: formatEther(caseData.totalPot),
      resolved: caseData.resolved,
      outcome: caseData.outcome === 1 ? 'BAN_UPHELD' : caseData.outcome === 2 ? 'BAN_REJECTED' : 'PENDING',
      appealCount: Number(caseData.appealCount),
      votingActive: !caseData.resolved && Number(caseData.marketOpenUntil) > now,
    };
  }

  async getReports(options?: { limit?: number; pendingOnly?: boolean }): Promise<Report[]> {
    if (!this.config.reportingSystemAddress) return [];

    const rawReportIds = await this.client.readContract({ address: this.config.reportingSystemAddress, abi: REPORTING_SYSTEM_ABI, functionName: 'getAllReports' }).catch(() => [] as bigint[]);
    const reportIds = rawReportIds as bigint[];
    if (!reportIds.length) return [];

    const limit = options?.limit || 50;
    const reports = await Promise.all(
      reportIds.slice(0, limit).map(async (reportId: bigint) => {
        const rawReport = await this.client.readContract({ address: this.config.reportingSystemAddress!, abi: REPORTING_SYSTEM_ABI, functionName: 'getReport', args: [reportId] }).catch(() => null);
        if (!rawReport) return null;
        const report = rawReport as ReportData;

        return {
          reportId: Number(report.reportId),
          reportType: REPORT_TYPE_NAMES[report.reportType] || 'UNKNOWN',
          severity: SEVERITY_NAMES[report.severity] || 'UNKNOWN',
          targetAgentId: Number(report.targetAgentId),
          sourceApp: report.sourceAppId,
          reporter: report.reporter,
          evidenceHash: report.evidenceHash,
          details: report.details,
          marketId: report.marketId,
          reportBond: formatEther(report.reportBond),
          createdAt: Number(report.createdAt),
          votingEndsAt: Number(report.votingEnds),
          status: REPORT_STATUS_NAMES[report.status] || 'UNKNOWN',
        } as Report;
      })
    );

    let filtered = reports.filter((r): r is Report => r !== null);
    if (options?.pendingOnly) filtered = filtered.filter((r: Report) => r.status === 'PENDING');
    return filtered;
  }

  async getAgentLabels(agentId: number): Promise<AgentLabels> {
    const defaultResult: AgentLabels = { agentId, labels: [], isHacker: false, isScammer: false, isSpamBot: false, isTrusted: false };
    if (!this.config.reputationLabelManagerAddress) return defaultResult;

    const rawLabelIds = await this.client.readContract({ address: this.config.reputationLabelManagerAddress, abi: REPUTATION_LABEL_MANAGER_ABI, functionName: 'getLabels', args: [BigInt(agentId)] }).catch(() => [] as number[]);
    const labelIds = rawLabelIds as number[];
    const labels = labelIds.map((id: number) => LABEL_NAMES[id] || 'UNKNOWN').filter((l: string) => l !== 'NONE' && l !== 'UNKNOWN');

    return { agentId, labels, isHacker: labels.includes('HACKER'), isScammer: labels.includes('SCAMMER'), isSpamBot: labels.includes('SPAM_BOT'), isTrusted: labels.includes('TRUSTED') };
  }

  async getModerationStats(): Promise<ModerationStats> {
    const [caseIds, totalStaked, minStake, reportIds] = await Promise.all([
      this.config.moderationMarketplaceAddress ? this.client.readContract({ address: this.config.moderationMarketplaceAddress, abi: MODERATION_MARKETPLACE_ABI, functionName: 'getAllCaseIds' }).catch(() => []) : [],
      this.config.moderationMarketplaceAddress ? this.client.readContract({ address: this.config.moderationMarketplaceAddress, abi: MODERATION_MARKETPLACE_ABI, functionName: 'totalStaked' }).catch(() => BigInt(0)) : BigInt(0),
      this.config.moderationMarketplaceAddress ? this.client.readContract({ address: this.config.moderationMarketplaceAddress, abi: MODERATION_MARKETPLACE_ABI, functionName: 'minReporterStake' }).catch(() => parseEther('0.01')) : parseEther('0.01'),
      this.config.reportingSystemAddress ? this.client.readContract({ address: this.config.reportingSystemAddress, abi: REPORTING_SYSTEM_ABI, functionName: 'getAllReports' }).catch(() => []) : [],
    ]);

    const cases = await this.getModerationCases({ limit: 100 });
    const activeCases = cases.filter(c => !c.resolved).length;
    const resolvedCases = cases.filter(c => c.resolved).length;
    const banUpheld = cases.filter(c => c.outcome === 'BAN_UPHELD').length;

    // Calculate actual average case duration from resolved cases
    let totalDuration = 0;
    const resolvedWithDuration = cases.filter(c => c.resolved && c.createdAt > 0);
    for (const c of resolvedWithDuration) {
      const duration = c.votingEndsAt - c.createdAt;
      if (duration > 0) totalDuration += duration;
    }
    const avgDuration = resolvedWithDuration.length > 0 ? Math.round(totalDuration / resolvedWithDuration.length) : 0;

    return {
      totalCases: (caseIds as `0x${string}`[]).length,
      activeCases,
      resolvedCases,
      totalReports: (reportIds as bigint[]).length,
      totalStaked: formatEther(totalStaked as bigint),
      minReporterStake: formatEther(minStake as bigint),
      averageCaseDuration: avgDuration,
      banRate: resolvedCases > 0 ? Math.round((banUpheld / resolvedCases) * 100) : 0,
    };
  }

  // ============ Transaction Preparation ============

  prepareStake(amount: string): TransactionRequest {
    if (!this.config.moderationMarketplaceAddress) throw new Error('Moderation marketplace not configured');
    return { to: this.config.moderationMarketplaceAddress, value: parseEther(amount).toString(), functionName: 'stake', description: `Stake ${amount} ETH to become a moderator` };
  }

  prepareReport(target: string, reason: string, evidenceHash: string): TransactionRequest {
    if (!this.config.moderationMarketplaceAddress) throw new Error('Moderation marketplace not configured');
    return { to: this.config.moderationMarketplaceAddress, functionName: 'openCase', args: [target, reason, evidenceHash], description: `Report ${target.slice(0, 10)}... for: ${reason.slice(0, 50)}` };
  }

  prepareVote(caseId: string, voteYes: boolean): TransactionRequest {
    if (!this.config.moderationMarketplaceAddress) throw new Error('Moderation marketplace not configured');
    return { to: this.config.moderationMarketplaceAddress, functionName: 'vote', args: [caseId, voteYes ? 0 : 1], description: `Vote ${voteYes ? 'BAN' : 'CLEAR'} on case ${caseId.slice(0, 10)}...` };
  }

  prepareChallenge(caseId: string, stakeAmount: string): TransactionRequest {
    if (!this.config.moderationMarketplaceAddress) throw new Error('Moderation marketplace not configured');
    return { to: this.config.moderationMarketplaceAddress, value: parseEther(stakeAmount).toString(), functionName: 'challengeCase', args: [caseId], description: `Challenge case ${caseId.slice(0, 10)}...` };
  }

  prepareAppeal(caseId: string, stakeAmount: string): TransactionRequest {
    if (!this.config.moderationMarketplaceAddress) throw new Error('Moderation marketplace not configured');
    return { to: this.config.moderationMarketplaceAddress, value: parseEther(stakeAmount).toString(), functionName: 'requestReReview', args: [caseId], description: `Appeal ban decision for case ${caseId.slice(0, 10)}...` };
  }
}

// ============ Factory Function ============

export function createModerationAPI(config: ModerationConfig = {}): ModerationAPI {
  return new ModerationAPI(config);
}
