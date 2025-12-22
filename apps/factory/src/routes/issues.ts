/**
 * Issue Tracking Routes
 */

import { Elysia } from 'elysia'
import {
  CreateIssueBodySchema,
  expectValid,
  IssuesQuerySchema,
} from '../schemas'
import { requireAuth } from '../validation/access-control'

interface Issue {
  id: string
  number: number
  repo: string
  title: string
  body: string
  status: 'open' | 'closed'
  author: { name: string; avatar?: string }
  labels: string[]
  assignees: Array<{ name: string; avatar?: string }>
  comments: number
  createdAt: number
  updatedAt: number
}

export const issuesRoutes = new Elysia({ prefix: '/api/issues' })
  .get(
    '/',
    async ({ query }) => {
      const validated = expectValid(IssuesQuerySchema, query, 'query params')
      const page = parseInt(validated.page || '1', 10)

      const issues: Issue[] = [
        {
          id: '42',
          number: 42,
          repo: 'jeju/protocol',
          title: 'Bug: Smart contract verification fails on Base Sepolia',
          body: 'Description of the bug...',
          status: 'open',
          author: {
            name: 'alice.eth',
            avatar: 'https://avatars.githubusercontent.com/u/1?v=4',
          },
          labels: ['bug', 'help wanted'],
          assignees: [
            {
              name: 'bob.eth',
              avatar: 'https://avatars.githubusercontent.com/u/2?v=4',
            },
          ],
          comments: 8,
          createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
          updatedAt: Date.now() - 1 * 60 * 60 * 1000,
        },
      ]

      return { issues, total: issues.length, page }
    },
    {
      detail: {
        tags: ['issues'],
        summary: 'List issues',
        description: 'Get a list of issues',
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

      const validated = expectValid(CreateIssueBodySchema, body, 'request body')

      const issue: Issue = {
        id: `issue-${Date.now()}`,
        number: Math.floor(Math.random() * 1000),
        repo: validated.repo,
        title: validated.title,
        body: validated.body,
        labels: validated.labels || [],
        assignees: (validated.assignees || []).map((addr) => ({ name: addr })),
        status: 'open',
        author: { name: authResult.address },
        comments: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      set.status = 201
      return issue
    },
    {
      detail: {
        tags: ['issues'],
        summary: 'Create issue',
        description: 'Create a new issue',
      },
    },
  )
