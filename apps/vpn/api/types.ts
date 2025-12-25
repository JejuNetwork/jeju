/** VPN Server Types */

import type { Address } from 'viem'
import type {
  ContributionState,
  VPNNodeState,
  VPNServerConfig,
  VPNSessionState,
} from './schemas'

export type {
  VPNNodeState,
  VPNServerConfig,
  VPNSessionState,
  ContributionState,
}

/** Per-user contribution settings stored server-side */
export interface UserContributionSettings {
  address: Address
  enabled: boolean
  maxBandwidthPercent: number
  shareCDN: boolean
  shareVPNRelay: boolean
  earningMode: boolean
  updatedAt: number
}

export interface VPNServiceContext {
  config: VPNServerConfig
  nodes: Map<string, VPNNodeState>
  sessions: Map<string, VPNSessionState>
  contributions: Map<string, ContributionState>
  contributionSettings: Map<string, UserContributionSettings>
}
