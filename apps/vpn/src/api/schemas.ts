/**
 * Zod schemas for VPN frontend API validation
 *
 * All API responses are validated with fail-fast patterns
 */

import { z } from 'zod'

// ============================================================================
// VPN Node Schemas
// ============================================================================

export const VPNNodeCapabilitiesSchema = z
  .object({
    supports_wireguard: z.boolean(),
    supports_socks5: z.boolean(),
    supports_http: z.boolean(),
    serves_cdn: z.boolean(),
    is_vpn_exit: z.boolean(),
  })
  .strict()

export const VPNNodeSchema = z
  .object({
    node_id: z.string().min(1),
    operator: z.string().min(1),
    country_code: z.string().length(2),
    region: z.string().min(1),
    endpoint: z.string().min(1),
    wireguard_pubkey: z.string().min(1),
    latency_ms: z.number().int().nonnegative(),
    load: z.number().int().min(0).max(100),
    reputation: z.number().int().min(0).max(100),
    capabilities: VPNNodeCapabilitiesSchema,
  })
  .strict()

export type VPNNode = z.infer<typeof VPNNodeSchema>

// ============================================================================
// VPN Connection Schemas
// ============================================================================

export const VPNConnectionStatusSchema = z.enum([
  'Disconnected',
  'Connecting',
  'Connected',
  'Reconnecting',
  'Error',
])

export const VPNConnectionSchema = z
  .object({
    connection_id: z.string().min(1),
    status: VPNConnectionStatusSchema,
    node: VPNNodeSchema,
    connected_at: z.number().int().positive().nullable(),
    local_ip: z.string().nullable(),
    public_ip: z.string().nullable(),
    bytes_up: z.number().int().nonnegative(),
    bytes_down: z.number().int().nonnegative(),
    latency_ms: z.number().int().nonnegative(),
  })
  .strict()

export const VPNStatusSchema = z
  .object({
    status: VPNConnectionStatusSchema,
    connection: VPNConnectionSchema.nullable(),
  })
  .strict()

export type VPNStatus = z.infer<typeof VPNStatusSchema>
export type VPNConnection = z.infer<typeof VPNConnectionSchema>

// ============================================================================
// Connection Stats Schemas
// ============================================================================

export const ConnectionStatsSchema = z
  .object({
    bytes_up: z.number().int().nonnegative(),
    bytes_down: z.number().int().nonnegative(),
    packets_up: z.number().int().nonnegative(),
    packets_down: z.number().int().nonnegative(),
    connected_seconds: z.number().int().nonnegative(),
    latency_ms: z.number().int().nonnegative(),
  })
  .strict()

export type ConnectionStats = z.infer<typeof ConnectionStatsSchema>

// ============================================================================
// Contribution Schemas
// ============================================================================

export const ContributionStatusSchema = z
  .object({
    vpn_bytes_used: z.number().int().nonnegative(),
    bytes_contributed: z.number().int().nonnegative(),
    contribution_cap: z.number().int().nonnegative(),
    quota_remaining: z.number().int().nonnegative(),
    is_contributing: z.boolean(),
    is_paused: z.boolean(),
    cdn_bytes_served: z.number().int().nonnegative(),
    relay_bytes_served: z.number().int().nonnegative(),
    period_start: z.number().int().positive(),
    period_end: z.number().int().positive(),
  })
  .strict()
  .refine((data) => data.period_end > data.period_start, {
    error: 'Period end must be after period start',
    path: ['period_end'],
  })
  .refine((data) => data.bytes_contributed <= data.contribution_cap, {
    error: 'Bytes contributed cannot exceed cap',
    path: ['bytes_contributed'],
  })

export const ContributionStatsSchema = z
  .object({
    total_bytes_contributed: z.number().int().nonnegative(),
    total_vpn_bytes_used: z.number().int().nonnegative(),
    contribution_ratio: z.number().nonnegative(),
    tokens_earned: z.number().nonnegative(),
    tokens_pending: z.number().nonnegative(),
    users_helped: z.number().int().nonnegative(),
    cdn_requests_served: z.number().int().nonnegative(),
    uptime_seconds: z.number().int().nonnegative(),
  })
  .strict()

export const ContributionSettingsSchema = z
  .object({
    enabled: z.boolean(),
    max_bandwidth_percent: z.number().min(0).max(100),
    share_cdn: z.boolean(),
    share_vpn_relay: z.boolean(),
    earning_mode: z.boolean(),
    earning_bandwidth_percent: z.number().min(0).max(100),
    schedule_enabled: z.boolean(),
    schedule_start: z.string(),
    schedule_end: z.string(),
  })
  .strict()

export const BandwidthStateSchema = z
  .object({
    total_bandwidth_mbps: z.number().nonnegative(),
    user_usage_mbps: z.number().nonnegative(),
    available_mbps: z.number().nonnegative(),
    contribution_mbps: z.number().nonnegative(),
    contribution_percent: z.number().min(0).max(100),
    is_user_idle: z.boolean(),
    idle_seconds: z.number().int().nonnegative(),
    adaptive_enabled: z.boolean(),
  })
  .strict()

export const DWSStateSchema = z
  .object({
    active: z.boolean(),
    cache_used_mb: z.number().int().nonnegative(),
    bytes_served: z.number().int().nonnegative(),
    requests_served: z.number().int().nonnegative(),
    cached_cids: z.number().int().nonnegative(),
    earnings_wei: z.number().nonnegative(), // Can be large, use number not int
  })
  .strict()

export type ContributionStatus = z.infer<typeof ContributionStatusSchema>
export type ContributionStats = z.infer<typeof ContributionStatsSchema>
export type ContributionSettings = z.infer<typeof ContributionSettingsSchema>
export type BandwidthState = z.infer<typeof BandwidthStateSchema>
export type DWSState = z.infer<typeof DWSStateSchema>

// ============================================================================
// Helper Functions - Re-export from shared
// ============================================================================

export {
  expect,
  expectExists,
  expectValid,
  getExists,
} from '../shared/validation'
