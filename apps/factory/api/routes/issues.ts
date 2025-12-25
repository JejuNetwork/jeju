/** Issues Routes */

import { Elysia } from 'elysia'
import {
  CreateIssueBodySchema,
  expectValid,
  IssueCommentBodySchema,
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
      const page = Number.parseInt(validated.page ?? '1', 10)
      const issues: Issue[] = []
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
        labels: validated.labels ?? [],
        assignees: (validated.assignees ?? []).map((addr) => ({ name: addr })),
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
    async ({ params, set }) => {
      set.status = 404
      return {
        error: {
          code: 'NOT_FOUND',
          message: `Issue #${params.issueNumber} not found`,
        },
      }
    },
    { detail: { tags: ['issues'], summary: 'Get issue' } },
  )
  .patch(
    '/:issueNumber',
    async ({ params, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }
      set.status = 404
      return {
        error: {
          code: 'NOT_FOUND',
          message: `Issue #${params.issueNumber} not found`,
        },
      }
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
      const validated = expectValid(
        IssueCommentBodySchema,
        body,
        'request body',
      )
      const comment: IssueComment = {
        id: `comment-${Date.now()}`,
        author: { name: authResult.address.slice(0, 8) },
        body: validated.content,
        createdAt: Date.now(),
      }
      set.status = 201
      return comment
    },
    { detail: { tags: ['issues'], summary: 'Add comment' } },
  )
