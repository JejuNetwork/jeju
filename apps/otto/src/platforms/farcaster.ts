/**
 * Farcaster Platform Adapter
 * Integrates with Farcaster via Neynar API for DMs and cast mentions
 */

import type { Address, Hex } from 'viem';
import type { PlatformAdapter, MessageHandler, SendMessageOptions, PlatformUserInfo, PlatformChannelInfo } from './types';
import type { PlatformMessage, MessageEmbed, MessageButton } from '../types';

const NEYNAR_API_URL = process.env.NEYNAR_API_URL ?? 'https://api.neynar.com/v2';
const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY ?? '';
const FARCASTER_BOT_FID = parseInt(process.env.FARCASTER_BOT_FID ?? '0');
const FARCASTER_SIGNER_UUID = process.env.FARCASTER_SIGNER_UUID ?? '';

interface FarcasterUser {
  fid: number;
  username: string;
  display_name: string;
  pfp_url: string;
  custody_address: string;
  verified_addresses?: { eth_addresses?: string[] };
}

interface FarcasterCast {
  hash: string;
  author: FarcasterUser;
  text: string;
  timestamp: string;
  parent_hash?: string;
  parent_url?: string;
  mentioned_profiles?: FarcasterUser[];
  channel?: { id: string; name: string };
}

interface FarcasterDirectCast {
  id: string;
  conversation_id: string;
  sender: FarcasterUser;
  recipient: FarcasterUser;
  text: string;
  timestamp: string;
}

export class FarcasterAdapter implements PlatformAdapter {
  readonly platform = 'farcaster' as const;
  
  private apiKey: string;
  private botFid: number;
  private signerUuid: string;
  private messageHandler: MessageHandler | null = null;
  private ready = false;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private lastMentionTimestamp = 0;
  private lastDmTimestamp = 0;

  constructor(apiKey?: string, botFid?: number, signerUuid?: string) {
    this.apiKey = apiKey ?? NEYNAR_API_KEY;
    this.botFid = botFid ?? FARCASTER_BOT_FID;
    this.signerUuid = signerUuid ?? FARCASTER_SIGNER_UUID;
  }

  async initialize(): Promise<void> {
    console.log('[Farcaster] Initializing...');
    
    if (!this.apiKey) {
      console.log('[Farcaster] No API key configured, skipping');
      return;
    }

    if (!this.botFid) {
      console.log('[Farcaster] No bot FID configured, skipping');
      return;
    }

    // Verify API key works
    const profile = await this.getUser(String(this.botFid));
    if (!profile) {
      console.error('[Farcaster] Failed to verify bot account');
      return;
    }

    console.log(`[Farcaster] Bot account: @${profile.username} (FID: ${this.botFid})`);

    // Start polling for mentions and DMs
    this.startPolling();
    
    this.ready = true;
    console.log('[Farcaster] Initialized');
  }

  async shutdown(): Promise<void> {
    console.log('[Farcaster] Shutting down...');
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.ready = false;
  }

  isReady(): boolean {
    return this.ready;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  private startPolling(): void {
    // Poll for mentions and DMs every 5 seconds
    this.pollInterval = setInterval(async () => {
      await this.pollMentions();
      await this.pollDirectCasts();
    }, 5000);

    // Initial poll
    this.pollMentions();
    this.pollDirectCasts();
  }

  private async pollMentions(): Promise<void> {
    const response = await fetch(
      `${NEYNAR_API_URL}/farcaster/notifications?fid=${this.botFid}&type=mentions`,
      { headers: this.getHeaders() }
    ).catch(() => null);

    if (!response?.ok) return;

    const data = await response.json() as { notifications: Array<{ cast: FarcasterCast; most_recent_timestamp: string }> };
    
    for (const notification of data.notifications) {
      const timestamp = new Date(notification.most_recent_timestamp).getTime();
      if (timestamp <= this.lastMentionTimestamp) continue;
      
      this.lastMentionTimestamp = Math.max(this.lastMentionTimestamp, timestamp);
      
      const cast = notification.cast;
      if (cast.author.fid === this.botFid) continue; // Skip own casts

      // Extract command from cast text
      const text = this.extractCommand(cast.text);
      if (!text) continue;

      const message: PlatformMessage = {
        platform: 'farcaster',
        messageId: cast.hash,
        channelId: cast.channel?.id ?? `thread:${cast.parent_hash ?? cast.hash}`,
        userId: String(cast.author.fid),
        content: text,
        timestamp,
        isCommand: true,
        replyToId: cast.parent_hash,
      };

      if (this.messageHandler) {
        await this.messageHandler(message);
      }
    }
  }

  private async pollDirectCasts(): Promise<void> {
    // Get direct cast conversations
    const response = await fetch(
      `${NEYNAR_API_URL}/farcaster/direct_cast/conversations?fid=${this.botFid}`,
      { headers: this.getHeaders() }
    ).catch(() => null);

    if (!response?.ok) return;

    const data = await response.json() as { conversations: Array<{ id: string; last_message: FarcasterDirectCast }> };

    for (const conv of data.conversations) {
      const dm = conv.last_message;
      if (!dm) continue;
      
      const timestamp = new Date(dm.timestamp).getTime();
      if (timestamp <= this.lastDmTimestamp) continue;
      if (dm.sender.fid === this.botFid) continue; // Skip own messages

      this.lastDmTimestamp = Math.max(this.lastDmTimestamp, timestamp);

      // Extract command from DM
      const text = this.extractCommand(dm.text);

      const message: PlatformMessage = {
        platform: 'farcaster',
        messageId: dm.id,
        channelId: `dm:${conv.id}`,
        userId: String(dm.sender.fid),
        content: text || dm.text, // For DMs, always process
        timestamp,
        isCommand: true,
      };

      if (this.messageHandler) {
        await this.messageHandler(message);
      }
    }
  }

  private extractCommand(text: string): string {
    // Remove @otto mention and extract command
    const withoutMention = text.replace(/@otto\s*/gi, '').trim();
    
    // Check if starts with otto command
    if (withoutMention.toLowerCase().startsWith('otto ')) {
      return withoutMention.slice(5).trim();
    }
    
    // For direct casts, assume everything is a command
    return withoutMention;
  }

  async sendMessage(channelId: string, content: string, options?: SendMessageOptions): Promise<string> {
    // Determine if this is a DM or a cast reply
    if (channelId.startsWith('dm:')) {
      return this.sendDirectCast(channelId.slice(3), content);
    }
    
    return this.postCast(content, options?.replyToMessageId);
  }

  async sendEmbed(channelId: string, embed: MessageEmbed, buttons?: MessageButton[]): Promise<string> {
    // Farcaster doesn't have embeds, format as text
    const content = this.formatEmbed(embed, buttons);
    return this.sendMessage(channelId, content);
  }

  async replyToMessage(channelId: string, messageId: string, content: string, options?: SendMessageOptions): Promise<string> {
    if (channelId.startsWith('dm:')) {
      return this.sendDirectCast(channelId.slice(3), content);
    }
    
    return this.postCast(content, messageId);
  }

  async editMessage(_channelId: string, _messageId: string, _content: string): Promise<void> {
    // Farcaster doesn't support editing casts
    console.log('[Farcaster] Edit not supported');
  }

  async deleteMessage(_channelId: string, messageId: string): Promise<void> {
    // Delete cast
    await fetch(`${NEYNAR_API_URL}/farcaster/cast`, {
      method: 'DELETE',
      headers: this.getHeaders(),
      body: JSON.stringify({
        signer_uuid: this.signerUuid,
        target_hash: messageId,
      }),
    });
  }

  async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    // Like the cast
    if (emoji === '👍' || emoji === '❤️' || emoji === 'like') {
      await fetch(`${NEYNAR_API_URL}/farcaster/reaction`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          signer_uuid: this.signerUuid,
          reaction_type: 'like',
          target: messageId,
        }),
      });
    }
  }

  async getUser(userId: string): Promise<PlatformUserInfo | null> {
    const fid = parseInt(userId);
    if (isNaN(fid)) return null;

    const response = await fetch(
      `${NEYNAR_API_URL}/farcaster/user/bulk?fids=${fid}`,
      { headers: this.getHeaders() }
    ).catch(() => null);

    if (!response?.ok) return null;

    const data = await response.json() as { users: FarcasterUser[] };
    const user = data.users[0];
    if (!user) return null;

    return {
      id: String(user.fid),
      username: user.username,
      displayName: user.display_name,
      avatarUrl: user.pfp_url,
    };
  }

  async getChannel(channelId: string): Promise<PlatformChannelInfo | null> {
    if (channelId.startsWith('dm:')) {
      return {
        id: channelId,
        name: 'Direct Message',
        type: 'dm',
      };
    }

    if (channelId.startsWith('thread:')) {
      return {
        id: channelId,
        name: 'Thread',
        type: 'group',
      };
    }

    // Farcaster channel
    const response = await fetch(
      `${NEYNAR_API_URL}/farcaster/channel?id=${channelId}`,
      { headers: this.getHeaders() }
    ).catch(() => null);

    if (!response?.ok) {
      return {
        id: channelId,
        name: channelId,
        type: 'group',
      };
    }

    const data = await response.json() as { channel: { id: string; name: string } };
    
    return {
      id: data.channel.id,
      name: data.channel.name,
      type: 'group',
    };
  }

  private async postCast(text: string, replyTo?: string): Promise<string> {
    const body: Record<string, string | undefined> = {
      signer_uuid: this.signerUuid,
      text,
    };

    if (replyTo) {
      body.parent = replyTo;
    }

    const response = await fetch(`${NEYNAR_API_URL}/farcaster/cast`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Failed to post cast: ${response.status}`);
    }

    const data = await response.json() as { cast: { hash: string } };
    return data.cast.hash;
  }

  private async sendDirectCast(conversationId: string, text: string): Promise<string> {
    const response = await fetch(`${NEYNAR_API_URL}/farcaster/direct_cast`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        signer_uuid: this.signerUuid,
        conversation_id: conversationId,
        text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to send direct cast: ${response.status}`);
    }

    const data = await response.json() as { message: { id: string } };
    return data.message.id;
  }

  private formatEmbed(embed: MessageEmbed, buttons?: MessageButton[]): string {
    const lines: string[] = [];
    
    if (embed.title) {
      lines.push(`**${embed.title}**`);
    }
    
    if (embed.description) {
      lines.push(embed.description);
    }
    
    if (embed.fields?.length) {
      lines.push('');
      for (const field of embed.fields) {
        lines.push(`${field.name}: ${field.value}`);
      }
    }

    // Add button URLs as links
    if (buttons?.length) {
      lines.push('');
      for (const button of buttons) {
        if (button.url) {
          lines.push(`${button.label}: ${button.url}`);
        }
      }
    }
    
    if (embed.footer) {
      lines.push('');
      lines.push(embed.footer);
    }
    
    return lines.join('\n');
  }

  private getHeaders(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'api_key': this.apiKey,
    };
  }

  // Frame validation for Farcaster Frames
  async validateFrame(messageBytes: Uint8Array): Promise<{
    valid: boolean;
    fid: number;
    buttonIndex: number;
    inputText?: string;
    castHash?: string;
  } | null> {
    const response = await fetch(`${NEYNAR_API_URL}/farcaster/frame/validate`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        message_bytes_in_hex: Buffer.from(messageBytes).toString('hex'),
      }),
    });

    if (!response.ok) return null;

    const data = await response.json() as {
      valid: boolean;
      action: {
        interactor: { fid: number };
        button_index: number;
        input?: { text: string };
        cast?: { hash: string };
      };
    };

    return {
      valid: data.valid,
      fid: data.action.interactor.fid,
      buttonIndex: data.action.button_index,
      inputText: data.action.input?.text,
      castHash: data.action.cast?.hash,
    };
  }
}


