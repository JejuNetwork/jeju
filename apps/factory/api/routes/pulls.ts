import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  createPullRequest as dbCreatePR,
  createPRReview as dbCreateReview,
  listPullRequests as dbListPRs,
  getPRReviews,
  getPullRequest,
  mergePullRequest,
  type PRReviewRow,
  type PullRequestRow,
} from '../db/client'
import {
  CreatePullBodySchema,
  expectValid,
  LabelsSchema,
  PullMergeBodySchema,
  PullReviewBodySchema,
  PullsQuerySchema,
} from '../schemas'

// Schema for DB column parsing
const ReviewersSchema = z.array(z.string())

import { requireAuth } from '../validation/access-control'

export interface PRAuthor {
  name: string
  avatar?: string
}

export interface PRReviewer {
  name: string
  status: string
}

export interface PRChecks {
  passed: number
  failed: number
  pending: number
}

export interface PullRequest {
  id: string
  number: number
  repo: string
  title: string
  body: string
  status: 'open' | 'closed' | 'merged'
  isDraft: boolean
  author: PRAuthor
  sourceBranch: string
  targetBranch: string
  labels: string[]
  reviewers: PRReviewer[]
  commits: number
  additions: number
  deletions: number
  changedFiles: number
  checks: PRChecks
  createdAt: number
  updatedAt: number
}

export interface Review {
  id: string
  author: PRAuthor
  state: 'approved' | 'changes_requested' | 'commented'
  body: string
  submittedAt: number
}

function transformReview(row: PRReviewRow): Review {
  return {
    id: row.id,
    author: {
      name: row.author.slice(0, 8),
      avatar: `https://api.dicebear.com/7.x/identicon/svg?seed=${row.author}`,
    },
    state: row.state,
    body: row.body,
    submittedAt: row.submitted_at,
  }
}

function transformPR(row: PullRequestRow): PullRequest {
  const reviewersList = ReviewersSchema.parse(JSON.parse(row.reviewers))
  return {
    id: row.id,
    number: row.number,
    repo: row.repo,
    title: row.title,
    body: row.body,
    status: row.status,
    isDraft: row.is_draft === 1,
    author: {
      name: row.author,
      avatar: `https://api.dicebear.com/7.x/identicon/svg?seed=${row.author}`,
    },
    sourceBranch: row.source_branch,
    targetBranch: row.target_branch,
    labels: LabelsSchema.parse(JSON.parse(row.labels)),
    reviewers: reviewersList.map((name) => ({ name, status: 'pending' })),
    commits: row.commits,
    additions: row.additions,
    deletions: row.deletions,
    changedFiles: row.changed_files,
    checks: {
      passed: row.checks_passed,
      failed: row.checks_failed,
      pending: row.checks_pending,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const pullsRoutes = new Elysia({ prefix: '/api/pulls' })
  .get(
    '/',
    async ({ query }) => {
      const validated = expectValid(PullsQuerySchema, query, 'query params')
      const page = Number.parseInt(validated.page ?? '1', 10)

      const result = await dbListPRs({
        repo: validated.repo,
        status: validated.status,
        author: validated.author,
        page,
      })

      const pulls = result.pulls.map(transformPR)
      return { pulls, total: result.total, page }
    },
    { detail: { tags: ['pulls'], summary: 'List pull requests' } },
  )
  .post(
    '/',
    async ({ body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }
      const validated = expectValid(CreatePullBodySchema, body, 'request body')

      const row = await dbCreatePR({
        repo: validated.repo,
        title: validated.title,
        body: validated.body,
        sourceBranch: validated.sourceBranch,
        targetBranch: validated.targetBranch,
        isDraft: validated.isDraft,
        author: authResult.address,
      })

      set.status = 201
      return transformPR(row)
    },
    { detail: { tags: ['pulls'], summary: 'Create pull request' } },
  )
  .get(
    '/:prId',
    async ({ params, set }) => {
      const row = await getPullRequest(params.prId)
      if (!row) {
        set.status = 404
        return {
          error: {
            code: 'NOT_FOUND',
            message: `Pull request ${params.prId} not found`,
          },
        }
      }
      return transformPR(row)
    },
    { detail: { tags: ['pulls'], summary: 'Get pull request' } },
  )
  .post(
    '/:prId/merge',
    async ({ params, body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }
      const row = await getPullRequest(params.prId)
      if (!row) {
        set.status = 404
        return {
          error: { code: 'NOT_FOUND', message: `PR ${params.prId} not found` },
        }
      }

      // Check if user has permission to merge
      // Must be PR author OR repo owner (repo format: owner/reponame)
      const repoOwner = row.repo.split('/')[0]?.toLowerCase()
      const isAuthor =
        row.author.toLowerCase() === authResult.address.toLowerCase()
      const isRepoOwner = repoOwner === authResult.address.toLowerCase()

      if (!isAuthor && !isRepoOwner) {
        set.status = 403
        return {
          error: {
            code: 'FORBIDDEN',
            message: 'Only the PR author or repository owner can merge',
          },
        }
      }

      const validated = expectValid(PullMergeBodySchema, body, 'request body')

      // Update PR status to merged in the database
      const merged = await mergePullRequest(params.prId)
      if (!merged) {
        set.status = 500
        return {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to merge pull request',
          },
        }
      }

      return {
        success: true,
        prId: params.prId,
        method: validated.method ?? 'merge',
        sha: `merged-${Date.now().toString(36)}`,
      }
    },
    { detail: { tags: ['pulls'], summary: 'Merge pull request' } },
  )
  .post(
    '/:prId/reviews',
    async ({ params, body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }
      const row = await getPullRequest(params.prId)
      if (!row) {
        set.status = 404
        return {
          error: { code: 'NOT_FOUND', message: `PR ${params.prId} not found` },
        }
      }
      const validated = expectValid(PullReviewBodySchema, body, 'request body')
      const stateMap: Record<
        typeof validated.event,
        'approved' | 'changes_requested' | 'commented'
      > = {
        approve: 'approved',
        request_changes: 'changes_requested',
        comment: 'commented',
      }

      const reviewRow = await dbCreateReview({
        prId: params.prId,
        author: authResult.address,
        state: stateMap[validated.event],
        body: validated.body,
      })

      set.status = 201
      return transformReview(reviewRow)
    },
    { detail: { tags: ['pulls'], summary: 'Submit review' } },
  )
  .get(
    '/:prId/reviews',
    async ({ params, set }) => {
      const row = await getPullRequest(params.prId)
      if (!row) {
        set.status = 404
        return {
          error: { code: 'NOT_FOUND', message: `PR ${params.prId} not found` },
        }
      }

      const reviews = await getPRReviews(params.prId)
      return { reviews: reviews.map(transformReview), total: reviews.length }
    },
    { detail: { tags: ['pulls'], summary: 'Get reviews' } },
  )
