/**
 * Git Pull Requests Manager
 * Manages PRs with on-chain CID references stored in RepoRegistry metadata
 */

import { expectJson } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import {
  PRIndexSchema,
  PullRequestSchema,
  RepoMetadataSchema,
} from '../shared/schemas/internal-storage'
import type { BackendManager } from '../storage/backends'
import { decodeBytes32ToOid } from './oid-utils'
import type { GitRepoManager } from './repo-manager'
import type {
  ContributionEvent,
  CreatePRRequest,
  MergePRRequest,
  PRIndex,
  PRReview,
  PRReviewComment,
  PRState,
  PullRequest,
  ReviewState,
  UpdatePRRequest,
} from './types'

export interface PRManagerConfig {
  backend: BackendManager
  repoManager: GitRepoManager
}

export class PullRequestsManager {
  private backend: BackendManager
  private repoManager: GitRepoManager
  private prCache: Map<string, PullRequest> = new Map() // `${repoId}!${number}` -> PR
  private indexCache: Map<Hex, PRIndex> = new Map() // repoId -> PRIndex

  constructor(config: PRManagerConfig) {
    this.backend = config.backend
    this.repoManager = config.repoManager
  }

  /**
   * Get or create PR index for a repository
   */
  async getPRIndex(repoId: Hex, metadataCid?: string): Promise<PRIndex> {
    const cached = this.indexCache.get(repoId)
    if (cached) return cached

    if (metadataCid) {
      const result = await this.backend.download(metadataCid)
      if (result) {
        const metadata = expectJson(
          result.content.toString(),
          RepoMetadataSchema,
          'repo metadata',
        )
        if (metadata.prIndexCid) {
          const indexResult = await this.backend.download(metadata.prIndexCid)
          if (indexResult) {
            const index = expectJson(
              indexResult.content.toString(),
              PRIndexSchema,
              'PR index',
            )
            this.indexCache.set(repoId, index)
            return index
          }
        }
      }
    }

    // Create empty index
    const emptyIndex: PRIndex = {
      repoId,
      totalCount: 0,
      openCount: 0,
      closedCount: 0,
      mergedCount: 0,
      prs: [],
    }
    this.indexCache.set(repoId, emptyIndex)
    return emptyIndex
  }

  /**
   * Get a PR by repo and number
   */
  async getPR(repoId: Hex, prNumber: number): Promise<PullRequest | null> {
    const cacheKey = `${repoId}!${prNumber}`
    const cached = this.prCache.get(cacheKey)
    if (cached) return cached

    const index = this.indexCache.get(repoId)
    if (!index) return null

    const prRef = index.prs.find((p) => p.number === prNumber)
    if (!prRef) return null

    const result = await this.backend.download(prRef.cid)
    if (!result) return null

    const pr = expectJson(
      result.content.toString(),
      PullRequestSchema,
      'pull request',
    )
    this.prCache.set(cacheKey, pr)
    return pr
  }

  /**
   * List PRs for a repository
   */
  async listPRs(
    repoId: Hex,
    options: {
      state?: PRState | 'all'
      author?: Address
      sourceBranch?: string
      targetBranch?: string
      page?: number
      perPage?: number
      sort?: 'created' | 'updated'
      direction?: 'asc' | 'desc'
    } = {},
  ): Promise<{ prs: PullRequest[]; total: number }> {
    const index = this.indexCache.get(repoId)
    if (!index) return { prs: [], total: 0 }

    let prRefs = [...index.prs]

    // Filter by state
    if (options.state && options.state !== 'all') {
      prRefs = prRefs.filter((p) => p.state === options.state)
    }

    // Filter by author
    if (options.author) {
      prRefs = prRefs.filter(
        (p) => p.author.toLowerCase() === options.author?.toLowerCase(),
      )
    }

    // Filter by branches
    if (options.sourceBranch) {
      prRefs = prRefs.filter((p) => p.sourceBranch === options.sourceBranch)
    }
    if (options.targetBranch) {
      prRefs = prRefs.filter((p) => p.targetBranch === options.targetBranch)
    }

    // Sort
    const sortField = options.sort || 'created'
    const direction = options.direction || 'desc'
    prRefs.sort((a, b) => {
      const aVal = sortField === 'updated' ? a.updatedAt : a.createdAt
      const bVal = sortField === 'updated' ? b.updatedAt : b.createdAt
      return direction === 'desc' ? bVal - aVal : aVal - bVal
    })

    // Paginate
    const page = options.page || 1
    const perPage = options.perPage || 30
    const start = (page - 1) * perPage
    const paginatedRefs = prRefs.slice(start, start + perPage)

    // Fetch full PRs
    const prs: PullRequest[] = []
    for (const ref of paginatedRefs) {
      const pr = await this.getPR(repoId, ref.number)
      if (pr) prs.push(pr)
    }

    return { prs, total: prRefs.length }
  }

  /**
   * Create a new PR
   */
  async createPR(
    repoId: Hex,
    author: Address,
    request: CreatePRRequest,
  ): Promise<{
    pr: PullRequest
    indexCid: string
    contributionEvent: ContributionEvent
  }> {
    const index = await this.getPRIndex(repoId)
    const prNumber = index.totalCount + 1
    const now = Date.now()

    // Get the source and target branch info
    const repo = await this.repoManager.getRepository(repoId)
    if (!repo) {
      throw new Error('Repository not found')
    }

    const sourceBranch = await this.repoManager.getBranch(
      repoId,
      request.sourceBranch,
    )
    const targetBranchName = request.targetBranch || 'main'
    const targetBranch = await this.repoManager.getBranch(
      repoId,
      targetBranchName,
    )

    if (!sourceBranch) {
      throw new Error(`Source branch '${request.sourceBranch}' not found`)
    }
    if (!targetBranch) {
      throw new Error(`Target branch '${targetBranchName}' not found`)
    }

    // Get commits between base and head
    const objectStore = this.repoManager.getObjectStore(repoId)
    const headCommit = decodeBytes32ToOid(sourceBranch.tipCommitCid)
    const baseCommit = decodeBytes32ToOid(targetBranch.tipCommitCid)
    const commits = await objectStore.walkCommits(headCommit, 100)
    const commitOids = commits
      .map((c) => c.oid)
      .filter((oid) => oid !== baseCommit)

    const pr: PullRequest = {
      id: `${repoId}!${prNumber}`,
      repoId,
      number: prNumber,
      title: request.title,
      body: request.body || '',
      state: 'open',
      author,
      sourceBranch: request.sourceBranch,
      targetBranch: targetBranchName,
      sourceRepo: request.sourceRepo,
      headCommit,
      baseCommit,
      commits: commitOids,
      reviewers: request.reviewers ?? [],
      reviews: [],
      labels: request.labels ?? [],
      createdAt: now,
      updatedAt: now,
      cid: '', // Will be set after upload
      draft: request.draft ?? false,
      mergeable: true, // Will be computed when checking
      linkedIssues: [],
    }

    // Upload PR to storage
    const prBuffer = Buffer.from(JSON.stringify(pr))
    const uploadResult = await this.backend.upload(prBuffer, {
      filename: `pr-${repoId}-${prNumber}.json`,
    })
    pr.cid = uploadResult.cid

    // Update index
    index.totalCount++
    index.openCount++
    index.prs.push({
      number: prNumber,
      cid: pr.cid,
      state: 'open',
      title: pr.title,
      author,
      sourceBranch: pr.sourceBranch,
      targetBranch: pr.targetBranch,
      createdAt: now,
      updatedAt: now,
    })

    // Upload updated index
    const indexBuffer = Buffer.from(JSON.stringify(index))
    const indexResult = await this.backend.upload(indexBuffer, {
      filename: `pr-index-${repoId}.json`,
    })

    // Update caches
    this.prCache.set(`${repoId}!${prNumber}`, pr)
    this.indexCache.set(repoId, index)

    // Create contribution event
    const contributionEvent: ContributionEvent = {
      source: 'jeju-git',
      type: 'pr_open',
      repoId,
      author,
      timestamp: now,
      metadata: { prNumber },
    }

    return { pr, indexCid: indexResult.cid, contributionEvent }
  }

  /**
   * Update a PR
   */
  async updatePR(
    repoId: Hex,
    prNumber: number,
    updater: Address,
    request: UpdatePRRequest,
  ): Promise<{ pr: PullRequest; indexCid: string }> {
    const pr = await this.getPR(repoId, prNumber)
    if (!pr) {
      throw new Error(`PR #${prNumber} not found`)
    }

    const now = Date.now()

    // Update fields
    if (request.title !== undefined) pr.title = request.title
    if (request.body !== undefined) pr.body = request.body
    if (request.draft !== undefined) pr.draft = request.draft
    if (request.reviewers !== undefined) pr.reviewers = request.reviewers
    if (request.labels !== undefined) pr.labels = request.labels
    if (request.state !== undefined) {
      pr.state = request.state
      if (request.state === 'closed' && !pr.closedAt) {
        pr.closedAt = now
        pr.closedBy = updater
      }
    }
    pr.updatedAt = now

    // Upload updated PR
    const prBuffer = Buffer.from(JSON.stringify(pr))
    const uploadResult = await this.backend.upload(prBuffer, {
      filename: `pr-${repoId}-${prNumber}.json`,
    })
    pr.cid = uploadResult.cid

    // Update index
    const index = this.indexCache.get(repoId)
    if (index) {
      const indexEntry = index.prs.find((p) => p.number === prNumber)
      if (indexEntry) {
        indexEntry.cid = pr.cid
        indexEntry.state = pr.state
        indexEntry.title = pr.title
        indexEntry.updatedAt = now
      }

      // Update counts if state changed
      if (request.state === 'closed') {
        index.openCount--
        index.closedCount++
      } else if (request.state === 'open') {
        index.openCount++
        index.closedCount--
      }
    }

    // Upload updated index
    const indexBuffer = Buffer.from(JSON.stringify(index))
    const indexResult = await this.backend.upload(indexBuffer, {
      filename: `pr-index-${repoId}.json`,
    })

    // Update cache
    this.prCache.set(`${repoId}!${prNumber}`, pr)

    return { pr, indexCid: indexResult.cid }
  }

  /**
   * Add a review to a PR
   */
  async addReview(
    repoId: Hex,
    prNumber: number,
    reviewer: Address,
    state: ReviewState,
    body?: string,
    comments?: Array<{
      path: string
      line: number
      side: 'LEFT' | 'RIGHT'
      body: string
    }>,
  ): Promise<{
    pr: PullRequest
    review: PRReview
    indexCid: string
    contributionEvent: ContributionEvent
  }> {
    const pr = await this.getPR(repoId, prNumber)
    if (!pr) {
      throw new Error(`PR #${prNumber} not found`)
    }

    const now = Date.now()
    const reviewId = `${repoId}!${prNumber}-review-${pr.reviews.length + 1}`

    const reviewComments: PRReviewComment[] = (comments ?? []).map((c, i) => ({
      id: `${reviewId}-comment-${i + 1}`,
      author: reviewer,
      body: c.body,
      path: c.path,
      line: c.line,
      side: c.side,
      createdAt: now,
    }))

    const review: PRReview = {
      id: reviewId,
      author: reviewer,
      state,
      body,
      createdAt: now,
      commitOid: pr.headCommit,
      comments: reviewComments,
    }

    pr.reviews.push(review)
    pr.updatedAt = now

    // Upload updated PR
    const prBuffer = Buffer.from(JSON.stringify(pr))
    const uploadResult = await this.backend.upload(prBuffer, {
      filename: `pr-${repoId}-${prNumber}.json`,
    })
    pr.cid = uploadResult.cid

    // Update index
    const index = this.indexCache.get(repoId)
    if (index) {
      const indexEntry = index.prs.find((p) => p.number === prNumber)
      if (indexEntry) {
        indexEntry.cid = pr.cid
        indexEntry.updatedAt = now
      }
    }

    // Upload updated index
    const indexBuffer = Buffer.from(JSON.stringify(index))
    const indexResult = await this.backend.upload(indexBuffer, {
      filename: `pr-index-${repoId}.json`,
    })

    // Update cache
    this.prCache.set(`${repoId}!${prNumber}`, pr)

    // Create contribution event
    const contributionEvent: ContributionEvent = {
      source: 'jeju-git',
      type: 'pr_review',
      repoId,
      author: reviewer,
      timestamp: now,
      metadata: { prNumber },
    }

    return { pr, review, indexCid: indexResult.cid, contributionEvent }
  }

  /**
   * Merge a PR
   */
  async mergePR(
    repoId: Hex,
    prNumber: number,
    merger: Address,
    _request: MergePRRequest = {},
  ): Promise<{
    pr: PullRequest
    indexCid: string
    contributionEvent: ContributionEvent
  }> {
    const pr = await this.getPR(repoId, prNumber)
    if (!pr) {
      throw new Error(`PR #${prNumber} not found`)
    }

    if (pr.state !== 'open') {
      throw new Error('Can only merge open PRs')
    }

    const now = Date.now()

    // Check if all reviews are approved (or no reviews required)
    void pr.reviews.filter((r) => r.state === 'approved') // approvedReviews available if needed
    const changesRequestedReviews = pr.reviews.filter(
      (r) => r.state === 'changes_requested',
    )
    if (changesRequestedReviews.length > 0) {
      throw new Error('Cannot merge: changes requested')
    }

    // Perform the merge via repo manager
    // This is a simplified version - real merge would use Git operations
    await this.repoManager.pushBranch(
      repoId,
      pr.targetBranch,
      pr.headCommit,
      pr.baseCommit,
      pr.commits.length,
      merger,
    )

    // Update PR state
    pr.state = 'merged'
    pr.mergedAt = now
    pr.mergedBy = merger
    pr.updatedAt = now

    // Upload updated PR
    const prBuffer = Buffer.from(JSON.stringify(pr))
    const uploadResult = await this.backend.upload(prBuffer, {
      filename: `pr-${repoId}-${prNumber}.json`,
    })
    pr.cid = uploadResult.cid

    // Update index
    const index = this.indexCache.get(repoId)
    if (index) {
      const indexEntry = index.prs.find((p) => p.number === prNumber)
      if (indexEntry) {
        indexEntry.cid = pr.cid
        indexEntry.state = 'merged'
        indexEntry.updatedAt = now
      }
      index.openCount--
      index.mergedCount++
    }

    // Upload updated index
    const indexBuffer = Buffer.from(JSON.stringify(index))
    const indexResult = await this.backend.upload(indexBuffer, {
      filename: `pr-index-${repoId}.json`,
    })

    // Update cache
    this.prCache.set(`${repoId}!${prNumber}`, pr)

    // Create contribution event
    const contributionEvent: ContributionEvent = {
      source: 'jeju-git',
      type: 'pr_merge',
      repoId,
      author: merger,
      timestamp: now,
      metadata: { prNumber },
    }

    return { pr, indexCid: indexResult.cid, contributionEvent }
  }

  /**
   * Check if PR is mergeable
   */
  async checkMergeable(repoId: Hex, prNumber: number): Promise<boolean> {
    const pr = await this.getPR(repoId, prNumber)
    if (!pr || pr.state !== 'open') return false

    // Check if target branch has moved
    const targetBranch = await this.repoManager.getBranch(
      repoId,
      pr.targetBranch,
    )
    if (!targetBranch) return false

    // Simple check: if base commit still matches target branch tip, it's mergeable
    // Real implementation would check for conflicts
    const currentBase = decodeBytes32ToOid(targetBranch.tipCommitCid)
    return pr.baseCommit === currentBase
  }

  /**
   * Get files changed in a PR
   */
  async getChangedFiles(
    repoId: Hex,
    prNumber: number,
  ): Promise<
    Array<{
      path: string
      additions: number
      deletions: number
      status: 'added' | 'modified' | 'deleted'
    }>
  > {
    const pr = await this.getPR(repoId, prNumber)
    if (!pr) return []

    const objectStore = this.repoManager.getObjectStore(repoId)

    // Get tree for head and base commits
    const headCommit = await objectStore.getCommit(pr.headCommit)
    const baseCommit = await objectStore.getCommit(pr.baseCommit)
    if (!headCommit || !baseCommit) return []

    const headTree = await objectStore.getTree(headCommit.tree)
    const baseTree = await objectStore.getTree(baseCommit.tree)
    if (!headTree || !baseTree) return []

    // Simple comparison (doesn't handle nested directories well)
    const changedFiles: Array<{
      path: string
      additions: number
      deletions: number
      status: 'added' | 'modified' | 'deleted'
    }> = []

    const baseFiles = new Map(baseTree.entries.map((e) => [e.name, e.oid]))
    const headFiles = new Map(headTree.entries.map((e) => [e.name, e.oid]))

    // Find added and modified files
    for (const [name, oid] of headFiles) {
      const baseOid = baseFiles.get(name)
      if (!baseOid) {
        changedFiles.push({
          path: name,
          additions: 0,
          deletions: 0,
          status: 'added',
        })
      } else if (baseOid !== oid) {
        changedFiles.push({
          path: name,
          additions: 0,
          deletions: 0,
          status: 'modified',
        })
      }
    }

    // Find deleted files
    for (const name of baseFiles.keys()) {
      if (!headFiles.has(name)) {
        changedFiles.push({
          path: name,
          additions: 0,
          deletions: 0,
          status: 'deleted',
        })
      }
    }

    return changedFiles
  }

  /**
   * Clear caches for a repository
   */
  clearCache(repoId: Hex): void {
    this.indexCache.delete(repoId)
    for (const key of this.prCache.keys()) {
      if (key.startsWith(repoId)) {
        this.prCache.delete(key)
      }
    }
  }

  /**
   * Preload index into cache
   */
  async preloadIndex(repoId: Hex, prIndexCid: string): Promise<void> {
    const result = await this.backend.download(prIndexCid)
    if (result) {
      const index = expectJson(
        result.content.toString(),
        PRIndexSchema,
        'PR index',
      )
      this.indexCache.set(repoId, index)
    }
  }
}
