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
import {
  saveCSAMReport,
  updateCSAMReportStatus,
  getCSAMReports as getPersistedReports,
  getCSAMReportStats,
  saveTrustedFlagger,
  getTrustedFlaggerByApiKey,
  listTrustedFlaggers,
} from './persistence'

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

    // Persist to database
    await saveCSAMReport(report)

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
    await updateCSAMReportStatus(report.reportId, 'failed', undefined, report.error)
    logger.error('[CSAMReporting] COMPLIANCE VIOLATION: CSAM detected but no authority configured', {
      reportId: report.reportId,
    })
  }

  /**
   * Submit report to NCMEC CyberTipline
   *
   * IMPORTANT: To use this API, you must:
   * 1. Register as an Electronic Service Provider (ESP) at https://esp.missingkids.org/
   * 2. Complete the onboarding process and sign legal agreements
   * 3. Obtain API credentials (username, password, ESP ID)
   * 4. Test in their sandbox environment first
   *
   * @see https://www.missingkids.org/gethelpnow/cybertipline
   * @see https://www.missingkids.org/ourwork/ncmecdata
   */
  private async submitToNCMEC(report: CSAMReport): Promise<void> {
    const config = this.config.ncmec
    if (!config) throw new Error('NCMEC not configured')

    // NCMEC CyberTipline API endpoints
    // Production: https://report.cybertipline.org/
    // Test: https://exttest.cybertipline.org/
    const baseUrl = config.environment === 'production'
      ? 'https://report.cybertipline.org/ispws/report'
      : 'https://exttest.cybertipline.org/ispws/report'

    // NCMEC CyberTipline API uses SOAP/XML
    const reportXml = this.buildNCMECReport(report)

    logger.info('[CSAMReporting] Submitting to NCMEC CyberTipline', {
      reportId: report.reportId,
      environment: config.environment,
      endpoint: baseUrl,
    })

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'Authorization': `Basic ${btoa(`${config.username}:${config.password}`)}`,
        'SOAPAction': 'submitReport',
      },
      body: reportXml,
    })

    if (!response.ok) {
      const text = await response.text()
      logger.error('[CSAMReporting] NCMEC submission failed', {
        reportId: report.reportId,
        status: response.status,
        statusText: response.statusText,
        response: text.slice(0, 500),
      })
      throw new Error(`NCMEC API error: ${response.status} ${response.statusText}`)
    }

    const result = await response.text()
    // Parse NCMEC response for report ID
    const match = result.match(/<reportId>(\d+)<\/reportId>/)
    if (match) {
      report.authorityReportId = match[1]
    }

    report.reportedAt = Date.now()
    report.status = 'submitted'

    // Persist status update
    await updateCSAMReportStatus(report.reportId, 'submitted', report.authorityReportId)

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
   * Submit report to IWF (Internet Watch Foundation) - UK
   *
   * IMPORTANT: To use IWF services, you must:
   * 1. Become an IWF member at https://www.iwf.org.uk/become-a-member/
   * 2. Sign membership agreement
   * 3. Obtain access to the IWF Portal
   * 4. For UK operations, also consider NCA CSEA-IRP reporting
   *
   * IWF Member Portal: https://portal.iwf.org.uk/
   * Note: IWF provides hash lists for detection, not a direct reporting API.
   * For reporting, use the IWF Portal or NCA CSEA Industry Reporting Portal.
   *
   * @see https://www.iwf.org.uk/
   * @see https://www.nationalcrimeagency.gov.uk/what-we-do/crime-threats/child-sexual-abuse-and-exploitation
   */
  private async submitToIWF(report: CSAMReport): Promise<void> {
    const config = this.config.iwf
    if (!config) throw new Error('IWF not configured')

    // IWF Portal API (member-only)
    // Note: The exact API endpoint must be obtained from IWF upon membership
    const portalUrl = 'https://portal.iwf.org.uk/api/v1/reports'

    logger.info('[CSAMReporting] Submitting to IWF Portal', {
      reportId: report.reportId,
      endpoint: portalUrl,
    })

    const response = await fetch(portalUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
        'X-Member-ID': config.memberId,
      },
      body: JSON.stringify({
        reportType: 'csam_detection',
        detectedAt: new Date(report.detectedAt).toISOString(),
        contentHash: {
          sha256: report.contentHash,
          perceptual: report.perceptualHash,
        },
        contentType: report.contentType,
        detection: {
          method: report.detectionMethod,
          confidence: report.confidence,
        },
        location: {
          service: report.location.service,
          url: report.location.path,
          timestamp: new Date(report.location.timestamp).toISOString(),
        },
        uploaderInfo: report.uploaderAddress ? {
          identifier: report.uploaderAddress,
          ipAddress: report.uploaderIp,
          userAgent: report.userAgent,
        } : undefined,
        internalReportId: report.reportId,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      logger.error('[CSAMReporting] IWF submission failed', {
        reportId: report.reportId,
        status: response.status,
        statusText: response.statusText,
        response: text.slice(0, 500),
      })
      throw new Error(`IWF API error: ${response.status} ${response.statusText}`)
    }

    const result = await response.json() as { reportId: string; status: string }
    report.authorityReportId = result.reportId
    report.reportedAt = Date.now()
    report.status = 'submitted'

    // Persist status update
    await updateCSAMReportStatus(report.reportId, 'submitted', report.authorityReportId)

    logger.info('[CSAMReporting] Report submitted to IWF', {
      reportId: report.reportId,
      iwfReportId: report.authorityReportId,
    })
  }

  /**
   * Get all reports (for compliance auditing)
   */
  async getReports(filter?: {
    status?: CSAMReport['status']
    startTime?: number
    endTime?: number
    limit?: number
  }): Promise<CSAMReport[]> {
    return getPersistedReports(filter)
  }

  /**
   * Get report statistics (for transparency reporting)
   */
  async getStats(): Promise<{
    total: number
    pending: number
    submitted: number
    acknowledged: number
    failed: number
  }> {
    return getCSAMReportStats()
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

export async function registerTrustedFlagger(flagger: TrustedFlagger): Promise<void> {
  await saveTrustedFlagger(flagger)
  logger.info('[TrustedFlagger] Registered', { id: flagger.id, name: flagger.name })
}

export async function getTrustedFlagger(apiKey: string): Promise<TrustedFlagger | undefined> {
  return getTrustedFlaggerByApiKey(apiKey)
}

export async function getAllTrustedFlaggers(): Promise<Omit<TrustedFlagger, 'apiKey'>[]> {
  return listTrustedFlaggers()
}

