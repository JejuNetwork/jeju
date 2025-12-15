/**
 * Node Actions - Node registration, staking, management
 */

import {
  type Action,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
} from "@elizaos/core";
import { JEJU_SERVICE_NAME, type JejuService } from "../service";

export const listNodesAction: Action = {
  name: "LIST_NODES",
  description: "List registered nodes in the network",
  similes: [
    "list nodes",
    "show nodes",
    "network nodes",
    "registered nodes",
    "node operators",
  ],

  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService(JEJU_SERVICE_NAME);
    return !!service;
  },

  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown>,
    callback?: HandlerCallback
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService;
    const client = service.getClient();

    const response = await client.a2a.callGateway({
      skillId: "list-nodes",
    });

    const nodes = (response.data?.nodes ?? []) as Array<{
      address: string;
      name: string;
      stake: string;
      status: string;
    }>;

    if (nodes.length === 0) {
      callback?.({ text: "No nodes registered yet." });
      return;
    }

    const nodeList = nodes
      .slice(0, 10)
      .map((n) => `• ${n.name} (${n.address.slice(0, 10)}...) - Stake: ${n.stake} ETH - ${n.status}`)
      .join("\n");

    callback?.({
      text: `Registered nodes (${nodes.length}):
${nodeList}`,
      content: { nodes },
    });
  },

  examples: [
    [
      { name: "user", content: { text: "List network nodes" } },
      { name: "agent", content: { text: "Registered nodes (12): • Node-1..." } },
    ],
  ],
};

export const getNodeStatsAction: Action = {
  name: "GET_NODE_STATS",
  description: "Get network node statistics",
  similes: [
    "node stats",
    "network stats",
    "node statistics",
    "network health",
    "infrastructure stats",
  ],

  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService(JEJU_SERVICE_NAME);
    return !!service;
  },

  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown>,
    callback?: HandlerCallback
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService;
    const client = service.getClient();

    const response = await client.a2a.callGateway({
      skillId: "get-node-stats",
    });

    const stats = response.data ?? {};

    callback?.({
      text: `Network Node Statistics:
• Total Nodes: ${stats.totalNodes ?? 0}
• Active Nodes: ${stats.activeNodes ?? 0}
• Total Stake: ${stats.totalStake ?? "0"} ETH
• Average Uptime: ${stats.averageUptime ?? 0}%
• Network Capacity: ${stats.capacity ?? "Unknown"}`,
      content: stats,
    });
  },

  examples: [
    [
      { name: "user", content: { text: "Show node stats" } },
      { name: "agent", content: { text: "Network Node Statistics: • Total Nodes: 15..." } },
    ],
  ],
};

