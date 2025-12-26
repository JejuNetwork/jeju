import { createCipheriv, createECDH, createHash, randomBytes } from 'node:crypto'
import { type Address, createPublicClient, type Hex, http, keccak256, parseAbiItem, toBytes } from 'viem'
import { getContentScreeningPipeline } from './content-screening'
import { deliveryDuration, deliveryQueueLength, emailsReceivedTotal, rateLimitHitsTotal } from './metrics'
import { getMailboxStorage } from './storage'
import type {
  DeliveryStatus, EmailContent, EmailEnvelope, EmailIdentity, EmailTier,
  JejuEmailAddress, RateLimitConfig, RateLimitState, ScreeningResult,
  SendEmailRequest, SendEmailResponse,
} from './types'

const ZERO_HEX = '0x0' as Hex
const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address
const MS_PER_DAY = 86400000
const MS_PER_HOUR = 3600000

function generateKeyPair(): { publicKey: Uint8Array; privateKey: Uint8Array } {
  const ecdh = createECDH('secp256k1')
  ecdh.generateKeys()
  return { publicKey: new Uint8Array(ecdh.getPublicKey()), privateKey: new Uint8Array(ecdh.getPrivateKey()) }
}

function deriveSharedSecret(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  const ecdh = createECDH('secp256k1')
  ecdh.setPrivateKey(Buffer.from(privateKey))
  return new Uint8Array(createHash('sha256').update(ecdh.computeSecret(Buffer.from(publicKey))).digest())
}

function encryptForMultipleRecipients(
  content: string,
  recipientPublicKeys: Map<string, Uint8Array>,
): {
  encryptedContent: {
    ciphertext: Hex
    nonce: Hex
    ephemeralPublicKey: Hex
    tag: Hex
  }
  recipientKeys: Map<string, Hex>
} {
  const symmetricKey = randomBytes(32)
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', symmetricKey, nonce)

  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(content, 'utf8')),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()

  const recipientKeys = new Map<string, Hex>()

  for (const [address, publicKey] of recipientPublicKeys) {
    const ephemeral = generateKeyPair()
    const sharedSecret = deriveSharedSecret(ephemeral.privateKey, publicKey)

    const keyNonce = randomBytes(12)
    const keyCipher = createCipheriv('aes-256-gcm', sharedSecret, keyNonce)

    const encryptedKey = Buffer.concat([
      keyNonce,
      keyCipher.update(symmetricKey),
      keyCipher.final(),
      keyCipher.getAuthTag(),
      Buffer.from(ephemeral.publicKey),
    ])

    recipientKeys.set(address, `0x${encryptedKey.toString('hex')}` as Hex)
  }

  return {
    encryptedContent: {
      ciphertext: `0x${encrypted.toString('hex')}` as Hex,
      nonce: `0x${nonce.toString('hex')}` as Hex,
      ephemeralPublicKey: '0x' as Hex,
      tag: `0x${tag.toString('hex')}` as Hex,
    },
    recipientKeys,
  }
}

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
}

interface RelayConfig {
  rpcUrl: string
  chainId: number
  emailRegistryAddress: Address
  emailStakingAddress: Address
  jnsAddress: Address
  dwsEndpoint: string
  emailDomain: string
  rateLimits: Record<EmailTier, RateLimitConfig>
  contentScreeningEnabled: boolean
}

const RATE_LIMIT_CLEANUP_INTERVAL_MS = MS_PER_HOUR
const DELIVERY_STATUS_TTL_MS = MS_PER_DAY
const MAX_DELIVERY_QUEUE_SIZE = 10000

interface DeliveryStatusEntry {
  status: Record<string, DeliveryStatus>
  createdAt: number
}

export class EmailRelayService {
  private config: RelayConfig
  private publicClient: ReturnType<typeof createPublicClient>
  private rateLimitState: Map<Address, RateLimitState> = new Map()
  private deliveryQueue: EmailEnvelope[] = []
  private deliveryStatus: Map<Hex, DeliveryStatusEntry> = new Map()
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: RelayConfig) {
    this.config = config
    this.publicClient = createPublicClient({
      transport: http(config.rpcUrl),
    })
    this.startCleanupRoutine()
  }

  private startCleanupRoutine(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredEntries()
    }, RATE_LIMIT_CLEANUP_INTERVAL_MS)
  }

  private cleanupExpiredEntries(): void {
    const now = Date.now()

    for (const [address, state] of this.rateLimitState.entries()) {
      if (now > state.resetAt) {
        this.rateLimitState.delete(address)
      }
    }

    for (const [messageId, entry] of this.deliveryStatus.entries()) {
      if (now - entry.createdAt > DELIVERY_STATUS_TTL_MS) {
        this.deliveryStatus.delete(messageId)
      }
    }
  }

  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  async sendEmail(
    request: SendEmailRequest,
    senderAddress: Address,
    senderTier: EmailTier,
  ): Promise<SendEmailResponse> {
    const rateLimitCheck = this.checkRateLimit(
      senderAddress,
      senderTier,
      request.to.length,
    )
    if (!rateLimitCheck.allowed) {
      return { success: false, messageId: ZERO_HEX, queued: false, error: rateLimitCheck.reason }
    }

    const fromAddress = this.parseEmailAddress(request.from)
    const toAddresses = request.to.map((to) => this.parseEmailAddress(to))

    const hasExternal = toAddresses.some((addr) => !this.isJejuEmail(addr))
    if (hasExternal && senderTier === 'free') {
      return {
        success: false,
        messageId: ZERO_HEX,
        queued: false,
        error: 'Free tier accounts cannot send to external email addresses. Stake tokens to enable external sending.',
      }
    }

    const content: EmailContent = {
      subject: request.subject,
      bodyText: request.bodyText,
      bodyHtml: request.bodyHtml,
      headers: {},
      attachments:
        request.attachments?.map((att) => ({
          filename: att.filename,
          mimeType: att.mimeType,
          size: Buffer.from(att.content, 'base64').length,
          cid: '', // Will be set after upload
          checksum: this.computeChecksum(att.content),
        })) ?? [],
      inReplyTo: request.inReplyTo,
    }

    if (this.config.contentScreeningEnabled) {
      const screening = await this.screenContent(content, senderAddress)

      if (!screening.passed) {
        if (screening.action === 'block_and_ban') {
          await this.triggerAccountBan(senderAddress, 'Content policy violation - illegal content detected')
          return { success: false, messageId: ZERO_HEX, queued: false, error: 'Email blocked due to content policy violation. Your account has been banned.' }
        }
        if (screening.action === 'reject') {
          return { success: false, messageId: ZERO_HEX, queued: false, error: 'Email rejected due to content policy violation.' }
        }
        if (screening.action === 'quarantine') {
          return { success: false, messageId: ZERO_HEX, queued: false, error: 'Email quarantined due to suspected spam content.' }
        }
      }
    }

    const messageId = this.generateMessageId(request, senderAddress)
    const envelope: EmailEnvelope = {
      id: messageId,
      from: fromAddress,
      to: toAddresses,
      cc: request.cc?.map((cc) => this.parseEmailAddress(cc)),
      timestamp: Date.now(),
      encryptedContent: await this.encryptContent(content, toAddresses),
      isExternal: hasExternal,
      priority: request.priority ?? 'normal',
      signature: ZERO_HEX,
    }

    const storage = getMailboxStorage()
    await storage.storeOutbound(senderAddress, envelope, content)
    this.queueDelivery(envelope)
    this.incrementRateLimit(senderAddress, toAddresses.length)

    return {
      success: true,
      messageId,
      queued: true,
      deliveryStatus: Object.fromEntries(
        toAddresses.map((addr) => [addr.full, 'queued' as DeliveryStatus]),
      ),
    }
  }

  async processDeliveryQueue(): Promise<void> {
    deliveryQueueLength.set(this.deliveryQueue.length)
    while (this.deliveryQueue.length > 0) {
      const envelope = this.deliveryQueue.shift()
      if (!envelope) continue
      deliveryQueueLength.set(this.deliveryQueue.length)

      await this.deliverEmail(envelope).catch((error) => {
        console.error(`[EmailRelay] Delivery failed for ${envelope.id}:`, error)
      })
    }
  }

  private async deliverEmail(envelope: EmailEnvelope): Promise<void> {
    const startTime = Date.now()
    const status: Record<string, DeliveryStatus> = {}

    for (const recipient of envelope.to) {
      try {
        if (this.isJejuEmail(recipient)) {
          await this.deliverInternal(envelope, recipient)
          status[recipient.full] = 'delivered'
          emailsReceivedTotal.inc({ source: 'internal', status: 'delivered' })
        } else {
          await this.deliverExternal(envelope, recipient)
          status[recipient.full] = 'sent'
        }
      } catch (error) {
        console.error(
          `[EmailRelay] Failed to deliver to ${recipient.full}:`,
          error,
        )
        status[recipient.full] = 'failed'
        emailsReceivedTotal.inc({
          source: this.isJejuEmail(recipient) ? 'internal' : 'external',
          status: 'failed',
        })
      }
    }

    const durationSeconds = (Date.now() - startTime) / 1000
    deliveryDuration.observe({ type: 'batch' }, durationSeconds)
    this.deliveryStatus.set(envelope.id, { status, createdAt: Date.now() })
  }

  private async deliverInternal(
    envelope: EmailEnvelope,
    recipient: JejuEmailAddress,
  ): Promise<void> {
    const identity = await this.resolveEmailIdentity(recipient)
    if (!identity) {
      throw new Error(`Recipient not found: ${recipient.full}`)
    }

    if (!identity.address.owner) {
      throw new Error(`Recipient has no owner address: ${recipient.full}`)
    }

    const storage = getMailboxStorage()
    await storage.storeInbound(identity.address.owner, envelope)
  }

  private async deliverExternal(
    envelope: EmailEnvelope,
    recipient: JejuEmailAddress,
  ): Promise<void> {
    const bridgeEndpoint =
      process.env.EMAIL_BRIDGE_ENDPOINT ??
      `${this.config.dwsEndpoint}/email/bridge`

    const response = await fetch(`${bridgeEndpoint}/outbound`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: envelope.from.full,
        to: recipient.full,
        messageId: envelope.id,
        encryptedContent: envelope.encryptedContent,
        timestamp: envelope.timestamp,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Bridge delivery failed: ${error}`)
    }

    console.log(`[EmailRelay] External delivery queued for ${recipient.full}`)
  }

  async receiveInbound(
    rawEmail: string,
    fromExternal: boolean,
  ): Promise<{ success: boolean; messageId?: Hex; error?: string }> {
    const parsed = this.parseRawEmail(rawEmail)
    if (!parsed) {
      return { success: false, error: 'Failed to parse email' }
    }

    const recipient = this.parseEmailAddress(parsed.to[0])
    if (!this.isJejuEmail(recipient)) {
      return { success: false, error: 'Invalid recipient' }
    }

    if (this.config.contentScreeningEnabled) {
      const content: EmailContent = {
        subject: parsed.subject,
        bodyText: parsed.bodyText,
        bodyHtml: parsed.bodyHtml,
        headers: parsed.headers,
        attachments: [],
      }
      const screening = await this.screenContent(content, ZERO_ADDRESS)
      if (!screening.passed && screening.action !== 'allow') {
        return { success: false, error: 'Email rejected by content filter' }
      }
    }

    // Resolve recipient and store
    const identity = await this.resolveEmailIdentity(recipient)
    if (!identity || !identity.address.owner) {
      return { success: false, error: 'Recipient not found' }
    }

    const messageId = this.generateMessageId(parsed, ZERO_ADDRESS)
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
      signature: ZERO_HEX,
    }

    const storage = getMailboxStorage()
    await storage.storeInbound(identity.address.owner, envelope)

    return { success: true, messageId }
  }

  private checkRateLimit(
    address: Address,
    tier: EmailTier,
    recipientCount: number,
  ): { allowed: boolean; reason?: string } {
    const limits = this.config.rateLimits[tier] ?? DEFAULT_RATE_LIMITS[tier]
    const state = this.getRateLimitState(address)

    // Check if reset needed
    if (Date.now() > state.resetAt) {
      this.resetRateLimitState(address)
      return { allowed: true }
    }

    if (state.emailsSent >= limits.emailsPerDay) {
      rateLimitHitsTotal.inc({ tier, limit_type: 'daily' })
      return { allowed: false, reason: 'Daily email limit reached' }
    }

    if (recipientCount > limits.maxRecipients) {
      rateLimitHitsTotal.inc({ tier, limit_type: 'recipients' })
      return {
        allowed: false,
        reason: `Maximum ${limits.maxRecipients} recipients per email`,
      }
    }

    return { allowed: true }
  }

  private getRateLimitState(address: Address): RateLimitState {
    let state = this.rateLimitState.get(address)
    if (!state) {
      state = { emailsSent: 0, emailsReceived: 0, bytesUsed: 0, resetAt: Date.now() + MS_PER_DAY }
      this.rateLimitState.set(address, state)
    }
    return state
  }

  private incrementRateLimit(address: Address, count: number): void {
    this.getRateLimitState(address).emailsSent += count
  }

  private resetRateLimitState(address: Address): void {
    this.rateLimitState.set(address, { emailsSent: 0, emailsReceived: 0, bytesUsed: 0, resetAt: Date.now() + MS_PER_DAY })
  }

  private async screenContent(content: EmailContent, senderAddress: Address): Promise<ScreeningResult> {
    const envelope: EmailEnvelope = {
      id: ZERO_HEX, from: { localPart: '', domain: '', full: '' }, to: [], timestamp: Date.now(),
      encryptedContent: { ciphertext: ZERO_HEX, nonce: ZERO_HEX, ephemeralKey: ZERO_HEX, recipients: [] },
      isExternal: false, priority: 'normal', signature: ZERO_HEX,
    }
    return getContentScreeningPipeline().screenEmail(envelope, content, senderAddress)
  }

  private parseEmailAddress(email: string): JejuEmailAddress {
    const [localPart, domain] = email.split('@')
    return {
      localPart: localPart ?? '',
      domain: domain ?? '',
      full: email,
    }
  }

  private isJejuEmail(address: JejuEmailAddress): boolean {
    return (
      address.domain === this.config.emailDomain ||
      address.domain.endsWith('.jeju.mail')
    )
  }

  private async resolveEmailIdentity(address: JejuEmailAddress): Promise<EmailIdentity | null> {
    const node = this.buildJnsNode(address)

    const result = await this.publicClient.readContract({
      address: this.config.emailRegistryAddress,
      abi: [parseAbiItem('function resolveEmail(string calldata emailAddress) external view returns (bytes32 publicKeyHash, address[] memory preferredRelays)')],
      functionName: 'resolveEmail',
      args: [address.full],
    }).catch((e: Error) => { console.debug(`[EmailRelay] resolveEmail: ${e.message}`); return null })

    if (!result) return null
    const [publicKeyHash, preferredRelays] = result as [Hex, Address[]]
    if (publicKeyHash === ZERO_HASH) return null

    const owner = await this.publicClient.readContract({
      address: this.config.jnsAddress,
      abi: [parseAbiItem('function owner(bytes32 node) external view returns (address)')],
      functionName: 'owner',
      args: [node],
    }).catch((e: Error) => { console.warn(`[EmailRelay] JNS lookup failed: ${e.message}`); return null })

    if (!owner) return null

    let tier: EmailTier = 'free'
    const accountResult = await this.publicClient.readContract({
      address: this.config.emailRegistryAddress,
      abi: [parseAbiItem('function getAccount(address owner) view returns (address owner_, bytes32 publicKeyHash, bytes32 jnsNode, uint8 status, uint8 tier, uint256 stakedAmount, uint256 quotaUsedBytes, uint256 quotaLimitBytes, uint256 emailsSentToday, uint256 lastResetTimestamp, uint256 createdAt, uint256 lastActivityAt)')],
      functionName: 'getAccount',
      args: [owner as Address],
    }).catch(() => null)

    if (accountResult) {
      tier = accountResult[4] === 2 ? 'premium' : accountResult[4] === 1 ? 'staked' : 'free'
      if (accountResult[3] === 2 || accountResult[3] === 3) return null // suspended/banned
    }

    return { address: { ...address, jnsNode: node, owner: owner as Address }, publicKey: publicKeyHash, preferredRelays, tier, isVerified: true }
  }

  private buildJnsNode(address: JejuEmailAddress): Hex {
    const labels = [address.localPart, ...address.domain.split('.')].reverse()
    let node = ZERO_HASH
    for (const label of labels) {
      const labelHash = keccak256(toBytes(label))
      node = keccak256(toBytes(`${node}${labelHash.slice(2)}`))
    }
    return node
  }

  private async fetchRecipientPublicKey(
    address: JejuEmailAddress,
  ): Promise<Uint8Array | null> {
    const identity = await this.resolveEmailIdentity(address)
    if (!identity) return null
    return Buffer.from(identity.publicKey.slice(2), 'hex')
  }

  private async encryptContent(
    content: EmailContent,
    recipients: JejuEmailAddress[],
  ): Promise<{
    ciphertext: Hex
    nonce: Hex
    ephemeralKey: Hex
    recipients: { address: string; encryptedKey: Hex }[]
  }> {
    const contentString = JSON.stringify(content)
    const recipientPublicKeys = new Map<string, Uint8Array>()

    for (const recipient of recipients) {
      const publicKey = await this.fetchRecipientPublicKey(recipient)
      if (publicKey) {
        recipientPublicKeys.set(recipient.full, publicKey)
      }
    }

    if (recipientPublicKeys.size === 0) {
      console.warn(
        '[EmailRelay] No recipient public keys found - storing unencrypted',
      )
      const plainBytes = Buffer.from(contentString, 'utf8')
      return {
        ciphertext: `0x${plainBytes.toString('hex')}` as Hex,
        nonce: '0x000000000000000000000000' as Hex,
        ephemeralKey: '0x' as Hex,
        recipients: recipients.map((r) => ({
          address: r.full,
          encryptedKey: '0x' as Hex,
        })),
      }
    }

    const { encryptedContent, recipientKeys } = encryptForMultipleRecipients(
      contentString,
      recipientPublicKeys,
    )

    return {
      ciphertext: encryptedContent.ciphertext,
      nonce: encryptedContent.nonce,
      ephemeralKey: encryptedContent.ephemeralPublicKey,
      recipients: recipients.map((r) => ({
        address: r.full,
        encryptedKey: recipientKeys.get(r.full) ?? ('0x' as Hex),
      })),
    }
  }

  private generateMessageId(
    request: SendEmailRequest | { subject: string; from: string },
    senderAddress: Address,
  ): Hex {
    const data = JSON.stringify({
      ...request,
      sender: senderAddress,
      timestamp: Date.now(),
      random: crypto.randomUUID(),
    })

    return keccak256(toBytes(data))
  }

  private computeChecksum(base64Content: string): Hex {
    const buffer = Buffer.from(base64Content, 'base64')
    const hash = createHash('sha256').update(buffer).digest('hex')
    return `0x${hash}` as Hex
  }

  private parseRawEmail(raw: string): {
    from: string
    to: string[]
    subject: string
    bodyText: string
    bodyHtml?: string
    headers: Record<string, string>
  } | null {
    const lines = raw.split(/\r?\n/)
    const headers: Record<string, string> = {}
    let bodyStart = 0, currentHeader = '', currentValue = ''

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line === '' || line === '\r') {
        if (currentHeader) headers[currentHeader] = currentValue.trim()
        bodyStart = i + 1
        break
      }
      if (/^[ \t]/.test(line)) { currentValue += ' ' + line.trim(); continue }
      if (currentHeader) headers[currentHeader] = currentValue.trim()
      const colonIdx = line.indexOf(':')
      if (colonIdx > 0) {
        currentHeader = line.slice(0, colonIdx).toLowerCase().trim()
        currentValue = line.slice(colonIdx + 1)
      }
    }

    if (!headers.from || !headers.to) return null

    const bodyLines = lines.slice(bodyStart)
    let bodyText = '', bodyHtml: string | undefined
    const contentType = headers['content-type'] ?? ''

    if (contentType.includes('multipart/')) {
      const boundaryMatch = contentType.match(/boundary="?([^";\s]+)"?/)
      if (boundaryMatch) {
        for (const part of bodyLines.join('\n').split(`--${boundaryMatch[1]}`)) {
          if (!part.includes('Content-Type:')) continue
          const partLines = part.split(/\r?\n/)
          let partBodyStart = 0, partContentType = ''
          for (let i = 0; i < partLines.length; i++) {
            if (partLines[i].toLowerCase().startsWith('content-type:')) partContentType = partLines[i].slice(13).trim()
            if (partLines[i] === '' || partLines[i] === '\r') { partBodyStart = i + 1; break }
          }
          const partBody = partLines.slice(partBodyStart).join('\n').trim()
          if (partContentType.includes('text/plain')) bodyText = partBody
          else if (partContentType.includes('text/html')) bodyHtml = partBody
        }
      }
    } else {
      bodyText = bodyLines.join('\n')
      if (contentType.includes('text/html')) { bodyHtml = bodyText; bodyText = '' }
    }

    const recipients = headers.to.split(',').map((a) => { const m = a.match(/<([^>]+)>/); return m ? m[1].trim() : a.trim() }).filter(Boolean)
    if (recipients.length === 0) return null

    const fromMatch = headers.from.match(/<([^>]+)>/)
    return { from: fromMatch ? fromMatch[1].trim() : headers.from.trim(), to: recipients, subject: headers.subject ?? '(no subject)', bodyText, bodyHtml, headers }
  }

  private queueDelivery(envelope: EmailEnvelope): void {
    if (this.deliveryQueue.length >= MAX_DELIVERY_QUEUE_SIZE) throw new Error('Email delivery queue full')
    this.deliveryQueue.push(envelope)
  }

  getDeliveryStatus(messageId: Hex): Record<string, DeliveryStatus> | null {
    const entry = this.deliveryStatus.get(messageId)
    return entry?.status ?? null
  }

  getQueueLength(): number {
    return this.deliveryQueue.length
  }

  private async triggerAccountBan(account: Address, reason: string): Promise<{ success: boolean; queued: boolean }> {
    const operatorKey = process.env.OPERATOR_PRIVATE_KEY
    if (!operatorKey) {
      console.error('[EmailRelay] No operator key - queuing for manual review')
      return { success: false, queued: await this.reportToModerationQueue(account, reason) }
    }

    const endpoint = process.env.MODERATION_ENDPOINT ?? `${this.config.dwsEndpoint}/moderation`
    const response = await fetch(`${endpoint}/ban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatorKey}` },
      body: JSON.stringify({ target: account, reason, service: 'email', severity: 'critical', autoban: true }),
    })

    if (!response.ok) {
      console.error(`[EmailRelay] Ban failed: ${await response.text()}`)
      return { success: false, queued: await this.reportToModerationQueue(account, reason) }
    }
    console.log(`[EmailRelay] Banned ${account}: ${reason}`)
    return { success: true, queued: false }
  }

  private async reportToModerationQueue(account: Address, reason: string): Promise<boolean> {
    const endpoint = process.env.MODERATION_ENDPOINT ?? `${this.config.dwsEndpoint}/moderation`
    const response = await fetch(`${endpoint}/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: account, reason, service: 'email', priority: 'urgent', evidence: { timestamp: Date.now(), type: 'content_violation' } }),
    })
    if (!response.ok) { console.error(`[EmailRelay] Failed to queue moderation: ${await response.text()}`); return false }
    return true
  }
}

let _relayService: EmailRelayService | null = null

export function createEmailRelayService(
  config: RelayConfig,
): EmailRelayService {
  return new EmailRelayService(config)
}

export function getEmailRelayService(): EmailRelayService {
  if (!_relayService) {
    throw new Error(
      'Email relay service not initialized. Call createEmailRelayService first.',
    )
  }
  return _relayService
}

export function initializeEmailRelayService(
  config: RelayConfig,
): EmailRelayService {
  _relayService = new EmailRelayService(config)
  return _relayService
}

export function resetEmailRelayService(): void {
  _relayService = null
}
