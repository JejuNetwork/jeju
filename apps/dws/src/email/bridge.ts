/**
 * Web2 Email Bridge
 *
 * Bidirectional SMTP gateway for external email:
 * - Inbound: SES → S3 → Lambda → Relay
 * - Outbound: Relay → SES → SMTP
 *
 * Only staked accounts can use the bridge.
 * Additional content screening for external traffic.
 */

import { createHash, createHmac, createSign } from 'node:crypto'
import type { Address, Hex } from 'viem'
import { getContentScreeningPipeline } from './content-screening'
import { bridgeOperationsTotal } from './metrics'
import { getEmailRelayService } from './relay'
import type {
  EmailEnvelope,
  InboundEmailEvent,
  OutboundEmailRequest,
} from './types'

// ============ Configuration ============

interface Web2BridgeConfig {
  sesRegion: string
  inboundBucket: string
  emailDomain: string
  dkimSelector: string
  dkimPrivateKey: string
  sesAccessKeyId?: string
  sesSecretAccessKey?: string
}

// ============ Web2 Bridge ============

export class Web2Bridge {
  private config: Web2BridgeConfig

  constructor(config: Web2BridgeConfig) {
    this.config = config
  }

  // ============ Inbound (SES → Jeju) ============

  /**
   * Process inbound email from SES
   * Called by Lambda function triggered by S3 event
   */
  async processInbound(event: InboundEmailEvent): Promise<{
    success: boolean
    messageId?: Hex
    error?: string
  }> {
    console.log(`[Bridge] Processing inbound email: ${event.messageId}`)

    const recipient = event.to[0]
    if (!recipient?.endsWith(`@${this.config.emailDomain}`)) {
      bridgeOperationsTotal.inc({
        direction: 'inbound',
        status: 'rejected_domain',
      })
      return { success: false, error: 'Invalid recipient domain' }
    }

    if (event.spamVerdict === 'FAIL') {
      console.log(
        `[Bridge] Email rejected by SES spam filter: ${event.messageId}`,
      )
      bridgeOperationsTotal.inc({
        direction: 'inbound',
        status: 'rejected_spam',
      })
      return { success: false, error: 'Rejected by spam filter' }
    }

    if (event.virusVerdict === 'FAIL') {
      console.log(
        `[Bridge] Email rejected by SES virus filter: ${event.messageId}`,
      )
      bridgeOperationsTotal.inc({
        direction: 'inbound',
        status: 'rejected_virus',
      })
      return { success: false, error: 'Rejected by virus filter' }
    }

    // 3. Download email from S3
    const rawEmail = await this.downloadFromS3(event.s3Bucket, event.s3Key)

    // 4. Parse email
    const parsed = this.parseRawEmail(rawEmail)

    // 5. Additional content screening
    const screening = getContentScreeningPipeline()
    const screenResult = await screening.screenEmail(
      {
        id: '0x0' as Hex,
        from: { localPart: '', domain: '', full: parsed.from },
        to: parsed.to.map((t) => ({ localPart: '', domain: '', full: t })),
        timestamp: Date.now(),
        encryptedContent: {
          ciphertext: '0x' as Hex,
          nonce: '0x' as Hex,
          ephemeralKey: '0x' as Hex,
          recipients: [],
        },
        isExternal: true,
        priority: 'normal',
        signature: '0x' as Hex,
      },
      {
        subject: parsed.subject,
        bodyText: parsed.bodyText,
        bodyHtml: parsed.bodyHtml,
        headers: parsed.headers,
        attachments: [],
      },
      '0x0000000000000000000000000000000000000000' as Address,
    )

    if (!screenResult.passed && screenResult.action === 'reject') {
      console.log(
        `[Bridge] Email rejected by content filter: ${event.messageId}`,
      )
      bridgeOperationsTotal.inc({
        direction: 'inbound',
        status: 'rejected_content',
      })
      return { success: false, error: 'Rejected by content filter' }
    }

    const relay = getEmailRelayService()
    const result = await relay.receiveInbound(rawEmail, true)

    await this.deleteFromS3(event.s3Bucket, event.s3Key)

    bridgeOperationsTotal.inc({
      direction: 'inbound',
      status: result.success ? 'success' : 'failed',
    })
    return result
  }

  // ============ Outbound (Jeju → SES) ============

  /**
   * Send outbound email via SES
   */
  async sendOutbound(request: OutboundEmailRequest): Promise<{
    success: boolean
    sesMessageId?: string
    error?: string
  }> {
    const { envelope, decryptedContent } = request

    console.log(`[Bridge] Sending outbound email: ${envelope.id}`)

    if (!envelope.from.full.endsWith(`@${this.config.emailDomain}`)) {
      bridgeOperationsTotal.inc({
        direction: 'outbound',
        status: 'rejected_domain',
      })
      return { success: false, error: 'Invalid sender domain' }
    }

    const rawEmail = this.buildRawEmail(envelope, decryptedContent)
    const signedEmail = await this.signDKIM(rawEmail)

    try {
      const sesMessageId = await this.sendViaSES(
        envelope.from.full,
        envelope.to.map((t) => t.full),
        signedEmail,
      )

      console.log(`[Bridge] Email sent via SES: ${sesMessageId}`)
      bridgeOperationsTotal.inc({ direction: 'outbound', status: 'success' })
      return { success: true, sesMessageId }
    } catch (error) {
      console.error(`[Bridge] SES send failed:`, error)
      bridgeOperationsTotal.inc({ direction: 'outbound', status: 'failed' })
      return { success: false, error: String(error) }
    }
  }

  // ============ S3 Operations ============

  private async downloadFromS3(bucket: string, key: string): Promise<string> {
    const host = `${bucket}.s3.${this.config.sesRegion}.amazonaws.com`
    const url = `https://${host}/${key}`

    const headers = this.signAWSRequest('GET', host, `/${key}`, '', 's3')

    const response = await fetch(url, { headers })

    if (!response.ok) {
      throw new Error(`Failed to download from S3: ${response.status}`)
    }

    return response.text()
  }

  private async deleteFromS3(bucket: string, key: string): Promise<void> {
    const host = `${bucket}.s3.${this.config.sesRegion}.amazonaws.com`
    const url = `https://${host}/${key}`

    const headers = this.signAWSRequest('DELETE', host, `/${key}`, '', 's3')

    await fetch(url, {
      method: 'DELETE',
      headers,
    })
  }

  /**
   * Sign AWS request using Signature Version 4
   * Reference: https://docs.aws.amazon.com/general/latest/gr/sigv4_signing.html
   */
  private signAWSRequest(
    method: string,
    host: string,
    path: string,
    payload: string,
    service: string,
  ): Record<string, string> {
    const accessKeyId =
      this.config.sesAccessKeyId ?? process.env.AWS_ACCESS_KEY_ID ?? ''
    const secretAccessKey =
      this.config.sesSecretAccessKey ?? process.env.AWS_SECRET_ACCESS_KEY ?? ''

    if (!accessKeyId || !secretAccessKey) {
      throw new Error('AWS credentials not configured')
    }

    const region = this.config.sesRegion
    const now = new Date()
    const amzDate = `${now
      .toISOString()
      .replace(/[:-]|\.\d{3}/g, '')
      .slice(0, 15)}Z`
    const dateStamp = amzDate.slice(0, 8)

    // Create canonical request
    const canonicalUri = path || '/'
    const canonicalQuerystring = ''
    const payloadHash = createHash('sha256').update(payload).digest('hex')

    const canonicalHeaders = `${[
      `host:${host}`,
      `x-amz-content-sha256:${payloadHash}`,
      `x-amz-date:${amzDate}`,
    ].join('\n')}\n`

    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuerystring,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n')

    // Create string to sign
    const algorithm = 'AWS4-HMAC-SHA256'
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
    const canonicalRequestHash = createHash('sha256')
      .update(canonicalRequest)
      .digest('hex')

    const stringToSign = [
      algorithm,
      amzDate,
      credentialScope,
      canonicalRequestHash,
    ].join('\n')

    // Calculate signature
    const getSignatureKey = (
      key: string,
      date: string,
      regionName: string,
      serviceName: string,
    ): Buffer => {
      const kDate = createHmac('sha256', `AWS4${key}`).update(date).digest()
      const kRegion = createHmac('sha256', kDate).update(regionName).digest()
      const kService = createHmac('sha256', kRegion)
        .update(serviceName)
        .digest()
      return createHmac('sha256', kService).update('aws4_request').digest()
    }

    const signingKey = getSignatureKey(
      secretAccessKey,
      dateStamp,
      region,
      service,
    )
    const signature = createHmac('sha256', signingKey)
      .update(stringToSign)
      .digest('hex')

    // Build authorization header
    const authorizationHeader = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

    return {
      Host: host,
      'X-Amz-Date': amzDate,
      'X-Amz-Content-SHA256': payloadHash,
      Authorization: authorizationHeader,
    }
  }

  // ============ SES Operations ============

  private async sendViaSES(
    from: string,
    to: string[],
    rawEmail: string,
  ): Promise<string> {
    const host = `email.${this.config.sesRegion}.amazonaws.com`
    const sesEndpoint = `https://${host}`

    const params = new URLSearchParams({
      Action: 'SendRawEmail',
      Version: '2010-12-01',
      Source: from,
      'RawMessage.Data': Buffer.from(rawEmail).toString('base64'),
    })

    to.forEach((addr, i) => {
      params.append(`Destinations.member.${i + 1}`, addr)
    })

    const payload = params.toString()
    const headers = this.signAWSRequest('POST', host, '/', payload, 'ses')
    headers['Content-Type'] = 'application/x-www-form-urlencoded'

    const response = await fetch(sesEndpoint, {
      method: 'POST',
      headers,
      body: payload,
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`SES error: ${error}`)
    }

    const result = await response.text()
    const messageIdMatch = result.match(/<MessageId>([^<]+)<\/MessageId>/)

    return messageIdMatch?.[1] ?? ''
  }

  // ============ Email Building ============

  private buildRawEmail(
    envelope: EmailEnvelope,
    content: { subject: string; bodyText: string; bodyHtml?: string },
  ): string {
    const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const date = new Date(envelope.timestamp).toUTCString()

    let email = [
      `From: ${envelope.from.full}`,
      `To: ${envelope.to.map((t) => t.full).join(', ')}`,
      envelope.cc ? `Cc: ${envelope.cc.map((c) => c.full).join(', ')}` : '',
      `Subject: ${content.subject}`,
      `Date: ${date}`,
      `Message-ID: <${envelope.id}@${this.config.emailDomain}>`,
      `MIME-Version: 1.0`,
    ]
      .filter(Boolean)
      .join('\r\n')

    if (content.bodyHtml) {
      // Multipart
      email += `\r\nContent-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n`
      email += `--${boundary}\r\n`
      email += `Content-Type: text/plain; charset=utf-8\r\n\r\n`
      email += content.bodyText
      email += `\r\n--${boundary}\r\n`
      email += `Content-Type: text/html; charset=utf-8\r\n\r\n`
      email += content.bodyHtml
      email += `\r\n--${boundary}--`
    } else {
      // Plain text
      email += `\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n`
      email += content.bodyText
    }

    return email
  }

  // ============ DKIM Signing ============

  /**
   * Sign email with DKIM (DomainKeys Identified Mail)
   * Uses RSA-SHA256 signature algorithm with relaxed/relaxed canonicalization
   */
  private async signDKIM(rawEmail: string): Promise<string> {
    if (!this.config.dkimPrivateKey || !this.config.dkimSelector) {
      console.warn('[Web2Bridge] DKIM not configured - sending unsigned')
      return rawEmail
    }

    // Parse headers and body
    const [headerSection, ...bodyParts] = rawEmail.split(/\r?\n\r?\n/)
    const body = bodyParts.join('\r\n\r\n')
    const headers = this.parseHeaders(headerSection)

    // Canonicalize body (relaxed canonicalization)
    const canonicalizedBody = this.canonicalizeBody(body)

    // Hash the body
    const bodyHash = createHash('sha256')
      .update(canonicalizedBody)
      .digest('base64')

    // Headers to sign (in order of importance)
    const headersToSign = [
      'from',
      'to',
      'subject',
      'date',
      'message-id',
      'mime-version',
      'content-type',
    ].filter((h) => headers[h])

    // Create DKIM-Signature header (without signature value)
    const timestamp = Math.floor(Date.now() / 1000)
    const dkimParams = {
      v: '1',
      a: 'rsa-sha256',
      c: 'relaxed/relaxed',
      d: this.config.emailDomain,
      s: this.config.dkimSelector,
      t: timestamp.toString(),
      bh: bodyHash,
      h: headersToSign.join(':'),
      b: '', // Will be filled with signature
    }

    // Canonicalize headers for signing (relaxed canonicalization)
    const canonicalizedHeaders = headersToSign
      .map((h) => this.canonicalizeHeader(h, headers[h]))
      .join('\r\n')

    // Add DKIM-Signature header to be signed (without b= value)
    const dkimHeaderWithoutSig = `dkim-signature:${Object.entries(dkimParams)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')}`

    const dataToSign = `${canonicalizedHeaders}\r\n${dkimHeaderWithoutSig}`

    // Sign with RSA-SHA256
    const sign = createSign('RSA-SHA256')
    sign.update(dataToSign)

    // Parse private key (handle both PEM format and raw base64)
    let privateKey = this.config.dkimPrivateKey
    if (!privateKey.includes('-----BEGIN')) {
      privateKey = `-----BEGIN RSA PRIVATE KEY-----\n${privateKey}\n-----END RSA PRIVATE KEY-----`
    }

    const signature = sign.sign(privateKey, 'base64')
    dkimParams.b = signature

    // Build final DKIM-Signature header
    const dkimSignatureHeader = `DKIM-Signature: ${Object.entries(dkimParams)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')}`

    // Insert DKIM-Signature as first header
    return `${dkimSignatureHeader}\r\n${rawEmail}`
  }

  /**
   * Canonicalize body using relaxed canonicalization (RFC 6376)
   */
  private canonicalizeBody(body: string): string {
    // Reduce all whitespace sequences to single space
    let canonical = body.replace(/[ \t]+/g, ' ')

    // Remove trailing whitespace from lines
    canonical = canonical
      .split('\r\n')
      .map((line) => line.trimEnd())
      .join('\r\n')

    // Remove empty lines at end of body
    canonical = canonical.replace(/(\r\n)*$/, '')

    // Ensure body ends with CRLF
    return `${canonical}\r\n`
  }

  /**
   * Canonicalize header using relaxed canonicalization (RFC 6376)
   */
  private canonicalizeHeader(name: string, value: string): string {
    // Convert header name to lowercase
    const canonicalName = name.toLowerCase()

    // Unfold header value (remove CRLF before whitespace)
    let canonicalValue = value.replace(/\r?\n[ \t]+/g, ' ')

    // Reduce whitespace sequences to single space
    canonicalValue = canonicalValue.replace(/[ \t]+/g, ' ')

    // Trim leading/trailing whitespace
    canonicalValue = canonicalValue.trim()

    return `${canonicalName}:${canonicalValue}`
  }

  /**
   * Parse headers from header section
   */
  private parseHeaders(headerSection: string): Record<string, string> {
    const headers: Record<string, string> = {}
    const lines = headerSection.split(/\r?\n/)
    let currentHeader = ''
    let currentValue = ''

    for (const line of lines) {
      if (line.startsWith(' ') || line.startsWith('\t')) {
        // Continuation of previous header
        currentValue += ` ${line.trim()}`
      } else {
        // Save previous header
        if (currentHeader) {
          headers[currentHeader.toLowerCase()] = currentValue
        }

        // Parse new header
        const colonIndex = line.indexOf(':')
        if (colonIndex > 0) {
          currentHeader = line.slice(0, colonIndex)
          currentValue = line.slice(colonIndex + 1).trim()
        }
      }
    }

    // Save last header
    if (currentHeader) {
      headers[currentHeader.toLowerCase()] = currentValue
    }

    return headers
  }

  // ============ Email Parsing ============

  private parseRawEmail(raw: string): {
    from: string
    to: string[]
    subject: string
    bodyText: string
    bodyHtml?: string
    headers: Record<string, string>
  } {
    const lines = raw.split(/\r?\n/)
    const headers: Record<string, string> = {}
    let bodyStart = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line === '') {
        bodyStart = i + 1
        break
      }

      // Handle header continuation
      if (line.startsWith(' ') || line.startsWith('\t')) {
        const lastKey = Object.keys(headers).pop()
        if (lastKey) {
          headers[lastKey] += ` ${line.trim()}`
        }
        continue
      }

      const colonIdx = line.indexOf(':')
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).toLowerCase().trim()
        const value = line.slice(colonIdx + 1).trim()
        headers[key] = value
      }
    }

    const body = lines.slice(bodyStart).join('\n')

    return {
      from: headers.from ?? '',
      to: (headers.to ?? '').split(',').map((t) => t.trim()),
      subject: headers.subject ?? '',
      bodyText: body,
      headers,
    }
  }
}

// ============ Factory ============

export function createWeb2Bridge(config: Web2BridgeConfig): Web2Bridge {
  return new Web2Bridge(config)
}

// ============ Lambda Handler ============

/**
 * Lambda handler for SES inbound email processing
 * Deployed via Terraform
 */
export async function lambdaHandler(event: {
  Records: Array<{
    ses: {
      mail: {
        messageId: string
        source: string
        destination: string[]
        commonHeaders: {
          from: string[]
          to: string[]
          subject: string
        }
      }
      receipt: {
        spamVerdict: { status: string }
        virusVerdict: { status: string }
        action: {
          type: string
          bucketName: string
          objectKey: string
        }
      }
    }
  }>
}): Promise<{ statusCode: number }> {
  const bridge = createWeb2Bridge({
    sesRegion: process.env.SES_REGION ?? 'us-east-1',
    inboundBucket: process.env.INBOUND_BUCKET ?? '',
    emailDomain: process.env.EMAIL_DOMAIN ?? 'jeju.mail',
    dkimSelector: process.env.DKIM_SELECTOR ?? 'default',
    dkimPrivateKey: process.env.DKIM_PRIVATE_KEY ?? '',
  })

  for (const record of event.Records) {
    const sesEvent = record.ses

    await bridge.processInbound({
      messageId: sesEvent.mail.messageId,
      s3Bucket: sesEvent.receipt.action.bucketName,
      s3Key: sesEvent.receipt.action.objectKey,
      from: sesEvent.mail.source,
      to: sesEvent.mail.destination,
      subject: sesEvent.mail.commonHeaders.subject,
      receivedAt: Date.now(),
      spamVerdict: sesEvent.receipt.spamVerdict.status,
      virusVerdict: sesEvent.receipt.virusVerdict.status,
    })
  }

  return { statusCode: 200 }
}
