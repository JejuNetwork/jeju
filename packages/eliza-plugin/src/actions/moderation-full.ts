/**
 * Full Moderation Actions for Eliza Plugin
 *
 * Evidence submission, case management, and reputation labels
 */

import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  logger,
} from "@elizaos/core";
import { getJejuService } from "../service";
import type { Hex, Address } from "viem";
import { parseEther } from "viem";

// ═══════════════════════════════════════════════════════════════════════════
//                          EVIDENCE ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

export const submitEvidenceAction: Action = {
  name: "SUBMIT_EVIDENCE",
  description:
    "Submit evidence for a moderation case with stake. Evidence must be uploaded to IPFS first.",
  similes: ["add evidence", "provide proof", "submit proof"],
  examples: [
    [
      {
        name: "user",
        content: {
          text: "Submit evidence for case 0x123... with IPFS hash QmXyz..., supporting action",
        },
      },
      {
        name: "assistant",
        content: {
          text: "Submitting evidence with 0.001 ETH stake supporting action...",
        },
      },
    ],
  ],
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ) => {
    const service = getJejuService();

    const caseId = (message.content as { caseId?: string }).caseId;
    const ipfsHash = (message.content as { ipfsHash?: string }).ipfsHash;
    const summary = (message.content as { summary?: string }).summary;
    const position = (message.content as { position?: string }).position;
    const stakeAmount = (message.content as { stake?: string }).stake;

    if (!caseId || !ipfsHash || !summary) {
      callback({
        text: "Missing required fields: caseId, ipfsHash, summary",
      });
      return;
    }

    const positionValue = position === "against" ? 1 : 0;
    const stake = stakeAmount ? parseEther(stakeAmount) : undefined;

    const result = await service.sdk.moderation.submitEvidence({
      caseId: caseId as Hex,
      ipfsHash,
      summary,
      position: positionValue,
      stake,
    });

    callback({
      text: `Evidence submitted. ID: ${result.evidenceId}\nTx: ${result.txHash}`,
    });
  },
};

export const supportEvidenceAction: Action = {
  name: "SUPPORT_EVIDENCE",
  description: "Support or oppose submitted evidence with stake",
  similes: ["back evidence", "support proof", "oppose evidence"],
  examples: [
    [
      {
        name: "user",
        content: { text: "Support evidence 0xabc... with 0.001 ETH" },
      },
      {
        name: "assistant",
        content: { text: "Supporting evidence with stake..." },
      },
    ],
  ],
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ) => {
    const service = getJejuService();

    const evidenceId = (message.content as { evidenceId?: string }).evidenceId;
    const isSupporting =
      (message.content as { support?: boolean }).support !== false;
    const comment = (message.content as { comment?: string }).comment;
    const stakeAmount = (message.content as { stake?: string }).stake;

    if (!evidenceId) {
      callback({ text: "Evidence ID required" });
      return;
    }

    const stake = stakeAmount ? parseEther(stakeAmount) : undefined;

    const txHash = await service.sdk.moderation.supportEvidence({
      evidenceId: evidenceId as Hex,
      isSupporting,
      comment,
      stake,
    });

    callback({
      text: `Evidence ${isSupporting ? "supported" : "opposed"}. Tx: ${txHash}`,
    });
  },
};

export const getEvidenceAction: Action = {
  name: "GET_EVIDENCE",
  description: "Get details about submitted evidence",
  similes: ["view evidence", "check evidence", "evidence details"],
  examples: [
    [
      {
        name: "user",
        content: { text: "Get evidence 0xabc..." },
      },
      {
        name: "assistant",
        content: { text: "Fetching evidence details..." },
      },
    ],
  ],
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ) => {
    const service = getJejuService();

    const evidenceId = (message.content as { evidenceId?: string }).evidenceId;

    if (!evidenceId) {
      callback({ text: "Evidence ID required" });
      return;
    }

    const evidence = await service.sdk.moderation.getEvidence(
      evidenceId as Hex,
    );

    if (!evidence) {
      callback({ text: "Evidence not found" });
      return;
    }

    callback({
      text: `Evidence ${evidenceId}:
- Case: ${evidence.caseId}
- Submitter: ${evidence.submitter}
- Position: ${evidence.position === 0 ? "FOR_ACTION" : "AGAINST_ACTION"}
- Stake: ${evidence.stake} wei
- Support: ${evidence.supportStake} wei (${evidence.supporterCount} supporters)
- Oppose: ${evidence.opposeStake} wei (${evidence.opposerCount} opposers)
- Status: ${["ACTIVE", "REWARDED", "SLASHED"][evidence.status]}
- Summary: ${evidence.summary}`,
    });
  },
};

export const listCaseEvidenceAction: Action = {
  name: "LIST_CASE_EVIDENCE",
  description: "List all evidence submitted for a moderation case",
  similes: ["case evidence", "evidence for case", "show case proofs"],
  examples: [
    [
      {
        name: "user",
        content: { text: "List evidence for case 0x123..." },
      },
      {
        name: "assistant",
        content: { text: "Listing evidence for the case..." },
      },
    ],
  ],
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ) => {
    const service = getJejuService();

    const caseId = (message.content as { caseId?: string }).caseId;

    if (!caseId) {
      callback({ text: "Case ID required" });
      return;
    }

    const evidence = await service.sdk.moderation.listCaseEvidence(
      caseId as Hex,
    );

    if (evidence.length === 0) {
      callback({ text: "No evidence submitted for this case" });
      return;
    }

    const list = evidence
      .map(
        (e, i) =>
          `${i + 1}. ${e.position === 0 ? "FOR" : "AGAINST"} - ${e.stake} wei - ${e.summary.slice(0, 50)}...`,
      )
      .join("\n");

    callback({
      text: `Evidence for case ${caseId}:\n${list}`,
    });
  },
};

export const claimEvidenceRewardAction: Action = {
  name: "CLAIM_EVIDENCE_REWARD",
  description: "Claim rewards after a case is resolved in your favor",
  similes: ["claim reward", "get evidence reward", "collect reward"],
  examples: [
    [
      {
        name: "user",
        content: { text: "Claim reward for evidence 0xabc..." },
      },
      {
        name: "assistant",
        content: { text: "Claiming evidence reward..." },
      },
    ],
  ],
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ) => {
    const service = getJejuService();

    const evidenceId = (message.content as { evidenceId?: string }).evidenceId;

    if (!evidenceId) {
      callback({ text: "Evidence ID required" });
      return;
    }

    const txHash = await service.sdk.moderation.claimEvidenceReward(
      evidenceId as Hex,
    );

    callback({ text: `Reward claimed. Tx: ${txHash}` });
  },
};

// ═══════════════════════════════════════════════════════════════════════════
//                          CASE ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

export const createCaseAction: Action = {
  name: "CREATE_MODERATION_CASE",
  description: "Create a new moderation case against an entity with stake",
  similes: ["report entity", "open case", "file complaint"],
  examples: [
    [
      {
        name: "user",
        content: {
          text: "Create case against 0x123... for spam with description",
        },
      },
      {
        name: "assistant",
        content: { text: "Creating moderation case..." },
      },
    ],
  ],
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ) => {
    const service = getJejuService();

    const entity = (message.content as { entity?: string }).entity;
    const reportType = (message.content as { reportType?: string }).reportType;
    const description = (message.content as { description?: string })
      .description;
    const evidence = (message.content as { evidence?: string }).evidence;
    const stakeAmount = (message.content as { stake?: string }).stake;

    if (!entity || !reportType || !description) {
      callback({
        text: "Missing required fields: entity, reportType, description",
      });
      return;
    }

    const stake = stakeAmount ? parseEther(stakeAmount) : undefined;

    const result = await service.sdk.moderation.createCase({
      reportedEntity: entity as Address,
      reportType: reportType as
        | "spam"
        | "scam"
        | "abuse"
        | "illegal"
        | "tos_violation"
        | "other",
      description,
      evidence,
      stake,
    });

    callback({
      text: `Case created. ID: ${result.caseId}\nTx: ${result.txHash}`,
    });
  },
};

export const getCaseAction: Action = {
  name: "GET_MODERATION_CASE",
  description: "Get details about a moderation case",
  similes: ["view case", "case details", "check case"],
  examples: [
    [
      {
        name: "user",
        content: { text: "Get case 0x123..." },
      },
      {
        name: "assistant",
        content: { text: "Fetching case details..." },
      },
    ],
  ],
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ) => {
    const service = getJejuService();

    const caseId = (message.content as { caseId?: string }).caseId;

    if (!caseId) {
      callback({ text: "Case ID required" });
      return;
    }

    const caseData = await service.sdk.moderation.getCase(caseId as Hex);

    if (!caseData) {
      callback({ text: "Case not found" });
      return;
    }

    const statusNames = [
      "PENDING",
      "UNDER_REVIEW",
      "RESOLVED",
      "APPEALED",
      "CLOSED",
    ];
    const outcomeNames = [
      "NO_ACTION",
      "WARNING",
      "TEMPORARY_BAN",
      "PERMANENT_BAN",
      "SLASH",
    ];

    callback({
      text: `Case ${caseId}:
- Reporter: ${caseData.reporter}
- Reported: ${caseData.reportedEntity}
- Type: ${caseData.reportType}
- Status: ${statusNames[caseData.status]}
- Outcome: ${outcomeNames[caseData.outcome]}
- Total Stake: ${caseData.totalStake} wei
- Description: ${caseData.description}`,
    });
  },
};

export const listCasesAction: Action = {
  name: "LIST_MODERATION_CASES",
  description: "List moderation cases by status",
  similes: ["show cases", "pending cases", "all cases"],
  examples: [
    [
      {
        name: "user",
        content: { text: "List pending moderation cases" },
      },
      {
        name: "assistant",
        content: { text: "Listing pending cases..." },
      },
    ],
  ],
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ) => {
    const service = getJejuService();

    const statusStr = (message.content as { status?: string }).status;
    const statusMap: Record<string, number> = {
      pending: 0,
      under_review: 1,
      resolved: 2,
      appealed: 3,
      closed: 4,
    };
    const status = statusStr
      ? statusMap[statusStr.toLowerCase()]
      : undefined;

    const cases = await service.sdk.moderation.listCases(status);

    if (cases.length === 0) {
      callback({ text: "No cases found" });
      return;
    }

    const list = cases
      .map(
        (c, i) =>
          `${i + 1}. ${c.reportType} against ${c.reportedEntity.slice(0, 10)}... - ${c.totalStake} wei`,
      )
      .join("\n");

    callback({
      text: `Moderation cases:\n${list}`,
    });
  },
};

export const appealCaseAction: Action = {
  name: "APPEAL_CASE",
  description: "Appeal a moderation case decision with stake",
  similes: ["appeal decision", "contest ruling", "challenge outcome"],
  examples: [
    [
      {
        name: "user",
        content: { text: "Appeal case 0x123... - unfair decision" },
      },
      {
        name: "assistant",
        content: { text: "Submitting appeal..." },
      },
    ],
  ],
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ) => {
    const service = getJejuService();

    const caseId = (message.content as { caseId?: string }).caseId;
    const reason = (message.content as { reason?: string }).reason;
    const stakeAmount = (message.content as { stake?: string }).stake;

    if (!caseId || !reason) {
      callback({ text: "Case ID and reason required" });
      return;
    }

    const stake = stakeAmount ? parseEther(stakeAmount) : undefined;

    const txHash = await service.sdk.moderation.appealCase(
      caseId as Hex,
      reason,
      stake,
    );

    callback({ text: `Appeal submitted. Tx: ${txHash}` });
  },
};

// ═══════════════════════════════════════════════════════════════════════════
//                          LABEL ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

export const issueLabelAction: Action = {
  name: "ISSUE_REPUTATION_LABEL",
  description: "Issue a reputation label to an address (validator role required)",
  similes: ["add label", "tag address", "mark reputation"],
  examples: [
    [
      {
        name: "user",
        content: { text: "Issue 'trusted_developer' label to 0x123..." },
      },
      {
        name: "assistant",
        content: { text: "Issuing reputation label..." },
      },
    ],
  ],
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ) => {
    const service = getJejuService();

    const target = (message.content as { target?: string }).target;
    const label = (message.content as { label?: string }).label;
    const score = (message.content as { score?: number }).score;
    const reason = (message.content as { reason?: string }).reason;
    const expiresIn = (message.content as { expiresIn?: number }).expiresIn;

    if (!target || !label || score === undefined || !reason) {
      callback({
        text: "Required: target, label, score (0-10000), reason",
      });
      return;
    }

    const txHash = await service.sdk.moderation.issueLabel({
      target: target as Address,
      label,
      score,
      reason,
      expiresIn,
    });

    callback({ text: `Label issued. Tx: ${txHash}` });
  },
};

export const getLabelsAction: Action = {
  name: "GET_REPUTATION_LABELS",
  description: "Get all reputation labels for an address",
  similes: ["check labels", "view reputation", "address labels"],
  examples: [
    [
      {
        name: "user",
        content: { text: "Get reputation labels for 0x123..." },
      },
      {
        name: "assistant",
        content: { text: "Fetching reputation labels..." },
      },
    ],
  ],
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ) => {
    const service = getJejuService();

    const target = (message.content as { target?: string }).target;

    if (!target) {
      callback({ text: "Target address required" });
      return;
    }

    const labels = await service.sdk.moderation.getLabels(target as Address);

    if (labels.length === 0) {
      callback({ text: "No labels found for this address" });
      return;
    }

    const list = labels
      .map(
        (l) =>
          `- ${l.label}: ${l.score} (${l.revoked ? "REVOKED" : "active"}) - ${l.reason}`,
      )
      .join("\n");

    callback({
      text: `Reputation labels for ${target}:\n${list}`,
    });
  },
};

export const checkTrustAction: Action = {
  name: "CHECK_TRUST_STATUS",
  description: "Check if an address is trusted or suspicious",
  similes: ["is trusted", "is suspicious", "trust check"],
  examples: [
    [
      {
        name: "user",
        content: { text: "Is 0x123... trusted?" },
      },
      {
        name: "assistant",
        content: { text: "Checking trust status..." },
      },
    ],
  ],
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ) => {
    const service = getJejuService();

    const target = (message.content as { target?: string }).target;

    if (!target) {
      callback({ text: "Target address required" });
      return;
    }

    const [isTrusted, isSuspicious, score] = await Promise.all([
      service.sdk.moderation.isTrusted(target as Address),
      service.sdk.moderation.isSuspicious(target as Address),
      service.sdk.moderation.getAggregateScore(target as Address),
    ]);

    callback({
      text: `Trust status for ${target}:
- Trusted: ${isTrusted ? "Yes ✓" : "No"}
- Suspicious: ${isSuspicious ? "Yes ⚠" : "No"}
- Aggregate Score: ${score}/10000`,
    });
  },
};

