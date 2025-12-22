/**
 * VPN SDK Module
 *
 * Provides client-side VPN functionality:
 * - Node discovery and selection
 * - Connection management
 * - Contribution tracking
 * - Earnings for providers
 */

import {
  createPublicClient,
  http,
  type Address,
  type PublicClient,
  type WalletClient,
  type Hex,
} from "viem";
import {
  VPN_LEGAL_COUNTRIES,
  type VPNNode,
  type VPNNodeQuery,
  type ContributionQuota,
  type CountryCode,
  type CountryLegalStatus,
} from "@jejunetwork/types";

// ============================================================================
// Configuration
// ============================================================================

export interface VPNSDKConfig {
  rpcUrl: string;
  chainId: number;
  contracts: {
    vpnRegistry: Address;
    vpnBilling?: Address;
  };
  coordinatorUrl?: string;
  defaultCountry?: CountryCode;
}

// ============================================================================
// Contract ABIs
// ============================================================================

const VPN_REGISTRY_ABI = [
  "function getNode(address operator) external view returns (tuple(address operator, bytes2 countryCode, bytes32 regionHash, string endpoint, string wireguardPubKey, uint256 stake, uint256 registeredAt, uint256 lastSeen, tuple(bool supportsWireGuard, bool supportsSOCKS5, bool supportsHTTPConnect, bool servesCDN, bool isVPNExit) capabilities, bool active, uint256 totalBytesServed, uint256 totalSessions, uint256 successfulSessions))",
  "function getActiveExitNodes() external view returns (address[])",
  "function getNodesByCountry(bytes2 countryCode) external view returns (address[])",
  "function getContribution(address user) external view returns (tuple(uint256 vpnBytesUsed, uint256 bytesContributed, uint256 periodStart, uint256 periodEnd))",
  "function hasReachedContributionCap(address user) external view returns (bool)",
  "function getRemainingQuota(address user) external view returns (uint256)",
  "function allowedCountries(bytes2 countryCode) external view returns (bool)",
  "function blockedCountries(bytes2 countryCode) external view returns (bool)",
] as const;

// ============================================================================
// VPN SDK Client
// ============================================================================

export class VPNClient {
  private config: VPNSDKConfig;
  private publicClient: PublicClient;
  private walletClient: WalletClient | null = null;
  private nodesCache: VPNNode[] = [];
  private lastNodesFetch = 0;
  private readonly NODES_CACHE_TTL = 60000; // 1 minute

  constructor(config: VPNSDKConfig) {
    this.config = config;
    this.publicClient = createPublicClient({
      transport: http(config.rpcUrl),
    });
  }

  /**
   * Connect wallet for authenticated operations
   */
  connectWallet(wallet: WalletClient): void {
    this.walletClient = wallet;
  }

  // ============================================================================
  // Node Discovery
  // ============================================================================

  /**
   * Get available VPN exit nodes
   */
  async getNodes(query?: VPNNodeQuery): Promise<VPNNode[]> {
    // Check cache
    if (
      Date.now() - this.lastNodesFetch < this.NODES_CACHE_TTL &&
      this.nodesCache.length > 0
    ) {
      return this.filterNodes(this.nodesCache, query);
    }

    // Get active nodes from contract
    let nodeAddresses: Address[];

    if (query?.countryCode) {
      const countryBytes =
        `0x${Buffer.from(query.countryCode).toString("hex")}` as Hex;
      nodeAddresses = (await this.publicClient.readContract({
        address: this.config.contracts.vpnRegistry,
        abi: VPN_REGISTRY_ABI,
        functionName: "getNodesByCountry",
        args: [countryBytes],
      })) as Address[];
    } else {
      nodeAddresses = (await this.publicClient.readContract({
        address: this.config.contracts.vpnRegistry,
        abi: VPN_REGISTRY_ABI,
        functionName: "getActiveExitNodes",
        args: [],
      })) as Address[];
    }

    // Fetch node details
    const nodes: VPNNode[] = [];
    for (const addr of nodeAddresses) {
      const nodeData = await this.getNodeDetails(addr);
      if (nodeData) {
        nodes.push(nodeData);
      }
    }

    // Update cache
    this.nodesCache = nodes;
    this.lastNodesFetch = Date.now();

    return this.filterNodes(nodes, query);
  }

  /**
   * Get details for a specific node
   */
  async getNodeDetails(address: Address): Promise<VPNNode | null> {
    const node = await this.publicClient.readContract({
      address: this.config.contracts.vpnRegistry,
      abi: VPN_REGISTRY_ABI,
      functionName: "getNode",
      args: [address],
    });

    if (!node) return null;

    const nodeData = node as {
      operator: Address;
      countryCode: Hex;
      regionHash: Hex;
      endpoint: string;
      wireguardPubKey: string;
      stake: bigint;
      registeredAt: bigint;
      lastSeen: bigint;
      capabilities: {
        supportsWireGuard: boolean;
        supportsSOCKS5: boolean;
        supportsHTTPConnect: boolean;
        servesCDN: boolean;
        isVPNExit: boolean;
      };
      active: boolean;
      totalBytesServed: bigint;
      totalSessions: bigint;
      successfulSessions: bigint;
    };

    if (nodeData.registeredAt === BigInt(0)) return null;

    const countryCode = Buffer.from(
      nodeData.countryCode.slice(2),
      "hex",
    ).toString() as CountryCode;

    return {
      nodeId: address as `0x${string}`,
      operator: nodeData.operator as `0x${string}`,
      countryCode,
      regionCode: "", // Would need to decode from regionHash
      endpoint: nodeData.endpoint,
      wireguardPubKey: nodeData.wireguardPubKey,
      port: this.extractPort(nodeData.endpoint),
      nodeType: "datacenter", // Would need additional metadata
      capabilities: [
        ...(nodeData.capabilities.supportsWireGuard
          ? ["wireguard" as const]
          : []),
        ...(nodeData.capabilities.supportsSOCKS5 ? ["socks5" as const] : []),
        ...(nodeData.capabilities.supportsHTTPConnect
          ? ["http_connect" as const]
          : []),
        ...(nodeData.capabilities.servesCDN ? ["cdn" as const] : []),
      ],
      maxBandwidthMbps: 100, // Would need additional metadata
      maxConnections: 100, // Would need additional metadata
      stake: nodeData.stake,
      registeredAt: Number(nodeData.registeredAt),
      status: nodeData.active ? "online" : "offline",
      lastSeen: Number(nodeData.lastSeen),
      totalBytesServed: nodeData.totalBytesServed,
      totalSessions: nodeData.totalSessions,
      successRate:
        nodeData.totalSessions > 0
          ? Number(
              (nodeData.successfulSessions * BigInt(100)) /
                nodeData.totalSessions,
            )
          : 100,
      avgLatencyMs: 0, // Would need to ping
    };
  }

  /**
   * Get the best node based on latency and load
   */
  async getBestNode(countryCode?: CountryCode): Promise<VPNNode | null> {
    const nodes = await this.getNodes({ countryCode });
    if (nodes.length === 0) return null;

    // Score nodes by success rate and recency
    const scoredNodes = nodes.map((node) => ({
      node,
      score:
        node.successRate * 0.5 +
        (100 - (Date.now() - node.lastSeen * 1000) / 60000) * 0.5,
    }));

    scoredNodes.sort((a, b) => b.score - a.score);
    return scoredNodes[0].node;
  }

  // ============================================================================
  // Legal Compliance
  // ============================================================================

  /**
   * Check if a country allows VPN exit nodes
   */
  async isCountryAllowed(countryCode: CountryCode): Promise<boolean> {
    const countryBytes = `0x${Buffer.from(countryCode).toString("hex")}` as Hex;

    const isBlocked = await this.publicClient.readContract({
      address: this.config.contracts.vpnRegistry,
      abi: VPN_REGISTRY_ABI,
      functionName: "blockedCountries",
      args: [countryBytes],
    });

    return !isBlocked;
  }

  /**
   * Get legal status for a country
   */
  getLegalStatus(countryCode: CountryCode): CountryLegalStatus | undefined {
    return VPN_LEGAL_COUNTRIES.find((c) => c.countryCode === countryCode);
  }

  // ============================================================================
  // Contribution Tracking
  // ============================================================================

  /**
   * Get user's contribution quota
   */
  async getContribution(address: Address): Promise<ContributionQuota> {
    const contrib = (await this.publicClient.readContract({
      address: this.config.contracts.vpnRegistry,
      abi: VPN_REGISTRY_ABI,
      functionName: "getContribution",
      args: [address],
    })) as {
      vpnBytesUsed: bigint;
      bytesContributed: bigint;
      periodStart: bigint;
      periodEnd: bigint;
    };

    const cap = contrib.vpnBytesUsed * BigInt(3);
    const remaining =
      cap > contrib.bytesContributed
        ? cap - contrib.bytesContributed
        : BigInt(0);

    const hasReachedCap = await this.publicClient.readContract({
      address: this.config.contracts.vpnRegistry,
      abi: VPN_REGISTRY_ABI,
      functionName: "hasReachedContributionCap",
      args: [address],
    });

    return {
      vpnBytesUsed: contrib.vpnBytesUsed,
      contributionCap: cap,
      bytesContributed: contrib.bytesContributed,
      cdnBytesServed: BigInt(0), // Would need additional tracking
      relayBytesServed: BigInt(0), // Would need additional tracking
      quotaRemaining: remaining,
      isContributing: !hasReachedCap,
      contributionPaused: false, // Client-side state
      periodStart: Number(contrib.periodStart),
      periodEnd: Number(contrib.periodEnd),
    };
  }

  /**
   * Check if user has reached contribution cap
   */
  async hasReachedCap(address: Address): Promise<boolean> {
    return (await this.publicClient.readContract({
      address: this.config.contracts.vpnRegistry,
      abi: VPN_REGISTRY_ABI,
      functionName: "hasReachedContributionCap",
      args: [address],
    })) as boolean;
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private filterNodes(nodes: VPNNode[], query?: VPNNodeQuery): VPNNode[] {
    if (!query) return nodes;

    return nodes
      .filter((node) => {
        if (query.countryCode && node.countryCode !== query.countryCode)
          return false;
        if (query.regionCode && node.regionCode !== query.regionCode)
          return false;
        if (query.capabilities) {
          const hasAll = query.capabilities.every((cap) =>
            node.capabilities.includes(cap),
          );
          if (!hasAll) return false;
        }
        if (
          query.minBandwidthMbps &&
          node.maxBandwidthMbps < query.minBandwidthMbps
        )
          return false;
        if (query.maxLatencyMs && node.avgLatencyMs > query.maxLatencyMs)
          return false;
        return true;
      })
      .slice(0, query.limit ?? 100);
  }

  private extractPort(endpoint: string): number {
    const parts = endpoint.split(":");
    return parts.length > 1 ? parseInt(parts[parts.length - 1]) : 51820;
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createVPNClient(config: VPNSDKConfig): VPNClient {
  return new VPNClient(config);
}

// ============================================================================
// Re-exports
// ============================================================================

// ============================================================================
// x402 Payment Integration
// ============================================================================

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
  const nonce = `${wallet.address}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;

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
  let messageCounter = 0;

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

    const messageId = `msg-${++messageCounter}-${Date.now()}`;
    const body = {
      jsonrpc: "2.0",
      method: "message/send",
      params: {
        message: {
          messageId,
          parts: [{ kind: "data", data: { skillId, params } }],
        },
      },
      id: messageCounter,
    };

    const response = await fetch(`${endpoint}/a2a`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const result = (await response.json()) as {
      jsonrpc: string;
      result?: { parts: Array<{ kind: string; data?: T }> };
      error?: { code: number; message: string };
    };

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

// ============================================================================
// Re-exports
// ============================================================================

export type {
  VPNNode,
  VPNNodeQuery,
  VPNConnection,
  VPNConnectOptions,
  VPNProtocol,
  VPNConnectionStatus,
  ContributionQuota,
  ContributionSettings,
  VPNProviderEarnings,
  CountryCode,
  CountryLegalStatus,
} from "@jejunetwork/types";
