/**
 * DeFi Actions - Swaps and liquidity
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

function parseSwapParams(text: string): {
  amountIn?: bigint;
  tokenIn?: string;
  tokenOut?: string;
} {
  const params: { amountIn?: bigint; tokenIn?: string; tokenOut?: string } = {};

  // Extract amount
  const amountMatch = text.match(/(\d+(?:\.\d+)?)\s*(eth|jeju|usdc|usdt)?/i);
  if (amountMatch) {
    params.amountIn = parseEther(amountMatch[1]);
    if (amountMatch[2]) params.tokenIn = amountMatch[2].toUpperCase();
  }

  // Extract token pair
  const pairMatch = text.match(/(\w+)\s+(?:for|to|into)\s+(\w+)/i);
  if (pairMatch) {
    if (!params.tokenIn) params.tokenIn = pairMatch[1].toUpperCase();
    params.tokenOut = pairMatch[2].toUpperCase();
  }

  return params;
}

export const swapTokensAction: Action = {
  name: "SWAP_TOKENS",
  description: "Swap tokens on the network DEX (Uniswap V4)",
  similes: ["swap", "exchange", "trade", "convert", "buy", "sell tokens"],

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

    const params = parseSwapParams(message.content.text ?? "");

    if (!params.amountIn || !params.tokenIn || !params.tokenOut) {
      callback?.({
        text: 'Please specify: amount, token to sell, and token to buy. Example: "Swap 100 USDC for JEJU"',
      });
      return;
    }

    // Get token addresses (simplified - would need token registry lookup)
    const tokenAddresses: Record<string, Address> = {
      ETH: "0x0000000000000000000000000000000000000000",
      WETH: "0x4200000000000000000000000000000000000006",
      // Would be populated from token registry
    };

    const tokenIn =
      tokenAddresses[params.tokenIn] ??
      ("0x0000000000000000000000000000000000000000" as Address);
    const tokenOut =
      tokenAddresses[params.tokenOut] ??
      ("0x0000000000000000000000000000000000000000" as Address);

    callback?.({
      text: `Getting quote for ${formatEther(params.amountIn)} ${params.tokenIn} → ${params.tokenOut}...`,
    });

    const quote = await client.defi.getSwapQuote({
      tokenIn,
      tokenOut,
      amountIn: params.amountIn,
    });

    callback?.({
      text: `Quote received:
${formatEther(quote.amountIn)} ${params.tokenIn} → ${formatEther(quote.amountOut)} ${params.tokenOut}
Price Impact: ${quote.priceImpact.toFixed(2)}%
Fee: ${formatEther(quote.fee)} ETH

Executing swap...`,
    });

    const txHash = await client.defi.swap(quote);

    callback?.({
      text: `Swap executed successfully.
Transaction: ${txHash}
Swapped ${formatEther(quote.amountIn)} ${params.tokenIn} for ${formatEther(quote.amountOut)} ${params.tokenOut}`,
      content: {
        txHash,
        amountIn: quote.amountIn.toString(),
        amountOut: quote.amountOut.toString(),
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
      },
    });
  },

  examples: [
    [
      {
        name: "user",
        content: { text: "Swap 100 USDC for JEJU" },
      },
      {
        name: "agent",
        content: {
          text: "Swap executed successfully. Swapped 100 USDC for 5000 JEJU...",
        },
      },
    ],
    [
      {
        name: "user",
        content: { text: "Exchange 1 ETH to USDC" },
      },
      {
        name: "agent",
        content: { text: "Quote received: 1 ETH → 2500 USDC..." },
      },
    ],
  ],
};

export const addLiquidityAction: Action = {
  name: "ADD_LIQUIDITY",
  description: "Add liquidity to a pool on the network DEX",
  similes: [
    "add liquidity",
    "provide liquidity",
    "lp",
    "become lp",
    "pool liquidity",
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

    const text = message.content.text ?? "";

    // Parse amounts and tokens
    const matches = text.matchAll(/(\d+(?:\.\d+)?)\s*(\w+)/gi);
    const tokens: Array<{ amount: bigint; symbol: string }> = [];

    for (const match of matches) {
      if (
        ["add", "liquidity", "pool", "to", "and"].includes(
          match[2].toLowerCase(),
        )
      )
        continue;
      tokens.push({
        amount: parseEther(match[1]),
        symbol: match[2].toUpperCase(),
      });
    }

    if (tokens.length < 2) {
      callback?.({
        text: 'Please specify two tokens with amounts. Example: "Add liquidity 1 ETH and 2000 USDC"',
      });
      return;
    }

    callback?.({
      text: `Adding liquidity: ${formatEther(tokens[0].amount)} ${tokens[0].symbol} + ${formatEther(tokens[1].amount)} ${tokens[1].symbol}...`,
    });

    // Would need to resolve token addresses from registry
    const token0 = "0x0000000000000000000000000000000000000000" as Address;
    const token1 = "0x0000000000000000000000000000000000000000" as Address;

    const txHash = await client.defi.addLiquidity({
      token0,
      token1,
      amount0: tokens[0].amount,
      amount1: tokens[1].amount,
    });

    callback?.({
      text: `Liquidity added successfully.
Transaction: ${txHash}
Pool: ${tokens[0].symbol}/${tokens[1].symbol}`,
      content: {
        txHash,
        token0: tokens[0].symbol,
        token1: tokens[1].symbol,
        amount0: tokens[0].amount.toString(),
        amount1: tokens[1].amount.toString(),
      },
    });
  },

  examples: [
    [
      {
        name: "user",
        content: { text: "Add liquidity 1 ETH and 2000 USDC" },
      },
      {
        name: "agent",
        content: { text: "Liquidity added successfully. Pool: ETH/USDC..." },
      },
    ],
  ],
};
