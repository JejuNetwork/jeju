/**
 * Storage Actions - IPFS upload/retrieve
 */

import {
  type Action,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
} from "@elizaos/core";
import { JEJU_SERVICE_NAME, type JejuService } from "../service";
import { getMessageText, validateServiceExists } from "../validation";

export const uploadFileAction: Action = {
  name: "UPLOAD_FILE",
  description: "Upload a file to the network decentralized storage (IPFS)",
  similes: [
    "upload file",
    "store file",
    "save to ipfs",
    "pin file",
    "upload to storage",
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

    // Check for JSON data to upload
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const jsonData = JSON.parse(jsonMatch[0]);
      const result = await client.storage.uploadJson(jsonData);

      callback?.({
        text: `File uploaded to IPFS.
CID: ${result.cid}
Size: ${result.size} bytes
Gateway URL: ${result.gatewayUrl}`,
        content: result,
      });
      return;
    }

    // Check for URL to content
    const urlMatch = text.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      callback?.({ text: `Fetching content from ${urlMatch[0]}...` });

      const response = await fetch(urlMatch[0]);
      const data = new Uint8Array(await response.arrayBuffer());
      const result = await client.storage.upload(data);

      callback?.({
        text: `Content uploaded to IPFS.
CID: ${result.cid}
Size: ${result.size} bytes
Gateway URL: ${result.gatewayUrl}`,
        content: result,
      });
      return;
    }

    // Upload text content
    const content = text.replace(/upload|file|store|save|ipfs/gi, "").trim();
    if (content) {
      const data = new TextEncoder().encode(content);
      const result = await client.storage.upload(data, { name: "content.txt" });

      callback?.({
        text: `Content uploaded to IPFS.
CID: ${result.cid}
Size: ${result.size} bytes
Gateway URL: ${result.gatewayUrl}`,
        content: result,
      });
      return;
    }

    callback?.({
      text: "Please provide content to upload (text, JSON, or URL).",
    });
  },

  examples: [
    [
      {
        name: "user",
        content: { text: 'Upload this data: {"name": "test", "value": 123}' },
      },
      {
        name: "agent",
        content: { text: "File uploaded to IPFS. CID: Qm..." },
      },
    ],
  ],
};

export const retrieveFileAction: Action = {
  name: "RETRIEVE_FILE",
  description: "Retrieve a file from the network storage by CID",
  similes: [
    "get file",
    "retrieve file",
    "download",
    "fetch from ipfs",
    "get cid",
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

    // Extract CID
    const cidMatch = text.match(/Qm[a-zA-Z0-9]{44}|bafy[a-zA-Z0-9]+/);
    if (!cidMatch) {
      callback?.({
        text: "Please provide an IPFS CID (starting with Qm or bafy).",
      });
      return;
    }

    const cid = cidMatch[0];
    callback?.({ text: `Retrieving ${cid}...` });

    const data = await client.storage.retrieve(cid);
    const text_content = new TextDecoder().decode(data);

    // Parse as JSON if it looks like JSON
    const isJson =
      text_content.trim().startsWith("{") ||
      text_content.trim().startsWith("[");
    const parsed: Record<string, unknown> | string = isJson
      ? (JSON.parse(text_content) as Record<string, unknown>)
      : text_content;

    callback?.({
      text: `Retrieved content (${data.length} bytes):

${text_content.slice(0, 1000)}${text_content.length > 1000 ? "..." : ""}`,
      content: {
        cid,
        size: data.length,
        content: parsed,
        gatewayUrl: client.storage.getGatewayUrl(cid),
      },
    });
  },

  examples: [
    [
      {
        name: "user",
        content: { text: "Retrieve QmXxxxxx" },
      },
      {
        name: "agent",
        content: { text: "Retrieved content (1234 bytes): ..." },
      },
    ],
  ],
};
