/**
 * Twitter/X Platform Adapter
 * Uses Twitter API v2 for posting and monitoring mentions
 */

import { z } from 'zod'
import {
  expectValid,
  PlatformMessageSchema,
  TwitterWebhookPayloadSchema,
} from '../schemas'
import type {
  MessageButton,
  MessageEmbed,
  PlatformMessage,
  TwitterWebhookPayload,
} from '../types'
import type {
  MessageHandler,
  PlatformAdapter,
  PlatformChannelInfo,
  PlatformUserInfo,
  SendMessageOptions,
} from './types'

interface TwitterCredentials {
  apiKey: string
  apiSecret: string
  accessToken: string
  accessSecret: string
  bearerToken: string
}

interface Tweet {
  id: string
  text: string
  author_id: string
  conversation_id?: string
  in_reply_to_user_id?: string
  created_at: string
}

interface TwitterUser {
  id: string
  username: string
  name: string
  profile_image_url?: string
}

export class TwitterAdapter implements PlatformAdapter {
  readonly platform = 'twitter' as const

  private credentials: TwitterCredentials
  private botUsername: string
  private messageHandler: MessageHandler | null = null
  private ready = false
  private pollingInterval: ReturnType<typeof setInterval> | null = null
  private lastMentionId: string | null = null

  constructor(credentials: TwitterCredentials, botUsername: string) {
    this.credentials = credentials
    this.botUsername = botUsername.replace('@', '')
  }

  async initialize(): Promise<void> {
    console.log('[Twitter] Initializing...')

    // Verify credentials
    const me = await this.verifyCredentials()
    if (!me) {
      throw new Error('Failed to verify Twitter credentials')
    }

    console.log(`[Twitter] Authenticated as @${me.username}`)

    // Start polling for mentions (Twitter API v2 doesn't have streaming for free tier)
    this.startPolling()

    this.ready = true
    console.log('[Twitter] Initialized')
  }

  async shutdown(): Promise<void> {
    console.log('[Twitter] Shutting down...')
    this.ready = false
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = null
    }
  }

  isReady(): boolean {
    return this.ready
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler
  }

  async handleWebhook(payload: TwitterWebhookPayload): Promise<void> {
    const validatedPayload = expectValid(
      TwitterWebhookPayloadSchema,
      payload,
      'Twitter webhook',
    )

    if (validatedPayload.tweet_create_events) {
      for (const webhookTweet of validatedPayload.tweet_create_events) {
        if (this.isMention(webhookTweet)) {
          const tweet: Tweet = {
            id: webhookTweet.id_str,
            text: webhookTweet.text,
            author_id: webhookTweet.user.id_str,
            created_at: webhookTweet.created_at,
            in_reply_to_user_id: webhookTweet.in_reply_to_status_id_str,
          }
          await this.processTweet(tweet)
        }
      }
    }

    if (validatedPayload.direct_message_events) {
      for (const dm of validatedPayload.direct_message_events) {
        if (
          dm.type === 'message_create' &&
          dm.message_create.sender_id !== validatedPayload.for_user_id
        ) {
          await this.processDirectMessage(dm)
        }
      }
    }
  }

  async sendMessage(
    channelId: string,
    content: string,
    _options?: SendMessageOptions,
  ): Promise<string> {
    if (channelId.startsWith('dm:')) {
      const recipientId = channelId.replace('dm:', '')
      return this.sendDirectMessage(recipientId, content)
    }

    return this.postTweet(content, channelId)
  }

  async sendEmbed(
    channelId: string,
    embed: MessageEmbed,
    buttons?: MessageButton[],
  ): Promise<string> {
    const content = this.formatEmbed(embed, buttons)
    return this.sendMessage(channelId, content)
  }

  async replyToMessage(
    _channelId: string,
    messageId: string,
    content: string,
    _options?: SendMessageOptions,
  ): Promise<string> {
    return this.postTweet(content, messageId)
  }

  async editMessage(
    _channelId: string,
    _messageId: string,
    _content: string,
  ): Promise<void> {
    console.log('[Twitter] Tweet editing not supported')
  }

  async deleteMessage(_channelId: string, messageId: string): Promise<void> {
    await this.deleteTweet(messageId)
  }

  async addReaction(
    _channelId: string,
    messageId: string,
    _emoji: string,
  ): Promise<void> {
    await this.likeTweet(messageId)
  }

  async getUser(userId: string): Promise<PlatformUserInfo | null> {
    const user = await this.fetchUser(userId)
    if (!user) return null

    return {
      id: user.id,
      username: user.username,
      displayName: user.name,
      avatarUrl: user.profile_image_url,
    }
  }

  async getChannel(channelId: string): Promise<PlatformChannelInfo | null> {
    // For Twitter, "channel" is either a conversation thread or DM
    if (channelId.startsWith('dm:')) {
      return {
        id: channelId,
        name: 'Direct Message',
        type: 'dm',
      }
    }

    return {
      id: channelId,
      name: 'Thread',
      type: 'group',
    }
  }

  // Private methods

  private async verifyCredentials(): Promise<TwitterUser | null> {
    const TwitterUserSchema = z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      username: z.string().min(1),
      profile_image_url: z.string().url().optional(),
    })

    const response = await this.apiRequest<z.infer<typeof TwitterUserSchema>>(
      'GET',
      '/users/me',
    )
    if (!response?.data) {
      return null
    }

    const validated = expectValid(
      TwitterUserSchema,
      response.data,
      'Twitter credentials',
    )
    return validated
  }

  private startPolling(): void {
    // Poll every 15 seconds (rate limit friendly)
    this.pollingInterval = setInterval(() => {
      this.pollMentions().catch((err: Error) => {
        const errorMessage = err instanceof Error ? err.message : String(err)
        console.error('[Twitter] Poll error:', errorMessage)
      })
    }, 15000)

    // Initial poll
    this.pollMentions().catch((err: Error) => {
      const errorMessage = err instanceof Error ? err.message : String(err)
      console.error('[Twitter] Initial poll error:', errorMessage)
    })
  }

  private async pollMentions(): Promise<void> {
    const params = new URLSearchParams({
      'tweet.fields':
        'author_id,conversation_id,created_at,in_reply_to_user_id',
      expansions: 'author_id',
      'user.fields': 'username',
    })

    if (this.lastMentionId) {
      params.set('since_id', this.lastMentionId)
    }

    const response = await this.apiRequest(
      'GET',
      `/users/me/mentions?${params}`,
    )

    if (response?.data) {
      // Process newest first, but update lastMentionId with the newest
      const TweetArraySchema = z.array(
        z.object({
          id: z.string().min(1),
          text: z.string(),
          author_id: z.string().min(1),
          created_at: z.string(),
          conversation_id: z.string().optional(),
          in_reply_to_user_id: z.string().optional(),
        }),
      )

      const tweets = expectValid(
        TweetArraySchema,
        response.data ?? [],
        'Twitter mentions',
      )
      if (tweets.length > 0) {
        this.lastMentionId = tweets[0].id
      }

      // Process in reverse order (oldest first)
      for (const tweet of tweets.reverse()) {
        await this.processTweet(tweet as Tweet)
      }
    }
  }

  private async processTweet(tweet: Tweet): Promise<void> {
    if (!tweet.id || !tweet.author_id || !tweet.text) {
      throw new Error('Invalid tweet: missing required fields')
    }

    // Extract command from tweet text
    const content = this.extractCommand(tweet.text)
    if (!content) return

    const message: PlatformMessage = {
      platform: 'twitter',
      messageId: tweet.id,
      channelId: tweet.conversation_id ?? tweet.id,
      userId: tweet.author_id,
      content,
      timestamp: new Date(tweet.created_at).getTime(),
      isCommand: true,
      replyToId: tweet.in_reply_to_user_id ? tweet.id : undefined,
    }

    const validatedMessage = expectValid(
      PlatformMessageSchema,
      message,
      'Twitter tweet message',
    )

    if (this.messageHandler) {
      await this.messageHandler(validatedMessage)
    }
  }

  private async processDirectMessage(dm: {
    message_create: { sender_id: string; message_data: { text: string } }
  }): Promise<void> {
    if (
      !dm.message_create?.sender_id ||
      !dm.message_create?.message_data?.text
    ) {
      throw new Error('Invalid direct message: missing required fields')
    }

    const message: PlatformMessage = {
      platform: 'twitter',
      messageId: `${dm.message_create.sender_id}-${Date.now()}`,
      channelId: `dm:${dm.message_create.sender_id}`,
      userId: dm.message_create.sender_id,
      content: dm.message_create.message_data.text,
      timestamp: Date.now(),
      isCommand: true,
    }

    const validatedMessage = expectValid(
      PlatformMessageSchema,
      message,
      'Twitter DM message',
    )

    if (this.messageHandler) {
      await this.messageHandler(validatedMessage)
    }
  }

  private isMention(tweet: { text: string }): boolean {
    const lowerText = tweet.text.toLowerCase()
    return lowerText.includes(`@${this.botUsername.toLowerCase()}`)
  }

  private extractCommand(text: string): string {
    // Remove @mentions and extract command
    let content = text.replace(/@\w+/g, '').trim()

    // Remove common prefixes
    content = content.replace(/^otto\s*/i, '').trim()

    return content
  }

  private async postTweet(text: string, replyToId?: string): Promise<string> {
    // Truncate to Twitter limit (280 chars)
    const truncated = text.length > 280 ? `${text.slice(0, 277)}...` : text

    const body: { text: string; reply?: { in_reply_to_tweet_id: string } } = {
      text: truncated,
    }

    if (replyToId) {
      body.reply = { in_reply_to_tweet_id: replyToId }
    }

    const response = await this.apiRequest('POST', '/tweets', body)

    // Validate response schema to prevent insecure deserialization
    const TweetResponseSchema = z.object({
      data: z.object({
        id: z.string().min(1),
      }),
    })

    const validated = TweetResponseSchema.safeParse(response)
    if (!validated.success) {
      throw new Error('Failed to post tweet: invalid response')
    }

    return validated.data.data.id
  }

  private async deleteTweet(tweetId: string): Promise<void> {
    await this.apiRequest('DELETE', `/tweets/${tweetId}`)
  }

  private async likeTweet(tweetId: string): Promise<void> {
    const me = await this.verifyCredentials()
    if (!me) return

    await this.apiRequest('POST', `/users/${me.id}/likes`, {
      tweet_id: tweetId,
    })
  }

  private async sendDirectMessage(
    recipientId: string,
    text: string,
  ): Promise<string> {
    const body = {
      dm_conversation_id: recipientId,
      message: { text },
    }

    const response = await this.apiRequest(
      'POST',
      '/dm_conversations/with/:participant_id/messages',
      body,
    )

    // Validate response schema to prevent insecure deserialization
    const DMResponseSchema = z.object({
      data: z.object({
        dm_event_id: z.string().min(1),
      }),
    })

    const validated = DMResponseSchema.safeParse(response)
    if (!validated.success) {
      throw new Error('Failed to send direct message: invalid response')
    }

    return validated.data.data.dm_event_id
  }

  private async fetchUser(userId: string): Promise<TwitterUser | null> {
    const TwitterUserSchema = z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      username: z.string().min(1),
      profile_image_url: z.string().url().optional(),
    })

    const response = await this.apiRequest<z.infer<typeof TwitterUserSchema>>(
      'GET',
      `/users/${userId}?user.fields=profile_image_url`,
    )
    if (!response?.data) {
      return null
    }

    const validated = expectValid(
      TwitterUserSchema,
      response.data,
      'Twitter user',
    )
    return validated
  }

  private formatEmbed(embed: MessageEmbed, buttons?: MessageButton[]): string {
    const lines: string[] = []

    if (embed.title) {
      lines.push(`📊 ${embed.title}`)
    }

    if (embed.description) {
      lines.push(embed.description)
    }

    if (embed.fields?.length) {
      for (const field of embed.fields) {
        lines.push(`\n${field.name}: ${field.value}`)
      }
    }

    if (buttons?.length) {
      lines.push('')
      for (const btn of buttons) {
        if (btn.url) {
          lines.push(`🔗 ${btn.label}: ${btn.url}`)
        }
      }
    }

    return lines.join('\n')
  }

  private async apiRequest<T = Record<string, unknown>>(
    method: string,
    endpoint: string,
    body?: Record<string, unknown>,
  ): Promise<{ data?: T } | null> {
    const url = `https://api.twitter.com/2${endpoint}`

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.credentials.bearerToken}`,
      'Content-Type': 'application/json',
    }

    const options: RequestInit = {
      method,
      headers,
    }

    if (body) {
      options.body = JSON.stringify(body)
    }

    const response = await fetch(url, options)

    if (!response.ok) {
      const error = await response.text()
      console.error(`[Twitter] API error ${response.status}:`, error)
      return null
    }

    if (response.status === 204) {
      return {}
    }

    // Parse JSON and validate basic structure
    // Callers are responsible for validating the specific response shape
    const rawData: unknown = await response.json()

    // Twitter API v2 returns { data: ... } or { data: [...], ... } for most endpoints
    // Basic structural validation - callers validate specific schemas
    const TwitterApiResponseSchema = z
      .object({
        data: z.unknown().optional(),
      })
      .passthrough()

    const result = TwitterApiResponseSchema.safeParse(rawData)
    if (!result.success) {
      console.error('[Twitter] Invalid API response structure')
      return null
    }

    return result.data as { data?: T }
  }
}
