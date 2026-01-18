import { createHash } from 'node:crypto'
import { getFarcasterHubUrl, getXMTPConfig } from '@jejunetwork/config'
import { createKMSSigner, type KMSSigner } from '@jejunetwork/kms'
import {
  createDirectCastClient,
  type DCClientConfig,
  type DirectCast,
  type DirectCastClient,
  FarcasterClient,
  type FarcasterProfile,
  FarcasterSignerService,
  lookupFidByAddress,
  XMTPClient,
  type XMTPSigner,
} from '@jejunetwork/messaging'
import { createLogger } from '@jejunetwork/shared'
import { type Address, type Hex, hexToBytes, toBytes } from 'viem'
import { z } from 'zod'
import { storage } from '../../../web/platform/storage'
import { config } from '../../config'

const log = createLogger('wallet:messaging')

export class MessagingError extends Error {
  constructor(
    message: string,
    public code: string,
    public context?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'MessagingError'
  }
}

export interface FarcasterAccount {
  fid: number
  username: string
  displayName: string
  pfpUrl: string
  bio?: string
  signerPublicKey: Hex
  signerPrivateKey: Hex
  linkedAt: number
}

export interface MessagingPreferences {
  enableFarcaster: boolean
  enableXMTP: boolean
  enableNotifications: boolean
  notifyOnDM: boolean
  notifyOnMention: boolean
  notifyOnTransaction: boolean
  mutedConversations: string[]
  blockedAddresses: Address[]
  blockedFids: number[]
}

export interface Conversation {
  id: string
  type: 'farcaster' | 'xmtp' | 'mixed'
  recipientAddress?: Address
  recipientFid?: number
  recipientName: string
  recipientAvatar?: string
  lastMessage?: {
    text: string
    timestamp: number
    isFromMe: boolean
  }
  unreadCount: number
  isMuted: boolean
  updatedAt: number
}

export interface Message {
  id: string
  conversationId: string
  text: string
  timestamp: number
  isFromMe: boolean
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed'
  protocol: 'farcaster' | 'xmtp'
  metadata?: {
    embeds?: Array<{ url: string }>
    mentions?: Array<{ fid: number; position: number }>
    replyTo?: string
  }
}

export interface FarcasterFeedCast {
  hash: string
  author: {
    fid: number
    username: string
    displayName: string
    pfpUrl: string
  }
  text: string
  timestamp: number
  embeds: Array<{ url: string }>
  parentHash?: string
}

const FarcasterAccountSchema = z.object({
  fid: z.number(),
  username: z.string(),
  displayName: z.string(),
  pfpUrl: z.string(),
  bio: z.string().optional(),
  signerPublicKey: z.string(),
  signerPrivateKey: z.string(),
  linkedAt: z.number(),
})

const MessagingPreferencesSchema = z.object({
  enableFarcaster: z.boolean(),
  enableXMTP: z.boolean(),
  enableNotifications: z.boolean(),
  notifyOnDM: z.boolean(),
  notifyOnMention: z.boolean(),
  notifyOnTransaction: z.boolean(),
  mutedConversations: z.array(z.string()),
  blockedAddresses: z.array(z.string()),
  blockedFids: z.array(z.number()),
})

const STORAGE_KEYS = {
  FARCASTER_ACCOUNT: 'jeju_farcaster_account',
  MESSAGING_PREFS: 'jeju_messaging_prefs',
} as const

export const DEFAULT_PREFERENCES: MessagingPreferences = {
  enableFarcaster: true,
  enableXMTP: true,
  enableNotifications: true,
  notifyOnDM: true,
  notifyOnMention: true,
  notifyOnTransaction: true,
  mutedConversations: [],
  blockedAddresses: [],
  blockedFids: [],
}

const HUB_URL = config.farcasterHubUrl || getFarcasterHubUrl()
const xmtpConfig = getXMTPConfig()
const XMTP_ENV = xmtpConfig.env
const XMTP_DB_PATH = xmtpConfig.dbPath

function extractEmbeds(
  embeds: Array<{ url?: string; castId?: { fid: number; hash: string } }>,
): Array<{ url: string }> {
  return embeds
    .filter((e): e is { url: string } => e.url !== undefined)
    .map((e) => ({ url: e.url }))
}

/**
 * Create XMTP signer from KMS
 */
function createXMTPKMSSigner(
  kmsSigner: KMSSigner,
  address: Address,
): XMTPSigner {
  return {
    type: 'EOA',
    getIdentifier: () => ({
      identifier: address.toLowerCase(),
      identifierKind: 'Ethereum',
    }),
    signMessage: async (message: string): Promise<Uint8Array> => {
      const result = await kmsSigner.signMessage(message)
      return toBytes(result.signature)
    },
  }
}

/**
 * Get DB encryption key from KMS
 */
async function getDbEncryptionKey(kmsSigner: KMSSigner): Promise<Uint8Array> {
  const result = await kmsSigner.signMessage('XMTP_DB_ENCRYPTION_KEY_V1')
  const hash = createHash('sha256').update(toBytes(result.signature)).digest()
  return new Uint8Array(hash)
}

class WalletMessagingService {
  private address: Address | null = null
  private farcasterAccount: FarcasterAccount | null = null
  private preferences: MessagingPreferences = DEFAULT_PREFERENCES
  private hubClient: FarcasterClient | null = null
  private dcClient: DirectCastClient | null = null
  private xmtpClient: XMTPClient | null = null
  private kmsSigner: KMSSigner | null = null
  private signerService: FarcasterSignerService | null = null
  private initialized = false

  private messageListeners: Set<(message: Message) => void> = new Set()

  /** Status getters for health check */
  get isInitialized(): boolean {
    return this.initialized
  }

  get hasFarcaster(): boolean {
    return this.farcasterAccount !== null
  }

  get hasXMTP(): boolean {
    return this.xmtpClient !== null
  }

  async initialize(address: Address): Promise<void> {
    if (this.initialized && this.address === address) return

    log.info('Initializing messaging service', { address })
    this.address = address
    await this.loadFarcasterAccount()
    await this.loadPreferences()

    this.hubClient = new FarcasterClient({ hubUrl: HUB_URL })
    this.signerService = new FarcasterSignerService({ hubUrl: HUB_URL })

    if (this.farcasterAccount) {
      log.debug('Initializing Direct Cast client', {
        fid: this.farcasterAccount.fid,
      })
      await this.initializeDCClient()
    }

    if (this.preferences.enableXMTP) {
      log.debug('Initializing XMTP client')
      await this.initializeXMTPClient()
    }

    log.info('Messaging service initialized', {
      hasFarcaster: !!this.farcasterAccount,
      hasXMTP: !!this.xmtpClient,
    })
    this.initialized = true
  }

  private async initializeDCClient(): Promise<void> {
    if (!this.farcasterAccount) return

    const config: DCClientConfig = {
      fid: this.farcasterAccount.fid,
      signerPrivateKey: hexToBytes(
        this.farcasterAccount.signerPrivateKey as Hex,
      ),
      hubUrl: HUB_URL,
    }

    this.dcClient = await createDirectCastClient(config)
  }

  private async initializeXMTPClient(): Promise<void> {
    if (!this.address) return

    // Create KMS signer
    this.kmsSigner = createKMSSigner({
      serviceId: `xmtp-wallet-${this.address.toLowerCase()}`,
      allowLocalDev: true,
    })
    await this.kmsSigner.initialize()

    // Create XMTP signer wrapper
    const xmtpSigner = createXMTPKMSSigner(this.kmsSigner, this.address)

    // Get DB encryption key from KMS
    const dbEncryptionKey = await getDbEncryptionKey(this.kmsSigner)

    // Create real XMTP client
    this.xmtpClient = await XMTPClient.create(xmtpSigner, {
      env: XMTP_ENV,
      dbPath: `${XMTP_DB_PATH}/${this.address.toLowerCase()}.db3`,
      dbEncryptionKey,
    })

    log.info('XMTP client initialized', {
      address: this.address,
      inboxId: this.xmtpClient.inboxId ?? 'unknown',
    })
  }

  hasFarcasterAccount(): boolean {
    return this.farcasterAccount !== null
  }

  getFarcasterAccount(): FarcasterAccount | null {
    return this.farcasterAccount
  }

  async lookupFidByAddress(address: Address): Promise<number | null> {
    if (!this.hubClient) {
      throw new MessagingError('Hub client not initialized', 'NOT_INITIALIZED')
    }
    return lookupFidByAddress(address, this.hubClient)
  }

  async getProfile(fid: number): Promise<FarcasterProfile | null> {
    if (!this.hubClient) {
      throw new MessagingError('Hub client not initialized', 'NOT_INITIALIZED')
    }
    return this.hubClient.getProfile(fid)
  }

  async getProfileByUsername(
    username: string,
  ): Promise<FarcasterProfile | null> {
    if (!this.hubClient) {
      throw new MessagingError('Hub client not initialized', 'NOT_INITIALIZED')
    }
    return this.hubClient.getProfileByUsername(username)
  }

  async linkFarcasterAccount(fid: number): Promise<{
    signerPublicKey: Hex
    approvalLink: string
    signer: { keyId: string; privateKey: Hex }
  }> {
    if (!this.signerService || !this.address) {
      throw new MessagingError('Service not initialized', 'NOT_INITIALIZED')
    }

    log.info('Linking Farcaster account', { fid })
    const result = await this.signerService.createSigner({
      fid,
      appName: 'Jeju Wallet',
    })
    const exported = await this.signerService.exportSigner(result.signer.keyId)
    log.info('Farcaster signer created', { fid, keyId: result.signer.keyId })

    return {
      signerPublicKey: result.signer.publicKey,
      approvalLink: result.approvalLink,
      signer: {
        keyId: result.signer.keyId,
        privateKey: exported.privateKey,
      },
    }
  }

  async completeFarcasterLink(params: {
    fid: number
    signerPublicKey: Hex
    signerPrivateKey: Hex
  }): Promise<FarcasterAccount> {
    const profile = await this.getProfile(params.fid)
    if (!profile) {
      throw new MessagingError(
        'Failed to fetch Farcaster profile',
        'PROFILE_NOT_FOUND',
        { fid: params.fid },
      )
    }

    const account: FarcasterAccount = {
      fid: params.fid,
      username: profile.username,
      displayName: profile.displayName,
      pfpUrl: profile.pfpUrl,
      bio: profile.bio,
      signerPublicKey: params.signerPublicKey,
      signerPrivateKey: params.signerPrivateKey,
      linkedAt: Date.now(),
    }

    this.farcasterAccount = account
    await this.saveFarcasterAccount()
    await this.initializeDCClient()

    return account
  }

  async unlinkFarcasterAccount(): Promise<void> {
    this.farcasterAccount = null
    this.dcClient = null
    await storage.remove(STORAGE_KEYS.FARCASTER_ACCOUNT)
  }

  async getConversations(): Promise<Conversation[]> {
    const conversations = new Map<string, Conversation>()

    if (this.dcClient && this.farcasterAccount) {
      const myFid = this.farcasterAccount.fid
      const dcConvs = await this.dcClient.getConversations()
      for (const conv of dcConvs) {
        const otherFid =
          conv.participants.find((p) => p !== myFid) ?? conv.participants[0]
        const profile = await this.getProfile(otherFid)

        conversations.set(`fc-${conv.id}`, {
          id: `fc-${conv.id}`,
          type: 'farcaster',
          recipientFid: otherFid,
          recipientName:
            profile?.displayName ?? profile?.username ?? `FID:${otherFid}`,
          recipientAvatar: profile?.pfpUrl,
          lastMessage: conv.lastMessage
            ? {
                text: conv.lastMessage.text,
                timestamp: conv.lastMessage.timestamp,
                isFromMe: conv.lastMessage.senderFid === myFid,
              }
            : undefined,
          unreadCount: conv.unreadCount,
          isMuted: this.preferences.mutedConversations.includes(
            `fc-${conv.id}`,
          ),
          updatedAt: conv.updatedAt,
        })
      }
    }

    if (this.xmtpClient) {
      await this.xmtpClient.conversations.sync()
      const dms = await this.xmtpClient.conversations.listDms()

      for (const dm of dms) {
        const peerInboxId = await dm.peerInboxId()
        const createdAtMs = dm.createdAt?.getTime() ?? Date.now()
        conversations.set(`xmtp-${dm.id}`, {
          id: `xmtp-${dm.id}`,
          type: 'xmtp',
          recipientName: `${peerInboxId.slice(0, 10)}...`,
          unreadCount: 0,
          isMuted: this.preferences.mutedConversations.includes(
            `xmtp-${dm.id}`,
          ),
          updatedAt: createdAtMs,
        })
      }
    }

    return Array.from(conversations.values())
      .filter((c) => !this.isBlocked(c))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async getMessages(
    conversationId: string,
    options?: { limit?: number; before?: number },
  ): Promise<Message[]> {
    const [protocol, id] = conversationId.split('-', 2) as [
      'fc' | 'xmtp',
      string,
    ]

    if (protocol === 'fc' && this.dcClient && this.farcasterAccount) {
      const myFid = this.farcasterAccount.fid
      const [, peerFidStr] = id.split('-')
      const peerFid = parseInt(peerFidStr, 10)
      if (Number.isNaN(peerFid)) {
        throw new MessagingError(
          'Invalid conversation ID format',
          'INVALID_CONVERSATION_ID',
          { conversationId },
        )
      }

      const messages = await this.dcClient.getMessages(peerFid, {
        limit: options?.limit,
        before: options?.before?.toString(),
      })

      return messages.map((m: DirectCast) => ({
        id: m.id,
        conversationId,
        text: m.text,
        timestamp: m.timestamp,
        isFromMe: m.senderFid === myFid,
        status: m.isRead ? ('read' as const) : ('delivered' as const),
        protocol: 'farcaster' as const,
        metadata: {
          embeds: m.embeds
            ?.filter(
              (e): e is { url: string; type: 'url' | 'cast' | 'image' } =>
                e.url !== undefined,
            )
            .map((e) => ({ url: e.url })),
        },
      }))
    }

    if (protocol === 'xmtp' && this.xmtpClient) {
      const conversation =
        await this.xmtpClient.conversations.getConversationById(id)
      if (!conversation) {
        throw new MessagingError(
          'Conversation not found',
          'CONVERSATION_NOT_FOUND',
          { conversationId },
        )
      }

      await conversation.sync()
      const xmtpMessages = await conversation.messages({
        limit: BigInt(options?.limit ?? 50),
      })

      return xmtpMessages.map((m) => ({
        id: m.id,
        conversationId,
        text: String(m.content),
        timestamp: Number(m.sentAtNs / BigInt(1_000_000)),
        isFromMe: m.senderInboxId === this.xmtpClient?.inboxId,
        status: 'delivered' as const,
        protocol: 'xmtp' as const,
      }))
    }

    throw new MessagingError(
      'Unsupported protocol or client not initialized',
      'UNSUPPORTED_PROTOCOL',
      { protocol },
    )
  }

  async sendMessage(params: {
    recipientAddress?: Address
    recipientFid?: number
    text: string
    replyTo?: string
  }): Promise<Message> {
    log.debug('Sending message', {
      hasAddress: !!params.recipientAddress,
      hasFid: !!params.recipientFid,
      textLength: params.text.length,
    })

    if (params.recipientFid && this.dcClient && this.farcasterAccount) {
      const dc = await this.dcClient.send({
        recipientFid: params.recipientFid,
        text: params.text,
        replyTo: params.replyTo,
      })

      const message: Message = {
        id: dc.id,
        conversationId: `fc-${dc.conversationId}`,
        text: dc.text,
        timestamp: dc.timestamp,
        isFromMe: true,
        status: 'sent',
        protocol: 'farcaster',
      }

      this.notifyMessageListeners(message)
      return message
    }

    if (params.recipientAddress && this.xmtpClient) {
      const dm = await this.xmtpClient.conversations.newDmWithIdentifier({
        identifier: params.recipientAddress.toLowerCase(),
        identifierKind: 'Ethereum',
      })

      const messageId = await dm.send(params.text)

      const message: Message = {
        id: messageId,
        conversationId: `xmtp-${dm.id}`,
        text: params.text,
        timestamp: Date.now(),
        isFromMe: true,
        status: 'sent',
        protocol: 'xmtp',
      }

      this.notifyMessageListeners(message)
      return message
    }

    log.warn('sendMessage failed: no recipient or not initialized', {
      hasRecipientAddress: !!params.recipientAddress,
      hasRecipientFid: !!params.recipientFid,
      hasDcClient: !!this.dcClient,
      hasXmtpClient: !!this.xmtpClient,
    })
    throw new MessagingError(
      'No recipient or messaging not initialized',
      'SEND_FAILED',
    )
  }

  async markAsRead(conversationId: string): Promise<void> {
    const [protocol, id] = conversationId.split('-', 2) as [
      'fc' | 'xmtp',
      string,
    ]

    if (protocol === 'fc' && this.dcClient) {
      const [, peerFidStr] = id.split('-')
      const peerFid = parseInt(peerFidStr, 10)
      if (Number.isNaN(peerFid)) {
        throw new MessagingError(
          'Invalid conversation ID format',
          'INVALID_CONVERSATION_ID',
          { conversationId },
        )
      }
      await this.dcClient.markAsRead(peerFid)
    }
    // XMTP read receipts are handled automatically
  }

  async setConversationMuted(
    conversationId: string,
    muted: boolean,
  ): Promise<void> {
    if (muted) {
      if (!this.preferences.mutedConversations.includes(conversationId)) {
        this.preferences.mutedConversations.push(conversationId)
      }
    } else {
      this.preferences.mutedConversations =
        this.preferences.mutedConversations.filter(
          (id) => id !== conversationId,
        )
    }
    await this.savePreferences()
  }

  async getChannelFeed(
    channelIdOrUrl: string,
    options?: { limit?: number; cursor?: string },
  ): Promise<{
    casts: FarcasterFeedCast[]
    cursor?: string
  }> {
    if (!this.hubClient)
      throw new MessagingError('Hub client not initialized', 'NOT_INITIALIZED')

    const channelUrl = channelIdOrUrl.startsWith('https://')
      ? channelIdOrUrl
      : `https://warpcast.com/~/channel/${channelIdOrUrl}`
    const response = await this.hubClient.getCastsByChannel(channelUrl, {
      pageSize: options?.limit ?? 20,
      pageToken: options?.cursor,
    })

    const casts = await this.enrichCastsWithProfiles(response.messages)
    return { casts, cursor: response.nextPageToken }
  }

  async getUserFeed(
    fid: number,
    options?: { limit?: number; cursor?: string },
  ): Promise<{ casts: FarcasterFeedCast[]; cursor?: string }> {
    if (!this.hubClient)
      throw new MessagingError('Hub client not initialized', 'NOT_INITIALIZED')

    const response = await this.hubClient.getCastsByFid(fid, {
      pageSize: options?.limit ?? 20,
      pageToken: options?.cursor,
    })

    const casts = await this.enrichCastsWithProfiles(response.messages)
    return { casts, cursor: response.nextPageToken }
  }

  getPreferences(): MessagingPreferences {
    return { ...this.preferences }
  }

  async updatePreferences(
    updates: Partial<MessagingPreferences>,
  ): Promise<void> {
    this.preferences = { ...this.preferences, ...updates }
    await this.savePreferences()
  }

  async blockAddress(address: Address): Promise<void> {
    if (!this.preferences.blockedAddresses.includes(address)) {
      this.preferences.blockedAddresses.push(address)
      await this.savePreferences()
    }
  }

  async unblockAddress(address: Address): Promise<void> {
    this.preferences.blockedAddresses =
      this.preferences.blockedAddresses.filter(
        (a) => a.toLowerCase() !== address.toLowerCase(),
      )
    await this.savePreferences()
  }

  async blockFid(fid: number): Promise<void> {
    if (!this.preferences.blockedFids.includes(fid)) {
      this.preferences.blockedFids.push(fid)
      await this.savePreferences()
    }
  }

  async unblockFid(fid: number): Promise<void> {
    this.preferences.blockedFids = this.preferences.blockedFids.filter(
      (f) => f !== fid,
    )
    await this.savePreferences()
  }

  onMessage(callback: (message: Message) => void): () => void {
    this.messageListeners.add(callback)
    return () => this.messageListeners.delete(callback)
  }

  private notifyMessageListeners(message: Message): void {
    for (const listener of this.messageListeners) {
      listener(message)
    }
  }

  private async enrichCastsWithProfiles(
    casts: Array<{
      hash: string
      fid: number
      text: string
      timestamp: number
      embeds: Array<{ url?: string; castId?: { fid: number; hash: string } }>
      parentHash?: string
    }>,
  ): Promise<FarcasterFeedCast[]> {
    const fids = [...new Set(casts.map((c) => c.fid))]
    const profiles = await Promise.all(fids.map((fid) => this.getProfile(fid)))
    const profileMap = new Map<number, FarcasterProfile>()
    for (let i = 0; i < fids.length; i++) {
      const profile = profiles[i]
      if (profile) profileMap.set(fids[i], profile)
    }

    return casts.map((cast) => {
      const profile = profileMap.get(cast.fid)
      return {
        hash: cast.hash,
        author: {
          fid: cast.fid,
          username: profile?.username ?? '',
          displayName: profile?.displayName ?? '',
          pfpUrl: profile?.pfpUrl ?? '',
        },
        text: cast.text,
        timestamp: cast.timestamp,
        embeds: extractEmbeds(cast.embeds),
        parentHash: cast.parentHash,
      }
    })
  }

  private isBlocked(conversation: Conversation): boolean {
    const addr = conversation.recipientAddress
    if (addr) {
      return this.preferences.blockedAddresses.some(
        (a) => a.toLowerCase() === addr.toLowerCase(),
      )
    }
    if (conversation.recipientFid) {
      return this.preferences.blockedFids.includes(conversation.recipientFid)
    }
    return false
  }

  private async loadFarcasterAccount(): Promise<void> {
    const saved = await storage.getJSON(
      STORAGE_KEYS.FARCASTER_ACCOUNT,
      FarcasterAccountSchema,
    )
    if (saved) {
      this.farcasterAccount = saved as FarcasterAccount
    }
  }

  private async saveFarcasterAccount(): Promise<void> {
    if (this.farcasterAccount) {
      await storage.set(
        STORAGE_KEYS.FARCASTER_ACCOUNT,
        JSON.stringify(this.farcasterAccount),
      )
    }
  }

  private async loadPreferences(): Promise<void> {
    const saved = await storage.getJSON(
      STORAGE_KEYS.MESSAGING_PREFS,
      MessagingPreferencesSchema,
    )
    if (saved) {
      this.preferences = saved as MessagingPreferences
    }
  }

  private async savePreferences(): Promise<void> {
    await storage.set(
      STORAGE_KEYS.MESSAGING_PREFS,
      JSON.stringify(this.preferences),
    )
  }

  async destroy(): Promise<void> {
    log.debug('Destroying messaging service')
    this.messageListeners.clear()
    this.hubClient = null
    this.dcClient = null
    this.xmtpClient = null
    this.kmsSigner = null
    this.initialized = false
  }
}

export const messagingService = new WalletMessagingService()
export { WalletMessagingService }

/** Health check for monitoring */
export function getMessagingHealth(): {
  status: 'ok' | 'degraded' | 'down'
  hubUrl: string
  initialized: boolean
  hasFarcaster: boolean
  hasXMTP: boolean
} {
  const svc = messagingService
  return {
    status: svc.isInitialized ? 'ok' : 'down',
    hubUrl: HUB_URL,
    initialized: svc.isInitialized,
    hasFarcaster: svc.hasFarcaster,
    hasXMTP: svc.hasXMTP,
  }
}
