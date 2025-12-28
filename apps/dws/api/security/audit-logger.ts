import { createHash, createHmac } from 'node:crypto'
import type { Address } from 'viem'
import { z } from 'zod'

export type AuditCategory =
  | 'auth'
  | 'access'
  | 'resource'
  | 'security'
  | 'admin'
  | 'billing'
  | 'data'

export type AuditSeverity = 'low' | 'medium' | 'high' | 'critical'

export type AuditOutcome = 'success' | 'failure' | 'denied' | 'error'

export interface AuditEvent {
  eventId: string
  timestamp: number

  // Actor
  actor: AuditActor

  // Action
  category: AuditCategory
  action: string
  outcome: AuditOutcome
  severity: AuditSeverity

  // Target
  target?: AuditTarget

  // Context
  context: {
    ipAddress?: string
    userAgent?: string
    sessionId?: string
    requestId?: string
    geoLocation?: string
  }

  // Details
  details: Record<string, unknown>
  metadata?: Record<string, string>

  // Integrity
  previousHash?: string
  hash: string
}

export interface AuditActor {
  type: 'user' | 'service' | 'system' | 'api_key'
  id: string
  address?: Address
  name?: string
}

export interface AuditTarget {
  type: string
  id: string
  name?: string
  owner?: Address
}

export interface AuditQuery {
  actorId?: string
  actorAddress?: Address
  category?: AuditCategory[]
  action?: string[]
  outcome?: AuditOutcome[]
  severity?: AuditSeverity[]
  targetType?: string
  targetId?: string
  startTime?: number
  endTime?: number
  search?: string
  limit?: number
  offset?: number
}

export interface ComplianceReport {
  reportId: string
  type: 'soc2' | 'gdpr' | 'hipaa' | 'pci' | 'custom'
  period: {
    start: number
    end: number
  }
  generated: number

  // Stats
  totalEvents: number
  eventsByCategory: Record<AuditCategory, number>
  eventsByOutcome: Record<AuditOutcome, number>
  eventsBySeverity: Record<AuditSeverity, number>

  // Issues
  issues: Array<{
    severity: AuditSeverity
    category: string
    description: string
    eventIds: string[]
  }>

  // Summary
  complianceScore: number
  recommendations: string[]
}

export interface RetentionPolicy {
  category: AuditCategory
  retentionDays: number
  archiveAfterDays?: number
}

// ============================================================================
// Schemas
// ============================================================================

export const LogAuditEventSchema = z.object({
  category: z.enum([
    'auth',
    'access',
    'resource',
    'security',
    'admin',
    'billing',
    'data',
  ]),
  action: z.string().min(1).max(100),
  outcome: z.enum(['success', 'failure', 'denied', 'error']),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('low'),
  target: z
    .object({
      type: z.string(),
      id: z.string(),
      name: z.string().optional(),
    })
    .optional(),
  details: z.record(z.string(), z.unknown()),
  metadata: z.record(z.string(), z.string()).optional(),
})

// ============================================================================
// Audit Logger
// ============================================================================

export class AuditLogger {
  private events: AuditEvent[] = []
  private eventIndex = new Map<string, number>() // eventId -> array index
  private actorIndex = new Map<string, string[]>() // actorId -> eventIds
  private targetIndex = new Map<string, string[]>() // targetId -> eventIds
  private lastHash: string | null = null
  private signingKey: string

  private retentionPolicies: RetentionPolicy[] = [
    { category: 'security', retentionDays: 365, archiveAfterDays: 90 },
    { category: 'auth', retentionDays: 365 },
    { category: 'access', retentionDays: 180 },
    { category: 'admin', retentionDays: 365 },
    { category: 'billing', retentionDays: 2555 }, // 7 years for tax compliance
    { category: 'resource', retentionDays: 90 },
    { category: 'data', retentionDays: 365 },
  ]

  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(signingKey?: string) {
    this.signingKey = signingKey ?? 'default-audit-signing-key'
    this.startCleanupJob()
  }

  // =========================================================================
  // Event Logging
  // =========================================================================

  log(
    actor: AuditActor,
    category: AuditCategory,
    action: string,
    outcome: AuditOutcome,
    options?: {
      severity?: AuditSeverity
      target?: AuditTarget
      context?: AuditEvent['context']
      details?: Record<string, unknown>
      metadata?: Record<string, string>
    },
  ): AuditEvent {
    const eventId = createHash('sha256')
      .update(`${Date.now()}-${actor.id}-${action}-${Math.random()}`)
      .digest('hex')
      .slice(0, 24)

    const event: AuditEvent = {
      eventId,
      timestamp: Date.now(),
      actor,
      category,
      action,
      outcome,
      severity:
        options?.severity ?? this.determineSeverity(category, action, outcome),
      target: options?.target,
      context: options?.context ?? {},
      details: options?.details ?? {},
      metadata: options?.metadata,
      previousHash: this.lastHash ?? undefined,
      hash: '', // Will be set below
    }

    // Calculate integrity hash
    event.hash = this.calculateHash(event)
    this.lastHash = event.hash

    // Store event
    const index = this.events.push(event) - 1
    this.eventIndex.set(eventId, index)

    // Update indexes
    this.updateActorIndex(actor.id, eventId)
    if (options?.target) {
      this.updateTargetIndex(options.target.id, eventId)
    }

    // Log to console for debugging
    const logLevel =
      event.severity === 'critical' || event.severity === 'high'
        ? 'warn'
        : 'log'
    console[logLevel](
      `[Audit] ${event.category}.${event.action} (${event.outcome}) - Actor: ${actor.id}`,
      event.target ? `Target: ${event.target.type}/${event.target.id}` : '',
    )

    return event
  }

  // Convenience methods
  logAuth(
    actor: AuditActor,
    action:
      | 'login'
      | 'logout'
      | 'login_failed'
      | 'mfa_enabled'
      | 'mfa_disabled'
      | 'password_changed'
      | 'api_key_created'
      | 'api_key_revoked'
      | 'session_created'
      | 'session_revoked',
    outcome: AuditOutcome,
    context?: AuditEvent['context'],
    details?: Record<string, unknown>,
  ): AuditEvent {
    return this.log(actor, 'auth', action, outcome, { context, details })
  }

  logAccess(
    actor: AuditActor,
    action:
      | 'granted'
      | 'denied'
      | 'elevated'
      | 'role_assigned'
      | 'role_removed',
    target: AuditTarget,
    outcome: AuditOutcome,
    context?: AuditEvent['context'],
    details?: Record<string, unknown>,
  ): AuditEvent {
    return this.log(actor, 'access', action, outcome, {
      target,
      context,
      details,
    })
  }

  logResource(
    actor: AuditActor,
    action:
      | 'created'
      | 'updated'
      | 'deleted'
      | 'deployed'
      | 'scaled'
      | 'stopped'
      | 'started',
    target: AuditTarget,
    outcome: AuditOutcome,
    context?: AuditEvent['context'],
    details?: Record<string, unknown>,
  ): AuditEvent {
    return this.log(actor, 'resource', action, outcome, {
      target,
      context,
      details,
    })
  }

  logSecurity(
    actor: AuditActor,
    action:
      | 'threat_detected'
      | 'attack_blocked'
      | 'policy_violation'
      | 'suspicious_activity'
      | 'data_exfiltration',
    outcome: AuditOutcome,
    severity: AuditSeverity,
    context?: AuditEvent['context'],
    details?: Record<string, unknown>,
  ): AuditEvent {
    return this.log(actor, 'security', action, outcome, {
      severity,
      context,
      details,
    })
  }

  logAdmin(
    actor: AuditActor,
    action:
      | 'config_changed'
      | 'user_created'
      | 'user_deleted'
      | 'org_created'
      | 'policy_updated'
      | 'backup_created'
      | 'restore_initiated',
    target: AuditTarget,
    outcome: AuditOutcome,
    context?: AuditEvent['context'],
    details?: Record<string, unknown>,
  ): AuditEvent {
    return this.log(actor, 'admin', action, outcome, {
      target,
      context,
      details,
    })
  }

  logData(
    actor: AuditActor,
    action:
      | 'exported'
      | 'imported'
      | 'accessed'
      | 'modified'
      | 'deleted'
      | 'anonymized',
    target: AuditTarget,
    outcome: AuditOutcome,
    context?: AuditEvent['context'],
    details?: Record<string, unknown>,
  ): AuditEvent {
    return this.log(actor, 'data', action, outcome, {
      target,
      context,
      details,
    })
  }

  // =========================================================================
  // Query
  // =========================================================================

  query(q: AuditQuery): { events: AuditEvent[]; total: number } {
    let results = this.events

    if (q.actorId) {
      const eventIds = this.actorIndex.get(q.actorId) ?? []
      results = eventIds
        .map((id) => this.events[this.eventIndex.get(id) ?? -1])
        .filter((e): e is AuditEvent => e !== undefined)
    }

    if (q.actorAddress) {
      results = results.filter((e) => e.actor.address === q.actorAddress)
    }

    if (q.category && q.category.length > 0) {
      results = results.filter((e) => q.category?.includes(e.category))
    }

    if (q.action && q.action.length > 0) {
      results = results.filter((e) => q.action?.includes(e.action))
    }

    if (q.outcome && q.outcome.length > 0) {
      results = results.filter((e) => q.outcome?.includes(e.outcome))
    }

    if (q.severity && q.severity.length > 0) {
      results = results.filter((e) => q.severity?.includes(e.severity))
    }

    if (q.targetType) {
      results = results.filter((e) => e.target?.type === q.targetType)
    }

    if (q.targetId) {
      const eventIds = this.targetIndex.get(q.targetId) ?? []
      const targetEventIds = new Set(eventIds)
      results = results.filter((e) => targetEventIds.has(e.eventId))
    }

    if (q.startTime) {
      results = results.filter((e) => e.timestamp >= (q.startTime ?? 0))
    }

    if (q.endTime) {
      results = results.filter((e) => e.timestamp <= (q.endTime ?? Infinity))
    }

    if (q.search) {
      const search = q.search.toLowerCase()
      results = results.filter(
        (e) =>
          e.action.toLowerCase().includes(search) ||
          e.actor.id.toLowerCase().includes(search) ||
          e.target?.id.toLowerCase().includes(search) ||
          JSON.stringify(e.details).toLowerCase().includes(search),
      )
    }

    const total = results.length
    const offset = q.offset ?? 0
    const limit = q.limit ?? 100

    return {
      events: results.slice(offset, offset + limit),
      total,
    }
  }

  getEvent(eventId: string): AuditEvent | undefined {
    const index = this.eventIndex.get(eventId)
    return index !== undefined ? this.events[index] : undefined
  }

  getEventsByActor(actorId: string, limit = 100): AuditEvent[] {
    const eventIds = this.actorIndex.get(actorId) ?? []
    return eventIds
      .slice(-limit)
      .map((id) => this.events[this.eventIndex.get(id) ?? -1])
      .filter((e): e is AuditEvent => e !== undefined)
  }

  getEventsByTarget(targetId: string, limit = 100): AuditEvent[] {
    const eventIds = this.targetIndex.get(targetId) ?? []
    return eventIds
      .slice(-limit)
      .map((id) => this.events[this.eventIndex.get(id) ?? -1])
      .filter((e): e is AuditEvent => e !== undefined)
  }

  // =========================================================================
  // Integrity Verification
  // =========================================================================

  verifyIntegrity(
    startEventId?: string,
    endEventId?: string,
  ): { valid: boolean; brokenAt?: string } {
    let startIndex = 0
    let endIndex = this.events.length

    if (startEventId) {
      startIndex = this.eventIndex.get(startEventId) ?? 0
    }

    if (endEventId) {
      endIndex = (this.eventIndex.get(endEventId) ?? this.events.length) + 1
    }

    let previousHash: string | null =
      startIndex > 0 ? this.events[startIndex - 1].hash : null

    for (let i = startIndex; i < endIndex; i++) {
      const event = this.events[i]

      // Verify previous hash chain
      if (event.previousHash !== previousHash) {
        return { valid: false, brokenAt: event.eventId }
      }

      // Verify event hash
      const calculatedHash = this.calculateHash(event)
      if (event.hash !== calculatedHash) {
        return { valid: false, brokenAt: event.eventId }
      }

      previousHash = event.hash
    }

    return { valid: true }
  }

  // =========================================================================
  // Compliance Reports
  // =========================================================================

  generateComplianceReport(
    type: ComplianceReport['type'],
    startTime: number,
    endTime: number,
  ): ComplianceReport {
    const reportId = createHash('sha256')
      .update(`${type}-${startTime}-${endTime}-${Date.now()}`)
      .digest('hex')
      .slice(0, 16)

    const events = this.query({
      startTime,
      endTime,
      limit: 1000000, // Get all
    }).events

    // Calculate stats
    const eventsByCategory: Record<AuditCategory, number> = {
      auth: 0,
      access: 0,
      resource: 0,
      security: 0,
      admin: 0,
      billing: 0,
      data: 0,
    }

    const eventsByOutcome: Record<AuditOutcome, number> = {
      success: 0,
      failure: 0,
      denied: 0,
      error: 0,
    }

    const eventsBySeverity: Record<AuditSeverity, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    }

    for (const event of events) {
      eventsByCategory[event.category]++
      eventsByOutcome[event.outcome]++
      eventsBySeverity[event.severity]++
    }

    // Identify issues based on report type
    const issues = this.identifyIssues(events, type)

    // Calculate compliance score
    const complianceScore = this.calculateComplianceScore(events, issues, type)

    // Generate recommendations
    const recommendations = this.generateRecommendations(events, issues, type)

    return {
      reportId,
      type,
      period: { start: startTime, end: endTime },
      generated: Date.now(),
      totalEvents: events.length,
      eventsByCategory,
      eventsByOutcome,
      eventsBySeverity,
      issues,
      complianceScore,
      recommendations,
    }
  }

  private identifyIssues(
    events: AuditEvent[],
    type: ComplianceReport['type'],
  ): ComplianceReport['issues'] {
    const issues: ComplianceReport['issues'] = []

    // Multiple failed login attempts
    const failedLogins = events.filter(
      (e) => e.category === 'auth' && e.action === 'login_failed',
    )

    if (failedLogins.length > 10) {
      issues.push({
        severity: 'high',
        category: 'Authentication',
        description: `${failedLogins.length} failed login attempts detected`,
        eventIds: failedLogins.slice(-10).map((e) => e.eventId),
      })
    }

    // Access denials
    const accessDenials = events.filter((e) => e.outcome === 'denied')
    if (accessDenials.length > 50) {
      issues.push({
        severity: 'medium',
        category: 'Access Control',
        description: `${accessDenials.length} access denials detected`,
        eventIds: accessDenials.slice(-10).map((e) => e.eventId),
      })
    }

    // Security events
    const securityEvents = events.filter(
      (e) =>
        e.category === 'security' &&
        (e.severity === 'high' || e.severity === 'critical'),
    )

    if (securityEvents.length > 0) {
      issues.push({
        severity: 'critical',
        category: 'Security',
        description: `${securityEvents.length} high-severity security events detected`,
        eventIds: securityEvents.map((e) => e.eventId),
      })
    }

    // GDPR-specific checks
    if (type === 'gdpr') {
      const dataExports = events.filter(
        (e) => e.category === 'data' && e.action === 'exported',
      )

      if (dataExports.length > 0) {
        issues.push({
          severity: 'low',
          category: 'Data Privacy',
          description: `${dataExports.length} data exports performed`,
          eventIds: dataExports.map((e) => e.eventId),
        })
      }
    }

    return issues
  }

  private calculateComplianceScore(
    events: AuditEvent[],
    issues: ComplianceReport['issues'],
    _type: ComplianceReport['type'],
  ): number {
    let score = 100

    // Deduct for issues
    for (const issue of issues) {
      switch (issue.severity) {
        case 'critical':
          score -= 20
          break
        case 'high':
          score -= 10
          break
        case 'medium':
          score -= 5
          break
        case 'low':
          score -= 1
          break
      }
    }

    // Deduct for high failure rate
    const failureRate =
      events.filter((e) => e.outcome !== 'success').length / events.length
    if (failureRate > 0.1) score -= 10
    if (failureRate > 0.2) score -= 10

    return Math.max(0, score)
  }

  private generateRecommendations(
    events: AuditEvent[],
    issues: ComplianceReport['issues'],
    type: ComplianceReport['type'],
  ): string[] {
    const recommendations: string[] = []

    // Check for MFA
    const mfaEvents = events.filter(
      (e) => e.category === 'auth' && e.action === 'mfa_enabled',
    )
    if (mfaEvents.length === 0) {
      recommendations.push('Consider enabling MFA for all users')
    }

    // Check for regular backups
    const backupEvents = events.filter(
      (e) => e.category === 'admin' && e.action === 'backup_created',
    )
    if (backupEvents.length < 7) {
      recommendations.push('Increase backup frequency to daily')
    }

    // Issue-specific recommendations
    for (const issue of issues) {
      if (issue.category === 'Authentication' && issue.severity === 'high') {
        recommendations.push('Implement rate limiting on login attempts')
        recommendations.push(
          'Consider implementing account lockout after failed attempts',
        )
      }

      if (issue.category === 'Security') {
        recommendations.push(
          'Review security policies and update firewall rules',
        )
        recommendations.push('Conduct a security audit')
      }
    }

    // Type-specific recommendations
    if (type === 'gdpr') {
      recommendations.push(
        'Ensure data processing agreements are in place with all vendors',
      )
      recommendations.push('Review data retention policies')
    }

    if (type === 'soc2') {
      recommendations.push('Document all security controls')
      recommendations.push('Conduct regular vulnerability assessments')
    }

    return [...new Set(recommendations)] // Remove duplicates
  }

  // =========================================================================
  // Export
  // =========================================================================

  export(query: AuditQuery, format: 'json' | 'csv'): string {
    const { events } = this.query(query)

    if (format === 'json') {
      return JSON.stringify(events, null, 2)
    }

    // CSV format
    const headers = [
      'eventId',
      'timestamp',
      'category',
      'action',
      'outcome',
      'severity',
      'actorType',
      'actorId',
      'actorAddress',
      'targetType',
      'targetId',
      'ipAddress',
    ]

    const rows = events.map((e) => [
      e.eventId,
      new Date(e.timestamp).toISOString(),
      e.category,
      e.action,
      e.outcome,
      e.severity,
      e.actor.type,
      e.actor.id,
      e.actor.address ?? '',
      e.target?.type ?? '',
      e.target?.id ?? '',
      e.context.ipAddress ?? '',
    ])

    return [
      headers.join(','),
      ...rows.map((r) =>
        r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','),
      ),
    ].join('\n')
  }

  // =========================================================================
  // Cleanup
  // =========================================================================

  private startCleanupJob(): void {
    // Run daily
    this.cleanupInterval = setInterval(
      () => {
        this.cleanupExpiredEvents()
      },
      24 * 60 * 60 * 1000,
    )
  }

  private cleanupExpiredEvents(): void {
    const now = Date.now()
    const retentionByCategory = new Map(
      this.retentionPolicies.map((p) => [p.category, p.retentionDays]),
    )

    let removed = 0

    // Find events to remove
    const toRemove: number[] = []
    for (let i = 0; i < this.events.length; i++) {
      const event = this.events[i]
      const retentionDays = retentionByCategory.get(event.category) ?? 90
      const expiresAt = event.timestamp + retentionDays * 24 * 60 * 60 * 1000

      if (expiresAt < now) {
        toRemove.push(i)
      }
    }

    // Remove from end to preserve indexes
    for (let i = toRemove.length - 1; i >= 0; i--) {
      const index = toRemove[i]
      const event = this.events[index]

      this.eventIndex.delete(event.eventId)
      this.events.splice(index, 1)
      removed++
    }

    if (removed > 0) {
      // Rebuild indexes
      this.rebuildIndexes()
      console.log(`[AuditLogger] Cleaned up ${removed} expired events`)
    }
  }

  private rebuildIndexes(): void {
    this.eventIndex.clear()
    this.actorIndex.clear()
    this.targetIndex.clear()

    for (let i = 0; i < this.events.length; i++) {
      const event = this.events[i]
      this.eventIndex.set(event.eventId, i)
      this.updateActorIndex(event.actor.id, event.eventId)
      if (event.target) {
        this.updateTargetIndex(event.target.id, event.eventId)
      }
    }
  }

  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private calculateHash(event: AuditEvent): string {
    const data = JSON.stringify({
      eventId: event.eventId,
      timestamp: event.timestamp,
      actor: event.actor,
      category: event.category,
      action: event.action,
      outcome: event.outcome,
      severity: event.severity,
      target: event.target,
      context: event.context,
      details: event.details,
      previousHash: event.previousHash,
    })

    return createHmac('sha256', this.signingKey).update(data).digest('hex')
  }

  private determineSeverity(
    category: AuditCategory,
    action: string,
    outcome: AuditOutcome,
  ): AuditSeverity {
    // Security events are high severity by default
    if (category === 'security') return 'high'

    // Failed admin actions are high
    if (category === 'admin' && outcome === 'failure') return 'high'

    // Auth failures can be medium
    if (category === 'auth' && outcome === 'failure') return 'medium'

    // Resource deletions are medium
    if (action === 'deleted') return 'medium'

    return 'low'
  }

  private updateActorIndex(actorId: string, eventId: string): void {
    const eventIds = this.actorIndex.get(actorId) ?? []
    eventIds.push(eventId)
    this.actorIndex.set(actorId, eventIds)
  }

  private updateTargetIndex(targetId: string, eventId: string): void {
    const eventIds = this.targetIndex.get(targetId) ?? []
    eventIds.push(eventId)
    this.targetIndex.set(targetId, eventIds)
  }

  // =========================================================================
  // Stats
  // =========================================================================

  getStats(): {
    totalEvents: number
    eventsByCategory: Record<AuditCategory, number>
    eventsLast24h: number
    eventsLast7d: number
  } {
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000

    const eventsByCategory: Record<AuditCategory, number> = {
      auth: 0,
      access: 0,
      resource: 0,
      security: 0,
      admin: 0,
      billing: 0,
      data: 0,
    }

    let eventsLast24h = 0
    let eventsLast7d = 0

    for (const event of this.events) {
      eventsByCategory[event.category]++

      if (event.timestamp > now - day) eventsLast24h++
      if (event.timestamp > now - 7 * day) eventsLast7d++
    }

    return {
      totalEvents: this.events.length,
      eventsByCategory,
      eventsLast24h,
      eventsLast7d,
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

let auditLogger: AuditLogger | null = null

export function getAuditLogger(): AuditLogger {
  if (!auditLogger) {
    const signingKey = process.env.AUDIT_SIGNING_KEY
    auditLogger = new AuditLogger(signingKey)
  }
  return auditLogger
}
