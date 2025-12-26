/**
 * New Conversation Component
 *
 * Modal/slide-in for starting a new conversation
 */

import type { FarcasterProfile } from '@jejunetwork/messaging'
import { AtSign, Loader2, Search, User, Wallet, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { Address } from 'viem'
import { isAddress } from 'viem'
import { useFarcasterAccount } from '../../hooks/useMessaging'

interface NewConversationProps {
  isOpen: boolean
  onClose: () => void
  onStartConversation: (params: {
    recipientAddress?: Address
    recipientFid?: number
    recipientName: string
    recipientAvatar?: string
  }) => void
}

type SearchMode = 'address' | 'farcaster'

export function NewConversation({
  isOpen,
  onClose,
  onStartConversation,
}: NewConversationProps) {
  const [searchMode, setSearchMode] = useState<SearchMode>('address')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResult, setSearchResult] = useState<{
    type: 'address' | 'farcaster'
    address?: Address
    fid?: number
    profile?: FarcasterProfile
  } | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  const { getProfile, getProfileByUsername, lookupFid } = useFarcasterAccount()

  const handleSearch = useCallback(async () => {
    const query = searchQuery.trim()
    if (!query) return

    setIsSearching(true)
    setSearchError(null)
    setSearchResult(null)

    if (searchMode === 'address') {
      // Search by wallet address
      if (!isAddress(query)) {
        setSearchError('Invalid Ethereum address')
        setIsSearching(false)
        return
      }

      // Check if address has a Farcaster account
      const fid = await lookupFid.mutateAsync(query as Address)

      if (fid) {
        const profile = await getProfile.mutateAsync(fid)
        setSearchResult({
          type: 'farcaster',
          address: query as Address,
          fid,
          profile: profile ?? undefined,
        })
      } else {
        // No Farcaster, use XMTP
        setSearchResult({
          type: 'address',
          address: query as Address,
        })
      }
    } else {
      // Search by Farcaster username
      const username = query.startsWith('@') ? query.slice(1) : query
      const profile = await getProfileByUsername.mutateAsync(username)

      if (!profile) {
        setSearchError('Farcaster user not found')
        setIsSearching(false)
        return
      }

      setSearchResult({
        type: 'farcaster',
        fid: profile.fid,
        profile,
      })
    }

    setIsSearching(false)
  }, [searchQuery, searchMode, lookupFid, getProfile, getProfileByUsername])

  const handleSelect = useCallback(() => {
    if (!searchResult) return

    if (searchResult.type === 'farcaster' && searchResult.fid) {
      onStartConversation({
        recipientFid: searchResult.fid,
        recipientAddress: searchResult.address,
        recipientName:
          searchResult.profile?.displayName ??
          searchResult.profile?.username ??
          `FID:${searchResult.fid}`,
        recipientAvatar: searchResult.profile?.pfpUrl,
      })
    } else if (searchResult.address) {
      onStartConversation({
        recipientAddress: searchResult.address,
        recipientName: `${searchResult.address.slice(0, 6)}...${searchResult.address.slice(-4)}`,
      })
    }

    // Reset state
    setSearchQuery('')
    setSearchResult(null)
    onClose()
  }, [searchResult, onStartConversation, onClose])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleSearch()
      }
    },
    [handleSearch],
  )

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        className="fixed inset-0 z-40 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-x-4 top-[10%] z-50 mx-auto max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden lg:inset-x-auto lg:left-1/2 lg:-translate-x-1/2">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">New Conversation</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 -mr-2 rounded-lg hover:bg-secondary"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Search Mode Toggle */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setSearchMode('address')
                setSearchQuery('')
                setSearchResult(null)
                setSearchError(null)
              }}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                searchMode === 'address'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                  : 'bg-secondary/50 text-muted-foreground hover:text-foreground border border-transparent'
              }`}
            >
              <Wallet className="w-4 h-4" />
              Wallet Address
            </button>
            <button
              type="button"
              onClick={() => {
                setSearchMode('farcaster')
                setSearchQuery('')
                setSearchResult(null)
                setSearchError(null)
              }}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                searchMode === 'farcaster'
                  ? 'bg-purple-500/10 text-purple-400 border border-purple-500/30'
                  : 'bg-secondary/50 text-muted-foreground hover:text-foreground border border-transparent'
              }`}
            >
              <AtSign className="w-4 h-4" />
              Farcaster
            </button>
          </div>

          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                searchMode === 'address'
                  ? 'Enter wallet address (0x...)'
                  : 'Enter Farcaster username'
              }
              className="w-full pl-11 pr-4 py-3 rounded-xl bg-secondary/50 border border-border focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-sm transition-all"
            />
          </div>

          {/* Search Button */}
          <button
            type="button"
            onClick={handleSearch}
            disabled={!searchQuery.trim() || isSearching}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-medium disabled:opacity-50 hover:shadow-lg hover:shadow-emerald-500/20 transition-all flex items-center justify-center gap-2"
          >
            {isSearching ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Searching...
              </>
            ) : (
              <>
                <Search className="w-4 h-4" />
                Search
              </>
            )}
          </button>

          {/* Error */}
          {searchError && (
            <p className="text-sm text-red-400 text-center">{searchError}</p>
          )}

          {/* Search Result */}
          {searchResult && (
            <div className="p-4 rounded-xl bg-secondary/30 border border-border">
              <div className="flex items-center gap-4">
                {/* Avatar */}
                {searchResult.profile?.pfpUrl ? (
                  <img
                    src={searchResult.profile.pfpUrl}
                    alt={searchResult.profile.displayName}
                    className="w-14 h-14 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center">
                    <User className="w-6 h-6 text-muted-foreground" />
                  </div>
                )}

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold truncate">
                    {searchResult.profile?.displayName ??
                      searchResult.profile?.username ??
                      (searchResult.address
                        ? `${searchResult.address.slice(0, 8)}...${searchResult.address.slice(-6)}`
                        : `FID:${searchResult.fid}`)}
                  </h3>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    {searchResult.type === 'farcaster' ? (
                      <>
                        <AtSign className="w-3.5 h-3.5 text-purple-400" />
                        <span>@{searchResult.profile?.username}</span>
                        {searchResult.fid && (
                          <span>• FID {searchResult.fid}</span>
                        )}
                      </>
                    ) : (
                      <>
                        <Wallet className="w-3.5 h-3.5 text-emerald-400" />
                        <span>XMTP Messaging</span>
                      </>
                    )}
                  </div>
                  {searchResult.profile?.bio && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                      {searchResult.profile.bio}
                    </p>
                  )}
                </div>
              </div>

              {/* Start Conversation Button */}
              <button
                type="button"
                onClick={handleSelect}
                className="w-full mt-4 py-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 font-medium hover:bg-emerald-500/20 transition-colors"
              >
                Start Conversation
              </button>
            </div>
          )}

          {/* Info */}
          <p className="text-xs text-muted-foreground text-center">
            {searchMode === 'address'
              ? 'Messages to wallet addresses use XMTP for E2E encryption. If the address has a linked Farcaster account, you can also use Direct Casts.'
              : 'Search for Farcaster users by their username to send Direct Casts.'}
          </p>
        </div>
      </div>
    </>
  )
}
