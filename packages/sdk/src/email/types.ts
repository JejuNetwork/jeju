/**
 * Email SDK Types
 */

import type { Address, Hex } from 'viem';

export interface EmailClientConfig {
  /** Email API endpoint */
  apiEndpoint: string;
  /** OAuth3 session token */
  sessionToken?: string;
  /** Wallet address */
  address?: Address;
  /** Private key for signing (optional) */
  privateKey?: Hex;
  /** Auto-reconnect WebSocket */
  autoReconnect?: boolean;
}

export interface Email {
  id: Hex;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  timestamp: number;
  flags: EmailFlags;
  attachments?: EmailAttachment[];
  threadId?: Hex;
}

export interface EmailFlags {
  read: boolean;
  starred: boolean;
  important: boolean;
  answered: boolean;
  forwarded: boolean;
  deleted: boolean;
  spam: boolean;
}

export interface EmailAttachment {
  filename: string;
  mimeType: string;
  size: number;
  cid: string;
}

export interface SendEmailParams {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  attachments?: {
    filename: string;
    content: string; // Base64
    mimeType: string;
  }[];
  replyTo?: string;
  inReplyTo?: Hex;
  priority?: 'low' | 'normal' | 'high';
}

export interface Mailbox {
  unreadCount: number;
  folders: string[];
  quota: {
    used: number;
    limit: number;
  };
}

export interface FolderContents {
  folder: string;
  emails: EmailSummary[];
  total: number;
  hasMore: boolean;
}

export interface EmailSummary {
  id: Hex;
  from: string;
  to: string[];
  subject: string;
  preview: string;
  timestamp: number;
  flags: EmailFlags;
  labels: string[];
}

export interface SearchParams {
  query?: string;
  folder?: string;
  from?: string;
  to?: string;
  dateFrom?: Date;
  dateTo?: Date;
  hasAttachment?: boolean;
  limit?: number;
  offset?: number;
}

export interface FilterRule {
  id: string;
  name: string;
  conditions: FilterCondition[];
  actions: FilterAction[];
  enabled: boolean;
}

export interface FilterCondition {
  field: 'from' | 'to' | 'subject' | 'body';
  operator: 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'regex';
  value: string;
}

export interface FilterAction {
  type: 'move' | 'label' | 'star' | 'markRead' | 'delete';
  value?: string;
}

export type EmailEventType = 
  | 'email:new'
  | 'email:updated'
  | 'email:deleted'
  | 'connection:open'
  | 'connection:close'
  | 'connection:error';

export interface EmailEvent {
  type: EmailEventType;
  data: Email | EmailSummary | Error;
}

export type EmailEventHandler = (event: EmailEvent) => void;

export interface IMAPConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    type: 'XOAUTH2';
    user: string;
    accessToken: string;
  };
}

export interface SMTPConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    type: 'XOAUTH2';
    user: string;
    accessToken: string;
  };
}
