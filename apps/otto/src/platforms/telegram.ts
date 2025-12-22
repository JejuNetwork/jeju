/**
 * Telegram Platform Adapter
 */

import { expectValid } from '@jejunetwork/types'
import { type Context, Markup, Telegraf } from 'telegraf'
import type { Message, Update } from 'telegraf/types'
import { PlatformMessageSchema, TelegramWebhookPayloadSchema } from '../schemas'
import type {
  MessageButton,
  MessageEmbed,
  PlatformMessage,
  TelegramWebhookPayload,
} from '../types'
import type {
  MessageHandler,
  PlatformAdapter,
  PlatformChannelInfo,
  PlatformUserInfo,
  SendMessageOptions,
} from './types'

interface TelegramExtraReplyMessage {
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2'
  reply_markup?: ReturnType<typeof Markup.inlineKeyboard>['reply_markup']
  reply_parameters?: { message_id: number }
}

export class TelegramAdapter implements PlatformAdapter {
  readonly platform = 'telegram' as const

  private bot: Telegraf
  private webhookSecret: string
  private messageHandler: MessageHandler | null = null
  private ready = false

  constructor(token: string, webhookSecret?: string) {
    this.webhookSecret = webhookSecret ?? ''
    this.bot = new Telegraf(token)

    this.setupHandlers()
  }

  private setupHandlers(): void {
    // Handle /start command
    this.bot.command('start', async (ctx) => {
      const message = this.convertContext(ctx, 'help')
      if (this.messageHandler) {
        await this.messageHandler(message)
      }
    })

    // Handle /otto command
    this.bot.command('otto', async (ctx) => {
      const message = this.convertContext(ctx)
      if (this.messageHandler) {
        await this.messageHandler(message)
      }
    })

    // Handle text messages that start with "otto" or mention the bot
    this.bot.on('text', async (ctx) => {
      const text = ctx.message.text.toLowerCase()
      if (text.startsWith('otto ') || text.startsWith('/otto')) {
        const message = this.convertContext(ctx)
        if (this.messageHandler) {
          await this.messageHandler(message)
        }
      }
    })

    // Handle callback queries (button presses)
    this.bot.on('callback_query', async (ctx) => {
      if (!('data' in ctx.callbackQuery)) return

      if (!ctx.callbackQuery.id || !ctx.callbackQuery.from?.id) {
        throw new Error(
          'Invalid Telegram callback query: missing required fields',
        )
      }

      const data = ctx.callbackQuery.data
      if (!data) {
        throw new Error('Telegram callback query data is required')
      }

      const chatId = ctx.callbackQuery.message?.chat?.id
      if (!chatId) {
        throw new Error('Telegram callback query must have chat ID')
      }
      const channelId = chatId

      const message: PlatformMessage = {
        platform: 'telegram',
        messageId: ctx.callbackQuery.id,
        channelId: String(channelId),
        userId: String(ctx.callbackQuery.from.id),
        content: data,
        timestamp: Date.now(),
        isCommand: true,
      }

      const validatedMessage = expectValid(
        PlatformMessageSchema,
        message,
        'Telegram callback message',
      )

      await ctx.answerCbQuery()

      if (this.messageHandler) {
        await this.messageHandler(validatedMessage)
      }
    })

    // Telegraf's catch requires (err: unknown, ctx: Context) signature
    this.bot.catch((err) => {
      const errorMessage = err instanceof Error ? err.message : String(err)
      console.error('[Telegram] Bot error:', errorMessage)
    })
  }

  private convertContext(
    ctx: Context,
    overrideCommand?: string,
  ): PlatformMessage {
    const message = ctx.message as Message.TextMessage | undefined
    if (!message) {
      throw new Error('No message in context')
    }

    if (!message.message_id || !message.chat?.id || !message.from?.id) {
      throw new Error('Invalid Telegram message: missing required fields')
    }

    // Extract command and arguments
    let content = message.text ?? ''
    content = content
      .replace(/^\/otto(@\w+)?\s*/i, '')
      .replace(/^otto\s*/i, '')
      .trim()

    if (overrideCommand) {
      content = overrideCommand
    }

    const platformMessage: PlatformMessage = {
      platform: 'telegram',
      messageId: String(message.message_id),
      channelId: String(message.chat.id),
      userId: String(message.from.id),
      content,
      timestamp: message.date * 1000,
      isCommand: true,
      replyToId: message.reply_to_message?.message_id
        ? String(message.reply_to_message.message_id)
        : undefined,
    }

    return expectValid(
      PlatformMessageSchema,
      platformMessage,
      'Telegram platform message',
    )
  }

  async initialize(): Promise<void> {
    console.log('[Telegram] Initializing...')

    // Set bot commands menu
    await this.bot.telegram.setMyCommands([
      { command: 'otto', description: 'Talk to Otto trading assistant' },
      { command: 'start', description: 'Get started with Otto' },
    ])

    // Start polling (for development) or set webhook (for production)
    const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL
    if (webhookUrl) {
      console.log('[Telegram] Setting webhook:', webhookUrl)
      await this.bot.telegram.setWebhook(webhookUrl, {
        secret_token: this.webhookSecret || undefined,
      })
    } else {
      console.log('[Telegram] Starting polling...')
      this.bot.launch().catch((err: Error) => {
        const errorMessage = err instanceof Error ? err.message : String(err)
        console.error('[Telegram] Launch error:', errorMessage)
      })
    }

    this.ready = true
    console.log('[Telegram] Initialized')
  }

  async shutdown(): Promise<void> {
    console.log('[Telegram] Shutting down...')
    this.ready = false
    this.bot.stop()
  }

  isReady(): boolean {
    return this.ready
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler
  }

  async handleWebhook(payload: TelegramWebhookPayload): Promise<void> {
    const validatedPayload = expectValid(
      TelegramWebhookPayloadSchema,
      payload,
      'Telegram webhook',
    )
    // TelegramWebhookPayload matches Telegraf's Update type structure
    // The validated payload is safe to pass to handleUpdate
    const update: Update = validatedPayload as Update
    await this.bot.handleUpdate(update)
  }

  async sendMessage(
    channelId: string,
    content: string,
    options?: SendMessageOptions,
  ): Promise<string> {
    const chatId = parseInt(channelId, 10)

    const extra: TelegramExtraReplyMessage = {
      parse_mode: 'HTML',
    }

    if (options?.buttons?.length) {
      extra.reply_markup = this.createInlineKeyboard(options.buttons)
    }

    if (options?.replyToMessageId) {
      extra.reply_parameters = {
        message_id: parseInt(options.replyToMessageId, 10),
      }
    }

    const message = await this.bot.telegram.sendMessage(chatId, content, extra)
    return String(message.message_id)
  }

  async sendEmbed(
    channelId: string,
    embed: MessageEmbed,
    buttons?: MessageButton[],
  ): Promise<string> {
    const content = this.formatEmbed(embed)

    const extra: TelegramExtraReplyMessage = {
      parse_mode: 'HTML',
    }

    if (buttons?.length) {
      extra.reply_markup = this.createInlineKeyboard(buttons)
    }

    const message = await this.bot.telegram.sendMessage(
      parseInt(channelId, 10),
      content,
      extra,
    )
    return String(message.message_id)
  }

  async replyToMessage(
    channelId: string,
    messageId: string,
    content: string,
    options?: SendMessageOptions,
  ): Promise<string> {
    const chatId = parseInt(channelId, 10)

    const extra: TelegramExtraReplyMessage = {
      parse_mode: 'HTML',
      reply_parameters: { message_id: parseInt(messageId, 10) },
    }

    if (options?.buttons?.length) {
      extra.reply_markup = this.createInlineKeyboard(options.buttons)
    }

    const message = await this.bot.telegram.sendMessage(chatId, content, extra)
    return String(message.message_id)
  }

  async editMessage(
    channelId: string,
    messageId: string,
    content: string,
  ): Promise<void> {
    await this.bot.telegram.editMessageText(
      parseInt(channelId, 10),
      parseInt(messageId, 10),
      undefined,
      content,
      { parse_mode: 'HTML' },
    )
  }

  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    await this.bot.telegram.deleteMessage(
      parseInt(channelId, 10),
      parseInt(messageId, 10),
    )
  }

  async addReaction(
    _channelId: string,
    _messageId: string,
    emoji: string,
  ): Promise<void> {
    // Telegram reactions require premium or channel context
    // For now, we'll just log this
    console.log('[Telegram] Reactions not fully supported yet:', emoji)
  }

  async getUser(userId: string): Promise<PlatformUserInfo | null> {
    const chat = await this.bot.telegram.getChat(parseInt(userId, 10))
    if (chat.type !== 'private') return null

    return {
      id: String(chat.id),
      username: 'username' in chat ? (chat.username ?? '') : '',
      displayName: 'first_name' in chat ? chat.first_name : 'Unknown',
      avatarUrl: undefined, // Would need to fetch profile photos
    }
  }

  async getChannel(channelId: string): Promise<PlatformChannelInfo | null> {
    const chat = await this.bot.telegram.getChat(parseInt(channelId, 10))

    let type: 'dm' | 'group' | 'guild'
    switch (chat.type) {
      case 'private':
        type = 'dm'
        break
      case 'group':
      case 'supergroup':
        type = 'group'
        break
      case 'channel':
        type = 'guild'
        break
      default:
        type = 'group'
    }

    return {
      id: String(chat.id),
      name: 'title' in chat ? (chat.title ?? 'Unknown') : 'DM',
      type,
    }
  }

  private formatEmbed(embed: MessageEmbed): string {
    const lines: string[] = []

    if (embed.title) {
      lines.push(`<b>${this.escapeHtml(embed.title)}</b>`)
    }

    if (embed.description) {
      lines.push(this.escapeHtml(embed.description))
    }

    if (embed.fields?.length) {
      lines.push('')
      for (const field of embed.fields) {
        lines.push(`<b>${this.escapeHtml(field.name)}</b>`)
        lines.push(this.escapeHtml(field.value))
      }
    }

    if (embed.footer) {
      lines.push('')
      lines.push(`<i>${this.escapeHtml(embed.footer)}</i>`)
    }

    return lines.join('\n')
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }

  private createInlineKeyboard(
    buttons: MessageButton[],
  ): TelegramExtraReplyMessage['reply_markup'] {
    const keyboard = buttons.map((button) => {
      if (button.url) {
        return [Markup.button.url(button.label, button.url)]
      }
      return [
        Markup.button.callback(button.label, button.customId ?? button.label),
      ]
    })

    return Markup.inlineKeyboard(keyboard).reply_markup
  }
}
