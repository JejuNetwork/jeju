import { isRecord } from '@jejunetwork/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, extractDataSafe } from '../lib/client'

export type DiscussionCategory =
  | 'general'
  | 'questions'
  | 'announcements'
  | 'show'
  | 'ideas'

export interface DiscussionAuthor {
  id: string
  name: string
  avatar: string
}

export interface DiscussionReply {
  id: string
  author: DiscussionAuthor
  content: string
  createdAt: number
  likes: number
  isAnswer?: boolean
}

export interface Discussion {
  id: string
  title: string
  content: string
  author: DiscussionAuthor
  category: DiscussionCategory
  replies: number
  views: number
  likes: number
  isPinned: boolean
  isLocked: boolean
  createdAt: number
  lastReplyAt: number
  tags: string[]
}

interface DiscussionsResponse {
  discussions: Discussion[]
}

function isDiscussionsResponse(data: unknown): data is DiscussionsResponse {
  if (!isRecord(data)) return false
  return Array.isArray(data.discussions)
}

interface DiscussionDetailResponse {
  discussion: Discussion
  replies?: DiscussionReply[]
}

function isDiscussionDetailResponse(
  data: unknown,
): data is DiscussionDetailResponse {
  if (!isRecord(data)) return false
  return isRecord(data.discussion)
}

function isDiscussion(data: unknown): data is Discussion {
  if (!isRecord(data)) return false
  return (
    typeof data.id === 'string' &&
    typeof data.title === 'string' &&
    typeof data.content === 'string'
  )
}

function isDiscussionReply(data: unknown): data is DiscussionReply {
  if (!isRecord(data)) return false
  return typeof data.id === 'string' && typeof data.content === 'string'
}

async function fetchDiscussions(
  _resourceType: string,
  _resourceId: string,
  query?: { category?: DiscussionCategory },
): Promise<Discussion[]> {
  const response = await api.api.discussions.get({
    query: {
      category: query?.category,
    },
  })

  const data = extractDataSafe(response)
  if (!isDiscussionsResponse(data)) return []

  return data.discussions
}

async function fetchDiscussion(
  _resourceType: string,
  _resourceId: string,
  discussionId: string,
): Promise<{ discussion: Discussion; replies: DiscussionReply[] } | null> {
  const response = await api.api.discussions({ discussionId }).get()
  const data = extractDataSafe(response)
  if (!isDiscussionDetailResponse(data)) return null

  const replies = Array.isArray(data.replies) ? data.replies : []

  return {
    discussion: data.discussion,
    replies,
  }
}

async function createDiscussion(
  _resourceType: string,
  _resourceId: string,
  input: {
    title: string
    content: string
    category: DiscussionCategory
    tags: string[]
  },
): Promise<Discussion | null> {
  const response = await api.api.discussions.post({
    title: input.title,
    content: input.content,
    category: input.category,
    tags: input.tags,
  })

  const data = extractDataSafe(response)
  if (!isDiscussion(data)) return null
  return data
}

async function replyToDiscussion(
  _resourceType: string,
  _resourceId: string,
  discussionId: string,
  content: string,
): Promise<DiscussionReply | null> {
  const response = await api.api
    .discussions({ discussionId })
    .replies.post({ content })

  const data = extractDataSafe(response)
  if (!isDiscussionReply(data)) return null
  return data
}

export function useDiscussions(
  resourceType: string,
  resourceId: string,
  query?: { category?: DiscussionCategory },
) {
  const {
    data: discussions,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['discussions', resourceType, resourceId, query],
    queryFn: () => fetchDiscussions(resourceType, resourceId, query),
    enabled: !!resourceType && !!resourceId,
    staleTime: 30000,
  })

  return {
    discussions: discussions || [],
    isLoading,
    error,
    refetch,
  }
}

export function useDiscussion(
  resourceType: string,
  resourceId: string,
  discussionId: string,
) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['discussion', resourceType, resourceId, discussionId],
    queryFn: () => fetchDiscussion(resourceType, resourceId, discussionId),
    enabled: !!resourceType && !!resourceId && !!discussionId,
    staleTime: 30000,
  })

  return {
    discussion: data?.discussion || null,
    replies: data?.replies || [],
    isLoading,
    error,
    refetch,
  }
}

export function useCreateDiscussion(resourceType: string, resourceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: {
      title: string
      content: string
      category: DiscussionCategory
      tags: string[]
    }) => createDiscussion(resourceType, resourceId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['discussions', resourceType, resourceId],
      })
    },
  })
}

export function useReplyToDiscussion(
  resourceType: string,
  resourceId: string,
  discussionId: string,
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (content: string) =>
      replyToDiscussion(resourceType, resourceId, discussionId, content),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['discussion', resourceType, resourceId, discussionId],
      })
      queryClient.invalidateQueries({
        queryKey: ['discussions', resourceType, resourceId],
      })
    },
  })
}
