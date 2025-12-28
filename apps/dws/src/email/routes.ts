import {
  getCurrentNetwork,
  getRpcUrl,
  tryGetContract,
} from '@jejunetwork/config'
import { expectValid } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import {
  type Address,
  createPublicClient,
  type Hex,
  http,
  isAddress,
  parseAbiItem,
} from 'viem'
import { z } from 'zod'
import { validateQueryFromObj } from '../../api/shared/validation'
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

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
type JsonReplacerValue = JsonValue | bigint | undefined

function bigIntReplacer(
  _key: string,
  value: JsonReplacerValue,
): JsonValue | undefined {
  return typeof value === 'bigint'
    ? value.toString()
    : (value as JsonValue | undefined)
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

async function getAuthenticatedUser(request: Request): Promise<{
  address: Address
  email: string
  tier: EmailTier
} | null> {
  const addressHeader = request.headers.get('x-wallet-address')
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

  const network = getCurrentNetwork()
  const rpcUrl = getRpcUrl(network)
  // Email registry contract is configured via env var (not in contracts config yet)
  const registryAddress = (typeof process !== 'undefined' ? process.env.EMAIL_REGISTRY_ADDRESS : undefined) as
    | Address
    | undefined ?? tryGetContract('dws', 'emailRegistry', network) as Address | undefined

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

export function createEmailRouter() {
  return new Elysia({ name: 'email', prefix: '/email' })
    .get('/health', () => {
      return { status: 'ok', service: 'email' }
    })

    .get('/metrics', async ({ set }) => {
      const metrics = await getMetrics()
      set.headers['Content-Type'] = 'text/plain'
      return metrics
    })

    .post('/send', async ({ body, request, set }) => {
      const user = await getAuthenticatedUser(request)
      if (!user) {
        set.status = 401
        return { error: 'Unauthorized' }
      }

      const emailRequest = parseBody(sendEmailSchema, body) as SendEmailRequest

      const relay = getEmailRelayService()
      const response = await relay.sendEmail(
        emailRequest,
        user.address,
        user.tier,
      )

      emailsSentTotal.inc({
        tier: user.tier,
        status: response.success ? 'success' : 'failure',
        external: emailRequest.to.some(
          (toAddr) => !toAddr.endsWith('@jeju.mail'),
        )
          ? 'true'
          : 'false',
      })

      set.status = response.success ? 200 : 400
      return response
    })

    .get('/mailbox', async ({ request, set }) => {
      const user = await getAuthenticatedUser(request)
      if (!user) {
        set.status = 401
        return { error: 'Unauthorized' }
      }

      const storage = getMailboxStorage()
      let mailbox = await storage.getMailbox(user.address)

      if (!mailbox) {
        mailbox = await storage.initializeMailbox(user.address)
        mailboxOperationsTotal.inc({
          operation: 'initialize',
          status: 'success',
        })
      }

      const index = await storage.getIndex(user.address)
      if (!index) {
        mailboxOperationsTotal.inc({
          operation: 'get_index',
          status: 'failure',
        })
        set.status = 500
        return { error: 'Failed to load mailbox' }
      }

      mailboxOperationsTotal.inc({
        operation: 'get_mailbox',
        status: 'success',
      })
      const unreadCount = index.inbox.filter((e) => !e.flags.read).length

      return {
        mailbox: serializeMailbox(mailbox),
        index,
        unreadCount,
      }
    })

    .get('/mailbox/:folder', async ({ params, query, request, set }) => {
      const user = await getAuthenticatedUser(request)
      if (!user) {
        set.status = 401
        return { error: 'Unauthorized' }
      }

      const folder = params.folder
      const { limit, offset } = validateQueryFromObj(folderQuerySchema, query)

      const storage = getMailboxStorage()
      const index = await storage.getIndex(user.address)

      if (!index) {
        set.status = 404
        return { error: 'Mailbox not found' }
      }

      let emails: typeof index.inbox

      if (folder in index) {
        emails = index[folder as keyof typeof index] as typeof index.inbox
      } else if (index.folders[folder]) {
        emails = index.folders[folder]
      } else {
        set.status = 404
        return { error: 'Folder not found' }
      }

      const total = emails.length
      const results = emails.slice(offset, offset + limit)

      return {
        folder,
        emails: results,
        total,
        hasMore: offset + limit < total,
      }
    })

    .get('/email/:messageId', async ({ params, request, set }) => {
      const user = await getAuthenticatedUser(request)
      if (!user) {
        set.status = 401
        return { error: 'Unauthorized' }
      }

      const messageId = params.messageId as Hex

      const storage = getMailboxStorage()
      const email = await storage.getEmail(user.address, messageId)

      if (!email) {
        set.status = 404
        return { error: 'Email not found' }
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

      return response
    })

    .patch(
      '/email/:messageId/flags',
      async ({ params, body, request, set }) => {
        const user = await getAuthenticatedUser(request)
        if (!user) {
          set.status = 401
          return { error: 'Unauthorized' }
        }

        const messageId = params.messageId as Hex
        const flags = parseBody(updateFlagsSchema, body) as Partial<EmailFlags>

        const storage = getMailboxStorage()
        await storage.updateFlags(user.address, messageId, flags)

        return { success: true }
      },
    )

    .post('/email/:messageId/move', async ({ params, body, request, set }) => {
      const user = await getAuthenticatedUser(request)
      if (!user) {
        set.status = 401
        return { error: 'Unauthorized' }
      }

      const messageId = params.messageId as Hex
      const { targetFolder } = parseBody(moveEmailSchema, body)

      const storage = getMailboxStorage()
      await storage.moveToFolder(user.address, messageId, targetFolder)

      return { success: true }
    })

    .delete('/email/:messageId', async ({ params, query, request, set }) => {
      const user = await getAuthenticatedUser(request)
      if (!user) {
        set.status = 401
        return { error: 'Unauthorized' }
      }

      const messageId = params.messageId as Hex
      const permanent = query.permanent === 'true'

      const storage = getMailboxStorage()

      if (permanent) {
        await storage.deleteEmail(user.address, messageId)
      } else {
        await storage.moveToFolder(user.address, messageId, 'trash')
      }

      return { success: true }
    })

    .post('/search', async ({ body, request, set }) => {
      const user = await getAuthenticatedUser(request)
      if (!user) {
        set.status = 401
        return { error: 'Unauthorized' }
      }

      const searchRequest = parseBody(
        searchEmailsSchema,
        body,
      ) as SearchEmailsRequest

      const storage = getMailboxStorage()
      const result = await storage.searchEmails(
        user.address,
        searchRequest.query,
        {
          folder: searchRequest.folder,
          from: searchRequest.from,
          to: searchRequest.to,
          dateFrom: searchRequest.dateFrom,
          dateTo: searchRequest.dateTo,
          hasAttachment: searchRequest.hasAttachment,
          limit: searchRequest.limit,
          offset: searchRequest.offset,
        },
      )

      const response: SearchEmailsResponse = {
        results: result.results,
        total: result.total,
        hasMore:
          (searchRequest.offset ?? 0) + result.results.length < result.total,
      }

      return response
    })

    .post('/folders', async ({ body, request, set }) => {
      const user = await getAuthenticatedUser(request)
      if (!user) {
        set.status = 401
        return { error: 'Unauthorized' }
      }

      const { name } = parseBody(folderNameSchema, body)

      const storage = getMailboxStorage()
      const index = await storage.getIndex(user.address)

      if (!index) {
        set.status = 404
        return { error: 'Mailbox not found' }
      }

      if (index.folders[name]) {
        set.status = 400
        return { error: 'Folder already exists' }
      }

      index.folders[name] = []
      await storage.saveIndex(user.address, index)

      return { success: true, folder: name }
    })

    .delete('/folders/:name', async ({ params, request, set }) => {
      const user = await getAuthenticatedUser(request)
      if (!user) {
        set.status = 401
        return { error: 'Unauthorized' }
      }

      const name = params.name

      const storage = getMailboxStorage()
      const index = await storage.getIndex(user.address)

      if (!index) {
        set.status = 404
        return { error: 'Mailbox not found' }
      }

      if (!index.folders[name]) {
        set.status = 404
        return { error: 'Folder not found' }
      }

      index.inbox.push(...index.folders[name])
      delete index.folders[name]

      await storage.saveIndex(user.address, index)

      return { success: true }
    })

    .get('/rules', async ({ request, set }) => {
      const user = await getAuthenticatedUser(request)
      if (!user) {
        set.status = 401
        return { error: 'Unauthorized' }
      }

      const storage = getMailboxStorage()
      const index = await storage.getIndex(user.address)

      if (!index) {
        set.status = 404
        return { error: 'Mailbox not found' }
      }

      return { rules: index.rules }
    })

    .post('/rules', async ({ body, request, set }) => {
      const user = await getAuthenticatedUser(request)
      if (!user) {
        set.status = 401
        return { error: 'Unauthorized' }
      }

      const rule = parseBody(filterRuleSchema, body) as FilterRule

      const storage = getMailboxStorage()
      await storage.addFilterRule(user.address, rule)

      return { success: true, rule }
    })

    .delete('/rules/:ruleId', async ({ params, request, set }) => {
      const user = await getAuthenticatedUser(request)
      if (!user) {
        set.status = 401
        return { error: 'Unauthorized' }
      }

      const ruleId = params.ruleId

      const storage = getMailboxStorage()
      await storage.removeFilterRule(user.address, ruleId)

      return { success: true }
    })

    .get('/export', async ({ request, set }) => {
      const user = await getAuthenticatedUser(request)
      if (!user) {
        set.status = 401
        return { error: 'Unauthorized' }
      }

      const storage = getMailboxStorage()
      const data = await storage.exportUserData(user.address)

      set.headers['Content-Type'] = 'application/json'
      set.headers['Content-Disposition'] =
        `attachment; filename="jeju-mail-export-${Date.now()}.json"`

      return JSON.stringify(data, bigIntReplacer, 2)
    })

    .delete('/account', async ({ body, request, set }) => {
      const user = await getAuthenticatedUser(request)
      if (!user) {
        set.status = 401
        return { error: 'Unauthorized' }
      }

      parseBody(accountDeleteSchema, body) // Validates confirm: true is present

      const storage = getMailboxStorage()
      await storage.deleteAllUserData(user.address)

      return {
        success: true,
        message: 'All email data has been permanently deleted',
      }
    })

    .get('/status/:messageId', async ({ params, request, set }) => {
      const user = await getAuthenticatedUser(request)
      if (!user) {
        set.status = 401
        return { error: 'Unauthorized' }
      }

      const messageId = params.messageId as Hex

      const relay = getEmailRelayService()
      const status = relay.getDeliveryStatus(messageId)

      if (!status) {
        set.status = 404
        return { error: 'Message not found' }
      }

      return { messageId, status }
    })
}
