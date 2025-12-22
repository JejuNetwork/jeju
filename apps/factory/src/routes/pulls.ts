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

export const pullsRoutes = new Elysia({ prefix: '/api/pulls' })
  .get(
    '/',
    async ({ query }) => {
      const validated = expectValid(PullsQuerySchema, query, 'query params')
      const page = parseInt(validated.page || '1', 10)

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
    {
      detail: {
        tags: ['pulls'],
        summary: 'Create pull request',
        description: 'Create a new pull request',
      },
    },
  )
