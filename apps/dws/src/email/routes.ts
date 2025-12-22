import { Hono } from 'hono'
import {
  type Address,
  createPublicClient,
  type Hex,
  http,
  isAddress,
  parseAbiItem,
} from 'viem'
import { z } from 'zod'
import { expectValid, validateQuery } from '../shared/validation'
import { emailsSentTotal, getMetrics, mailboxOperationsTotal } from './metrics'
import { getEmailRelayService } from './relay'
import { getMailboxStorage } from './storage'
import type {
  EmailFlags,
  EmailTier,
  FilterRule,
  GetEmailResponse,
  Mailbox,
  SearchEmailsRequest,
  SearchEmailsResponse,
  SendEmailRequest,
} from './types'

// Serialized mailbox with bigint fields converted to strings
interface SerializedMailbox
  extends Omit<Mailbox, 'quotaUsedBytes' | 'quotaLimitBytes'> {
  quotaUsedBytes: string
  quotaLimitBytes: string
}

function serializeMailbox(mailbox: Mailbox): SerializedMailbox {
  return {
    ...mailbox,
    quotaUsedBytes: mailbox.quotaUsedBytes.toString(),
    quotaLimitBytes: mailbox.quotaLimitBytes.toString(),
  }
}

function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}

const EMAIL_REGISTRY_ABI = [
  parseAbiItem(
    'function getAccount(address owner) view returns (address owner_, bytes32 publicKeyHash, bytes32 jnsNode, uint8 status, uint8 tier, uint256 stakedAmount, uint256 quotaUsedBytes, uint256 quotaLimitBytes, uint256 emailsSentToday, uint256 lastResetTimestamp, uint256 createdAt, uint256 lastActivityAt)',
  ),
] as const

const userCache = new Map<
  Address,
  { email: string; tier: EmailTier; expiresAt: number }
>()
const CACHE_TTL = 5 * 60 * 1000

const sendEmailSchema = z.object({
  from: z.string().email(),
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  subject: z.string(),
  bodyText: z.string(),
  bodyHtml: z.string().optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string(),
        content: z.string(), // Base64
        mimeType: z.string(),
      }),
    )
    .optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  replyTo: z.string().email().optional(),
  inReplyTo: z.string().optional(),
})

const updateFlagsSchema = z.object({
  read: z.boolean().optional(),
  starred: z.boolean().optional(),
  important: z.boolean().optional(),
  answered: z.boolean().optional(),
  forwarded: z.boolean().optional(),
  deleted: z.boolean().optional(),
  spam: z.boolean().optional(),
})

const moveEmailSchema = z.object({
  targetFolder: z.string(),
})

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
})

const filterRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  conditions: z.array(
    z.object({
      field: z.enum(['from', 'to', 'subject', 'body', 'header']),
      operator: z.enum([
        'contains',
        'equals',
        'startsWith',
        'endsWith',
        'regex',
      ]),
      value: z.string(),
    }),
  ),
  actions: z.array(
    z.object({
      type: z.enum(['move', 'label', 'star', 'markRead', 'forward', 'delete']),
      value: z.string().optional(),
    }),
  ),
  enabled: z.boolean(),
})

// Schemas for request bodies that were previously using type assertions
const folderNameSchema = z.object({
  name: z.string().min(1).max(255),
})

const accountDeleteSchema = z.object({
  confirm: z.literal(true),
})

const folderQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
})

async function getAuthenticatedUser(c: {
  req: { header: (name: string) => string | undefined }
}): Promise<{
  address: Address
  email: string
  tier: EmailTier
} | null> {
  const addressHeader = c.req.header('x-wallet-address')
  if (!addressHeader) return null

  if (!isAddress(addressHeader)) {
    console.warn(`[EmailRoutes] Invalid address format: ${addressHeader}`)
    return null
  }

  const address = addressHeader as Address
  const cached = userCache.get(address)
  if (cached && cached.expiresAt > Date.now()) {
    return {
      address,
      email: cached.email,
      tier: cached.tier,
    }
  }

  const rpcUrl = process.env.JEJU_RPC_URL ?? 'http://localhost:8545'
  const registryAddress = process.env.EMAIL_REGISTRY_ADDRESS as
    | Address
    | undefined

  let tier: EmailTier = 'free'
  const email = `${address.slice(0, 8).toLowerCase()}@jeju.mail`

  if (registryAddress) {
    const publicClient = createPublicClient({ transport: http(rpcUrl) })

    const account = await publicClient
      .readContract({
        address: registryAddress,
        abi: EMAIL_REGISTRY_ABI,
        functionName: 'getAccount',
        args: [address],
      })
      .catch((e: Error) => {
        console.debug(
          `[EmailRoutes] Failed to fetch account for ${address}: ${e.message}`,
        )
        return null
      })

    if (account) {
      const status = account[3]
      if (status === 2 || status === 3) {
        console.warn(
          `[EmailRoutes] Account ${address} is suspended/banned (status: ${status})`,
        )
        return null
      }

      const tierValue = account[4]
      tier = tierValue === 2 ? 'premium' : tierValue === 1 ? 'staked' : 'free'
    }
  }

  userCache.set(address, {
    email,
    tier,
    expiresAt: Date.now() + CACHE_TTL,
  })

  return { address, email, tier }
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  return expectValid(schema, body, 'Request body')
}

export function createEmailRouter(): Hono {
  const app = new Hono()

  app.get('/health', (c) => {
    return c.json({ status: 'ok', service: 'email' })
  })

  app.get('/metrics', async (c) => {
    const metrics = await getMetrics()
    c.header('Content-Type', 'text/plain')
    return c.body(metrics)
  })

  app.post('/send', async (c) => {
    const user = await getAuthenticatedUser(c)
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const body = await c.req.json()
    const request = parseBody(sendEmailSchema, body) as SendEmailRequest

    const relay = getEmailRelayService()
    const response = await relay.sendEmail(request, user.address, user.tier)

    emailsSentTotal.inc({
      tier: user.tier,
      status: response.success ? 'success' : 'failure',
      external: request.to.some((t) => !t.endsWith('@jeju.mail'))
        ? 'true'
        : 'false',
    })

    return c.json(response, response.success ? 200 : 400)
  })

  app.get('/mailbox', async (c) => {
    const user = await getAuthenticatedUser(c)
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const storage = getMailboxStorage()
    let mailbox = await storage.getMailbox(user.address)

    if (!mailbox) {
      mailbox = await storage.initializeMailbox(user.address)
      mailboxOperationsTotal.inc({ operation: 'initialize', status: 'success' })
    }

    const index = await storage.getIndex(user.address)
    if (!index) {
      mailboxOperationsTotal.inc({ operation: 'get_index', status: 'failure' })
      return c.json({ error: 'Failed to load mailbox' }, 500)
    }

    mailboxOperationsTotal.inc({ operation: 'get_mailbox', status: 'success' })
    const unreadCount = index.inbox.filter((e) => !e.flags.read).length

    return c.json({
      mailbox: serializeMailbox(mailbox),
      index,
      unreadCount,
    })
  })

  app.get('/mailbox/:folder', async (c) => {
    const user = await getAuthenticatedUser(c)
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const folder = c.req.param('folder')
    const { limit, offset } = validateQuery(folderQuerySchema, c)

    const storage = getMailboxStorage()
    const index = await storage.getIndex(user.address)

    if (!index) {
      return c.json({ error: 'Mailbox not found' }, 404)
    }

    let emails: typeof index.inbox

    if (folder in index) {
      emails = index[folder as keyof typeof index] as typeof index.inbox
    } else if (index.folders[folder]) {
      emails = index.folders[folder]
    } else {
      return c.json({ error: 'Folder not found' }, 404)
    }

    const total = emails.length
    const results = emails.slice(offset, offset + limit)

    return c.json({
      folder,
      emails: results,
      total,
      hasMore: offset + limit < total,
    })
  })

  app.get('/email/:messageId', async (c) => {
    const user = await getAuthenticatedUser(c)
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const messageId = c.req.param('messageId') as Hex

    const storage = getMailboxStorage()
    const email = await storage.getEmail(user.address, messageId)

    if (!email) {
      return c.json({ error: 'Email not found' }, 404)
    }

    await storage.updateFlags(user.address, messageId, { read: true })

    const index = await storage.getIndex(user.address)
    const allEmails = index
      ? [
          ...index.inbox,
          ...index.sent,
          ...index.drafts,
          ...index.trash,
          ...index.spam,
          ...index.archive,
          ...Object.values(index.folders).flat(),
        ]
      : []

    const reference = allEmails.find((e) => e.messageId === messageId)

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
    }

    return c.json(response)
  })

  app.patch('/email/:messageId/flags', async (c) => {
    const user = await getAuthenticatedUser(c)
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const messageId = c.req.param('messageId') as Hex
    const body = await c.req.json()
    const flags = parseBody(updateFlagsSchema, body) as Partial<EmailFlags>

    const storage = getMailboxStorage()
    await storage.updateFlags(user.address, messageId, flags)

    return c.json({ success: true })
  })

  app.post('/email/:messageId/move', async (c) => {
    const user = await getAuthenticatedUser(c)
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const messageId = c.req.param('messageId') as Hex
    const body = await c.req.json()
    const { targetFolder } = parseBody(moveEmailSchema, body)

    const storage = getMailboxStorage()
    await storage.moveToFolder(user.address, messageId, targetFolder)

    return c.json({ success: true })
  })

  app.delete('/email/:messageId', async (c) => {
    const user = await getAuthenticatedUser(c)
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const messageId = c.req.param('messageId') as Hex
    const permanent = c.req.query('permanent') === 'true'

    const storage = getMailboxStorage()

    if (permanent) {
      await storage.deleteEmail(user.address, messageId)
    } else {
      await storage.moveToFolder(user.address, messageId, 'trash')
    }

    return c.json({ success: true })
  })

  app.post('/search', async (c) => {
    const user = await getAuthenticatedUser(c)
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const body = await c.req.json()
    const request = parseBody(searchEmailsSchema, body) as SearchEmailsRequest

    const storage = getMailboxStorage()
    const result = await storage.searchEmails(user.address, request.query, {
      folder: request.folder,
      from: request.from,
      to: request.to,
      dateFrom: request.dateFrom,
      dateTo: request.dateTo,
      hasAttachment: request.hasAttachment,
      limit: request.limit,
      offset: request.offset,
    })

    const response: SearchEmailsResponse = {
      results: result.results,
      total: result.total,
      hasMore: (request.offset ?? 0) + result.results.length < result.total,
    }

    return c.json(response)
  })

  app.post('/folders', async (c) => {
    const user = await getAuthenticatedUser(c)
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const body = await c.req.json()
    const { name } = parseBody(folderNameSchema, body)

    const storage = getMailboxStorage()
    const index = await storage.getIndex(user.address)

    if (!index) {
      return c.json({ error: 'Mailbox not found' }, 404)
    }

    if (index.folders[name]) {
      return c.json({ error: 'Folder already exists' }, 400)
    }

    index.folders[name] = []
    await storage.saveIndex(user.address, index)

    return c.json({ success: true, folder: name })
  })

  app.delete('/folders/:name', async (c) => {
    const user = await getAuthenticatedUser(c)
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const name = c.req.param('name')

    const storage = getMailboxStorage()
    const index = await storage.getIndex(user.address)

    if (!index) {
      return c.json({ error: 'Mailbox not found' }, 404)
    }

    if (!index.folders[name]) {
      return c.json({ error: 'Folder not found' }, 404)
    }

    index.inbox.push(...index.folders[name])
    Reflect.deleteProperty(index.folders, name)

    await storage.saveIndex(user.address, index)

    return c.json({ success: true })
  })

  app.get('/rules', async (c) => {
    const user = await getAuthenticatedUser(c)
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const storage = getMailboxStorage()
    const index = await storage.getIndex(user.address)

    if (!index) {
      return c.json({ error: 'Mailbox not found' }, 404)
    }

    return c.json({ rules: index.rules })
  })

  app.post('/rules', async (c) => {
    const user = await getAuthenticatedUser(c)
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const body = await c.req.json()
    const rule = parseBody(filterRuleSchema, body) as FilterRule

    const storage = getMailboxStorage()
    await storage.addFilterRule(user.address, rule)

    return c.json({ success: true, rule })
  })

  app.delete('/rules/:ruleId', async (c) => {
    const user = await getAuthenticatedUser(c)
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const ruleId = c.req.param('ruleId')

    const storage = getMailboxStorage()
    await storage.removeFilterRule(user.address, ruleId)

    return c.json({ success: true })
  })

  app.get('/export', async (c) => {
    const user = await getAuthenticatedUser(c)
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const storage = getMailboxStorage()
    const data = await storage.exportUserData(user.address)

    c.header('Content-Type', 'application/json')
    c.header(
      'Content-Disposition',
      `attachment; filename="jeju-mail-export-${Date.now()}.json"`,
    )

    return c.body(JSON.stringify(data, bigIntReplacer, 2))
  })

  app.delete('/account', async (c) => {
    const user = await getAuthenticatedUser(c)
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const body = await c.req.json()
    parseBody(accountDeleteSchema, body) // Validates confirm: true is present

    const storage = getMailboxStorage()
    await storage.deleteAllUserData(user.address)

    return c.json({
      success: true,
      message: 'All email data has been permanently deleted',
    })
  })

  app.get('/status/:messageId', async (c) => {
    const user = await getAuthenticatedUser(c)
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const messageId = c.req.param('messageId') as Hex

    const relay = getEmailRelayService()
    const status = relay.getDeliveryStatus(messageId)

    if (!status) {
      return c.json({ error: 'Message not found' }, 404)
    }

    return c.json({ messageId, status })
  })

  return app
}
