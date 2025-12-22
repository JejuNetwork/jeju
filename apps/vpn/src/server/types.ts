/**
 * VPN Server Types
 *
 * Re-exports validated types from schemas and defines additional server-specific types
 */

import type {
  ContributionState,
  VPNNodeState,
  VPNPricing,
  VPNServerConfig,
  VPNSessionState,
} from './schemas'

// Re-export types from schemas
export type {
  VPNServerConfig,
  VPNPricing,
  VPNNodeState,
  VPNSessionState,
  ContributionState,
}

export interface VPNServiceContext {
  config: VPNServerConfig
  nodes: Map<string, VPNNodeState>
  sessions: Map<string, VPNSessionState>
  contributions: Map<string, ContributionState>
}
