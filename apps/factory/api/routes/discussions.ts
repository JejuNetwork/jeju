/** Discussions Routes */

import { Elysia } from 'elysia'
import {
  CreateDiscussionBodySchema,
  CreateDiscussionReplyBodySchema,
  DiscussionIdParamSchema,
  DiscussionsQuerySchema,
  expectValid,
} from '../schemas'
import { requireAuth } from '../validation/access-control'

interface DiscussionAuthor {
  id: string
  name: string
  avatar: string
}

interface Discussion {
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

interface DiscussionReply {
  id: string
  author: DiscussionAuthor
  content: string
  createdAt: number
  likes: number
  isAnswer?: boolean
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
      const page = Number.parseInt(validated.page || '1', 10)

      const discussions: Discussion[] = []

      const filtered = validated.category
        ? discussions.filter((d) => d.category === validated.category)
        : discussions

      return { discussions: filtered, total: filtered.length, page }
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

      const discussion: Discussion = {
        id: `discussion-${Date.now()}`,
        title: validated.title,
        content: validated.content,
        category: validated.category,
        tags: validated.tags || [],
        author: {
          id: authResult.address,
          name: authResult.address.slice(0, 8),
          avatar: `https://api.dicebear.com/7.x/identicon/svg?seed=${authResult.address}`,
        },
        replies: 0,
        views: 0,
        likes: 0,
        isPinned: false,
        isLocked: false,
        createdAt: Date.now(),
        lastReplyAt: Date.now(),
      }

      set.status = 201
      return discussion
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
      set.status = 404
      return {
        error: {
          code: 'NOT_FOUND',
          message: `Discussion ${validated.discussionId} not found`,
        },
      }
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

      const _validatedParams = expectValid(
        DiscussionIdParamSchema,
        params,
        'params',
      )
      const validatedBody = expectValid(
        CreateDiscussionReplyBodySchema,
        body,
        'request body',
      )

      const reply: DiscussionReply = {
        id: `reply-${Date.now()}`,
        author: {
          id: authResult.address,
          name: authResult.address.slice(0, 8),
          avatar: `https://api.dicebear.com/7.x/identicon/svg?seed=${authResult.address}`,
        },
        content: validatedBody.content,
        createdAt: Date.now(),
        likes: 0,
      }

      set.status = 201
      return reply
    },
    {
      detail: {
        tags: ['discussions'],
        summary: 'Reply to discussion',
        description: 'Add a reply to a discussion',
      },
    },
  )
