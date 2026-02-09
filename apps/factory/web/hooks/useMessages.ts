import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount, useSignMessage } from 'wagmi'
import { apiFetchSigned, apiPostSigned } from '../lib/api'

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
  const { signMessageAsync } = useSignMessage()

  return useQuery({
    queryKey: ['messages', 'status', address],
    queryFn: async (): Promise<MessagingStatus> => {
      if (!address) {
        return { connected: false, isInitialized: false, unreadCount: 0 }
      }
      return apiFetchSigned('/api/messages/status', {
        address,
        signMessageAsync,
        cache: true,
      })
    },
    enabled: !!address,
    refetchInterval: 30_000,
    staleTime: 10_000,
  })
}

export function useConversations() {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()

  return useQuery({
    queryKey: ['messages', 'conversations', address],
    queryFn: () =>
      apiFetchSigned<{ conversations: Conversation[] }>('/api/messages', {
        address: address as string,
        signMessageAsync,
        cache: true,
      }),
    enabled: !!address,
    staleTime: 30_000,
  })
}

export function useConversation(recipientFid: number) {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()

  return useQuery({
    queryKey: ['messages', 'conversation', recipientFid, address],
    queryFn: () =>
      apiFetchSigned<
        { conversation: Conversation } | { error: { code: string } }
      >(`/api/messages/conversation/${recipientFid}`, {
        address: address as string,
        signMessageAsync,
        cache: true,
      }),
    enabled: !!address && !!recipientFid,
    staleTime: 30_000,
  })
}

export function useMessages(
  recipientFid: number,
  options?: { before?: string; after?: string; limit?: number },
) {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()

  return useQuery({
    queryKey: ['messages', 'messages', recipientFid, options, address],
    queryFn: async (): Promise<{ messages: Message[] }> => {
      const params = new URLSearchParams()
      if (options?.before) params.set('before', options.before)
      if (options?.after) params.set('after', options.after)
      if (options?.limit) params.set('limit', String(options.limit))

      return apiFetchSigned<{ messages: Message[] }>(
        `/api/messages/conversation/${recipientFid}/messages?${params}`,
        {
          address: address as string,
          signMessageAsync,
          cache: true,
        },
      )
    },
    enabled: !!address && !!recipientFid,
    refetchInterval: 5_000,
    staleTime: 5_000,
  })
}

export function useSendMessage() {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: {
      recipientFid: number
      text: string
      embeds?: Array<{ url: string }>
      replyTo?: string
    }) =>
      apiPostSigned('/api/messages', params, address as string, signMessageAsync),
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
  const { signMessageAsync } = useSignMessage()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (recipientFid: number) =>
      apiPostSigned(
        `/api/messages/conversation/${recipientFid}/read`,
        {},
        address as string,
        signMessageAsync,
      ),
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
  const { signMessageAsync } = useSignMessage()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (recipientFid: number) =>
      apiPostSigned(
        `/api/messages/conversation/${recipientFid}/archive`,
        {},
        address as string,
        signMessageAsync,
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['messages', 'conversations'],
      }),
  })
}

export function useMuteConversation() {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { recipientFid: number; muted: boolean }) =>
      apiPostSigned(
        `/api/messages/conversation/${params.recipientFid}/mute`,
        { muted: params.muted },
        address as string,
        signMessageAsync,
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
  const { signMessageAsync } = useSignMessage()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () =>
      apiPostSigned(
        '/api/messages/reconnect',
        {},
        address as string,
        signMessageAsync,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['messages'] }),
  })
}

export function useSearchUsers(query: string) {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()

  return useQuery({
    queryKey: ['messages', 'search', query, address],
    queryFn: () =>
      apiFetchSigned<{ users: ConversationUser[] }>(
        `/api/messages/search/users?q=${encodeURIComponent(query)}`,
        {
          address: address as string,
          signMessageAsync,
          cache: true,
        },
      ),
    enabled: !!address && query.length >= 2,
    staleTime: 60_000,
  })
}

export function useEncryptionKey() {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()

  return useQuery({
    queryKey: ['messages', 'encryption-key', address],
    queryFn: () =>
      apiFetchSigned('/api/messages/encryption-key', {
        address: address as string,
        signMessageAsync,
        cache: true,
      }),
    enabled: !!address,
    staleTime: 300_000,
  })
}

export function usePublishEncryptionKey() {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () =>
      apiPostSigned(
        '/api/messages/encryption-key/publish',
        {},
        address as string,
        signMessageAsync,
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['messages', 'encryption-key'],
      }),
  })
}
