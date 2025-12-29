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
import type { QuarantineItem, EvidenceBundle } from './quarantine'
import type { WalletEnforcementState, Violation, WalletStatus } from './wallet-enforcement'
import type { ContentStatus, ContentStatusType } from './content-cache'

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
const inMemoryQuarantineItems = new Map<string, QuarantineItem>()
const inMemoryEvidenceBundles = new Map<string, EvidenceBundle>()
const inMemoryWalletStates = new Map<Address, WalletEnforcementState>()
const inMemoryContentCache = new Map<string, ContentStatus>()

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

  // Quarantine items table
  await db.run(`
    CREATE TABLE IF NOT EXISTS quarantine_items (
      id TEXT PRIMARY KEY,
      sha256 TEXT NOT NULL,
      encrypted_ref TEXT NOT NULL,
      encryption_key_id TEXT NOT NULL,
      detected_at INTEGER NOT NULL,
      detection_reason TEXT NOT NULL,
      detection_source TEXT NOT NULL,
      confidence REAL NOT NULL,
      uploader_address TEXT,
      uploader_ip TEXT,
      provider_address TEXT,
      status TEXT NOT NULL,
      ttl_expires_at INTEGER,
      legal_hold_until INTEGER,
      assigned_reviewer_id TEXT,
      review_started_at INTEGER,
      decision_outcome TEXT,
      decision_action TEXT,
      decision_reason TEXT,
      decided_at INTEGER,
      decided_by TEXT
    )
  `)

  // Evidence bundles table
  await db.run(`
    CREATE TABLE IF NOT EXISTS evidence_bundles (
      id TEXT PRIMARY KEY,
      quarantine_item_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      md5 TEXT,
      match_source TEXT,
      match_id TEXT,
      match_confidence REAL,
      wallets TEXT NOT NULL,
      providers TEXT NOT NULL,
      ips TEXT NOT NULL,
      tx_hashes TEXT NOT NULL,
      uploaded_at INTEGER NOT NULL,
      detected_at INTEGER NOT NULL,
      quarantined_at INTEGER NOT NULL,
      reported_at INTEGER,
      ncmec_report_id TEXT,
      legal_hold_until INTEGER,
      access_log TEXT NOT NULL
    )
  `)

  // Wallet enforcement states table
  await db.run(`
    CREATE TABLE IF NOT EXISTS wallet_enforcement (
      address TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      status_changed_at INTEGER NOT NULL,
      violations TEXT NOT NULL,
      warnings_issued INTEGER NOT NULL,
      wallet_age INTEGER NOT NULL,
      stake_amount TEXT NOT NULL,
      transaction_count INTEGER NOT NULL,
      ofac_match INTEGER NOT NULL,
      taint_score REAL NOT NULL,
      pow_difficulty INTEGER NOT NULL,
      rate_limit INTEGER NOT NULL
    )
  `)

  // Content cache table
  await db.run(`
    CREATE TABLE IF NOT EXISTS content_cache (
      sha256 TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      policy_class TEXT,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      seen_count INTEGER NOT NULL,
      wallets TEXT NOT NULL,
      providers TEXT NOT NULL,
      perceptual_hash TEXT,
      ban_reason TEXT,
      banned_at INTEGER
    )
  `)

  // Create indexes
  await db.run('CREATE INDEX IF NOT EXISTS idx_csam_reports_status ON csam_reports(status)')
  await db.run('CREATE INDEX IF NOT EXISTS idx_csam_reports_detected ON csam_reports(detected_at)')
  await db.run('CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON moderation_metrics(timestamp)')
  await db.run('CREATE INDEX IF NOT EXISTS idx_user_reports_status ON user_reports(status)')
  await db.run('CREATE INDEX IF NOT EXISTS idx_quarantine_status ON quarantine_items(status)')
  await db.run('CREATE INDEX IF NOT EXISTS idx_wallet_status ON wallet_enforcement(status)')
  await db.run('CREATE INDEX IF NOT EXISTS idx_content_status ON content_cache(status)')
  await db.run('CREATE INDEX IF NOT EXISTS idx_content_phash ON content_cache(perceptual_hash)')

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

// ============ Quarantine Items ============

export async function saveQuarantineItem(item: QuarantineItem): Promise<void> {
  if (!db) {
    inMemoryQuarantineItems.set(item.id, item)
    return
  }

  await db.run(`
    INSERT OR REPLACE INTO quarantine_items (
      id, sha256, encrypted_ref, encryption_key_id, detected_at,
      detection_reason, detection_source, confidence, uploader_address,
      uploader_ip, provider_address, status, ttl_expires_at, legal_hold_until,
      assigned_reviewer_id, review_started_at, decision_outcome, decision_action,
      decision_reason, decided_at, decided_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    item.id,
    item.sha256,
    item.encryptedRef,
    item.encryptionKeyId,
    item.detectedAt,
    item.detectionReason,
    item.detectionSource,
    item.confidence,
    item.uploaderAddress ?? null,
    item.uploaderIp ?? null,
    item.providerAddress ?? null,
    item.status,
    item.ttlExpiresAt ?? null,
    item.legalHoldUntil ?? null,
    item.assignedReviewerId ?? null,
    item.reviewStartedAt ?? null,
    item.decision?.outcome ?? null,
    item.decision?.action ?? null,
    (item.decision as { reason?: string })?.reason ?? null,
    item.decidedAt ?? null,
    item.decidedBy ?? null,
  ])
}

export async function getQuarantineItem(id: string): Promise<QuarantineItem | undefined> {
  if (!db) {
    return inMemoryQuarantineItems.get(id)
  }

  const row = await db.get<{
    id: string
    sha256: string
    encrypted_ref: string
    encryption_key_id: string
    detected_at: number
    detection_reason: string
    detection_source: string
    confidence: number
    uploader_address: string | null
    uploader_ip: string | null
    provider_address: string | null
    status: string
    ttl_expires_at: number | null
    legal_hold_until: number | null
    assigned_reviewer_id: string | null
    review_started_at: number | null
    decision_outcome: string | null
    decision_action: string | null
    decision_reason: string | null
    decided_at: number | null
    decided_by: string | null
  }>('SELECT * FROM quarantine_items WHERE id = ?', [id])

  if (!row) return undefined

  return mapQuarantineRow(row)
}

export async function getQuarantineItems(filter?: {
  status?: string
  limit?: number
}): Promise<QuarantineItem[]> {
  if (!db) {
    let items = Array.from(inMemoryQuarantineItems.values())
    if (filter?.status) items = items.filter(i => i.status === filter.status)
    if (filter?.limit) items = items.slice(0, filter.limit)
    return items
  }

  let sql = 'SELECT * FROM quarantine_items WHERE 1=1'
  const params: unknown[] = []

  if (filter?.status) {
    sql += ' AND status = ?'
    params.push(filter.status)
  }

  sql += ' ORDER BY detected_at DESC'

  if (filter?.limit) {
    sql += ' LIMIT ?'
    params.push(filter.limit)
  }

  const rows = await db.all<{
    id: string
    sha256: string
    encrypted_ref: string
    encryption_key_id: string
    detected_at: number
    detection_reason: string
    detection_source: string
    confidence: number
    uploader_address: string | null
    uploader_ip: string | null
    provider_address: string | null
    status: string
    ttl_expires_at: number | null
    legal_hold_until: number | null
    assigned_reviewer_id: string | null
    review_started_at: number | null
    decision_outcome: string | null
    decision_action: string | null
    decision_reason: string | null
    decided_at: number | null
    decided_by: string | null
  }>(sql, params)

  return rows.map(mapQuarantineRow)
}

function mapQuarantineRow(row: {
  id: string
  sha256: string
  encrypted_ref: string
  encryption_key_id: string
  detected_at: number
  detection_reason: string
  detection_source: string
  confidence: number
  uploader_address: string | null
  uploader_ip: string | null
  provider_address: string | null
  status: string
  ttl_expires_at: number | null
  legal_hold_until: number | null
  assigned_reviewer_id: string | null
  review_started_at: number | null
  decision_outcome: string | null
  decision_action: string | null
  decision_reason: string | null
  decided_at: number | null
  decided_by: string | null
}): QuarantineItem {
  let decision: QuarantineItem['decision'] = undefined
  if (row.decision_outcome && row.decision_action) {
    decision = {
      outcome: row.decision_outcome,
      action: row.decision_action,
      ...(row.decision_reason ? { reason: row.decision_reason } : {}),
    } as QuarantineItem['decision']
  }

  return {
    id: row.id,
    sha256: row.sha256,
    encryptedRef: row.encrypted_ref,
    encryptionKeyId: row.encryption_key_id,
    detectedAt: row.detected_at,
    detectionReason: row.detection_reason as QuarantineItem['detectionReason'],
    detectionSource: row.detection_source,
    confidence: row.confidence,
    uploaderAddress: row.uploader_address as Address | undefined,
    uploaderIp: row.uploader_ip ?? undefined,
    providerAddress: row.provider_address as Address | undefined,
    status: row.status as QuarantineItem['status'],
    ttlExpiresAt: row.ttl_expires_at ?? undefined,
    legalHoldUntil: row.legal_hold_until ?? undefined,
    assignedReviewerId: row.assigned_reviewer_id ?? undefined,
    reviewStartedAt: row.review_started_at ?? undefined,
    decision,
    decidedAt: row.decided_at ?? undefined,
    decidedBy: row.decided_by ?? undefined,
  }
}

// ============ Evidence Bundles ============

export async function saveEvidenceBundle(bundle: EvidenceBundle): Promise<void> {
  if (!db) {
    inMemoryEvidenceBundles.set(bundle.id, bundle)
    return
  }

  await db.run(`
    INSERT OR REPLACE INTO evidence_bundles (
      id, quarantine_item_id, created_at, sha256, md5,
      match_source, match_id, match_confidence, wallets, providers,
      ips, tx_hashes, uploaded_at, detected_at, quarantined_at,
      reported_at, ncmec_report_id, legal_hold_until, access_log
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    bundle.id,
    bundle.quarantineItemId,
    bundle.createdAt,
    bundle.contentHash.sha256,
    bundle.contentHash.md5,
    bundle.matchSource ?? null,
    bundle.matchId ?? null,
    bundle.matchConfidence ?? null,
    JSON.stringify(bundle.wallets),
    JSON.stringify(bundle.providers),
    JSON.stringify(bundle.ips),
    JSON.stringify(bundle.txHashes),
    bundle.uploadedAt,
    bundle.detectedAt,
    bundle.quarantinedAt,
    bundle.reportedAt ?? null,
    bundle.ncmecReportId ?? null,
    bundle.legalHoldUntil ?? null,
    JSON.stringify(bundle.accessLog),
  ])
}

export async function getEvidenceBundle(id: string): Promise<EvidenceBundle | undefined> {
  if (!db) {
    return inMemoryEvidenceBundles.get(id)
  }

  const row = await db.get<{
    id: string
    quarantine_item_id: string
    created_at: number
    sha256: string
    md5: string
    match_source: string | null
    match_id: string | null
    match_confidence: number | null
    wallets: string
    providers: string
    ips: string
    tx_hashes: string
    uploaded_at: number
    detected_at: number
    quarantined_at: number
    reported_at: number | null
    ncmec_report_id: string | null
    legal_hold_until: number | null
    access_log: string
  }>('SELECT * FROM evidence_bundles WHERE id = ?', [id])

  if (!row) return undefined

  return {
    id: row.id,
    quarantineItemId: row.quarantine_item_id,
    createdAt: row.created_at,
    contentHash: { sha256: row.sha256, md5: row.md5 },
    matchSource: row.match_source ?? undefined,
    matchId: row.match_id ?? undefined,
    matchConfidence: row.match_confidence ?? undefined,
    wallets: JSON.parse(row.wallets),
    providers: JSON.parse(row.providers),
    ips: JSON.parse(row.ips),
    txHashes: JSON.parse(row.tx_hashes),
    uploadedAt: row.uploaded_at,
    detectedAt: row.detected_at,
    quarantinedAt: row.quarantined_at,
    reportedAt: row.reported_at ?? undefined,
    ncmecReportId: row.ncmec_report_id ?? undefined,
    legalHoldUntil: row.legal_hold_until ?? undefined,
    accessLog: JSON.parse(row.access_log),
  }
}

// ============ Wallet Enforcement ============

export async function saveWalletState(state: WalletEnforcementState): Promise<void> {
  if (!db) {
    inMemoryWalletStates.set(state.address, state)
    return
  }

  await db.run(`
    INSERT OR REPLACE INTO wallet_enforcement (
      address, status, status_changed_at, violations, warnings_issued,
      wallet_age, stake_amount, transaction_count, ofac_match, taint_score,
      pow_difficulty, rate_limit
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    state.address,
    state.status,
    state.statusChangedAt,
    JSON.stringify(state.violations),
    state.warningsIssued,
    state.walletAge,
    state.stakeAmount.toString(),
    state.transactionCount,
    state.ofacMatch ? 1 : 0,
    state.taintScore,
    state.powDifficulty,
    state.rateLimit,
  ])
}

export async function getWalletState(address: Address): Promise<WalletEnforcementState | undefined> {
  if (!db) {
    return inMemoryWalletStates.get(address)
  }

  const row = await db.get<{
    address: string
    status: string
    status_changed_at: number
    violations: string
    warnings_issued: number
    wallet_age: number
    stake_amount: string
    transaction_count: number
    ofac_match: number
    taint_score: number
    pow_difficulty: number
    rate_limit: number
  }>('SELECT * FROM wallet_enforcement WHERE address = ?', [address])

  if (!row) return undefined

  return {
    address: row.address as Address,
    status: row.status as WalletStatus,
    statusChangedAt: row.status_changed_at,
    violations: JSON.parse(row.violations) as Violation[],
    warningsIssued: row.warnings_issued,
    walletAge: row.wallet_age,
    stakeAmount: BigInt(row.stake_amount),
    transactionCount: row.transaction_count,
    ofacMatch: row.ofac_match === 1,
    taintScore: row.taint_score,
    powDifficulty: row.pow_difficulty,
    rateLimit: row.rate_limit,
  }
}

export async function getWalletsByStatus(status: WalletStatus): Promise<WalletEnforcementState[]> {
  if (!db) {
    return Array.from(inMemoryWalletStates.values()).filter(w => w.status === status)
  }

  const rows = await db.all<{
    address: string
    status: string
    status_changed_at: number
    violations: string
    warnings_issued: number
    wallet_age: number
    stake_amount: string
    transaction_count: number
    ofac_match: number
    taint_score: number
    pow_difficulty: number
    rate_limit: number
  }>('SELECT * FROM wallet_enforcement WHERE status = ?', [status])

  return rows.map(row => ({
    address: row.address as Address,
    status: row.status as WalletStatus,
    statusChangedAt: row.status_changed_at,
    violations: JSON.parse(row.violations) as Violation[],
    warningsIssued: row.warnings_issued,
    walletAge: row.wallet_age,
    stakeAmount: BigInt(row.stake_amount),
    transactionCount: row.transaction_count,
    ofacMatch: row.ofac_match === 1,
    taintScore: row.taint_score,
    powDifficulty: row.pow_difficulty,
    rateLimit: row.rate_limit,
  }))
}

// ============ Content Cache ============

export async function saveContentStatus(status: ContentStatus): Promise<void> {
  if (!db) {
    inMemoryContentCache.set(status.sha256, status)
    return
  }

  await db.run(`
    INSERT OR REPLACE INTO content_cache (
      sha256, status, policy_class, first_seen, last_seen, seen_count,
      wallets, providers, perceptual_hash, ban_reason, banned_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    status.sha256,
    status.status,
    status.policyClass ?? null,
    status.firstSeen,
    status.lastSeen,
    status.seenCount,
    JSON.stringify(status.wallets),
    JSON.stringify(status.providers),
    status.perceptualHash ?? null,
    status.banReason ?? null,
    status.bannedAt ?? null,
  ])
}

export async function getContentStatus(sha256: string): Promise<ContentStatus | undefined> {
  if (!db) {
    return inMemoryContentCache.get(sha256)
  }

  const row = await db.get<{
    sha256: string
    status: string
    policy_class: string | null
    first_seen: number
    last_seen: number
    seen_count: number
    wallets: string
    providers: string
    perceptual_hash: string | null
    ban_reason: string | null
    banned_at: number | null
  }>('SELECT * FROM content_cache WHERE sha256 = ?', [sha256])

  if (!row) return undefined

  return {
    sha256: row.sha256,
    status: row.status as ContentStatusType,
    policyClass: row.policy_class ?? undefined,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    seenCount: row.seen_count,
    wallets: JSON.parse(row.wallets) as Address[],
    providers: JSON.parse(row.providers) as string[],
    perceptualHash: row.perceptual_hash ?? undefined,
    banReason: row.ban_reason ?? undefined,
    bannedAt: row.banned_at ?? undefined,
  }
}

export async function getContentByPerceptualHash(pHash: string): Promise<ContentStatus[]> {
  if (!db) {
    return Array.from(inMemoryContentCache.values()).filter(c => c.perceptualHash === pHash)
  }

  const rows = await db.all<{
    sha256: string
    status: string
    policy_class: string | null
    first_seen: number
    last_seen: number
    seen_count: number
    wallets: string
    providers: string
    perceptual_hash: string | null
    ban_reason: string | null
    banned_at: number | null
  }>('SELECT * FROM content_cache WHERE perceptual_hash = ?', [pHash])

  return rows.map(row => ({
    sha256: row.sha256,
    status: row.status as ContentStatusType,
    policyClass: row.policy_class ?? undefined,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    seenCount: row.seen_count,
    wallets: JSON.parse(row.wallets) as Address[],
    providers: JSON.parse(row.providers) as string[],
    perceptualHash: row.perceptual_hash ?? undefined,
    banReason: row.ban_reason ?? undefined,
    bannedAt: row.banned_at ?? undefined,
  }))
}

export function isPersistenceInitialized(): boolean {
  return db !== null || inMemoryReports.length >= 0 // Always true, just indicates mode
}

export function getPersistenceMode(): 'database' | 'memory' {
  return db ? 'database' : 'memory'
}

