import { getIpfsApiUrlEnv } from '@jejunetwork/config'
import { expectJson } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes } from 'viem'
import { z } from 'zod'
import {
  MailboxDataSchema,
  MailboxIndexSchema,
} from '../../api/shared/schemas/internal-storage'
import {
  getMultiBackendManager,
  type MultiBackendManager,
} from '../../api/storage/multi-backend'
import { mailboxOperationsTotal, storageQuotaBytes } from './metrics'
import type {
  EmailContent,
  EmailEnvelope,
  EmailFlags,
  EmailReference,
  FilterRule,
  Mailbox,
  MailboxIndex,
} from './types'

interface StorageBackend {
  upload(
    data: Buffer,
    options?: { permanent?: boolean; tier?: string },
  ): Promise<string>
  download(cid: string): Promise<Buffer>
  delete(cid: string): Promise<void>
}

interface EncryptionService {
  encrypt(data: Buffer, publicKey: Hex): Promise<Buffer>
  decrypt(data: Buffer, privateKey: Hex): Promise<Buffer>
}

/**
 * DWS Storage Adapter
 *
 * LIMITATION: deletedCids is in-memory only and does not persist across restarts.
 * For production, content deletion is enforced at the registry level - if a CID
 * is not referenced in the mailbox registry, it should not be accessible.
 * The deletedCids Set provides additional request-level protection within process lifetime.
 */
class DWSStorageAdapter implements StorageBackend {
  private manager: MultiBackendManager
  private deletedCids: Set<string> = new Set()

  constructor(manager: MultiBackendManager) {
    this.manager = manager
  }

  async upload(
    data: Buffer,
    options?: { permanent?: boolean; tier?: string },
  ): Promise<string> {
    const result = await this.manager.upload(data, {
      tier: options?.tier === 'permanent' ? 'system' : 'private',
      encrypt: true,
      category: 'data',
    })
    return result.cid
  }

  async download(cid: string): Promise<Buffer> {
    if (this.deletedCids.has(cid))
      throw new Error(`CID ${cid} has been deleted`)
    const result = await this.manager.download(cid)
    return result.content
  }

  async delete(cid: string): Promise<void> {
    this.deletedCids.add(cid)
    const ipfsApiUrl = getIpfsApiUrlEnv()
    const response = await fetch(`${ipfsApiUrl}/api/v0/pin/rm?arg=${cid}`, {
      method: 'POST',
    }).catch((e: Error) => {
      console.warn(
        `[MailboxStorage] IPFS unpin failed for ${cid}: ${e.message}`,
      )
      return null
    })
    if (response && !response.ok) {
      console.warn(
        `[MailboxStorage] IPFS unpin returned ${response.status} for ${cid}`,
      )
    }
    console.log(`[MailboxStorage] Marked ${cid} as deleted`)
  }
}

const MAX_CACHE_SIZE = 1000
const DEFAULT_FOLDERS = [
  'inbox',
  'sent',
  'drafts',
  'trash',
  'spam',
  'archive',
] as const

interface CacheEntry<T> {
  value: T
  lastAccessed: number
}

class AddressLock {
  private locks: Map<Address, Promise<void>> = new Map()
  private resolvers: Map<Address, () => void> = new Map()

  async acquire(address: Address): Promise<void> {
    while (this.locks.has(address)) {
      await this.locks.get(address)
    }
    let resolver: (() => void) | undefined
    const promise = new Promise<void>((resolve) => {
      resolver = resolve
    })
    this.locks.set(address, promise)
    if (resolver) this.resolvers.set(address, resolver)
  }

  release(address: Address): void {
    const resolver = this.resolvers.get(address)
    if (resolver) {
      this.locks.delete(address)
      this.resolvers.delete(address)
      resolver()
    }
  }
}

export class MailboxStorage {
  private storageBackend: StorageBackend
  private encryptionService?: EncryptionService
  private mailboxCache: Map<Address, CacheEntry<Mailbox>> = new Map()
  private indexCache: Map<Address, CacheEntry<MailboxIndex>> = new Map()

  private mailboxRegistry: Map<Address, string> = new Map()
  private registryLoaded = false
  private _registryCid: string | null = null
  private addressLock = new AddressLock()

  getRegistryCid(): string | null {
    return this._registryCid
  }

  constructor(
    storageBackend: StorageBackend,
    encryptionService?: EncryptionService,
  ) {
    this.storageBackend = storageBackend
    this.encryptionService = encryptionService
  }

  private deriveOwnerKey(owner: Address): Hex {
    return keccak256(toBytes(`jeju-email-key:${owner.toLowerCase()}`))
  }

  private getAllEmailRefs(index: MailboxIndex): EmailReference[] {
    return [
      ...index.inbox,
      ...index.sent,
      ...index.drafts,
      ...index.trash,
      ...index.spam,
      ...index.archive,
      ...Object.values(index.folders).flat(),
    ]
  }

  private findAndRemoveEmail(
    index: MailboxIndex,
    messageId: Hex,
  ): EmailReference | undefined {
    for (const folder of DEFAULT_FOLDERS) {
      const idx = index[folder].findIndex((e) => e.messageId === messageId)
      if (idx !== -1) return index[folder].splice(idx, 1)[0]
    }
    for (const emails of Object.values(index.folders)) {
      const idx = emails.findIndex((e) => e.messageId === messageId)
      if (idx !== -1) return emails.splice(idx, 1)[0]
    }
    return undefined
  }

  private evictOldestCacheEntries(): void {
    if (this.mailboxCache.size > MAX_CACHE_SIZE) {
      const entries = [...this.mailboxCache.entries()].sort(
        (a, b) => a[1].lastAccessed - b[1].lastAccessed,
      )
      const toRemove = entries.slice(0, entries.length - MAX_CACHE_SIZE)
      for (const [key] of toRemove) {
        this.mailboxCache.delete(key)
        this.indexCache.delete(key)
      }
    }
  }

  private getCachedMailbox(owner: Address): Mailbox | undefined {
    const entry = this.mailboxCache.get(owner)
    if (entry) {
      entry.lastAccessed = Date.now()
      return entry.value
    }
    return undefined
  }

  private setCachedMailbox(owner: Address, mailbox: Mailbox): void {
    this.mailboxCache.set(owner, { value: mailbox, lastAccessed: Date.now() })
    this.evictOldestCacheEntries()
  }

  private getCachedIndex(owner: Address): MailboxIndex | undefined {
    const entry = this.indexCache.get(owner)
    if (entry) {
      entry.lastAccessed = Date.now()
      return entry.value
    }
    return undefined
  }

  private setCachedIndex(owner: Address, index: MailboxIndex): void {
    this.indexCache.set(owner, { value: index, lastAccessed: Date.now() })
  }

  private async loadRegistry(): Promise<void> {
    if (this.registryLoaded) return
    const registryCid = process.env.EMAIL_REGISTRY_CID
    if (registryCid) {
      const data = await this.storageBackend
        .download(registryCid)
        .catch(() => null)
      if (data) {
        this.mailboxRegistry = new Map(
          Object.entries(
            expectJson(
              data.toString(),
              z.record(z.string(), z.string()),
              'email registry',
            ),
          ) as [Address, string][],
        )
      }
    }
    this.registryLoaded = true
  }

  private async saveRegistry(): Promise<void> {
    const cid = await this.storageBackend.upload(
      Buffer.from(JSON.stringify(Object.fromEntries(this.mailboxRegistry))),
      { tier: 'system' },
    )
    this._registryCid = cid
    console.log(`[MailboxStorage] Registry saved: ${cid}`)
    const dwsEndpoint = process.env.DWS_ENDPOINT
    if (dwsEndpoint) {
      await fetch(`${dwsEndpoint}/storage/registry/email`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cid, timestamp: Date.now() }),
      }).catch((e: Error) => {
        console.warn(
          `[MailboxStorage] Failed to persist registry CID: ${e.message}`,
        )
      })
    }
  }

  async initializeMailbox(owner: Address): Promise<Mailbox> {
    const existing = await this.getMailbox(owner)
    if (existing) return existing

    const index: MailboxIndex = {
      inbox: [],
      sent: [],
      drafts: [],
      trash: [],
      spam: [],
      archive: [],
      folders: {},
      rules: [],
    }

    const indexData = Buffer.from(JSON.stringify(index))
    const ownerKey = this.deriveOwnerKey(owner)
    const encryptedIndex = this.encryptionService
      ? await this.encryptionService.encrypt(indexData, ownerKey)
      : indexData

    const indexCid = await this.storageBackend.upload(encryptedIndex, {
      tier: 'private',
    })

    const mailbox: Mailbox = {
      owner,
      encryptedIndexCid: indexCid,
      quotaUsedBytes: BigInt(encryptedIndex.length),
      quotaLimitBytes: BigInt(100 * 1024 * 1024),
      lastUpdated: Date.now(),
      folders: [...DEFAULT_FOLDERS],
    }

    const mailboxData = Buffer.from(
      JSON.stringify({
        ...mailbox,
        quotaUsedBytes: mailbox.quotaUsedBytes.toString(),
        quotaLimitBytes: mailbox.quotaLimitBytes.toString(),
      }),
    )
    const mailboxCid = await this.storageBackend.upload(mailboxData, {
      tier: 'private',
    })

    await this.loadRegistry()
    this.mailboxRegistry.set(owner, mailboxCid)
    await this.saveRegistry()

    this.setCachedMailbox(owner, mailbox)
    this.setCachedIndex(owner, index)

    mailboxOperationsTotal.inc({ operation: 'initialize', status: 'success' })
    storageQuotaBytes.set({ tier: 'default' }, Number(mailbox.quotaUsedBytes))
    return mailbox
  }

  async getMailbox(owner: Address): Promise<Mailbox | null> {
    const cached = this.getCachedMailbox(owner)
    if (cached) return cached

    await this.loadRegistry()
    const mailboxCid = this.mailboxRegistry.get(owner)
    if (!mailboxCid) return null

    const data = await this.storageBackend
      .download(mailboxCid)
      .catch(() => null)
    if (!data) return null

    const parsed = expectJson(
      data.toString(),
      MailboxDataSchema,
      'mailbox data',
    )
    const mailbox: Mailbox = {
      owner: parsed.owner,
      encryptedIndexCid: parsed.encryptedIndexCid,
      quotaUsedBytes: BigInt(parsed.quotaUsedBytes),
      quotaLimitBytes: BigInt(parsed.quotaLimitBytes),
      lastUpdated: parsed.lastUpdated,
      folders: parsed.folders,
    }
    this.setCachedMailbox(owner, mailbox)
    return mailbox
  }

  async getIndex(owner: Address): Promise<MailboxIndex | null> {
    const cached = this.getCachedIndex(owner)
    if (cached) return cached

    const mailbox = await this.getMailbox(owner)
    if (!mailbox) return null

    const encryptedIndex = await this.storageBackend.download(
      mailbox.encryptedIndexCid,
    )
    const ownerKey = this.deriveOwnerKey(owner)
    const indexData = this.encryptionService
      ? await this.encryptionService.decrypt(encryptedIndex, ownerKey)
      : encryptedIndex

    const index = expectJson(
      indexData.toString(),
      MailboxIndexSchema,
      'mailbox index',
    ) as MailboxIndex
    this.setCachedIndex(owner, index)
    return index
  }

  async saveIndex(owner: Address, index: MailboxIndex): Promise<void> {
    const indexData = Buffer.from(JSON.stringify(index))
    const ownerKey = this.deriveOwnerKey(owner)
    const encryptedIndex = this.encryptionService
      ? await this.encryptionService.encrypt(indexData, ownerKey)
      : indexData

    const newCid = await this.storageBackend.upload(encryptedIndex)
    const mailbox = this.getCachedMailbox(owner)
    if (mailbox) {
      await this.storageBackend.delete(mailbox.encryptedIndexCid)
      mailbox.encryptedIndexCid = newCid
      mailbox.lastUpdated = Date.now()
    }
    this.setCachedIndex(owner, index)
  }

  async saveMailbox(owner: Address, mailbox: Mailbox): Promise<void> {
    const mailboxData = Buffer.from(
      JSON.stringify({
        ...mailbox,
        quotaUsedBytes: mailbox.quotaUsedBytes.toString(),
        quotaLimitBytes: mailbox.quotaLimitBytes.toString(),
      }),
    )
    const newCid = await this.storageBackend.upload(mailboxData, {
      tier: 'private',
    })

    await this.loadRegistry()
    const oldCid = this.mailboxRegistry.get(owner)
    if (oldCid) await this.storageBackend.delete(oldCid)
    this.mailboxRegistry.set(owner, newCid)
    await this.saveRegistry()
    this.setCachedMailbox(owner, mailbox)
  }

  async storeInbound(owner: Address, envelope: EmailEnvelope): Promise<void> {
    await this.addressLock.acquire(owner)
    try {
      let index = await this.getIndex(owner)
      if (!index) {
        await this.initializeMailbox(owner)
        index = await this.getIndex(owner)
        if (!index) throw new Error('Failed to initialize mailbox')
      }

      const contentData = Buffer.from(JSON.stringify(envelope))
      const ownerKey = this.deriveOwnerKey(owner)
      const encryptedContent = this.encryptionService
        ? await this.encryptionService.encrypt(contentData, ownerKey)
        : contentData

      const contentCid = await this.storageBackend.upload(encryptedContent)

      const reference: EmailReference = {
        messageId: envelope.id,
        contentCid,
        from: envelope.from.full,
        to: envelope.to.map((t) => t.full),
        subject: '',
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
      }

      index.inbox.unshift(reference)
      await this.applyFilterRules(owner, index, reference)
      await this.saveIndex(owner, index)

      const mailbox = this.getCachedMailbox(owner)
      if (mailbox) {
        mailbox.quotaUsedBytes += BigInt(contentData.length)
        storageQuotaBytes.set(
          { tier: 'default' },
          Number(mailbox.quotaUsedBytes),
        )
      }
      mailboxOperationsTotal.inc({
        operation: 'store_inbound',
        status: 'success',
      })
    } finally {
      this.addressLock.release(owner)
    }
  }

  async storeOutbound(
    owner: Address,
    envelope: EmailEnvelope,
    content: EmailContent,
  ): Promise<void> {
    await this.addressLock.acquire(owner)
    try {
      let index = await this.getIndex(owner)
      if (!index) {
        await this.initializeMailbox(owner)
        index = await this.getIndex(owner)
        if (!index) throw new Error('Failed to initialize mailbox')
      }

      const contentData = Buffer.from(JSON.stringify({ envelope, content }))
      const ownerKey = this.deriveOwnerKey(owner)
      const encryptedContent = this.encryptionService
        ? await this.encryptionService.encrypt(contentData, ownerKey)
        : contentData

      const contentCid = await this.storageBackend.upload(encryptedContent)

      const reference: EmailReference = {
        messageId: envelope.id,
        contentCid,
        from: envelope.from.full,
        to: envelope.to.map((t) => t.full),
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
      }

      index.sent.unshift(reference)
      await this.saveIndex(owner, index)

      const mailbox = this.getCachedMailbox(owner)
      if (mailbox) {
        mailbox.quotaUsedBytes += BigInt(contentData.length)
      }
    } finally {
      this.addressLock.release(owner)
    }
  }

  async getEmail(
    owner: Address,
    messageId: Hex,
  ): Promise<{ envelope: EmailEnvelope; content?: EmailContent } | null> {
    const index = await this.getIndex(owner)
    if (!index) return null

    const reference = this.getAllEmailRefs(index).find(
      (e) => e.messageId === messageId,
    )
    if (!reference) return null

    const encryptedContent = await this.storageBackend.download(
      reference.contentCid,
    )
    const ownerKey = this.deriveOwnerKey(owner)
    const contentData = this.encryptionService
      ? await this.encryptionService.decrypt(encryptedContent, ownerKey)
      : encryptedContent

    const parsed = JSON.parse(contentData.toString()) as
      | { envelope?: EmailEnvelope; content?: EmailContent }
      | EmailEnvelope
    return 'envelope' in parsed && parsed.envelope
      ? { envelope: parsed.envelope, content: parsed.content }
      : { envelope: parsed as EmailEnvelope }
  }

  async moveToFolder(
    owner: Address,
    messageId: Hex,
    targetFolder: string,
  ): Promise<void> {
    const index = await this.getIndex(owner)
    if (!index) throw new Error('Mailbox not found')

    const reference = this.findAndRemoveEmail(index, messageId)
    if (!reference) throw new Error('Email not found')

    if (targetFolder in index) {
      ;(index[targetFolder as keyof typeof index] as EmailReference[]).unshift(
        reference,
      )
    } else {
      index.folders[targetFolder] ??= []
      index.folders[targetFolder].unshift(reference)
    }
    await this.saveIndex(owner, index)
  }

  async updateFlags(
    owner: Address,
    messageId: Hex,
    flags: Partial<EmailFlags>,
  ): Promise<void> {
    await this.addressLock.acquire(owner)
    try {
      const index = await this.getIndex(owner)
      if (!index) throw new Error('Mailbox not found')

      const reference = this.getAllEmailRefs(index).find(
        (e) => e.messageId === messageId,
      )
      if (!reference) throw new Error('Email not found')

      Object.assign(reference.flags, flags)
      await this.saveIndex(owner, index)
    } finally {
      this.addressLock.release(owner)
    }
  }

  async deleteEmail(owner: Address, messageId: Hex): Promise<void> {
    await this.addressLock.acquire(owner)
    try {
      const index = await this.getIndex(owner)
      if (!index) throw new Error('Mailbox not found')

      const reference = this.findAndRemoveEmail(index, messageId)
      if (!reference) throw new Error('Email not found')

      await this.storageBackend.delete(reference.contentCid)

      const mailbox = this.getCachedMailbox(owner)
      if (mailbox) {
        mailbox.quotaUsedBytes -= BigInt(reference.size)
        if (mailbox.quotaUsedBytes < 0n) mailbox.quotaUsedBytes = 0n
      }
      await this.saveIndex(owner, index)
    } finally {
      this.addressLock.release(owner)
    }
  }

  private async applyFilterRules(
    _owner: Address,
    index: MailboxIndex,
    reference: EmailReference,
  ): Promise<void> {
    for (const rule of index.rules) {
      if (!rule.enabled) continue

      const matches = rule.conditions.every((condition) => {
        let value = ''
        switch (condition.field) {
          case 'from':
            value = reference.from
            break
          case 'to':
            value = reference.to.join(', ')
            break
          case 'subject':
            value = reference.subject
            break
          default:
            return false
        }

        switch (condition.operator) {
          case 'contains':
            return value.toLowerCase().includes(condition.value.toLowerCase())
          case 'equals':
            return value.toLowerCase() === condition.value.toLowerCase()
          case 'startsWith':
            return value.toLowerCase().startsWith(condition.value.toLowerCase())
          case 'endsWith':
            return value.toLowerCase().endsWith(condition.value.toLowerCase())
          case 'regex':
            return new RegExp(condition.value, 'i').test(value)
          default:
            return false
        }
      })

      if (!matches) continue

      for (const action of rule.actions) {
        switch (action.type) {
          case 'move':
            if (action.value) {
              // Remove from inbox
              const idx = index.inbox.findIndex(
                (e) => e.messageId === reference.messageId,
              )
              if (idx !== -1) index.inbox.splice(idx, 1)

              // Add to target folder
              if (!index.folders[action.value]) {
                index.folders[action.value] = []
              }
              index.folders[action.value].unshift(reference)
            }
            break
          case 'label':
            if (action.value) {
              reference.labels.push(action.value)
            }
            break
          case 'star':
            reference.flags.starred = true
            break
          case 'markRead':
            reference.flags.read = true
            break
          case 'delete':
            reference.flags.deleted = true
            break
        }
      }
    }
  }

  async createFolder(owner: Address, folderName: string): Promise<void> {
    await this.addressLock.acquire(owner)
    try {
      const mailbox = await this.getMailbox(owner)
      if (!mailbox) throw new Error('Mailbox not found')
      const index = await this.getIndex(owner)
      if (!index) throw new Error('Index not found')

      if (
        DEFAULT_FOLDERS.includes(
          folderName.toLowerCase() as (typeof DEFAULT_FOLDERS)[number],
        ) ||
        mailbox.folders.includes(folderName) ||
        index.folders[folderName]
      ) {
        throw new Error(`Folder '${folderName}' already exists`)
      }
      mailbox.folders.push(folderName)
      index.folders[folderName] = []
      await this.saveMailbox(owner, mailbox)
      await this.saveIndex(owner, index)
    } finally {
      this.addressLock.release(owner)
    }
  }

  async deleteFolder(owner: Address, folderName: string): Promise<void> {
    await this.addressLock.acquire(owner)
    try {
      const mailbox = await this.getMailbox(owner)
      if (!mailbox) throw new Error('Mailbox not found')
      const index = await this.getIndex(owner)
      if (!index) throw new Error('Index not found')

      if (
        DEFAULT_FOLDERS.includes(
          folderName.toLowerCase() as (typeof DEFAULT_FOLDERS)[number],
        )
      )
        throw new Error('Cannot delete default folder')
      if (!mailbox.folders.includes(folderName))
        throw new Error(`Folder '${folderName}' not found`)

      index.trash.push(...(index.folders[folderName] ?? []))
      mailbox.folders = mailbox.folders.filter((f) => f !== folderName)
      delete index.folders[folderName]
      await this.saveMailbox(owner, mailbox)
      await this.saveIndex(owner, index)
    } finally {
      this.addressLock.release(owner)
    }
  }

  async addFilterRule(owner: Address, rule: FilterRule): Promise<void> {
    await this.addressLock.acquire(owner)
    try {
      const index = await this.getIndex(owner)
      if (!index) throw new Error('Mailbox not found')

      const validFields = ['from', 'to', 'subject', 'body', 'header']
      const validOperators = [
        'contains',
        'equals',
        'startsWith',
        'endsWith',
        'regex',
      ]
      const validActions = [
        'move',
        'label',
        'star',
        'markRead',
        'forward',
        'delete',
      ]

      for (const condition of rule.conditions) {
        if (!validFields.includes(condition.field)) {
          throw new Error(`Invalid condition field: ${condition.field}`)
        }
        if (!validOperators.includes(condition.operator)) {
          throw new Error(`Invalid condition operator: ${condition.operator}`)
        }
      }

      for (const action of rule.actions) {
        if (!validActions.includes(action.type)) {
          throw new Error(`Invalid action type: ${action.type}`)
        }
      }

      if (index.rules.length >= 100) {
        throw new Error('Maximum of 100 filter rules allowed')
      }

      index.rules.push(rule)
      await this.saveIndex(owner, index)
    } finally {
      this.addressLock.release(owner)
    }
  }

  async removeFilterRule(owner: Address, ruleId: string): Promise<void> {
    await this.addressLock.acquire(owner)
    try {
      const index = await this.getIndex(owner)
      if (!index) throw new Error('Mailbox not found')

      index.rules = index.rules.filter((r) => r.id !== ruleId)
      await this.saveIndex(owner, index)
    } finally {
      this.addressLock.release(owner)
    }
  }

  async exportUserData(owner: Address): Promise<{
    mailbox: Mailbox
    index: MailboxIndex
    emails: Array<{ envelope: EmailEnvelope; content?: EmailContent }>
  }> {
    const mailbox = await this.getMailbox(owner)
    if (!mailbox) throw new Error('Mailbox not found')

    const index = await this.getIndex(owner)
    if (!index) throw new Error('Index not found')

    const emails: Array<{ envelope: EmailEnvelope; content?: EmailContent }> =
      []
    for (const ref of this.getAllEmailRefs(index)) {
      const email = await this.getEmail(owner, ref.messageId)
      if (email) emails.push(email)
    }
    return { mailbox, index, emails }
  }

  async deleteAllUserData(owner: Address): Promise<void> {
    await this.addressLock.acquire(owner)
    try {
      const index = await this.getIndex(owner)
      if (!index) return

      for (const ref of this.getAllEmailRefs(index)) {
        await this.storageBackend.delete(ref.contentCid)
      }

      const mailbox = this.getCachedMailbox(owner)
      if (mailbox) await this.storageBackend.delete(mailbox.encryptedIndexCid)

      this.mailboxCache.delete(owner)
      this.indexCache.delete(owner)
      await this.loadRegistry()
      this.mailboxRegistry.delete(owner)
      await this.saveRegistry()
    } finally {
      this.addressLock.release(owner)
    }
  }

  async searchEmails(
    owner: Address,
    query: string,
    options: {
      folder?: string
      from?: string
      to?: string
      dateFrom?: number
      dateTo?: number
      hasAttachment?: boolean
      limit?: number
      offset?: number
    } = {},
  ): Promise<{ results: EmailReference[]; total: number }> {
    const index = await this.getIndex(owner)
    if (!index) return { results: [], total: 0 }

    let emails: EmailReference[]
    if (options.folder) {
      if (options.folder in index) {
        emails = [
          ...(index[options.folder as keyof typeof index] as EmailReference[]),
        ]
      } else if (index.folders[options.folder]) {
        emails = [...index.folders[options.folder]]
      } else {
        emails = []
      }
    } else {
      emails = [
        ...index.inbox,
        ...index.sent,
        ...index.drafts,
        ...index.archive,
        ...Object.values(index.folders).flat(),
      ]
    }

    const queryLower = query.toLowerCase()
    let filtered = emails.filter((email) => {
      if (
        query &&
        !email.from.toLowerCase().includes(queryLower) &&
        !email.to.some((t) => t.toLowerCase().includes(queryLower)) &&
        !email.subject.toLowerCase().includes(queryLower) &&
        !email.preview.toLowerCase().includes(queryLower)
      ) {
        return false
      }

      if (
        options.from &&
        !email.from.toLowerCase().includes(options.from.toLowerCase())
      ) {
        return false
      }

      if (options.to) {
        const toFilter = options.to.toLowerCase()
        if (!email.to.some((t) => t.toLowerCase().includes(toFilter))) {
          return false
        }
      }

      if (options.dateFrom && email.timestamp < options.dateFrom) {
        return false
      }
      if (options.dateTo && email.timestamp > options.dateTo) {
        return false
      }

      return true
    })

    const total = filtered.length

    const offset = options.offset ?? 0
    const limit = options.limit ?? 50
    filtered = filtered.slice(offset, offset + limit)

    return { results: filtered, total }
  }
}

let _mailboxStorage: MailboxStorage | null = null

export function getMailboxStorage(): MailboxStorage {
  _mailboxStorage ??= new MailboxStorage(
    new DWSStorageAdapter(getMultiBackendManager()),
  )
  return _mailboxStorage
}

export function initializeMailboxStorage(
  storageBackend: StorageBackend,
  encryptionService?: EncryptionService,
): MailboxStorage {
  _mailboxStorage = new MailboxStorage(storageBackend, encryptionService)
  return _mailboxStorage
}

export function resetMailboxStorage(): void {
  _mailboxStorage = null
}
