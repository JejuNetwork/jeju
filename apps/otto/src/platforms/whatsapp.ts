/**
 * WhatsApp Platform Adapter (via Twilio)
 */

import type { PlatformAdapter, MessageHandler, SendMessageOptions, PlatformUserInfo, PlatformChannelInfo } from './types';
import type { PlatformMessage, MessageEmbed, MessageButton, TwilioWebhookPayload } from '../types';
import { expectValid, TwilioWebhookPayloadSchema, PlatformMessageSchema } from '../schemas';

interface TwilioClient {
  messages: {
    create: (params: {
      from: string;
      to: string;
      body: string;
    }) => Promise<{ sid: string }>;
  };
}

export class WhatsAppAdapter implements PlatformAdapter {
  readonly platform = 'whatsapp' as const;
  
  private twilioClient: TwilioClient | null = null;
  private accountSid: string;
  private authToken: string;
  private phoneNumber: string;
  private messageHandler: MessageHandler | null = null;
  private ready = false;

  constructor(accountSid: string, authToken: string, phoneNumber: string) {
    this.accountSid = accountSid;
    this.authToken = authToken;
    this.phoneNumber = phoneNumber.startsWith('whatsapp:') ? phoneNumber : `whatsapp:${phoneNumber}`;
  }

  async initialize(): Promise<void> {
    console.log('[WhatsApp] Initializing Twilio client...');
    
    // Dynamic import to avoid requiring twilio when not used
    const twilio = await import('twilio');
    this.twilioClient = twilio.default(this.accountSid, this.authToken) as unknown as TwilioClient;
    
    this.ready = true;
    console.log('[WhatsApp] Initialized');
  }

  async shutdown(): Promise<void> {
    console.log('[WhatsApp] Shutting down...');
    this.ready = false;
    this.twilioClient = null;
  }

  isReady(): boolean {
    return this.ready && this.twilioClient !== null;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  async handleWebhook(payload: TwilioWebhookPayload): Promise<void> {
    const validatedPayload = expectValid(TwilioWebhookPayloadSchema, payload, 'WhatsApp webhook');
    
    if (!validatedPayload.Body) {
      return;
    }
    
    // Extract content - remove "otto" prefix if present
    let content = validatedPayload.Body.trim();
    const isCommand = content.toLowerCase().startsWith('otto ') || content.toLowerCase() === 'otto';
    
    if (isCommand) {
      content = content.replace(/^otto\s*/i, '').trim() || 'help';
    } else {
      // Only respond to messages that start with "otto" or are in a conversation context
      return;
    }
    
    const from = validatedPayload.From.replace('whatsapp:', '');
    if (!from) {
      throw new Error('Invalid WhatsApp From field');
    }
    
    const message: PlatformMessage = {
      platform: 'whatsapp',
      messageId: validatedPayload.MessageSid,
      channelId: from, // For WhatsApp, channel is the phone number
      userId: from,
      content,
      timestamp: Date.now(),
      isCommand: true,
      attachments: validatedPayload.NumMedia && validatedPayload.MediaUrl0 ? [{
        type: 'image',
        url: validatedPayload.MediaUrl0,
      }] : undefined,
    };
    
    const validatedMessage = expectValid(PlatformMessageSchema, message, 'WhatsApp platform message');
    
    if (this.messageHandler) {
      await this.messageHandler(validatedMessage);
    }
  }

  async sendMessage(channelId: string, content: string, _options?: SendMessageOptions): Promise<string> {
    if (!this.twilioClient) {
      throw new Error('Twilio client not initialized');
    }
    
    const to = channelId.startsWith('whatsapp:') ? channelId : `whatsapp:${channelId}`;
    
    const result = await this.twilioClient.messages.create({
      from: this.phoneNumber,
      to,
      body: content,
    });
    
    return result.sid;
  }

  async sendEmbed(channelId: string, embed: MessageEmbed, _buttons?: MessageButton[]): Promise<string> {
    // WhatsApp doesn't support embeds, so we format as plain text
    const content = this.formatEmbed(embed);
    return this.sendMessage(channelId, content);
  }

  async replyToMessage(channelId: string, _messageId: string, content: string, options?: SendMessageOptions): Promise<string> {
    // WhatsApp via Twilio doesn't support native replies in the same way
    // We'll just send a regular message
    return this.sendMessage(channelId, content, options);
  }

  async editMessage(_channelId: string, _messageId: string, _content: string): Promise<void> {
    // WhatsApp doesn't support editing messages
    console.log('[WhatsApp] Edit not supported');
  }

  async deleteMessage(_channelId: string, _messageId: string): Promise<void> {
    // WhatsApp doesn't support deleting messages via API
    console.log('[WhatsApp] Delete not supported');
  }

  async addReaction(_channelId: string, _messageId: string, _emoji: string): Promise<void> {
    // WhatsApp reactions not supported via Twilio
    console.log('[WhatsApp] Reactions not supported');
  }

  async getUser(userId: string): Promise<PlatformUserInfo | null> {
    // Twilio doesn't provide user profile info
    return {
      id: userId,
      username: userId,
      displayName: userId,
    };
  }

  async getChannel(channelId: string): Promise<PlatformChannelInfo | null> {
    // WhatsApp channels are just phone numbers
    return {
      id: channelId,
      name: channelId,
      type: 'dm', // WhatsApp is always DM in this context
    };
  }

  private formatEmbed(embed: MessageEmbed): string {
    const lines: string[] = [];
    
    if (embed.title) {
      lines.push(`*${embed.title}*`);
    }
    
    if (embed.description) {
      lines.push(embed.description);
    }
    
    if (embed.fields?.length) {
      lines.push('');
      for (const field of embed.fields) {
        lines.push(`*${field.name}*: ${field.value}`);
      }
    }
    
    if (embed.footer) {
      lines.push('');
      lines.push(`_${embed.footer}_`);
    }
    
    return lines.join('\n');
  }
}

