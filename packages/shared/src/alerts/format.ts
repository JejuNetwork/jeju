import { z } from 'zod'
import type { Alert, AlertCategory, AlertSeverity } from './types'
import { SEVERITY_CONFIG } from './types'

const alertMetadataSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
)

type AlertMetadata = z.infer<typeof alertMetadataSchema>

/**
 * Generate a simple unique ID for alerts
 */
function generateAlertId(): string {
  return `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Format an alert for posting to a room.
 */
export function formatAlert(alert: Alert): string {
  const header = `[ALERT | severity=${alert.severity} | id=${alert.id} | source=${alert.source} | ts=${alert.timestamp}]`
  const json = JSON.stringify({
    severity: alert.severity,
    alertId: alert.id,
    source: alert.source,
    category: alert.category,
    requiresAck: alert.requiresAck,
    timestamp: alert.timestamp,
    escalationCount: alert.escalationCount,
  })

  return `${header}\n${alert.message}\n\`\`\`json\n${json}\n\`\`\``
}

/**
 * Parse an alert from a message string.
 */
export function parseAlert(text: string): Partial<Alert> | null {
  const headerPattern =
    /\[ALERT \| severity=(P[0-3]) \| id=(\S+) \| source=(\S+) \| ts=(\d+)\]/
  const match = text.match(headerPattern)

  if (!match) return null

  const severity = match[1]
  const id = match[2]
  const source = match[3]
  const ts = match[4]

  if (
    severity === undefined ||
    id === undefined ||
    source === undefined ||
    ts === undefined
  ) {
    return null
  }

  const jsonPattern = /```json\n(\{[^`]+\})\n```/
  const jsonMatch = text.match(jsonPattern)

  let metadata: AlertMetadata = {}
  const jsonText = jsonMatch ? jsonMatch[1] : undefined
  if (jsonText !== undefined) {
    try {
      const parsed: unknown = JSON.parse(jsonText)
      const parsedMetadata = alertMetadataSchema.safeParse(parsed)
      if (parsedMetadata.success) {
        metadata = parsedMetadata.data
      }
    } catch {}
  }

  const headerEnd = text.indexOf(']') + 1
  const jsonStart = text.indexOf('```json')
  const message =
    jsonStart > 0
      ? text.slice(headerEnd, jsonStart).trim()
      : text.slice(headerEnd).trim()

  return {
    id,
    severity: severity as AlertSeverity,
    source,
    timestamp: parseInt(ts, 10),
    message,
    ...metadata,
  }
}

/**
 * Parse ACK from a message.
 */
export function parseAck(
  text: string,
): { alertId: string; note?: string } | null {
  const pattern = /\[ACK\s+(\S+)(?:\s*\|\s*note=([^\]]+))?\]/i
  const match = text.match(pattern)

  if (!match) return null

  const alertId = match[1]
  if (alertId === undefined) return null

  return {
    alertId,
    note: match[2]?.trim(),
  }
}

/**
 * Create a new alert with generated ID.
 */
export function createAlert(params: {
  severity: AlertSeverity
  category: AlertCategory
  source: string
  message: string
  roomId: string
  metadata?: Record<string, unknown>
}): Alert {
  const id = generateAlertId()
  const config = SEVERITY_CONFIG[params.severity]

  return {
    id,
    severity: params.severity,
    category: params.category,
    source: params.source,
    message: params.message,
    timestamp: Date.now(),
    roomId: params.roomId,
    metadata: params.metadata,
    requiresAck: config.requiresAck,
    escalationCount: 0,
  }
}

/**
 * Format an acknowledgment message.
 */
export function formatAck(alertId: string, note?: string): string {
  return note ? `[ACK ${alertId} | note=${note}]` : `[ACK ${alertId}]`
}
