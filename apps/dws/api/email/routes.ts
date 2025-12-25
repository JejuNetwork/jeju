/**
 * Email Routes
 * Decentralized email service for DWS
 *
 * DEVELOPMENT ONLY: Uses in-memory storage that is NOT persistent.
 * For production, this module needs to be integrated with CQL/IPFS.
 */

import { createHash } from 'node:crypto'

// Warn about in-memory storage at module load
if (process.env.NODE_ENV === 'production') {
  console.warn(
    '[Email Routes] WARNING: Running in production with in-memory storage. Emails will be lost on restart.',
  )
}
import { expectValid } from '@jejunetwork/types'
import { Elysia, t } from 'elysia'
import { z } from 'zod'

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

interface Mailbox {
  inbox: EmailIndexEntry[]
  sent: EmailIndexEntry[]
  drafts: EmailIndexEntry[]
  trash: EmailIndexEntry[]
  spam: EmailIndexEntry[]
  archive: EmailIndexEntry[]
  folders: Record<string, EmailIndexEntry[]>
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

interface UserMailbox {
  mailbox: Mailbox
  emails: Map<string, Email>
  quotaUsedBytes: number
  quotaLimitBytes: number
}

// In-memory storage (per wallet address)
const mailboxes = new Map<string, UserMailbox>()

function getOrCreateMailbox(address: string): UserMailbox {
  const normalized = address.toLowerCase()
  let mailbox = mailboxes.get(normalized)
  if (!mailbox) {
    mailbox = {
      mailbox: {
        inbox: [],
        sent: [],
        drafts: [],
        trash: [],
        spam: [],
        archive: [],
        folders: {},
      },
      emails: new Map(),
      quotaUsedBytes: 0,
      quotaLimitBytes: 100 * 1024 * 1024, // 100MB default quota
    }
    mailboxes.set(normalized, mailbox)
  }
  return mailbox
}

function generateMessageId(
  from: string,
  to: string[],
  timestamp: number,
): string {
  const data = `${from}:${to.join(',')}:${timestamp}:${Math.random()}`
  return createHash('sha256').update(data).digest('hex').slice(0, 32)
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
      .get('/health', () => ({
        status: 'healthy' as const,
        service: 'email',
        activeMailboxes: mailboxes.size,
      }))

      // Get mailbox overview
      .get('/mailbox', ({ headers, set }) => {
        const address = headers['x-wallet-address']
        if (!address) {
          set.status = 401
          return { error: 'Wallet address required' }
        }

        const userMailbox = getOrCreateMailbox(address)
        const unreadCount = userMailbox.mailbox.inbox.filter(
          (e) => !e.flags.read,
        ).length

        return {
          mailbox: {
            quotaUsedBytes: String(userMailbox.quotaUsedBytes),
            quotaLimitBytes: String(userMailbox.quotaLimitBytes),
          },
          index: {
            inbox: userMailbox.mailbox.inbox,
            sent: userMailbox.mailbox.sent,
            drafts: userMailbox.mailbox.drafts,
            trash: userMailbox.mailbox.trash,
            spam: userMailbox.mailbox.spam,
            archive: userMailbox.mailbox.archive,
            folders: userMailbox.mailbox.folders,
          },
          unreadCount,
        }
      })

      // Send email
      .post(
        '/send',
        ({ body, headers, set }) => {
          const address = headers['x-wallet-address']
          if (!address) {
            set.status = 401
            return { error: 'Wallet address required' }
          }

          const { from, to, subject, bodyText, bodyHtml, cc, bcc, replyTo } =
            expectValid(SendEmailBodySchema, body, 'Send email request')

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

          // Store in sender's sent folder
          const senderMailbox = getOrCreateMailbox(address)
          const emailSize = calculateEmailSize(email)

          if (
            senderMailbox.quotaUsedBytes + emailSize >
            senderMailbox.quotaLimitBytes
          ) {
            set.status = 507
            return { error: 'Mailbox quota exceeded' }
          }

          senderMailbox.emails.set(messageId, email)
          senderMailbox.mailbox.sent.unshift({
            messageId,
            from,
            to: to.join(', '),
            subject,
            snippet: email.snippet,
            sentAt: timestamp,
            receivedAt: timestamp,
            flags: email.flags,
          })
          senderMailbox.quotaUsedBytes += emailSize

          // Deliver to recipients (if they have mailboxes on this system)
          for (const recipient of to) {
            // Extract address from email format (e.g., "0xabc...@jeju.mail" -> "0xabc...")
            const recipientAddress = recipient.split('@')[0]
            if (recipientAddress.startsWith('0x')) {
              const recipientMailbox = getOrCreateMailbox(recipientAddress)
              const recipientEmail: Email = {
                ...email,
                flags: {
                  ...email.flags,
                  read: false, // Unread for recipient
                },
              }
              recipientMailbox.emails.set(messageId, recipientEmail)
              recipientMailbox.mailbox.inbox.unshift({
                messageId,
                from,
                to: to.join(', '),
                subject,
                snippet: email.snippet,
                receivedAt: timestamp,
                flags: recipientEmail.flags,
              })
              recipientMailbox.quotaUsedBytes += emailSize
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
      .get('/message/:messageId', ({ params, headers, set }) => {
        const address = headers['x-wallet-address']
        if (!address) {
          set.status = 401
          return { error: 'Wallet address required' }
        }

        const userMailbox = getOrCreateMailbox(address)
        const email = userMailbox.emails.get(params.messageId)

        if (!email) {
          set.status = 404
          return { error: 'Message not found' }
        }

        return email
      })

      // Mark email as read/unread
      .patch(
        '/message/:messageId/flags',
        ({ params, body, headers, set }) => {
          const address = headers['x-wallet-address']
          if (!address) {
            set.status = 401
            return { error: 'Wallet address required' }
          }

          const userMailbox = getOrCreateMailbox(address)
          const email = userMailbox.emails.get(params.messageId)

          if (!email) {
            set.status = 404
            return { error: 'Message not found' }
          }

          const { flags } = expectValid(
            UpdateFlagsBodySchema,
            body,
            'Update flags request',
          )
          Object.assign(email.flags, flags)

          // Update in index as well
          const updateIndex = (entries: EmailIndexEntry[]) => {
            const entry = entries.find((e) => e.messageId === params.messageId)
            if (entry) Object.assign(entry.flags, flags)
          }

          updateIndex(userMailbox.mailbox.inbox)
          updateIndex(userMailbox.mailbox.sent)
          updateIndex(userMailbox.mailbox.drafts)
          updateIndex(userMailbox.mailbox.trash)
          updateIndex(userMailbox.mailbox.spam)
          updateIndex(userMailbox.mailbox.archive)

          return { success: true, flags: email.flags }
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
        ({ params, body, headers, set }) => {
          const address = headers['x-wallet-address']
          if (!address) {
            set.status = 401
            return { error: 'Wallet address required' }
          }

          const userMailbox = getOrCreateMailbox(address)
          const email = userMailbox.emails.get(params.messageId)

          if (!email) {
            set.status = 404
            return { error: 'Message not found' }
          }

          const { folder } = expectValid(
            MoveEmailBodySchema,
            body,
            'Move email request',
          )

          // Remove from all folders
          const removeFromFolder = (entries: EmailIndexEntry[]) => {
            const idx = entries.findIndex(
              (e) => e.messageId === params.messageId,
            )
            if (idx >= 0) entries.splice(idx, 1)
          }

          removeFromFolder(userMailbox.mailbox.inbox)
          removeFromFolder(userMailbox.mailbox.sent)
          removeFromFolder(userMailbox.mailbox.drafts)
          removeFromFolder(userMailbox.mailbox.trash)
          removeFromFolder(userMailbox.mailbox.spam)
          removeFromFolder(userMailbox.mailbox.archive)
          for (const f of Object.values(userMailbox.mailbox.folders)) {
            removeFromFolder(f)
          }

          // Add to target folder
          const entry: EmailIndexEntry = {
            messageId: email.messageId,
            from: email.from,
            to: email.to,
            subject: email.subject,
            snippet: email.snippet,
            receivedAt: email.receivedAt,
            sentAt: email.sentAt,
            flags: email.flags,
          }

          const standardFolders = [
            'inbox',
            'sent',
            'drafts',
            'trash',
            'spam',
            'archive',
          ] as const
          type StandardFolder = (typeof standardFolders)[number]

          if (standardFolders.includes(folder as StandardFolder)) {
            userMailbox.mailbox[folder as StandardFolder].unshift(entry)
          } else {
            if (!userMailbox.mailbox.folders[folder]) {
              userMailbox.mailbox.folders[folder] = []
            }
            userMailbox.mailbox.folders[folder].unshift(entry)
          }

          return { success: true, folder }
        },
        {
          body: t.Object({
            folder: t.String(),
          }),
        },
      )

      // Delete email permanently
      .delete('/message/:messageId', ({ params, headers, set }) => {
        const address = headers['x-wallet-address']
        if (!address) {
          set.status = 401
          return { error: 'Wallet address required' }
        }

        const userMailbox = getOrCreateMailbox(address)
        const email = userMailbox.emails.get(params.messageId)

        if (!email) {
          set.status = 404
          return { error: 'Message not found' }
        }

        const emailSize = calculateEmailSize(email)
        userMailbox.quotaUsedBytes -= emailSize
        userMailbox.emails.delete(params.messageId)

        // Remove from all folders
        const removeFromFolder = (entries: EmailIndexEntry[]) => {
          const idx = entries.findIndex((e) => e.messageId === params.messageId)
          if (idx >= 0) entries.splice(idx, 1)
        }

        removeFromFolder(userMailbox.mailbox.inbox)
        removeFromFolder(userMailbox.mailbox.sent)
        removeFromFolder(userMailbox.mailbox.drafts)
        removeFromFolder(userMailbox.mailbox.trash)
        removeFromFolder(userMailbox.mailbox.spam)
        removeFromFolder(userMailbox.mailbox.archive)
        for (const f of Object.values(userMailbox.mailbox.folders)) {
          removeFromFolder(f)
        }

        return { success: true, deleted: params.messageId }
      })
  )
}
