/**
 * Git Object Store
 * Stores and retrieves git objects from the DWS storage backend
 */

import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { deflate, inflate } from 'node:zlib'
import type { BackendManager } from '../storage/backends'
import type {
  GitBlob,
  GitCommit,
  GitCommitAuthor,
  GitObject,
  GitObjectType,
  GitTag,
  GitTree,
  GitTreeEntry,
  StoredGitObject,
} from './types'

const inflateAsync = promisify(inflate)
const deflateAsync = promisify(deflate)

export class GitObjectStore {
  private backend: BackendManager
  private objectIndex: Map<string, StoredGitObject> = new Map() // oid -> stored object
  private cidToOid: Map<string, string> = new Map() // cid -> oid

  constructor(backend: BackendManager) {
    this.backend = backend
  }

  /**
   * Calculate SHA-1 hash of a git object
   */
  hashObject(type: GitObjectType, content: Buffer): string {
    const header = Buffer.from(`${type} ${content.length}\0`)
    const full = Buffer.concat([header, content])
    return createHash('sha1').update(full).digest('hex')
  }

  /**
   * Store a raw git object
   */
  async storeObject(
    type: GitObjectType,
    content: Buffer,
  ): Promise<StoredGitObject> {
    const oid = this.hashObject(type, content)

    // Check if already stored
    const existing = this.objectIndex.get(oid)
    if (existing) {
      return existing
    }

    // Create git object format: type SP size NUL content
    const header = Buffer.from(`${type} ${content.length}\0`)
    const full = Buffer.concat([header, content])

    // Compress with zlib (git's loose object format)
    const compressed = await deflateAsync(full)

    // Store in backend
    const result = await this.backend.upload(Buffer.from(compressed), {
      filename: `git-objects/${oid.slice(0, 2)}/${oid.slice(2)}`,
    })

    const stored: StoredGitObject = {
      cid: result.cid,
      oid,
      type,
      size: content.length,
    }

    this.objectIndex.set(oid, stored)
    this.cidToOid.set(result.cid, oid)

    return stored
  }

  /**
   * Retrieve a git object by OID
   */
  async getObject(oid: string): Promise<GitObject | null> {
    // Check index first
    const stored = this.objectIndex.get(oid)
    if (!stored) {
      return null
    }

    const result = await this.backend
      .download(stored.cid)
      .catch((err: Error): null => {
        console.error(
          `[Git ObjectStore] Failed to download object ${oid} from ${stored.cid}: ${err.message}`,
        )
        return null
      })
    if (!result) {
      return null
    }

    // Decompress
    const decompressed = await inflateAsync(result.content)

    // Parse header
    const nullIndex = decompressed.indexOf(0)
    const header = decompressed.subarray(0, nullIndex).toString()
    const [type, sizeStr] = header.split(' ')
    const size = parseInt(sizeStr, 10)
    const content = decompressed.subarray(nullIndex + 1)

    return {
      type: type as GitObjectType,
      oid,
      size,
      content: Buffer.from(content),
    }
  }

  /**
   * Check if an object exists
   */
  hasObject(oid: string): boolean {
    return this.objectIndex.has(oid)
  }

  /**
   * Store a blob
   */
  async storeBlob(content: Buffer): Promise<GitBlob> {
    const stored = await this.storeObject('blob', content)
    return {
      type: 'blob',
      oid: stored.oid,
      content,
    }
  }

  /**
   * Store a tree
   */
  async storeTree(entries: GitTreeEntry[]): Promise<GitTree> {
    // Sort entries by name (git requirement)
    const sorted = [...entries].sort((a, b) => {
      // Directories are sorted with trailing /
      const aName = a.type === 'tree' ? `${a.name}/` : a.name
      const bName = b.type === 'tree' ? `${b.name}/` : b.name
      return aName.localeCompare(bName)
    })

    // Build tree content: mode SP name NUL oid (20 bytes binary)
    const parts: Buffer[] = []
    for (const entry of sorted) {
      const mode = entry.mode
      const header = Buffer.from(`${mode} ${entry.name}\0`)
      const oidBuffer = Buffer.from(entry.oid, 'hex')
      parts.push(header, oidBuffer)
    }

    const content = Buffer.concat(parts)
    const stored = await this.storeObject('tree', content)

    return {
      type: 'tree',
      oid: stored.oid,
      entries: sorted,
    }
  }

  /**
   * Parse a tree object
   */
  parseTree(content: Buffer): GitTreeEntry[] {
    const entries: GitTreeEntry[] = []
    let offset = 0

    while (offset < content.length) {
      // Find space after mode
      const spaceIndex = content.indexOf(0x20, offset)
      const mode = content.subarray(offset, spaceIndex).toString()

      // Find null after name
      const nullIndex = content.indexOf(0, spaceIndex + 1)
      const name = content.subarray(spaceIndex + 1, nullIndex).toString()

      // Next 20 bytes are the OID
      const oidBuffer = content.subarray(nullIndex + 1, nullIndex + 21)
      const oid = oidBuffer.toString('hex')

      // Determine type from mode
      let type: 'blob' | 'tree' | 'commit'
      if (mode === '40000' || mode === '040000') {
        type = 'tree'
      } else if (mode === '160000') {
        type = 'commit' // submodule
      } else {
        type = 'blob'
      }

      entries.push({ mode, name, oid, type })
      offset = nullIndex + 21
    }

    return entries
  }

  /**
   * Store a commit
   */
  async storeCommit(
    commit: Omit<GitCommit, 'type' | 'oid'>,
  ): Promise<GitCommit> {
    const lines: string[] = []

    lines.push(`tree ${commit.tree}`)
    for (const parent of commit.parents) {
      lines.push(`parent ${parent}`)
    }
    lines.push(`author ${this.formatAuthor(commit.author)}`)
    lines.push(`committer ${this.formatAuthor(commit.committer)}`)

    if (commit.gpgSignature) {
      lines.push(`gpgsig ${commit.gpgSignature.replace(/\n/g, '\n ')}`)
    }

    lines.push('')
    lines.push(commit.message)

    const content = Buffer.from(lines.join('\n'))
    const stored = await this.storeObject('commit', content)

    return {
      type: 'commit',
      oid: stored.oid,
      ...commit,
    }
  }

  /**
   * Parse a commit object
   */
  parseCommit(content: Buffer): Omit<GitCommit, 'type' | 'oid'> {
    const text = content.toString('utf8')
    const lines = text.split('\n')

    let tree = ''
    const parents: string[] = []
    let author: GitCommitAuthor = {
      name: '',
      email: '',
      timestamp: 0,
      timezoneOffset: 0,
    }
    let committer: GitCommitAuthor = {
      name: '',
      email: '',
      timestamp: 0,
      timezoneOffset: 0,
    }
    let gpgSignature: string | undefined
    let messageStart = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      if (line === '') {
        messageStart = i + 1
        break
      }

      if (line.startsWith('tree ')) {
        tree = line.slice(5)
      } else if (line.startsWith('parent ')) {
        parents.push(line.slice(7))
      } else if (line.startsWith('author ')) {
        author = this.parseAuthor(line.slice(7))
      } else if (line.startsWith('committer ')) {
        committer = this.parseAuthor(line.slice(10))
      } else if (line.startsWith('gpgsig ')) {
        // Multi-line GPG signature
        const sigLines: string[] = [line.slice(7)]
        while (i + 1 < lines.length && lines[i + 1].startsWith(' ')) {
          i++
          sigLines.push(lines[i].slice(1))
        }
        gpgSignature = sigLines.join('\n')
      }
    }

    const message = lines.slice(messageStart).join('\n')

    return { tree, parents, author, committer, message, gpgSignature }
  }

  /**
   * Store a tag object
   */
  async storeTag(tag: Omit<GitTag, 'type' | 'oid'>): Promise<GitTag> {
    const lines: string[] = []

    lines.push(`object ${tag.object}`)
    lines.push(`type ${tag.objectType}`)
    lines.push(`tag ${tag.tag}`)
    lines.push(`tagger ${this.formatAuthor(tag.tagger)}`)

    if (tag.gpgSignature) {
      lines.push('')
      lines.push(tag.gpgSignature)
    }

    lines.push('')
    lines.push(tag.message)

    const content = Buffer.from(lines.join('\n'))
    const stored = await this.storeObject('tag', content)

    return {
      type: 'tag',
      oid: stored.oid,
      ...tag,
    }
  }

  /**
   * Get a blob
   */
  async getBlob(oid: string): Promise<GitBlob | null> {
    const obj = await this.getObject(oid)
    if (!obj || obj.type !== 'blob') return null
    return { type: 'blob', oid, content: obj.content }
  }

  /**
   * Get a tree
   */
  async getTree(oid: string): Promise<GitTree | null> {
    const obj = await this.getObject(oid)
    if (!obj || obj.type !== 'tree') return null
    return { type: 'tree', oid, entries: this.parseTree(obj.content) }
  }

  /**
   * Get a commit
   */
  async getCommit(oid: string): Promise<GitCommit | null> {
    const obj = await this.getObject(oid)
    if (!obj || obj.type !== 'commit') return null
    return { type: 'commit', oid, ...this.parseCommit(obj.content) }
  }

  /**
   * Walk commit history
   */
  async walkCommits(
    startOid: string,
    maxCount: number = 100,
  ): Promise<GitCommit[]> {
    const commits: GitCommit[] = []
    const visited = new Set<string>()
    const queue: string[] = [startOid]

    while (queue.length > 0 && commits.length < maxCount) {
      const oid = queue.shift()
      if (!oid || visited.has(oid)) continue
      visited.add(oid)

      const commit = await this.getCommit(oid)
      if (!commit) continue

      commits.push(commit)
      queue.push(...commit.parents)
    }

    return commits
  }

  /**
   * Get all objects reachable from a commit
   */
  async getReachableObjects(commitOid: string): Promise<string[]> {
    const oids: string[] = []
    const visited = new Set<string>()

    const walk = async (oid: string) => {
      if (visited.has(oid)) return
      visited.add(oid)
      oids.push(oid)

      const obj = await this.getObject(oid)
      if (!obj) return

      if (obj.type === 'commit') {
        const commit = this.parseCommit(obj.content)
        await walk(commit.tree)
        for (const parent of commit.parents) {
          await walk(parent)
        }
      } else if (obj.type === 'tree') {
        const entries = this.parseTree(obj.content)
        for (const entry of entries) {
          await walk(entry.oid)
        }
      }
    }

    await walk(commitOid)
    return oids
  }

  /**
   * Format author for commit/tag
   */
  private formatAuthor(author: GitCommitAuthor): string {
    const sign = author.timezoneOffset >= 0 ? '+' : '-'
    const absOffset = Math.abs(author.timezoneOffset)
    const hours = Math.floor(absOffset / 60)
      .toString()
      .padStart(2, '0')
    const mins = (absOffset % 60).toString().padStart(2, '0')
    return `${author.name} <${author.email}> ${author.timestamp} ${sign}${hours}${mins}`
  }

  /**
   * Parse author from commit/tag
   */
  private parseAuthor(line: string): GitCommitAuthor {
    // Format: Name <email> timestamp timezone
    const match = line.match(/^(.+) <(.+)> (\d+) ([+-]\d{4})$/)
    if (!match) {
      return {
        name: 'Unknown',
        email: 'unknown@example.com',
        timestamp: 0,
        timezoneOffset: 0,
      }
    }

    const [, name, email, timestampStr, tz] = match
    const timestamp = parseInt(timestampStr, 10)
    const tzSign = tz[0] === '+' ? 1 : -1
    const tzHours = parseInt(tz.slice(1, 3), 10)
    const tzMins = parseInt(tz.slice(3, 5), 10)
    const timezoneOffset = tzSign * (tzHours * 60 + tzMins)

    return { name, email, timestamp, timezoneOffset }
  }

  /**
   * Import an index of known objects
   */
  importIndex(objects: StoredGitObject[]): void {
    for (const obj of objects) {
      this.objectIndex.set(obj.oid, obj)
      this.cidToOid.set(obj.cid, obj.oid)
    }
  }

  /**
   * Export the current index
   */
  exportIndex(): StoredGitObject[] {
    return Array.from(this.objectIndex.values())
  }

  /**
   * Get OID from CID
   */
  getOidFromCid(cid: string): string | undefined {
    return this.cidToOid.get(cid)
  }

  /**
   * Get stored object info
   */
  getStoredObject(oid: string): StoredGitObject | undefined {
    return this.objectIndex.get(oid)
  }
}
