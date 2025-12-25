/**
 * Plugin Schemas
 * Zod schemas for wallet plugin data validation
 */

import { z } from 'zod'

// Contact Schema
export const ContactSchema = z.object({
  id: z.string(),
  address: z.string(),
  name: z.string(),
  label: z.string().optional(),
  chainIds: z.array(z.number()).default([]),
  createdAt: z.number(),
  updatedAt: z.number(),
  isFavorite: z.boolean(),
  transactionCount: z.number(),
  lastUsed: z.number().optional(),
})

export type Contact = z.infer<typeof ContactSchema>

// Lock Schemas
export const LockStateSchema = z.object({
  isLocked: z.boolean(),
  lockType: z.enum(['password', 'pin', 'biometric']),
  lastActivity: z.number(),
  autoLockTimeout: z.number(),
  failedAttempts: z.number(),
  lockedUntil: z.number().nullable(),
})

export type LockState = z.infer<typeof LockStateSchema>

export const LockConfigSchema = z.object({
  type: z.enum(['password', 'pin', 'biometric']),
  autoLockTimeout: z.number(),
  maxFailedAttempts: z.number(),
  lockoutDuration: z.number(),
})

export type LockConfig = z.infer<typeof LockConfigSchema>

// Backup Schema
export const BackupStateSchema = z.object({
  hasBackedUp: z.boolean(),
  backupVerifiedAt: z.number().nullable(),
  lastReminded: z.number().nullable(),
  reminderDismissed: z.boolean(),
})

export type BackupState = z.infer<typeof BackupStateSchema>

// Edge Config Schema
export const EdgeConfigSchema = z.object({
  enabled: z.boolean(),
  capabilities: z.object({
    storage: z.boolean(),
    compute: z.boolean(),
    relay: z.boolean(),
  }),
  maxStorageMB: z.number(),
  maxBandwidthMBps: z.number(),
})

export type EdgeConfig = z.infer<typeof EdgeConfigSchema>

// Coordinator Message Schema
export const CoordinatorMessageSchema = z.object({
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  timestamp: z.number(),
  signature: z.string().optional(),
})

export type CoordinatorMessage = z.infer<typeof CoordinatorMessageSchema>

// Custom RPC Schema
export const CustomRPCSchema = z.object({
  id: z.string(),
  chainId: z.number(),
  name: z.string(),
  url: z.string(),
  isDefault: z.boolean(),
  isHealthy: z.boolean(),
  latency: z.number().optional(),
  lastChecked: z.number().optional(),
  addedAt: z.number(),
})

export type CustomRPC = z.infer<typeof CustomRPCSchema>

// Custom Chain Schema
export const CustomChainSchema = z.object({
  id: z.number(),
  name: z.string(),
  nativeCurrency: z.object({
    name: z.string(),
    symbol: z.string(),
    decimals: z.number(),
  }),
  rpcUrls: z.array(z.string()),
  blockExplorerUrl: z.string().optional(),
  iconUrl: z.string().optional(),
  isTestnet: z.boolean(),
  addedAt: z.number(),
})

export type CustomChain = z.infer<typeof CustomChainSchema>

// Simulation Result Schema
export const SimulationResultSchema = z.object({
  success: z.boolean(),
  gasEstimate: z.bigint().optional(),
  balanceChanges: z.array(
    z.object({
      token: z.string(),
      symbol: z.string(),
      decimals: z.number(),
      amount: z.bigint(),
      direction: z.enum(['in', 'out']),
    }),
  ),
  approvals: z.array(
    z.object({
      token: z.string(),
      spender: z.string(),
      amount: z.bigint(),
    }),
  ),
  risk: z.object({
    level: z.enum(['safe', 'low', 'medium', 'high', 'critical']),
    warnings: z.array(z.string()),
  }),
  traces: z
    .array(
      z.object({
        type: z.string(),
        from: z.string(),
        to: z.string(),
        value: z.bigint().optional(),
        input: z.string().optional(),
      }),
    )
    .optional(),
})

export type SimulationResultType = z.infer<typeof SimulationResultSchema>
