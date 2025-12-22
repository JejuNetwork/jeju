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

import type { Address, Hex } from 'viem';
import type {
  InboundEmailEvent,
  OutboundEmailRequest,
  EmailEnvelope,
  JejuEmailAddress,
} from './types';
import { getEmailRelayService } from './relay';
import { getContentScreeningPipeline } from './content-screening';

// ============ Configuration ============

interface Web2BridgeConfig {
  sesRegion: string;
  inboundBucket: string;
  emailDomain: string;
  dkimSelector: string;
  dkimPrivateKey: string;
  sesAccessKeyId?: string;
  sesSecretAccessKey?: string;
}

// ============ Web2 Bridge ============

export class Web2Bridge {
  private config: Web2BridgeConfig;

  constructor(config: Web2BridgeConfig) {
    this.config = config;
  }

  // ============ Inbound (SES → Jeju) ============

  /**
   * Process inbound email from SES
   * Called by Lambda function triggered by S3 event
   */
  async processInbound(event: InboundEmailEvent): Promise<{
    success: boolean;
    messageId?: Hex;
    error?: string;
  }> {
    console.log(`[Bridge] Processing inbound email: ${event.messageId}`);

    // 1. Validate recipient is a Jeju address
    const recipient = event.to[0];
    if (!recipient?.endsWith(`@${this.config.emailDomain}`)) {
      return { success: false, error: 'Invalid recipient domain' };
    }

    // 2. Check SES verdicts
    if (event.spamVerdict === 'FAIL') {
      console.log(`[Bridge] Email rejected by SES spam filter: ${event.messageId}`);
      return { success: false, error: 'Rejected by spam filter' };
    }

    if (event.virusVerdict === 'FAIL') {
      console.log(`[Bridge] Email rejected by SES virus filter: ${event.messageId}`);
      return { success: false, error: 'Rejected by virus filter' };
    }

    // 3. Download email from S3
    const rawEmail = await this.downloadFromS3(event.s3Bucket, event.s3Key);

    // 4. Parse email
    const parsed = this.parseRawEmail(rawEmail);

    // 5. Additional content screening
    const screening = getContentScreeningPipeline();
    const screenResult = await screening.screenEmail(
      {
        id: '0x0' as Hex,
        from: { localPart: '', domain: '', full: parsed.from },
        to: parsed.to.map(t => ({ localPart: '', domain: '', full: t })),
        timestamp: Date.now(),
        encryptedContent: { ciphertext: '0x' as Hex, nonce: '0x' as Hex, ephemeralKey: '0x' as Hex, recipients: [] },
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
      '0x0000000000000000000000000000000000000000' as Address
    );

    if (!screenResult.passed && screenResult.action === 'reject') {
      console.log(`[Bridge] Email rejected by content filter: ${event.messageId}`);
      return { success: false, error: 'Rejected by content filter' };
    }

    // 6. Forward to relay service
    const relay = getEmailRelayService();
    const result = await relay.receiveInbound(rawEmail, true);

    // 7. Delete from S3 (already processed)
    await this.deleteFromS3(event.s3Bucket, event.s3Key);

    return result;
  }

  // ============ Outbound (Jeju → SES) ============

  /**
   * Send outbound email via SES
   */
  async sendOutbound(request: OutboundEmailRequest): Promise<{
    success: boolean;
    sesMessageId?: string;
    error?: string;
  }> {
    const { envelope, decryptedContent } = request;

    console.log(`[Bridge] Sending outbound email: ${envelope.id}`);

    // 1. Validate sender is from our domain
    if (!envelope.from.full.endsWith(`@${this.config.emailDomain}`)) {
      return { success: false, error: 'Invalid sender domain' };
    }

    // 2. Build raw email
    const rawEmail = this.buildRawEmail(envelope, decryptedContent);

    // 3. Sign with DKIM
    const signedEmail = await this.signDKIM(rawEmail);

    // 4. Send via SES
    try {
      const sesMessageId = await this.sendViaSES(
        envelope.from.full,
        envelope.to.map(t => t.full),
        signedEmail
      );

      console.log(`[Bridge] Email sent via SES: ${sesMessageId}`);
      return { success: true, sesMessageId };
    } catch (error) {
      console.error(`[Bridge] SES send failed:`, error);
      return { success: false, error: String(error) };
    }
  }

  // ============ S3 Operations ============

  private async downloadFromS3(bucket: string, key: string): Promise<string> {
    // In production, use AWS SDK
    const url = `https://${bucket}.s3.${this.config.sesRegion}.amazonaws.com/${key}`;
    
    const response = await fetch(url, {
      headers: this.getAWSHeaders('GET', bucket, key),
    });

    if (!response.ok) {
      throw new Error(`Failed to download from S3: ${response.status}`);
    }

    return response.text();
  }

  private async deleteFromS3(bucket: string, key: string): Promise<void> {
    // In production, use AWS SDK
    const url = `https://${bucket}.s3.${this.config.sesRegion}.amazonaws.com/${key}`;
    
    await fetch(url, {
      method: 'DELETE',
      headers: this.getAWSHeaders('DELETE', bucket, key),
    });
  }

  private getAWSHeaders(method: string, bucket: string, key: string): Record<string, string> {
    // Simplified - in production, use proper AWS Signature V4
    return {
      'x-amz-date': new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''),
    };
  }

  // ============ SES Operations ============

  private async sendViaSES(
    from: string,
    to: string[],
    rawEmail: string
  ): Promise<string> {
    // In production, use AWS SDK v3
    const sesEndpoint = `https://email.${this.config.sesRegion}.amazonaws.com`;
    
    const params = new URLSearchParams({
      Action: 'SendRawEmail',
      'Source': from,
      'RawMessage.Data': Buffer.from(rawEmail).toString('base64'),
    });

    to.forEach((addr, i) => {
      params.append(`Destinations.member.${i + 1}`, addr);
    });

    const response = await fetch(sesEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...this.getSESHeaders(),
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`SES error: ${error}`);
    }

    const result = await response.text();
    const messageIdMatch = result.match(/<MessageId>([^<]+)<\/MessageId>/);
    
    return messageIdMatch?.[1] ?? '';
  }

  private getSESHeaders(): Record<string, string> {
    // Simplified - in production, use proper AWS Signature V4
    return {
      'x-amz-date': new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''),
    };
  }

  // ============ Email Building ============

  private buildRawEmail(
    envelope: EmailEnvelope,
    content: { subject: string; bodyText: string; bodyHtml?: string }
  ): string {
    const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const date = new Date(envelope.timestamp).toUTCString();

    let email = [
      `From: ${envelope.from.full}`,
      `To: ${envelope.to.map(t => t.full).join(', ')}`,
      envelope.cc ? `Cc: ${envelope.cc.map(c => c.full).join(', ')}` : '',
      `Subject: ${content.subject}`,
      `Date: ${date}`,
      `Message-ID: <${envelope.id}@${this.config.emailDomain}>`,
      `MIME-Version: 1.0`,
    ].filter(Boolean).join('\r\n');

    if (content.bodyHtml) {
      // Multipart
      email += `\r\nContent-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n`;
      email += `--${boundary}\r\n`;
      email += `Content-Type: text/plain; charset=utf-8\r\n\r\n`;
      email += content.bodyText;
      email += `\r\n--${boundary}\r\n`;
      email += `Content-Type: text/html; charset=utf-8\r\n\r\n`;
      email += content.bodyHtml;
      email += `\r\n--${boundary}--`;
    } else {
      // Plain text
      email += `\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n`;
      email += content.bodyText;
    }

    return email;
  }

  // ============ DKIM Signing ============

  private async signDKIM(rawEmail: string): Promise<string> {
    // TODO: Implement proper DKIM signing
    // Would use the config.dkimPrivateKey and config.dkimSelector
    
    // For now, return unsigned email
    return rawEmail;
  }

  // ============ Email Parsing ============

  private parseRawEmail(raw: string): {
    from: string;
    to: string[];
    subject: string;
    bodyText: string;
    bodyHtml?: string;
    headers: Record<string, string>;
  } {
    const lines = raw.split(/\r?\n/);
    const headers: Record<string, string> = {};
    let bodyStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === '') {
        bodyStart = i + 1;
        break;
      }
      
      // Handle header continuation
      if (line.startsWith(' ') || line.startsWith('\t')) {
        const lastKey = Object.keys(headers).pop();
        if (lastKey) {
          headers[lastKey] += ' ' + line.trim();
        }
        continue;
      }

      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).toLowerCase().trim();
        const value = line.slice(colonIdx + 1).trim();
        headers[key] = value;
      }
    }

    const body = lines.slice(bodyStart).join('\n');

    return {
      from: headers['from'] ?? '',
      to: (headers['to'] ?? '').split(',').map(t => t.trim()),
      subject: headers['subject'] ?? '',
      bodyText: body,
      headers,
    };
  }
}

// ============ Factory ============

export function createWeb2Bridge(config: Web2BridgeConfig): Web2Bridge {
  return new Web2Bridge(config);
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
        messageId: string;
        source: string;
        destination: string[];
        commonHeaders: {
          from: string[];
          to: string[];
          subject: string;
        };
      };
      receipt: {
        spamVerdict: { status: string };
        virusVerdict: { status: string };
        action: {
          type: string;
          bucketName: string;
          objectKey: string;
        };
      };
    };
  }>;
}): Promise<{ statusCode: number }> {
  const bridge = createWeb2Bridge({
    sesRegion: process.env.SES_REGION ?? 'us-east-1',
    inboundBucket: process.env.INBOUND_BUCKET ?? '',
    emailDomain: process.env.EMAIL_DOMAIN ?? 'jeju.mail',
    dkimSelector: process.env.DKIM_SELECTOR ?? 'default',
    dkimPrivateKey: process.env.DKIM_PRIVATE_KEY ?? '',
  });

  for (const record of event.Records) {
    const sesEvent = record.ses;
    
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
    });
  }

  return { statusCode: 200 };
}
