/**
 * Pull Request Routes
 */

import { Elysia } from 'elysia'
import { CreatePullBodySchema, expectValid, PullsQuerySchema } from '../schemas'
import { requireAuth } from '../validation/access-control'

interface PullRequest {
  id: string
  number: number
  repo: string
  title: string
  body: string
  status: 'open' | 'closed' | 'merged'
  isDraft: boolean
  author: { name: string; avatar?: string }
  sourceBranch: string
  targetBranch: string
  labels: string[]
  reviewers: Array<{ name: string; status: string }>
  commits: number
  additions: number
  deletions: number
  changedFiles: number
  checks: { passed: number; failed: number; pending: number }
  createdAt: number
  updatedAt: number
}

interface Review {
  id: string
  author: { name: string; avatar?: string }
  state: 'approved' | 'changes_requested' | 'commented'
  body: string
  submittedAt: number
}

export const pullsRoutes = new Elysia({ prefix: '/api/pulls' })
  .get(
    '/',
    async ({ query }) => {
      const validated = expectValid(PullsQuerySchema, query, 'query params')
      const page = Number.parseInt(validated.page || '1', 10)
      const pulls: PullRequest[] = [
        {
          id: '45',
          number: 45,
          repo: 'jeju/protocol',
          title: 'Fix contract verification on Base Sepolia',
          body: 'This PR fixes the contract verification issue...',
          status: 'open',
          isDraft: false,
          author: {
            name: 'bob.eth',
            avatar: 'https://avatars.githubusercontent.com/u/2?v=4',
          },
          sourceBranch: 'fix/verification',
          targetBranch: 'main',
          labels: ['bug fix', 'contracts'],
          reviewers: [
            { name: 'alice.eth', status: 'approved' },
            { name: 'charlie.eth', status: 'pending' },
          ],
          commits: 2,
          additions: 68,
          deletions: 5,
          changedFiles: 3,
          checks: { passed: 4, failed: 0, pending: 1 },
          createdAt: Date.now() - 1 * 24 * 60 * 60 * 1000,
          updatedAt: Date.now() - 2 * 60 * 60 * 1000,
        },
      ]
      return { pulls, total: pulls.length, page }
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
      const pr: PullRequest = {
        id: `pr-${Date.now()}`,
        number: Math.floor(Math.random() * 1000),
        repo: validated.repo,
        title: validated.title,
        body: validated.body,
        sourceBranch: validated.sourceBranch,
        targetBranch: validated.targetBranch,
        isDraft: validated.isDraft ?? false,
        status: 'open',
        author: { name: authResult.address },
        labels: [],
        reviewers: [],
        commits: 0,
        additions: 0,
        deletions: 0,
        changedFiles: 0,
        checks: { passed: 0, failed: 0, pending: 0 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      set.status = 201
      return pr
    },
    { detail: { tags: ['pulls'], summary: 'Create pull request' } },
  )
  .get(
    '/:prNumber',
    async ({ params }) => {
      const pr: PullRequest = {
        id: `pr-${params.prNumber}`,
        number: Number.parseInt(params.prNumber, 10),
        repo: 'jeju/protocol',
        title: 'Example PR',
        body: 'PR description...',
        status: 'open',
        isDraft: false,
        author: { name: 'bob.eth' },
        sourceBranch: 'feature/example',
        targetBranch: 'main',
        labels: [],
        reviewers: [],
        commits: 3,
        additions: 100,
        deletions: 20,
        changedFiles: 5,
        checks: { passed: 3, failed: 0, pending: 0 },
        createdAt: Date.now() - 24 * 60 * 60 * 1000,
        updatedAt: Date.now() - 60 * 60 * 1000,
      }
      const reviews: Review[] = []
      return { pullRequest: pr, reviews }
    },
    { detail: { tags: ['pulls'], summary: 'Get pull request' } },
  )
  .post(
    '/:prNumber/merge',
    async ({ params, body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }
      const { method } = body as { method?: 'merge' | 'squash' | 'rebase' }
      return {
        success: true,
        prNumber: params.prNumber,
        method: method || 'merge',
        sha: `sha-${Date.now()}`,
      }
    },
    { detail: { tags: ['pulls'], summary: 'Merge pull request' } },
  )
  .post(
    '/:prNumber/reviews',
    async ({ body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }
      const { event, body: reviewBody } = body as {
        event: 'approve' | 'request_changes' | 'comment'
        body: string
      }
      const stateMap = {
        approve: 'approved',
        request_changes: 'changes_requested',
        comment: 'commented',
      } as const
      const review: Review = {
        id: `review-${Date.now()}`,
        author: { name: authResult.address.slice(0, 8) },
        state: stateMap[event],
        body: reviewBody,
        submittedAt: Date.now(),
      }
      set.status = 201
      return review
    },
    { detail: { tags: ['pulls'], summary: 'Submit review' } },
  )
