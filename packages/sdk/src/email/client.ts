/**
 * Jeju Email Client
 *
 * High-level client for email operations
 */

import type { Address, Hex } from "viem";
import {
  EmailDetailResponseSchema,
  EmailSearchResponseSchema,
  FilterRulesResponseSchema,
  FolderContentsSchema,
  MailboxResponseSchema,
  SendEmailErrorSchema,
  SendEmailResponseSchema,
  WebSocketEmailEventSchema,
} from "../shared/schemas";
import type {
  Email,
  EmailClientConfig,
  EmailEvent,
  EmailEventHandler,
  EmailSearchParams,
  EmailSummary,
  FilterRule,
  FolderContents,
  IMAPConfig,
  Mailbox,
  SendEmailParams,
  SMTPConfig,
} from "./types";

// Maximum allowed WebSocket message size (1MB)
const MAX_WS_MESSAGE_SIZE = 1024 * 1024;

// Maximum number of event handlers to prevent memory leaks
const MAX_EVENT_HANDLERS = 100;

export class EmailClient {
  private config: EmailClientConfig;
  private ws?: WebSocket;
  private eventHandlers: Set<EmailEventHandler> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(config: EmailClientConfig) {
    this.config = config;
  }

  // ============ Authentication ============

  /**
   * Set OAuth3 session token
   */
  setSessionToken(token: string): void {
    this.config.sessionToken = token;
  }

  /**
   * Set wallet address
   */
  setAddress(address: Address): void {
    this.config.address = address;
  }

  /**
   * Get authentication headers
   */
  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.config.sessionToken) {
      headers["x-oauth3-session"] = this.config.sessionToken;
    }

    if (this.config.address) {
      headers["x-wallet-address"] = this.config.address;
    }

    return headers;
  }

  // ============ Mailbox Operations ============

  /**
   * Get mailbox overview
   */
  async getMailbox(): Promise<Mailbox> {
    const response = await fetch(`${this.config.apiEndpoint}/mailbox`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to get mailbox: ${response.status}`);
    }

    const rawData: unknown = await response.json();
    const data = MailboxResponseSchema.parse(rawData);

    return {
      unreadCount: data.unreadCount,
      folders: data.mailbox.folders,
      quota: {
        used: Number(data.mailbox.quotaUsedBytes),
        limit: Number(data.mailbox.quotaLimitBytes),
      },
    };
  }

  /**
   * Get folder contents
   */
  async getFolder(
    folder: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<FolderContents> {
    const params = new URLSearchParams();
    if (options.limit) params.set("limit", options.limit.toString());
    if (options.offset) params.set("offset", options.offset.toString());

    const response = await fetch(
      `${this.config.apiEndpoint}/mailbox/${folder}?${params}`,
      { headers: this.getAuthHeaders() },
    );

    if (!response.ok) {
      throw new Error(`Failed to get folder: ${response.status}`);
    }

    const rawData: unknown = await response.json();
    const parsed = FolderContentsSchema.parse(rawData);
    return {
      folder,
      emails: parsed.emails.map((e) => ({
        id: e.id as Hex,
        from: e.from,
        to: [],
        subject: e.subject,
        preview: e.preview ?? "",
        timestamp: e.timestamp,
        flags: {
          read: e.read,
          starred: false,
          important: false,
          answered: false,
          forwarded: false,
          deleted: false,
          spam: false,
        },
        labels: [],
      })),
      total: parsed.total,
      hasMore: parsed.hasMore,
    };
  }

  /**
   * Create new folder
   */
  async createFolder(name: string): Promise<void> {
    const response = await fetch(`${this.config.apiEndpoint}/folders`, {
      method: "POST",
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create folder: ${response.status}`);
    }
  }

  /**
   * Delete folder
   */
  async deleteFolder(name: string): Promise<void> {
    const response = await fetch(`${this.config.apiEndpoint}/folders/${name}`, {
      method: "DELETE",
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to delete folder: ${response.status}`);
    }
  }

  // ============ Email Operations ============

  /**
   * Send email
   */
  async send(params: SendEmailParams): Promise<{ messageId: Hex }> {
    const response = await fetch(`${this.config.apiEndpoint}/send`, {
      method: "POST",
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        from: `${this.config.address}@jeju.mail`, // TODO: Use actual email from registry
        ...params,
      }),
    });

    if (!response.ok) {
      const rawError: unknown = await response.json();
      const error = SendEmailErrorSchema.parse(rawError);
      throw new Error(
        error.error || `Failed to send email: ${response.status}`,
      );
    }

    const rawData: unknown = await response.json();
    const data = SendEmailResponseSchema.parse(rawData);
    return { messageId: data.messageId as Hex };
  }

  /**
   * Get email by ID
   */
  async getEmail(messageId: Hex): Promise<Email> {
    const response = await fetch(
      `${this.config.apiEndpoint}/email/${messageId}`,
      {
        headers: this.getAuthHeaders(),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to get email: ${response.status}`);
    }

    const rawData: unknown = await response.json();
    const data = EmailDetailResponseSchema.parse(rawData);

    return {
      id: data.envelope.id as Hex,
      from: data.envelope.from.full,
      to: data.envelope.to.map((t) => t.full),
      subject: data.content.subject,
      bodyText: data.content.bodyText,
      bodyHtml: data.content.bodyHtml,
      timestamp: data.envelope.timestamp,
      flags: {
        read: data.flags.read,
        starred: data.flags.starred,
        important: data.flags.important,
        answered: false,
        forwarded: false,
        deleted: false,
        spam: data.flags.spam,
      },
      attachments: data.content.attachments,
    };
  }

  /**
   * Update email flags
   */
  async updateFlags(
    messageId: Hex,
    flags: Partial<Email["flags"]>,
  ): Promise<void> {
    const response = await fetch(
      `${this.config.apiEndpoint}/email/${messageId}/flags`,
      {
        method: "PATCH",
        headers: this.getAuthHeaders(),
        body: JSON.stringify(flags),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to update flags: ${response.status}`);
    }
  }

  /**
   * Move email to folder
   */
  async moveToFolder(messageId: Hex, targetFolder: string): Promise<void> {
    const response = await fetch(
      `${this.config.apiEndpoint}/email/${messageId}/move`,
      {
        method: "POST",
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ targetFolder }),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to move email: ${response.status}`);
    }
  }

  /**
   * Delete email
   */
  async deleteEmail(messageId: Hex, permanent = false): Promise<void> {
    const response = await fetch(
      `${this.config.apiEndpoint}/email/${messageId}?permanent=${permanent}`,
      {
        method: "DELETE",
        headers: this.getAuthHeaders(),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to delete email: ${response.status}`);
    }
  }

  /**
   * Mark email as read
   */
  async markAsRead(messageId: Hex): Promise<void> {
    await this.updateFlags(messageId, { read: true });
  }

  /**
   * Mark email as unread
   */
  async markAsUnread(messageId: Hex): Promise<void> {
    await this.updateFlags(messageId, { read: false });
  }

  /**
   * Star email
   */
  async star(messageId: Hex): Promise<void> {
    await this.updateFlags(messageId, { starred: true });
  }

  /**
   * Unstar email
   */
  async unstar(messageId: Hex): Promise<void> {
    await this.updateFlags(messageId, { starred: false });
  }

  // ============ Search ============

  /**
   * Search emails
   */
  async search(params: EmailSearchParams): Promise<{
    results: EmailSummary[];
    total: number;
    hasMore: boolean;
  }> {
    const response = await fetch(`${this.config.apiEndpoint}/search`, {
      method: "POST",
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        query: params.query ?? "",
        folder: params.folder,
        from: params.from,
        to: params.to,
        dateFrom: params.dateFrom?.getTime(),
        dateTo: params.dateTo?.getTime(),
        hasAttachment: params.hasAttachment,
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
      }),
    });

    if (!response.ok) {
      throw new Error(`Search failed: ${response.status}`);
    }

    const rawData: unknown = await response.json();
    const data = EmailSearchResponseSchema.parse(rawData);
    return {
      results: data.results as EmailSummary[],
      total: data.total,
      hasMore: data.hasMore,
    };
  }

  // ============ Filter Rules ============

  /**
   * Get filter rules
   */
  async getFilterRules(): Promise<FilterRule[]> {
    const response = await fetch(`${this.config.apiEndpoint}/rules`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to get rules: ${response.status}`);
    }

    const rawData: unknown = await response.json();
    const data = FilterRulesResponseSchema.parse(rawData);
    return data.rules as FilterRule[];
  }

  /**
   * Add filter rule
   */
  async addFilterRule(rule: FilterRule): Promise<void> {
    const response = await fetch(`${this.config.apiEndpoint}/rules`, {
      method: "POST",
      headers: this.getAuthHeaders(),
      body: JSON.stringify(rule),
    });

    if (!response.ok) {
      throw new Error(`Failed to add rule: ${response.status}`);
    }
  }

  /**
   * Delete filter rule
   */
  async deleteFilterRule(ruleId: string): Promise<void> {
    const response = await fetch(`${this.config.apiEndpoint}/rules/${ruleId}`, {
      method: "DELETE",
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to delete rule: ${response.status}`);
    }
  }

  // ============ Data Export (GDPR) ============

  /**
   * Export all email data
   */
  async exportData(): Promise<Blob> {
    const response = await fetch(`${this.config.apiEndpoint}/export`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Export failed: ${response.status}`);
    }

    return response.blob();
  }

  /**
   * Delete all email data (GDPR)
   */
  async deleteAllData(): Promise<void> {
    const response = await fetch(`${this.config.apiEndpoint}/account`, {
      method: "DELETE",
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ confirm: true }),
    });

    if (!response.ok) {
      throw new Error(`Delete failed: ${response.status}`);
    }
  }

  // ============ Real-time Updates ============

  /**
   * Connect to real-time updates via WebSocket
   */
  async connect(): Promise<void> {
    const wsUrl = `${this.config.apiEndpoint
      .replace("http://", "ws://")
      .replace("https://", "wss://")}/ws`;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;

        // Authenticate
        this.ws?.send(
          JSON.stringify({
            type: "auth",
            token: this.config.sessionToken,
            address: this.config.address,
          }),
        );

        this.emit({ type: "connection:open", data: {} as Email });
        resolve();
      };

      this.ws.onmessage = (event) => {
        // Validate message size to prevent DoS
        const messageData = event.data as string;
        if (messageData.length > MAX_WS_MESSAGE_SIZE) {
          console.error("WebSocket message too large, ignoring");
          return;
        }

        // Safely parse JSON with validation
        let parsed: unknown;
        try {
          parsed = JSON.parse(messageData);
        } catch {
          console.error("Invalid JSON in WebSocket message");
          return;
        }

        // Validate with schema - use safeParse since individual messages may be malformed
        const result = WebSocketEmailEventSchema.safeParse(parsed);
        if (!result.success) {
          console.error("Invalid WebSocket message format");
          return;
        }

        this.emit({
          type: result.data.type as EmailEvent["type"],
          data: result.data.data as Email | EmailSummary,
        });
      };

      this.ws.onclose = () => {
        this.emit({ type: "connection:close", data: {} as Email });
        if (this.config.autoReconnect !== false) {
          this.handleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        this.emit({
          type: "connection:error",
          data: new Error("WebSocket error"),
        });
        reject(error);
      };
    });
  }

  /**
   * Disconnect from real-time updates
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
  }

  /**
   * Subscribe to email events
   * @throws Error if maximum handler limit reached (prevents memory leaks)
   */
  onEvent(handler: EmailEventHandler): () => void {
    if (this.eventHandlers.size >= MAX_EVENT_HANDLERS) {
      throw new Error(
        `Maximum event handlers (${MAX_EVENT_HANDLERS}) reached. Unsubscribe unused handlers.`,
      );
    }
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /**
   * Remove all event handlers (useful for cleanup)
   */
  removeAllEventHandlers(): void {
    this.eventHandlers.clear();
  }

  private emit(event: EmailEvent): void {
    for (const handler of this.eventHandlers) {
      handler(event);
    }
  }

  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);

    setTimeout(() => {
      this.connect().catch(() => {
        // Reconnect will be handled by onclose
      });
    }, delay);
  }

  // ============ IMAP/SMTP Configuration ============

  /**
   * Get IMAP configuration for desktop clients
   */
  getIMAPConfig(email: string): IMAPConfig {
    const baseHost = new URL(this.config.apiEndpoint).hostname.replace(
      "mail.",
      "imap.",
    );

    return {
      host: baseHost,
      port: 993,
      secure: true,
      auth: {
        type: "XOAUTH2",
        user: email,
        accessToken: this.config.sessionToken ?? "",
      },
    };
  }

  /**
   * Get SMTP configuration for desktop clients
   */
  getSMTPConfig(email: string): SMTPConfig {
    const baseHost = new URL(this.config.apiEndpoint).hostname.replace(
      "mail.",
      "smtp.",
    );

    return {
      host: baseHost,
      port: 587,
      secure: false, // STARTTLS
      auth: {
        type: "XOAUTH2",
        user: email,
        accessToken: this.config.sessionToken ?? "",
      },
    };
  }
}

// ============ Factory ============

export function createEmailClient(config: EmailClientConfig): EmailClient {
  return new EmailClient(config);
}
