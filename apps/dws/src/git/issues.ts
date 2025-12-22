/**
 * Git Issues Manager
 * Manages issues with on-chain CID references stored in RepoRegistry metadata
 */

import { expectJson } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import {
  IssueIndexSchema,
  IssueSchema,
  RepoMetadataSchema,
} from '../shared/schemas/internal-storage'
import type { BackendManager } from '../storage/backends'
import type {
  ContributionEvent,
  CreateIssueRequest,
  Issue,
  IssueComment,
  IssueIndex,
  IssueState,
  UpdateIssueRequest,
} from './types'

export interface IssuesManagerConfig {
  backend: BackendManager
}

export class IssuesManager {
  private backend: BackendManager
  private issueCache: Map<string, Issue> = new Map() // `${repoId}#${number}` -> Issue
  private indexCache: Map<Hex, IssueIndex> = new Map() // repoId -> IssueIndex

  constructor(config: IssuesManagerConfig) {
    this.backend = config.backend
  }

  /**
   * Get or create issue index for a repository
   */
  async getIssueIndex(repoId: Hex, metadataCid?: string): Promise<IssueIndex> {
    const cached = this.indexCache.get(repoId)
    if (cached) return cached

    if (metadataCid) {
      const result = await this.backend.download(metadataCid).catch(() => null)
      if (result) {
        const metadata = expectJson(
          result.content.toString(),
          RepoMetadataSchema,
          'repo metadata',
        )
        if (metadata.issueIndexCid) {
          const indexResult = await this.backend
            .download(metadata.issueIndexCid)
            .catch(() => null)
          if (indexResult) {
            const index = expectJson(
              indexResult.content.toString(),
              IssueIndexSchema,
              'issue index',
            )
            this.indexCache.set(repoId, index)
            return index
          }
        }
      }
    }

    // Create empty index
    const emptyIndex: IssueIndex = {
      repoId,
      totalCount: 0,
      openCount: 0,
      closedCount: 0,
      issues: [],
    }
    this.indexCache.set(repoId, emptyIndex)
    return emptyIndex
  }

  /**
   * Get an issue by repo and number
   */
  async getIssue(repoId: Hex, issueNumber: number): Promise<Issue | null> {
    const cacheKey = `${repoId}#${issueNumber}`
    const cached = this.issueCache.get(cacheKey)
    if (cached) return cached

    const index = this.indexCache.get(repoId)
    if (!index) return null

    const issueRef = index.issues.find((i) => i.number === issueNumber)
    if (!issueRef) return null

    const result = await this.backend.download(issueRef.cid).catch(() => null)
    if (!result) return null

    const issue = expectJson(result.content.toString(), IssueSchema, 'issue')
    this.issueCache.set(cacheKey, issue)
    return issue
  }

  /**
   * List issues for a repository
   */
  async listIssues(
    repoId: Hex,
    options: {
      state?: IssueState | 'all'
      author?: Address
      assignee?: Address
      labels?: string[]
      page?: number
      perPage?: number
      sort?: 'created' | 'updated' | 'comments'
      direction?: 'asc' | 'desc'
    } = {},
  ): Promise<{ issues: Issue[]; total: number }> {
    const index = this.indexCache.get(repoId)
    if (!index) return { issues: [], total: 0 }

    let issueRefs = [...index.issues]

    // Filter by state
    if (options.state && options.state !== 'all') {
      issueRefs = issueRefs.filter((i) => i.state === options.state)
    }

    // Filter by author
    if (options.author) {
      issueRefs = issueRefs.filter(
        (i) => i.author.toLowerCase() === options.author?.toLowerCase(),
      )
    }

    // Sort
    const sortField = options.sort || 'created'
    const direction = options.direction || 'desc'
    issueRefs.sort((a, b) => {
      const aVal = sortField === 'updated' ? a.updatedAt : a.createdAt
      const bVal = sortField === 'updated' ? b.updatedAt : b.createdAt
      return direction === 'desc' ? bVal - aVal : aVal - bVal
    })

    // Paginate
    const page = options.page || 1
    const perPage = options.perPage || 30
    const start = (page - 1) * perPage
    const paginatedRefs = issueRefs.slice(start, start + perPage)

    // Fetch full issues
    const issues: Issue[] = []
    for (const ref of paginatedRefs) {
      const issue = await this.getIssue(repoId, ref.number)
      if (issue) {
        // Apply additional filters that require full data
        if (options.labels && options.labels.length > 0) {
          const hasAllLabels = options.labels.every((l) =>
            issue.labels.includes(l),
          )
          if (!hasAllLabels) continue
        }
        if (options.assignee) {
          const isAssigned = issue.assignees.some(
            (a) => a.toLowerCase() === options.assignee?.toLowerCase(),
          )
          if (!isAssigned) continue
        }
        issues.push(issue)
      }
    }

    return { issues, total: issueRefs.length }
  }

  /**
   * Create a new issue
   */
  async createIssue(
    repoId: Hex,
    author: Address,
    request: CreateIssueRequest,
  ): Promise<{
    issue: Issue
    indexCid: string
    contributionEvent: ContributionEvent
  }> {
    const index = await this.getIssueIndex(repoId)
    const issueNumber = index.totalCount + 1
    const now = Date.now()

    const issue: Issue = {
      id: `${repoId}#${issueNumber}`,
      repoId,
      number: issueNumber,
      title: request.title,
      body: request.body || '',
      state: 'open',
      author,
      assignees: request.assignees || [],
      labels: request.labels || [],
      createdAt: now,
      updatedAt: now,
      comments: [],
      cid: '', // Will be set after upload
      milestone: request.milestone,
    }

    // Upload issue to storage
    const issueBuffer = Buffer.from(JSON.stringify(issue))
    const uploadResult = await this.backend.upload(issueBuffer, {
      filename: `issue-${repoId}-${issueNumber}.json`,
    })
    issue.cid = uploadResult.cid

    // Update index
    index.totalCount++
    index.openCount++
    index.issues.push({
      number: issueNumber,
      cid: issue.cid,
      state: 'open',
      title: issue.title,
      author,
      createdAt: now,
      updatedAt: now,
    })

    // Upload updated index
    const indexBuffer = Buffer.from(JSON.stringify(index))
    const indexResult = await this.backend.upload(indexBuffer, {
      filename: `issue-index-${repoId}.json`,
    })

    // Update caches
    this.issueCache.set(`${repoId}#${issueNumber}`, issue)
    this.indexCache.set(repoId, index)

    // Create contribution event
    const contributionEvent: ContributionEvent = {
      source: 'jeju-git',
      type: 'issue_open',
      repoId,
      author,
      timestamp: now,
      metadata: { issueNumber },
    }

    return { issue, indexCid: indexResult.cid, contributionEvent }
  }

  /**
   * Update an issue
   */
  async updateIssue(
    repoId: Hex,
    issueNumber: number,
    updater: Address,
    request: UpdateIssueRequest,
  ): Promise<{
    issue: Issue
    indexCid: string
    contributionEvent?: ContributionEvent
  }> {
    const issue = await this.getIssue(repoId, issueNumber)
    if (!issue) {
      throw new Error(`Issue #${issueNumber} not found`)
    }

    const now = Date.now()
    let contributionEvent: ContributionEvent | undefined

    // Track state change
    const wasOpen = issue.state === 'open'
    const willBeClosed = request.state === 'closed'

    // Update fields
    if (request.title !== undefined) issue.title = request.title
    if (request.body !== undefined) issue.body = request.body
    if (request.labels !== undefined) issue.labels = request.labels
    if (request.assignees !== undefined) issue.assignees = request.assignees
    if (request.milestone !== undefined) issue.milestone = request.milestone
    if (request.state !== undefined) {
      issue.state = request.state
      if (request.state === 'closed' && !issue.closedAt) {
        issue.closedAt = now
        issue.closedBy = updater
      }
    }
    issue.updatedAt = now

    // Upload updated issue
    const issueBuffer = Buffer.from(JSON.stringify(issue))
    const uploadResult = await this.backend.upload(issueBuffer, {
      filename: `issue-${repoId}-${issueNumber}.json`,
    })
    issue.cid = uploadResult.cid

    // Update index
    const index = this.indexCache.get(repoId)
    if (index) {
      const indexEntry = index.issues.find((i) => i.number === issueNumber)
      if (indexEntry) {
        indexEntry.cid = issue.cid
        indexEntry.state = issue.state
        indexEntry.title = issue.title
        indexEntry.updatedAt = now
      }

      // Update counts if state changed
      if (wasOpen && willBeClosed) {
        index.openCount--
        index.closedCount++
        contributionEvent = {
          source: 'jeju-git',
          type: 'issue_close',
          repoId,
          author: updater,
          timestamp: now,
          metadata: { issueNumber },
        }
      } else if (!wasOpen && request.state === 'open') {
        index.openCount++
        index.closedCount--
      }
    }

    // Upload updated index
    const indexBuffer = Buffer.from(JSON.stringify(index))
    const indexResult = await this.backend.upload(indexBuffer, {
      filename: `issue-index-${repoId}.json`,
    })

    // Update cache
    this.issueCache.set(`${repoId}#${issueNumber}`, issue)

    return { issue, indexCid: indexResult.cid, contributionEvent }
  }

  /**
   * Add a comment to an issue
   */
  async addComment(
    repoId: Hex,
    issueNumber: number,
    author: Address,
    body: string,
  ): Promise<{ issue: Issue; comment: IssueComment; indexCid: string }> {
    const issue = await this.getIssue(repoId, issueNumber)
    if (!issue) {
      throw new Error(`Issue #${issueNumber} not found`)
    }

    const now = Date.now()
    const comment: IssueComment = {
      id: `${repoId}#${issueNumber}-comment-${issue.comments.length + 1}`,
      author,
      body,
      createdAt: now,
    }

    issue.comments.push(comment)
    issue.updatedAt = now

    // Upload updated issue
    const issueBuffer = Buffer.from(JSON.stringify(issue))
    const uploadResult = await this.backend.upload(issueBuffer, {
      filename: `issue-${repoId}-${issueNumber}.json`,
    })
    issue.cid = uploadResult.cid

    // Update index
    const index = this.indexCache.get(repoId)
    if (index) {
      const indexEntry = index.issues.find((i) => i.number === issueNumber)
      if (indexEntry) {
        indexEntry.cid = issue.cid
        indexEntry.updatedAt = now
      }
    }

    // Upload updated index
    const indexBuffer = Buffer.from(JSON.stringify(index))
    const indexResult = await this.backend.upload(indexBuffer, {
      filename: `issue-index-${repoId}.json`,
    })

    // Update cache
    this.issueCache.set(`${repoId}#${issueNumber}`, issue)

    return { issue, comment, indexCid: indexResult.cid }
  }

  /**
   * Add reaction to an issue or comment
   */
  async addReaction(
    repoId: Hex,
    issueNumber: number,
    user: Address,
    reaction: string,
    commentId?: string,
  ): Promise<Issue> {
    const issue = await this.getIssue(repoId, issueNumber)
    if (!issue) {
      throw new Error(`Issue #${issueNumber} not found`)
    }

    if (commentId) {
      const comment = issue.comments.find((c) => c.id === commentId)
      if (!comment) {
        throw new Error(`Comment ${commentId} not found`)
      }
      comment.reactions = comment.reactions || {}
      comment.reactions[reaction] = comment.reactions[reaction] || []
      if (!comment.reactions[reaction].includes(user)) {
        comment.reactions[reaction].push(user)
      }
    } else {
      issue.reactions = issue.reactions || {}
      issue.reactions[reaction] = issue.reactions[reaction] || []
      if (!issue.reactions[reaction].includes(user)) {
        issue.reactions[reaction].push(user)
      }
    }

    // Upload updated issue
    const issueBuffer = Buffer.from(JSON.stringify(issue))
    const uploadResult = await this.backend.upload(issueBuffer, {
      filename: `issue-${repoId}-${issueNumber}.json`,
    })
    issue.cid = uploadResult.cid

    // Update cache
    this.issueCache.set(`${repoId}#${issueNumber}`, issue)

    return issue
  }

  /**
   * Clear caches for a repository
   */
  clearCache(repoId: Hex): void {
    this.indexCache.delete(repoId)
    // Clear issue cache for this repo
    for (const key of this.issueCache.keys()) {
      if (key.startsWith(repoId)) {
        this.issueCache.delete(key)
      }
    }
  }

  /**
   * Preload index into cache
   */
  async preloadIndex(repoId: Hex, issueIndexCid: string): Promise<void> {
    const result = await this.backend.download(issueIndexCid).catch(() => null)
    if (result) {
      const index = expectJson(
        result.content.toString(),
        IssueIndexSchema,
        'issue index',
      )
      this.indexCache.set(repoId, index)
    }
  }
}
