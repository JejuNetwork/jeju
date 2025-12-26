import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import type { Address, Hex } from 'viem'
import {
  DEFAULT_PREFERENCES,
  type Message,
  type MessagingPreferences,
  messagingService,
} from '../../api/services/messaging'
import { useWallet } from './useWallet'

export function useMessagingInit() {
  const { address, isConnected, signMessage } = useWallet()
  const [isInitialized, setIsInitialized] = useState(false)
  const [isInitializing, setIsInitializing] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!isConnected || !address) {
      setIsInitialized(false)
      return
    }

    const init = async () => {
      setIsInitializing(true)
      setError(null)

      // Initialize without XMTP signature first (can sign later)
      await messagingService.initialize(address as Address)
      setIsInitialized(true)
      setIsInitializing(false)
    }

    init().catch((err) => {
      setError(err instanceof Error ? err : new Error(String(err)))
      setIsInitializing(false)
    })

    return () => {
      messagingService.destroy()
    }
  }, [address, isConnected])

  const initializeXMTP = useCallback(async () => {
    if (!address) return

    const message = `Sign to enable encrypted messaging\n\nAddress: ${address}\nTimestamp: ${Date.now()}`
    const signature = await signMessage(message)
    await messagingService.initialize(address as Address, signature)
  }, [address, signMessage])

  return {
    isInitialized,
    isInitializing,
    error,
    initializeXMTP,
  }
}

export function useFarcasterAccount() {
  const queryClient = useQueryClient()
  const { address } = useWallet()

  const { data: account, isLoading } = useQuery({
    queryKey: ['farcaster', 'account', address],
    queryFn: () => messagingService.getFarcasterAccount(),
    enabled: !!address,
    staleTime: 60_000,
  })

  const lookupFid = useMutation({
    mutationFn: async (lookupAddress: Address) =>
      messagingService.lookupFidByAddress(lookupAddress),
  })

  const getProfile = useMutation({
    mutationFn: async (fid: number) => messagingService.getProfile(fid),
  })

  const getProfileByUsername = useMutation({
    mutationFn: async (username: string) =>
      messagingService.getProfileByUsername(username),
  })

  const linkAccount = useMutation({
    mutationFn: async (fid: number) =>
      messagingService.linkFarcasterAccount(fid),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['farcaster', 'account'] })
    },
  })

  const completeLink = useMutation({
    mutationFn: async (params: {
      fid: number
      signerPublicKey: Hex
      signerPrivateKey: Hex
    }) => messagingService.completeFarcasterLink(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['farcaster', 'account'] })
    },
  })

  const unlinkAccount = useMutation({
    mutationFn: () => messagingService.unlinkFarcasterAccount(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['farcaster', 'account'] })
    },
  })

  return {
    account,
    isLoading,
    hasFarcasterAccount: !!account,
    lookupFid,
    getProfile,
    getProfileByUsername,
    linkAccount,
    completeLink,
    unlinkAccount,
  }
}

export function useConversations() {
  const { address } = useWallet()

  return useQuery({
    queryKey: ['messaging', 'conversations', address],
    queryFn: () => messagingService.getConversations(),
    enabled: !!address,
    staleTime: 30_000,
    refetchInterval: 30_000,
  })
}

export function useMessages(conversationId: string | null) {
  const { address } = useWallet()

  return useQuery({
    queryKey: ['messaging', 'messages', conversationId, address],
    queryFn: () =>
      conversationId ? messagingService.getMessages(conversationId) : [],
    enabled: !!address && !!conversationId,
    staleTime: 10_000,
    refetchInterval: 10_000,
  })
}

export function useSendMessage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: {
      recipientAddress?: Address
      recipientFid?: number
      text: string
      replyTo?: string
    }) => messagingService.sendMessage(params),
    onSuccess: (message) => {
      queryClient.invalidateQueries({
        queryKey: ['messaging', 'messages', message.conversationId],
      })
      queryClient.invalidateQueries({
        queryKey: ['messaging', 'conversations'],
      })
    },
  })
}

export function useMarkAsRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (conversationId: string) =>
      messagingService.markAsRead(conversationId),
    onSuccess: (_, conversationId) => {
      queryClient.invalidateQueries({
        queryKey: ['messaging', 'messages', conversationId],
      })
      queryClient.invalidateQueries({
        queryKey: ['messaging', 'conversations'],
      })
    },
  })
}

export function useMuteConversation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { conversationId: string; muted: boolean }) =>
      messagingService.setConversationMuted(
        params.conversationId,
        params.muted,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['messaging', 'conversations'],
      })
    },
  })
}

export function useChannelFeed(
  channelId: string | null,
  options?: { limit?: number },
) {
  const { address } = useWallet()

  return useQuery({
    queryKey: [
      'farcaster',
      'feed',
      'channel',
      channelId,
      options?.limit,
      address,
    ],
    queryFn: () =>
      channelId
        ? messagingService.getChannelFeed(channelId, options)
        : { casts: [] },
    enabled: !!channelId,
    staleTime: 30_000,
  })
}

export function useUserFeed(fid: number | null, options?: { limit?: number }) {
  const { address } = useWallet()

  return useQuery({
    queryKey: ['farcaster', 'feed', 'user', fid, options?.limit, address],
    queryFn: () =>
      fid ? messagingService.getUserFeed(fid, options) : { casts: [] },
    enabled: !!fid,
    staleTime: 30_000,
  })
}

export function useMessagingPreferences() {
  const queryClient = useQueryClient()
  const { address } = useWallet()

  const { data: preferences } = useQuery({
    queryKey: ['messaging', 'preferences', address],
    queryFn: () => messagingService.getPreferences(),
    enabled: !!address,
    staleTime: 60_000,
  })

  const updatePreferences = useMutation({
    mutationFn: (updates: Partial<MessagingPreferences>) =>
      messagingService.updatePreferences(updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messaging', 'preferences'] })
    },
  })

  const blockAddress = useMutation({
    mutationFn: (addr: Address) => messagingService.blockAddress(addr),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messaging', 'preferences'] })
      queryClient.invalidateQueries({
        queryKey: ['messaging', 'conversations'],
      })
    },
  })

  const unblockAddress = useMutation({
    mutationFn: (addr: Address) => messagingService.unblockAddress(addr),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messaging', 'preferences'] })
    },
  })

  const blockFid = useMutation({
    mutationFn: (fid: number) => messagingService.blockFid(fid),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messaging', 'preferences'] })
      queryClient.invalidateQueries({
        queryKey: ['messaging', 'conversations'],
      })
    },
  })

  const unblockFid = useMutation({
    mutationFn: (fid: number) => messagingService.unblockFid(fid),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messaging', 'preferences'] })
    },
  })

  return {
    preferences: preferences ?? DEFAULT_PREFERENCES,
    updatePreferences,
    blockAddress,
    unblockAddress,
    blockFid,
    unblockFid,
  }
}

export function useMessageSubscription(onMessage: (message: Message) => void) {
  useEffect(() => {
    return messagingService.onMessage(onMessage)
  }, [onMessage])
}

export function useMessaging() {
  const init = useMessagingInit()
  const farcaster = useFarcasterAccount()
  const { data: conversations, isLoading: conversationsLoading } =
    useConversations()
  const prefs = useMessagingPreferences()

  return {
    ...init,
    farcasterAccount: farcaster.account,
    hasFarcasterAccount: farcaster.hasFarcasterAccount,
    lookupFid: farcaster.lookupFid,
    linkFarcaster: farcaster.linkAccount,
    completeFarcasterLink: farcaster.completeLink,
    unlinkFarcaster: farcaster.unlinkAccount,
    conversations: conversations ?? [],
    conversationsLoading,
    sendMessage: useSendMessage(),
    markAsRead: useMarkAsRead(),
    muteConversation: useMuteConversation(),
    preferences: prefs.preferences,
    updatePreferences: prefs.updatePreferences,
    blockAddress: prefs.blockAddress,
    blockFid: prefs.blockFid,
  }
}
