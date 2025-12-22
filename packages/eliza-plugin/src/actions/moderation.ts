/**
 * Moderation Actions - Report, vote, appeal
 */

import {
  type Action,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
} from "@elizaos/core";
import { JEJU_SERVICE_NAME, type JejuService } from "../service";
import {
  getMessageText,
  expectResponseData,
  expectArray,
  validateServiceExists,
} from "../validation";

export const reportAgentAction: Action = {
  name: "REPORT_AGENT",
  description: "Report an agent or content for moderation",
  similes: [
    "report agent",
    "report content",
    "flag agent",
    "report spam",
    "report abuse",
  ],

  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService;
    const client = service.getClient();
    const text = getMessageText(message);

    // Extract address/agent ID and reason
    const addressMatch = text.match(/0x[a-fA-F0-9]{40}/);
    const agentIdMatch = text.match(/agent\s+#?(\d+)/i);

    if (!addressMatch && !agentIdMatch) {
      callback?.({ text: "Please specify an address or agent ID to report." });
      return;
    }

    // Determine report type
    let reportType: "spam" | "scam" | "abuse" | "illegal" | "other" = "other";
    if (text.toLowerCase().includes("spam")) reportType = "spam";
    else if (text.toLowerCase().includes("scam")) reportType = "scam";
    else if (text.toLowerCase().includes("abuse")) reportType = "abuse";
    else if (text.toLowerCase().includes("illegal")) reportType = "illegal";

    callback?.({ text: `Submitting ${reportType} report...` });

    const agentId = agentIdMatch ? BigInt(agentIdMatch[1]) : 0n;
    const txHash = await client.identity.report({
      agentId,
      type: reportType,
      description: text,
    });

    callback?.({
      text: `Report submitted successfully.
Transaction: ${txHash}
Type: ${reportType}

Your report will be reviewed by moderators.`,
      content: { txHash, reportType },
    });
  },

  examples: [
    [
      { name: "user", content: { text: "Report agent #123 for spam" } },
      {
        name: "agent",
        content: { text: "Report submitted successfully. Transaction: 0x..." },
      },
    ],
  ],
};

export const listModerationCasesAction: Action = {
  name: "LIST_MODERATION_CASES",
  description: "List active moderation cases for voting",
  similes: [
    "moderation cases",
    "list cases",
    "active cases",
    "pending reports",
    "moderation queue",
  ],

  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),

  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService;
    const client = service.getClient();

    const response = await client.a2a.callGateway({
      skillId: "moderation-list-active-cases",
    });

    const responseData = expectResponseData(
      response,
      "Moderation API returned no data",
    );
    const cases = expectArray<{
      caseId: string;
      reportType: string;
      votesFor: number;
      votesAgainst: number;
    }>(
      responseData as Record<string, unknown>,
      "cases",
      "Moderation API response missing cases array",
    );

    if (cases.length === 0) {
      callback?.({ text: "No active moderation cases at this time." });
      return;
    }

    const caseList = cases
      .slice(0, 10)
      .map(
        (c) =>
          `• Case ${c.caseId}: ${c.reportType} (${c.votesFor} for / ${c.votesAgainst} against)`,
      )
      .join("\n");

    callback?.({
      text: `Active moderation cases (${cases.length}):
${caseList}

Use 'vote on case [id] [for/against]' to participate.`,
      content: { cases },
    });
  },

  examples: [
    [
      { name: "user", content: { text: "Show active moderation cases" } },
      {
        name: "agent",
        content: { text: "Active moderation cases (5): • Case 1: spam..." },
      },
    ],
  ],
};
