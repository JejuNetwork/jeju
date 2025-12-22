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

interface IssueComment {
  id: string
  author: { name: string; avatar?: string }
  body: string
  createdAt: number
}

export const issuesRoutes = new Elysia({ prefix: '/api/issues' })
  .get(
    '/',
    async ({ query }) => {
      const validated = expectValid(IssuesQuerySchema, query, 'query params')
      const page = Number.parseInt(validated.page || '1', 10)
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
    { detail: { tags: ['issues'], summary: 'List issues' } },
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
    { detail: { tags: ['issues'], summary: 'Create issue' } },
  )
  .get(
    '/:issueNumber',
    async ({ params }) => {
      const issue: Issue = {
        id: `issue-${params.issueNumber}`,
        number: Number.parseInt(params.issueNumber, 10),
        repo: 'jeju/protocol',
        title: 'Example Issue',
        body: 'Issue description...',
        status: 'open',
        author: { name: 'alice.eth' },
        labels: ['bug'],
        assignees: [],
        comments: 3,
        createdAt: Date.now() - 24 * 60 * 60 * 1000,
        updatedAt: Date.now() - 60 * 60 * 1000,
      }
      const comments: IssueComment[] = [
        {
          id: '1',
          author: { name: 'bob.eth' },
          body: 'I can reproduce this.',
          createdAt: Date.now() - 12 * 60 * 60 * 1000,
        },
      ]
      return { issue, comments }
    },
    { detail: { tags: ['issues'], summary: 'Get issue' } },
  )
  .patch(
    '/:issueNumber',
    async ({ params, body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }
      const updates = body as Partial<Issue>
      const issue: Issue = {
        id: `issue-${params.issueNumber}`,
        number: Number.parseInt(params.issueNumber, 10),
        repo: 'jeju/protocol',
        title: updates.title || 'Issue',
        body: updates.body || '',
        status: updates.status || 'open',
        author: { name: 'alice.eth' },
        labels: updates.labels || [],
        assignees: [],
        comments: 0,
        createdAt: Date.now() - 24 * 60 * 60 * 1000,
        updatedAt: Date.now(),
      }
      return issue
    },
    { detail: { tags: ['issues'], summary: 'Update issue' } },
  )
  .post(
    '/:issueNumber/comments',
    async ({ body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }
      const { content } = body as { content: string }
      const comment: IssueComment = {
        id: `comment-${Date.now()}`,
        author: { name: authResult.address.slice(0, 8) },
        body: content,
        createdAt: Date.now(),
      }
      set.status = 201
      return comment
    },
    { detail: { tags: ['issues'], summary: 'Add comment' } },
  )
