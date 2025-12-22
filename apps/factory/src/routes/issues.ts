/**
 * Issue Tracking Routes
 */

import { Elysia, t } from 'elysia'
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
      const page = parseInt(query.page || '1', 10)

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
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        repo: t.Optional(t.String()),
        status: t.Optional(t.String()),
        label: t.Optional(t.String()),
        assignee: t.Optional(t.String()),
      }),
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

      const issue: Issue = {
        id: `issue-${Date.now()}`,
        number: Math.floor(Math.random() * 1000),
        repo: body.repo,
        title: body.title,
        body: body.body,
        labels: body.labels || [],
        assignees: (body.assignees || []).map((addr) => ({ name: addr })),
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
      body: t.Object({
        repo: t.String({ minLength: 1 }),
        title: t.String({ minLength: 1, maxLength: 200 }),
        body: t.String({ minLength: 10 }),
        labels: t.Optional(t.Array(t.String())),
        assignees: t.Optional(t.Array(t.String())),
      }),
      detail: {
        tags: ['issues'],
        summary: 'Create issue',
        description: 'Create a new issue',
      },
    },
  )
