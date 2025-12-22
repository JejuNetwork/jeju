/**
 * A2A Module - Agent-to-agent protocol client
 */

import type { NetworkType } from "@jejunetwork/types";
import type { JejuWallet } from "../wallet";
import type { ServicesConfig } from "../config";
import type { JsonRecord, JsonValue } from "../shared/types";
import { AgentCardSchema, AgentsListSchema } from "../shared/schemas";

export interface AgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  url: string;
  provider: { organization: string; url: string };
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
  };
  skills: AgentSkill[];
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  inputSchema?: {
    type: string;
    properties: Record<
      string,
      { type: string; description?: string; required?: boolean }
    >;
    required?: string[];
  };
  outputs?: Record<string, string>;
  paymentRequired?: boolean;
}

export interface A2AMessage {
  role: "user" | "agent";
  parts: Array<{
    kind: "text" | "data";
    text?: string;
    data?: JsonRecord;
  }>;
  messageId: string;
}

export interface A2ARequest {
  skillId: string;
  params?: JsonRecord;
  paymentHeader?: string;
}

export interface A2AResponse {
  message: string;
  data: JsonRecord;
  error?: { code: number; message: string; data?: JsonValue };
}

export interface DiscoveredAgent {
  name: string;
  endpoint: string;
  card: AgentCard;
  jnsName?: string;
  skills: Array<{ id: string; name: string; description: string }>;
}

export interface A2AModule {
  // Discovery
  discover(endpoint: string): Promise<AgentCard>;
  discoverByJNS(name: string): Promise<DiscoveredAgent>;
  listKnownAgents(): Promise<DiscoveredAgent[]>;

  // Communication
  call(endpoint: string, request: A2ARequest): Promise<A2AResponse>;
  callSkill(
    endpoint: string,
    skillId: string,
    params?: JsonRecord,
  ): Promise<A2AResponse>;

  // network services shortcuts
  callCompute(request: A2ARequest): Promise<A2AResponse>;
  callStorage(request: A2ARequest): Promise<A2AResponse>;
  callGateway(request: A2ARequest): Promise<A2AResponse>;
  callBazaar(request: A2ARequest): Promise<A2AResponse>;

  // Agent discovery
  discoverAgents(tags?: string[]): Promise<DiscoveredAgent[]>;

  // Streaming
  stream(
    endpoint: string,
    request: A2ARequest,
    onMessage: (msg: A2AMessage) => void,
  ): Promise<void>;
}

export function createA2AModule(
  wallet: JejuWallet,
  _network: NetworkType,
  services: ServicesConfig,
): A2AModule {
  let messageCounter = 0;

  async function buildAuthHeaders(): Promise<Record<string, string>> {
    const timestamp = Date.now().toString();
    const message = `a2a:${timestamp}`;
    const signature = await wallet.signMessage(message);

    return {
      "Content-Type": "application/json",
      "x-jeju-address": wallet.address,
      "x-jeju-timestamp": timestamp,
      "x-jeju-signature": signature,
    };
  }

  async function discover(endpoint: string): Promise<AgentCard> {
    const cardUrl = endpoint.endsWith("/")
      ? `${endpoint}.well-known/agent-card.json`
      : `${endpoint}/.well-known/agent-card.json`;

    const response = await fetch(cardUrl);
    if (!response.ok)
      throw new Error(`Failed to discover agent at ${endpoint}`);

    const rawData: unknown = await response.json();
    return AgentCardSchema.parse(rawData);
  }

  async function discoverByJNS(name: string): Promise<DiscoveredAgent> {
    // Resolve JNS to get A2A endpoint
    const normalized = name.endsWith(".jeju") ? name : `${name}.jeju`;
    const response = await fetch(
      `${services.gateway.api}/jns/records/${normalized}`,
    );

    if (!response.ok) throw new Error(`JNS name ${normalized} not found`);

    const records = (await response.json()) as { a2aEndpoint?: string };
    if (!records.a2aEndpoint)
      throw new Error(`No A2A endpoint for ${normalized}`);

    const card = await discover(records.a2aEndpoint);

    return {
      name: card.name,
      endpoint: records.a2aEndpoint,
      card,
      jnsName: normalized,
      skills: card.skills.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
      })),
    };
  }

  async function listKnownAgents(): Promise<DiscoveredAgent[]> {
    const response = await fetch(`${services.gateway.api}/a2a/agents`);
    if (!response.ok) {
      throw new Error(`Failed to list known agents: ${response.statusText}`);
    }

    const rawData: unknown = await response.json();
    const data = AgentsListSchema.parse(rawData);
    return data.agents;
  }

  async function call(
    endpoint: string,
    request: A2ARequest,
  ): Promise<A2AResponse> {
    const headers = await buildAuthHeaders();
    if (request.paymentHeader) {
      headers["x-payment"] = request.paymentHeader;
    }

    const messageId = `msg-${++messageCounter}-${Date.now()}`;

    const body = {
      jsonrpc: "2.0",
      method: "message/send",
      params: {
        message: {
          messageId,
          parts: [
            {
              kind: "data",
              data: {
                skillId: request.skillId,
                params: request.params ?? {},
              },
            },
          ],
        },
      },
      id: messageCounter,
    };

    const a2aUrl = endpoint.endsWith("/a2a") ? endpoint : `${endpoint}/a2a`;
    const response = await fetch(a2aUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const result = (await response.json()) as {
      jsonrpc: string;
      id: number;
      result?: {
        parts: Array<{
          kind: string;
          text?: string;
          data?: JsonRecord;
        }>;
      };
      error?: { code: number; message: string; data?: JsonValue };
    };

    if (result.error) {
      if (result.error.code === 402) {
        return {
          message: "Payment required",
          data: {},
          error: result.error,
        };
      }
      throw new Error(`A2A error: ${result.error.message}`);
    }

    if (!result.result) {
      throw new Error("A2A call returned no result");
    }
    const textPart = result.result.parts.find((p) => p.kind === "text");
    const dataPart = result.result.parts.find((p) => p.kind === "data");

    return {
      message: textPart?.text ?? "",
      data: dataPart?.data ?? {},  // Empty object is valid for responses with no structured data
    };
  }

  async function callSkill(
    endpoint: string,
    skillId: string,
    params?: JsonRecord,
  ): Promise<A2AResponse> {
    return call(endpoint, { skillId, params });
  }

  async function callCompute(request: A2ARequest): Promise<A2AResponse> {
    return call(services.compute.nodeApi, request);
  }

  async function callStorage(request: A2ARequest): Promise<A2AResponse> {
    return call(services.storage.api, request);
  }

  async function callGateway(request: A2ARequest): Promise<A2AResponse> {
    return call(services.gateway.a2a, request);
  }

  async function callBazaar(request: A2ARequest): Promise<A2AResponse> {
    return call(services.bazaar ?? `${services.gateway.api}/bazaar`, request);
  }

  async function discoverAgents(tags?: string[]): Promise<DiscoveredAgent[]> {
    // Query gateway for registered agents
    const response = await callGateway({
      skillId: "list-registered-apps",
      params: tags ? { tags } : {},
    });

    if (!response.data || !Array.isArray(response.data.apps)) {
      throw new Error("Invalid response from list-registered-apps: expected apps array");
    }
    const apps = response.data.apps as Array<{
      name: string;
      endpoint: string;
      jnsName?: string;
      metadata?: JsonRecord;
    }>;

    // Discover agent cards for each app
    const agents: DiscoveredAgent[] = [];
    for (const app of apps.slice(0, 20)) {
      // Agent discovery can fail for individual agents without failing the whole list
      // Log the error but continue with other agents
      const card = await discover(app.endpoint).catch((err: Error) => {
        console.warn(`Failed to discover agent at ${app.endpoint}: ${err.message}`);
        return null;
      });
      if (card) {
        agents.push({
          name: app.name,
          endpoint: app.endpoint,
          card,
          jnsName: app.jnsName,
          skills: card.skills.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
          })),
        });
      }
    }

    return agents;
  }

  async function stream(
    endpoint: string,
    request: A2ARequest,
    onMessage: (msg: A2AMessage) => void,
  ): Promise<void> {
    const headers = await buildAuthHeaders();
    const messageId = `msg-${++messageCounter}-${Date.now()}`;

    const body = {
      jsonrpc: "2.0",
      method: "message/stream",
      params: {
        message: {
          messageId,
          parts: [
            {
              kind: "data",
              data: {
                skillId: request.skillId,
                params: request.params ?? {},
              },
            },
          ],
        },
      },
      id: messageCounter,
    };

    const a2aUrl = endpoint.endsWith("/a2a") ? endpoint : `${endpoint}/a2a`;
    const response = await fetch(a2aUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) throw new Error(`Stream failed: ${response.statusText}`);
    if (!response.body) throw new Error("No response body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") return;

          const parsed = JSON.parse(data) as A2AMessage;
          onMessage(parsed);
        }
      }
    }
  }

  return {
    discover,
    discoverByJNS,
    listKnownAgents,
    call,
    callSkill,
    callCompute,
    callStorage,
    callGateway,
    callBazaar,
    discoverAgents,
    stream,
  };
}
