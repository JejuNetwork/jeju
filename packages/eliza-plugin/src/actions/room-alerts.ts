/**
 * READ_ROOM_ALERTS Action
 *
 * Reads alerts from a coordination room, filtered by time range.
 * Input format: [ACTION: READ_ROOM_ALERTS | room=infra-monitoring | hours=24]
 */

import type {
  Action,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
  UUID,
} from '@elizaos/core'
import { parseAlert, type Alert, type AlertSeverity } from '@jejunetwork/shared'

interface ParsedParams {
  roomId: UUID
  hours: number
}

function parseParams(text: string): ParsedParams | null {
  const roomMatch = text.match(/room=(\S+)/)
  const hoursMatch = text.match(/hours=(\d+)/)

  if (!roomMatch) return null

  return {
    roomId: roomMatch[1] as UUID,
    hours: hoursMatch ? parseInt(hoursMatch[1], 10) : 24,
  }
}

interface AlertsBySeverity {
  P0: Partial<Alert>[]
  P1: Partial<Alert>[]
  P2: Partial<Alert>[]
  P3: Partial<Alert>[]
}

function groupBySeverity(alerts: Partial<Alert>[]): AlertsBySeverity {
  const grouped: AlertsBySeverity = { P0: [], P1: [], P2: [], P3: [] }

  for (const alert of alerts) {
    const severity = alert.severity as AlertSeverity
    if (severity && grouped[severity]) {
      grouped[severity].push(alert)
    }
  }

  return grouped
}

function formatAlertSummary(alerts: Partial<Alert>[], grouped: AlertsBySeverity): string {
  const lines: string[] = [`**Alerts Found: ${alerts.length}**\n`]

  lines.push('**By Severity:**')
  lines.push(`- P0 (Critical): ${grouped.P0.length}`)
  lines.push(`- P1 (High): ${grouped.P1.length}`)
  lines.push(`- P2 (Medium): ${grouped.P2.length}`)
  lines.push(`- P3 (Low): ${grouped.P3.length}`)
  lines.push('')

  if (grouped.P0.length > 0) {
    lines.push('**P0 Critical Alerts:**')
    for (const alert of grouped.P0) {
      const ts = alert.timestamp ? new Date(alert.timestamp).toISOString() : 'unknown'
      lines.push(`- [${ts}] ${alert.source}: ${alert.message}`)
    }
    lines.push('')
  }

  if (grouped.P1.length > 0) {
    lines.push('**P1 High Priority Alerts:**')
    for (const alert of grouped.P1) {
      const ts = alert.timestamp ? new Date(alert.timestamp).toISOString() : 'unknown'
      lines.push(`- [${ts}] ${alert.source}: ${alert.message}`)
    }
    lines.push('')
  }

  if (grouped.P2.length > 0 || grouped.P3.length > 0) {
    const otherCount = grouped.P2.length + grouped.P3.length
    lines.push(`**Other Alerts:** ${otherCount} (P2: ${grouped.P2.length}, P3: ${grouped.P3.length})`)
  }

  return lines.join('\n')
}

export const readRoomAlertsAction: Action = {
  name: 'READ_ROOM_ALERTS',
  description: 'Read alerts from a coordination room, filtered by time range',
  similes: [
    'read room alerts',
    'get alerts from room',
    'check alerts',
    'list alerts',
    'show alerts',
  ],

  validate: async (_runtime: IAgentRuntime): Promise<boolean> => true,

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const text = (message.content as { text?: string })?.text ?? ''
    const params = parseParams(text)

    if (!params) {
      callback?.({
        text: 'Invalid format. Use: [ACTION: READ_ROOM_ALERTS | room=<room-id> | hours=<number>]',
      })
      return
    }

    callback?.({ text: `Reading alerts from room ${params.roomId} (last ${params.hours} hours)...` })

    const cutoffTime = Date.now() - params.hours * 60 * 60 * 1000

    const memories = await runtime.getMemories({
      roomId: params.roomId,
      count: 100,
      tableName: 'messages',
    })

    const alerts: Partial<Alert>[] = []

    for (const memory of memories) {
      const memoryText = (memory.content as { text?: string })?.text ?? ''
      // Use precise pattern to match structured alert format: [ALERT |
      if (!/\[ALERT \|/.test(memoryText)) continue

      const parsed = parseAlert(memoryText)
      if (!parsed) continue

      // Use parsed timestamp, fall back to memory createdAt
      const alertTime = parsed.timestamp ?? memory.createdAt ?? 0
      if (alertTime >= cutoffTime) {
        // Ensure timestamp is set for sorting/display
        if (!parsed.timestamp) {
          parsed.timestamp = memory.createdAt
        }
        alerts.push(parsed)
      }
    }

    // Sort by timestamp (newest first)
    alerts.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))

    const grouped = groupBySeverity(alerts)

    callback?.({
      text: formatAlertSummary(alerts, grouped),
      content: {
        type: 'room_alerts',
        roomId: params.roomId,
        hours: params.hours,
        totalAlerts: alerts.length,
        bySeverity: {
          P0: grouped.P0.length,
          P1: grouped.P1.length,
          P2: grouped.P2.length,
          P3: grouped.P3.length,
        },
        alerts,
      },
    })
  },

  examples: [
    [
      {
        name: 'user',
        content: { text: '[ACTION: READ_ROOM_ALERTS | room=infra-monitoring | hours=24]' },
      },
      {
        name: 'agent',
        content: {
          text: '**Alerts Found: 3**\n\n**By Severity:**\n- P0 (Critical): 1\n- P1 (High): 2\n- P2 (Medium): 0\n- P3 (Low): 0',
        },
      },
    ],
    [
      {
        name: 'user',
        content: { text: '[ACTION: READ_ROOM_ALERTS | room=security-alerts | hours=6]' },
      },
      {
        name: 'agent',
        content: {
          text: '**Alerts Found: 0**\n\n**By Severity:**\n- P0 (Critical): 0\n- P1 (High): 0\n- P2 (Medium): 0\n- P3 (Low): 0',
        },
      },
    ],
  ],
}
