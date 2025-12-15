/**
 * Names Actions - JNS registration and resolution
 */

import {
  type Action,
  type ActionExample,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
} from "@elizaos/core";
import { formatEther } from "viem";
import { JEJU_SERVICE_NAME, type JejuService } from "../service";

export const registerNameAction: Action = {
  name: "REGISTER_NAME",
  description: "Register a .jeju name on the network Name Service (JNS)",
  similes: [
    "register name",
    "buy name",
    "get domain",
    "register domain",
    "claim name",
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

    // Extract name
    const nameMatch = text.match(/([a-z0-9-]+)(?:\.jeju)?/i);
    if (!nameMatch) {
      callback?.({
        text: 'Please specify a name to register. Example: "Register myagent.jeju"',
      });
      return;
    }

    const name = nameMatch[1].toLowerCase();
    const fullName = `${name}.jeju`;

    // Check availability
    const available = await client.names.isAvailable(fullName);
    if (!available) {
      callback?.({
        text: `${fullName} is already registered. Try a different name.`,
      });
      return;
    }

    // Get price
    const price = await client.names.getRegistrationPrice(fullName, 1);

    callback?.({
      text: `${fullName} is available.
Registration cost: ${formatEther(price)} ETH for 1 year

Registering...`,
    });

    const txHash = await client.names.register({
      name: fullName,
      durationYears: 1,
    });

    callback?.({
      text: `Name registered successfully.
Name: ${fullName}
Duration: 1 year
Transaction: ${txHash}

You can now set records with "Set address for ${fullName}"`,
      content: { txHash, name: fullName },
    });
  },

  examples: [
    [
      {
        name: "user",
        content: { text: "Register myagent.jeju" },
      },
      {
        name: "agent",
        content: {
          text: "Name registered successfully. Name: myagent.jeju...",
        },
      },
    ],
  ],
};

export const resolveNameAction: Action = {
  name: "RESOLVE_NAME",
  description: "Resolve a .jeju name to an address",
  similes: [
    "resolve name",
    "lookup name",
    "find address",
    "who is",
    "what address",
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

    // Extract name
    const nameMatch = text.match(/([a-z0-9-]+\.jeju)/i);
    if (!nameMatch) {
      callback?.({
        text: 'Please specify a .jeju name to resolve. Example: "Resolve gateway.jeju"',
      });
      return;
    }

    const name = nameMatch[1].toLowerCase();

    const address = await client.names.resolve(name);
    const records = await client.names.getRecords(name);
    const info = await client.names.getNameInfo(name);

    if (!address) {
      callback?.({ text: `${name} is not registered or has no address set.` });
      return;
    }

    callback?.({
      text: `${name} resolves to:
Address: ${address}
${records.a2aEndpoint ? `A2A Endpoint: ${records.a2aEndpoint}` : ""}
${info ? `Owner: ${info.owner}` : ""}`,
      content: { name, address, records, info },
    });
  },

  examples: [
    [
      {
        name: "user",
        content: { text: "Resolve gateway.jeju" },
      },
      {
        name: "agent",
        content: { text: "gateway.jeju resolves to: 0x..." },
      },
    ],
  ],
};
