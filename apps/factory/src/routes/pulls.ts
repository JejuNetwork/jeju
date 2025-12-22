/**
 * Pull Request Routes
 */

import { Elysia, t } from 'elysia'
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

export const pullsRoutes = new Elysia({ prefix: '/api/pulls' })
  .get(
    '/',
    async ({ query }) => {
      const page = parseInt(query.page || '1', 10)

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
    {
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        repo: t.Optional(t.String()),
        status: t.Optional(t.String()),
        author: t.Optional(t.String()),
      }),
      detail: {
        tags: ['pulls'],
        summary: 'List pull requests',
        description: 'Get a list of pull requests',
      },
    },
  )
  .post(
    '/',
    async ({ body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }

      const pr: PullRequest = {
        id: `pr-${Date.now()}`,
        number: Math.floor(Math.random() * 1000),
        repo: body.repo,
        title: body.title,
        body: body.body,
        sourceBranch: body.sourceBranch,
        targetBranch: body.targetBranch,
        isDraft: body.isDraft ?? false,
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
    {
      body: t.Object({
        repo: t.String({ minLength: 1 }),
        title: t.String({ minLength: 1, maxLength: 200 }),
        body: t.String({ minLength: 10 }),
        sourceBranch: t.String({ minLength: 1 }),
        targetBranch: t.String({ minLength: 1 }),
        isDraft: t.Optional(t.Boolean()),
      }),
      detail: {
        tags: ['pulls'],
        summary: 'Create pull request',
        description: 'Create a new pull request',
      },
    },
  )
