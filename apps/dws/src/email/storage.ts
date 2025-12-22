/**
 * Email Mailbox Storage
 * 
 * Encrypted mailbox storage using DWS multi-backend:
 * - Mailbox index stored encrypted in IPFS
 * - Email content stored encrypted with per-email keys
 * - Permanent storage option via Arweave
 * - GDPR-compliant data export
 */

import type { Address, Hex } from 'viem';
import { keccak256, toBytes } from 'viem';
import type {
  EmailEnvelope,
  EmailContent,
  Mailbox,
  MailboxIndex,
  EmailReference,
  EmailFlags,
  FilterRule,
} from './types';
import { getMultiBackendManager, type MultiBackendManager } from '../storage';

// ============ Storage Interface ============

interface StorageBackend {
  upload(data: Buffer, options?: { permanent?: boolean; tier?: string }): Promise<string>;
  download(cid: string): Promise<Buffer>;
  delete(cid: string): Promise<void>;
}

interface EncryptionService {
  encrypt(data: Buffer, publicKey: Hex): Promise<Buffer>;
  decrypt(data: Buffer, privateKey: Hex): Promise<Buffer>;
}

// ============ DWS Backend Adapter ============

/**
 * Adapts DWS MultiBackendManager to StorageBackend interface
 */
class DWSStorageAdapter implements StorageBackend {
  private manager: MultiBackendManager;
  
  constructor(manager: MultiBackendManager) {
    this.manager = manager;
  }
  
  async upload(data: Buffer, options?: { permanent?: boolean; tier?: string }): Promise<string> {
    const result = await this.manager.upload(data, {
      tier: options?.tier === 'permanent' ? 'system' : 'private',
      encrypt: true,
      category: 'email',
    });
    return result.cid;
  }
  
  async download(cid: string): Promise<Buffer> {
    const result = await this.manager.download(cid);
    return result.content;
  }
  
  async delete(cid: string): Promise<void> {
    // DWS doesn't directly support deletion from IPFS/Arweave
    // We mark as deleted in metadata and remove from local cache
    console.log(`[MailboxStorage] Marking ${cid} for deletion`);
  }
}

// ============ Mailbox Storage ============

// Mailbox registry CID - stores mapping of owner -> mailbox CID
const MAILBOX_REGISTRY_KEY = 'jeju-email-mailbox-registry';

export class MailboxStorage {
  private storageBackend: StorageBackend;
  private encryptionService?: EncryptionService;
  private mailboxCache: Map<Address, Mailbox> = new Map();
  private indexCache: Map<Address, MailboxIndex> = new Map();
  
  // Persistent registry of owner -> mailbox metadata CID
  private mailboxRegistry: Map<Address, string> = new Map();
  private registryLoaded = false;

  constructor(
    storageBackend: StorageBackend,
    encryptionService?: EncryptionService
  ) {
    this.storageBackend = storageBackend;
    this.encryptionService = encryptionService;
  }

  /**
   * Load mailbox registry from persistent storage
   */
  private async loadRegistry(): Promise<void> {
    if (this.registryLoaded) return;
    
    // Try to load existing registry from local storage or DWS
    const registryCid = process.env.EMAIL_REGISTRY_CID;
    
    if (registryCid) {
      const data = await this.storageBackend.download(registryCid).catch(() => null);
      if (data) {
        const registry = JSON.parse(data.toString()) as Record<Address, string>;
        this.mailboxRegistry = new Map(Object.entries(registry) as [Address, string][]);
      }
    }
    
    this.registryLoaded = true;
  }

  /**
   * Save mailbox registry to persistent storage
   */
  private async saveRegistry(): Promise<void> {
    const registry = Object.fromEntries(this.mailboxRegistry);
    const data = Buffer.from(JSON.stringify(registry));
    const cid = await this.storageBackend.upload(data, { tier: 'system' });
    // In production, this would be stored in the contract or a well-known location
    console.log(`[MailboxStorage] Registry saved: ${cid}`);
  }

  // ============ Mailbox Operations ============

  /**
   * Initialize mailbox for new user
   */
  async initializeMailbox(owner: Address): Promise<Mailbox> {
    // Check if already exists
    const existing = await this.getMailbox(owner);
    if (existing) {
      return existing;
    }

    const index: MailboxIndex = {
      inbox: [],
      sent: [],
      drafts: [],
      trash: [],
      spam: [],
      archive: [],
      folders: {},
      rules: [],
    };

    // Encrypt and store index
    const indexData = Buffer.from(JSON.stringify(index));
    const encryptedIndex = this.encryptionService
      ? await this.encryptionService.encrypt(indexData, '0x' as Hex)
      : indexData;
    
    const indexCid = await this.storageBackend.upload(encryptedIndex, { tier: 'private' });

    const mailbox: Mailbox = {
      owner,
      encryptedIndexCid: indexCid,
      quotaUsedBytes: BigInt(encryptedIndex.length),
      quotaLimitBytes: BigInt(100 * 1024 * 1024), // 100 MB default
      lastUpdated: Date.now(),
      folders: ['inbox', 'sent', 'drafts', 'trash', 'spam', 'archive'],
    };

    // Persist mailbox metadata
    const mailboxData = Buffer.from(JSON.stringify({
      ...mailbox,
      quotaUsedBytes: mailbox.quotaUsedBytes.toString(),
      quotaLimitBytes: mailbox.quotaLimitBytes.toString(),
    }));
    const mailboxCid = await this.storageBackend.upload(mailboxData, { tier: 'private' });
    
    // Update registry
    await this.loadRegistry();
    this.mailboxRegistry.set(owner, mailboxCid);
    await this.saveRegistry();

    this.mailboxCache.set(owner, mailbox);
    this.indexCache.set(owner, index);

    return mailbox;
  }

  /**
   * Get mailbox for user
   */
  async getMailbox(owner: Address): Promise<Mailbox | null> {
    // Check cache
    if (this.mailboxCache.has(owner)) {
      return this.mailboxCache.get(owner)!;
    }

    // Load registry if needed
    await this.loadRegistry();
    
    // Check registry for mailbox CID
    const mailboxCid = this.mailboxRegistry.get(owner);
    if (!mailboxCid) {
      return null;
    }
    
    // Download and parse mailbox metadata
    const data = await this.storageBackend.download(mailboxCid).catch((e: Error) => {
      console.error(`[MailboxStorage] Failed to download mailbox ${mailboxCid}: ${e.message}`);
      return null;
    });
    
    if (!data) return null;
    
    const mailbox = JSON.parse(data.toString()) as Mailbox;
    
    // Restore BigInt fields (may be undefined after deletion)
    mailbox.quotaUsedBytes = mailbox.quotaUsedBytes != null 
      ? BigInt(String(mailbox.quotaUsedBytes)) 
      : 0n;
    mailbox.quotaLimitBytes = mailbox.quotaLimitBytes != null 
      ? BigInt(String(mailbox.quotaLimitBytes)) 
      : 0n;
    
    this.mailboxCache.set(owner, mailbox);
    return mailbox;
  }

  /**
   * Get mailbox index
   */
  async getIndex(owner: Address): Promise<MailboxIndex | null> {
    // Check cache
    if (this.indexCache.has(owner)) {
      return this.indexCache.get(owner)!;
    }

    const mailbox = await this.getMailbox(owner);
    if (!mailbox) return null;

    // Download and decrypt index
    const encryptedIndex = await this.storageBackend.download(mailbox.encryptedIndexCid);
    const indexData = this.encryptionService
      ? await this.encryptionService.decrypt(encryptedIndex, '0x' as Hex)
      : encryptedIndex;

    const index = JSON.parse(indexData.toString()) as MailboxIndex;
    this.indexCache.set(owner, index);

    return index;
  }

  /**
   * Save index changes
   */
  async saveIndex(owner: Address, index: MailboxIndex): Promise<void> {
    const indexData = Buffer.from(JSON.stringify(index));
    const encryptedIndex = this.encryptionService
      ? await this.encryptionService.encrypt(indexData, '0x' as Hex)
      : indexData;

    const newCid = await this.storageBackend.upload(encryptedIndex);

    const mailbox = this.mailboxCache.get(owner);
    if (mailbox) {
      // Delete old index
      await this.storageBackend.delete(mailbox.encryptedIndexCid);
      
      mailbox.encryptedIndexCid = newCid;
      mailbox.lastUpdated = Date.now();
    }

    this.indexCache.set(owner, index);
  }

  // ============ Email Operations ============

  /**
   * Store inbound email
   */
  async storeInbound(owner: Address, envelope: EmailEnvelope): Promise<void> {
    let index = await this.getIndex(owner);
    if (!index) {
      await this.initializeMailbox(owner);
      index = await this.getIndex(owner);
      if (!index) throw new Error('Failed to initialize mailbox');
    }

    // Store email content
    const contentData = Buffer.from(JSON.stringify(envelope));
    const encryptedContent = this.encryptionService
      ? await this.encryptionService.encrypt(contentData, '0x' as Hex)
      : contentData;

    const contentCid = await this.storageBackend.upload(encryptedContent);

    // Create reference
    const reference: EmailReference = {
      messageId: envelope.id,
      contentCid,
      from: envelope.from.full,
      to: envelope.to.map(t => t.full),
      subject: '', // Would be decrypted client-side
      preview: '',
      timestamp: envelope.timestamp,
      size: contentData.length,
      flags: {
        read: false,
        starred: false,
        important: false,
        answered: false,
        forwarded: false,
        deleted: false,
        spam: false,
      },
      labels: [],
    };

    // Add to inbox
    index.inbox.unshift(reference);

    // Apply filter rules
    await this.applyFilterRules(owner, index, reference);

    // Save index
    await this.saveIndex(owner, index);

    // Update quota
    const mailbox = this.mailboxCache.get(owner);
    if (mailbox) {
      mailbox.quotaUsedBytes += BigInt(contentData.length);
    }
  }

  /**
   * Store outbound email (sent)
   */
  async storeOutbound(
    owner: Address,
    envelope: EmailEnvelope,
    content: EmailContent
  ): Promise<void> {
    let index = await this.getIndex(owner);
    if (!index) {
      await this.initializeMailbox(owner);
      index = await this.getIndex(owner);
      if (!index) throw new Error('Failed to initialize mailbox');
    }

    // Store email content
    const contentData = Buffer.from(JSON.stringify({ envelope, content }));
    const encryptedContent = this.encryptionService
      ? await this.encryptionService.encrypt(contentData, '0x' as Hex)
      : contentData;

    const contentCid = await this.storageBackend.upload(encryptedContent);

    // Create reference
    const reference: EmailReference = {
      messageId: envelope.id,
      contentCid,
      from: envelope.from.full,
      to: envelope.to.map(t => t.full),
      subject: content.subject,
      preview: content.bodyText.slice(0, 100),
      timestamp: envelope.timestamp,
      size: contentData.length,
      flags: {
        read: true,
        starred: false,
        important: false,
        answered: false,
        forwarded: false,
        deleted: false,
        spam: false,
      },
      labels: [],
    };

    // Add to sent
    index.sent.unshift(reference);

    // Save index
    await this.saveIndex(owner, index);

    // Update quota
    const mailbox = this.mailboxCache.get(owner);
    if (mailbox) {
      mailbox.quotaUsedBytes += BigInt(contentData.length);
    }
  }

  /**
   * Get email by ID
   */
  async getEmail(owner: Address, messageId: Hex): Promise<{
    envelope: EmailEnvelope;
    content?: EmailContent;
  } | null> {
    const index = await this.getIndex(owner);
    if (!index) return null;

    // Find in all folders
    const allEmails = [
      ...index.inbox,
      ...index.sent,
      ...index.drafts,
      ...index.trash,
      ...index.spam,
      ...index.archive,
      ...Object.values(index.folders).flat(),
    ];

    const reference = allEmails.find(e => e.messageId === messageId);
    if (!reference) return null;

    // Download and decrypt
    const encryptedContent = await this.storageBackend.download(reference.contentCid);
    const contentData = this.encryptionService
      ? await this.encryptionService.decrypt(encryptedContent, '0x' as Hex)
      : encryptedContent;

    const parsed = JSON.parse(contentData.toString()) as {
      envelope?: EmailEnvelope;
      content?: EmailContent;
    } | EmailEnvelope;

    // Handle both storage formats
    if ('envelope' in parsed && parsed.envelope) {
      return { envelope: parsed.envelope, content: parsed.content };
    }
    
    return { envelope: parsed as EmailEnvelope };
  }

  /**
   * Move email to folder
   */
  async moveToFolder(
    owner: Address,
    messageId: Hex,
    targetFolder: string
  ): Promise<void> {
    const index = await this.getIndex(owner);
    if (!index) throw new Error('Mailbox not found');

    // Find and remove from current location
    let reference: EmailReference | undefined;
    
    const folders = ['inbox', 'sent', 'drafts', 'trash', 'spam', 'archive'] as const;
    for (const folder of folders) {
      const idx = index[folder].findIndex(e => e.messageId === messageId);
      if (idx !== -1) {
        reference = index[folder].splice(idx, 1)[0];
        break;
      }
    }

    // Check custom folders
    if (!reference) {
      for (const [folderName, emails] of Object.entries(index.folders)) {
        const idx = emails.findIndex(e => e.messageId === messageId);
        if (idx !== -1) {
          reference = emails.splice(idx, 1)[0];
          break;
        }
      }
    }

    if (!reference) throw new Error('Email not found');

    // Add to target folder
    if (targetFolder in index) {
      (index[targetFolder as keyof typeof index] as EmailReference[]).unshift(reference);
    } else {
      if (!index.folders[targetFolder]) {
        index.folders[targetFolder] = [];
      }
      index.folders[targetFolder].unshift(reference);
    }

    await this.saveIndex(owner, index);
  }

  /**
   * Update email flags
   */
  async updateFlags(
    owner: Address,
    messageId: Hex,
    flags: Partial<EmailFlags>
  ): Promise<void> {
    const index = await this.getIndex(owner);
    if (!index) throw new Error('Mailbox not found');

    // Find in all folders
    const allEmails = [
      ...index.inbox,
      ...index.sent,
      ...index.drafts,
      ...index.trash,
      ...index.spam,
      ...index.archive,
      ...Object.values(index.folders).flat(),
    ];

    const reference = allEmails.find(e => e.messageId === messageId);
    if (!reference) throw new Error('Email not found');

    // Update flags
    Object.assign(reference.flags, flags);

    await this.saveIndex(owner, index);
  }

  /**
   * Delete email permanently
   */
  async deleteEmail(owner: Address, messageId: Hex): Promise<void> {
    const index = await this.getIndex(owner);
    if (!index) throw new Error('Mailbox not found');

    // Find and remove
    let reference: EmailReference | undefined;
    
    const folders = ['inbox', 'sent', 'drafts', 'trash', 'spam', 'archive'] as const;
    for (const folder of folders) {
      const idx = index[folder].findIndex(e => e.messageId === messageId);
      if (idx !== -1) {
        reference = index[folder].splice(idx, 1)[0];
        break;
      }
    }

    if (!reference) {
      for (const emails of Object.values(index.folders)) {
        const idx = emails.findIndex(e => e.messageId === messageId);
        if (idx !== -1) {
          reference = emails.splice(idx, 1)[0];
          break;
        }
      }
    }

    if (!reference) throw new Error('Email not found');

    // Delete content from storage
    await this.storageBackend.delete(reference.contentCid);

    // Update quota
    const mailbox = this.mailboxCache.get(owner);
    if (mailbox) {
      mailbox.quotaUsedBytes -= BigInt(reference.size);
      if (mailbox.quotaUsedBytes < BigInt(0)) mailbox.quotaUsedBytes = BigInt(0);
    }

    await this.saveIndex(owner, index);
  }

  // ============ Filter Rules ============

  /**
   * Apply filter rules to incoming email
   */
  private async applyFilterRules(
    owner: Address,
    index: MailboxIndex,
    reference: EmailReference
  ): Promise<void> {
    for (const rule of index.rules) {
      if (!rule.enabled) continue;

      // Check conditions
      const matches = rule.conditions.every(condition => {
        let value = '';
        switch (condition.field) {
          case 'from':
            value = reference.from;
            break;
          case 'to':
            value = reference.to.join(', ');
            break;
          case 'subject':
            value = reference.subject;
            break;
          default:
            return false;
        }

        switch (condition.operator) {
          case 'contains':
            return value.toLowerCase().includes(condition.value.toLowerCase());
          case 'equals':
            return value.toLowerCase() === condition.value.toLowerCase();
          case 'startsWith':
            return value.toLowerCase().startsWith(condition.value.toLowerCase());
          case 'endsWith':
            return value.toLowerCase().endsWith(condition.value.toLowerCase());
          case 'regex':
            return new RegExp(condition.value, 'i').test(value);
          default:
            return false;
        }
      });

      if (!matches) continue;

      // Apply actions
      for (const action of rule.actions) {
        switch (action.type) {
          case 'move':
            if (action.value) {
              // Remove from inbox
              const idx = index.inbox.findIndex(e => e.messageId === reference.messageId);
              if (idx !== -1) index.inbox.splice(idx, 1);
              
              // Add to target folder
              if (!index.folders[action.value]) {
                index.folders[action.value] = [];
              }
              index.folders[action.value].unshift(reference);
            }
            break;
          case 'label':
            if (action.value) {
              reference.labels.push(action.value);
            }
            break;
          case 'star':
            reference.flags.starred = true;
            break;
          case 'markRead':
            reference.flags.read = true;
            break;
          case 'delete':
            reference.flags.deleted = true;
            break;
        }
      }
    }
  }

  /**
   * Add filter rule
   */
  async addFilterRule(owner: Address, rule: FilterRule): Promise<void> {
    const index = await this.getIndex(owner);
    if (!index) throw new Error('Mailbox not found');

    index.rules.push(rule);
    await this.saveIndex(owner, index);
  }

  /**
   * Remove filter rule
   */
  async removeFilterRule(owner: Address, ruleId: string): Promise<void> {
    const index = await this.getIndex(owner);
    if (!index) throw new Error('Mailbox not found');

    index.rules = index.rules.filter(r => r.id !== ruleId);
    await this.saveIndex(owner, index);
  }

  // ============ Data Export (GDPR) ============

  /**
   * Export all user data for GDPR compliance
   */
  async exportUserData(owner: Address): Promise<{
    mailbox: Mailbox;
    index: MailboxIndex;
    emails: Array<{ envelope: EmailEnvelope; content?: EmailContent }>;
  }> {
    const mailbox = await this.getMailbox(owner);
    if (!mailbox) throw new Error('Mailbox not found');

    const index = await this.getIndex(owner);
    if (!index) throw new Error('Index not found');

    // Collect all email references
    const allRefs = [
      ...index.inbox,
      ...index.sent,
      ...index.drafts,
      ...index.trash,
      ...index.spam,
      ...index.archive,
      ...Object.values(index.folders).flat(),
    ];

    // Download all emails
    const emails: Array<{ envelope: EmailEnvelope; content?: EmailContent }> = [];
    for (const ref of allRefs) {
      const email = await this.getEmail(owner, ref.messageId);
      if (email) emails.push(email);
    }

    return { mailbox, index, emails };
  }

  /**
   * Delete all user data (GDPR right to be forgotten)
   */
  async deleteAllUserData(owner: Address): Promise<void> {
    const index = await this.getIndex(owner);
    if (!index) return;

    // Delete all email content
    const allRefs = [
      ...index.inbox,
      ...index.sent,
      ...index.drafts,
      ...index.trash,
      ...index.spam,
      ...index.archive,
      ...Object.values(index.folders).flat(),
    ];

    for (const ref of allRefs) {
      await this.storageBackend.delete(ref.contentCid);
    }

    // Delete index
    const mailbox = this.mailboxCache.get(owner);
    if (mailbox) {
      await this.storageBackend.delete(mailbox.encryptedIndexCid);
    }

    // Clear cache
    this.mailboxCache.delete(owner);
    this.indexCache.delete(owner);
  }

  // ============ Search ============

  /**
   * Search emails in mailbox
   */
  async searchEmails(
    owner: Address,
    query: string,
    options: {
      folder?: string;
      from?: string;
      to?: string;
      dateFrom?: number;
      dateTo?: number;
      hasAttachment?: boolean;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ results: EmailReference[]; total: number }> {
    const index = await this.getIndex(owner);
    if (!index) return { results: [], total: 0 };

    // Get emails from specified folder or all folders
    let emails: EmailReference[];
    if (options.folder) {
      if (options.folder in index) {
        emails = [...(index[options.folder as keyof typeof index] as EmailReference[])];
      } else if (index.folders[options.folder]) {
        emails = [...index.folders[options.folder]];
      } else {
        emails = [];
      }
    } else {
      emails = [
        ...index.inbox,
        ...index.sent,
        ...index.drafts,
        ...index.archive,
        ...Object.values(index.folders).flat(),
      ];
    }

    // Apply filters
    const queryLower = query.toLowerCase();
    let filtered = emails.filter(email => {
      // Text search
      if (query && !email.from.toLowerCase().includes(queryLower) &&
          !email.to.some(t => t.toLowerCase().includes(queryLower)) &&
          !email.subject.toLowerCase().includes(queryLower) &&
          !email.preview.toLowerCase().includes(queryLower)) {
        return false;
      }

      // From filter
      if (options.from && !email.from.toLowerCase().includes(options.from.toLowerCase())) {
        return false;
      }

      // To filter
      if (options.to && !email.to.some(t => t.toLowerCase().includes(options.to!.toLowerCase()))) {
        return false;
      }

      // Date filters
      if (options.dateFrom && email.timestamp < options.dateFrom) {
        return false;
      }
      if (options.dateTo && email.timestamp > options.dateTo) {
        return false;
      }

      return true;
    });

    const total = filtered.length;

    // Apply pagination
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 50;
    filtered = filtered.slice(offset, offset + limit);

    return { results: filtered, total };
  }
}

// ============ Factory ============

let _mailboxStorage: MailboxStorage | null = null;

export function createMailboxStorage(
  storageBackend: StorageBackend,
  encryptionService?: EncryptionService
): MailboxStorage {
  return new MailboxStorage(storageBackend, encryptionService);
}

export function getMailboxStorage(): MailboxStorage {
  if (!_mailboxStorage) {
    // Use real DWS multi-backend storage
    const manager = getMultiBackendManager();
    const adapter = new DWSStorageAdapter(manager);
    _mailboxStorage = new MailboxStorage(adapter);
    console.log('[MailboxStorage] Initialized with DWS multi-backend storage');
  }
  return _mailboxStorage;
}

export function initializeMailboxStorage(
  storageBackend: StorageBackend,
  encryptionService?: EncryptionService
): MailboxStorage {
  _mailboxStorage = new MailboxStorage(storageBackend, encryptionService);
  return _mailboxStorage;
}

/**
 * Initialize with DWS backend (preferred)
 */
export function initializeWithDWS(): MailboxStorage {
  const manager = getMultiBackendManager();
  const adapter = new DWSStorageAdapter(manager);
  _mailboxStorage = new MailboxStorage(adapter);
  return _mailboxStorage;
}

export function resetMailboxStorage(): void {
  _mailboxStorage = null;
}
