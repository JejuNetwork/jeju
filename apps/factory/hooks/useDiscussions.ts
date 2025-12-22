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
  total: number
  page: number
}

interface DiscussionDetailResponse {
  discussion: Discussion
  replies: DiscussionReply[]
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

  const data = extractDataSafe(response) as DiscussionsResponse | null
  if (!data?.discussions) return []

  return data.discussions
}

async function fetchDiscussion(
  _resourceType: string,
  _resourceId: string,
  discussionId: string,
): Promise<{ discussion: Discussion; replies: DiscussionReply[] } | null> {
  const response = await api.api.discussions({ discussionId }).get()
  const data = extractDataSafe(response) as DiscussionDetailResponse | null
  if (!data?.discussion) return null

  return {
    discussion: data.discussion,
    replies: data.replies || [],
  }
}

async function createDiscussion(
  _resourceType: string,
  _resourceId: string,
  data: {
    title: string
    content: string
    category: DiscussionCategory
    tags: string[]
  },
): Promise<Discussion | null> {
  const response = await api.api.discussions.post({
    title: data.title,
    content: data.content,
    category: data.category,
    tags: data.tags,
  })

  return extractDataSafe(response) as Discussion | null
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

  return extractDataSafe(response) as DiscussionReply | null
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
