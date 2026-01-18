import { z } from 'zod'

export type AlertSeverity = 'P0' | 'P1' | 'P2' | 'P3'

export const AlertSeveritySchema = z.enum(['P0', 'P1', 'P2', 'P3'])

export const SEVERITY_CONFIG = {
  P0: {
    name: 'Critical',
    requiresAck: true,
    escalationTimeoutMs: 5 * 60 * 1000,
  },
  P1: { name: 'High', requiresAck: true, escalationTimeoutMs: 15 * 60 * 1000 },
  P2: { name: 'Medium', requiresAck: false, escalationTimeoutMs: 0 },
  P3: { name: 'Low', requiresAck: false, escalationTimeoutMs: 0 },
} as const

export type AlertCategory =
  | 'infrastructure'
  | 'security'
  | 'moderation'
  | 'defi'
  | 'system'

export interface Alert {
  id: string
  severity: AlertSeverity
  category: AlertCategory
  source: string
  message: string
  timestamp: number
  roomId: string
  metadata?: Record<string, unknown>
  requiresAck: boolean
  acknowledgedAt?: number
  acknowledgedBy?: string
  escalationCount: number
  lastEscalatedAt?: number
}

export const AlertSchema = z.object({
  id: z.string(),
  severity: AlertSeveritySchema,
  category: z.enum([
    'infrastructure',
    'security',
    'moderation',
    'defi',
    'system',
  ]),
  source: z.string(),
  message: z.string(),
  timestamp: z.number(),
  roomId: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  requiresAck: z.boolean(),
  acknowledgedAt: z.number().optional(),
  acknowledgedBy: z.string().optional(),
  escalationCount: z.number(),
  lastEscalatedAt: z.number().optional(),
})
