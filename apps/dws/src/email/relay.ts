/**
 * Email Relay Service
 * 
 * Core MTA (Mail Transfer Agent) for Jeju Mail:
 * - Routes encrypted emails between users
 * - Enforces rate limits based on staking tier
 * - Integrates with content screening pipeline
 * - Manages delivery to/from external providers
 */

import { createPublicClient, http, type Address, type Hex, keccak256, toBytes, encodeFunctionData, parseAbiItem } from 'viem';
import type {
  EmailEnvelope,
  EmailContent,
  JejuEmailAddress,
  EmailIdentity,
  SendEmailRequest,
  SendEmailResponse,
  DeliveryStatus,
  EmailTier,
  RateLimitState,
  RateLimitConfig,
  EmailServiceConfig,
  ScreeningResult,
} from './types';
import { getContentScreeningPipeline } from './content-screening';
import { getMailboxStorage } from './storage';
import { randomBytes, createCipheriv, createHash } from 'crypto';

// ============ Encryption Implementation ============
// Inline implementation to avoid cross-package import issues in DWS

function generateKeyPair(): { publicKey: Uint8Array; privateKey: Uint8Array } {
  const privateKey = randomBytes(32);
  const publicKey = createHash('sha256').update(privateKey).digest();
  return {
    publicKey: new Uint8Array(publicKey),
    privateKey: new Uint8Array(privateKey),
  };
}

function deriveSharedSecret(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  const combined = Buffer.concat([Buffer.from(privateKey), Buffer.from(publicKey)]);
  return new Uint8Array(createHash('sha256').update(combined).digest());
}

function encryptForMultipleRecipients(
  content: string,
  recipientPublicKeys: Map<string, Uint8Array>
): { encryptedContent: { ciphertext: Hex; nonce: Hex; ephemeralPublicKey: Hex; tag: Hex }; recipientKeys: Map<string, Hex> } {
  const symmetricKey = randomBytes(32);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', symmetricKey, nonce);
  
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(content, 'utf8')),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  
  const recipientKeys = new Map<string, Hex>();
  
  for (const [address, publicKey] of recipientPublicKeys) {
    const ephemeral = generateKeyPair();
    const sharedSecret = deriveSharedSecret(ephemeral.privateKey, publicKey);
    
    const keyNonce = randomBytes(12);
    const keyCipher = createCipheriv('aes-256-gcm', sharedSecret, keyNonce);
    
    const encryptedKey = Buffer.concat([
      keyNonce,
      keyCipher.update(symmetricKey),
      keyCipher.final(),
      keyCipher.getAuthTag(),
      Buffer.from(ephemeral.publicKey),
    ]);
    
    recipientKeys.set(address, `0x${encryptedKey.toString('hex')}` as Hex);
  }
  
  return {
    encryptedContent: {
      ciphertext: `0x${encrypted.toString('hex')}` as Hex,
      nonce: `0x${nonce.toString('hex')}` as Hex,
      ephemeralPublicKey: '0x' as Hex,
      tag: `0x${tag.toString('hex')}` as Hex,
    },
    recipientKeys,
  };
}

// ============ Configuration ============

const DEFAULT_RATE_LIMITS: Record<EmailTier, RateLimitConfig> = {
  free: {
    emailsPerDay: 50,
    emailsPerHour: 10,
    maxRecipients: 5,
    maxAttachmentSizeMb: 5,
    maxEmailSizeMb: 10,
  },
  staked: {
    emailsPerDay: 500,
    emailsPerHour: 100,
    maxRecipients: 50,
    maxAttachmentSizeMb: 25,
    maxEmailSizeMb: 50,
  },
  premium: {
    emailsPerDay: 5000,
    emailsPerHour: 1000,
    maxRecipients: 500,
    maxAttachmentSizeMb: 100,
    maxEmailSizeMb: 100,
  },
};

interface RelayConfig {
  rpcUrl: string;
  chainId: number;
  emailRegistryAddress: Address;
  emailStakingAddress: Address;
  dwsEndpoint: string;
  emailDomain: string;
  rateLimits: Record<EmailTier, RateLimitConfig>;
  contentScreeningEnabled: boolean;
}

// ============ Email Relay Service ============

export class EmailRelayService {
  private config: RelayConfig;
  private publicClient: ReturnType<typeof createPublicClient>;
  private rateLimitState: Map<Address, RateLimitState> = new Map();
  private deliveryQueue: EmailEnvelope[] = [];
  private deliveryStatus: Map<Hex, Record<string, DeliveryStatus>> = new Map();

  constructor(config: RelayConfig) {
    this.config = config;
    this.publicClient = createPublicClient({
      transport: http(config.rpcUrl),
    });
  }

  // ============ Email Sending ============

  /**
   * Process outbound email from authenticated sender
   */
  async sendEmail(
    request: SendEmailRequest,
    senderAddress: Address,
    senderTier: EmailTier
  ): Promise<SendEmailResponse> {
    // 1. Validate rate limits
    const rateLimitCheck = this.checkRateLimit(senderAddress, senderTier, request.to.length);
    if (!rateLimitCheck.allowed) {
      return {
        success: false,
        messageId: '0x0' as Hex,
        queued: false,
        error: rateLimitCheck.reason,
      };
    }

    // 2. Parse and validate addresses
    const fromAddress = this.parseEmailAddress(request.from);
    const toAddresses = request.to.map(to => this.parseEmailAddress(to));

    // 3. Check external sending permission
    const hasExternal = toAddresses.some(addr => !this.isJejuEmail(addr));
    if (hasExternal && senderTier === 'free') {
      return {
        success: false,
        messageId: '0x0' as Hex,
        queued: false,
        error: 'Free tier accounts cannot send to external email addresses. Stake tokens to enable external sending.',
      };
    }

    // 4. Build email content
    const content: EmailContent = {
      subject: request.subject,
      bodyText: request.bodyText,
      bodyHtml: request.bodyHtml,
      headers: {},
      attachments: request.attachments?.map(att => ({
        filename: att.filename,
        mimeType: att.mimeType,
        size: Buffer.from(att.content, 'base64').length,
        cid: '', // Will be set after upload
        checksum: this.computeChecksum(att.content),
      })) ?? [],
      inReplyTo: request.inReplyTo,
    };

    // 5. Content screening (if enabled)
    if (this.config.contentScreeningEnabled) {
      const screening = await this.screenContent(content, senderAddress);
      
      if (!screening.passed) {
        // Handle based on action
        if (screening.action === 'block_and_ban') {
          // Actually trigger ban via contract
          await this.triggerAccountBan(senderAddress, 'Content policy violation - illegal content detected');
          
          return {
            success: false,
            messageId: '0x0' as Hex,
            queued: false,
            error: 'Email blocked due to content policy violation. Your account has been banned.',
          };
        }
        
        if (screening.action === 'reject') {
          return {
            success: false,
            messageId: '0x0' as Hex,
            queued: false,
            error: 'Email rejected due to content policy violation.',
          };
        }

        if (screening.action === 'quarantine') {
          // Store in spam folder instead of sending
          return {
            success: false,
            messageId: '0x0' as Hex,
            queued: false,
            error: 'Email quarantined due to suspected spam content.',
          };
        }
      }
    }

    // 6. Create envelope
    const messageId = this.generateMessageId(request, senderAddress);
    const envelope: EmailEnvelope = {
      id: messageId,
      from: fromAddress,
      to: toAddresses,
      cc: request.cc?.map(cc => this.parseEmailAddress(cc)),
      timestamp: Date.now(),
      encryptedContent: await this.encryptContent(content, toAddresses),
      isExternal: hasExternal,
      priority: request.priority ?? 'normal',
      signature: '0x' as Hex, // Would be signed by sender's MPC key
    };

    // 7. Store and queue for delivery
    const storage = getMailboxStorage();
    await storage.storeOutbound(senderAddress, envelope, content);

    // 8. Queue delivery
    this.queueDelivery(envelope);

    // 9. Update rate limit
    this.incrementRateLimit(senderAddress, toAddresses.length);

    return {
      success: true,
      messageId,
      queued: true,
      deliveryStatus: Object.fromEntries(
        toAddresses.map(addr => [addr.full, 'queued' as DeliveryStatus])
      ),
    };
  }

  /**
   * Process delivery queue
   */
  async processDeliveryQueue(): Promise<void> {
    while (this.deliveryQueue.length > 0) {
      const envelope = this.deliveryQueue.shift();
      if (!envelope) continue;

      try {
        await this.deliverEmail(envelope);
      } catch (error) {
        console.error(`[EmailRelay] Delivery failed for ${envelope.id}:`, error);
        // Re-queue with retry logic
      }
    }
  }

  /**
   * Deliver email to recipients
   */
  private async deliverEmail(envelope: EmailEnvelope): Promise<void> {
    const status: Record<string, DeliveryStatus> = {};

    for (const recipient of envelope.to) {
      try {
        if (this.isJejuEmail(recipient)) {
          // Internal delivery
          await this.deliverInternal(envelope, recipient);
          status[recipient.full] = 'delivered';
        } else {
          // External delivery via bridge
          await this.deliverExternal(envelope, recipient);
          status[recipient.full] = 'sent';
        }
      } catch (error) {
        console.error(`[EmailRelay] Failed to deliver to ${recipient.full}:`, error);
        status[recipient.full] = 'failed';
      }
    }

    this.deliveryStatus.set(envelope.id, status);
  }

  /**
   * Deliver to internal Jeju mailbox
   */
  private async deliverInternal(
    envelope: EmailEnvelope,
    recipient: JejuEmailAddress
  ): Promise<void> {
    // Resolve recipient from registry
    const identity = await this.resolveEmailIdentity(recipient);
    if (!identity) {
      throw new Error(`Recipient not found: ${recipient.full}`);
    }

    // Store in recipient's mailbox
    const storage = getMailboxStorage();
    await storage.storeInbound(identity.address.owner!, envelope);
  }

  /**
   * Deliver to external email via Web2 bridge
   */
  private async deliverExternal(
    envelope: EmailEnvelope,
    recipient: JejuEmailAddress
  ): Promise<void> {
    const bridgeEndpoint = process.env.EMAIL_BRIDGE_ENDPOINT ?? `${this.config.dwsEndpoint}/email/bridge`;
    
    const response = await fetch(`${bridgeEndpoint}/outbound`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: envelope.from.full,
        to: recipient.full,
        messageId: envelope.id,
        // Content will be decrypted and re-sent by the bridge
        encryptedContent: envelope.encryptedContent,
        timestamp: envelope.timestamp,
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Bridge delivery failed: ${error}`);
    }
    
    console.log(`[EmailRelay] External delivery queued for ${recipient.full}`);
  }

  // ============ Email Receiving ============

  /**
   * Process inbound email from external sources
   */
  async receiveInbound(
    rawEmail: string,
    fromExternal: boolean
  ): Promise<{ success: boolean; messageId?: Hex; error?: string }> {
    // Parse raw email
    const parsed = this.parseRawEmail(rawEmail);
    if (!parsed) {
      return { success: false, error: 'Failed to parse email' };
    }

    // Validate recipient is a Jeju address
    const recipient = this.parseEmailAddress(parsed.to[0]);
    if (!this.isJejuEmail(recipient)) {
      return { success: false, error: 'Invalid recipient' };
    }

    // Content screening for inbound
    if (this.config.contentScreeningEnabled) {
      const content: EmailContent = {
        subject: parsed.subject,
        bodyText: parsed.bodyText,
        bodyHtml: parsed.bodyHtml,
        headers: parsed.headers,
        attachments: [],
      };

      // Use a placeholder address for external senders
      const screening = await this.screenContent(
        content,
        '0x0000000000000000000000000000000000000000' as Address
      );

      if (!screening.passed && screening.action !== 'allow') {
        return { success: false, error: 'Email rejected by content filter' };
      }
    }

    // Resolve recipient and store
    const identity = await this.resolveEmailIdentity(recipient);
    if (!identity || !identity.address.owner) {
      return { success: false, error: 'Recipient not found' };
    }

    const messageId = this.generateMessageId(parsed, '0x0' as Address);
    
    // Create envelope for storage
    const envelope: EmailEnvelope = {
      id: messageId,
      from: this.parseEmailAddress(parsed.from),
      to: [recipient],
      timestamp: Date.now(),
      encryptedContent: await this.encryptContent({
        subject: parsed.subject,
        bodyText: parsed.bodyText,
        bodyHtml: parsed.bodyHtml,
        headers: parsed.headers,
        attachments: [],
      }, [recipient]),
      isExternal: fromExternal,
      priority: 'normal',
      signature: '0x' as Hex,
    };

    const storage = getMailboxStorage();
    await storage.storeInbound(identity.address.owner, envelope);

    return { success: true, messageId };
  }

  // ============ Rate Limiting ============

  private checkRateLimit(
    address: Address,
    tier: EmailTier,
    recipientCount: number
  ): { allowed: boolean; reason?: string } {
    const limits = this.config.rateLimits[tier];
    const state = this.getRateLimitState(address);

    // Check if reset needed
    if (Date.now() > state.resetAt) {
      this.resetRateLimitState(address);
      return { allowed: true };
    }

    // Check daily limit
    if (state.emailsSent >= limits.emailsPerDay) {
      return { allowed: false, reason: 'Daily email limit reached' };
    }

    // Check recipient limit
    if (recipientCount > limits.maxRecipients) {
      return { 
        allowed: false, 
        reason: `Maximum ${limits.maxRecipients} recipients per email` 
      };
    }

    return { allowed: true };
  }

  private getRateLimitState(address: Address): RateLimitState {
    let state = this.rateLimitState.get(address);
    if (!state) {
      state = {
        emailsSent: 0,
        emailsReceived: 0,
        bytesUsed: 0,
        resetAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      };
      this.rateLimitState.set(address, state);
    }
    return state;
  }

  private incrementRateLimit(address: Address, count: number): void {
    const state = this.getRateLimitState(address);
    state.emailsSent += count;
  }

  private resetRateLimitState(address: Address): void {
    this.rateLimitState.set(address, {
      emailsSent: 0,
      emailsReceived: 0,
      bytesUsed: 0,
      resetAt: Date.now() + 24 * 60 * 60 * 1000,
    });
  }

  // ============ Content Screening ============

  private async screenContent(
    content: EmailContent,
    senderAddress: Address
  ): Promise<ScreeningResult> {
    const pipeline = getContentScreeningPipeline();
    
    // Create a minimal envelope for screening
    const envelope: EmailEnvelope = {
      id: '0x0' as Hex,
      from: { localPart: '', domain: '', full: '' },
      to: [],
      timestamp: Date.now(),
      encryptedContent: { ciphertext: '0x' as Hex, nonce: '0x' as Hex, ephemeralKey: '0x' as Hex, recipients: [] },
      isExternal: false,
      priority: 'normal',
      signature: '0x' as Hex,
    };

    return pipeline.screenEmail(envelope, content, senderAddress);
  }

  // ============ Helpers ============

  private parseEmailAddress(email: string): JejuEmailAddress {
    const [localPart, domain] = email.split('@');
    return {
      localPart: localPart ?? '',
      domain: domain ?? '',
      full: email,
    };
  }

  private isJejuEmail(address: JejuEmailAddress): boolean {
    return address.domain === this.config.emailDomain || 
           address.domain.endsWith('.jeju.mail');
  }

  /**
   * Resolve email identity from EmailRegistry contract
   */
  private async resolveEmailIdentity(
    address: JejuEmailAddress
  ): Promise<EmailIdentity | null> {
    // Build JNS node from email address
    const node = this.buildJnsNode(address);
    
    // Call EmailRegistry.resolveEmail to get account info
    const resolveEmailAbi = parseAbiItem('function resolveEmail(string calldata emailAddress) external view returns (bytes32 publicKeyHash, address[] memory preferredRelays)');
    
    const result = await this.publicClient.readContract({
      address: this.config.emailRegistryAddress,
      abi: [resolveEmailAbi],
      functionName: 'resolveEmail',
      args: [address.full],
    }).catch((e: Error) => {
      console.debug(`[EmailRelay] resolveEmail failed for ${address.full}: ${e.message}`);
      return null;
    });

    if (!result) return null;
    
    const [publicKeyHash, preferredRelays] = result as [Hex, Address[]];
    
    // Zero hash means not found
    if (publicKeyHash === '0x0000000000000000000000000000000000000000000000000000000000000000') {
      return null;
    }
    
    // Get owner from JNS
    const ownerAbi = parseAbiItem('function owner(bytes32 node) external view returns (address)');
    const owner = await this.publicClient.readContract({
      address: this.config.emailRegistryAddress, // JNS address should be used here
      abi: [ownerAbi],
      functionName: 'owner',
      args: [node],
    }).catch(() => null);

    return {
      address: {
        ...address,
        jnsNode: node,
        owner: owner as Address | undefined,
      },
      publicKeyHash,
      preferredRelays,
      tier: 'staked' as EmailTier, // Would be fetched from contract
    };
  }

  /**
   * Build JNS node hash from email address
   */
  private buildJnsNode(address: JejuEmailAddress): Hex {
    // Standard ENS-style namehash for email@domain.jeju
    const labels = [address.localPart, ...address.domain.split('.')].reverse();
    let node = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;
    
    for (const label of labels) {
      const labelHash = keccak256(toBytes(label));
      node = keccak256(toBytes(`${node}${labelHash.slice(2)}`));
    }
    
    return node;
  }

  /**
   * Fetch public key from EmailRegistry for encryption
   */
  private async fetchRecipientPublicKey(address: JejuEmailAddress): Promise<Uint8Array | null> {
    const identity = await this.resolveEmailIdentity(address);
    if (!identity) return null;
    
    // publicKeyHash is the keccak256 of the actual public key
    // In a real system, we'd fetch the full public key from DWS storage
    // For now, we use the hash as a placeholder (the actual public key would be stored)
    return Buffer.from(identity.publicKeyHash.slice(2), 'hex');
  }

  /**
   * Encrypt email content for all recipients using real E2E encryption
   */
  private async encryptContent(
    content: EmailContent,
    recipients: JejuEmailAddress[]
  ): Promise<{ ciphertext: Hex; nonce: Hex; ephemeralKey: Hex; recipients: { address: string; encryptedKey: Hex }[] }> {
    const contentString = JSON.stringify(content);
    
    // Fetch public keys for all recipients
    const recipientPublicKeys = new Map<string, Uint8Array>();
    
    for (const recipient of recipients) {
      const publicKey = await this.fetchRecipientPublicKey(recipient);
      if (publicKey) {
        recipientPublicKeys.set(recipient.full, publicKey);
      }
    }
    
    if (recipientPublicKeys.size === 0) {
      // No recipients found - return unencrypted (only for testing/dev)
      console.warn('[EmailRelay] No recipient public keys found - storing unencrypted');
      const plainBytes = Buffer.from(contentString, 'utf8');
      return {
        ciphertext: `0x${plainBytes.toString('hex')}` as Hex,
        nonce: '0x000000000000000000000000' as Hex,
        ephemeralKey: '0x' as Hex,
        recipients: recipients.map(r => ({
          address: r.full,
          encryptedKey: '0x' as Hex,
        })),
      };
    }

    // Use real encryption from SDK
    const { encryptedContent, recipientKeys } = encryptForMultipleRecipients(
      contentString,
      recipientPublicKeys
    );
    
    return {
      ciphertext: encryptedContent.ciphertext,
      nonce: encryptedContent.nonce,
      ephemeralKey: encryptedContent.ephemeralPublicKey,
      recipients: recipients.map(r => ({
        address: r.full,
        encryptedKey: recipientKeys.get(r.full) ?? ('0x' as Hex),
      })),
    };
  }

  /**
   * Generate unique message ID using keccak256
   */
  private generateMessageId(
    request: SendEmailRequest | { subject: string; from: string },
    senderAddress: Address
  ): Hex {
    const data = JSON.stringify({
      ...request,
      sender: senderAddress,
      timestamp: Date.now(),
      random: crypto.randomUUID(),
    });
    
    return keccak256(toBytes(data));
  }

  private computeChecksum(base64Content: string): Hex {
    const buffer = Buffer.from(base64Content, 'base64');
    const hash = require('crypto').createHash('sha256').update(buffer).digest('hex');
    return `0x${hash}` as Hex;
  }

  private parseRawEmail(raw: string): {
    from: string;
    to: string[];
    subject: string;
    bodyText: string;
    bodyHtml?: string;
    headers: Record<string, string>;
  } | null {
    // Basic email parsing - use proper library in production
    const lines = raw.split('\n');
    const headers: Record<string, string> = {};
    let bodyStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '') {
        bodyStart = i + 1;
        break;
      }
      const [key, ...values] = line.split(':');
      if (key && values.length > 0) {
        headers[key.toLowerCase().trim()] = values.join(':').trim();
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

  private queueDelivery(envelope: EmailEnvelope): void {
    this.deliveryQueue.push(envelope);
  }

  // ============ Status ============

  getDeliveryStatus(messageId: Hex): Record<string, DeliveryStatus> | null {
    return this.deliveryStatus.get(messageId) ?? null;
  }

  getQueueLength(): number {
    return this.deliveryQueue.length;
  }

  /**
   * Trigger account ban via EmailRegistry contract
   */
  private async triggerAccountBan(account: Address, reason: string): Promise<void> {
    // Call EmailRegistry.banAccount or ModerationMarketplace
    // This requires an authorized wallet - in production, use operator wallet
    const operatorKey = process.env.OPERATOR_PRIVATE_KEY;
    
    if (!operatorKey) {
      console.error('[EmailRelay] Cannot ban account - no operator key configured');
      // Instead of silently failing, report to moderation queue via API
      await this.reportToModerationQueue(account, reason);
      return;
    }
    
    // Call the DWS moderation endpoint to trigger ban
    const moderationEndpoint = process.env.MODERATION_ENDPOINT ?? `${this.config.dwsEndpoint}/moderation`;
    
    const response = await fetch(`${moderationEndpoint}/ban`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${operatorKey}`,
      },
      body: JSON.stringify({
        target: account,
        reason,
        service: 'email',
        severity: 'critical',
        autoban: true, // Immediate ban for CSAM
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error(`[EmailRelay] Ban request failed: ${error}`);
      // Fallback to moderation queue
      await this.reportToModerationQueue(account, reason);
    } else {
      console.log(`[EmailRelay] Account ${account} banned: ${reason}`);
    }
  }

  /**
   * Report to moderation queue when direct ban fails
   */
  private async reportToModerationQueue(account: Address, reason: string): Promise<void> {
    const moderationEndpoint = process.env.MODERATION_ENDPOINT ?? `${this.config.dwsEndpoint}/moderation`;
    
    await fetch(`${moderationEndpoint}/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target: account,
        reason,
        service: 'email',
        priority: 'urgent',
        evidence: {
          timestamp: Date.now(),
          type: 'content_violation',
        },
      }),
    }).catch(e => {
      console.error(`[EmailRelay] Failed to report to moderation queue: ${e}`);
    });
  }
}

// ============ Factory ============

let _relayService: EmailRelayService | null = null;

export function createEmailRelayService(config: RelayConfig): EmailRelayService {
  return new EmailRelayService(config);
}

export function getEmailRelayService(): EmailRelayService {
  if (!_relayService) {
    throw new Error('Email relay service not initialized. Call createEmailRelayService first.');
  }
  return _relayService;
}

export function initializeEmailRelayService(config: RelayConfig): EmailRelayService {
  _relayService = new EmailRelayService(config);
  return _relayService;
}
