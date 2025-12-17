/**
 * VPN Server Types
 */

import type { Address } from 'viem';

export interface VPNServerConfig {
  publicUrl: string;
  port: number;
  chainId: number;
  rpcUrl: string;
  coordinatorUrl: string;
  contracts: {
    vpnRegistry: Address;
    vpnBilling: Address;
    x402Facilitator: Address;
  };
  paymentRecipient: Address;
  pricing: VPNPricing;
}

export interface VPNPricing {
  /** Price per GB for paid tier (in wei) */
  pricePerGB: bigint;
  /** Price per hour for persistent VPN (in wei) */
  pricePerHour: bigint;
  /** Price per proxy request (in wei) */
  pricePerRequest: bigint;
  /** Supported payment tokens */
  supportedTokens: Address[];
}

export interface VPNServiceContext {
  config: VPNServerConfig;
  nodes: Map<string, VPNNodeState>;
  sessions: Map<string, VPNSessionState>;
  contributions: Map<string, ContributionState>;
}

export interface VPNNodeState {
  nodeId: string;
  operator: Address;
  countryCode: string;
  endpoint: string;
  wireguardPubKey: string;
  status: 'online' | 'busy' | 'offline';
  activeConnections: number;
  maxConnections: number;
  lastSeen: number;
}

export interface VPNSessionState {
  sessionId: string;
  clientAddress: Address;
  nodeId: string;
  protocol: 'wireguard' | 'socks5' | 'http';
  startTime: number;
  bytesUp: bigint;
  bytesDown: bigint;
  isPaid: boolean;
  paymentAmount: bigint;
}

export interface ContributionState {
  address: Address;
  bytesUsed: bigint;
  bytesContributed: bigint;
  cap: bigint;
  periodStart: number;
  periodEnd: number;
}

export interface ProxyRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  countryCode?: string;
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  exitNode: string;
  latencyMs: number;
}

