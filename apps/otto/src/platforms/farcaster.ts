/**
 * Farcaster Platform Adapter
 * Integrates with Farcaster via Neynar API for DMs and cast mentions
 */

import { z } from 'zod'
import { expectValid, PlatformMessageSchema } from '../schemas'
import type { MessageButton, MessageEmbed, PlatformMessage } from '../types'
import type {
  MessageHandler,
  PlatformAdapter,
  PlatformChannelInfo,
  PlatformUserInfo,
  SendMessageOptions,
} from './types'

// These are read lazily to allow graceful startup without Farcaster configured
function getNeynarApiUrl(): string {
  return process.env.NEYNAR_API_URL ?? 'https://api.neynar.com/v2'
}

function getNeynarApiKey(): string {
  const key = process.env.NEYNAR_API_KEY
  if (!key) {
    throw new Error('NEYNAR_API_KEY is required for Farcaster integration')
  }
  return key
}

function getFarcasterBotFid(): number {
  const fid = process.env.FARCASTER_BOT_FID
  if (!fid) {
    throw new Error('FARCASTER_BOT_FID is required for Farcaster integration')
  }
  const parsed = parseInt(fid, 10)
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid FARCASTER_BOT_FID: ${fid}`)
  }
  return parsed
}

function getFarcasterSignerUuid(): string {
  return process.env.FARCASTER_SIGNER_UUID ?? ''
}

export class FarcasterAdapter implements PlatformAdapter {
  readonly platform = 'farcaster' as const

  private apiKey: string
  private apiUrl: string
  private botFid: number
  private signerUuid: string
  private messageHandler: MessageHandler | null = null
  private ready = false
  private pollInterval: ReturnType<typeof setInterval> | null = null
  private lastMentionTimestamp = 0
  private lastDmTimestamp = 0

  constructor(apiKey?: string, botFid?: number, signerUuid?: string) {
    // Use provided values or lazily load from env (will throw if not configured)
    this.apiKey = apiKey ?? ''
    this.apiUrl = getNeynarApiUrl()
    this.botFid = botFid ?? 0
    this.signerUuid = signerUuid ?? ''
    // Actual validation happens in initialize() to allow graceful startup
  }

  async initialize(): Promise<void> {
    console.log('[Farcaster] Initializing...')

    // Load from env if not provided in constructor
    if (!this.apiKey) {
      this.apiKey = getNeynarApiKey()
    }
    if (!this.botFid) {
      this.botFid = getFarcasterBotFid()
    }
    if (!this.signerUuid) {
      this.signerUuid = getFarcasterSignerUuid()
    }

    // Verify API key works
    const profile = await this.getUser(String(this.botFid))
    if (!profile) {
      console.error('[Farcaster] Failed to verify bot account')
      return
    }

    console.log(
      `[Farcaster] Bot account: @${profile.username} (FID: ${this.botFid})`,
    )

    // Start polling for mentions and DMs
    this.startPolling()

    this.ready = true
    console.log('[Farcaster] Initialized')
  }

  async shutdown(): Promise<void> {
    console.log('[Farcaster] Shutting down...')
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
    this.ready = false
  }

  isReady(): boolean {
    return this.ready
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler
  }

  private startPolling(): void {
    // Poll for mentions and DMs every 5 seconds
    this.pollInterval = setInterval(async () => {
      await this.pollMentions()
      await this.pollDirectCasts()
    }, 5000)

    // Initial poll
    this.pollMentions()
    this.pollDirectCasts()
  }

  private async pollMentions(): Promise<void> {
    const response = await fetch(
      `${this.apiUrl}/farcaster/notifications?fid=${this.botFid}&type=mentions`,
      { headers: this.getHeaders() },
    ).catch(() => null)

    if (!response?.ok) return

    const rawData = await response.json()

    // Farcaster profile schema for mentioned users
    const FarcasterProfileSchema = z.object({
      fid: z.number().int().positive(),
      username: z.string().min(1),
      display_name: z.string().optional(),
      pfp_url: z.string().url().optional(),
      custody_address: z.string().optional(),
    })

    const NotificationsResponseSchema = z.object({
      notifications: z.array(
        z.object({
          cast: z.object({
            hash: z.string().min(1),
            author: z.object({
              fid: z.number().int().positive(),
              username: z.string().min(1),
              display_name: z.string().min(1),
              pfp_url: z.string().url(),
              custody_address: z.string().min(1),
            }),
            text: z.string(),
            timestamp: z.string(),
            parent_hash: z.string().optional(),
            parent_url: z.string().optional(),
            mentioned_profiles: z.array(FarcasterProfileSchema).optional(),
            channel: z
              .object({
                id: z.string().min(1),
                name: z.string().min(1),
              })
              .optional(),
          }),
          most_recent_timestamp: z.string(),
        }),
      ),
    })

    const data = expectValid(
      NotificationsResponseSchema,
      rawData,
      'Farcaster notifications response',
    )

    for (const notification of data.notifications) {
      const timestamp = new Date(notification.most_recent_timestamp).getTime()
      if (timestamp <= this.lastMentionTimestamp) continue

      this.lastMentionTimestamp = Math.max(this.lastMentionTimestamp, timestamp)

      const cast = notification.cast
      if (cast.author.fid === this.botFid) continue // Skip own casts

      // Extract command from cast text
      const text = this.extractCommand(cast.text)
      if (!text) continue

      const message: PlatformMessage = {
        platform: 'farcaster',
        messageId: cast.hash,
        channelId:
          cast.channel?.id ?? `thread:${cast.parent_hash ?? cast.hash}`,
        userId: String(cast.author.fid),
        content: text,
        timestamp,
        isCommand: true,
        replyToId: cast.parent_hash,
      }

      const validatedMessage = expectValid(
        PlatformMessageSchema,
        message,
        'Farcaster mention message',
      )

      if (this.messageHandler) {
        await this.messageHandler(validatedMessage)
      }
    }
  }

  private async pollDirectCasts(): Promise<void> {
    // Get direct cast conversations
    const response = await fetch(
      `${this.apiUrl}/farcaster/direct_cast/conversations?fid=${this.botFid}`,
      { headers: this.getHeaders() },
    ).catch(() => null)

    if (!response?.ok) return

    const rawData = await response.json()
    const ConversationsResponseSchema = z.object({
      conversations: z.array(
        z.object({
          id: z.string().min(1),
          last_message: z.object({
            id: z.string().min(1),
            conversation_id: z.string().min(1),
            sender: z.object({
              fid: z.number().int().positive(),
              username: z.string().min(1),
              display_name: z.string().min(1),
              pfp_url: z.string().url(),
              custody_address: z.string().min(1),
            }),
            recipient: z.object({
              fid: z.number().int().positive(),
              username: z.string().min(1),
              display_name: z.string().min(1),
              pfp_url: z.string().url(),
              custody_address: z.string().min(1),
            }),
            text: z.string(),
            timestamp: z.string(),
          }),
        }),
      ),
    })

    const data = expectValid(
      ConversationsResponseSchema,
      rawData,
      'Farcaster conversations response',
    )

    for (const conv of data.conversations) {
      const dm = conv.last_message
      if (!dm) continue

      const timestamp = new Date(dm.timestamp).getTime()
      if (timestamp <= this.lastDmTimestamp) continue
      if (dm.sender.fid === this.botFid) continue // Skip own messages

      this.lastDmTimestamp = Math.max(this.lastDmTimestamp, timestamp)

      // Extract command from DM
      const text = this.extractCommand(dm.text)

      const message: PlatformMessage = {
        platform: 'farcaster',
        messageId: dm.id,
        channelId: `dm:${conv.id}`,
        userId: String(dm.sender.fid),
        content: text || dm.text, // For DMs, always process
        timestamp,
        isCommand: true,
      }

      const validatedMessage = expectValid(
        PlatformMessageSchema,
        message,
        'Farcaster DM message',
      )

      if (this.messageHandler) {
        await this.messageHandler(validatedMessage)
      }
    }
  }

  private extractCommand(text: string): string {
    // Remove @otto mention and extract command
    const withoutMention = text.replace(/@otto\s*/gi, '').trim()

    // Check if starts with otto command
    if (withoutMention.toLowerCase().startsWith('otto ')) {
      return withoutMention.slice(5).trim()
    }

    // For direct casts, assume everything is a command
    return withoutMention
  }

  async sendMessage(
    channelId: string,
    content: string,
    options?: SendMessageOptions,
  ): Promise<string> {
    // Determine if this is a DM or a cast reply
    if (channelId.startsWith('dm:')) {
      return this.sendDirectCast(channelId.slice(3), content)
    }

    return this.postCast(content, options?.replyToMessageId)
  }

  async sendEmbed(
    channelId: string,
    embed: MessageEmbed,
    buttons?: MessageButton[],
  ): Promise<string> {
    // Farcaster doesn't have embeds, format as text
    const content = this.formatEmbed(embed, buttons)
    return this.sendMessage(channelId, content)
  }

  async replyToMessage(
    channelId: string,
    messageId: string,
    content: string,
    _options?: SendMessageOptions,
  ): Promise<string> {
    if (channelId.startsWith('dm:')) {
      return this.sendDirectCast(channelId.slice(3), content)
    }

    return this.postCast(content, messageId)
  }

  async editMessage(
    _channelId: string,
    _messageId: string,
    _content: string,
  ): Promise<void> {
    console.log('[Farcaster] Edit not supported')
  }

  async deleteMessage(_channelId: string, messageId: string): Promise<void> {
    await fetch(`${this.apiUrl}/farcaster/cast`, {
      method: 'DELETE',
      headers: this.getHeaders(),
      body: JSON.stringify({
        signer_uuid: this.signerUuid,
        target_hash: messageId,
      }),
    })
  }

  async addReaction(
    _channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
    // Like the cast
    if (emoji === '👍' || emoji === '❤️' || emoji === 'like') {
      await fetch(`${this.apiUrl}/farcaster/reaction`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          signer_uuid: this.signerUuid,
          reaction_type: 'like',
          target: messageId,
        }),
      })
    }
  }

  async getUser(userId: string): Promise<PlatformUserInfo | null> {
    const fid = parseInt(userId, 10)
    if (Number.isNaN(fid)) return null

    const response = await fetch(
      `${this.apiUrl}/farcaster/user/bulk?fids=${fid}`,
      { headers: this.getHeaders() },
    ).catch(() => null)

    if (!response?.ok) return null

    const rawData = await response.json()
    const UsersResponseSchema = z.object({
      users: z.array(
        z.object({
          fid: z.number().int().positive(),
          username: z.string().min(1),
          display_name: z.string().min(1),
          pfp_url: z.string().url(),
          custody_address: z.string().min(1),
          verified_addresses: z
            .object({
              eth_addresses: z.array(z.string()).optional(),
            })
            .optional(),
        }),
      ),
    })

    const data = expectValid(
      UsersResponseSchema,
      rawData,
      'Farcaster users response',
    )
    const user = data.users[0]
    if (!user) return null

    return {
      id: String(user.fid),
      username: user.username,
      displayName: user.display_name,
      avatarUrl: user.pfp_url,
    }
  }

  async getChannel(channelId: string): Promise<PlatformChannelInfo | null> {
    if (channelId.startsWith('dm:')) {
      return {
        id: channelId,
        name: 'Direct Message',
        type: 'dm',
      }
    }

    if (channelId.startsWith('thread:')) {
      return {
        id: channelId,
        name: 'Thread',
        type: 'group',
      }
    }

    // Farcaster channel
    const response = await fetch(
      `${this.apiUrl}/farcaster/channel?id=${channelId}`,
      { headers: this.getHeaders() },
    ).catch(() => null)

    if (!response?.ok) {
      return {
        id: channelId,
        name: channelId,
        type: 'group',
      }
    }

    const rawData = await response.json()
    const ChannelResponseSchema = z.object({
      channel: z.object({
        id: z.string().min(1),
        name: z.string().min(1),
      }),
    })

    const data = expectValid(
      ChannelResponseSchema,
      rawData,
      'Farcaster channel response',
    )

    return {
      id: data.channel.id,
      name: data.channel.name,
      type: 'group' as const,
    }
  }

  private async postCast(text: string, replyTo?: string): Promise<string> {
    const body: Record<string, string | undefined> = {
      signer_uuid: this.signerUuid,
      text,
    }

    if (replyTo) {
      body.parent = replyTo
    }

    const response = await fetch(`${this.apiUrl}/farcaster/cast`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`Failed to post cast: ${response.status}`)
    }

    const rawData = await response.json()
    const CastResponseSchema = z.object({
      cast: z.object({
        hash: z.string().min(1),
      }),
    })

    const data = expectValid(
      CastResponseSchema,
      rawData,
      'Farcaster cast response',
    )
    return data.cast.hash
  }

  private async sendDirectCast(
    conversationId: string,
    text: string,
  ): Promise<string> {
    const response = await fetch(`${this.apiUrl}/farcaster/direct_cast`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        signer_uuid: this.signerUuid,
        conversation_id: conversationId,
        text,
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to send direct cast: ${response.status}`)
    }

    const rawData = await response.json()
    const DirectCastResponseSchema = z.object({
      message: z.object({
        id: z.string().min(1),
      }),
    })

    const data = expectValid(
      DirectCastResponseSchema,
      rawData,
      'Farcaster direct cast response',
    )
    return data.message.id
  }

  private formatEmbed(embed: MessageEmbed, buttons?: MessageButton[]): string {
    const lines: string[] = []

    if (embed.title) {
      lines.push(`**${embed.title}**`)
    }

    if (embed.description) {
      lines.push(embed.description)
    }

    if (embed.fields?.length) {
      lines.push('')
      for (const field of embed.fields) {
        lines.push(`${field.name}: ${field.value}`)
      }
    }

    // Add button URLs as links
    if (buttons?.length) {
      lines.push('')
      for (const button of buttons) {
        if (button.url) {
          lines.push(`${button.label}: ${button.url}`)
        }
      }
    }

    if (embed.footer) {
      lines.push('')
      lines.push(embed.footer)
    }

    return lines.join('\n')
  }

  private getHeaders(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      api_key: this.apiKey,
    }
  }

  // Frame validation for Farcaster Frames
  async validateFrame(messageBytes: Uint8Array): Promise<{
    valid: boolean
    fid: number
    buttonIndex: number
    inputText?: string
    castHash?: string
  } | null> {
    const response = await fetch(`${this.apiUrl}/farcaster/frame/validate`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        message_bytes_in_hex: Buffer.from(messageBytes).toString('hex'),
      }),
    })

    if (!response.ok) return null

    const rawData = await response.json()

    // Validate the response schema to prevent insecure deserialization
    const FrameValidationResponseSchema = z.object({
      valid: z.boolean(),
      action: z.object({
        interactor: z.object({ fid: z.number().int().positive() }),
        button_index: z.number().int().positive(),
        input: z.object({ text: z.string() }).optional(),
        cast: z.object({ hash: z.string().min(1) }).optional(),
      }),
    })

    const data = expectValid(
      FrameValidationResponseSchema,
      rawData,
      'Farcaster frame validation response',
    )

    return {
      valid: data.valid,
      fid: data.action.interactor.fid,
      buttonIndex: data.action.button_index,
      inputText: data.action.input?.text,
      castHash: data.action.cast?.hash,
    }
  }
}
