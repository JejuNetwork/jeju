/**
 * KMS Monitoring & Alerts
 *
 * Monitors KMS operations for:
 * 1. Bypass attempts (direct private key usage in production)
 * 2. Failed attestation verification
 * 3. Threshold not met for signing
 * 4. Key rotation failures
 * 5. Party availability issues
 * 6. Unusual signing patterns
 *
 * SECURITY: This module should be run alongside the distributed KMS
 * to catch any attempts to circumvent the MPC/TEE protections.
 */

import { createLogger } from '@jejunetwork/shared'

const log = createLogger('kms-monitoring')

// ============ Types ============

export type AlertSeverity = 'info' | 'warning' | 'critical' | 'emergency'
export type AlertType =
  | 'kms_bypass_attempt'
  | 'attestation_failure'
  | 'threshold_not_met'
  | 'rotation_failure'
  | 'party_offline'
  | 'unusual_activity'
  | 'key_compromise_suspected'
  | 'rate_limit_exceeded'

export interface Alert {
  id: string
  type: AlertType
  severity: AlertSeverity
  title: string
  message: string
  timestamp: number
  metadata: Record<string, unknown>
  acknowledged: boolean
  acknowledgedAt?: number
  acknowledgedBy?: string
  resolved: boolean
  resolvedAt?: number
}

export interface AlertRule {
  id: string
  type: AlertType
  condition: AlertCondition
  severity: AlertSeverity
  cooldownMs: number
  enabled: boolean
}

export type AlertCondition =
  | { type: 'count'; threshold: number; windowMs: number }
  | { type: 'rate'; threshold: number; windowMs: number }
  | { type: 'consecutive'; threshold: number }
  | { type: 'immediate' }

export interface MonitoringConfig {
  webhookUrl?: string
  pagerDutyKey?: string
  slackWebhook?: string
  emailRecipients?: string[]
  metricsEndpoint?: string
  alertRules: AlertRule[]
  retentionDays: number
}

export interface KMSEvent {
  type: 'sign' | 'keygen' | 'rotation' | 'attestation' | 'bypass_attempt'
  success: boolean
  keyId?: string
  clusterId?: string
  partyId?: string
  details: Record<string, unknown>
  timestamp: number
}

export interface MonitoringMetrics {
  totalSigningRequests: number
  successfulSigningRequests: number
  failedSigningRequests: number
  bypassAttempts: number
  attestationFailures: number
  partyDowntime: Map<string, number>
  avgSigningLatencyMs: number
  lastRotationTimestamp: Map<string, number>
}

// ============ Default Alert Rules ============

export const DEFAULT_ALERT_RULES: AlertRule[] = [
  {
    id: 'bypass-immediate',
    type: 'kms_bypass_attempt',
    condition: { type: 'immediate' },
    severity: 'emergency',
    cooldownMs: 0, // Always alert
    enabled: true,
  },
  {
    id: 'attestation-consecutive',
    type: 'attestation_failure',
    condition: { type: 'consecutive', threshold: 3 },
    severity: 'critical',
    cooldownMs: 5 * 60 * 1000, // 5 minutes
    enabled: true,
  },
  {
    id: 'threshold-immediate',
    type: 'threshold_not_met',
    condition: { type: 'immediate' },
    severity: 'critical',
    cooldownMs: 60 * 1000, // 1 minute
    enabled: true,
  },
  {
    id: 'rotation-failure',
    type: 'rotation_failure',
    condition: { type: 'consecutive', threshold: 2 },
    severity: 'critical',
    cooldownMs: 10 * 60 * 1000, // 10 minutes
    enabled: true,
  },
  {
    id: 'party-offline',
    type: 'party_offline',
    condition: { type: 'count', threshold: 1, windowMs: 60 * 1000 },
    severity: 'warning',
    cooldownMs: 5 * 60 * 1000, // 5 minutes
    enabled: true,
  },
  {
    id: 'unusual-activity',
    type: 'unusual_activity',
    condition: { type: 'rate', threshold: 100, windowMs: 60 * 1000 },
    severity: 'warning',
    cooldownMs: 5 * 60 * 1000, // 5 minutes
    enabled: true,
  },
]

// ============ KMS Monitor ============

export class KMSMonitor {
  private config: MonitoringConfig
  private alerts: Alert[] = []
  private events: KMSEvent[] = []
  private metrics: MonitoringMetrics
  private lastAlertTime: Map<string, number> = new Map()
  private consecutiveCounts: Map<string, number> = new Map()
  private eventCounts: Map<string, number[]> = new Map()
  private flushInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: MonitoringConfig) {
    this.config = config
    this.metrics = {
      totalSigningRequests: 0,
      successfulSigningRequests: 0,
      failedSigningRequests: 0,
      bypassAttempts: 0,
      attestationFailures: 0,
      partyDowntime: new Map(),
      avgSigningLatencyMs: 0,
      lastRotationTimestamp: new Map(),
    }
  }

  /**
   * Start the monitoring service
   */
  start(): void {
    log.info('Starting KMS monitoring service', {
      rulesEnabled: this.config.alertRules.filter((r) => r.enabled).length,
    })

    // Flush metrics periodically
    this.flushInterval = setInterval(
      () => this.flushMetrics(),
      60000, // Every minute
    )
  }

  /**
   * Stop the monitoring service
   */
  stop(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval)
      this.flushInterval = null
    }
    log.info('KMS monitoring service stopped')
  }

  /**
   * Record a KMS event
   */
  recordEvent(event: KMSEvent): void {
    this.events.push(event)

    // Update metrics
    if (event.type === 'sign') {
      this.metrics.totalSigningRequests++
      if (event.success) {
        this.metrics.successfulSigningRequests++
      } else {
        this.metrics.failedSigningRequests++
      }
    } else if (event.type === 'bypass_attempt') {
      this.metrics.bypassAttempts++
      this.triggerBypassAlert(event)
    } else if (event.type === 'attestation' && !event.success) {
      this.metrics.attestationFailures++
      this.checkAttestationAlert(event)
    } else if (event.type === 'rotation') {
      if (event.clusterId) {
        this.metrics.lastRotationTimestamp.set(event.clusterId, event.timestamp)
      }
      if (!event.success) {
        this.checkRotationAlert(event)
      }
    }

    // Track event counts for rate limiting detection
    this.trackEventCount(event)

    // Prune old events
    this.pruneOldEvents()
  }

  /**
   * Trigger immediate alert for bypass attempt
   *
   * CRITICAL: Any bypass attempt in production should trigger
   * an emergency alert and investigation.
   */
  private triggerBypassAlert(event: KMSEvent): void {
    const alert = this.createAlert({
      type: 'kms_bypass_attempt',
      severity: 'emergency',
      title: 'CRITICAL: KMS Bypass Attempt Detected',
      message:
        'A direct private key usage was detected in a production environment. ' +
        'This bypasses MPC/TEE protections and may indicate a compromised system. ' +
        'Immediate investigation required.',
      metadata: {
        keyId: event.keyId,
        details: event.details,
        stackTrace: event.details.stackTrace,
        environment: event.details.environment,
      },
    })

    this.sendAlert(alert)

    log.error('EMERGENCY: KMS bypass attempt detected', {
      keyId: event.keyId ?? 'unknown',
      details: JSON.stringify(event.details),
    })
  }

  /**
   * Check if attestation failures should trigger alert
   */
  private checkAttestationAlert(event: KMSEvent): void {
    const rule = this.config.alertRules.find(
      (r) => r.type === 'attestation_failure' && r.enabled,
    )
    if (!rule) return

    const countKey = `attestation-${event.partyId}`
    const count = (this.consecutiveCounts.get(countKey) ?? 0) + 1
    this.consecutiveCounts.set(countKey, count)

    if (
      rule.condition.type === 'consecutive' &&
      count >= rule.condition.threshold
    ) {
      if (this.shouldAlert(rule)) {
        const alert = this.createAlert({
          type: 'attestation_failure',
          severity: rule.severity,
          title: 'TEE Attestation Failure',
          message:
            `Party ${event.partyId} has failed attestation ${count} consecutive times. ` +
            'This may indicate a compromised TEE or configuration issue.',
          metadata: {
            partyId: event.partyId,
            consecutiveFailures: count,
            details: event.details,
          },
        })
        this.sendAlert(alert)
      }
    }
  }

  /**
   * Check if rotation failures should trigger alert
   */
  private checkRotationAlert(event: KMSEvent): void {
    const rule = this.config.alertRules.find(
      (r) => r.type === 'rotation_failure' && r.enabled,
    )
    if (!rule) return

    const countKey = `rotation-${event.clusterId}`
    const count = (this.consecutiveCounts.get(countKey) ?? 0) + 1
    this.consecutiveCounts.set(countKey, count)

    if (
      rule.condition.type === 'consecutive' &&
      count >= rule.condition.threshold
    ) {
      if (this.shouldAlert(rule)) {
        const alert = this.createAlert({
          type: 'rotation_failure',
          severity: rule.severity,
          title: 'Key Rotation Failure',
          message:
            `Cluster ${event.clusterId} has failed key rotation ${count} consecutive times. ` +
            'Old key shares may be at risk.',
          metadata: {
            clusterId: event.clusterId,
            consecutiveFailures: count,
            details: event.details,
          },
        })
        this.sendAlert(alert)
      }
    }
  }

  /**
   * Track event count for rate limiting detection
   */
  private trackEventCount(event: KMSEvent): void {
    const key = `${event.type}-${event.keyId ?? 'global'}`
    const now = Date.now()

    let counts = this.eventCounts.get(key)
    if (!counts) {
      counts = []
      this.eventCounts.set(key, counts)
    }

    counts.push(now)

    // Check rate limiting rules
    const rule = this.config.alertRules.find(
      (r) => r.type === 'unusual_activity' && r.enabled,
    )
    if (rule && rule.condition.type === 'rate') {
      const windowStart = now - rule.condition.windowMs
      const recentCounts = counts.filter((t) => t > windowStart)

      if (recentCounts.length > rule.condition.threshold) {
        if (this.shouldAlert(rule)) {
          const alert = this.createAlert({
            type: 'unusual_activity',
            severity: rule.severity,
            title: 'Unusual KMS Activity Detected',
            message:
              `High rate of ${event.type} requests detected: ` +
              `${recentCounts.length} in the last ${rule.condition.windowMs / 1000}s. ` +
              'This may indicate automation abuse or an attack.',
            metadata: {
              eventType: event.type,
              keyId: event.keyId,
              rate: recentCounts.length,
              windowMs: rule.condition.windowMs,
            },
          })
          this.sendAlert(alert)
        }
      }
    }
  }

  /**
   * Record party going offline
   */
  recordPartyOffline(partyId: string): void {
    const downtime = (this.metrics.partyDowntime.get(partyId) ?? 0) + 1
    this.metrics.partyDowntime.set(partyId, downtime)

    const rule = this.config.alertRules.find(
      (r) => r.type === 'party_offline' && r.enabled,
    )
    if (rule && this.shouldAlert(rule)) {
      const alert = this.createAlert({
        type: 'party_offline',
        severity: rule.severity,
        title: 'MPC Party Offline',
        message:
          `Party ${partyId} is offline. ` +
          'If more parties go offline, signing threshold may not be met.',
        metadata: {
          partyId,
          downtimeEvents: downtime,
        },
      })
      this.sendAlert(alert)
    }
  }

  /**
   * Record party back online
   */
  recordPartyOnline(partyId: string): void {
    log.info('Party back online', { partyId })
    // Reset consecutive failure counts
    this.consecutiveCounts.delete(`attestation-${partyId}`)
  }

  /**
   * Reset consecutive count on success
   */
  recordSuccess(type: AlertType, keyId?: string, clusterId?: string): void {
    const countKey =
      type === 'attestation_failure'
        ? `attestation-${keyId}`
        : type === 'rotation_failure'
          ? `rotation-${clusterId}`
          : `${type}-${keyId ?? clusterId ?? 'global'}`

    this.consecutiveCounts.set(countKey, 0)
  }

  /**
   * Check if we should send an alert (cooldown)
   */
  private shouldAlert(rule: AlertRule): boolean {
    const lastAlert = this.lastAlertTime.get(rule.id) ?? 0
    const now = Date.now()

    if (now - lastAlert < rule.cooldownMs) {
      return false
    }

    this.lastAlertTime.set(rule.id, now)
    return true
  }

  /**
   * Create an alert object
   */
  private createAlert(params: {
    type: AlertType
    severity: AlertSeverity
    title: string
    message: string
    metadata: Record<string, unknown>
  }): Alert {
    const alert: Alert = {
      id: crypto.randomUUID(),
      type: params.type,
      severity: params.severity,
      title: params.title,
      message: params.message,
      timestamp: Date.now(),
      metadata: params.metadata,
      acknowledged: false,
      resolved: false,
    }

    this.alerts.push(alert)
    return alert
  }

  /**
   * Send alert to configured destinations
   */
  private async sendAlert(alert: Alert): Promise<void> {
    log.warn('ALERT', {
      type: alert.type,
      severity: alert.severity,
      title: alert.title,
    })

    // Send to webhook
    if (this.config.webhookUrl) {
      await this.sendWebhook(alert)
    }

    // Send to Slack
    if (this.config.slackWebhook) {
      await this.sendSlack(alert)
    }

    // Send to PagerDuty for critical/emergency
    if (
      this.config.pagerDutyKey &&
      ['critical', 'emergency'].includes(alert.severity)
    ) {
      await this.sendPagerDuty(alert)
    }
  }

  private async sendWebhook(alert: Alert): Promise<void> {
    if (!this.config.webhookUrl) return

    try {
      await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alert,
          source: 'kms-monitor',
        }),
      })
    } catch (error) {
      log.error('Failed to send webhook alert', { error: String(error) })
    }
  }

  private async sendSlack(alert: Alert): Promise<void> {
    if (!this.config.slackWebhook) return

    const color =
      alert.severity === 'emergency'
        ? '#ff0000'
        : alert.severity === 'critical'
          ? '#ff6600'
          : alert.severity === 'warning'
            ? '#ffcc00'
            : '#0066ff'

    try {
      await fetch(this.config.slackWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attachments: [
            {
              color,
              title: alert.title,
              text: alert.message,
              fields: [
                { title: 'Type', value: alert.type, short: true },
                { title: 'Severity', value: alert.severity, short: true },
              ],
              ts: Math.floor(alert.timestamp / 1000),
            },
          ],
        }),
      })
    } catch (error) {
      log.error('Failed to send Slack alert', { error: String(error) })
    }
  }

  private async sendPagerDuty(alert: Alert): Promise<void> {
    if (!this.config.pagerDutyKey) return

    const pagerDutySeverity =
      alert.severity === 'emergency'
        ? 'critical'
        : alert.severity === 'critical'
          ? 'error'
          : alert.severity === 'warning'
            ? 'warning'
            : 'info'

    try {
      await fetch('https://events.pagerduty.com/v2/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routing_key: this.config.pagerDutyKey,
          event_action: 'trigger',
          payload: {
            summary: alert.title,
            severity: pagerDutySeverity,
            source: 'kms-monitor',
            custom_details: alert.metadata,
          },
        }),
      })
    } catch (error) {
      log.error('Failed to send PagerDuty alert', { error: String(error) })
    }
  }

  /**
   * Flush metrics to endpoint
   */
  private async flushMetrics(): Promise<void> {
    if (!this.config.metricsEndpoint) return

    try {
      await fetch(this.config.metricsEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timestamp: Date.now(),
          metrics: {
            ...this.metrics,
            partyDowntime: Object.fromEntries(this.metrics.partyDowntime),
            lastRotationTimestamp: Object.fromEntries(
              this.metrics.lastRotationTimestamp,
            ),
          },
        }),
      })
    } catch (error) {
      log.error('Failed to flush metrics', { error: String(error) })
    }
  }

  /**
   * Prune old events
   */
  private pruneOldEvents(): void {
    const cutoff = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000

    this.events = this.events.filter((e) => e.timestamp > cutoff)
    this.alerts = this.alerts.filter((a) => a.timestamp > cutoff)

    // Prune event counts
    for (const [key, counts] of this.eventCounts) {
      const recentCounts = counts.filter((t) => t > cutoff)
      if (recentCounts.length === 0) {
        this.eventCounts.delete(key)
      } else {
        this.eventCounts.set(key, recentCounts)
      }
    }
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId: string, acknowledgedBy: string): void {
    const alert = this.alerts.find((a) => a.id === alertId)
    if (alert) {
      alert.acknowledged = true
      alert.acknowledgedAt = Date.now()
      alert.acknowledgedBy = acknowledgedBy
      log.info('Alert acknowledged', { alertId, acknowledgedBy })
    }
  }

  /**
   * Resolve an alert
   */
  resolveAlert(alertId: string): void {
    const alert = this.alerts.find((a) => a.id === alertId)
    if (alert) {
      alert.resolved = true
      alert.resolvedAt = Date.now()
      log.info('Alert resolved', { alertId })
    }
  }

  /**
   * Get all alerts
   */
  getAlerts(options?: {
    severity?: AlertSeverity
    type?: AlertType
    unresolved?: boolean
    unacknowledged?: boolean
  }): Alert[] {
    let result = [...this.alerts]

    if (options?.severity) {
      result = result.filter((a) => a.severity === options.severity)
    }
    if (options?.type) {
      result = result.filter((a) => a.type === options.type)
    }
    if (options?.unresolved) {
      result = result.filter((a) => !a.resolved)
    }
    if (options?.unacknowledged) {
      result = result.filter((a) => !a.acknowledged)
    }

    return result.sort((a, b) => b.timestamp - a.timestamp)
  }

  /**
   * Get current metrics
   */
  getMetrics(): MonitoringMetrics {
    return { ...this.metrics }
  }
}

/**
 * Create a KMS monitor with default rules
 */
export function createKMSMonitor(
  config: Partial<MonitoringConfig> = {},
): KMSMonitor {
  return new KMSMonitor({
    alertRules: config.alertRules ?? DEFAULT_ALERT_RULES,
    retentionDays: config.retentionDays ?? 30,
    ...config,
  })
}
