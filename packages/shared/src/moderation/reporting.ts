/**
 * CSAM Reporting - Mandatory Reporting to Authorities
 *
 * UK Law: Internet infrastructure providers should report CSAM to NCMEC/IWF
 * US Law: 18 U.S.C. § 2258A requires ESPs to report CSAM to NCMEC
 *
 * This module provides:
 * - NCMEC CyberTipline API integration (US)
 * - IWF reporting (UK)
 * - Internal audit trail for compliance
 *
 * IMPORTANT: This is a MANDATORY legal requirement for US/UK operations.
 * Failure to report known CSAM is a federal crime in the US.
 *
 * @see https://www.missingkids.org/gethelpnow/cybertipline
 * @see https://www.iwf.org.uk/
 */

import type { Address } from 'viem'
import { logger } from '../logger'
import type { ModerationCategory, ModerationResult } from './types'

export interface CSAMReport {
  /** Unique report ID (internal) */
  reportId: string
  /** When the content was detected */
  detectedAt: number
  /** When report was submitted to authority */
  reportedAt?: number
  /** Authority report ID (from NCMEC/IWF) */
  authorityReportId?: string
  /** Content hash (SHA256) - we NEVER store actual content */
  contentHash: string
  /** Perceptual hash if available */
  perceptualHash?: string
  /** Content type */
  contentType: 'image' | 'video' | 'text' | 'file'
  /** How it was detected */
  detectionMethod: 'hash' | 'ai' | 'user_report' | 'manual'
  /** Detection confidence */
  confidence: number
  /** Uploader address if known */
  uploaderAddress?: Address
  /** IP address if available (for law enforcement) */
  uploaderIp?: string
  /** User agent if available */
  userAgent?: string
  /** Where content was found */
  location: {
    service: string // 'storage', 'messaging', 'compute', etc.
    path?: string
    timestamp: number
  }
  /** Reporting status */
  status: 'pending' | 'submitted' | 'acknowledged' | 'failed'
  /** Error if failed */
  error?: string
}

export interface NCMECConfig {
  /** NCMEC API username (ESP portal) */
  username: string
  /** NCMEC API password */
  password: string
  /** ESP ID assigned by NCMEC */
  espId: string
  /** Environment */
  environment: 'production' | 'test'
}

export interface IWFConfig {
  /** IWF member API key */
  apiKey: string
  /** IWF member ID */
  memberId: string
}

export interface ReportingConfig {
  ncmec?: NCMECConfig
  iwf?: IWFConfig
  /** Callback when report is created */
  onReport?: (report: CSAMReport) => Promise<void>
  /** Enable dry-run mode (logs but doesn't submit) */
  dryRun?: boolean
}

// In-memory report log (should be persisted externally)
const reports: CSAMReport[] = []

/**
 * CSAM Reporting Service
 *
 * Handles mandatory reporting to NCMEC CyberTipline and IWF.
 * All detected CSAM MUST be reported - this is a legal requirement.
 */
export class CSAMReportingService {
  private config: ReportingConfig
  private initialized = false

  constructor(config: ReportingConfig = {}) {
    this.config = config
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    const hasNcmec = !!(this.config.ncmec?.username && this.config.ncmec?.password)
    const hasIwf = !!this.config.iwf?.apiKey

    if (!hasNcmec && !hasIwf && !this.config.dryRun) {
      logger.error('[CSAMReporting] NO REPORTING CONFIGURED - CSAM detection will be logged but NOT reported')
      logger.error('[CSAMReporting] Set NCMEC_USERNAME/NCMEC_PASSWORD or IWF_API_KEY for mandatory reporting')
    }

    this.initialized = true
    logger.info('[CSAMReporting] Initialized', {
      ncmec: hasNcmec,
      iwf: hasIwf,
      dryRun: this.config.dryRun ?? false,
    })
  }

  /**
   * Create a CSAM report - MUST be called for all detected CSAM
   *
   * This creates an internal record and submits to authorities.
   * Content is NEVER stored - only hashes and metadata.
   */
  async createReport(params: {
    contentHash: string
    perceptualHash?: string
    contentType: CSAMReport['contentType']
    detectionMethod: CSAMReport['detectionMethod']
    confidence: number
    uploaderAddress?: Address
    uploaderIp?: string
    userAgent?: string
    service: string
    path?: string
    moderationResult?: ModerationResult
  }): Promise<CSAMReport> {
    const report: CSAMReport = {
      reportId: crypto.randomUUID(),
      detectedAt: Date.now(),
      contentHash: params.contentHash,
      perceptualHash: params.perceptualHash,
      contentType: params.contentType,
      detectionMethod: params.detectionMethod,
      confidence: params.confidence,
      uploaderAddress: params.uploaderAddress,
      uploaderIp: params.uploaderIp,
      userAgent: params.userAgent,
      location: {
        service: params.service,
        path: params.path,
        timestamp: Date.now(),
      },
      status: 'pending',
    }

    reports.push(report)
    logger.warn('[CSAMReporting] CSAM detected - creating report', {
      reportId: report.reportId,
      contentHash: report.contentHash,
      detectionMethod: report.detectionMethod,
      confidence: report.confidence,
    })

    // Notify callback
    if (this.config.onReport) {
      await this.config.onReport(report).catch(err => {
        logger.error('[CSAMReporting] onReport callback failed', { error: String(err) })
      })
    }

    // Submit to authorities
    if (!this.config.dryRun) {
      await this.submitToAuthorities(report)
    } else {
      logger.info('[CSAMReporting] Dry run - report NOT submitted', { reportId: report.reportId })
      report.status = 'acknowledged'
    }

    return report
  }

  private async submitToAuthorities(report: CSAMReport): Promise<void> {
    // Try NCMEC first (US)
    if (this.config.ncmec) {
      try {
        await this.submitToNCMEC(report)
        return
      } catch (err) {
        logger.error('[CSAMReporting] NCMEC submission failed', {
          reportId: report.reportId,
          error: String(err),
        })
      }
    }

    // Try IWF (UK)
    if (this.config.iwf) {
      try {
        await this.submitToIWF(report)
        return
      } catch (err) {
        logger.error('[CSAMReporting] IWF submission failed', {
          reportId: report.reportId,
          error: String(err),
        })
      }
    }

    // No authorities configured - log error but don't throw
    // Content is still blocked, but not reported (compliance issue)
    report.status = 'failed'
    report.error = 'No reporting authority configured'
    logger.error('[CSAMReporting] COMPLIANCE VIOLATION: CSAM detected but no authority configured', {
      reportId: report.reportId,
    })
  }

  /**
   * Submit report to NCMEC CyberTipline
   * @see https://www.missingkids.org/content/dam/missingkids/pdfs/CyberTipline-API-Guide.pdf
   */
  private async submitToNCMEC(report: CSAMReport): Promise<void> {
    const config = this.config.ncmec
    if (!config) throw new Error('NCMEC not configured')

    const baseUrl = config.environment === 'production'
      ? 'https://report.cybertipline.org/api/v2'
      : 'https://exttest.cybertipline.org/api/v2'

    // NCMEC CyberTipline API requires XML format
    const reportXml = this.buildNCMECReport(report)

    const response = await fetch(`${baseUrl}/reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
        'Authorization': `Basic ${btoa(`${config.username}:${config.password}`)}`,
        'X-ESP-ID': config.espId,
      },
      body: reportXml,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`NCMEC API error: ${response.status} ${text}`)
    }

    const result = await response.text()
    // Parse NCMEC response for report ID
    const match = result.match(/<reportId>(\d+)<\/reportId>/)
    if (match) {
      report.authorityReportId = match[1]
    }

    report.reportedAt = Date.now()
    report.status = 'submitted'

    logger.info('[CSAMReporting] Report submitted to NCMEC', {
      reportId: report.reportId,
      ncmecReportId: report.authorityReportId ?? 'pending',
    })
  }

  private buildNCMECReport(report: CSAMReport): string {
    // NCMEC XML schema for CyberTipline reports
    // @see https://www.missingkids.org/content/dam/missingkids/pdfs/CyberTipline-API-Guide.pdf
    return `<?xml version="1.0" encoding="UTF-8"?>
<report xmlns="http://www.missingkids.org/cybertip">
  <incidentSummary>
    <incidentType>Child Pornography (possession, manufacture, and distribution)</incidentType>
    <incidentDateTime>${new Date(report.detectedAt).toISOString()}</incidentDateTime>
  </incidentSummary>
  <reporter>
    <reportingEsp>
      <espName>Jeju Network</espName>
      <espContactEmail>legal@jeju.network</espContactEmail>
    </reportingEsp>
  </reporter>
  <reportedPerson>
    ${report.uploaderAddress ? `<ipCaptureEvent>
      <ipAddress>${report.uploaderIp ?? 'unknown'}</ipAddress>
      <eventName>Upload</eventName>
      <dateTime>${new Date(report.location.timestamp).toISOString()}</dateTime>
    </ipCaptureEvent>` : ''}
    ${report.uploaderAddress ? `<additionalInfo>Blockchain address: ${report.uploaderAddress}</additionalInfo>` : ''}
  </reportedPerson>
  <uploadedFiles>
    <uploadedFile>
      <sha256>${report.contentHash}</sha256>
      <fileType>${report.contentType}</fileType>
      <locationOfFile>
        <url>${report.location.service}${report.location.path ? `/${report.location.path}` : ''}</url>
      </locationOfFile>
      ${report.perceptualHash ? `<additionalInfo>Perceptual hash: ${report.perceptualHash}</additionalInfo>` : ''}
    </uploadedFile>
  </uploadedFiles>
  <additionalInformation>
    <detectionMethod>${report.detectionMethod}</detectionMethod>
    <confidence>${report.confidence}</confidence>
    <internalReportId>${report.reportId}</internalReportId>
  </additionalInformation>
</report>`
  }

  /**
   * Submit report to IWF
   * @see https://www.iwf.org.uk/our-technology/hash-list/
   */
  private async submitToIWF(report: CSAMReport): Promise<void> {
    const config = this.config.iwf
    if (!config) throw new Error('IWF not configured')

    const response = await fetch('https://api.iwf.org.uk/v1/reports', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
        'X-Member-ID': config.memberId,
      },
      body: JSON.stringify({
        type: 'csam',
        detectedAt: new Date(report.detectedAt).toISOString(),
        contentHash: report.contentHash,
        perceptualHash: report.perceptualHash,
        contentType: report.contentType,
        detectionMethod: report.detectionMethod,
        confidence: report.confidence,
        location: report.location,
        uploaderInfo: report.uploaderAddress ? {
          address: report.uploaderAddress,
          ip: report.uploaderIp,
        } : undefined,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`IWF API error: ${response.status} ${text}`)
    }

    const result = await response.json() as { reportId: string }
    report.authorityReportId = result.reportId
    report.reportedAt = Date.now()
    report.status = 'submitted'

    logger.info('[CSAMReporting] Report submitted to IWF', {
      reportId: report.reportId,
      iwfReportId: report.authorityReportId,
    })
  }

  /**
   * Get all reports (for compliance auditing)
   */
  getReports(filter?: {
    status?: CSAMReport['status']
    startTime?: number
    endTime?: number
  }): CSAMReport[] {
    let result = [...reports]

    if (filter?.status) {
      result = result.filter(r => r.status === filter.status)
    }
    if (filter?.startTime) {
      result = result.filter(r => r.detectedAt >= filter.startTime!)
    }
    if (filter?.endTime) {
      result = result.filter(r => r.detectedAt <= filter.endTime!)
    }

    return result
  }

  /**
   * Get report statistics (for transparency reporting)
   */
  getStats(): {
    total: number
    pending: number
    submitted: number
    acknowledged: number
    failed: number
    byDetectionMethod: Record<string, number>
    byContentType: Record<string, number>
  } {
    const stats = {
      total: reports.length,
      pending: 0,
      submitted: 0,
      acknowledged: 0,
      failed: 0,
      byDetectionMethod: {} as Record<string, number>,
      byContentType: {} as Record<string, number>,
    }

    for (const r of reports) {
      stats[r.status]++
      stats.byDetectionMethod[r.detectionMethod] = (stats.byDetectionMethod[r.detectionMethod] ?? 0) + 1
      stats.byContentType[r.contentType] = (stats.byContentType[r.contentType] ?? 0) + 1
    }

    return stats
  }
}

/**
 * Deterrence Message Generator
 *
 * Per UK guidance: "Use deterrence messaging with likely CSAM search terms"
 */
export const DETERRENCE_MESSAGES = {
  warning: `
⚠️ WARNING: Child sexual abuse material (CSAM) is illegal.

Viewing, possessing, or distributing CSAM is a serious criminal offense
that carries severe penalties including imprisonment.

If you or someone you know needs help, please contact:
• Stop It Now: 0808 1000 900 (UK) / 1-888-773-8368 (US)
• NCMEC CyberTipline: 1-800-843-5678
• Childhelp: 1-800-422-4453

This activity has been logged and may be reported to authorities.
`.trim(),

  blocked: `
🚫 ACCESS BLOCKED

This content has been identified as illegal child sexual abuse material.

This incident has been logged and will be reported to:
• National Center for Missing & Exploited Children (NCMEC)
• Internet Watch Foundation (IWF)
• Relevant law enforcement authorities

Attempting to access illegal content is a criminal offense.
`.trim(),

  support: {
    uk: [
      { name: 'Stop It Now UK', phone: '0808 1000 900', url: 'https://www.stopitnow.org.uk/' },
      { name: 'Childline', phone: '0800 1111', url: 'https://www.childline.org.uk/' },
      { name: 'NSPCC', phone: '0808 800 5000', url: 'https://www.nspcc.org.uk/' },
    ],
    us: [
      { name: 'Stop It Now USA', phone: '1-888-773-8368', url: 'https://www.stopitnow.org/' },
      { name: 'NCMEC CyberTipline', phone: '1-800-843-5678', url: 'https://www.missingkids.org/' },
      { name: 'Childhelp', phone: '1-800-422-4453', url: 'https://www.childhelp.org/' },
    ],
  },
}

/**
 * User Report types for community reporting
 */
export interface UserReport {
  reportId: string
  reporterAddress?: Address
  reporterIp?: string
  targetType: 'content' | 'user' | 'domain'
  targetId: string
  category: ModerationCategory
  description: string
  evidence?: string[]
  timestamp: number
  status: 'pending' | 'reviewed' | 'actioned' | 'dismissed'
  reviewedBy?: Address
  reviewedAt?: number
  action?: 'none' | 'warning' | 'removed' | 'banned'
}

/**
 * Trusted Flagger - NGOs and law enforcement with priority reporting
 */
export interface TrustedFlagger {
  id: string
  name: string
  type: 'ngo' | 'law_enforcement' | 'regulatory'
  apiKey: string
  enabled: boolean
  priority: 'high' | 'urgent' // urgent = immediate action
  contactEmail: string
  jurisdiction?: string[]
}

const trustedFlaggers = new Map<string, TrustedFlagger>()

export function registerTrustedFlagger(flagger: TrustedFlagger): void {
  trustedFlaggers.set(flagger.id, flagger)
  logger.info('[TrustedFlagger] Registered', { id: flagger.id, name: flagger.name })
}

export function getTrustedFlagger(apiKey: string): TrustedFlagger | undefined {
  for (const f of trustedFlaggers.values()) {
    if (f.apiKey === apiKey && f.enabled) {
      return f
    }
  }
  return undefined
}

