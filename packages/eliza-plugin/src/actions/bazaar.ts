/**
 * Bazaar Actions - NFT trading, token launchpad, name marketplace
 */

import {
  type Action,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
} from "@elizaos/core";
import { JEJU_SERVICE_NAME, type JejuService } from "../service";

export const launchTokenAction: Action = {
  name: "LAUNCH_TOKEN",
  description: "Launch a new token on the network launchpad",
  similes: [
    "launch token",
    "create token",
    "deploy token",
    "new token",
    "token launchpad",
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

    // Extract token parameters
    const nameMatch = text.match(/name[:\s]+["']?([^"'\n,]+)["']?/i);
    const symbolMatch = text.match(/symbol[:\s]+["']?([A-Z0-9]+)["']?/i);
    const supplyMatch = text.match(/supply[:\s]+(\d+)/i);

    if (!nameMatch || !symbolMatch) {
      callback?.({
        text: `Please provide token details:
• Name: The token name (e.g., "My Token")
• Symbol: 3-6 character symbol (e.g., "MTK")
• Supply: Total supply (default: 1,000,000,000)

Example: "Launch token name: My Token, symbol: MTK, supply: 1000000000"`,
      });
      return;
    }

    const name = nameMatch[1].trim();
    const symbol = symbolMatch[1].toUpperCase();
    const totalSupply = supplyMatch ? BigInt(supplyMatch[1]) * 10n ** 18n : 10n ** 27n;

    callback?.({ text: `Launching ${name} (${symbol})...` });

    const result = await client.defi.launchToken({
      name,
      symbol,
      totalSupply,
    });

    callback?.({
      text: `Token launched successfully!
Name: ${name}
Symbol: ${symbol}
Contract: ${result.tokenAddress}
Transaction: ${result.txHash}

Your token is now tradeable on the network bazaar!`,
      content: result,
    });
  },

  examples: [
    [
      { name: "user", content: { text: "Launch token name: AI Agent Token, symbol: AAT" } },
      { name: "agent", content: { text: "Token launched successfully! Contract: 0x..." } },
    ],
  ],
};

export const listNftsAction: Action = {
  name: "LIST_NFTS",
  description: "List NFTs available on the marketplace",
  similes: [
    "list nfts",
    "show nfts",
    "nft marketplace",
    "browse nfts",
    "find nfts",
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

    // Extract optional collection filter
    const collectionMatch = text.match(/collection[:\s]+([^\s]+)/i);

    const response = await client.a2a.callBazaar({
      skillId: "list-nfts",
      params: { collection: collectionMatch?.[1] },
    });

    const nfts = (response.data?.nfts ?? []) as Array<{
      name: string;
      collection: string;
      price: string;
    }>;

    if (nfts.length === 0) {
      callback?.({ text: "No NFTs currently listed on the marketplace." });
      return;
    }

    const nftList = nfts
      .slice(0, 10)
      .map((n) => `• ${n.name} (${n.collection}) - ${n.price} ETH`)
      .join("\n");

    callback?.({
      text: `NFTs on marketplace (${nfts.length}):
${nftList}`,
      content: { nfts },
    });
  },

  examples: [
    [
      { name: "user", content: { text: "Show NFTs on marketplace" } },
      { name: "agent", content: { text: "NFTs on marketplace (25): • Cool NFT #1..." } },
    ],
  ],
};

export const listNamesForSaleAction: Action = {
  name: "LIST_NAMES_FOR_SALE",
  description: "List JNS names available for purchase on the marketplace",
  similes: [
    "names for sale",
    "buy name",
    "name marketplace",
    "available names",
    "jns marketplace",
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

    const response = await client.a2a.callBazaar({
      skillId: "list-names-for-sale",
    });

    const names = (response.data?.names ?? []) as Array<{
      name: string;
      price: string;
      seller: string;
    }>;

    if (names.length === 0) {
      callback?.({ text: "No JNS names currently listed for sale." });
      return;
    }

    const nameList = names
      .slice(0, 15)
      .map((n) => `• ${n.name} - ${n.price} ETH`)
      .join("\n");

    callback?.({
      text: `JNS names for sale (${names.length}):
${nameList}

Use 'buy name [name]' to purchase.`,
      content: { names },
    });
  },

  examples: [
    [
      { name: "user", content: { text: "Show names for sale" } },
      { name: "agent", content: { text: "JNS names for sale (8): • cool.jeju - 0.1 ETH..." } },
    ],
  ],
};

