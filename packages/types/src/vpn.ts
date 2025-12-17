/**
 * VPN Types for Jeju Decentralized VPN Network
 *
 * Supports:
 * - WireGuard-based system VPN
 * - SOCKS5/HTTP proxy for browser-only mode
 * - Static asset CDN serving
 * - Fair contribution model (3x usage cap)
 * - Region-based legal compliance
 */

import { z } from 'zod';

// ============================================================================
// Country and Region Codes
// ============================================================================

/**
 * ISO 3166-1 alpha-2 country codes for legal compliance
 */
export const CountryCodeSchema = z.enum([
  // Americas
  'US', 'CA', 'MX', 'BR', 'AR', 'CL', 'CO', 'PE',
  // Europe
  'GB', 'DE', 'FR', 'NL', 'CH', 'SE', 'NO', 'FI', 'DK', 'AT', 'BE', 'IE', 'ES', 'IT', 'PT', 'PL', 'CZ', 'RO', 'HU', 'GR', 'IS',
  // Asia Pacific
  'JP', 'KR', 'SG', 'HK', 'TW', 'AU', 'NZ', 'IN', 'TH', 'MY', 'PH', 'ID', 'VN',
  // Middle East & Africa
  'IL', 'ZA', 'NG', 'EG', 'KE',
  // Blocked countries (for type completeness, never used as exit)
  'CN', 'RU', 'IR', 'AE', 'BY', 'OM', 'TM', 'KP',
]);
export type CountryCode = z.infer<typeof CountryCodeSchema>;

/**
 * Legal status for VPN operations in each country
 */
export interface CountryLegalStatus {
  countryCode: CountryCode;
  vpnLegal: boolean;
  canBeExitNode: boolean;
  canBeClient: boolean;
  requiresExtraConsent: boolean;
  notes: string;
}

/**
 * Countries where VPN exit is allowed
 */
export const VPN_LEGAL_COUNTRIES: CountryLegalStatus[] = [
  // Tier 1: Best jurisdictions for exit nodes
  { countryCode: 'NL', vpnLegal: true, canBeExitNode: true, canBeClient: true, requiresExtraConsent: false, notes: 'Strong privacy laws' },
  { countryCode: 'CH', vpnLegal: true, canBeExitNode: true, canBeClient: true, requiresExtraConsent: false, notes: 'Strong privacy laws' },
  { countryCode: 'SE', vpnLegal: true, canBeExitNode: true, canBeClient: true, requiresExtraConsent: false, notes: 'Strong privacy laws' },
  { countryCode: 'IS', vpnLegal: true, canBeExitNode: true, canBeClient: true, requiresExtraConsent: false, notes: 'Strong privacy laws' },

  // Tier 2: Good jurisdictions
  { countryCode: 'US', vpnLegal: true, canBeExitNode: true, canBeClient: true, requiresExtraConsent: false, notes: 'ISP TOS may apply' },
  { countryCode: 'CA', vpnLegal: true, canBeExitNode: true, canBeClient: true, requiresExtraConsent: false, notes: '' },
  { countryCode: 'GB', vpnLegal: true, canBeExitNode: true, canBeClient: true, requiresExtraConsent: false, notes: '' },
  { countryCode: 'DE', vpnLegal: true, canBeExitNode: true, canBeClient: true, requiresExtraConsent: false, notes: 'GDPR applies' },
  { countryCode: 'FR', vpnLegal: true, canBeExitNode: true, canBeClient: true, requiresExtraConsent: false, notes: '' },
  { countryCode: 'JP', vpnLegal: true, canBeExitNode: true, canBeClient: true, requiresExtraConsent: false, notes: '' },
  { countryCode: 'SG', vpnLegal: true, canBeExitNode: true, canBeClient: true, requiresExtraConsent: false, notes: '' },
  { countryCode: 'AU', vpnLegal: true, canBeExitNode: true, canBeClient: true, requiresExtraConsent: true, notes: 'Data retention laws' },

  // Tier 3: Allowed but with caveats
  { countryCode: 'KR', vpnLegal: true, canBeExitNode: true, canBeClient: true, requiresExtraConsent: false, notes: '' },
  { countryCode: 'TW', vpnLegal: true, canBeExitNode: true, canBeClient: true, requiresExtraConsent: false, notes: '' },
  { countryCode: 'HK', vpnLegal: true, canBeExitNode: true, canBeClient: true, requiresExtraConsent: true, notes: 'Evolving legal situation' },
  { countryCode: 'BR', vpnLegal: true, canBeExitNode: true, canBeClient: true, requiresExtraConsent: false, notes: '' },
  { countryCode: 'MX', vpnLegal: true, canBeExitNode: true, canBeClient: true, requiresExtraConsent: false, notes: '' },
  { countryCode: 'IN', vpnLegal: true, canBeExitNode: true, canBeClient: true, requiresExtraConsent: true, notes: 'VPN providers must keep logs' },

  // Blocked countries - VPN illegal or heavily restricted
  { countryCode: 'CN', vpnLegal: false, canBeExitNode: false, canBeClient: false, requiresExtraConsent: false, notes: 'VPN illegal without license' },
  { countryCode: 'RU', vpnLegal: false, canBeExitNode: false, canBeClient: false, requiresExtraConsent: false, notes: 'VPN must be registered' },
  { countryCode: 'IR', vpnLegal: false, canBeExitNode: false, canBeClient: false, requiresExtraConsent: false, notes: 'VPN illegal' },
  { countryCode: 'AE', vpnLegal: false, canBeExitNode: false, canBeClient: false, requiresExtraConsent: false, notes: 'VPN for fraud illegal' },
  { countryCode: 'BY', vpnLegal: false, canBeExitNode: false, canBeClient: false, requiresExtraConsent: false, notes: 'VPN illegal' },
  { countryCode: 'OM', vpnLegal: false, canBeExitNode: false, canBeClient: false, requiresExtraConsent: false, notes: 'VPN illegal for individuals' },
  { countryCode: 'TM', vpnLegal: false, canBeExitNode: false, canBeClient: false, requiresExtraConsent: false, notes: 'VPN illegal' },
  { countryCode: 'KP', vpnLegal: false, canBeExitNode: false, canBeClient: false, requiresExtraConsent: false, notes: 'No internet access' },
];

// ============================================================================
// VPN Node Types
// ============================================================================

export const VPNNodeTypeSchema = z.enum([
  'residential',    // Home user running VPN app
  'datacenter',     // Server in datacenter
  'mobile',         // Mobile device
]);
export type VPNNodeType = z.infer<typeof VPNNodeTypeSchema>;

export const VPNCapabilitySchema = z.enum([
  'wireguard',      // Can handle WireGuard tunnels
  'socks5',         // Can handle SOCKS5 proxy
  'http_connect',   // Can handle HTTP CONNECT proxy
  'cdn',            // Can serve static assets
]);
export type VPNCapability = z.infer<typeof VPNCapabilitySchema>;

export const VPNNodeStatusSchema = z.enum([
  'online',
  'busy',           // At capacity
  'offline',
  'suspended',      // Slashed or under review
]);
export type VPNNodeStatus = z.infer<typeof VPNNodeStatusSchema>;

/**
 * VPN node registered on-chain
 */
export interface VPNNode {
  // Identity
  nodeId: `0x${string}`;
  operator: `0x${string}`;
  agentId?: bigint;           // ERC-8004 agent ID if registered

  // Location
  countryCode: CountryCode;
  regionCode: string;         // More specific region (e.g., 'us-east-1')

  // Network
  endpoint: string;           // Public endpoint for connections
  wireguardPubKey?: string;   // WireGuard public key
  port: number;

  // Capabilities
  nodeType: VPNNodeType;
  capabilities: VPNCapability[];
  maxBandwidthMbps: number;
  maxConnections: number;

  // Staking
  stake: bigint;
  registeredAt: number;

  // Status
  status: VPNNodeStatus;
  lastSeen: number;

  // Metrics
  totalBytesServed: bigint;
  totalSessions: bigint;
  successRate: number;        // 0-100
  avgLatencyMs: number;
}

/**
 * Node info for display in UI
 */
export interface VPNNodeInfo {
  node: VPNNode;
  latencyMs: number;          // Current latency to this node
  load: number;               // Current load 0-100
  recommended: boolean;       // Algorithm recommends this node
  reputationScore: number;    // 0-100 based on history
}

// ============================================================================
// Fair Contribution Model
// ============================================================================

/**
 * Contribution tracking for fair sharing
 *
 * Model: Free VPN that's never limited
 * - Users contribute up to 10% of idle bandwidth
 * - Contribution capped at 3x their VPN usage
 * - Contribution includes: CDN serving + VPN relay (where legal)
 */
export interface ContributionQuota {
  // Usage tracking
  vpnBytesUsed: bigint;           // How much VPN data user has consumed
  contributionCap: bigint;         // vpnBytesUsed * 3 = max contribution
  bytesContributed: bigint;        // How much user has contributed

  // Contribution breakdown
  cdnBytesServed: bigint;          // Static assets served
  relayBytesServed: bigint;        // VPN relay traffic (where legal)

  // Status
  quotaRemaining: bigint;          // contributionCap - bytesContributed
  isContributing: boolean;         // Currently sharing resources
  contributionPaused: boolean;     // User manually paused

  // Period
  periodStart: number;             // Timestamp of period start
  periodEnd: number;               // Resets monthly
}

/**
 * Contribution settings for user
 */
export interface ContributionSettings {
  // Auto contribution (default enabled)
  enableAutoContribution: boolean;

  // Bandwidth limits
  maxBandwidthPercent: number;     // Default 10%, max bandwidth to share
  maxBandwidthMbps: number;        // Absolute cap in Mbps

  // What to share
  shareCDN: boolean;               // Share static asset serving (default true)
  shareVPNRelay: boolean;          // Share VPN relay where legal (default true based on country)

  // Schedule
  enableSchedule: boolean;
  scheduleStart: string;           // e.g., "22:00" - start sharing at 10pm
  scheduleEnd: string;             // e.g., "06:00" - stop at 6am

  // Earning mode (opt-in for more contribution)
  earningModeEnabled: boolean;
  earningBandwidthPercent: number; // Higher than default when earning
}

export const DEFAULT_CONTRIBUTION_SETTINGS: ContributionSettings = {
  enableAutoContribution: true,
  maxBandwidthPercent: 10,
  maxBandwidthMbps: 50,
  shareCDN: true,
  shareVPNRelay: true, // Will be auto-disabled in illegal countries
  enableSchedule: false,
  scheduleStart: '22:00',
  scheduleEnd: '06:00',
  earningModeEnabled: false,
  earningBandwidthPercent: 50,
};

// ============================================================================
// VPN Connection Types
// ============================================================================

export const VPNProtocolSchema = z.enum([
  'wireguard',      // System-wide VPN
  'socks5',         // Browser proxy
  'http',           // HTTP CONNECT proxy
]);
export type VPNProtocol = z.infer<typeof VPNProtocolSchema>;

export const VPNConnectionStatusSchema = z.enum([
  'disconnected',
  'connecting',
  'connected',
  'reconnecting',
  'error',
]);
export type VPNConnectionStatus = z.infer<typeof VPNConnectionStatusSchema>;

/**
 * VPN connection options
 */
export interface VPNConnectOptions {
  // Node selection
  nodeId?: `0x${string}`;     // Specific node to connect to
  countryCode?: CountryCode;   // Preferred country
  regionCode?: string;         // Preferred region

  // Protocol
  protocol: VPNProtocol;

  // Features
  killSwitch: boolean;         // Block traffic if VPN disconnects
  splitTunnel: string[];       // Apps/domains to exclude from VPN
  dns: string[];               // Custom DNS servers

  // Auto-reconnect
  autoReconnect: boolean;
  reconnectAttempts: number;
}

export const DEFAULT_VPN_CONNECT_OPTIONS: VPNConnectOptions = {
  protocol: 'wireguard',
  killSwitch: true,
  splitTunnel: [],
  dns: ['1.1.1.1', '8.8.8.8'],
  autoReconnect: true,
  reconnectAttempts: 5,
};

/**
 * Active VPN connection
 */
export interface VPNConnection {
  // Connection info
  connectionId: string;
  status: VPNConnectionStatus;
  connectedAt?: number;
  disconnectedAt?: number;

  // Node info
  node: VPNNode;
  protocol: VPNProtocol;

  // Network
  localIP?: string;            // Assigned IP in VPN network
  publicIP?: string;           // Exit node's public IP
  latencyMs: number;

  // Stats
  bytesUp: bigint;
  bytesDown: bigint;
  packetsUp: bigint;
  packetsDown: bigint;

  // Error
  error?: string;
}

// ============================================================================
// WireGuard Types
// ============================================================================

/**
 * WireGuard peer configuration
 */
export interface WireGuardPeer {
  publicKey: string;
  endpoint: string;            // host:port
  allowedIPs: string[];        // e.g., ['0.0.0.0/0', '::/0']
  persistentKeepalive?: number; // seconds
}

/**
 * WireGuard interface configuration
 */
export interface WireGuardConfig {
  privateKey: string;
  address: string[];           // e.g., ['10.0.0.2/24']
  dns: string[];
  mtu?: number;
  peers: WireGuardPeer[];
}

// ============================================================================
// VPN SDK Types
// ============================================================================

export interface VPNClientConfig {
  // Network
  rpcUrl: string;
  chainId: number;

  // Contracts
  contracts: {
    vpnRegistry: `0x${string}`;
    vpnBilling: `0x${string}`;
  };

  // Discovery
  coordinatorUrl?: string;     // WebSocket URL for node discovery
  bootstrapNodes?: string[];   // Initial nodes to connect to

  // Defaults
  defaultCountry?: CountryCode;
  defaultProtocol?: VPNProtocol;
}

/**
 * Node query options
 */
export interface VPNNodeQuery {
  countryCode?: CountryCode;
  regionCode?: string;
  capabilities?: VPNCapability[];
  minBandwidthMbps?: number;
  maxLatencyMs?: number;
  limit?: number;
}

// ============================================================================
// Earnings and Billing
// ============================================================================

/**
 * Pricing for VPN services
 */
export interface VPNPricing {
  // Client costs (for paid tier)
  pricePerGBClient: bigint;
  pricePerHourClient: bigint;

  // Provider earnings
  providerSharePercent: number;    // 85%
  protocolFeePercent: number;      // 10%
  treasuryFeePercent: number;      // 5%

  // Bonus for CDN
  cdnBonusMultiplier: number;      // 1.2x for serving popular assets
}

export const DEFAULT_VPN_PRICING: VPNPricing = {
  pricePerGBClient: BigInt('100000000000000'),      // 0.0001 ETH/GB
  pricePerHourClient: BigInt('10000000000000'),     // 0.00001 ETH/hour
  providerSharePercent: 85,
  protocolFeePercent: 10,
  treasuryFeePercent: 5,
  cdnBonusMultiplier: 1.2,
};

/**
 * Provider earnings
 */
export interface VPNProviderEarnings {
  // Period
  periodStart: number;
  periodEnd: number;

  // Earnings breakdown
  vpnRelayEarnings: bigint;
  cdnServingEarnings: bigint;
  totalEarnings: bigint;

  // Stats
  totalBytesServed: bigint;
  totalSessions: number;
  uniqueClients: number;

  // Pending
  pendingWithdrawal: bigint;
  lastWithdrawal?: number;
}

// ============================================================================
// Events
// ============================================================================

export interface VPNNodeRegisteredEvent {
  nodeId: `0x${string}`;
  operator: `0x${string}`;
  countryCode: CountryCode;
  stake: bigint;
  timestamp: number;
}

export interface VPNSessionStartedEvent {
  sessionId: string;
  clientId: `0x${string}`;
  nodeId: `0x${string}`;
  protocol: VPNProtocol;
  timestamp: number;
}

export interface VPNSessionEndedEvent {
  sessionId: string;
  bytesUp: bigint;
  bytesDown: bigint;
  durationSeconds: number;
  successful: boolean;
  timestamp: number;
}

export interface VPNPaymentEvent {
  sessionId: string;
  payer: `0x${string}`;
  provider: `0x${string}`;
  amount: bigint;
  timestamp: number;
}

