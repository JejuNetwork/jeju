/**
 * Twitter/X Platform Adapter
 * Uses Twitter API v2 for posting and monitoring mentions
 */

import type { PlatformAdapter, MessageHandler, SendMessageOptions, PlatformUserInfo, PlatformChannelInfo } from './types';
import type { PlatformMessage, MessageEmbed, MessageButton, TwitterWebhookPayload } from '../types';

interface TwitterCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
  bearerToken: string;
}

interface Tweet {
  id: string;
  text: string;
  author_id: string;
  conversation_id?: string;
  in_reply_to_user_id?: string;
  created_at: string;
}

interface TwitterUser {
  id: string;
  username: string;
  name: string;
  profile_image_url?: string;
}

export class TwitterAdapter implements PlatformAdapter {
  readonly platform = 'twitter' as const;
  
  private credentials: TwitterCredentials;
  private botUsername: string;
  private messageHandler: MessageHandler | null = null;
  private ready = false;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private lastMentionId: string | null = null;

  constructor(credentials: TwitterCredentials, botUsername: string) {
    this.credentials = credentials;
    this.botUsername = botUsername.replace('@', '');
  }

  async initialize(): Promise<void> {
    console.log('[Twitter] Initializing...');
    
    // Verify credentials
    const me = await this.verifyCredentials();
    if (!me) {
      throw new Error('Failed to verify Twitter credentials');
    }
    
    console.log(`[Twitter] Authenticated as @${me.username}`);
    
    // Start polling for mentions (Twitter API v2 doesn't have streaming for free tier)
    this.startPolling();
    
    this.ready = true;
    console.log('[Twitter] Initialized');
  }

  async shutdown(): Promise<void> {
    console.log('[Twitter] Shutting down...');
    this.ready = false;
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  async handleWebhook(payload: TwitterWebhookPayload): Promise<void> {
    // Handle Account Activity API webhook (requires elevated access)
    if (payload.tweet_create_events) {
      for (const tweet of payload.tweet_create_events) {
        if (this.isMention(tweet)) {
          await this.processTweet(tweet);
        }
      }
    }
    
    if (payload.direct_message_events) {
      for (const dm of payload.direct_message_events) {
        if (dm.type === 'message_create' && dm.message_create.sender_id !== payload.for_user_id) {
          await this.processDirectMessage(dm);
        }
      }
    }
  }

  async sendMessage(channelId: string, content: string, options?: SendMessageOptions): Promise<string> {
    // channelId is either a tweet ID (for replies) or 'dm:user_id' for DMs
    if (channelId.startsWith('dm:')) {
      const recipientId = channelId.replace('dm:', '');
      return this.sendDirectMessage(recipientId, content);
    }
    
    return this.postTweet(content, channelId);
  }

  async sendEmbed(channelId: string, embed: MessageEmbed, buttons?: MessageButton[]): Promise<string> {
    // Twitter doesn't support embeds - format as text
    const content = this.formatEmbed(embed, buttons);
    return this.sendMessage(channelId, content);
  }

  async replyToMessage(channelId: string, messageId: string, content: string, options?: SendMessageOptions): Promise<string> {
    return this.postTweet(content, messageId);
  }

  async editMessage(channelId: string, messageId: string, content: string): Promise<void> {
    // Twitter doesn't support editing tweets via API (as of 2024)
    console.log('[Twitter] Tweet editing not supported');
  }

  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    await this.deleteTweet(messageId);
  }

  async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    // Like the tweet
    await this.likeTweet(messageId);
  }

  async getUser(userId: string): Promise<PlatformUserInfo | null> {
    const user = await this.fetchUser(userId);
    if (!user) return null;
    
    return {
      id: user.id,
      username: user.username,
      displayName: user.name,
      avatarUrl: user.profile_image_url,
    };
  }

  async getChannel(channelId: string): Promise<PlatformChannelInfo | null> {
    // For Twitter, "channel" is either a conversation thread or DM
    if (channelId.startsWith('dm:')) {
      return {
        id: channelId,
        name: 'Direct Message',
        type: 'dm',
      };
    }
    
    return {
      id: channelId,
      name: 'Thread',
      type: 'group',
    };
  }

  // Private methods

  private async verifyCredentials(): Promise<TwitterUser | null> {
    const response = await this.apiRequest('GET', '/users/me');
    return response?.data ?? null;
  }

  private startPolling(): void {
    // Poll every 15 seconds (rate limit friendly)
    this.pollingInterval = setInterval(() => {
      this.pollMentions().catch(err => console.error('[Twitter] Poll error:', err));
    }, 15000);
    
    // Initial poll
    this.pollMentions().catch(err => console.error('[Twitter] Initial poll error:', err));
  }

  private async pollMentions(): Promise<void> {
    const params = new URLSearchParams({
      'tweet.fields': 'author_id,conversation_id,created_at,in_reply_to_user_id',
      'expansions': 'author_id',
      'user.fields': 'username',
    });
    
    if (this.lastMentionId) {
      params.set('since_id', this.lastMentionId);
    }
    
    const response = await this.apiRequest('GET', `/users/me/mentions?${params}`);
    
    if (response?.data) {
      // Process newest first, but update lastMentionId with the newest
      const tweets = response.data as Tweet[];
      if (tweets.length > 0) {
        this.lastMentionId = tweets[0].id;
      }
      
      // Process in reverse order (oldest first)
      for (const tweet of tweets.reverse()) {
        await this.processTweet(tweet);
      }
    }
  }

  private async processTweet(tweet: Tweet): Promise<void> {
    // Extract command from tweet text
    const content = this.extractCommand(tweet.text);
    if (!content) return;
    
    const message: PlatformMessage = {
      platform: 'twitter',
      messageId: tweet.id,
      channelId: tweet.conversation_id ?? tweet.id,
      userId: tweet.author_id,
      content,
      timestamp: new Date(tweet.created_at).getTime(),
      isCommand: true,
      replyToId: tweet.in_reply_to_user_id ? tweet.id : undefined,
    };
    
    if (this.messageHandler) {
      await this.messageHandler(message);
    }
  }

  private async processDirectMessage(dm: { message_create: { sender_id: string; message_data: { text: string } } }): Promise<void> {
    const message: PlatformMessage = {
      platform: 'twitter',
      messageId: dm.message_create.sender_id + '-' + Date.now(),
      channelId: 'dm:' + dm.message_create.sender_id,
      userId: dm.message_create.sender_id,
      content: dm.message_create.message_data.text,
      timestamp: Date.now(),
      isCommand: true,
    };
    
    if (this.messageHandler) {
      await this.messageHandler(message);
    }
  }

  private isMention(tweet: { text: string }): boolean {
    const lowerText = tweet.text.toLowerCase();
    return lowerText.includes(`@${this.botUsername.toLowerCase()}`);
  }

  private extractCommand(text: string): string {
    // Remove @mentions and extract command
    let content = text.replace(/@\w+/g, '').trim();
    
    // Remove common prefixes
    content = content.replace(/^otto\s*/i, '').trim();
    
    return content;
  }

  private async postTweet(text: string, replyToId?: string): Promise<string> {
    // Truncate to Twitter limit (280 chars)
    const truncated = text.length > 280 ? text.slice(0, 277) + '...' : text;
    
    const body: { text: string; reply?: { in_reply_to_tweet_id: string } } = { text: truncated };
    
    if (replyToId) {
      body.reply = { in_reply_to_tweet_id: replyToId };
    }
    
    const response = await this.apiRequest('POST', '/tweets', body);
    return response?.data?.id ?? '';
  }

  private async deleteTweet(tweetId: string): Promise<void> {
    await this.apiRequest('DELETE', `/tweets/${tweetId}`);
  }

  private async likeTweet(tweetId: string): Promise<void> {
    const me = await this.verifyCredentials();
    if (!me) return;
    
    await this.apiRequest('POST', `/users/${me.id}/likes`, { tweet_id: tweetId });
  }

  private async sendDirectMessage(recipientId: string, text: string): Promise<string> {
    const body = {
      dm_conversation_id: recipientId,
      message: { text },
    };
    
    const response = await this.apiRequest('POST', '/dm_conversations/with/:participant_id/messages', body);
    return response?.data?.dm_event_id ?? '';
  }

  private async fetchUser(userId: string): Promise<TwitterUser | null> {
    const response = await this.apiRequest('GET', `/users/${userId}?user.fields=profile_image_url`);
    return response?.data ?? null;
  }

  private formatEmbed(embed: MessageEmbed, buttons?: MessageButton[]): string {
    const lines: string[] = [];
    
    if (embed.title) {
      lines.push(`📊 ${embed.title}`);
    }
    
    if (embed.description) {
      lines.push(embed.description);
    }
    
    if (embed.fields?.length) {
      for (const field of embed.fields) {
        lines.push(`\n${field.name}: ${field.value}`);
      }
    }
    
    if (buttons?.length) {
      lines.push('');
      for (const btn of buttons) {
        if (btn.url) {
          lines.push(`🔗 ${btn.label}: ${btn.url}`);
        }
      }
    }
    
    return lines.join('\n');
  }

  private async apiRequest(method: string, endpoint: string, body?: Record<string, unknown>): Promise<{ data?: unknown } | null> {
    const url = `https://api.twitter.com/2${endpoint}`;
    
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.credentials.bearerToken}`,
      'Content-Type': 'application/json',
    };
    
    const options: RequestInit = {
      method,
      headers,
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    const response = await fetch(url, options);
    
    if (!response.ok) {
      const error = await response.text();
      console.error(`[Twitter] API error ${response.status}:`, error);
      return null;
    }
    
    if (response.status === 204) {
      return {};
    }
    
    return response.json();
  }
}

