/**
 * Alert Service - Handles alert posting, ACK processing, and escalation
 */

import {
  type Alert,
  type AlertCategory,
  type AlertSeverity,
  createAlert,
  formatAck,
  formatAlert,
  parseAck,
} from '@jejunetwork/shared'
import { getAlertStore } from './alert-store'

export interface PostAlertParams {
  severity: AlertSeverity
  category: AlertCategory
  source: string
  message: string
  roomId: string
  metadata?: Record<string, unknown>
}

class AlertService {
  private escalationIntervalId: ReturnType<typeof setInterval> | null = null
  private escalationIntervalMs = 60_000 // Check every minute
  private postToRoom:
    | ((
        roomId: string,
        agentId: string,
        content: string,
        action?: string,
      ) => Promise<void>)
    | null = null

  /**
   * Set the function to post messages to rooms.
   * This is injected from the autonomous runner.
   */
  setPostToRoom(
    fn: (
      roomId: string,
      agentId: string,
      content: string,
      action?: string,
    ) => Promise<void>,
  ): void {
    this.postToRoom = fn
  }

  /**
   * Post a new alert.
   */
  async postAlert(params: PostAlertParams): Promise<Alert> {
    const alert = createAlert(params)
    const store = getAlertStore()

    store.addAlert(alert)

    if (this.postToRoom) {
      const formattedMessage = formatAlert(alert)
      await this.postToRoom(
        params.roomId,
        params.source,
        formattedMessage,
        'ALERT',
      )
    }

    console.log('[AlertService] Alert posted', {
      id: alert.id,
      severity: alert.severity,
      category: alert.category,
    })

    return alert
  }

  /**
   * Process a message to check for ACK patterns.
   */
  processMessageForAck(content: string, agentId: string): boolean {
    const ack = parseAck(content)
    if (!ack) return false

    const store = getAlertStore()
    const success = store.acknowledgeAlert(ack.alertId, agentId)

    if (success) {
      console.log('[AlertService] Alert acknowledged', {
        alertId: ack.alertId,
        by: agentId,
        note: ack.note,
      })
    }

    return success
  }

  /**
   * Start the escalation checker loop.
   */
  startEscalationLoop(): void {
    if (this.escalationIntervalId) return

    this.escalationIntervalId = setInterval(
      () => this.checkAndEscalate(),
      this.escalationIntervalMs,
    )

    console.log('[AlertService] Escalation loop started')
  }

  /**
   * Stop the escalation loop.
   */
  stopEscalationLoop(): void {
    if (this.escalationIntervalId) {
      clearInterval(this.escalationIntervalId)
      this.escalationIntervalId = null
      console.log('[AlertService] Escalation loop stopped')
    }
  }

  /**
   * Check for alerts needing escalation and re-post them.
   */
  private async checkAndEscalate(): Promise<void> {
    const store = getAlertStore()
    const alertsToEscalate = store.getAlertsForEscalation()

    if (alertsToEscalate.length === 0) return

    console.log('[AlertService] Escalating alerts', {
      count: alertsToEscalate.length,
    })

    for (const alert of alertsToEscalate) {
      const escalationPrefix = `[ESCALATION #${alert.escalationCount + 1}] `
      const escalatedAlert = {
        ...alert,
        message: escalationPrefix + alert.message,
      }

      if (this.postToRoom) {
        await this.postToRoom(
          alert.roomId,
          'system',
          formatAlert(escalatedAlert),
          'ESCALATE',
        )
      }

      store.markEscalated(alert.id)

      console.log('[AlertService] Alert escalated', {
        id: alert.id,
        severity: alert.severity,
        escalationCount: alert.escalationCount + 1,
      })
    }
  }

  /**
   * Get formatted ACK message for an alert.
   */
  getAckMessage(alertId: string, note?: string): string {
    return formatAck(alertId, note)
  }

  /**
   * Get alert statistics.
   */
  getStats() {
    return getAlertStore().getStats()
  }

  /**
   * Get unacknowledged alerts.
   */
  getUnacknowledgedAlerts() {
    return getAlertStore().getUnacknowledgedAlerts()
  }

  /**
   * Get a specific alert.
   */
  getAlert(alertId: string) {
    return getAlertStore().getAlert(alertId)
  }

  /**
   * Manually acknowledge an alert.
   */
  acknowledgeAlert(alertId: string, acknowledgedBy: string): boolean {
    return getAlertStore().acknowledgeAlert(alertId, acknowledgedBy)
  }
}

let instance: AlertService | null = null

export function getAlertService(): AlertService {
  if (!instance) {
    instance = new AlertService()
  }
  return instance
}

export function resetAlertService(): void {
  if (instance) {
    instance.stopEscalationLoop()
  }
  instance = null
}
