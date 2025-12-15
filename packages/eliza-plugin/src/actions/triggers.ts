/**
 * Triggers Action - Cron/webhook triggers
 */

import {
  type Action,
  type ActionExample,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
} from "@elizaos/core";
import { JEJU_SERVICE_NAME, type JejuService } from "../service";

export const createTriggerAction: Action = {
  name: "CREATE_TRIGGER",
  description: "Create a cron or webhook trigger for automated tasks",
  similes: [
    "create trigger",
    "schedule task",
    "set cron",
    "create webhook",
    "automate",
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

    // Parse trigger type and parameters
    const isCron = /cron|schedule|every|hourly|daily/i.test(text);
    const type = isCron ? "cron" : "webhook";

    // Extract cron expression or use default
    let cronExpression = "0 * * * *"; // Every hour by default
    if (/every\s*(\d+)\s*min/i.test(text)) {
      const mins = text.match(/every\s*(\d+)\s*min/i)?.[1];
      cronExpression = `*/${mins} * * * *`;
    } else if (/hourly/i.test(text)) {
      cronExpression = "0 * * * *";
    } else if (/daily/i.test(text)) {
      cronExpression = "0 0 * * *";
    }

    // Extract endpoint URL
    const urlMatch = text.match(/https?:\/\/[^\s]+/);
    const endpoint = urlMatch?.[0] ?? "https://example.com/webhook";

    // Extract name
    const nameMatch = text.match(/(?:named?|called?)\s+["']?([^"'\s]+)["']?/i);
    const name = nameMatch?.[1] ?? `trigger-${Date.now()}`;

    callback?.({ text: `Creating ${type} trigger "${name}"...` });

    const txHash = await client.compute.createTrigger({
      type,
      name,
      endpoint,
      cronExpression: type === "cron" ? cronExpression : undefined,
    });

    callback?.({
      text: `Trigger created successfully.
Name: ${name}
Type: ${type}
${type === "cron" ? `Schedule: ${cronExpression}` : ""}
Endpoint: ${endpoint}
Transaction: ${txHash}`,
      content: { txHash, name, type, endpoint },
    });
  },

  examples: [
    [
      {
        name: "user",
        content: { text: "Create a cron trigger that runs every hour" },
      },
      {
        name: "agent",
        content: { text: "Trigger created successfully. Name: trigger-xxx..." },
      },
    ],
  ],
};
