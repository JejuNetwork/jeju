/**
 * Email Routes
 * Decentralized email service for DWS
 *
 * Lightweight API for local development and testing.
 * Uses SQLit for persistence. Production traffic should use the full email system
 * at /email/* routes which integrates with:
 * - DWS Storage (IPFS/Arweave)
 * - EmailRegistry contract
 * - Content screening
 * - Encryption
 */

import {
  getSQLitMinerUrl,
  getSQLitUrl,
  isProductionEnv,
} from '@jejunetwork/config'
import { getSQLit, resetSQLit } from '@jejunetwork/db'
import { bytesToHex, hash256 } from '@jejunetwork/shared'
import { expectValid } from '@jejunetwork/types'
import { Elysia, t } from 'elysia'
import { z } from 'zod'
import { getMetrics } from '../../src/email/metrics'

const SQLIT_DATABASE_ID = process.env.SQLIT_DATABASE_ID ?? 'dws'

// SQLit Client singleton
let sqlitClient: ReturnType<typeof getSQLit> | null = null

async function getSQLitClient() {
  if (!sqlitClient) {
    resetSQLit()
    const blockProducerEndpoint = getSQLitUrl()
    const minerEndpoint = getSQLitMinerUrl()

    sqlitClient = getSQLit({
      blockProducerEndpoint,
      minerEndpoint,
      databaseId: SQLIT_DATABASE_ID,
      timeout: 30000,
      debug: !isProductionEnv(),
    })

    await ensureTablesExist()
  }
  return sqlitClient
}

async function ensureTablesExist(): Promise<void> {
  if (!sqlitClient) return

  const tables = [
    `CREATE TABLE IF NOT EXISTS email_mailboxes (
      address TEXT PRIMARY KEY,
      quota_used_bytes INTEGER NOT NULL DEFAULT 0,
      quota_limit_bytes INTEGER NOT NULL DEFAULT 104857600,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS email_messages (
      message_id TEXT PRIMARY KEY,
      owner_address TEXT NOT NULL,
      folder TEXT NOT NULL,
      from_addr TEXT NOT NULL,
      to_addr TEXT NOT NULL,
      subject TEXT NOT NULL,
      body_text TEXT NOT NULL,
      body_html TEXT,
      snippet TEXT NOT NULL,
      cc TEXT,
      bcc TEXT,
      reply_to TEXT,
      in_reply_to TEXT,
      sent_at INTEGER,
      received_at INTEGER NOT NULL,
      flag_read INTEGER NOT NULL DEFAULT 0,
      flag_starred INTEGER NOT NULL DEFAULT 0,
      flag_important INTEGER NOT NULL DEFAULT 0,
      flag_answered INTEGER NOT NULL DEFAULT 0,
      flag_forwarded INTEGER NOT NULL DEFAULT 0,
      flag_deleted INTEGER NOT NULL DEFAULT 0,
      flag_spam INTEGER NOT NULL DEFAULT 0
    )`,
  ]

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_email_owner ON email_messages(owner_address)',
    'CREATE INDEX IF NOT EXISTS idx_email_folder ON email_messages(owner_address, folder)',
    'CREATE INDEX IF NOT EXISTS idx_email_received ON email_messages(received_at DESC)',
  ]

  for (const ddl of tables) {
    await sqlitClient.exec(ddl, [], SQLIT_DATABASE_ID)
  }

  for (const idx of indexes) {
    await sqlitClient.exec(idx, [], SQLIT_DATABASE_ID)
  }
}

// Types
interface EmailFlags {
  read: boolean
  starred: boolean
  important: boolean
  answered: boolean
  forwarded: boolean
  deleted: boolean
  spam: boolean
}

interface EmailIndexEntry {
  messageId: string
  from: string
  to: string
  subject: string
  snippet: string
  receivedAt: number
  sentAt?: number
  flags: EmailFlags
}

interface Email extends EmailIndexEntry {
  bodyText: string
  bodyHtml?: string
  cc?: string[]
  bcc?: string[]
  replyTo?: string
  inReplyTo?: string
  references?: string[]
}

interface MailboxRow {
  address: string
  quota_used_bytes: number
  quota_limit_bytes: number
  created_at: number
}

interface EmailRow {
  message_id: string
  owner_address: string
  folder: string
  from_addr: string
  to_addr: string
  subject: string
  body_text: string
  body_html: string | null
  snippet: string
  cc: string | null
  bcc: string | null
  reply_to: string | null
  in_reply_to: string | null
  sent_at: number | null
  received_at: number
  flag_read: number
  flag_starred: number
  flag_important: number
  flag_answered: number
  flag_forwarded: number
  flag_deleted: number
  flag_spam: number
}

/** Request body for sending an email */
const SendEmailBodySchema = z.object({
  from: z.string().email(),
  to: z.array(z.string().email()).min(1),
  subject: z.string(),
  bodyText: z.string(),
  bodyHtml: z.string().optional(),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  replyTo: z.string().email().optional(),
})

/** Request body for updating email flags */
const UpdateFlagsBodySchema = z.object({
  flags: z.object({
    read: z.boolean().optional(),
    starred: z.boolean().optional(),
    important: z.boolean().optional(),
    answered: z.boolean().optional(),
    forwarded: z.boolean().optional(),
    deleted: z.boolean().optional(),
    spam: z.boolean().optional(),
  }),
})

/** Request body for moving email to folder */
const MoveEmailBodySchema = z.object({
  folder: z.string().min(1),
})

async function getOrCreateMailbox(address: string): Promise<MailboxRow> {
  const normalized = address.toLowerCase()
  const client = await getSQLitClient()

  const result = await client.query<MailboxRow>(
    'SELECT * FROM email_mailboxes WHERE address = ?',
    [normalized],
    SQLIT_DATABASE_ID,
  )

  if (result.rows[0]) return result.rows[0]

  const newMailbox: MailboxRow = {
    address: normalized,
    quota_used_bytes: 0,
    quota_limit_bytes: 100 * 1024 * 1024, // 100MB
    created_at: Date.now(),
  }

  await client.exec(
    `INSERT INTO email_mailboxes (address, quota_used_bytes, quota_limit_bytes, created_at)
     VALUES (?, ?, ?, ?)`,
    [
      newMailbox.address,
      newMailbox.quota_used_bytes,
      newMailbox.quota_limit_bytes,
      newMailbox.created_at,
    ],
    SQLIT_DATABASE_ID,
  )

  return newMailbox
}

async function getMailboxEmails(
  address: string,
  folder: string,
): Promise<EmailRow[]> {
  const client = await getSQLitClient()
  const result = await client.query<EmailRow>(
    'SELECT * FROM email_messages WHERE owner_address = ? AND folder = ? ORDER BY received_at DESC',
    [address.toLowerCase(), folder],
    SQLIT_DATABASE_ID,
  )
  return result.rows
}

async function getMailboxCount(address: string): Promise<number> {
  const client = await getSQLitClient()
  const result = await client.query<{ count: number }>(
    'SELECT COUNT(*) as count FROM email_mailboxes WHERE owner = ?',
    [address.toLowerCase()],
    SQLIT_DATABASE_ID,
  )
  return result.rows[0].count ?? 0
}

function rowToIndexEntry(row: EmailRow): EmailIndexEntry {
  return {
    messageId: row.message_id,
    from: row.from_addr,
    to: row.to_addr,
    subject: row.subject,
    snippet: row.snippet,
    receivedAt: row.received_at,
    sentAt: row.sent_at ?? undefined,
    flags: {
      read: row.flag_read === 1,
      starred: row.flag_starred === 1,
      important: row.flag_important === 1,
      answered: row.flag_answered === 1,
      forwarded: row.flag_forwarded === 1,
      deleted: row.flag_deleted === 1,
      spam: row.flag_spam === 1,
    },
  }
}

function rowToEmail(row: EmailRow): Email {
  return {
    ...rowToIndexEntry(row),
    bodyText: row.body_text,
    bodyHtml: row.body_html ?? undefined,
    cc: row.cc ? (JSON.parse(row.cc) as string[]) : undefined,
    bcc: row.bcc ? (JSON.parse(row.bcc) as string[]) : undefined,
    replyTo: row.reply_to ?? undefined,
    inReplyTo: row.in_reply_to ?? undefined,
  }
}

function generateMessageId(
  from: string,
  to: string[],
  timestamp: number,
): string {
  const data = `${from}:${to.join(',')}:${timestamp}:${Math.random()}`
  return bytesToHex(hash256(data)).slice(0, 32)
}

function createSnippet(text: string, maxLength = 150): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= maxLength) return cleaned
  return `${cleaned.slice(0, maxLength)}...`
}

function calculateEmailSize(email: Email): number {
  const json = JSON.stringify(email)
  return Buffer.byteLength(json, 'utf8')
}

export function createEmailRouter() {
  return (
    new Elysia({ prefix: '/email' })
      .get('/health', async () => ({
        status: 'healthy' as const,
        service: 'email',
        activeMailboxes: await getMailboxCount(''),
      }))

      .get('/metrics', async ({ set }) => {
        set.headers['Content-Type'] = 'text/plain'
        return getMetrics()
      })

      // Get mailbox overview
      .get('/mailbox', async ({ headers, set }) => {
        const address = headers['x-wallet-address']
        if (!address) {
          set.status = 401
          return { error: 'Wallet address required' }
        }

        const mailbox = await getOrCreateMailbox(address)
        const inbox = await getMailboxEmails(address, 'inbox')
        const sent = await getMailboxEmails(address, 'sent')
        const drafts = await getMailboxEmails(address, 'drafts')
        const trash = await getMailboxEmails(address, 'trash')
        const spam = await getMailboxEmails(address, 'spam')
        const archive = await getMailboxEmails(address, 'archive')

        const unreadCount = inbox.filter((e) => e.flag_read === 0).length

        return {
          mailbox: {
            quotaUsedBytes: String(mailbox.quota_used_bytes),
            quotaLimitBytes: String(mailbox.quota_limit_bytes),
          },
          index: {
            inbox: inbox.map(rowToIndexEntry),
            sent: sent.map(rowToIndexEntry),
            drafts: drafts.map(rowToIndexEntry),
            trash: trash.map(rowToIndexEntry),
            spam: spam.map(rowToIndexEntry),
            archive: archive.map(rowToIndexEntry),
            folders: {},
          },
          unreadCount,
        }
      })

      // Send email
      .post(
        '/send',
        async ({ body, headers, set }) => {
          const address = headers['x-wallet-address']
          if (!address) {
            set.status = 401
            return { error: 'Wallet address required' }
          }

          const parseResult = SendEmailBodySchema.safeParse(body)
          if (!parseResult.success) {
            set.status = 400
            const errors = parseResult.error.issues
              .map((i) => `${i.path.join('.')}: ${i.message}`)
              .join(', ')
            return { error: `Invalid email request: ${errors}` }
          }
          const { from, to, subject, bodyText, bodyHtml, cc, bcc, replyTo } =
            parseResult.data

          const timestamp = Date.now()
          const messageId = generateMessageId(from, to, timestamp)

          const email: Email = {
            messageId,
            from,
            to: to.join(', '),
            subject,
            bodyText,
            bodyHtml,
            snippet: createSnippet(bodyText),
            sentAt: timestamp,
            receivedAt: timestamp,
            cc,
            bcc,
            replyTo,
            flags: {
              read: true,
              starred: false,
              important: false,
              answered: false,
              forwarded: false,
              deleted: false,
              spam: false,
            },
          }

          // Check quota
          const senderMailbox = await getOrCreateMailbox(address)
          const emailSize = calculateEmailSize(email)

          if (
            senderMailbox.quota_used_bytes + emailSize >
            senderMailbox.quota_limit_bytes
          ) {
            set.status = 507
            return { error: 'Mailbox quota exceeded' }
          }

          const client = await getSQLitClient()

          // Store in sender's sent folder
          await client.exec(
            `INSERT INTO email_messages (
              message_id, owner_address, folder, from_addr, to_addr, subject, body_text, body_html,
              snippet, cc, bcc, reply_to, sent_at, received_at,
              flag_read, flag_starred, flag_important, flag_answered, flag_forwarded, flag_deleted, flag_spam
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 0, 0, 0, 0)`,
            [
              `${messageId}-sent`,
              address.toLowerCase(),
              'sent',
              from,
              to.join(', '),
              subject,
              bodyText,
              bodyHtml ?? null,
              email.snippet,
              cc ? JSON.stringify(cc) : null,
              bcc ? JSON.stringify(bcc) : null,
              replyTo ?? null,
              timestamp,
              timestamp,
            ],
            SQLIT_DATABASE_ID,
          )

          // Update sender quota
          await client.exec(
            'UPDATE email_mailboxes SET quota_used_bytes = quota_used_bytes + ? WHERE address = ?',
            [emailSize, address.toLowerCase()],
            SQLIT_DATABASE_ID,
          )

          // Deliver to recipients (if they have mailboxes on this system)
          for (const recipient of to) {
            const recipientAddress = recipient.split('@')[0]
            if (recipientAddress.startsWith('0x')) {
              const _recipientMailbox =
                await getOrCreateMailbox(recipientAddress)

              await client.exec(
                `INSERT INTO email_messages (
                  message_id, owner_address, folder, from_addr, to_addr, subject, body_text, body_html,
                  snippet, cc, bcc, reply_to, sent_at, received_at,
                  flag_read, flag_starred, flag_important, flag_answered, flag_forwarded, flag_deleted, flag_spam
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0)`,
                [
                  `${messageId}-inbox-${recipientAddress.toLowerCase()}`,
                  recipientAddress.toLowerCase(),
                  'inbox',
                  from,
                  to.join(', '),
                  subject,
                  bodyText,
                  bodyHtml ?? null,
                  email.snippet,
                  cc ? JSON.stringify(cc) : null,
                  bcc ? JSON.stringify(bcc) : null,
                  replyTo ?? null,
                  timestamp,
                  timestamp,
                ],
                SQLIT_DATABASE_ID,
              )

              await client.exec(
                'UPDATE email_mailboxes SET quota_used_bytes = quota_used_bytes + ? WHERE address = ?',
                [emailSize, recipientAddress.toLowerCase()],
                SQLIT_DATABASE_ID,
              )
            }
          }

          return {
            success: true,
            messageId,
            sentAt: timestamp,
          }
        },
        {
          body: t.Object({
            from: t.String(),
            to: t.Array(t.String(), { minItems: 1 }),
            subject: t.String(),
            bodyText: t.String(),
            bodyHtml: t.Optional(t.String()),
            cc: t.Optional(t.Array(t.String())),
            bcc: t.Optional(t.Array(t.String())),
            replyTo: t.Optional(t.String()),
          }),
        },
      )

      // Get single email
      .get('/message/:messageId', async ({ params, headers, set }) => {
        const address = headers['x-wallet-address']
        if (!address) {
          set.status = 401
          return { error: 'Wallet address required' }
        }

        const client = await getSQLitClient()
        const result = await client.query<EmailRow>(
          'SELECT * FROM email_messages WHERE message_id = ? AND owner_address = ?',
          [params.messageId, address.toLowerCase()],
          SQLIT_DATABASE_ID,
        )

        if (!result.rows[0]) {
          set.status = 404
          return { error: 'Message not found' }
        }

        return rowToEmail(result.rows[0])
      })

      // Mark email as read/unread
      .patch(
        '/message/:messageId/flags',
        async ({ params, body, headers, set }) => {
          const address = headers['x-wallet-address']
          if (!address) {
            set.status = 401
            return { error: 'Wallet address required' }
          }

          const client = await getSQLitClient()

          // Check if message exists
          const existing = await client.query<EmailRow>(
            'SELECT message_id FROM email_messages WHERE message_id = ? AND owner_address = ?',
            [params.messageId, address.toLowerCase()],
            SQLIT_DATABASE_ID,
          )

          if (!existing.rows[0]) {
            set.status = 404
            return { error: 'Message not found' }
          }

          const { flags } = expectValid(
            UpdateFlagsBodySchema,
            body,
            'Update flags request',
          )

          // Build update query
          const updates: string[] = []
          const values: (number | string)[] = []

          if (flags.read !== undefined) {
            updates.push('flag_read = ?')
            values.push(flags.read ? 1 : 0)
          }
          if (flags.starred !== undefined) {
            updates.push('flag_starred = ?')
            values.push(flags.starred ? 1 : 0)
          }
          if (flags.important !== undefined) {
            updates.push('flag_important = ?')
            values.push(flags.important ? 1 : 0)
          }
          if (flags.answered !== undefined) {
            updates.push('flag_answered = ?')
            values.push(flags.answered ? 1 : 0)
          }
          if (flags.forwarded !== undefined) {
            updates.push('flag_forwarded = ?')
            values.push(flags.forwarded ? 1 : 0)
          }
          if (flags.deleted !== undefined) {
            updates.push('flag_deleted = ?')
            values.push(flags.deleted ? 1 : 0)
          }
          if (flags.spam !== undefined) {
            updates.push('flag_spam = ?')
            values.push(flags.spam ? 1 : 0)
          }

          if (updates.length > 0) {
            values.push(params.messageId, address.toLowerCase())
            await client.exec(
              `UPDATE email_messages SET ${updates.join(', ')} WHERE message_id = ? AND owner_address = ?`,
              values,
              SQLIT_DATABASE_ID,
            )
          }

          return { success: true, flags }
        },
        {
          body: t.Object({
            flags: t.Partial(
              t.Object({
                read: t.Boolean(),
                starred: t.Boolean(),
                important: t.Boolean(),
                answered: t.Boolean(),
                forwarded: t.Boolean(),
                deleted: t.Boolean(),
                spam: t.Boolean(),
              }),
            ),
          }),
        },
      )

      // Move email to folder
      .post(
        '/message/:messageId/move',
        async ({ params, body, headers, set }) => {
          const address = headers['x-wallet-address']
          if (!address) {
            set.status = 401
            return { error: 'Wallet address required' }
          }

          const client = await getSQLitClient()

          // Check if message exists
          const existing = await client.query<EmailRow>(
            'SELECT message_id FROM email_messages WHERE message_id = ? AND owner_address = ?',
            [params.messageId, address.toLowerCase()],
            SQLIT_DATABASE_ID,
          )

          if (!existing.rows[0]) {
            set.status = 404
            return { error: 'Message not found' }
          }

          const { folder } = expectValid(
            MoveEmailBodySchema,
            body,
            'Move email request',
          )

          await client.exec(
            'UPDATE email_messages SET folder = ? WHERE message_id = ? AND owner_address = ?',
            [folder, params.messageId, address.toLowerCase()],
            SQLIT_DATABASE_ID,
          )

          return { success: true, folder }
        },
        {
          body: t.Object({
            folder: t.String(),
          }),
        },
      )

      // Delete email permanently
      .delete('/message/:messageId', async ({ params, headers, set }) => {
        const address = headers['x-wallet-address']
        if (!address) {
          set.status = 401
          return { error: 'Wallet address required' }
        }

        const client = await getSQLitClient()

        // Get email for size calculation
        const existing = await client.query<EmailRow>(
          'SELECT * FROM email_messages WHERE message_id = ? AND owner_address = ?',
          [params.messageId, address.toLowerCase()],
          SQLIT_DATABASE_ID,
        )

        if (!existing.rows[0]) {
          set.status = 404
          return { error: 'Message not found' }
        }

        const emailSize = calculateEmailSize(rowToEmail(existing.rows[0]))

        // Delete message
        await client.exec(
          'DELETE FROM email_messages WHERE message_id = ? AND owner_address = ?',
          [params.messageId, address.toLowerCase()],
          SQLIT_DATABASE_ID,
        )

        // Update quota
        await client.exec(
          'UPDATE email_mailboxes SET quota_used_bytes = MAX(0, quota_used_bytes - ?) WHERE address = ?',
          [emailSize, address.toLowerCase()],
          SQLIT_DATABASE_ID,
        )

        return { success: true, deleted: params.messageId }
      })
  )
}
