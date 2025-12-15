/**
 * Cross-chain Actions - EIL + OIF transfers
 */

import {
  type Action,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
} from "@elizaos/core";
import { type Address, parseEther, formatEther } from "viem";
import { JEJU_SERVICE_NAME, type JejuService } from "../service";
import type { SupportedChain } from "@jejunetwork/sdk";

function parseTransferParams(text: string): {
  amount?: bigint;
  from?: SupportedChain;
  to?: SupportedChain;
  token?: string;
} {
  const params: {
    amount?: bigint;
    from?: SupportedChain;
    to?: SupportedChain;
    token?: string;
  } = {};

  // Extract amount
  const amountMatch = text.match(/(\d+(?:\.\d+)?)\s*(eth|usdc|jeju)?/i);
  if (amountMatch) {
    params.amount = parseEther(amountMatch[1]);
    if (amountMatch[2]) params.token = amountMatch[2].toUpperCase();
  }

  // Extract chains
  const chains: SupportedChain[] = [
    "jeju",
    "base",
    "optimism",
    "arbitrum",
    "ethereum",
  ];
  for (const chain of chains) {
    if (text.toLowerCase().includes(`from ${chain}`)) params.from = chain;
    if (text.toLowerCase().includes(`to ${chain}`)) params.to = chain;
  }

  // Default from chain to jeju
  if (!params.from && params.to) params.from = "jeju";

  return params;
}

export const crossChainTransferAction: Action = {
  name: "CROSS_CHAIN_TRANSFER",
  description: "Transfer tokens cross-chain using the network EIL/OIF",
  similes: [
    "bridge",
    "cross chain",
    "transfer to",
    "send to chain",
    "bridge tokens",
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
    callback?: HandlerCallback,
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService;
    const client = service.getClient();

    const params = parseTransferParams(message.content.text ?? "");

    if (!params.amount || !params.to) {
      callback?.({
        text: `Please specify amount and destination chain.
Example: "Bridge 1 ETH from jeju to base"

Supported chains: ${client.crosschain.getSupportedChains().join(", ")}`,
      });
      return;
    }

    const from = params.from ?? "jeju";
    const token = "0x0000000000000000000000000000000000000000" as Address; // ETH

    callback?.({
      text: `Getting quote for ${formatEther(params.amount)} ETH from ${from} to ${params.to}...`,
    });

    const quote = await client.crosschain.getQuote({
      from,
      to: params.to,
      token,
      amount: params.amount,
    });

    callback?.({
      text: `Quote received:
Route: ${quote.route.toUpperCase()}
Amount In: ${formatEther(quote.amountIn)} ETH
Amount Out: ${formatEther(quote.amountOut)} ETH
Fee: ${formatEther(quote.fee)} ETH (${quote.feePercent.toFixed(2)}%)
Estimated Time: ${quote.estimatedTimeSeconds}s

Executing transfer...`,
    });

    const txHash = await client.crosschain.transfer(quote);

    callback?.({
      text: `Cross-chain transfer initiated.
Transaction: ${txHash}
From: ${from} → To: ${params.to}
Amount: ${formatEther(quote.amountIn)} ETH
Route: ${quote.route.toUpperCase()}

The transfer will complete in approximately ${quote.estimatedTimeSeconds} seconds.`,
      content: {
        txHash,
        from,
        to: params.to,
        amountIn: quote.amountIn.toString(),
        amountOut: quote.amountOut.toString(),
        route: quote.route,
      },
    });
  },

  examples: [
    [
      {
        name: "user",
        content: { text: "Bridge 1 ETH from jeju to base" },
      },
      {
        name: "agent",
        content: {
          text: "Cross-chain transfer initiated. From: jeju → To: base...",
        },
      },
    ],
    [
      {
        name: "user",
        content: { text: "Send 0.5 ETH to arbitrum" },
      },
      {
        name: "agent",
        content: { text: "Getting quote for 0.5 ETH from jeju to arbitrum..." },
      },
    ],
  ],
};
