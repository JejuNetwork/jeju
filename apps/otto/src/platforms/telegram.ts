/**
 * Telegram Platform Adapter
 */

import { Telegraf, type Context, Markup, type ExtraReplyMessage } from 'telegraf';
import type { Update, Message } from 'telegraf/types';
import type { PlatformAdapter, MessageHandler, SendMessageOptions, PlatformUserInfo, PlatformChannelInfo } from './types';
import type { PlatformMessage, MessageEmbed, MessageButton, TelegramWebhookPayload } from '../types';

export class TelegramAdapter implements PlatformAdapter {
  readonly platform = 'telegram' as const;
  
  private bot: Telegraf;
  private token: string;
  private webhookSecret: string;
  private messageHandler: MessageHandler | null = null;
  private ready = false;

  constructor(token: string, webhookSecret?: string) {
    this.token = token;
    this.webhookSecret = webhookSecret ?? '';
    this.bot = new Telegraf(token);
    
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Handle /start command
    this.bot.command('start', async (ctx) => {
      const message = this.convertContext(ctx, 'help');
      if (this.messageHandler) {
        await this.messageHandler(message);
      }
    });

    // Handle /otto command
    this.bot.command('otto', async (ctx) => {
      const message = this.convertContext(ctx);
      if (this.messageHandler) {
        await this.messageHandler(message);
      }
    });

    // Handle text messages that start with "otto" or mention the bot
    this.bot.on('text', async (ctx) => {
      const text = ctx.message.text.toLowerCase();
      if (text.startsWith('otto ') || text.startsWith('/otto')) {
        const message = this.convertContext(ctx);
        if (this.messageHandler) {
          await this.messageHandler(message);
        }
      }
    });

    // Handle callback queries (button presses)
    this.bot.on('callback_query', async (ctx) => {
      if (!('data' in ctx.callbackQuery)) return;
      
      const data = ctx.callbackQuery.data;
      const message: PlatformMessage = {
        platform: 'telegram',
        messageId: ctx.callbackQuery.id,
        channelId: String(ctx.callbackQuery.message?.chat.id ?? ctx.callbackQuery.from.id),
        userId: String(ctx.callbackQuery.from.id),
        content: data,
        timestamp: Date.now(),
        isCommand: true,
      };
      
      await ctx.answerCbQuery();
      
      if (this.messageHandler) {
        await this.messageHandler(message);
      }
    });

    this.bot.catch((err: Error) => {
      console.error('[Telegram] Bot error:', err);
    });
  }

  private convertContext(ctx: Context, overrideCommand?: string): PlatformMessage {
    const message = ctx.message as Message.TextMessage | undefined;
    if (!message) {
      throw new Error('No message in context');
    }
    
    // Extract command and arguments
    let content = message.text ?? '';
    content = content.replace(/^\/otto(@\w+)?\s*/i, '').replace(/^otto\s*/i, '').trim();
    
    if (overrideCommand) {
      content = overrideCommand;
    }
    
    return {
      platform: 'telegram',
      messageId: String(message.message_id),
      channelId: String(message.chat.id),
      userId: String(message.from?.id ?? 0),
      content,
      timestamp: message.date * 1000,
      isCommand: true,
      replyToId: message.reply_to_message?.message_id ? String(message.reply_to_message.message_id) : undefined,
    };
  }

  async initialize(): Promise<void> {
    console.log('[Telegram] Initializing...');
    
    // Set bot commands menu
    await this.bot.telegram.setMyCommands([
      { command: 'otto', description: 'Talk to Otto trading assistant' },
      { command: 'start', description: 'Get started with Otto' },
    ]);
    
    // Start polling (for development) or set webhook (for production)
    const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
    if (webhookUrl) {
      console.log('[Telegram] Setting webhook:', webhookUrl);
      await this.bot.telegram.setWebhook(webhookUrl, {
        secret_token: this.webhookSecret || undefined,
      });
    } else {
      console.log('[Telegram] Starting polling...');
      this.bot.launch().catch(err => console.error('[Telegram] Launch error:', err));
    }
    
    this.ready = true;
    console.log('[Telegram] Initialized');
  }

  async shutdown(): Promise<void> {
    console.log('[Telegram] Shutting down...');
    this.ready = false;
    this.bot.stop();
  }

  isReady(): boolean {
    return this.ready;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  async handleWebhook(payload: TelegramWebhookPayload): Promise<void> {
    await this.bot.handleUpdate(payload as unknown as Update);
  }

  async sendMessage(channelId: string, content: string, options?: SendMessageOptions): Promise<string> {
    const chatId = parseInt(channelId);
    
    const extra: ExtraReplyMessage = {
      parse_mode: 'HTML',
    };
    
    if (options?.buttons?.length) {
      extra.reply_markup = this.createInlineKeyboard(options.buttons);
    }
    
    if (options?.replyToMessageId) {
      extra.reply_parameters = { message_id: parseInt(options.replyToMessageId) };
    }
    
    const message = await this.bot.telegram.sendMessage(chatId, content, extra);
    return String(message.message_id);
  }

  async sendEmbed(channelId: string, embed: MessageEmbed, buttons?: MessageButton[]): Promise<string> {
    // Telegram doesn't have native embeds, so we format as HTML
    const content = this.formatEmbed(embed);
    
    const extra: ExtraReplyMessage = {
      parse_mode: 'HTML',
    };
    
    if (buttons?.length) {
      extra.reply_markup = this.createInlineKeyboard(buttons);
    }
    
    const message = await this.bot.telegram.sendMessage(parseInt(channelId), content, extra);
    return String(message.message_id);
  }

  async replyToMessage(channelId: string, messageId: string, content: string, options?: SendMessageOptions): Promise<string> {
    const chatId = parseInt(channelId);
    
    const extra: ExtraReplyMessage = {
      parse_mode: 'HTML',
      reply_parameters: { message_id: parseInt(messageId) },
    };
    
    if (options?.buttons?.length) {
      extra.reply_markup = this.createInlineKeyboard(options.buttons);
    }
    
    const message = await this.bot.telegram.sendMessage(chatId, content, extra);
    return String(message.message_id);
  }

  async editMessage(channelId: string, messageId: string, content: string): Promise<void> {
    await this.bot.telegram.editMessageText(
      parseInt(channelId),
      parseInt(messageId),
      undefined,
      content,
      { parse_mode: 'HTML' }
    );
  }

  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    await this.bot.telegram.deleteMessage(parseInt(channelId), parseInt(messageId));
  }

  async addReaction(_channelId: string, _messageId: string, emoji: string): Promise<void> {
    // Telegram reactions require premium or channel context
    // For now, we'll just log this
    console.log('[Telegram] Reactions not fully supported yet:', emoji);
  }

  async getUser(userId: string): Promise<PlatformUserInfo | null> {
    const chat = await this.bot.telegram.getChat(parseInt(userId)).catch(() => null);
    if (!chat || chat.type !== 'private') return null;
    
    return {
      id: String(chat.id),
      username: 'username' in chat ? chat.username ?? '' : '',
      displayName: 'first_name' in chat ? chat.first_name : 'Unknown',
      avatarUrl: undefined, // Would need to fetch profile photos
    };
  }

  async getChannel(channelId: string): Promise<PlatformChannelInfo | null> {
    const chat = await this.bot.telegram.getChat(parseInt(channelId)).catch(() => null);
    if (!chat) return null;
    
    let type: 'dm' | 'group' | 'guild';
    switch (chat.type) {
      case 'private': type = 'dm'; break;
      case 'group':
      case 'supergroup': type = 'group'; break;
      case 'channel': type = 'guild'; break;
      default: type = 'group';
    }
    
    return {
      id: String(chat.id),
      name: 'title' in chat ? chat.title ?? 'Unknown' : 'DM',
      type,
    };
  }

  private formatEmbed(embed: MessageEmbed): string {
    const lines: string[] = [];
    
    if (embed.title) {
      lines.push(`<b>${this.escapeHtml(embed.title)}</b>`);
    }
    
    if (embed.description) {
      lines.push(this.escapeHtml(embed.description));
    }
    
    if (embed.fields?.length) {
      lines.push('');
      for (const field of embed.fields) {
        lines.push(`<b>${this.escapeHtml(field.name)}</b>`);
        lines.push(this.escapeHtml(field.value));
      }
    }
    
    if (embed.footer) {
      lines.push('');
      lines.push(`<i>${this.escapeHtml(embed.footer)}</i>`);
    }
    
    return lines.join('\n');
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private createInlineKeyboard(buttons: MessageButton[]) {
    const keyboard = buttons.map(button => {
      if (button.url) {
        return [Markup.button.url(button.label, button.url)];
      }
      return [Markup.button.callback(button.label, button.customId ?? button.label)];
    });
    
    return Markup.inlineKeyboard(keyboard).reply_markup;
  }
}

