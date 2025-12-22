/**
 * Governance Actions - Proposals and voting
 */

import {
  type Action,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
} from "@elizaos/core";
import {
  type ProposalType,
  type VoteType,
  VoteTypeValue,
} from "@jejunetwork/types";
import { JEJU_SERVICE_NAME, type JejuService } from "../service";
import { getMessageText, validateServiceExists } from "../validation";

export const createProposalAction: Action = {
  name: "CREATE_PROPOSAL",
  description: "Create a governance proposal on the network DAO",
  similes: [
    "create proposal",
    "submit proposal",
    "propose",
    "new proposal",
    "governance proposal",
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

    // Extract title and description
    const titleMatch = text.match(
      /(?:title|propose|proposal)[:"]?\s*([^.!?\n]+)/i,
    );
    if (!titleMatch?.[1]?.trim()) {
      callback?.({
        text: "Please provide a title for your proposal. Example: 'Create proposal title: My Proposal...'",
      });
      return;
    }
    const title = titleMatch[1].trim();

    const description = text
      .replace(/create|proposal|propose|submit/gi, "")
      .trim();

    // Determine proposal type
    let type: ProposalType = "POLICY";
    if (/treasury|fund|budget|allocat/i.test(text))
      type = "TREASURY_ALLOCATION";
    if (/code|upgrade|deploy|contract/i.test(text)) type = "CODE_UPGRADE";
    if (/grant/i.test(text)) type = "GRANT";
    if (/bounty/i.test(text)) type = "BOUNTY";

    callback?.({ text: `Creating proposal: "${title}"...` });

    const txHash = await client.governance.createProposal({
      type,
      title,
      description,
    });

    callback?.({
      text: `Proposal created successfully.
Title: ${title}
Type: ${type}
Transaction: ${txHash}

The proposal will go through council review before community voting.`,
      content: { txHash, title, type },
    });
  },

  examples: [
    [
      {
        name: "user",
        content: { text: "Create proposal: Increase compute rewards by 10%" },
      },
      {
        name: "agent",
        content: {
          text: "Proposal created successfully. Title: Increase compute rewards...",
        },
      },
    ],
  ],
};

export const voteAction: Action = {
  name: "VOTE_PROPOSAL",
  description: "Vote on a governance proposal",
  similes: [
    "vote",
    "vote on proposal",
    "approve proposal",
    "reject proposal",
    "cast vote",
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

    // Extract proposal ID
    const idMatch = text.match(/0x[a-fA-F0-9]{64}|#(\d+)|proposal\s+(\d+)/i);
    if (!idMatch) {
      // List active proposals
      const proposals = await client.governance.listProposals();

      callback?.({
        text: `Active proposals:
${proposals
  .slice(0, 5)
  .map(
    (p: { proposalId: string; status: string }, i: number) =>
      `${i + 1}. ${p.proposalId.slice(0, 10)}... - Status: ${p.status}`,
  )
  .join("\n")}

Specify a proposal ID to vote. Example: "Vote approve on 0x..."`,
      });
      return;
    }

    const numericId = idMatch[1] ?? idMatch[2];
    if (!idMatch[0].startsWith("0x") && !numericId) {
      callback?.({ text: "Invalid proposal ID format" });
      return;
    }
    const proposalId = idMatch[0].startsWith("0x")
      ? (idMatch[0] as `0x${string}`)
      : (`0x${numericId}`.padEnd(66, "0") as `0x${string}`);

    // Determine vote
    let vote: VoteType = "ABSTAIN";
    if (/approve|yes|for|support/i.test(text)) vote = "APPROVE";
    if (/reject|no|against|oppose/i.test(text)) vote = "REJECT";

    callback?.({
      text: `Voting ${vote} on proposal ${proposalId.slice(0, 10)}...`,
    });

    const txHash = await client.governance.vote({
      proposalId,
      vote: VoteTypeValue[vote],
    });

    callback?.({
      text: `Vote cast successfully.
Proposal: ${proposalId.slice(0, 10)}...
Vote: ${vote}
Transaction: ${txHash}`,
      content: { txHash, proposalId, vote },
    });
  },

  examples: [
    [
      {
        name: "user",
        content: { text: "Vote approve on proposal 0x123..." },
      },
      {
        name: "agent",
        content: { text: "Vote cast successfully. Vote: APPROVE..." },
      },
    ],
  ],
};
