/**
 * Platform Adapter Types
 */

import type { Platform, PlatformMessage, MessageEmbed, MessageButton } from '../types';

export interface PlatformAdapter {
  platform: Platform;
  
  /** Initialize the adapter and connect to the platform */
  initialize(): Promise<void>;
  
  /** Gracefully shutdown the adapter */
  shutdown(): Promise<void>;
  
  /** Check if the adapter is connected and ready */
  isReady(): boolean;
  
  /** Send a message to a channel */
  sendMessage(channelId: string, content: string, options?: SendMessageOptions): Promise<string>;
  
  /** Send an embed/rich message */
  sendEmbed(channelId: string, embed: MessageEmbed, buttons?: MessageButton[]): Promise<string>;
  
  /** Reply to a specific message */
  replyToMessage(channelId: string, messageId: string, content: string, options?: SendMessageOptions): Promise<string>;
  
  /** Edit an existing message */
  editMessage(channelId: string, messageId: string, content: string): Promise<void>;
  
  /** Delete a message */
  deleteMessage(channelId: string, messageId: string): Promise<void>;
  
  /** React to a message */
  addReaction(channelId: string, messageId: string, emoji: string): Promise<void>;
  
  /** Get user info */
  getUser(userId: string): Promise<PlatformUserInfo | null>;
  
  /** Get channel info */
  getChannel(channelId: string): Promise<PlatformChannelInfo | null>;
  
  /** Register slash commands (Discord-specific but useful to have in interface) */
  registerCommands?(): Promise<void>;
  
  /** Handle webhook payload (already validated by server.ts) */
  handleWebhook?(payload: unknown): Promise<void>;
  
  /** Set the message handler callback */
  onMessage(handler: MessageHandler): void;
}

export type MessageHandler = (message: PlatformMessage) => Promise<void>;

export interface SendMessageOptions {
  embed?: MessageEmbed;
  buttons?: MessageButton[];
  ephemeral?: boolean;
  replyToMessageId?: string;
}

export interface PlatformUserInfo {
  id: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  isBot?: boolean;
}

export interface PlatformChannelInfo {
  id: string;
  name: string;
  type: 'dm' | 'group' | 'guild';
  guildId?: string;
  guildName?: string;
}

export interface WebhookConfig {
  path: string;
  secret?: string;
  verifySignature?: (payload: string, signature: string) => boolean;
}

