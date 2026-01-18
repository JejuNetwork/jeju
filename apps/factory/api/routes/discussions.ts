import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  type DiscussionReplyRow,
  type DiscussionRow,
  createDiscussion as dbCreateDiscussion,
  createDiscussionReply as dbCreateReply,
  listDiscussions as dbListDiscussions,
  getDiscussion,
  getDiscussionReplies,
} from '../db/client'
import {
  CreateDiscussionBodySchema,
  CreateDiscussionReplyBodySchema,
  DiscussionIdParamSchema,
  DiscussionsQuerySchema,
  expectValid,
} from '../schemas'

// Schema for discussion tags
const TagsSchema = z.array(z.string())

import { requireAuth } from '../validation/access-control'

export interface DiscussionAuthor {
  id: string
  name: string
  avatar: string
}

export interface Discussion {
  id: string
  title: string
  content: string
  author: DiscussionAuthor
  category: 'general' | 'questions' | 'announcements' | 'show' | 'ideas'
  replies: number
  views: number
  likes: number
  isPinned: boolean
  isLocked: boolean
  createdAt: number
  lastReplyAt: number
  tags: string[]
}

export interface DiscussionReply {
  id: string
  author: DiscussionAuthor
  content: string
  createdAt: number
  likes: number
  isAnswer?: boolean
}

function transformReply(row: DiscussionReplyRow): DiscussionReply {
  return {
    id: row.id,
    author: {
      id: row.author,
      name: row.author_name,
      avatar: row.author_avatar,
    },
    content: row.content,
    createdAt: row.created_at,
    likes: row.likes,
    isAnswer: row.is_answer === 1,
  }
}

function transformDiscussion(row: DiscussionRow): Discussion {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    author: {
      id: row.author,
      name: row.author_name,
      avatar: row.author_avatar,
    },
    category: row.category,
    tags: TagsSchema.parse(JSON.parse(row.tags)),
    replies: row.replies_count,
    views: row.views,
    likes: row.likes,
    isPinned: row.is_pinned === 1,
    isLocked: row.is_locked === 1,
    createdAt: row.created_at,
    lastReplyAt: row.last_reply_at,
  }
}

export const discussionsRoutes = new Elysia({ prefix: '/api/discussions' })
  .get(
    '/',
    async ({ query }) => {
      const validated = expectValid(
        DiscussionsQuerySchema,
        query,
        'query params',
      )
      const page = Number.parseInt(validated.page ?? '1', 10)

      const result = await dbListDiscussions({
        category: validated.category,
        page,
      })

      const discussions = result.discussions.map(transformDiscussion)
      return { discussions, total: result.total, page }
    },
    {
      detail: {
        tags: ['discussions'],
        summary: 'List discussions',
        description: 'Get a list of discussions',
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

      const validated = expectValid(
        CreateDiscussionBodySchema,
        body,
        'request body',
      )

      const row = await dbCreateDiscussion({
        title: validated.title,
        content: validated.content,
        category: validated.category,
        tags: validated.tags,
        author: authResult.address,
        authorName: authResult.address.slice(0, 8),
        authorAvatar: `https://api.dicebear.com/7.x/identicon/svg?seed=${authResult.address}`,
      })

      set.status = 201
      return transformDiscussion(row)
    },
    {
      detail: {
        tags: ['discussions'],
        summary: 'Create discussion',
        description: 'Create a new discussion',
      },
    },
  )
  .get(
    '/:discussionId',
    async ({ params, set }) => {
      const validated = expectValid(DiscussionIdParamSchema, params, 'params')
      const row = await getDiscussion(validated.discussionId)
      if (!row) {
        set.status = 404
        return {
          error: {
            code: 'NOT_FOUND',
            message: `Discussion ${validated.discussionId} not found`,
          },
        }
      }
      return transformDiscussion(row)
    },
    {
      detail: {
        tags: ['discussions'],
        summary: 'Get discussion',
        description: 'Get a discussion with its replies',
      },
    },
  )
  .post(
    '/:discussionId/replies',
    async ({ params, body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }

      const validatedParams = expectValid(
        DiscussionIdParamSchema,
        params,
        'params',
      )

      const discussion = await getDiscussion(validatedParams.discussionId)
      if (!discussion) {
        set.status = 404
        return {
          error: {
            code: 'NOT_FOUND',
            message: `Discussion ${validatedParams.discussionId} not found`,
          },
        }
      }

      const validatedBody = expectValid(
        CreateDiscussionReplyBodySchema,
        body,
        'request body',
      )

      const row = await dbCreateReply({
        discussionId: validatedParams.discussionId,
        author: authResult.address,
        authorName: authResult.address.slice(0, 8),
        authorAvatar: `https://api.dicebear.com/7.x/identicon/svg?seed=${authResult.address}`,
        content: validatedBody.content,
      })

      set.status = 201
      return transformReply(row)
    },
    {
      detail: {
        tags: ['discussions'],
        summary: 'Reply to discussion',
        description: 'Add a reply to a discussion',
      },
    },
  )
  .get(
    '/:discussionId/replies',
    async ({ params, set }) => {
      const validated = expectValid(DiscussionIdParamSchema, params, 'params')
      const discussion = await getDiscussion(validated.discussionId)
      if (!discussion) {
        set.status = 404
        return {
          error: {
            code: 'NOT_FOUND',
            message: `Discussion ${validated.discussionId} not found`,
          },
        }
      }

      const rows = await getDiscussionReplies(validated.discussionId)
      return { replies: rows.map(transformReply), total: rows.length }
    },
    {
      detail: {
        tags: ['discussions'],
        summary: 'Get discussion replies',
        description: 'Get all replies for a discussion',
      },
    },
  )
