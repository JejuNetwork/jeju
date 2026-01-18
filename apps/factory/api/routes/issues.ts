import { Elysia } from 'elysia'
import {
  createIssueComment as dbCreateComment,
  createIssue as dbCreateIssue,
  listIssues as dbListIssues,
  getIssue,
  getIssueComments,
  type IssueCommentRow,
  type IssueRow,
  updateIssue,
} from '../db/client'
import {
  AssigneesSchema,
  CreateIssueBodySchema,
  expectValid,
  IssueCommentBodySchema,
  IssuesQuerySchema,
  LabelsSchema,
  UpdateIssueBodySchema,
} from '../schemas'
import { requireAuth } from '../validation/access-control'

export interface IssueAuthor {
  name: string
  avatar?: string
}

export interface Issue {
  id: string
  number: number
  repo: string
  title: string
  body: string
  status: 'open' | 'closed'
  author: IssueAuthor
  labels: string[]
  assignees: IssueAuthor[]
  comments: number
  createdAt: number
  updatedAt: number
}

export interface IssueComment {
  id: string
  author: IssueAuthor
  body: string
  createdAt: number
}

function transformComment(row: IssueCommentRow): IssueComment {
  return {
    id: row.id,
    author: {
      name: row.author.slice(0, 8),
      avatar: `https://api.dicebear.com/7.x/identicon/svg?seed=${row.author}`,
    },
    body: row.body,
    createdAt: row.created_at,
  }
}

function transformIssue(row: IssueRow): Issue {
  const assigneesList = AssigneesSchema.parse(JSON.parse(row.assignees))
  return {
    id: row.id,
    number: row.number,
    repo: row.repo,
    title: row.title,
    body: row.body,
    status: row.status,
    author: {
      name: row.author,
      avatar: `https://api.dicebear.com/7.x/identicon/svg?seed=${row.author}`,
    },
    labels: LabelsSchema.parse(JSON.parse(row.labels)),
    assignees: assigneesList.map((addr) => ({
      name: addr,
      avatar: `https://api.dicebear.com/7.x/identicon/svg?seed=${addr}`,
    })),
    comments: row.comments_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const issuesRoutes = new Elysia({ prefix: '/api/issues' })
  .get(
    '/',
    async ({ query }) => {
      const validated = expectValid(IssuesQuerySchema, query, 'query params')
      const page = Number.parseInt(validated.page ?? '1', 10)

      const result = await dbListIssues({
        repo: validated.repo,
        status: validated.status,
        label: validated.label,
        assignee: validated.assignee,
        page,
      })

      const issues = result.issues.map(transformIssue)
      return { issues, total: result.total, page }
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

      const row = await dbCreateIssue({
        repo: validated.repo,
        title: validated.title,
        body: validated.body,
        labels: validated.labels,
        assignees: validated.assignees,
        author: authResult.address,
      })

      set.status = 201
      return transformIssue(row)
    },
    { detail: { tags: ['issues'], summary: 'Create issue' } },
  )
  .get(
    '/:issueId',
    async ({ params, set }) => {
      // Try to find by ID first, then by number if it looks like a number
      const row = await getIssue(params.issueId)
      if (!row) {
        const num = parseInt(params.issueId, 10)
        if (!Number.isNaN(num)) {
          // Without a repo context, we can't look up by number alone
          // This endpoint needs a repo param for number lookup
        }
      }
      if (!row) {
        set.status = 404
        return {
          error: {
            code: 'NOT_FOUND',
            message: `Issue ${params.issueId} not found`,
          },
        }
      }
      return transformIssue(row)
    },
    { detail: { tags: ['issues'], summary: 'Get issue' } },
  )
  .patch(
    '/:issueId',
    async ({ params, body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }
      const row = await getIssue(params.issueId)
      if (!row) {
        set.status = 404
        return {
          error: {
            code: 'NOT_FOUND',
            message: `Issue ${params.issueId} not found`,
          },
        }
      }

      // Check if user has permission to update
      // Must be issue author OR repo owner (repo format: owner/reponame)
      const repoOwner = row.repo.split('/')[0]?.toLowerCase()
      const isAuthor =
        row.author.toLowerCase() === authResult.address.toLowerCase()
      const isRepoOwner = repoOwner === authResult.address.toLowerCase()

      if (!isAuthor && !isRepoOwner) {
        set.status = 403
        return {
          error: {
            code: 'FORBIDDEN',
            message: 'Only the issue author or repository owner can update',
          },
        }
      }

      // Validate and update the issue in the database
      const validated = expectValid(UpdateIssueBodySchema, body, 'request body')
      const updated = await updateIssue(params.issueId, validated)

      return transformIssue(updated ?? row)
    },
    { detail: { tags: ['issues'], summary: 'Update issue' } },
  )
  .post(
    '/:issueId/comments',
    async ({ params, body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }
      const row = await getIssue(params.issueId)
      if (!row) {
        set.status = 404
        return {
          error: {
            code: 'NOT_FOUND',
            message: `Issue ${params.issueId} not found`,
          },
        }
      }
      const validated = expectValid(
        IssueCommentBodySchema,
        body,
        'request body',
      )

      const commentRow = await dbCreateComment({
        issueId: params.issueId,
        author: authResult.address,
        body: validated.content,
      })

      set.status = 201
      return transformComment(commentRow)
    },
    { detail: { tags: ['issues'], summary: 'Add comment' } },
  )
  .get(
    '/:issueId/comments',
    async ({ params, set }) => {
      const row = await getIssue(params.issueId)
      if (!row) {
        set.status = 404
        return {
          error: {
            code: 'NOT_FOUND',
            message: `Issue ${params.issueId} not found`,
          },
        }
      }

      const comments = await getIssueComments(params.issueId)
      return {
        comments: comments.map(transformComment),
        total: comments.length,
      }
    },
    { detail: { tags: ['issues'], summary: 'Get comments' } },
  )
