/**
 * IMAP Server Integration
 * 
 * Provides IMAP4rev1 compliance via Dovecot passthrough:
 * - OAuth3 authentication via Dovecot OAuth2 plugin
 * - Encrypted storage backend via DWS
 * - Full compatibility with Thunderbird, Apple Mail, etc.
 * 
 * Architecture:
 * - Dovecot handles IMAP protocol parsing
 * - This service handles authentication and storage backend
 * - All data stored encrypted in IPFS/Arweave
 */

import type { Address } from 'viem';
import type { IMAPSession } from './types';
import { getMailboxStorage } from './storage';

// ============ Configuration ============

interface IMAPServerConfig {
  host: string;
  port: number;
  tlsCert: string;
  tlsKey: string;
  oauth3Endpoint: string;
  dwsEndpoint: string;
}

// ============ IMAP Server ============

export class IMAPServer {
  private config: IMAPServerConfig;
  private sessions: Map<string, IMAPSession> = new Map();

  constructor(config: IMAPServerConfig) {
    this.config = config;
  }

  /**
   * Start IMAP server
   * In production, this starts Dovecot with our backend
   */
  async start(): Promise<void> {
    console.log(`[IMAP] Starting IMAP server on ${this.config.host}:${this.config.port}`);
    // TODO: Spawn Dovecot process with configuration
    // dovecot -c /etc/dovecot/dovecot.conf
  }

  /**
   * Stop IMAP server
   */
  async stop(): Promise<void> {
    console.log('[IMAP] Stopping IMAP server');
    // TODO: Stop Dovecot process
  }

  /**
   * Authenticate IMAP session via OAuth3
   */
  async authenticateOAuth3(
    sessionId: string,
    token: string
  ): Promise<{ success: boolean; user?: Address; email?: string }> {
    // Validate OAuth3 token
    const response = await fetch(`${this.config.oauth3Endpoint}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      return { success: false };
    }

    const data = await response.json() as {
      valid: boolean;
      address?: Address;
      email?: string;
    };

    if (!data.valid || !data.address) {
      return { success: false };
    }

    // Create session
    this.sessions.set(sessionId, {
      id: sessionId,
      user: data.address,
      email: data.email ?? '',
      authenticated: true,
      capabilities: [
        'IMAP4rev1',
        'IDLE',
        'NAMESPACE',
        'QUOTA',
        'UIDPLUS',
        'MOVE',
        'CONDSTORE',
        'QRESYNC',
        'ENABLE',
        'LIST-EXTENDED',
        'LIST-STATUS',
        'LITERAL+',
        'SASL-IR',
        'SPECIAL-USE',
        'AUTH=OAUTHBEARER',
        'AUTH=XOAUTH2',
      ],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    });

    return { success: true, user: data.address, email: data.email };
  }

  /**
   * Handle IMAP LIST command (list mailboxes)
   */
  async listMailboxes(sessionId: string): Promise<string[]> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.authenticated) {
      throw new Error('Not authenticated');
    }

    const storage = getMailboxStorage();
    const mailbox = await storage.getMailbox(session.user);

    if (!mailbox) {
      return ['INBOX'];
    }

    return [
      'INBOX',
      'Sent',
      'Drafts',
      'Trash',
      'Spam',
      'Archive',
      ...mailbox.folders.filter(f => !['inbox', 'sent', 'drafts', 'trash', 'spam', 'archive'].includes(f.toLowerCase())),
    ];
  }

  /**
   * Handle IMAP SELECT command (select mailbox)
   */
  async selectMailbox(sessionId: string, mailbox: string): Promise<{
    exists: number;
    recent: number;
    unseen: number;
    uidValidity: number;
    uidNext: number;
  }> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.authenticated) {
      throw new Error('Not authenticated');
    }

    session.selectedMailbox = mailbox;
    session.lastActivityAt = Date.now();

    const storage = getMailboxStorage();
    const index = await storage.getIndex(session.user);

    if (!index) {
      return { exists: 0, recent: 0, unseen: 0, uidValidity: 1, uidNext: 1 };
    }

    // Map IMAP folder names to our folder names
    const folderMap: Record<string, string> = {
      'INBOX': 'inbox',
      'Sent': 'sent',
      'Drafts': 'drafts',
      'Trash': 'trash',
      'Spam': 'spam',
      'Archive': 'archive',
    };

    const folderKey = folderMap[mailbox] ?? mailbox.toLowerCase();
    let emails: typeof index.inbox;

    if (folderKey in index) {
      emails = index[folderKey as keyof typeof index] as typeof index.inbox;
    } else if (index.folders[folderKey]) {
      emails = index.folders[folderKey];
    } else {
      emails = [];
    }

    const unseen = emails.filter(e => !e.flags.read).length;

    return {
      exists: emails.length,
      recent: 0, // We don't track this separately
      unseen,
      uidValidity: 1, // Would be stored with mailbox
      uidNext: emails.length + 1,
    };
  }

  /**
   * Handle IMAP FETCH command
   */
  async fetchMessages(
    sessionId: string,
    sequence: string,
    items: string[]
  ): Promise<Array<{ uid: number; data: Record<string, unknown> }>> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.authenticated || !session.selectedMailbox) {
      throw new Error('No mailbox selected');
    }

    const storage = getMailboxStorage();
    const index = await storage.getIndex(session.user);

    if (!index) {
      return [];
    }

    // Parse sequence (e.g., "1:*", "1,3,5", "1:10")
    // Simplified - just return all for now
    const folderMap: Record<string, string> = {
      'INBOX': 'inbox',
      'Sent': 'sent',
      'Drafts': 'drafts',
      'Trash': 'trash',
      'Spam': 'spam',
      'Archive': 'archive',
    };

    const folderKey = folderMap[session.selectedMailbox] ?? session.selectedMailbox.toLowerCase();
    let emails: typeof index.inbox;

    if (folderKey in index) {
      emails = index[folderKey as keyof typeof index] as typeof index.inbox;
    } else if (index.folders[folderKey]) {
      emails = index.folders[folderKey];
    } else {
      emails = [];
    }

    // Build response based on requested items
    return emails.map((email, i) => ({
      uid: i + 1,
      data: {
        FLAGS: [
          email.flags.read ? '\\Seen' : '',
          email.flags.starred ? '\\Flagged' : '',
          email.flags.deleted ? '\\Deleted' : '',
          email.flags.answered ? '\\Answered' : '',
        ].filter(Boolean),
        INTERNALDATE: new Date(email.timestamp).toISOString(),
        RFC822_SIZE: email.size,
        ENVELOPE: {
          date: new Date(email.timestamp).toISOString(),
          subject: email.subject,
          from: [{ name: '', email: email.from }],
          to: email.to.map(t => ({ name: '', email: t })),
        },
      },
    }));
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): IMAPSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Close session
   */
  closeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}

// ============ Factory ============

export function createIMAPServer(config: IMAPServerConfig): IMAPServer {
  return new IMAPServer(config);
}

// ============ Dovecot Configuration Generator ============

export function generateDovecotConfig(config: {
  imapPort: number;
  oauth3Endpoint: string;
  storageBackend: string;
}): string {
  return `
# Dovecot configuration for Jeju Mail
# Generated by jeju-email service

protocols = imap

# SSL/TLS
ssl = required
ssl_cert = </etc/ssl/certs/jeju-mail.pem
ssl_key = </etc/ssl/private/jeju-mail.key
ssl_min_protocol = TLSv1.2

# Authentication
auth_mechanisms = oauthbearer xoauth2

passdb {
  driver = oauth2
  args = /etc/dovecot/dovecot-oauth2.conf.ext
}

userdb {
  driver = static
  args = uid=vmail gid=vmail home=/var/mail/%u
}

# IMAP settings
protocol imap {
  imap_capability = +XOAUTH2
  mail_plugins = quota
}

# Mail location (will be proxied to DWS)
mail_location = proxy:${config.storageBackend}

# Logging
log_path = /var/log/dovecot.log
info_log_path = /var/log/dovecot-info.log
`;
}

export function generateDovecotOAuth2Config(config: {
  oauth3Endpoint: string;
  clientId: string;
}): string {
  return `
# OAuth2 configuration for Dovecot
# Validates tokens against Jeju OAuth3

tokeninfo_url = ${config.oauth3Endpoint}/oauth2/tokeninfo
introspection_url = ${config.oauth3Endpoint}/oauth2/introspect
introspection_mode = post

client_id = ${config.clientId}

username_attribute = email
active_attribute = active
active_value = true
`;
}
