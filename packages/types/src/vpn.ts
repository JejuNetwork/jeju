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
export const CountryLegalStatusSchema = z.object({
  countryCode: CountryCodeSchema,
  vpnLegal: z.boolean(),
  canBeExitNode: z.boolean(),
  canBeClient: z.boolean(),
  requiresExtraConsent: z.boolean(),
  notes: z.string(),
});
export type CountryLegalStatus = z.infer<typeof CountryLegalStatusSchema>;

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

import { HexSchema } from './validation';

/**
 * VPN node registered on-chain
 */
export const VPNNodeSchema = z.object({
  // Identity
  nodeId: HexSchema,
  operator: HexSchema,
  agentId: z.bigint().optional(),           // ERC-8004 agent ID if registered

  // Location
  countryCode: CountryCodeSchema,
  regionCode: z.string(),         // More specific region (e.g., 'us-east-1')

  // Network
  endpoint: z.string(),           // Public endpoint for connections
  wireguardPubKey: z.string().optional(),   // WireGuard public key
  port: z.number().int().positive(),

  // Capabilities
  nodeType: VPNNodeTypeSchema,
  capabilities: z.array(VPNCapabilitySchema),
  maxBandwidthMbps: z.number().positive(),
  maxConnections: z.number().int().positive(),

  // Staking
  stake: z.bigint(),
  registeredAt: z.number(),

  // Status
  status: VPNNodeStatusSchema,
  lastSeen: z.number(),

  // Metrics
  totalBytesServed: z.bigint(),
  totalSessions: z.bigint(),
  successRate: z.number().min(0).max(100),        // 0-100
  avgLatencyMs: z.number().nonnegative(),
});
export type VPNNode = z.infer<typeof VPNNodeSchema>;

/**
 * Node info for display in UI
 */
export const VPNNodeInfoSchema = z.object({
  node: VPNNodeSchema,
  latencyMs: z.number().nonnegative(),          // Current latency to this node
  load: z.number().min(0).max(100),               // Current load 0-100
  recommended: z.boolean(),       // Algorithm recommends this node
  reputationScore: z.number().min(0).max(100),    // 0-100 based on history
});
export type VPNNodeInfo = z.infer<typeof VPNNodeInfoSchema>;

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
export const ContributionQuotaSchema = z.object({
  // Usage tracking
  vpnBytesUsed: z.bigint(),           // How much VPN data user has consumed
  contributionCap: z.bigint(),         // vpnBytesUsed * 3 = max contribution
  bytesContributed: z.bigint(),        // How much user has contributed

  // Contribution breakdown
  cdnBytesServed: z.bigint(),          // Static assets served
  relayBytesServed: z.bigint(),        // VPN relay traffic (where legal)

  // Status
  quotaRemaining: z.bigint(),          // contributionCap - bytesContributed
  isContributing: z.boolean(),         // Currently sharing resources
  contributionPaused: z.boolean(),     // User manually paused

  // Period
  periodStart: z.number(),             // Timestamp of period start
  periodEnd: z.number(),               // Resets monthly
});
export type ContributionQuota = z.infer<typeof ContributionQuotaSchema>;

/**
 * Contribution settings for user
 */
export const ContributionSettingsSchema = z.object({
  // Auto contribution (default enabled)
  enableAutoContribution: z.boolean(),

  // Bandwidth limits
  maxBandwidthPercent: z.number().min(0).max(100),     // Default 10%, max bandwidth to share
  maxBandwidthMbps: z.number().positive(),        // Absolute cap in Mbps

  // What to share
  shareCDN: z.boolean(),               // Share static asset serving (default true)
  shareVPNRelay: z.boolean(),          // Share VPN relay where legal (default true based on country)

  // Schedule
  enableSchedule: z.boolean(),
  scheduleStart: z.string(),           // e.g., "22:00" - start sharing at 10pm
  scheduleEnd: z.string(),             // e.g., "06:00" - stop at 6am

  // Earning mode (opt-in for more contribution)
  earningModeEnabled: z.boolean(),
  earningBandwidthPercent: z.number().min(0).max(100), // Higher than default when earning
});
export type ContributionSettings = z.infer<typeof ContributionSettingsSchema>;

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
export const VPNConnectOptionsSchema = z.object({
  // Node selection
  nodeId: HexSchema.optional(),     // Specific node to connect to
  countryCode: CountryCodeSchema.optional(),   // Preferred country
  regionCode: z.string().optional(),         // Preferred region

  // Protocol
  protocol: VPNProtocolSchema,

  // Features
  killSwitch: z.boolean(),         // Block traffic if VPN disconnects
  splitTunnel: z.array(z.string()),       // Apps/domains to exclude from VPN
  dns: z.array(z.string()),               // Custom DNS servers

  // Auto-reconnect
  autoReconnect: z.boolean(),
  reconnectAttempts: z.number().int().positive(),
});
export type VPNConnectOptions = z.infer<typeof VPNConnectOptionsSchema>;

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
export const VPNConnectionSchema = z.object({
  // Connection info
  connectionId: z.string(),
  status: VPNConnectionStatusSchema,
  connectedAt: z.number().optional(),
  disconnectedAt: z.number().optional(),

  // Node info
  node: VPNNodeSchema,
  protocol: VPNProtocolSchema,

  // Network
  localIP: z.string().optional(),            // Assigned IP in VPN network
  publicIP: z.string().optional(),           // Exit node's public IP
  latencyMs: z.number().nonnegative(),

  // Stats
  bytesUp: z.bigint(),
  bytesDown: z.bigint(),
  packetsUp: z.bigint(),
  packetsDown: z.bigint(),

  // Error
  error: z.string().optional(),
});
export type VPNConnection = z.infer<typeof VPNConnectionSchema>;

// ============================================================================
// WireGuard Types
// ============================================================================

/**
 * WireGuard peer configuration
 */
export const WireGuardPeerSchema = z.object({
  publicKey: z.string(),
  endpoint: z.string(),            // host:port
  allowedIPs: z.array(z.string()),        // e.g., ['0.0.0.0/0', '::/0']
  persistentKeepalive: z.number().int().positive().optional(), // seconds
});
export type WireGuardPeer = z.infer<typeof WireGuardPeerSchema>;

/**
 * WireGuard interface configuration
 */
export const WireGuardConfigSchema = z.object({
  privateKey: z.string(),
  address: z.array(z.string()),           // e.g., ['10.0.0.2/24']
  dns: z.array(z.string()),
  mtu: z.number().int().positive().optional(),
  peers: z.array(WireGuardPeerSchema),
});
export type WireGuardConfig = z.infer<typeof WireGuardConfigSchema>;

// ============================================================================
// VPN SDK Types
// ============================================================================

export const VPNClientConfigSchema = z.object({
  // Network
  rpcUrl: z.string().url(),
  chainId: z.number().int().positive(),

  // Contracts
  contracts: z.object({
    vpnRegistry: HexSchema,
    vpnBilling: HexSchema,
  }),

  // Discovery
  coordinatorUrl: z.string().url().optional(),     // WebSocket URL for node discovery
  bootstrapNodes: z.array(z.string()).optional(),   // Initial nodes to connect to

  // Defaults
  defaultCountry: CountryCodeSchema.optional(),
  defaultProtocol: VPNProtocolSchema.optional(),
});
export type VPNClientConfig = z.infer<typeof VPNClientConfigSchema>;

/**
 * Node query options
 */
export const VPNNodeQuerySchema = z.object({
  countryCode: CountryCodeSchema.optional(),
  regionCode: z.string().optional(),
  capabilities: z.array(VPNCapabilitySchema).optional(),
  minBandwidthMbps: z.number().positive().optional(),
  maxLatencyMs: z.number().positive().optional(),
  limit: z.number().int().positive().optional(),
});
export type VPNNodeQuery = z.infer<typeof VPNNodeQuerySchema>;

// ============================================================================
// Earnings and Billing
// ============================================================================

/**
 * Pricing for VPN services
 */
export const VPNPricingSchema = z.object({
  // Client costs (for paid tier)
  pricePerGBClient: z.bigint(),
  pricePerHourClient: z.bigint(),

  // Provider earnings
  providerSharePercent: z.number().min(0).max(100),    // 85%
  protocolFeePercent: z.number().min(0).max(100),      // 10%
  treasuryFeePercent: z.number().min(0).max(100),      // 5%

  // Bonus for CDN
  cdnBonusMultiplier: z.number().positive(),      // 1.2x for serving popular assets
});
export type VPNPricing = z.infer<typeof VPNPricingSchema>;

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
export const VPNProviderEarningsSchema = z.object({
  // Period
  periodStart: z.number(),
  periodEnd: z.number(),

  // Earnings breakdown
  vpnRelayEarnings: z.bigint(),
  cdnServingEarnings: z.bigint(),
  totalEarnings: z.bigint(),

  // Stats
  totalBytesServed: z.bigint(),
  totalSessions: z.number().int().nonnegative(),
  uniqueClients: z.number().int().nonnegative(),

  // Pending
  pendingWithdrawal: z.bigint(),
  lastWithdrawal: z.number().optional(),
});
export type VPNProviderEarnings = z.infer<typeof VPNProviderEarningsSchema>;

// ============================================================================
// Events
// ============================================================================

export const VPNNodeRegisteredEventSchema = z.object({
  nodeId: HexSchema,
  operator: HexSchema,
  countryCode: CountryCodeSchema,
  stake: z.bigint(),
  timestamp: z.number(),
});
export type VPNNodeRegisteredEvent = z.infer<typeof VPNNodeRegisteredEventSchema>;

export const VPNSessionStartedEventSchema = z.object({
  sessionId: z.string(),
  clientId: HexSchema,
  nodeId: HexSchema,
  protocol: VPNProtocolSchema,
  timestamp: z.number(),
});
export type VPNSessionStartedEvent = z.infer<typeof VPNSessionStartedEventSchema>;

export const VPNSessionEndedEventSchema = z.object({
  sessionId: z.string(),
  bytesUp: z.bigint(),
  bytesDown: z.bigint(),
  durationSeconds: z.number().nonnegative(),
  successful: z.boolean(),
  timestamp: z.number(),
});
export type VPNSessionEndedEvent = z.infer<typeof VPNSessionEndedEventSchema>;

export const VPNPaymentEventSchema = z.object({
  sessionId: z.string(),
  payer: HexSchema,
  provider: HexSchema,
  amount: z.bigint(),
  timestamp: z.number(),
});
export type VPNPaymentEvent = z.infer<typeof VPNPaymentEventSchema>;

