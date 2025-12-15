/**
 * Intent Actions - OIF cross-chain intents
 */

import {
  type Action,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
} from "@elizaos/core";
import { JEJU_SERVICE_NAME, type JejuService } from "../service";

export const createIntentAction: Action = {
  name: "CREATE_INTENT",
  description: "Create a cross-chain swap intent",
  similes: [
    "create intent",
    "cross chain swap",
    "bridge and swap",
    "swap across chains",
  ],

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
    const text = message.content.text ?? "";

    // Parse intent from natural language
    // "Swap 1 ETH on Ethereum for USDC on Arbitrum"
    const amountMatch = text.match(/(\d+(?:\.\d+)?)\s*(\w+)/i);
    const fromChainMatch = text.match(/on\s+(\w+)\s+for/i);
    const toTokenMatch = text.match(/for\s+(\w+)/i);
    const toChainMatch = text.match(/on\s+(\w+)$/i);

    if (!amountMatch || !fromChainMatch || !toTokenMatch) {
      callback?.({
        text: `Please specify your intent:
"Swap [amount] [token] on [sourceChain] for [targetToken] on [destChain]"

Example: "Swap 1 ETH on Ethereum for USDC on Arbitrum"`,
      });
      return;
    }

    callback?.({ text: "Getting quote for your intent..." });

    // For the intent, we use the A2A call since getQuote expects different params
    const quoteResponse = await client.a2a.callGateway({
      skillId: "get-quote",
      params: {
        sourceChain: fromChainMatch[1].toLowerCase(),
        destinationChain: toChainMatch?.[1].toLowerCase() ?? "jeju",
        sourceToken: amountMatch[2].toUpperCase(),
        destinationToken: toTokenMatch[1].toUpperCase(),
        amount: amountMatch[1],
      },
    });

    const quote = quoteResponse.data ?? {};

    callback?.({
      text: `Intent Quote:
From: ${quote.amountIn ?? amountMatch[1]} ${amountMatch[2]} on ${fromChainMatch[1]}
To: ${quote.amountOut ?? "?"} ${toTokenMatch[1]} on ${toChainMatch?.[1] ?? "Jeju"}
Fee: ${quote.fee ?? "?"}
Estimated time: ${quote.estimatedTimeSeconds ?? "?"}s

Say "confirm intent" to execute.`,
      content: quote,
    });
  },

  examples: [
    [
      { name: "user", content: { text: "Swap 1 ETH on Ethereum for USDC on Arbitrum" } },
      { name: "agent", content: { text: "Intent Quote: From: 1 ETH on Ethereum..." } },
    ],
  ],
};

export const trackIntentAction: Action = {
  name: "TRACK_INTENT",
  description: "Track the status of a cross-chain intent",
  similes: [
    "track intent",
    "intent status",
    "check intent",
    "where is my swap",
  ],

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
    const text = message.content.text ?? "";

    const intentIdMatch = text.match(/0x[a-fA-F0-9]{64}/);

    if (!intentIdMatch) {
      callback?.({ text: "Please provide an intent ID (0x...)" });
      return;
    }

    const response = await client.a2a.callGateway({
      skillId: "track-intent",
      params: { intentId: intentIdMatch[0] },
    });

    const intent = response.data;

    callback?.({
      text: `Intent Status:
ID: ${intent?.intentId ?? intentIdMatch[0]}
Status: ${intent?.status ?? "Unknown"}
Source: ${intent?.sourceChain ?? "?"} → Dest: ${intent?.destChain ?? "?"}
Amount: ${intent?.amountIn ?? "?"} → ${intent?.amountOut ?? "?"}
Solver: ${intent?.solver ?? "Pending"}
${intent?.txHash ? `Transaction: ${intent.txHash}` : ""}`,
      content: intent,
    });
  },

  examples: [
    [
      { name: "user", content: { text: "Track intent 0x1234..." } },
      { name: "agent", content: { text: "Intent Status: ID: 0x1234... Status: Filled..." } },
    ],
  ],
};

export const listSolversAction: Action = {
  name: "LIST_SOLVERS",
  description: "List active OIF solvers with reputation",
  similes: [
    "list solvers",
    "show solvers",
    "active solvers",
    "intent solvers",
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
      skillId: "list-solvers",
    });

    const solvers = (response.data?.solvers ?? []) as Array<{
      address: string;
      reputation: number;
      liquidity: string;
    }>;

    if (solvers.length === 0) {
      callback?.({ text: "No active solvers at this time." });
      return;
    }

    const solverList = solvers
      .slice(0, 10)
      .map((s) => `• ${s.address.slice(0, 10)}... - Rep: ${s.reputation} - Liquidity: ${s.liquidity}`)
      .join("\n");

    callback?.({
      text: `Active Solvers (${solvers.length}):
${solverList}`,
      content: { solvers },
    });
  },

  examples: [
    [
      { name: "user", content: { text: "Show active solvers" } },
      { name: "agent", content: { text: "Active Solvers (5): • 0x1234... - Rep: 98..." } },
    ],
  ],
};

export const listRoutesAction: Action = {
  name: "LIST_ROUTES",
  description: "List available cross-chain routes",
  similes: [
    "list routes",
    "available routes",
    "cross chain routes",
    "bridge routes",
    "supported chains",
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

    const chains = client.crosschain.getSupportedChains();

    callback?.({
      text: `Supported Cross-Chain Routes:
${chains.map((c) => `• ${c}`).join("\n")}

You can transfer between any of these chains using intents.`,
      content: { chains },
    });
  },

  examples: [
    [
      { name: "user", content: { text: "What cross-chain routes are available?" } },
      { name: "agent", content: { text: "Supported Cross-Chain Routes: • ethereum • base..." } },
    ],
  ],
};

