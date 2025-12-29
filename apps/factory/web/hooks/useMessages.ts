import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { API_BASE, apiFetch, apiPost, getHeaders } from '../lib/api'

export interface ConversationUser {
  fid: number
  username: string
  displayName: string
  pfpUrl: string
}

export interface Message {
  id: string
  conversationId: string
  senderFid: number
  recipientFid: number
  text: string
  embeds: Array<{ url: string }>
  replyTo?: string
  timestamp: number
  isRead: boolean
  isFromMe: boolean
}

export interface Conversation {
  id: string
  participants: number[]
  otherUser: ConversationUser | null
  unreadCount: number
  lastMessage: {
    id: string
    text: string
    senderFid: number
    timestamp: number
  } | null
  isMuted: boolean
  isArchived: boolean
  createdAt: number
  updatedAt: number
}

export interface MessagingStatus {
  connected: boolean
  isInitialized: boolean
  conversationCount?: number
  unreadCount: number
  fid?: number
}

export function useMessagingStatus() {
  const { address } = useAccount()

  return useQuery({
    queryKey: ['messages', 'status', address],
    queryFn: async (): Promise<MessagingStatus> => {
      if (!address) {
        return { connected: false, isInitialized: false, unreadCount: 0 }
      }
      return apiFetch('/api/messages/status', { address })
    },
    enabled: !!address,
    refetchInterval: 30_000,
    staleTime: 10_000,
  })
}

export function useConversations() {
  const { address } = useAccount()

  return useQuery({
    queryKey: ['messages', 'conversations', address],
    queryFn: () =>
      apiFetch<{ conversations: Conversation[] }>('/api/messages', { address }),
    enabled: !!address,
    staleTime: 30_000,
  })
}

export function useConversation(recipientFid: number) {
  const { address } = useAccount()

  return useQuery({
    queryKey: ['messages', 'conversation', recipientFid, address],
    queryFn: () =>
      apiFetch<{ conversation: Conversation } | { error: { code: string } }>(
        `/api/messages/conversation/${recipientFid}`,
        { address },
      ),
    enabled: !!address && !!recipientFid,
    staleTime: 30_000,
  })
}

export function useMessages(
  recipientFid: number,
  options?: { before?: string; after?: string; limit?: number },
) {
  const { address } = useAccount()

  return useQuery({
    queryKey: ['messages', 'messages', recipientFid, options, address],
    queryFn: async (): Promise<{ messages: Message[] }> => {
      const params = new URLSearchParams()
      if (options?.before) params.set('before', options.before)
      if (options?.after) params.set('after', options.after)
      if (options?.limit) params.set('limit', String(options.limit))

      const response = await fetch(
        `${API_BASE}/api/messages/conversation/${recipientFid}/messages?${params}`,
        { headers: getHeaders(address) },
      )
      return response.json()
    },
    enabled: !!address && !!recipientFid,
    refetchInterval: 5_000,
    staleTime: 5_000,
  })
}

export function useSendMessage() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: {
      recipientFid: number
      text: string
      embeds?: Array<{ url: string }>
      replyTo?: string
    }) => apiPost('/api/messages', params, address),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['messages', 'messages', variables.recipientFid],
      })
      queryClient.invalidateQueries({ queryKey: ['messages', 'conversations'] })
      queryClient.invalidateQueries({ queryKey: ['messages', 'status'] })
    },
  })
}

export function useMarkAsRead() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (recipientFid: number) =>
      apiPost(`/api/messages/conversation/${recipientFid}/read`, {}, address),
    onSuccess: (_, recipientFid) => {
      queryClient.invalidateQueries({
        queryKey: ['messages', 'conversation', recipientFid],
      })
      queryClient.invalidateQueries({ queryKey: ['messages', 'conversations'] })
      queryClient.invalidateQueries({ queryKey: ['messages', 'status'] })
    },
  })
}

export function useArchiveConversation() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (recipientFid: number) =>
      apiPost(
        `/api/messages/conversation/${recipientFid}/archive`,
        {},
        address,
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['messages', 'conversations'],
      }),
  })
}

export function useMuteConversation() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { recipientFid: number; muted: boolean }) =>
      apiPost(
        `/api/messages/conversation/${params.recipientFid}/mute`,
        { muted: params.muted },
        address,
      ),
    onSuccess: (_, { recipientFid }) => {
      queryClient.invalidateQueries({
        queryKey: ['messages', 'conversation', recipientFid],
      })
      queryClient.invalidateQueries({ queryKey: ['messages', 'conversations'] })
    },
  })
}

export function useReconnect() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => apiPost('/api/messages/reconnect', {}, address),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['messages'] }),
  })
}

export function useSearchUsers(query: string) {
  const { address } = useAccount()

  return useQuery({
    queryKey: ['messages', 'search', query, address],
    queryFn: () =>
      apiFetch<{ users: ConversationUser[] }>(
        `/api/messages/search/users?q=${encodeURIComponent(query)}`,
        { address },
      ),
    enabled: !!address && query.length >= 2,
    staleTime: 60_000,
  })
}

export function useEncryptionKey() {
  const { address } = useAccount()

  return useQuery({
    queryKey: ['messages', 'encryption-key', address],
    queryFn: () => apiFetch('/api/messages/encryption-key', { address }),
    enabled: !!address,
    staleTime: 300_000,
  })
}

export function usePublishEncryptionKey() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () =>
      apiPost('/api/messages/encryption-key/publish', {}, address),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['messages', 'encryption-key'],
      }),
  })
}
