/**
 * SMTP Submission Server
 * 
 * Handles authenticated SMTP submission (port 587):
 * - OAuth3 authentication
 * - Content screening before relay
 * - Rate limiting based on staking tier
 * - DKIM signing for outbound
 */

import { createServer, type Server, type Socket } from 'net';
import { createServer as createTLSServer, TLSSocket } from 'tls';
import { readFileSync } from 'fs';
import { createPublicClient, http, type Address, type Hex, parseAbiItem } from 'viem';
import type { SMTPSession, EmailTier } from './types';
import { getEmailRelayService } from './relay';
import { getContentScreeningPipeline } from './content-screening';
import { activeSessions, authAttemptsTotal } from './metrics';

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
  rpcUrl?: string;
  emailRegistryAddress?: Address;
}

// ============ Contract ABI ============

const EMAIL_REGISTRY_ABI = [
  parseAbiItem('function getAccount(address owner) view returns (address owner_, bytes32 publicKeyHash, bytes32 jnsNode, uint8 status, uint8 tier, uint256 stakedAmount, uint256 quotaUsedBytes, uint256 quotaLimitBytes, uint256 emailsSentToday, uint256 lastResetTimestamp, uint256 createdAt, uint256 lastActivityAt)'),
] as const;

// ============ SMTP Server ============

export class SMTPServer {
  private config: SMTPServerConfig;
  private sessions: Map<string, SMTPSession> = new Map();
  private publicClient: ReturnType<typeof createPublicClient> | null = null;
  private tierCache: Map<Address, { tier: EmailTier; expiresAt: number }> = new Map();
  private server: Server | null = null;
  private connections: Map<string, Socket | TLSSocket> = new Map();

  constructor(config: SMTPServerConfig) {
    this.config = config;
    
    // Initialize public client for contract queries
    if (config.rpcUrl && config.emailRegistryAddress) {
      this.publicClient = createPublicClient({
        transport: http(config.rpcUrl),
      });
    }
  }

  /**
   * Start SMTP submission server
   * Handles TLS-wrapped connections on port 465 or STARTTLS on 587
   */
  async start(): Promise<void> {
    console.log(`[SMTP] Starting SMTP submission server on ${this.config.host}:${this.config.port}`);
    
    const isImplicitTLS = this.config.port === 465;
    
    if (isImplicitTLS) {
      // Port 465 - Implicit TLS (SMTPS)
      const tlsOptions = {
        cert: readFileSync(this.config.tlsCert),
        key: readFileSync(this.config.tlsKey),
      };
      
      this.server = createTLSServer(tlsOptions, (socket) => {
        this.handleConnection(socket);
      });
    } else {
      // Port 587 - STARTTLS
      this.server = createServer((socket) => {
        this.handleConnection(socket);
      });
    }
    
    this.server.on('error', (error: Error) => {
      console.error('[SMTP] Server error:', error.message);
    });
    
    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        console.log(`[SMTP] SMTP server listening on ${this.config.host}:${this.config.port}`);
        resolve();
      });
      
      this.server!.once('error', reject);
    });
  }

  /**
   * Stop SMTP server
   */
  async stop(): Promise<void> {
    console.log('[SMTP] Stopping SMTP server');
    
    // Close all active connections
    for (const [sessionId, socket] of this.connections) {
      socket.write('421 Service closing transmission channel\r\n');
      socket.end();
      this.sessions.delete(sessionId);
    }
    this.connections.clear();
    
    // Close server
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }
    
    console.log('[SMTP] SMTP server stopped');
  }

  /**
   * Handle new SMTP connection
   */
  private handleConnection(socket: Socket | TLSSocket): void {
    const sessionId = `smtp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const remoteAddress = socket.remoteAddress ?? 'unknown';
    
    console.log(`[SMTP] New connection from ${remoteAddress} (session: ${sessionId})`);
    
    this.sessions.set(sessionId, {
      id: sessionId,
      clientIp: remoteAddress,
      state: 'connected',
      authenticated: false,
      mailFrom: '',
      rcptTo: [],
      dataBuffer: '',
    });
    
    this.connections.set(sessionId, socket);
    activeSessions.inc({ protocol: 'smtp' });
    
    // Send greeting
    socket.write(`220 ${this.config.emailDomain} ESMTP Jeju Mail\r\n`);
    
    let inputBuffer = '';
    let inData = false;
    
    socket.on('data', async (data: Buffer) => {
      inputBuffer += data.toString();
      
      while (true) {
        if (inData) {
          // In DATA mode - look for end of data marker
          const endMarker = inputBuffer.indexOf('\r\n.\r\n');
          if (endMarker !== -1) {
            const emailData = inputBuffer.slice(0, endMarker);
            inputBuffer = inputBuffer.slice(endMarker + 5);
            inData = false;
            
            // Process the email
            const result = await this.processDataCommand(sessionId, emailData);
            socket.write(result + '\r\n');
          } else {
            break;
          }
        } else {
          // In command mode - look for CRLF
          const lineEnd = inputBuffer.indexOf('\r\n');
          if (lineEnd === -1) break;
          
          const line = inputBuffer.slice(0, lineEnd);
          inputBuffer = inputBuffer.slice(lineEnd + 2);
          
          const result = await this.processCommand(sessionId, line, socket);
          
          if (result === 'DATA_MODE') {
            inData = true;
            socket.write('354 Start mail input; end with <CRLF>.<CRLF>\r\n');
          } else if (result === 'QUIT') {
            socket.end();
            return;
          } else {
            socket.write(result + '\r\n');
          }
        }
      }
    });
    
    const cleanupSession = () => {
      if (this.sessions.has(sessionId)) {
        this.sessions.delete(sessionId);
        this.connections.delete(sessionId);
        activeSessions.dec({ protocol: 'smtp' });
      }
    };

    socket.on('close', () => {
      console.log(`[SMTP] Connection closed (session: ${sessionId})`);
      cleanupSession();
    });
    
    socket.on('error', (error: Error) => {
      console.error(`[SMTP] Socket error (session: ${sessionId}):`, error.message);
      cleanupSession();
    });
  }

  /**
   * Process SMTP command
   */
  private async processCommand(
    sessionId: string,
    line: string,
    socket: Socket | TLSSocket
  ): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) return '421 Service not available';
    
    const [command, ...args] = line.split(' ');
    const cmd = command.toUpperCase();
    
    switch (cmd) {
      case 'EHLO':
      case 'HELO': {
        session.state = 'greeted';
        const extensions = [
          `250-${this.config.emailDomain} Hello`,
          '250-AUTH PLAIN LOGIN XOAUTH2',
          '250-SIZE 52428800',
          '250-8BITMIME',
          '250-PIPELINING',
          '250 STARTTLS',
        ];
        return extensions.join('\r\n');
      }
      
      case 'STARTTLS': {
        if (socket instanceof TLSSocket) {
          return '454 TLS not available due to temporary reason';
        }
        // Note: In a real implementation, you'd upgrade the socket to TLS here
        // This requires handling at the connection level
        return '220 Ready to start TLS';
      }
      
      case 'AUTH': {
        const mechanism = args[0]?.toUpperCase();
        const credentials = args.slice(1).join(' ');
        
        const result = await this.handleAuth(sessionId, mechanism, credentials);
        return result.success ? '235 Authentication successful' : `535 ${result.error ?? 'Authentication failed'}`;
      }
      
      case 'MAIL': {
        const fromMatch = line.match(/FROM:<([^>]*)>/i);
        if (!fromMatch) return '501 Syntax error in parameters';
        
        const result = this.handleMailFrom(sessionId, fromMatch[1]);
        return result.success ? '250 OK' : `550 ${result.error}`;
      }
      
      case 'RCPT': {
        const toMatch = line.match(/TO:<([^>]*)>/i);
        if (!toMatch) return '501 Syntax error in parameters';
        
        const result = await this.handleRcptTo(sessionId, toMatch[1]);
        return result.success ? '250 OK' : `550 ${result.error}`;
      }
      
      case 'DATA': {
        if (session.state !== 'rcpt_to') {
          return '503 Bad sequence of commands';
        }
        session.state = 'data';
        return 'DATA_MODE';
      }
      
      case 'RSET': {
        session.mailFrom = '';
        session.rcptTo = [];
        session.dataBuffer = '';
        session.state = 'greeted';
        return '250 OK';
      }
      
      case 'NOOP':
        return '250 OK';
      
      case 'QUIT':
        return 'QUIT';
      
      default:
        return '502 Command not implemented';
    }
  }

  /**
   * Process DATA command content
   */
  private async processDataCommand(sessionId: string, data: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) return '421 Service not available';
    
    session.dataBuffer = data;
    
    // Process the email
    const result = await this.handleData(sessionId, data);
    
    // Reset for next message
    session.mailFrom = '';
    session.rcptTo = [];
    session.dataBuffer = '';
    session.state = 'greeted';
    
    return result.success 
      ? `250 OK: queued as ${result.messageId}` 
      : `550 ${result.error}`;
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.server !== null && this.server.listening;
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
   * Get existing session
   */
  getSession(sessionId: string): SMTPSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Destroy session
   */
  destroySession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Handle EHLO/HELO command (alias for handleEhlo)
   */
  handleGreeting(sessionId: string, hostname: string): { success: boolean; extensions: string[] } {
    const extensions = this.handleEhlo(sessionId, hostname);
    return { success: true, extensions };
  }

  /**
   * Handle RSET command
   */
  handleReset(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    session.mailFrom = '';
    session.rcptTo = [];
    session.dataBuffer = '';
    session.state = 'greeted';
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
      authAttemptsTotal.inc({ protocol: 'smtp', mechanism: 'oauth2', status: 'failure' });
      return { success: false, error: 'Invalid token' };
    }

    const data = await response.json() as {
      valid: boolean;
      address?: Address;
      email?: string;
    };

    if (!data.valid || !data.address) {
      authAttemptsTotal.inc({ protocol: 'smtp', mechanism: 'oauth2', status: 'failure' });
      return { success: false, error: 'Token validation failed' };
    }

    session.authenticated = true;
    session.user = data.address;
    session.email = data.email;

    authAttemptsTotal.inc({ protocol: 'smtp', mechanism: 'oauth2', status: 'success' });
    return { success: true };
  }

  private async authenticatePlain(
    sessionId: string,
    _username: string, // Username is ignored - OAuth3 token is used from password field
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
  async handleRcptTo(
    sessionId: string,
    to: string
  ): Promise<{ success: boolean; error?: string }> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    if (session.state !== 'mail_from' && session.state !== 'rcpt_to') {
      return { success: false, error: 'MAIL FROM required first' };
    }

    // Check recipient limit (based on tier)
    const tier = await this.getUserTier(session.user);
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
    const tier = await this.getUserTier(session.user);
    
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

  /**
   * Get user tier from EmailRegistry contract
   * Uses caching to avoid excessive RPC calls
   */
  private async getUserTier(user?: Address): Promise<EmailTier> {
    if (!user) return 'free';
    
    // Check cache first
    const cached = this.tierCache.get(user);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.tier;
    }
    
    // If no contract configured, default to free
    if (!this.publicClient || !this.config.emailRegistryAddress) {
      return 'free';
    }

    const account = await this.publicClient.readContract({
      address: this.config.emailRegistryAddress,
      abi: EMAIL_REGISTRY_ABI,
      functionName: 'getAccount',
      args: [user],
    }).catch((e: Error) => {
      console.warn(`[SMTP] Failed to get account tier for ${user}: ${e.message}`);
      return null;
    });

    if (!account) return 'free';

    // Tier enum: 0=FREE, 1=STAKED, 2=PREMIUM
    const tierMap: Record<number, EmailTier> = {
      0: 'free',
      1: 'staked',
      2: 'premium',
    };

    const tier = tierMap[account[4]] ?? 'free';
    
    // Cache for 5 minutes
    this.tierCache.set(user, {
      tier,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    return tier;
  }

  /**
   * Sign message with DKIM (DomainKeys Identified Mail)
   * Uses RSA-SHA256 signature algorithm with relaxed/relaxed canonicalization
   */
  signDKIM(message: string): string {
    if (!this.config.dkimPrivateKey || !this.config.dkimSelector) {
      console.warn('[SMTP] DKIM not configured - sending unsigned');
      return message;
    }

    const { createSign, createHash } = require('crypto');

    // Parse headers and body
    const [headerSection, ...bodyParts] = message.split(/\r?\n\r?\n/);
    const body = bodyParts.join('\r\n\r\n');
    const headers = this.parseHeadersForDKIM(headerSection);

    // Canonicalize body (relaxed canonicalization)
    const canonicalizedBody = this.canonicalizeBodyForDKIM(body);
    
    // Hash the body
    const bodyHash = createHash('sha256')
      .update(canonicalizedBody)
      .digest('base64');

    // Headers to sign
    const headersToSign = ['from', 'to', 'subject', 'date', 'message-id', 'mime-version', 'content-type']
      .filter(h => headers[h]);

    // Create DKIM-Signature parameters
    const timestamp = Math.floor(Date.now() / 1000);
    const dkimParams: Record<string, string> = {
      v: '1',
      a: 'rsa-sha256',
      c: 'relaxed/relaxed',
      d: this.config.emailDomain,
      s: this.config.dkimSelector,
      t: timestamp.toString(),
      bh: bodyHash,
      h: headersToSign.join(':'),
      b: '',
    };

    // Canonicalize headers for signing
    const canonicalizedHeaders = headersToSign
      .map(h => this.canonicalizeHeaderForDKIM(h, headers[h]))
      .join('\r\n');

    // Build DKIM header without signature for signing
    const dkimHeaderWithoutSig = `dkim-signature:${Object.entries(dkimParams)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')}`;
    
    const dataToSign = canonicalizedHeaders + '\r\n' + dkimHeaderWithoutSig;

    // Sign with RSA-SHA256
    const sign = createSign('RSA-SHA256');
    sign.update(dataToSign);
    
    let privateKey = this.config.dkimPrivateKey;
    if (!privateKey.includes('-----BEGIN')) {
      privateKey = `-----BEGIN RSA PRIVATE KEY-----\n${privateKey}\n-----END RSA PRIVATE KEY-----`;
    }
    
    const signature = sign.sign(privateKey, 'base64');
    dkimParams.b = signature;

    // Build final DKIM-Signature header
    const dkimSignatureHeader = `DKIM-Signature: ${Object.entries(dkimParams)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')}`;

    return dkimSignatureHeader + '\r\n' + message;
  }

  private canonicalizeBodyForDKIM(body: string): string {
    let canonical = body.replace(/[ \t]+/g, ' ');
    canonical = canonical.split('\r\n')
      .map(line => line.trimEnd())
      .join('\r\n');
    canonical = canonical.replace(/(\r\n)*$/, '');
    return canonical + '\r\n';
  }

  private canonicalizeHeaderForDKIM(name: string, value: string): string {
    const canonicalName = name.toLowerCase();
    let canonicalValue = value.replace(/\r?\n[ \t]+/g, ' ');
    canonicalValue = canonicalValue.replace(/[ \t]+/g, ' ').trim();
    return `${canonicalName}:${canonicalValue}`;
  }

  private parseHeadersForDKIM(headerSection: string): Record<string, string> {
    const headers: Record<string, string> = {};
    const lines = headerSection.split(/\r?\n/);
    let currentHeader = '';
    let currentValue = '';
    
    for (const line of lines) {
      if (line.startsWith(' ') || line.startsWith('\t')) {
        currentValue += ' ' + line.trim();
      } else {
        if (currentHeader) {
          headers[currentHeader.toLowerCase()] = currentValue;
        }
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          currentHeader = line.slice(0, colonIndex);
          currentValue = line.slice(colonIndex + 1).trim();
        }
      }
    }
    
    if (currentHeader) {
      headers[currentHeader.toLowerCase()] = currentValue;
    }
    
    return headers;
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
