/**
 * Moderation Module - Evidence submission, cases, bans, and community moderation
 *
 * This module exposes:
 * - EvidenceRegistry: Submit and support evidence for cases
 * - ModerationMarketplace: Create and manage moderation cases
 * - ReportingSystem: Cross-app reporting with futarchy resolution
 * - BanManager: Network-level and app-specific bans
 * - ReputationLabelManager: Issue and revoke reputation labels
 */

import type { NetworkType } from "@jejunetwork/types";
import { type Address, encodeFunctionData, type Hex, parseEther } from "viem";
import { requireContract } from "../config";
import type { JejuWallet } from "../wallet";

// ═══════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════

export const BanType = {
  NONE: 0,
  ON_NOTICE: 1,
  CHALLENGED: 2,
  PERMANENT: 3,
} as const;
export type BanType = (typeof BanType)[keyof typeof BanType];

export const ReportType = {
  NETWORK_BAN: 0,
  APP_BAN: 1,
  LABEL_HACKER: 2,
  LABEL_SCAMMER: 3,
} as const;
export type ReportType = (typeof ReportType)[keyof typeof ReportType];

export const SeverityLevel = {
  LOW: 0, // 7 day voting
  MEDIUM: 1, // 3 day voting
  HIGH: 2, // 24 hour voting
  CRITICAL: 3, // Immediate temp ban + 24 hour voting
} as const;
export type SeverityLevel = (typeof SeverityLevel)[keyof typeof SeverityLevel];

export const ReportStatus = {
  PENDING: 0,
  VOTING: 1,
  RESOLVED_YES: 2,
  RESOLVED_NO: 3,
  CANCELLED: 4,
} as const;
export type ReportStatus = (typeof ReportStatus)[keyof typeof ReportStatus];

export interface BanRecord {
  isBanned: boolean;
  banType: BanType;
  bannedAt: bigint;
  expiresAt: bigint;
  reason: string;
  proposalId: Hex;
  reporter: Address;
  caseId: Hex;
}

export interface Report {
  reportId: Hex;
  reporter: Address;
  reportedAgentId: bigint;
  reportedAddress: Address;
  reportType: ReportType;
  severity: SeverityLevel;
  status: ReportStatus;
  evidenceHash: string;
  reason: string;
  appId: Hex;
  stake: bigint;
  createdAt: bigint;
  resolvedAt: bigint;
  marketId: Hex;
}

export interface CreateReportParams {
  reportedAgentId?: bigint;
  reportedAddress?: Address;
  reportType: ReportType;
  severity: SeverityLevel;
  evidenceHash: string; // IPFS CID
  reason: string;
  appId?: Hex; // For APP_BAN type
  stake?: bigint;
}

export const EvidencePosition = {
  FOR_ACTION: 0, // Evidence supports taking action (ban/slash)
  AGAINST_ACTION: 1, // Evidence opposes taking action
} as const;
export type EvidencePosition =
  (typeof EvidencePosition)[keyof typeof EvidencePosition];

export const EvidenceStatus = {
  ACTIVE: 0, // Case still open
  REWARDED: 1, // Case resolved in evidence's favor
  SLASHED: 2, // Case resolved against evidence
} as const;
export type EvidenceStatus =
  (typeof EvidenceStatus)[keyof typeof EvidenceStatus];

export const CaseStatus = {
  PENDING: 0,
  UNDER_REVIEW: 1,
  RESOLVED: 2,
  APPEALED: 3,
  CLOSED: 4,
} as const;
export type CaseStatus = (typeof CaseStatus)[keyof typeof CaseStatus];

export const CaseOutcome = {
  NO_ACTION: 0,
  WARNING: 1,
  TEMPORARY_BAN: 2,
  PERMANENT_BAN: 3,
  SLASH: 4,
} as const;
export type CaseOutcome = (typeof CaseOutcome)[keyof typeof CaseOutcome];

export interface Evidence {
  evidenceId: Hex;
  caseId: Hex;
  submitter: Address;
  stake: bigint;
  submitterReputation: bigint;
  ipfsHash: string;
  summary: string;
  position: EvidencePosition;
  supportStake: bigint;
  opposeStake: bigint;
  supporterCount: bigint;
  opposerCount: bigint;
  submittedAt: bigint;
  status: EvidenceStatus;
}

export interface EvidenceSupport {
  supporter: Address;
  stake: bigint;
  reputation: bigint;
  isSupporting: boolean;
  comment: string;
  timestamp: bigint;
  claimed: boolean;
}

export interface ModerationCase {
  caseId: Hex;
  reporter: Address;
  reportedEntity: Address;
  reportType: string;
  description: string;
  evidence: string;
  status: CaseStatus;
  outcome: CaseOutcome;
  createdAt: bigint;
  resolvedAt: bigint;
  totalStake: bigint;
}

export interface ReputationLabel {
  label: string;
  issuer: Address;
  target: Address;
  score: bigint;
  reason: string;
  issuedAt: bigint;
  expiresAt: bigint;
  revoked: boolean;
}

export interface SubmitEvidenceParams {
  caseId: Hex;
  ipfsHash: string;
  summary: string;
  position: EvidencePosition;
  stake?: bigint; // defaults to MIN_EVIDENCE_STAKE (0.001 ETH)
}

export interface SupportEvidenceParams {
  evidenceId: Hex;
  isSupporting: boolean;
  comment?: string;
  stake?: bigint; // defaults to MIN_SUPPORT_STAKE (0.0005 ETH)
}

export interface CreateCaseParams {
  reportedEntity: Address;
  reportType: "spam" | "scam" | "abuse" | "illegal" | "tos_violation" | "other";
  description: string;
  evidence?: string; // IPFS hash
  stake?: bigint;
}

export interface IssueLabelParams {
  target: Address;
  label: string;
  score: number; // 0-10000 (basis points)
  reason: string;
  expiresIn?: number; // seconds, 0 = permanent
}

export interface ModerationModule {
  // ═══════════════════════════════════════════════════════════════════════════
  //                        EVIDENCE REGISTRY
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Submit evidence for a moderation case
   * Requires minimum stake of 0.001 ETH
   */
  submitEvidence(
    params: SubmitEvidenceParams,
  ): Promise<{ evidenceId: Hex; txHash: Hex }>;

  /**
   * Support or oppose submitted evidence
   * Requires minimum stake of 0.0005 ETH
   */
  supportEvidence(params: SupportEvidenceParams): Promise<Hex>;

  /** Get evidence by ID */
  getEvidence(evidenceId: Hex): Promise<Evidence | null>;

  /** List all evidence for a case */
  listCaseEvidence(caseId: Hex): Promise<Evidence[]>;

  /** Get my submitted evidence */
  listMyEvidence(): Promise<Evidence[]>;

  /** Claim rewards/refunds for evidence after case resolution */
  claimEvidenceReward(evidenceId: Hex): Promise<Hex>;

  /** Get unclaimed rewards for an address */
  getUnclaimedRewards(address?: Address): Promise<bigint>;

  // ═══════════════════════════════════════════════════════════════════════════
  //                       MODERATION MARKETPLACE
  // ═══════════════════════════════════════════════════════════════════════════

  /** Create a new moderation case */
  createCase(params: CreateCaseParams): Promise<{ caseId: Hex; txHash: Hex }>;

  /** Get case by ID */
  getCase(caseId: Hex): Promise<ModerationCase | null>;

  /** List cases by status */
  listCases(status?: CaseStatus): Promise<ModerationCase[]>;

  /** List cases I reported */
  listMyCases(): Promise<ModerationCase[]>;

  /** List cases against an entity */
  listCasesAgainst(entity: Address): Promise<ModerationCase[]>;

  /** Appeal a case decision (requires stake) */
  appealCase(caseId: Hex, reason: string, stake?: bigint): Promise<Hex>;

  // ═══════════════════════════════════════════════════════════════════════════
  //                          BAN MANAGER
  // ═══════════════════════════════════════════════════════════════════════════

  /** Check if an agent is network-banned */
  isNetworkBanned(agentId: bigint): Promise<boolean>;

  /** Check if an address is banned */
  isAddressBanned(address: Address): Promise<boolean>;

  /** Get ban record for an agent */
  getBanRecord(agentId: bigint): Promise<BanRecord | null>;

  /** Get ban record for an address */
  getAddressBan(address: Address): Promise<BanRecord | null>;

  /** Check if an agent is banned from a specific app */
  isAppBanned(agentId: bigint, appId: Hex): Promise<boolean>;

  /** List all apps an agent is banned from */
  getAppBans(agentId: bigint): Promise<Hex[]>;

  // ═══════════════════════════════════════════════════════════════════════════
  //                        REPORTING SYSTEM
  // ═══════════════════════════════════════════════════════════════════════════

  /** Submit a new report against a user */
  createReport(
    params: CreateReportParams,
  ): Promise<{ reportId: Hex; txHash: Hex }>;

  /** Get report by ID */
  getReport(reportId: Hex): Promise<Report | null>;

  /** List reports by status */
  listReports(status?: ReportStatus): Promise<Report[]>;

  /** List my submitted reports */
  listMyReports(): Promise<Report[]>;

  /** List reports against an agent/address */
  listReportsAgainst(target: Address | bigint): Promise<Report[]>;

  /** Vote on a report (via futarchy market) */
  voteOnReport(reportId: Hex, voteYes: boolean, amount: bigint): Promise<Hex>;

  /** Cancel a report (only reporter, before voting ends) */
  cancelReport(reportId: Hex): Promise<Hex>;

  /** Resolve a report (triggers ban if approved) */
  resolveReport(reportId: Hex): Promise<Hex>;

  // ═══════════════════════════════════════════════════════════════════════════
  //                       REPUTATION LABELS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Issue a reputation label (requires validator role) */
  issueLabel(params: IssueLabelParams): Promise<Hex>;

  /** Revoke a label you issued */
  revokeLabel(labelId: Hex): Promise<Hex>;

  /** Get labels for an address */
  getLabels(target: Address): Promise<ReputationLabel[]>;

  /** Get my issued labels */
  getMyIssuedLabels(): Promise<ReputationLabel[]>;

  /** Check if address is labeled as trusted */
  isTrusted(target: Address): Promise<boolean>;

  /** Check if address is labeled as suspicious */
  isSuspicious(target: Address): Promise<boolean>;

  /** Get aggregate reputation score from labels */
  getAggregateScore(target: Address): Promise<number>;

  // ═══════════════════════════════════════════════════════════════════════════
  //                          CONSTANTS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Minimum stake required to submit evidence */
  readonly MIN_EVIDENCE_STAKE: bigint;

  /** Minimum stake required to support evidence */
  readonly MIN_SUPPORT_STAKE: bigint;

  /** Minimum stake required to create a case */
  readonly MIN_CASE_STAKE: bigint;

  /** Minimum stake to create a report */
  readonly MIN_REPORT_STAKE: bigint;
}

// ═══════════════════════════════════════════════════════════════════════════
//                              ABIs
// ═══════════════════════════════════════════════════════════════════════════

const EVIDENCE_REGISTRY_ABI = [
  {
    name: "submitEvidence",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "caseId", type: "bytes32" },
      { name: "ipfsHash", type: "string" },
      { name: "summary", type: "string" },
      { name: "position", type: "uint8" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    name: "supportEvidence",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "evidenceId", type: "bytes32" },
      { name: "isSupporting", type: "bool" },
      { name: "comment", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "evidence",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "evidenceId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "evidenceId", type: "bytes32" },
          { name: "caseId", type: "bytes32" },
          { name: "submitter", type: "address" },
          { name: "stake", type: "uint256" },
          { name: "submitterReputation", type: "uint256" },
          { name: "ipfsHash", type: "string" },
          { name: "summary", type: "string" },
          { name: "position", type: "uint8" },
          { name: "supportStake", type: "uint256" },
          { name: "opposeStake", type: "uint256" },
          { name: "supporterCount", type: "uint256" },
          { name: "opposerCount", type: "uint256" },
          { name: "submittedAt", type: "uint256" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
  {
    name: "getCaseEvidenceIds",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "caseId", type: "bytes32" }],
    outputs: [{ type: "bytes32[]" }],
  },
  {
    name: "getSubmitterEvidence",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "submitter", type: "address" }],
    outputs: [{ type: "bytes32[]" }],
  },
  {
    name: "claimReward",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "evidenceId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "getUnclaimedRewards",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "MIN_EVIDENCE_STAKE",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "MIN_SUPPORT_STAKE",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

const MODERATION_MARKETPLACE_ABI = [
  {
    name: "createCase",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "reportedEntity", type: "address" },
      { name: "reportType", type: "string" },
      { name: "description", type: "string" },
      { name: "evidence", type: "string" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    name: "getCase",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "caseId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "caseId", type: "bytes32" },
          { name: "reporter", type: "address" },
          { name: "reportedEntity", type: "address" },
          { name: "reportType", type: "string" },
          { name: "description", type: "string" },
          { name: "evidence", type: "string" },
          { name: "status", type: "uint8" },
          { name: "outcome", type: "uint8" },
          { name: "createdAt", type: "uint256" },
          { name: "resolvedAt", type: "uint256" },
          { name: "totalStake", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "getCasesByStatus",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "status", type: "uint8" }],
    outputs: [{ type: "bytes32[]" }],
  },
  {
    name: "getCasesByReporter",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "reporter", type: "address" }],
    outputs: [{ type: "bytes32[]" }],
  },
  {
    name: "getCasesAgainst",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "entity", type: "address" }],
    outputs: [{ type: "bytes32[]" }],
  },
  {
    name: "appealCase",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "caseId", type: "bytes32" },
      { name: "reason", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "MIN_CASE_STAKE",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

const REPUTATION_LABEL_MANAGER_ABI = [
  {
    name: "issueLabel",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "target", type: "address" },
      { name: "label", type: "string" },
      { name: "score", type: "uint256" },
      { name: "reason", type: "string" },
      { name: "expiresAt", type: "uint256" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    name: "revokeLabel",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "labelId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "getLabels",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "target", type: "address" }],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "label", type: "string" },
          { name: "issuer", type: "address" },
          { name: "target", type: "address" },
          { name: "score", type: "uint256" },
          { name: "reason", type: "string" },
          { name: "issuedAt", type: "uint256" },
          { name: "expiresAt", type: "uint256" },
          { name: "revoked", type: "bool" },
        ],
      },
    ],
  },
  {
    name: "getLabelsByIssuer",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "issuer", type: "address" }],
    outputs: [{ type: "bytes32[]" }],
  },
  {
    name: "isTrusted",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "target", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    name: "isSuspicious",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "target", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    name: "getAggregateScore",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "target", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const BAN_MANAGER_ABI = [
  {
    name: "networkBans",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [
      { name: "isBanned", type: "bool" },
      { name: "bannedAt", type: "uint256" },
      { name: "reason", type: "string" },
      { name: "proposalId", type: "bytes32" },
    ],
  },
  {
    name: "extendedBans",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [
      { name: "isBanned", type: "bool" },
      { name: "banType", type: "uint8" },
      { name: "bannedAt", type: "uint256" },
      { name: "expiresAt", type: "uint256" },
      { name: "reason", type: "string" },
      { name: "proposalId", type: "bytes32" },
      { name: "reporter", type: "address" },
      { name: "caseId", type: "bytes32" },
    ],
  },
  {
    name: "addressBans",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "target", type: "address" }],
    outputs: [
      { name: "isBanned", type: "bool" },
      { name: "banType", type: "uint8" },
      { name: "bannedAt", type: "uint256" },
      { name: "expiresAt", type: "uint256" },
      { name: "reason", type: "string" },
      { name: "proposalId", type: "bytes32" },
      { name: "reporter", type: "address" },
      { name: "caseId", type: "bytes32" },
    ],
  },
  {
    name: "appBans",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "appId", type: "bytes32" },
    ],
    outputs: [
      { name: "isBanned", type: "bool" },
      { name: "bannedAt", type: "uint256" },
      { name: "reason", type: "string" },
      { name: "proposalId", type: "bytes32" },
    ],
  },
  {
    name: "getAgentAppBans",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ type: "bytes32[]" }],
  },
] as const;

const REPORTING_SYSTEM_ABI = [
  {
    name: "createReport",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "reportedAgentId", type: "uint256" },
      { name: "reportType", type: "uint8" },
      { name: "severity", type: "uint8" },
      { name: "evidenceHash", type: "string" },
      { name: "reason", type: "string" },
      { name: "appId", type: "bytes32" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    name: "createAddressReport",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "reportedAddress", type: "address" },
      { name: "reportType", type: "uint8" },
      { name: "severity", type: "uint8" },
      { name: "evidenceHash", type: "string" },
      { name: "reason", type: "string" },
      { name: "appId", type: "bytes32" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    name: "reports",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "reportId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "reportId", type: "bytes32" },
          { name: "reporter", type: "address" },
          { name: "reportedAgentId", type: "uint256" },
          { name: "reportedAddress", type: "address" },
          { name: "reportType", type: "uint8" },
          { name: "severity", type: "uint8" },
          { name: "status", type: "uint8" },
          { name: "evidenceHash", type: "string" },
          { name: "reason", type: "string" },
          { name: "appId", type: "bytes32" },
          { name: "stake", type: "uint256" },
          { name: "createdAt", type: "uint256" },
          { name: "resolvedAt", type: "uint256" },
          { name: "marketId", type: "bytes32" },
        ],
      },
    ],
  },
  {
    name: "getReportsByStatus",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "status", type: "uint8" }],
    outputs: [{ type: "bytes32[]" }],
  },
  {
    name: "getReportsByReporter",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "reporter", type: "address" }],
    outputs: [{ type: "bytes32[]" }],
  },
  {
    name: "getReportsAgainstAgent",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ type: "bytes32[]" }],
  },
  {
    name: "getReportsAgainstAddress",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "target", type: "address" }],
    outputs: [{ type: "bytes32[]" }],
  },
  {
    name: "cancelReport",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "reportId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "resolveReport",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "reportId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "MIN_REPORT_STAKE",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

// ═══════════════════════════════════════════════════════════════════════════
//                          IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export function createModerationModule(
  wallet: JejuWallet,
  network: NetworkType,
): ModerationModule {
  const evidenceRegistryAddress = requireContract(
    "moderation",
    "EvidenceRegistry",
    network,
  );
  const moderationMarketplaceAddress = requireContract(
    "moderation",
    "ModerationMarketplace",
    network,
  );
  const reputationLabelManagerAddress = requireContract(
    "moderation",
    "ReputationLabelManager",
    network,
  );
  const banManagerAddress = requireContract(
    "moderation",
    "BanManager",
    network,
  );
  const reportingSystemAddress = requireContract(
    "moderation",
    "ReportingSystem",
    network,
  );

  const MIN_EVIDENCE_STAKE = parseEther("0.001");
  const MIN_SUPPORT_STAKE = parseEther("0.0005");
  const MIN_CASE_STAKE = parseEther("0.01");
  const MIN_REPORT_STAKE = parseEther("0.05");

  // Helper to read evidence
  async function readEvidence(evidenceId: Hex): Promise<Evidence | null> {
    const result = await wallet.publicClient.readContract({
      address: evidenceRegistryAddress,
      abi: EVIDENCE_REGISTRY_ABI,
      functionName: "evidence",
      args: [evidenceId],
    });

    if (!result || result.evidenceId === `0x${"0".repeat(64)}`) {
      return null;
    }

    return {
      evidenceId: result.evidenceId,
      caseId: result.caseId,
      submitter: result.submitter,
      stake: result.stake,
      submitterReputation: result.submitterReputation,
      ipfsHash: result.ipfsHash,
      summary: result.summary,
      position: result.position as EvidencePosition,
      supportStake: result.supportStake,
      opposeStake: result.opposeStake,
      supporterCount: result.supporterCount,
      opposerCount: result.opposerCount,
      submittedAt: result.submittedAt,
      status: result.status as EvidenceStatus,
    };
  }

  // Helper to read case
  async function readCase(caseId: Hex): Promise<ModerationCase | null> {
    const result = await wallet.publicClient.readContract({
      address: moderationMarketplaceAddress,
      abi: MODERATION_MARKETPLACE_ABI,
      functionName: "getCase",
      args: [caseId],
    });

    if (!result || result.caseId === `0x${"0".repeat(64)}`) {
      return null;
    }

    return {
      caseId: result.caseId,
      reporter: result.reporter,
      reportedEntity: result.reportedEntity,
      reportType: result.reportType,
      description: result.description,
      evidence: result.evidence,
      status: result.status as CaseStatus,
      outcome: result.outcome as CaseOutcome,
      createdAt: result.createdAt,
      resolvedAt: result.resolvedAt,
      totalStake: result.totalStake,
    };
  }

  // Helper to read report
  async function readReport(reportId: Hex): Promise<Report | null> {
    const result = await wallet.publicClient.readContract({
      address: reportingSystemAddress,
      abi: REPORTING_SYSTEM_ABI,
      functionName: "reports",
      args: [reportId],
    });

    if (!result || result.reportId === `0x${"0".repeat(64)}`) {
      return null;
    }

    return {
      reportId: result.reportId,
      reporter: result.reporter,
      reportedAgentId: result.reportedAgentId,
      reportedAddress: result.reportedAddress,
      reportType: result.reportType as ReportType,
      severity: result.severity as SeverityLevel,
      status: result.status as ReportStatus,
      evidenceHash: result.evidenceHash,
      reason: result.reason,
      appId: result.appId,
      stake: result.stake,
      createdAt: result.createdAt,
      resolvedAt: result.resolvedAt,
      marketId: result.marketId,
    };
  }

  return {
    MIN_EVIDENCE_STAKE,
    MIN_SUPPORT_STAKE,
    MIN_CASE_STAKE,
    MIN_REPORT_STAKE,

    // ═══════════════════════════════════════════════════════════════════════
    //                        EVIDENCE REGISTRY
    // ═══════════════════════════════════════════════════════════════════════

    async submitEvidence(params) {
      const stake = params.stake ?? MIN_EVIDENCE_STAKE;

      const data = encodeFunctionData({
        abi: EVIDENCE_REGISTRY_ABI,
        functionName: "submitEvidence",
        args: [params.caseId, params.ipfsHash, params.summary, params.position],
      });

      const txHash = await wallet.sendTransaction({
        to: evidenceRegistryAddress,
        data,
        value: stake,
      });

      // For now, return a placeholder evidenceId - in production would parse logs
      const evidenceId =
        `0x${Buffer.from(params.summary).toString("hex").padEnd(64, "0")}` as Hex;

      return { evidenceId, txHash };
    },

    async supportEvidence(params) {
      const stake = params.stake ?? MIN_SUPPORT_STAKE;

      const data = encodeFunctionData({
        abi: EVIDENCE_REGISTRY_ABI,
        functionName: "supportEvidence",
        args: [params.evidenceId, params.isSupporting, params.comment ?? ""],
      });

      return wallet.sendTransaction({
        to: evidenceRegistryAddress,
        data,
        value: stake,
      });
    },

    getEvidence: readEvidence,

    async listCaseEvidence(caseId) {
      const ids = await wallet.publicClient.readContract({
        address: evidenceRegistryAddress,
        abi: EVIDENCE_REGISTRY_ABI,
        functionName: "getCaseEvidenceIds",
        args: [caseId],
      });

      const evidenceList: Evidence[] = [];
      for (const id of ids) {
        const evidence = await readEvidence(id);
        if (evidence) evidenceList.push(evidence);
      }
      return evidenceList;
    },

    async listMyEvidence() {
      const ids = await wallet.publicClient.readContract({
        address: evidenceRegistryAddress,
        abi: EVIDENCE_REGISTRY_ABI,
        functionName: "getSubmitterEvidence",
        args: [wallet.address],
      });

      const evidenceList: Evidence[] = [];
      for (const id of ids) {
        const evidence = await readEvidence(id);
        if (evidence) evidenceList.push(evidence);
      }
      return evidenceList;
    },

    async claimEvidenceReward(evidenceId) {
      const data = encodeFunctionData({
        abi: EVIDENCE_REGISTRY_ABI,
        functionName: "claimReward",
        args: [evidenceId],
      });

      return wallet.sendTransaction({
        to: evidenceRegistryAddress,
        data,
      });
    },

    async getUnclaimedRewards(address) {
      return wallet.publicClient.readContract({
        address: evidenceRegistryAddress,
        abi: EVIDENCE_REGISTRY_ABI,
        functionName: "getUnclaimedRewards",
        args: [address ?? wallet.address],
      });
    },

    // ═══════════════════════════════════════════════════════════════════════
    //                       MODERATION MARKETPLACE
    // ═══════════════════════════════════════════════════════════════════════

    async createCase(params) {
      const stake = params.stake ?? MIN_CASE_STAKE;

      const data = encodeFunctionData({
        abi: MODERATION_MARKETPLACE_ABI,
        functionName: "createCase",
        args: [
          params.reportedEntity,
          params.reportType,
          params.description,
          params.evidence ?? "",
        ],
      });

      const txHash = await wallet.sendTransaction({
        to: moderationMarketplaceAddress,
        data,
        value: stake,
      });

      // Placeholder caseId
      const caseId =
        `0x${Buffer.from(params.description).toString("hex").padEnd(64, "0")}` as Hex;

      return { caseId, txHash };
    },

    getCase: readCase,

    async listCases(status) {
      if (status === undefined) {
        // List all pending cases by default
        status = CaseStatus.PENDING;
      }

      const ids = await wallet.publicClient.readContract({
        address: moderationMarketplaceAddress,
        abi: MODERATION_MARKETPLACE_ABI,
        functionName: "getCasesByStatus",
        args: [status],
      });

      const cases: ModerationCase[] = [];
      for (const id of ids) {
        const caseData = await readCase(id);
        if (caseData) cases.push(caseData);
      }
      return cases;
    },

    async listMyCases() {
      const ids = await wallet.publicClient.readContract({
        address: moderationMarketplaceAddress,
        abi: MODERATION_MARKETPLACE_ABI,
        functionName: "getCasesByReporter",
        args: [wallet.address],
      });

      const cases: ModerationCase[] = [];
      for (const id of ids) {
        const caseData = await readCase(id);
        if (caseData) cases.push(caseData);
      }
      return cases;
    },

    async listCasesAgainst(entity) {
      const ids = await wallet.publicClient.readContract({
        address: moderationMarketplaceAddress,
        abi: MODERATION_MARKETPLACE_ABI,
        functionName: "getCasesAgainst",
        args: [entity],
      });

      const cases: ModerationCase[] = [];
      for (const id of ids) {
        const caseData = await readCase(id);
        if (caseData) cases.push(caseData);
      }
      return cases;
    },

    async appealCase(caseId, reason, stake) {
      const appealStake = stake ?? MIN_CASE_STAKE;

      const data = encodeFunctionData({
        abi: MODERATION_MARKETPLACE_ABI,
        functionName: "appealCase",
        args: [caseId, reason],
      });

      return wallet.sendTransaction({
        to: moderationMarketplaceAddress,
        data,
        value: appealStake,
      });
    },

    // ═══════════════════════════════════════════════════════════════════════
    //                       REPUTATION LABELS
    // ═══════════════════════════════════════════════════════════════════════

    async issueLabel(params) {
      const expiresAt =
        params.expiresIn && params.expiresIn > 0
          ? BigInt(Math.floor(Date.now() / 1000) + params.expiresIn)
          : 0n;

      const data = encodeFunctionData({
        abi: REPUTATION_LABEL_MANAGER_ABI,
        functionName: "issueLabel",
        args: [
          params.target,
          params.label,
          BigInt(params.score),
          params.reason,
          expiresAt,
        ],
      });

      return wallet.sendTransaction({
        to: reputationLabelManagerAddress,
        data,
      });
    },

    async revokeLabel(labelId) {
      const data = encodeFunctionData({
        abi: REPUTATION_LABEL_MANAGER_ABI,
        functionName: "revokeLabel",
        args: [labelId],
      });

      return wallet.sendTransaction({
        to: reputationLabelManagerAddress,
        data,
      });
    },

    async getLabels(target) {
      const result = await wallet.publicClient.readContract({
        address: reputationLabelManagerAddress,
        abi: REPUTATION_LABEL_MANAGER_ABI,
        functionName: "getLabels",
        args: [target],
      });

      return result.map((l) => ({
        label: l.label,
        issuer: l.issuer,
        target: l.target,
        score: l.score,
        reason: l.reason,
        issuedAt: l.issuedAt,
        expiresAt: l.expiresAt,
        revoked: l.revoked,
      }));
    },

    async getMyIssuedLabels() {
      await wallet.publicClient.readContract({
        address: reputationLabelManagerAddress,
        abi: REPUTATION_LABEL_MANAGER_ABI,
        functionName: "getLabelsByIssuer",
        args: [wallet.address],
      });

      // Would need to fetch each label - simplified for now
      return [];
    },

    async isTrusted(target) {
      return wallet.publicClient.readContract({
        address: reputationLabelManagerAddress,
        abi: REPUTATION_LABEL_MANAGER_ABI,
        functionName: "isTrusted",
        args: [target],
      });
    },

    async isSuspicious(target) {
      return wallet.publicClient.readContract({
        address: reputationLabelManagerAddress,
        abi: REPUTATION_LABEL_MANAGER_ABI,
        functionName: "isSuspicious",
        args: [target],
      });
    },

    async getAggregateScore(target) {
      const score = await wallet.publicClient.readContract({
        address: reputationLabelManagerAddress,
        abi: REPUTATION_LABEL_MANAGER_ABI,
        functionName: "getAggregateScore",
        args: [target],
      });

      return Number(score);
    },

    // ═══════════════════════════════════════════════════════════════════════
    //                          BAN MANAGER
    // ═══════════════════════════════════════════════════════════════════════

    async isNetworkBanned(agentId) {
      const result = await wallet.publicClient.readContract({
        address: banManagerAddress,
        abi: BAN_MANAGER_ABI,
        functionName: "networkBans",
        args: [agentId],
      });
      // Result is tuple [isBanned, bannedAt, reason, proposalId]
      return result[0];
    },

    async isAddressBanned(address) {
      const result = await wallet.publicClient.readContract({
        address: banManagerAddress,
        abi: BAN_MANAGER_ABI,
        functionName: "addressBans",
        args: [address],
      });
      // Result is tuple [isBanned, banType, bannedAt, expiresAt, reason, proposalId, reporter, caseId]
      return result[0];
    },

    async getBanRecord(agentId) {
      const result = await wallet.publicClient.readContract({
        address: banManagerAddress,
        abi: BAN_MANAGER_ABI,
        functionName: "extendedBans",
        args: [agentId],
      });

      // Result is tuple [isBanned, banType, bannedAt, expiresAt, reason, proposalId, reporter, caseId]
      const [
        isBanned,
        banType,
        bannedAt,
        expiresAt,
        reason,
        proposalId,
        reporter,
        caseId,
      ] = result;

      if (!isBanned && bannedAt === 0n) return null;

      return {
        isBanned,
        banType: banType as BanType,
        bannedAt,
        expiresAt,
        reason,
        proposalId,
        reporter,
        caseId,
      };
    },

    async getAddressBan(address) {
      const result = await wallet.publicClient.readContract({
        address: banManagerAddress,
        abi: BAN_MANAGER_ABI,
        functionName: "addressBans",
        args: [address],
      });

      // Result is tuple [isBanned, banType, bannedAt, expiresAt, reason, proposalId, reporter, caseId]
      const [
        isBanned,
        banType,
        bannedAt,
        expiresAt,
        reason,
        proposalId,
        reporter,
        caseId,
      ] = result;

      if (!isBanned && bannedAt === 0n) return null;

      return {
        isBanned,
        banType: banType as BanType,
        bannedAt,
        expiresAt,
        reason,
        proposalId,
        reporter,
        caseId,
      };
    },

    async isAppBanned(agentId, appId) {
      const result = await wallet.publicClient.readContract({
        address: banManagerAddress,
        abi: BAN_MANAGER_ABI,
        functionName: "appBans",
        args: [agentId, appId],
      });
      // Result is tuple [isBanned, bannedAt, reason, proposalId]
      return result[0];
    },

    async getAppBans(agentId) {
      const result = await wallet.publicClient.readContract({
        address: banManagerAddress,
        abi: BAN_MANAGER_ABI,
        functionName: "getAgentAppBans",
        args: [agentId],
      });
      return [...result]; // Convert readonly array to mutable
    },

    // ═══════════════════════════════════════════════════════════════════════
    //                        REPORTING SYSTEM
    // ═══════════════════════════════════════════════════════════════════════

    async createReport(params) {
      const stake = params.stake ?? MIN_REPORT_STAKE;
      const appId = params.appId ?? (`0x${"0".repeat(64)}` as Hex);

      let data: Hex;

      if (params.reportedAgentId !== undefined) {
        data = encodeFunctionData({
          abi: REPORTING_SYSTEM_ABI,
          functionName: "createReport",
          args: [
            params.reportedAgentId,
            params.reportType,
            params.severity,
            params.evidenceHash,
            params.reason,
            appId,
          ],
        });
      } else if (params.reportedAddress !== undefined) {
        data = encodeFunctionData({
          abi: REPORTING_SYSTEM_ABI,
          functionName: "createAddressReport",
          args: [
            params.reportedAddress,
            params.reportType,
            params.severity,
            params.evidenceHash,
            params.reason,
            appId,
          ],
        });
      } else {
        throw new Error(
          "Must provide either reportedAgentId or reportedAddress",
        );
      }

      const txHash = await wallet.sendTransaction({
        to: reportingSystemAddress,
        data,
        value: stake,
      });

      const reportId =
        `0x${Buffer.from(params.reason).toString("hex").padEnd(64, "0")}` as Hex;
      return { reportId, txHash };
    },

    getReport: readReport,

    async listReports(status) {
      if (status === undefined) {
        status = ReportStatus.PENDING;
      }

      const ids = await wallet.publicClient.readContract({
        address: reportingSystemAddress,
        abi: REPORTING_SYSTEM_ABI,
        functionName: "getReportsByStatus",
        args: [status],
      });

      const reports: Report[] = [];
      for (const id of ids) {
        const report = await readReport(id);
        if (report) reports.push(report);
      }
      return reports;
    },

    async listMyReports() {
      const ids = await wallet.publicClient.readContract({
        address: reportingSystemAddress,
        abi: REPORTING_SYSTEM_ABI,
        functionName: "getReportsByReporter",
        args: [wallet.address],
      });

      const reports: Report[] = [];
      for (const id of ids) {
        const report = await readReport(id);
        if (report) reports.push(report);
      }
      return reports;
    },

    async listReportsAgainst(target) {
      let ids: readonly Hex[];

      if (typeof target === "bigint") {
        ids = await wallet.publicClient.readContract({
          address: reportingSystemAddress,
          abi: REPORTING_SYSTEM_ABI,
          functionName: "getReportsAgainstAgent",
          args: [target],
        });
      } else {
        ids = await wallet.publicClient.readContract({
          address: reportingSystemAddress,
          abi: REPORTING_SYSTEM_ABI,
          functionName: "getReportsAgainstAddress",
          args: [target],
        });
      }

      const reports: Report[] = [];
      for (const id of ids) {
        const report = await readReport(id);
        if (report) reports.push(report);
      }
      return reports;
    },

    async voteOnReport(_reportId, _voteYes, _amount) {
      // Voting is handled via the futarchy market
      // This would integrate with the Predimarket contract
      throw new Error("Vote on reports via the futarchy market interface");
    },

    async cancelReport(reportId) {
      const data = encodeFunctionData({
        abi: REPORTING_SYSTEM_ABI,
        functionName: "cancelReport",
        args: [reportId],
      });

      return wallet.sendTransaction({
        to: reportingSystemAddress,
        data,
      });
    },

    async resolveReport(reportId) {
      const data = encodeFunctionData({
        abi: REPORTING_SYSTEM_ABI,
        functionName: "resolveReport",
        args: [reportId],
      });

      return wallet.sendTransaction({
        to: reportingSystemAddress,
        data,
      });
    },
  };
}
