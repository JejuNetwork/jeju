/**
 * Governance Actions - Proposals and voting
 */

import {
  type Action,
  type ActionExample,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
} from '@elizaos/core';
import { ProposalType, VoteType } from '@jejunetwork/types';
import { JEJU_SERVICE_NAME, type JejuService } from '../service';

export const createProposalAction: Action = {
  name: 'CREATE_PROPOSAL',
  description: 'Create a governance proposal on the network DAO',
  similes: ['create proposal', 'submit proposal', 'propose', 'new proposal', 'governance proposal'],

  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService(JEJU_SERVICE_NAME);
    return !!service;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown>,
    callback?: HandlerCallback
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService;
    const client = service.getClient();

    const text = message.content.text ?? '';

    // Extract title and description
    const titleMatch = text.match(/(?:title|propose|proposal)[:"]?\s*([^.!?\n]+)/i);
    const title = titleMatch?.[1]?.trim() ?? 'Untitled Proposal';

    const description = text.replace(/create|proposal|propose|submit/gi, '').trim();

    // Determine proposal type
    let type = ProposalType.POLICY;
    if (/treasury|fund|budget|allocat/i.test(text)) type = ProposalType.TREASURY_ALLOCATION;
    if (/code|upgrade|deploy|contract/i.test(text)) type = ProposalType.CODE_UPGRADE;
    if (/grant/i.test(text)) type = ProposalType.GRANT;
    if (/bounty/i.test(text)) type = ProposalType.BOUNTY;

    callback?.({ text: `Creating proposal: "${title}"...` });

    const txHash = await client.governance.createProposal({
      type,
      title,
      description,
    });

    callback?.({
      text: `Proposal created successfully.
Title: ${title}
Type: ${ProposalType[type]}
Transaction: ${txHash}

The proposal will go through council review before community voting.`,
      content: { txHash, title, type: ProposalType[type] },
    });
  },

  examples: [
    [
      {
        user: '{{user1}}',
        content: { text: 'Create proposal: Increase compute rewards by 10%' },
      },
      {
        user: '{{agent}}',
        content: { text: 'Proposal created successfully. Title: Increase compute rewards...' },
      },
    ],
  ] as ActionExample[][],
};

export const voteAction: Action = {
  name: 'VOTE_PROPOSAL',
  description: 'Vote on a governance proposal',
  similes: ['vote', 'vote on proposal', 'approve proposal', 'reject proposal', 'cast vote'],

  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService(JEJU_SERVICE_NAME);
    return !!service;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown>,
    callback?: HandlerCallback
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService;
    const client = service.getClient();

    const text = message.content.text ?? '';

    // Extract proposal ID
    const idMatch = text.match(/0x[a-fA-F0-9]{64}|#(\d+)|proposal\s+(\d+)/i);
    if (!idMatch) {
      // List active proposals
      const proposals = await client.governance.listProposals();

      callback?.({
        text: `Active proposals:
${proposals.slice(0, 5).map((p, i) => `${i + 1}. ${p.proposalId.slice(0, 10)}... - Status: ${p.status}`).join('\n')}

Specify a proposal ID to vote. Example: "Vote approve on 0x..."`,
      });
      return;
    }

    const proposalId = idMatch[0].startsWith('0x')
      ? (idMatch[0] as `0x${string}`)
      : (`0x${idMatch[1] ?? idMatch[2]}`.padEnd(66, '0') as `0x${string}`);

    // Determine vote
    let vote = VoteType.ABSTAIN;
    if (/approve|yes|for|support/i.test(text)) vote = VoteType.APPROVE;
    if (/reject|no|against|oppose/i.test(text)) vote = VoteType.REJECT;

    const voteLabel = ['APPROVE', 'REJECT', 'ABSTAIN', 'REQUEST_CHANGES'][vote];

    callback?.({ text: `Voting ${voteLabel} on proposal ${proposalId.slice(0, 10)}...` });

    const txHash = await client.governance.vote({
      proposalId,
      vote,
    });

    callback?.({
      text: `Vote cast successfully.
Proposal: ${proposalId.slice(0, 10)}...
Vote: ${voteLabel}
Transaction: ${txHash}`,
      content: { txHash, proposalId, vote: voteLabel },
    });
  },

  examples: [
    [
      {
        user: '{{user1}}',
        content: { text: 'Vote approve on proposal 0x123...' },
      },
      {
        user: '{{agent}}',
        content: { text: 'Vote cast successfully. Vote: APPROVE...' },
      },
    ],
  ] as ActionExample[][],
};

