import { z } from 'zod'
import type { Address } from 'viem'
import { AddressSchema } from './validation'

export enum RelayChainType {
  EVM = 'evm',
  Solana = 'solana',
  Bitcoin = 'bitcoin',
  Cosmos = 'cosmos',
}

export const ChainEndpointSchema = z.object({
  chainId: z.number(),
  chainType: z.nativeEnum(RelayChainType),
  endpoint: z.string().url(),
  isActive: z.boolean(),
  isArchive: z.boolean(),
  isWebSocket: z.boolean(),
  blockHeight: z.number(),
  lastUpdated: z.number(),
})
export type ChainEndpoint = z.infer<typeof ChainEndpointSchema>

export const RPCNodeSchema = z.object({
  address: AddressSchema,
  region: z.string(),
  stake: z.string(),
  jejuStake: z.string(),
  registeredAt: z.number(),
  agentId: z.number().optional(),
  isActive: z.boolean(),
  isFrozen: z.boolean(),
  totalRequests: z.number(),
  totalComputeUnits: z.number(),
  totalErrors: z.number(),
  lastSeen: z.number(),
  chains: z.array(ChainEndpointSchema),
})
export type RPCNode = z.infer<typeof RPCNodeSchema>

export const NodePerformanceSchema = z.object({
  uptimeScore: z.number().min(0).max(10000),
  successRate: z.number().min(0).max(10000),
  avgLatencyMs: z.number(),
  lastUpdated: z.number(),
})
export type NodePerformance = z.infer<typeof NodePerformanceSchema>

export const NodeSelectionCriteriaSchema = z.object({
  chainId: z.number(),
  minUptime: z.number().min(0).max(10000).default(5000),
  maxLatencyMs: z.number().optional(),
  requireArchive: z.boolean().default(false),
  requireWebSocket: z.boolean().default(false),
  preferRegion: z.string().optional(),
  excludeNodes: z.array(AddressSchema).default([]),
  maxNodes: z.number().default(10),
})
export type NodeSelectionCriteria = z.infer<typeof NodeSelectionCriteriaSchema>

export const SelectedNodeSchema = z.object({
  address: AddressSchema,
  endpoint: z.string().url(),
  reputationScore: z.number(),
  region: z.string(),
  latencyMs: z.number().optional(),
})
export type SelectedNode = z.infer<typeof SelectedNodeSchema>

export enum BandwidthNodeType {
  Unknown = 0,
  Datacenter = 1,
  Residential = 2,
  Mobile = 3,
}

export const BandwidthNodeSchema = z.object({
  address: AddressSchema,
  nodeType: z.nativeEnum(BandwidthNodeType),
  region: z.string(),
  stake: z.string(),
  registeredAt: z.number(),
  agentId: z.number().optional(),
  isActive: z.boolean(),
  isFrozen: z.boolean(),
  totalBytesShared: z.string(),
  totalSessions: z.number(),
  totalEarnings: z.string(),
  lastClaimTime: z.number(),
})
export type BandwidthNode = z.infer<typeof BandwidthNodeSchema>

export const BandwidthPerformanceSchema = z.object({
  uptimeScore: z.number().min(0).max(10000),
  successRate: z.number().min(0).max(10000),
  avgLatencyMs: z.number(),
  avgBandwidthMbps: z.number(),
  lastUpdated: z.number(),
})
export type BandwidthPerformance = z.infer<typeof BandwidthPerformanceSchema>

export const PendingBandwidthRewardSchema = z.object({
  bytesContributed: z.string(),
  sessionsHandled: z.number(),
  periodStart: z.number(),
  periodEnd: z.number(),
  calculatedReward: z.string(),
  claimed: z.boolean(),
})
export type PendingBandwidthReward = z.infer<typeof PendingBandwidthRewardSchema>

export const BandwidthConfigSchema = z.object({
  enabled: z.boolean(),
  nodeType: z.nativeEnum(BandwidthNodeType),
  maxBandwidthMbps: z.number().min(1).max(10000),
  maxConcurrentConnections: z.number().min(1).max(1000),
  allowedPorts: z.array(z.number()),
  blockedDomains: z.array(z.string()),
  scheduleEnabled: z.boolean().default(false),
  scheduleStart: z.number().optional(),
  scheduleEnd: z.number().optional(),
})
export type BandwidthConfig = z.infer<typeof BandwidthConfigSchema>

export const RPCUsageReportSchema = z.object({
  node: AddressSchema,
  periodStart: z.number(),
  periodEnd: z.number(),
  requests: z.number(),
  computeUnits: z.number(),
  errors: z.number(),
  chainBreakdown: z.record(z.string(), z.number()).optional(),
})
export type RPCUsageReport = z.infer<typeof RPCUsageReportSchema>

export const BandwidthUsageReportSchema = z.object({
  node: AddressSchema,
  periodStart: z.number(),
  periodEnd: z.number(),
  bytesShared: z.string(),
  sessionsHandled: z.number(),
  avgLatencyMs: z.number(),
  peakBandwidthMbps: z.number(),
})
export type BandwidthUsageReport = z.infer<typeof BandwidthUsageReportSchema>

export const QoSCheckResultSchema = z.object({
  node: AddressSchema,
  timestamp: z.number(),
  isReachable: z.boolean(),
  latencyMs: z.number().optional(),
  blockHeight: z.number().optional(),
  errorMessage: z.string().optional(),
  chainId: z.number().optional(),
})
export type QoSCheckResult = z.infer<typeof QoSCheckResultSchema>

export const AggregatedQoSSchema = z.object({
  node: AddressSchema,
  periodStart: z.number(),
  periodEnd: z.number(),
  checksPerformed: z.number(),
  checksSuccessful: z.number(),
  avgLatencyMs: z.number(),
  minLatencyMs: z.number(),
  maxLatencyMs: z.number(),
  uptimePercentage: z.number(),
})
export type AggregatedQoS = z.infer<typeof AggregatedQoSSchema>

export interface RPCRegistryEvents {
  NodeRegistered: { node: Address; region: string; stake: bigint; agentId: bigint }
  ChainEndpointAdded: { node: Address; chainId: bigint; endpoint: string }
  UsageReported: { node: Address; requests: bigint; computeUnits: bigint; errors: bigint }
  PerformanceUpdated: { node: Address; uptime: bigint; successRate: bigint; latency: bigint }
}

export interface BandwidthRewardsEvents {
  NodeRegistered: { node: Address; nodeType: number; region: string; stake: bigint }
  BandwidthReported: { node: Address; bytes: bigint; sessions: bigint }
  RewardsClaimed: { node: Address; amount: bigint; bytes: bigint }
}
