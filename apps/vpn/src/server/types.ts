/**
 * VPN Server Types
 * 
 * Re-exports validated types from schemas and defines additional server-specific types
 */

import type {
  VPNServerConfig,
  VPNPricing,
  VPNNodeState,
  VPNSessionState,
  ContributionState,
} from './schemas';

// Re-export types from schemas
export type {
  VPNServerConfig,
  VPNPricing,
  VPNNodeState,
  VPNSessionState,
  ContributionState,
};

export interface VPNServiceContext {
  config: VPNServerConfig;
  nodes: Map<string, VPNNodeState>;
  sessions: Map<string, VPNSessionState>;
  contributions: Map<string, ContributionState>;
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

