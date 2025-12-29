/**
 * CSAM Report & Transparency Metrics Persistence
 *
 * Uses EQLite for encrypted, GDPR-compliant storage of:
 * - CSAM reports (mandatory retention for legal compliance)
 * - Transparency metrics
 * - User reports
 * - Trusted flagger registrations
 */

import { logger } from '../logger'
import type { Address } from 'viem'
import type { CSAMReport, TrustedFlagger, UserReport } from './reporting'

// Metric entry for transparency reporting
export interface PersistedMetricEntry {
  id: string
  timestamp: number
  contentType: 'image' | 'video' | 'text' | 'file'
  action: 'allow' | 'warn' | 'queue' | 'block' | 'ban' | 'report'
  detectionMethod: 'hash' | 'phash' | 'ai' | 'user_report' | 'trusted_flagger'
  processingTimeMs: number
  csamReported?: boolean
  csamReportTarget?: 'ncmec' | 'iwf' | 'other'
  senderAddress?: string
}

// In-memory fallback (used when EQLite not available)
const inMemoryReports: CSAMReport[] = []
const inMemoryMetrics: PersistedMetricEntry[] = []
const inMemoryUserReports: UserReport[] = []
const inMemoryTrustedFlaggers = new Map<string, TrustedFlagger>()

let db: {
  run: (sql: string, params?: unknown[]) => Promise<void>
  get: <T>(sql: string, params?: unknown[]) => Promise<T | undefined>
  all: <T>(sql: string, params?: unknown[]) => Promise<T[]>
} | null = null

/**
 * Initialize persistence layer
 * Attempts to use EQLite, falls back to in-memory if unavailable
 */
export async function initializePersistence(eqliteDb?: typeof db): Promise<void> {
  if (eqliteDb) {
    db = eqliteDb
    await createTables()
    logger.info('[ModerationPersistence] Using EQLite database')
  } else {
    logger.warn('[ModerationPersistence] No database provided, using in-memory storage (data lost on restart)')
  }
}

async function createTables(): Promise<void> {
  if (!db) return

  // CSAM Reports table
  await db.run(`
    CREATE TABLE IF NOT EXISTS csam_reports (
      report_id TEXT PRIMARY KEY,
      detected_at INTEGER NOT NULL,
      reported_at INTEGER,
      authority_report_id TEXT,
      content_hash TEXT NOT NULL,
      perceptual_hash TEXT,
      content_type TEXT NOT NULL,
      detection_method TEXT NOT NULL,
      confidence REAL NOT NULL,
      uploader_address TEXT,
      uploader_ip TEXT,
      user_agent TEXT,
      location_service TEXT NOT NULL,
      location_path TEXT,
      location_timestamp INTEGER NOT NULL,
      status TEXT NOT NULL,
      error TEXT
    )
  `)

  // Transparency metrics table
  await db.run(`
    CREATE TABLE IF NOT EXISTS moderation_metrics (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      content_type TEXT NOT NULL,
      action TEXT NOT NULL,
      detection_method TEXT NOT NULL,
      processing_time_ms INTEGER NOT NULL,
      csam_reported INTEGER DEFAULT 0,
      csam_report_target TEXT,
      sender_address TEXT
    )
  `)

  // User reports table
  await db.run(`
    CREATE TABLE IF NOT EXISTS user_reports (
      report_id TEXT PRIMARY KEY,
      reporter_address TEXT,
      reporter_ip TEXT,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      evidence TEXT,
      timestamp INTEGER NOT NULL,
      status TEXT NOT NULL,
      reviewed_by TEXT,
      reviewed_at INTEGER,
      action TEXT
    )
  `)

  // Trusted flaggers table
  await db.run(`
    CREATE TABLE IF NOT EXISTS trusted_flaggers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      api_key_hash TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      priority TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      jurisdiction TEXT
    )
  `)

  // Create indexes
  await db.run('CREATE INDEX IF NOT EXISTS idx_csam_reports_status ON csam_reports(status)')
  await db.run('CREATE INDEX IF NOT EXISTS idx_csam_reports_detected ON csam_reports(detected_at)')
  await db.run('CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON moderation_metrics(timestamp)')
  await db.run('CREATE INDEX IF NOT EXISTS idx_user_reports_status ON user_reports(status)')

  logger.info('[ModerationPersistence] Database tables created')
}

// ============ CSAM Reports ============

export async function saveCSAMReport(report: CSAMReport): Promise<void> {
  if (!db) {
    inMemoryReports.push(report)
    return
  }

  await db.run(`
    INSERT INTO csam_reports (
      report_id, detected_at, reported_at, authority_report_id,
      content_hash, perceptual_hash, content_type, detection_method,
      confidence, uploader_address, uploader_ip, user_agent,
      location_service, location_path, location_timestamp, status, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    report.reportId,
    report.detectedAt,
    report.reportedAt ?? null,
    report.authorityReportId ?? null,
    report.contentHash,
    report.perceptualHash ?? null,
    report.contentType,
    report.detectionMethod,
    report.confidence,
    report.uploaderAddress ?? null,
    report.uploaderIp ?? null,
    report.userAgent ?? null,
    report.location.service,
    report.location.path ?? null,
    report.location.timestamp,
    report.status,
    report.error ?? null,
  ])
}

export async function updateCSAMReportStatus(
  reportId: string,
  status: CSAMReport['status'],
  authorityReportId?: string,
  error?: string
): Promise<void> {
  if (!db) {
    const report = inMemoryReports.find(r => r.reportId === reportId)
    if (report) {
      report.status = status
      report.reportedAt = Date.now()
      if (authorityReportId) report.authorityReportId = authorityReportId
      if (error) report.error = error
    }
    return
  }

  await db.run(`
    UPDATE csam_reports SET
      status = ?,
      reported_at = ?,
      authority_report_id = COALESCE(?, authority_report_id),
      error = COALESCE(?, error)
    WHERE report_id = ?
  `, [status, Date.now(), authorityReportId ?? null, error ?? null, reportId])
}

export async function getCSAMReports(filter?: {
  status?: CSAMReport['status']
  startTime?: number
  endTime?: number
  limit?: number
}): Promise<CSAMReport[]> {
  if (!db) {
    let result = [...inMemoryReports]
    if (filter?.status) result = result.filter(r => r.status === filter.status)
    if (filter?.startTime) result = result.filter(r => r.detectedAt >= filter.startTime!)
    if (filter?.endTime) result = result.filter(r => r.detectedAt <= filter.endTime!)
    if (filter?.limit) result = result.slice(0, filter.limit)
    return result
  }

  let sql = 'SELECT * FROM csam_reports WHERE 1=1'
  const params: unknown[] = []

  if (filter?.status) {
    sql += ' AND status = ?'
    params.push(filter.status)
  }
  if (filter?.startTime) {
    sql += ' AND detected_at >= ?'
    params.push(filter.startTime)
  }
  if (filter?.endTime) {
    sql += ' AND detected_at <= ?'
    params.push(filter.endTime)
  }

  sql += ' ORDER BY detected_at DESC'

  if (filter?.limit) {
    sql += ' LIMIT ?'
    params.push(filter.limit)
  }

  const rows = await db.all<{
    report_id: string
    detected_at: number
    reported_at: number | null
    authority_report_id: string | null
    content_hash: string
    perceptual_hash: string | null
    content_type: string
    detection_method: string
    confidence: number
    uploader_address: string | null
    uploader_ip: string | null
    user_agent: string | null
    location_service: string
    location_path: string | null
    location_timestamp: number
    status: string
    error: string | null
  }>(sql, params)

  return rows.map(row => ({
    reportId: row.report_id,
    detectedAt: row.detected_at,
    reportedAt: row.reported_at ?? undefined,
    authorityReportId: row.authority_report_id ?? undefined,
    contentHash: row.content_hash,
    perceptualHash: row.perceptual_hash ?? undefined,
    contentType: row.content_type as CSAMReport['contentType'],
    detectionMethod: row.detection_method as CSAMReport['detectionMethod'],
    confidence: row.confidence,
    uploaderAddress: row.uploader_address as Address | undefined,
    uploaderIp: row.uploader_ip ?? undefined,
    userAgent: row.user_agent ?? undefined,
    location: {
      service: row.location_service,
      path: row.location_path ?? undefined,
      timestamp: row.location_timestamp,
    },
    status: row.status as CSAMReport['status'],
    error: row.error ?? undefined,
  }))
}

export async function getCSAMReportStats(): Promise<{
  total: number
  pending: number
  submitted: number
  acknowledged: number
  failed: number
}> {
  if (!db) {
    const stats = { total: 0, pending: 0, submitted: 0, acknowledged: 0, failed: 0 }
    for (const r of inMemoryReports) {
      stats.total++
      stats[r.status]++
    }
    return stats
  }

  const result = await db.all<{ status: string; count: number }>(`
    SELECT status, COUNT(*) as count FROM csam_reports GROUP BY status
  `)

  const stats = { total: 0, pending: 0, submitted: 0, acknowledged: 0, failed: 0 }
  for (const row of result) {
    const count = row.count
    stats.total += count
    if (row.status in stats) {
      stats[row.status as keyof typeof stats] = count
    }
  }
  return stats
}

// ============ Transparency Metrics ============

export async function saveMetric(entry: Omit<PersistedMetricEntry, 'id'>): Promise<void> {
  const id = crypto.randomUUID()

  if (!db) {
    inMemoryMetrics.push({ id, ...entry })
    // Keep bounded (last 100k entries)
    while (inMemoryMetrics.length > 100000) {
      inMemoryMetrics.shift()
    }
    return
  }

  await db.run(`
    INSERT INTO moderation_metrics (
      id, timestamp, content_type, action, detection_method,
      processing_time_ms, csam_reported, csam_report_target, sender_address
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    entry.timestamp,
    entry.contentType,
    entry.action,
    entry.detectionMethod,
    entry.processingTimeMs,
    entry.csamReported ? 1 : 0,
    entry.csamReportTarget ?? null,
    entry.senderAddress ?? null,
  ])
}

export async function getMetrics(filter: {
  startTime: number
  endTime: number
}): Promise<PersistedMetricEntry[]> {
  if (!db) {
    return inMemoryMetrics.filter(m =>
      m.timestamp >= filter.startTime && m.timestamp <= filter.endTime
    )
  }

  const rows = await db.all<{
    id: string
    timestamp: number
    content_type: string
    action: string
    detection_method: string
    processing_time_ms: number
    csam_reported: number
    csam_report_target: string | null
    sender_address: string | null
  }>(`
    SELECT * FROM moderation_metrics
    WHERE timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp DESC
  `, [filter.startTime, filter.endTime])

  return rows.map(row => ({
    id: row.id,
    timestamp: row.timestamp,
    contentType: row.content_type as PersistedMetricEntry['contentType'],
    action: row.action as PersistedMetricEntry['action'],
    detectionMethod: row.detection_method as PersistedMetricEntry['detectionMethod'],
    processingTimeMs: row.processing_time_ms,
    csamReported: row.csam_reported === 1,
    csamReportTarget: row.csam_report_target as PersistedMetricEntry['csamReportTarget'],
    senderAddress: row.sender_address ?? undefined,
  }))
}

export async function getMetricsSummary(sinceTimestamp: number): Promise<{
  totalProcessed: number
  allowed: number
  warned: number
  queued: number
  blocked: number
  banned: number
  reported: number
  avgProcessingTimeMs: number
}> {
  if (!db) {
    const filtered = inMemoryMetrics.filter(m => m.timestamp >= sinceTimestamp)
    const summary = { totalProcessed: 0, allowed: 0, warned: 0, queued: 0, blocked: 0, banned: 0, reported: 0, avgProcessingTimeMs: 0 }
    let totalTime = 0
    for (const m of filtered) {
      summary.totalProcessed++
      switch (m.action) {
        case 'allow': summary.allowed++; break
        case 'warn': summary.warned++; break
        case 'queue': summary.queued++; break
        case 'block': summary.blocked++; break
        case 'ban': summary.banned++; break
        case 'report': summary.reported++; break
      }
      totalTime += m.processingTimeMs
    }
    if (summary.totalProcessed > 0) {
      summary.avgProcessingTimeMs = Math.round(totalTime / summary.totalProcessed)
    }
    return summary
  }

  const result = await db.get<{
    total: number
    allowed: number
    warned: number
    queued: number
    blocked: number
    banned: number
    reported: number
    avg_time: number
  }>(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN action = 'allow' THEN 1 ELSE 0 END) as allowed,
      SUM(CASE WHEN action = 'warn' THEN 1 ELSE 0 END) as warned,
      SUM(CASE WHEN action = 'queue' THEN 1 ELSE 0 END) as queued,
      SUM(CASE WHEN action = 'block' THEN 1 ELSE 0 END) as blocked,
      SUM(CASE WHEN action = 'ban' THEN 1 ELSE 0 END) as banned,
      SUM(CASE WHEN action = 'report' THEN 1 ELSE 0 END) as reported,
      AVG(processing_time_ms) as avg_time
    FROM moderation_metrics
    WHERE timestamp >= ?
  `, [sinceTimestamp])

  return {
    totalProcessed: result?.total ?? 0,
    allowed: result?.allowed ?? 0,
    warned: result?.warned ?? 0,
    queued: result?.queued ?? 0,
    blocked: result?.blocked ?? 0,
    banned: result?.banned ?? 0,
    reported: result?.reported ?? 0,
    avgProcessingTimeMs: Math.round(result?.avg_time ?? 0),
  }
}

// ============ User Reports ============

export async function saveUserReport(report: UserReport): Promise<void> {
  if (!db) {
    inMemoryUserReports.push(report)
    return
  }

  await db.run(`
    INSERT INTO user_reports (
      report_id, reporter_address, reporter_ip, target_type, target_id,
      category, description, evidence, timestamp, status, reviewed_by, reviewed_at, action
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    report.reportId,
    report.reporterAddress ?? null,
    report.reporterIp ?? null,
    report.targetType,
    report.targetId,
    report.category,
    report.description,
    report.evidence ? JSON.stringify(report.evidence) : null,
    report.timestamp,
    report.status,
    report.reviewedBy ?? null,
    report.reviewedAt ?? null,
    report.action ?? null,
  ])
}

export async function getUserReports(filter?: {
  status?: UserReport['status']
  limit?: number
}): Promise<UserReport[]> {
  if (!db) {
    let result = [...inMemoryUserReports]
    if (filter?.status) result = result.filter(r => r.status === filter.status)
    if (filter?.limit) result = result.slice(0, filter.limit)
    return result
  }

  let sql = 'SELECT * FROM user_reports WHERE 1=1'
  const params: unknown[] = []

  if (filter?.status) {
    sql += ' AND status = ?'
    params.push(filter.status)
  }

  sql += ' ORDER BY timestamp DESC'

  if (filter?.limit) {
    sql += ' LIMIT ?'
    params.push(filter.limit)
  }

  const rows = await db.all<{
    report_id: string
    reporter_address: string | null
    reporter_ip: string | null
    target_type: string
    target_id: string
    category: string
    description: string
    evidence: string | null
    timestamp: number
    status: string
    reviewed_by: string | null
    reviewed_at: number | null
    action: string | null
  }>(sql, params)

  return rows.map(row => ({
    reportId: row.report_id,
    reporterAddress: row.reporter_address as Address | undefined,
    reporterIp: row.reporter_ip ?? undefined,
    targetType: row.target_type as UserReport['targetType'],
    targetId: row.target_id,
    category: row.category as UserReport['category'],
    description: row.description,
    evidence: row.evidence ? JSON.parse(row.evidence) : undefined,
    timestamp: row.timestamp,
    status: row.status as UserReport['status'],
    reviewedBy: row.reviewed_by as Address | undefined,
    reviewedAt: row.reviewed_at ?? undefined,
    action: row.action as UserReport['action'],
  }))
}

export async function updateUserReportStatus(
  reportId: string,
  status: UserReport['status'],
  reviewedBy?: Address,
  action?: UserReport['action']
): Promise<void> {
  if (!db) {
    const report = inMemoryUserReports.find(r => r.reportId === reportId)
    if (report) {
      report.status = status
      report.reviewedAt = Date.now()
      if (reviewedBy) report.reviewedBy = reviewedBy
      if (action) report.action = action
    }
    return
  }

  await db.run(`
    UPDATE user_reports SET
      status = ?,
      reviewed_at = ?,
      reviewed_by = COALESCE(?, reviewed_by),
      action = COALESCE(?, action)
    WHERE report_id = ?
  `, [status, Date.now(), reviewedBy ?? null, action ?? null, reportId])
}

export async function getUserReportStats(): Promise<{
  total: number
  pending: number
  reviewed: number
  actioned: number
  dismissed: number
}> {
  if (!db) {
    const stats = { total: 0, pending: 0, reviewed: 0, actioned: 0, dismissed: 0 }
    for (const r of inMemoryUserReports) {
      stats.total++
      stats[r.status]++
    }
    return stats
  }

  const result = await db.all<{ status: string; count: number }>(`
    SELECT status, COUNT(*) as count FROM user_reports GROUP BY status
  `)

  const stats = { total: 0, pending: 0, reviewed: 0, actioned: 0, dismissed: 0 }
  for (const row of result) {
    stats.total += row.count
    if (row.status in stats) {
      stats[row.status as keyof typeof stats] = row.count
    }
  }
  return stats
}

// ============ Trusted Flaggers ============

async function hashApiKey(apiKey: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(apiKey)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function saveTrustedFlagger(flagger: TrustedFlagger): Promise<void> {
  const apiKeyHash = await hashApiKey(flagger.apiKey)

  if (!db) {
    inMemoryTrustedFlaggers.set(flagger.id, flagger)
    return
  }

  await db.run(`
    INSERT OR REPLACE INTO trusted_flaggers (
      id, name, type, api_key_hash, enabled, priority, contact_email, jurisdiction
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    flagger.id,
    flagger.name,
    flagger.type,
    apiKeyHash,
    flagger.enabled ? 1 : 0,
    flagger.priority,
    flagger.contactEmail,
    flagger.jurisdiction ? JSON.stringify(flagger.jurisdiction) : null,
  ])
}

export async function getTrustedFlaggerByApiKey(apiKey: string): Promise<TrustedFlagger | undefined> {
  const apiKeyHash = await hashApiKey(apiKey)

  if (!db) {
    for (const f of inMemoryTrustedFlaggers.values()) {
      const fHash = await hashApiKey(f.apiKey)
      if (fHash === apiKeyHash && f.enabled) return f
    }
    return undefined
  }

  const row = await db.get<{
    id: string
    name: string
    type: string
    api_key_hash: string
    enabled: number
    priority: string
    contact_email: string
    jurisdiction: string | null
  }>(`
    SELECT * FROM trusted_flaggers WHERE api_key_hash = ? AND enabled = 1
  `, [apiKeyHash])

  if (!row) return undefined

  return {
    id: row.id,
    name: row.name,
    type: row.type as TrustedFlagger['type'],
    apiKey: '', // Don't return the actual key
    enabled: row.enabled === 1,
    priority: row.priority as TrustedFlagger['priority'],
    contactEmail: row.contact_email,
    jurisdiction: row.jurisdiction ? JSON.parse(row.jurisdiction) : undefined,
  }
}

export async function listTrustedFlaggers(): Promise<Omit<TrustedFlagger, 'apiKey'>[]> {
  if (!db) {
    return Array.from(inMemoryTrustedFlaggers.values()).map(f => ({
      ...f,
      apiKey: undefined as unknown as string,
    }))
  }

  const rows = await db.all<{
    id: string
    name: string
    type: string
    enabled: number
    priority: string
    contact_email: string
    jurisdiction: string | null
  }>('SELECT id, name, type, enabled, priority, contact_email, jurisdiction FROM trusted_flaggers')

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    type: row.type as TrustedFlagger['type'],
    apiKey: '', // Don't expose
    enabled: row.enabled === 1,
    priority: row.priority as TrustedFlagger['priority'],
    contactEmail: row.contact_email,
    jurisdiction: row.jurisdiction ? JSON.parse(row.jurisdiction) : undefined,
  }))
}

export function isPersistenceInitialized(): boolean {
  return db !== null || inMemoryReports.length >= 0 // Always true, just indicates mode
}

export function getPersistenceMode(): 'database' | 'memory' {
  return db ? 'database' : 'memory'
}

