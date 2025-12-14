/**
 * Identity Actions - Agent registration
 */

import {
  type Action,
  type ActionExample,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
} from '@elizaos/core';
import { JEJU_SERVICE_NAME, type JejuService } from '../service';

export const registerAgentAction: Action = {
  name: 'REGISTER_AGENT',
  description: 'Register as an agent on the network Identity Registry (ERC-8004)',
  similes: ['register agent', 'create identity', 'register identity', 'join network'],

  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService(JEJU_SERVICE_NAME);
    return !!service;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State | undefined,
    _options: Record<string, unknown>,
    callback?: HandlerCallback
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService;
    const client = service.getClient();

    // Check if already registered
    const existing = await client.identity.getMyAgent();
    if (existing) {
      callback?.({
        text: `Already registered as agent.
Agent ID: ${existing.agentId}
Name: ${existing.name}
Tags: ${existing.tags.join(', ')}`,
        content: existing,
      });
      return;
    }

    const text = message.content.text ?? '';
    const agentName = state?.agentName || 'NetworkAgent';

    // Extract tags from message
    const tagMatch = text.match(/tags?:\s*([^.]+)/i);
    const tags = tagMatch
      ? tagMatch[1].split(/[,\s]+/).filter((t) => t.length > 0)
      : ['ai', 'assistant'];

    callback?.({ text: `Registering agent "${agentName}" with tags: ${tags.join(', ')}...` });

    const { agentId, txHash } = await client.identity.register({
      name: agentName,
      tags,
    });

    callback?.({
      text: `Agent registered successfully.
Agent ID: ${agentId}
Name: ${agentName}
Tags: ${tags.join(', ')}
Transaction: ${txHash}

You can now participate in governance and access reputation features.`,
      content: { agentId: agentId.toString(), name: agentName, tags, txHash },
    });
  },

  examples: [
    [
      {
        user: '{{user1}}',
        content: { text: 'Register as an agent with tags: trading, defi' },
      },
      {
        user: '{{agent}}',
        content: { text: 'Agent registered successfully. Agent ID: 123...' },
      },
    ],
  ] as ActionExample[][],
};

