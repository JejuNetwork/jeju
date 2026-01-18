/**
 * POST_ALERT Action
 *
 * Allows agents to post structured alerts with severity levels.
 */

import type {
  Action,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core'
import {
  type AlertCategory,
  type AlertSeverity,
  createAlert,
  formatAlert,
} from '@jejunetwork/shared'

// Parse severity from message text
function parseSeverity(text: string): AlertSeverity {
  if (text.includes('P0') || text.toLowerCase().includes('critical'))
    return 'P0'
  if (text.includes('P1') || text.toLowerCase().includes('high')) return 'P1'
  if (text.includes('P2') || text.toLowerCase().includes('medium')) return 'P2'
  return 'P3'
}

// Parse category from message text
function parseCategory(text: string): AlertCategory {
  if (text.toLowerCase().includes('infra')) return 'infrastructure'
  if (text.toLowerCase().includes('security')) return 'security'
  if (text.toLowerCase().includes('moderation')) return 'moderation'
  if (text.toLowerCase().includes('defi')) return 'defi'
  return 'system'
}

export const postAlertAction: Action = {
  name: 'POST_ALERT',
  description: 'Post a structured alert with severity level (P0-P3)',
  similes: [
    'create alert',
    'raise alert',
    'post warning',
    'escalate issue',
    'report critical',
    'flag problem',
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

    const severity = parseSeverity(text)
    const category = parseCategory(text)
    const agentId = runtime.agentId ?? 'unknown'

    // Extract the actual alert message (remove severity/category hints)
    const alertMessage =
      text
        .replace(
          /\b(P[0-3]|critical|high|medium|low|infrastructure|security|moderation|defi|system)\b/gi,
          '',
        )
        .replace(/\s+/g, ' ')
        .trim() || text

    const alert = createAlert({
      severity,
      category,
      source: agentId,
      message: alertMessage,
      roomId: 'system-alerts',
    })

    callback?.({
      text: formatAlert(alert),
      content: {
        type: 'alert',
        alert,
      },
    })
  },

  examples: [
    [
      {
        name: 'user',
        content: { text: 'P0 critical: Database connection pool exhausted' },
      },
      {
        name: 'agent',
        content: {
          text: '[ALERT | severity=P0 | id=alert_123 | source=agent | ts=1234567890]\nDatabase connection pool exhausted\n```json\n{"severity":"P0",...}\n```',
        },
      },
    ],
    [
      {
        name: 'user',
        content: {
          text: 'Post P1 high priority alert: API latency exceeding 5 seconds',
        },
      },
      {
        name: 'agent',
        content: {
          text: '[ALERT | severity=P1 | id=alert_456 | source=agent | ts=1234567890]\nAPI latency exceeding 5 seconds\n```json\n{"severity":"P1",...}\n```',
        },
      },
    ],
  ],
}
