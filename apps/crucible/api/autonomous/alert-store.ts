/**
 * Alert Store - In-memory tracking of alerts with escalation logic
 */

import type { Alert } from '@jejunetwork/shared'

export interface AlertStoreConfig {
  maxAlerts: number
  alertTtlMs: number
}

const DEFAULT_CONFIG: AlertStoreConfig = {
  maxAlerts: 500,
  alertTtlMs: 24 * 60 * 60 * 1000, // 24 hours
}

export interface AlertStoreStats {
  totalAlerts: number
  unacknowledged: number
  bySeverity: Record<string, number>
  byCategory: Record<string, number>
}

const SEVERITY_ESCALATION_MS: Record<string, number> = {
  P0: 5 * 60 * 1000,   // 5 min
  P1: 15 * 60 * 1000,  // 15 min
  P2: 0,
  P3: 0,
}

class AlertStore {
  private alerts = new Map<string, Alert>()
  private config: AlertStoreConfig

  constructor(config: Partial<AlertStoreConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  addAlert(alert: Alert): void {
    this.evictExpired()
    this.alerts.set(alert.id, alert)

    if (this.alerts.size > this.config.maxAlerts) {
      const oldest = [...this.alerts.entries()]
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0]
      if (oldest) this.alerts.delete(oldest[0])
    }
  }

  getAlert(alertId: string): Alert | undefined {
    return this.alerts.get(alertId)
  }

  acknowledgeAlert(alertId: string, acknowledgedBy: string): boolean {
    const alert = this.alerts.get(alertId)
    if (!alert) return false

    alert.acknowledgedAt = Date.now()
    alert.acknowledgedBy = acknowledgedBy
    return true
  }

  getUnacknowledgedAlerts(): Alert[] {
    return [...this.alerts.values()]
      .filter(a => a.requiresAck && !a.acknowledgedAt)
      .sort((a, b) => a.timestamp - b.timestamp)
  }

  getAlertsForEscalation(): Alert[] {
    const now = Date.now()
    return [...this.alerts.values()].filter(alert => {
      if (alert.acknowledgedAt) return false
      if (!alert.requiresAck) return false

      const timeoutMs = SEVERITY_ESCALATION_MS[alert.severity] ?? 0
      if (!timeoutMs) return false

      const lastTime = alert.lastEscalatedAt ?? alert.timestamp
      return (now - lastTime) >= timeoutMs
    })
  }

  markEscalated(alertId: string): void {
    const alert = this.alerts.get(alertId)
    if (alert) {
      alert.escalationCount++
      alert.lastEscalatedAt = Date.now()
    }
  }

  getStats(): AlertStoreStats {
    const alerts = [...this.alerts.values()]

    const bySeverity: Record<string, number> = {}
    const byCategory: Record<string, number> = {}

    for (const alert of alerts) {
      bySeverity[alert.severity] = (bySeverity[alert.severity] ?? 0) + 1
      byCategory[alert.category] = (byCategory[alert.category] ?? 0) + 1
    }

    return {
      totalAlerts: alerts.length,
      unacknowledged: alerts.filter(a => a.requiresAck && !a.acknowledgedAt).length,
      bySeverity,
      byCategory,
    }
  }

  private evictExpired(): void {
    const cutoff = Date.now() - this.config.alertTtlMs
    for (const [id, alert] of this.alerts) {
      if (alert.timestamp < cutoff) {
        this.alerts.delete(id)
      }
    }
  }
}

let instance: AlertStore | null = null

export function getAlertStore(config?: Partial<AlertStoreConfig>): AlertStore {
  if (!instance) {
    instance = new AlertStore(config)
  }
  return instance
}

export function resetAlertStore(): void {
  instance = null
}
