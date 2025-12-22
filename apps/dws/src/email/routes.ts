/**
 * Email Service API Routes
 * 
 * REST API for email operations:
 * - Send/receive emails
 * - Mailbox management
 * - Folder operations
 * - Search
 * - Data export (GDPR)
 */

import { Hono } from 'hono';
import type { Address, Hex } from 'viem';
import { z } from 'zod';
import { expectValid, validateQuery } from '../shared/validation';
import type {
  SendEmailRequest,
  GetMailboxResponse,
  GetEmailResponse,
  SearchEmailsRequest,
  SearchEmailsResponse,
  EmailFlags,
  FilterRule,
  EmailTier,
} from './types';
import { getEmailRelayService } from './relay';
import { getMailboxStorage } from './storage';

// ============ Schemas ============

const sendEmailSchema = z.object({
  from: z.string().email(),
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  subject: z.string(),
  bodyText: z.string(),
  bodyHtml: z.string().optional(),
  attachments: z.array(z.object({
    filename: z.string(),
    content: z.string(), // Base64
    mimeType: z.string(),
  })).optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  replyTo: z.string().email().optional(),
  inReplyTo: z.string().optional(),
});

const updateFlagsSchema = z.object({
  read: z.boolean().optional(),
  starred: z.boolean().optional(),
  important: z.boolean().optional(),
  answered: z.boolean().optional(),
  forwarded: z.boolean().optional(),
  deleted: z.boolean().optional(),
  spam: z.boolean().optional(),
});

const moveEmailSchema = z.object({
  targetFolder: z.string(),
});

const searchEmailsSchema = z.object({
  query: z.string().optional().default(''),
  folder: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  dateFrom: z.number().optional(),
  dateTo: z.number().optional(),
  hasAttachment: z.boolean().optional(),
  limit: z.number().min(1).max(100).optional().default(50),
  offset: z.number().min(0).optional().default(0),
});

const filterRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  conditions: z.array(z.object({
    field: z.enum(['from', 'to', 'subject', 'body', 'header']),
    operator: z.enum(['contains', 'equals', 'startsWith', 'endsWith', 'regex']),
    value: z.string(),
  })),
  actions: z.array(z.object({
    type: z.enum(['move', 'label', 'star', 'markRead', 'forward', 'delete']),
    value: z.string().optional(),
  })),
  enabled: z.boolean(),
});

// ============ Query Schemas ============

const folderQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

// ============ Helper Functions ============

function getAuthenticatedUser(c: { req: { header: (name: string) => string | undefined } }): {
  address: Address;
  email: string;
  tier: EmailTier;
} | null {
  const addressHeader = c.req.header('x-wallet-address');
  if (!addressHeader) return null;

  return {
    address: addressHeader as Address,
    email: `user@jeju.mail`,
    tier: 'staked',
  };
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  return expectValid(schema, body, 'Request body');
}

// ============ Router ============

export function createEmailRouter(): Hono {
  const app = new Hono();

  // Health check
  app.get('/health', (c) => {
    return c.json({ status: 'ok', service: 'email' });
  });

  // ============ Send Email ============

  app.post('/send', async (c) => {
    const user = getAuthenticatedUser(c);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const request = parseBody(sendEmailSchema, body) as SendEmailRequest;

    const relay = getEmailRelayService();
    const response = await relay.sendEmail(request, user.address, user.tier);

    return c.json(response, response.success ? 200 : 400);
  });

  // ============ Mailbox Operations ============

  app.get('/mailbox', async (c) => {
    const user = getAuthenticatedUser(c);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const storage = getMailboxStorage();
    let mailbox = await storage.getMailbox(user.address);
    
    if (!mailbox) {
      mailbox = await storage.initializeMailbox(user.address);
    }

    const index = await storage.getIndex(user.address);
    if (!index) {
      return c.json({ error: 'Failed to load mailbox' }, 500);
    }

    const unreadCount = index.inbox.filter(e => !e.flags.read).length;

    const response: GetMailboxResponse = {
      mailbox,
      index,
      unreadCount,
    };

    return c.json(response);
  });

  // Get folder contents
  app.get('/mailbox/:folder', async (c) => {
    const user = getAuthenticatedUser(c);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const folder = c.req.param('folder');
    const { limit, offset } = validateQuery(folderQuerySchema, c);

    const storage = getMailboxStorage();
    const index = await storage.getIndex(user.address);
    
    if (!index) {
      return c.json({ error: 'Mailbox not found' }, 404);
    }

    let emails: typeof index.inbox;
    
    if (folder in index) {
      emails = index[folder as keyof typeof index] as typeof index.inbox;
    } else if (index.folders[folder]) {
      emails = index.folders[folder];
    } else {
      return c.json({ error: 'Folder not found' }, 404);
    }

    const total = emails.length;
    const results = emails.slice(offset, offset + limit);

    return c.json({
      folder,
      emails: results,
      total,
      hasMore: offset + limit < total,
    });
  });

  // ============ Email Operations ============

  // Get single email
  app.get('/email/:messageId', async (c) => {
    const user = getAuthenticatedUser(c);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const messageId = c.req.param('messageId') as Hex;

    const storage = getMailboxStorage();
    const email = await storage.getEmail(user.address, messageId);

    if (!email) {
      return c.json({ error: 'Email not found' }, 404);
    }

    // Mark as read
    await storage.updateFlags(user.address, messageId, { read: true });

    const index = await storage.getIndex(user.address);
    const allEmails = index ? [
      ...index.inbox,
      ...index.sent,
      ...index.drafts,
      ...index.trash,
      ...index.spam,
      ...index.archive,
      ...Object.values(index.folders).flat(),
    ] : [];
    
    const reference = allEmails.find(e => e.messageId === messageId);

    const response: GetEmailResponse = {
      envelope: email.envelope,
      content: email.content ?? {
        subject: '',
        bodyText: '',
        headers: {},
        attachments: [],
      },
      flags: reference?.flags ?? {
        read: true,
        starred: false,
        important: false,
        answered: false,
        forwarded: false,
        deleted: false,
        spam: false,
      },
    };

    return c.json(response);
  });

  // Update email flags
  app.patch('/email/:messageId/flags', async (c) => {
    const user = getAuthenticatedUser(c);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const messageId = c.req.param('messageId') as Hex;
    const body = await c.req.json();
    const flags = parseBody(updateFlagsSchema, body) as Partial<EmailFlags>;

    const storage = getMailboxStorage();
    await storage.updateFlags(user.address, messageId, flags);

    return c.json({ success: true });
  });

  // Move email to folder
  app.post('/email/:messageId/move', async (c) => {
    const user = getAuthenticatedUser(c);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const messageId = c.req.param('messageId') as Hex;
    const body = await c.req.json();
    const { targetFolder } = parseBody(moveEmailSchema, body);

    const storage = getMailboxStorage();
    await storage.moveToFolder(user.address, messageId, targetFolder);

    return c.json({ success: true });
  });

  // Delete email
  app.delete('/email/:messageId', async (c) => {
    const user = getAuthenticatedUser(c);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const messageId = c.req.param('messageId') as Hex;
    const permanent = c.req.query('permanent') === 'true';

    const storage = getMailboxStorage();

    if (permanent) {
      await storage.deleteEmail(user.address, messageId);
    } else {
      // Move to trash
      await storage.moveToFolder(user.address, messageId, 'trash');
    }

    return c.json({ success: true });
  });

  // ============ Search ============

  app.post('/search', async (c) => {
    const user = getAuthenticatedUser(c);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const request = parseBody(searchEmailsSchema, body) as SearchEmailsRequest;

    const storage = getMailboxStorage();
    const result = await storage.searchEmails(user.address, request.query, {
      folder: request.folder,
      from: request.from,
      to: request.to,
      dateFrom: request.dateFrom,
      dateTo: request.dateTo,
      hasAttachment: request.hasAttachment,
      limit: request.limit,
      offset: request.offset,
    });

    const response: SearchEmailsResponse = {
      results: result.results,
      total: result.total,
      hasMore: (request.offset ?? 0) + result.results.length < result.total,
    };

    return c.json(response);
  });

  // ============ Folder Management ============

  // Create folder
  app.post('/folders', async (c) => {
    const user = getAuthenticatedUser(c);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const { name } = await c.req.json() as { name: string };

    const storage = getMailboxStorage();
    const index = await storage.getIndex(user.address);
    
    if (!index) {
      return c.json({ error: 'Mailbox not found' }, 404);
    }

    if (index.folders[name]) {
      return c.json({ error: 'Folder already exists' }, 400);
    }

    index.folders[name] = [];
    await storage.saveIndex(user.address, index);

    return c.json({ success: true, folder: name });
  });

  // Delete folder
  app.delete('/folders/:name', async (c) => {
    const user = getAuthenticatedUser(c);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const name = c.req.param('name');

    const storage = getMailboxStorage();
    const index = await storage.getIndex(user.address);
    
    if (!index) {
      return c.json({ error: 'Mailbox not found' }, 404);
    }

    if (!index.folders[name]) {
      return c.json({ error: 'Folder not found' }, 404);
    }

    // Move emails to inbox before deleting folder
    index.inbox.push(...index.folders[name]);
    delete index.folders[name];
    
    await storage.saveIndex(user.address, index);

    return c.json({ success: true });
  });

  // ============ Filter Rules ============

  // Get filter rules
  app.get('/rules', async (c) => {
    const user = getAuthenticatedUser(c);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const storage = getMailboxStorage();
    const index = await storage.getIndex(user.address);
    
    if (!index) {
      return c.json({ error: 'Mailbox not found' }, 404);
    }

    return c.json({ rules: index.rules });
  });

  // Add filter rule
  app.post('/rules', async (c) => {
    const user = getAuthenticatedUser(c);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const rule = parseBody(filterRuleSchema, body) as FilterRule;

    const storage = getMailboxStorage();
    await storage.addFilterRule(user.address, rule);

    return c.json({ success: true, rule });
  });

  // Delete filter rule
  app.delete('/rules/:ruleId', async (c) => {
    const user = getAuthenticatedUser(c);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const ruleId = c.req.param('ruleId');

    const storage = getMailboxStorage();
    await storage.removeFilterRule(user.address, ruleId);

    return c.json({ success: true });
  });

  // ============ Data Export (GDPR) ============

  // Export all data
  app.get('/export', async (c) => {
    const user = getAuthenticatedUser(c);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const storage = getMailboxStorage();
    const data = await storage.exportUserData(user.address);

    // Return as downloadable JSON
    c.header('Content-Type', 'application/json');
    c.header('Content-Disposition', `attachment; filename="jeju-mail-export-${Date.now()}.json"`);
    
    return c.body(JSON.stringify(data, null, 2));
  });

  // Delete all data (GDPR right to be forgotten)
  app.delete('/account', async (c) => {
    const user = getAuthenticatedUser(c);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const { confirm } = await c.req.json() as { confirm: boolean };
    
    if (!confirm) {
      return c.json({ error: 'Confirmation required' }, 400);
    }

    const storage = getMailboxStorage();
    await storage.deleteAllUserData(user.address);

    return c.json({ success: true, message: 'All email data has been permanently deleted' });
  });

  // ============ Delivery Status ============

  app.get('/status/:messageId', async (c) => {
    const user = getAuthenticatedUser(c);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const messageId = c.req.param('messageId') as Hex;

    const relay = getEmailRelayService();
    const status = relay.getDeliveryStatus(messageId);

    if (!status) {
      return c.json({ error: 'Message not found' }, 404);
    }

    return c.json({ messageId, status });
  });

  return app;
}
