/**
 * VPN SDK Utilities
 *
 * Provides:
 * - x402 Payment Integration for VPN services
 * - A2A (Agent-to-Agent) client for VPN agents
 *
 * Note: For VPN node management integrated with JejuClient,
 * see vpn-module.ts which provides the VPNModule interface.
 */

import type { Address } from "viem";
import { VPNA2AResultSchema } from "../shared/schemas";

// ============================================================================
// x402 Payment Integration
// ============================================================================

export interface VPNSDKConfig {
  rpcUrl: string;
  chainId: number;
  contracts: {
    vpnRegistry: Address;
    vpnBilling?: Address;
  };
  coordinatorUrl?: string;
}

export interface VPNPaymentParams {
  resource: "vpn:connect" | "vpn:proxy" | "vpn:bandwidth";
  amount: bigint;
}

export interface VPNPaymentHeader {
  header: string;
  expiresAt: number;
}

/**
 * Create x402 payment header for VPN services
 */
export async function createVPNPaymentHeader(
  wallet: { address: string; signMessage: (msg: string) => Promise<string> },
  config: VPNSDKConfig,
  params: VPNPaymentParams,
): Promise<VPNPaymentHeader> {
  const timestamp = Math.floor(Date.now() / 1000);
  // Use cryptographically secure random bytes for nonce
  const randomPart = crypto.getRandomValues(new Uint8Array(6));
  const randomHex = Array.from(randomPart)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const nonce = `${wallet.address}-${timestamp}-${randomHex}`;

  const message = `x402:exact:jeju:${config.contracts.vpnRegistry}:${params.amount}:0x0000000000000000000000000000000000000000:${params.resource}:${nonce}:${timestamp}`;
  const signature = await wallet.signMessage(message);

  const payload = {
    scheme: "exact",
    network: "jeju",
    payTo: config.contracts.vpnRegistry,
    amount: params.amount.toString(),
    asset: "0x0000000000000000000000000000000000000000",
    resource: params.resource,
    nonce,
    timestamp,
    signature,
  };

  return {
    header: `x402 ${Buffer.from(JSON.stringify(payload)).toString("base64")}`,
    expiresAt: timestamp + 300,
  };
}

// ============================================================================
// A2A Integration
// ============================================================================

export interface VPNAgentClient {
  /** Discover VPN agent capabilities */
  discover(): Promise<VPNAgentCard>;

  /** Connect to VPN via A2A */
  connect(
    countryCode?: string,
    protocol?: string,
  ): Promise<VPNConnectionResult>;

  /** Disconnect via A2A */
  disconnect(
    connectionId: string,
  ): Promise<{ success: boolean; bytesTransferred: string }>;

  /** Make proxied request via A2A */
  proxyRequest(
    url: string,
    options?: ProxyRequestOptions,
  ): Promise<ProxyResult>;

  /** Get contribution status via A2A */
  getContribution(): Promise<ContributionStatus>;
}

export interface VPNAgentCard {
  name: string;
  description: string;
  url: string;
  skills: Array<{
    id: string;
    name: string;
    description: string;
    paymentRequired: boolean;
  }>;
}

export interface VPNConnectionResult {
  connectionId: string;
  endpoint: string;
  publicKey: string;
  countryCode: string;
}

export interface ProxyRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  countryCode?: string;
  paymentHeader?: string;
}

export interface ProxyResult {
  status: number;
  body: string;
  exitNode?: string;
  latencyMs?: number;
}

export interface ContributionStatus {
  bytesUsed: string;
  bytesContributed: string;
  quotaRemaining: string;
}

/**
 * Create A2A client for VPN agent
 */
export function createVPNAgentClient(
  endpoint: string,
  wallet: { address: string; signMessage: (msg: string) => Promise<string> },
): VPNAgentClient {
  // Use atomic counter pattern to avoid race conditions
  let messageCounter = 0;
  const getNextMessageId = (): number => {
    return ++messageCounter;
  };

  async function buildAuthHeaders(): Promise<Record<string, string>> {
    const timestamp = Date.now().toString();
    const message = `jeju-vpn:${timestamp}`;
    const signature = await wallet.signMessage(message);

    return {
      "Content-Type": "application/json",
      "x-jeju-address": wallet.address,
      "x-jeju-timestamp": timestamp,
      "x-jeju-signature": signature,
    };
  }

  async function callSkill<T>(
    skillId: string,
    params: Record<string, unknown>,
    paymentHeader?: string,
  ): Promise<T> {
    const headers = await buildAuthHeaders();
    if (paymentHeader) {
      headers["x-payment"] = paymentHeader;
    }

    const msgId = getNextMessageId();
    const messageId = `msg-${msgId}-${Date.now()}`;
    const body = {
      jsonrpc: "2.0",
      method: "message/send",
      params: {
        message: {
          messageId,
          parts: [{ kind: "data", data: { skillId, params } }],
        },
      },
      id: msgId,
    };

    const response = await fetch(`${endpoint}/a2a`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const rawData: unknown = await response.json();
    const result = VPNA2AResultSchema.parse(rawData);

    if (result.error) {
      throw new Error(
        `A2A error ${result.error.code}: ${result.error.message}`,
      );
    }

    if (!result.result) {
      throw new Error("VPN A2A call returned no result");
    }
    const dataPart = result.result.parts.find((p) => p.kind === "data");
    if (!dataPart || dataPart.data === undefined) {
      throw new Error("VPN A2A call returned no data");
    }
    return dataPart.data as T;
  }

  return {
    async discover(): Promise<VPNAgentCard> {
      const response = await fetch(`${endpoint}/.well-known/agent-card.json`);
      return response.json();
    },

    async connect(
      countryCode?: string,
      protocol?: string,
    ): Promise<VPNConnectionResult> {
      return callSkill("vpn_connect", { countryCode, protocol });
    },

    async disconnect(
      connectionId: string,
    ): Promise<{ success: boolean; bytesTransferred: string }> {
      return callSkill("vpn_disconnect", { connectionId });
    },

    async proxyRequest(
      url: string,
      options?: ProxyRequestOptions,
    ): Promise<ProxyResult> {
      return callSkill(
        "proxy_request",
        {
          url,
          method: options?.method,
          headers: options?.headers,
          body: options?.body,
          countryCode: options?.countryCode,
        },
        options?.paymentHeader,
      );
    },

    async getContribution(): Promise<ContributionStatus> {
      return callSkill("get_contribution", {});
    },
  };
}
