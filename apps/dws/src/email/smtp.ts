/**
 * SMTP Submission Server
 * 
 * Handles authenticated SMTP submission (port 587):
 * - OAuth3 authentication
 * - Content screening before relay
 * - Rate limiting based on staking tier
 * - DKIM signing for outbound
 */

import type { Address, Hex } from 'viem';
import type { SMTPSession, SMTPState, EmailTier } from './types';
import { getEmailRelayService } from './relay';
import { getContentScreeningPipeline } from './content-screening';

// ============ Configuration ============

interface SMTPServerConfig {
  host: string;
  port: number;
  tlsCert: string;
  tlsKey: string;
  oauth3Endpoint: string;
  emailDomain: string;
  dkimSelector: string;
  dkimPrivateKey: string;
}

// ============ SMTP Server ============

export class SMTPServer {
  private config: SMTPServerConfig;
  private sessions: Map<string, SMTPSession> = new Map();

  constructor(config: SMTPServerConfig) {
    this.config = config;
  }

  /**
   * Start SMTP server
   */
  async start(): Promise<void> {
    console.log(`[SMTP] Starting SMTP submission server on ${this.config.host}:${this.config.port}`);
    // TODO: Start actual SMTP server (use nodemailer/smtp-server or Postfix)
  }

  /**
   * Stop SMTP server
   */
  async stop(): Promise<void> {
    console.log('[SMTP] Stopping SMTP server');
  }

  /**
   * Create new SMTP session
   */
  createSession(clientIp: string): SMTPSession {
    const session: SMTPSession = {
      id: `smtp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      clientIp,
      authenticated: false,
      rcptTo: [],
      dataBuffer: '',
      state: 'connected',
    };

    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Handle EHLO/HELO command
   */
  handleEhlo(sessionId: string, hostname: string): string[] {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    session.state = 'greeted';

    return [
      `250-${this.config.host} Hello ${hostname}`,
      '250-SIZE 52428800', // 50MB limit
      '250-8BITMIME',
      '250-STARTTLS',
      '250-AUTH PLAIN LOGIN XOAUTH2',
      '250-PIPELINING',
      '250-CHUNKING',
      '250-SMTPUTF8',
      '250 OK',
    ];
  }

  /**
   * Handle AUTH command
   */
  async handleAuth(
    sessionId: string,
    mechanism: string,
    credentials: string
  ): Promise<{ success: boolean; error?: string }> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    if (mechanism === 'XOAUTH2') {
      // OAuth2 authentication
      const token = this.parseXOAuth2(credentials);
      return this.authenticateOAuth2(sessionId, token);
    }

    if (mechanism === 'PLAIN') {
      // PLAIN authentication (base64 encoded)
      const decoded = Buffer.from(credentials, 'base64').toString();
      const [, username, password] = decoded.split('\0');
      
      // Validate against OAuth3
      return this.authenticatePlain(sessionId, username ?? '', password ?? '');
    }

    return { success: false, error: 'Unsupported auth mechanism' };
  }

  private parseXOAuth2(credentials: string): string {
    // XOAUTH2 format: base64("user=" + user + "^Aauth=Bearer " + token + "^A^A")
    const decoded = Buffer.from(credentials, 'base64').toString();
    const match = decoded.match(/auth=Bearer\s+([^\x01]+)/);
    return match?.[1] ?? '';
  }

  private async authenticateOAuth2(
    sessionId: string,
    token: string
  ): Promise<{ success: boolean; error?: string }> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    const response = await fetch(`${this.config.oauth3Endpoint}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      return { success: false, error: 'Invalid token' };
    }

    const data = await response.json() as {
      valid: boolean;
      address?: Address;
      email?: string;
    };

    if (!data.valid || !data.address) {
      return { success: false, error: 'Token validation failed' };
    }

    session.authenticated = true;
    session.user = data.address;
    session.email = data.email;

    return { success: true };
  }

  private async authenticatePlain(
    sessionId: string,
    username: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    // For Jeju Mail, password is the OAuth3 session token
    return this.authenticateOAuth2(sessionId, password);
  }

  /**
   * Handle MAIL FROM command
   */
  handleMailFrom(
    sessionId: string,
    from: string
  ): { success: boolean; error?: string } {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    if (!session.authenticated) {
      return { success: false, error: 'Authentication required' };
    }

    // Verify sender is authorized (must match authenticated email)
    const fromEmail = this.parseEmailAddress(from);
    if (session.email && fromEmail !== session.email) {
      return { success: false, error: 'Sender address not authorized' };
    }

    session.mailFrom = from;
    session.state = 'mail_from';

    return { success: true };
  }

  /**
   * Handle RCPT TO command
   */
  handleRcptTo(
    sessionId: string,
    to: string
  ): { success: boolean; error?: string } {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    if (session.state !== 'mail_from' && session.state !== 'rcpt_to') {
      return { success: false, error: 'MAIL FROM required first' };
    }

    // Check recipient limit (based on tier)
    const tier = this.getUserTier(session.user);
    const maxRecipients = tier === 'free' ? 5 : tier === 'staked' ? 50 : 500;

    if (session.rcptTo.length >= maxRecipients) {
      return { success: false, error: `Maximum ${maxRecipients} recipients` };
    }

    // Check if external sending is allowed
    const toEmail = this.parseEmailAddress(to);
    const isExternal = !toEmail.endsWith(`@${this.config.emailDomain}`);

    if (isExternal && tier === 'free') {
      return { 
        success: false, 
        error: 'External recipients require staked account' 
      };
    }

    session.rcptTo.push(to);
    session.state = 'rcpt_to';

    return { success: true };
  }

  /**
   * Handle DATA command
   */
  async handleData(
    sessionId: string,
    data: string
  ): Promise<{ success: boolean; messageId?: Hex; error?: string }> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    if (session.state !== 'rcpt_to') {
      return { success: false, error: 'RCPT TO required first' };
    }

    if (!session.mailFrom || session.rcptTo.length === 0) {
      return { success: false, error: 'No recipients' };
    }

    session.dataBuffer = data;
    session.state = 'data';

    // Parse email
    const parsed = this.parseEmail(data);

    // Content screening
    const screening = getContentScreeningPipeline();
    const result = await screening.screenEmail(
      {
        id: '0x0' as Hex,
        from: { localPart: '', domain: '', full: session.mailFrom },
        to: session.rcptTo.map(t => ({ localPart: '', domain: '', full: t })),
        timestamp: Date.now(),
        encryptedContent: { ciphertext: '0x' as Hex, nonce: '0x' as Hex, ephemeralKey: '0x' as Hex, recipients: [] },
        isExternal: false,
        priority: 'normal',
        signature: '0x' as Hex,
      },
      {
        subject: parsed.subject,
        bodyText: parsed.body,
        headers: parsed.headers,
        attachments: [],
      },
      session.user ?? ('0x0' as Address)
    );

    if (!result.passed) {
      if (result.action === 'block_and_ban') {
        return { 
          success: false, 
          error: 'Message rejected due to content policy violation. Account flagged for review.' 
        };
      }
      if (result.action === 'reject') {
        return { success: false, error: 'Message rejected by content filter' };
      }
    }

    // Submit to relay service
    const relay = getEmailRelayService();
    const tier = this.getUserTier(session.user);
    
    const response = await relay.sendEmail(
      {
        from: session.mailFrom,
        to: session.rcptTo,
        subject: parsed.subject,
        bodyText: parsed.body,
        bodyHtml: parsed.html,
      },
      session.user ?? ('0x0' as Address),
      tier
    );

    // Reset session for next message
    session.mailFrom = undefined;
    session.rcptTo = [];
    session.dataBuffer = '';
    session.state = 'greeted';

    return {
      success: response.success,
      messageId: response.messageId,
      error: response.error,
    };
  }

  /**
   * Handle QUIT command
   */
  handleQuit(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private parseEmailAddress(address: string): string {
    // Extract email from "Name <email@domain>" or "<email@domain>" format
    const match = address.match(/<([^>]+)>/) ?? address.match(/([^\s<>]+@[^\s<>]+)/);
    return match?.[1] ?? address;
  }

  private parseEmail(raw: string): {
    subject: string;
    body: string;
    html?: string;
    headers: Record<string, string>;
  } {
    const lines = raw.split('\r\n');
    const headers: Record<string, string> = {};
    let bodyStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === '') {
        bodyStart = i + 1;
        break;
      }
      const [key, ...values] = line.split(':');
      if (key && values.length > 0) {
        headers[key.toLowerCase().trim()] = values.join(':').trim();
      }
    }

    const body = lines.slice(bodyStart).join('\r\n');

    return {
      subject: headers['subject'] ?? '',
      body,
      headers,
    };
  }

  private getUserTier(user?: Address): EmailTier {
    // TODO: Look up from contract
    return user ? 'staked' : 'free';
  }

  /**
   * Sign message with DKIM
   */
  signDKIM(message: string): string {
    // TODO: Implement DKIM signing
    // Uses config.dkimPrivateKey and config.dkimSelector
    return message;
  }
}

// ============ Factory ============

export function createSMTPServer(config: SMTPServerConfig): SMTPServer {
  return new SMTPServer(config);
}

// ============ Postfix Configuration Generator ============

export function generatePostfixConfig(config: {
  hostname: string;
  emailDomain: string;
  relayHost: string;
}): string {
  return `
# Postfix configuration for Jeju Mail
# Generated by jeju-email service

# Basic settings
myhostname = ${config.hostname}
mydomain = ${config.emailDomain}
myorigin = $mydomain
mydestination = $myhostname, localhost.$mydomain, localhost, $mydomain

# Relay
relayhost = ${config.relayHost}

# TLS
smtpd_tls_cert_file = /etc/ssl/certs/jeju-mail.pem
smtpd_tls_key_file = /etc/ssl/private/jeju-mail.key
smtpd_tls_security_level = may
smtp_tls_security_level = may

# SASL Authentication
smtpd_sasl_type = dovecot
smtpd_sasl_path = private/auth
smtpd_sasl_auth_enable = yes
smtpd_sasl_security_options = noanonymous
smtpd_sasl_tls_security_options = noanonymous

# Restrictions
smtpd_recipient_restrictions = 
    permit_sasl_authenticated,
    reject_unauth_destination

# Size limits
message_size_limit = 52428800
mailbox_size_limit = 0

# Queue
maximal_queue_lifetime = 1d
bounce_queue_lifetime = 1d
`;
}
