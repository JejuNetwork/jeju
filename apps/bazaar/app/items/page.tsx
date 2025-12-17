'use client'

import { useState, useEffect, Suspense } from 'react'
import { useAccount } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'
import { hasNFTMarketplace } from '@/config/contracts'
import { JEJU_CHAIN_ID } from '@/config/chains'
import { request, gql } from 'graphql-request'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { INDEXER_URL } from '@/config'

const NFT_QUERY = gql`
  query GetNFTs($owner: String) {
    erc721Tokens(limit: 100, orderBy: tokenId_DESC) {
      id
      tokenId
      owner {
        address
      }
      contract {
        address
        name
      }
      metadata
    }
    erc1155Balances(where: { balance_gt: "0", account: { address_eq: $owner } }, limit: 100) {
      id
      tokenId
      balance
      contract {
        address
        name
      }
    }
  }
`

interface NFTToken {
  id: string
  tokenId: string
  owner?: { address: string }
  contract?: { address: string; name: string }
  metadata?: string
}

interface NFTBalance {
  id: string
  tokenId: string
  balance: string
  contract?: { address: string; name: string }
}

interface NFTQueryResult {
  erc721Tokens: NFTToken[]
  erc1155Balances: NFTBalance[]
}

interface NormalizedNFT {
  id: string
  tokenId: string
  owner?: string
  balance?: string
  contract?: string
  contractName: string
  type: 'ERC721' | 'ERC1155'
  metadata?: string
}

type ModalMode = 'view' | 'sell'

function NFTsPageContent() {
  const { address, isConnected } = useAccount()
  const searchParams = useSearchParams()
  const [filter, setFilter] = useState<'all' | 'my-nfts'>('all')
  const [sortBy, setSortBy] = useState<'recent' | 'price' | 'collection'>('recent')
  
  // Single modal with mode switching
  const [selectedNFT, setSelectedNFT] = useState<NormalizedNFT | null>(null)
  const [modalMode, setModalMode] = useState<ModalMode>('view')
  const [reservePrice, setReservePrice] = useState('')
  const [duration, setDuration] = useState('86400')
  const [buyoutPrice, setBuyoutPrice] = useState('')

  const hasMarketplace = hasNFTMarketplace(JEJU_CHAIN_ID)
  const isOwner = selectedNFT?.owner?.toLowerCase() === address?.toLowerCase()

  useEffect(() => {
    const urlFilter = searchParams?.get('filter')
    if (urlFilter === 'my-nfts') {
      setFilter('my-nfts')
    }
  }, [searchParams])

  const { data: nftData, isLoading } = useQuery<NFTQueryResult>({
    queryKey: ['nfts', filter === 'my-nfts' ? address : null],
    queryFn: async () => {
      const data = await request<NFTQueryResult>(INDEXER_URL, NFT_QUERY, {
        owner: filter === 'my-nfts' ? address?.toLowerCase() : undefined
      })
      return data
    },
    enabled: filter === 'all' || (filter === 'my-nfts' && !!address),
    refetchInterval: 10000,
  })

  const allNFTs: NormalizedNFT[] = [
    ...(nftData?.erc721Tokens || []).map((token) => ({
      id: token.id,
      tokenId: token.tokenId,
      owner: token.owner?.address,
      contract: token.contract?.address,
      contractName: token.contract?.name || 'Unknown',
      type: 'ERC721' as const,
      metadata: token.metadata,
    })),
    ...(nftData?.erc1155Balances || []).map((balance) => ({
      id: balance.id,
      tokenId: balance.tokenId,
      balance: balance.balance,
      contract: balance.contract?.address,
      contractName: balance.contract?.name || 'Unknown',
      type: 'ERC1155' as const,
    }))
  ]

  const filteredNFTs = filter === 'my-nfts' 
    ? allNFTs.filter(nft => nft.owner?.toLowerCase() === address?.toLowerCase() || Number(nft.balance) > 0)
    : allNFTs

  const sortedNFTs = [...filteredNFTs].sort((a, b) => {
    switch (sortBy) {
      case 'collection':
        return a.contractName.localeCompare(b.contractName)
      case 'recent':
        return parseInt(b.tokenId || '0') - parseInt(a.tokenId || '0')
      case 'price':
        return 0
      default:
        return 0
    }
  })

  const collections = sortedNFTs.reduce((acc, nft) => {
    const collection = nft.contractName
    if (!acc[collection]) acc[collection] = []
    acc[collection].push(nft)
    return acc
  }, {} as Record<string, NormalizedNFT[]>)

  const openNFT = (nft: NormalizedNFT) => {
    setSelectedNFT(nft)
    setModalMode('view')
    setReservePrice('')
    setBuyoutPrice('')
  }

  const closeModal = () => {
    setSelectedNFT(null)
    setModalMode('view')
    setReservePrice('')
    setBuyoutPrice('')
  }

  const handleList = () => {
    // Would submit listing here
    closeModal()
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 md:mb-8">
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          🖼️ NFTs
        </h1>
        <p className="text-sm sm:text-base mb-4" style={{ color: 'var(--text-secondary)' }}>
          Browse, collect, and trade digital items
        </p>

        {!hasMarketplace && (
          <div className="card p-3 mb-4 border-yellow-500/30 bg-yellow-500/10">
            <p className="text-yellow-400 text-sm">Marketplace coming soon</p>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex gap-2 overflow-x-auto pb-2 sm:pb-0 -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                filter === 'all' ? 'bg-bazaar-primary text-white' : ''
              }`}
              style={{ 
                backgroundColor: filter === 'all' ? undefined : 'var(--bg-secondary)',
                color: filter === 'all' ? undefined : 'var(--text-secondary)'
              }}
            >
              All NFTs
            </button>
            <button
              onClick={() => setFilter('my-nfts')}
              disabled={!isConnected}
              className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all disabled:opacity-50 ${
                filter === 'my-nfts' ? 'bg-bazaar-primary text-white' : ''
              }`}
              style={{ 
                backgroundColor: filter === 'my-nfts' ? undefined : 'var(--bg-secondary)',
                color: filter === 'my-nfts' ? undefined : 'var(--text-secondary)'
              }}
            >
              My Collection
            </button>
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'recent' | 'price' | 'collection')}
            className="input w-full sm:w-40 py-2 text-sm"
          >
            <option value="recent">Newest</option>
            <option value="collection">Collection</option>
          </select>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex justify-center py-16">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {/* Empty State */}
      {!isLoading && sortedNFTs.length === 0 && (
        <div className="text-center py-16">
          <div className="text-5xl md:text-6xl mb-4">🖼️</div>
          <h3 className="text-lg md:text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            {filter === 'my-nfts' ? 'No NFTs Yet' : 'No NFTs Found'}
          </h3>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {filter === 'my-nfts' 
              ? "You don't own any NFTs yet"
              : 'No NFTs have been minted'}
          </p>
        </div>
      )}

      {/* NFT Grid */}
      {!isLoading && sortedNFTs.length > 0 && (
        <div className="space-y-6 md:space-y-8">
          {Object.entries(collections).map(([collectionName, nfts]) => (
            <div key={collectionName}>
              <h2 className="text-lg md:text-xl font-bold mb-3 md:mb-4" style={{ color: 'var(--text-primary)' }}>
                {collectionName}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
                {nfts.map((nft) => (
                  <div
                    key={nft.id}
                    className="card overflow-hidden group cursor-pointer active:scale-[0.98] transition-transform"
                    onClick={() => openNFT(nft)}
                  >
                    <div className="aspect-square bg-gradient-to-br from-bazaar-primary to-bazaar-purple flex items-center justify-center text-3xl md:text-4xl group-hover:scale-105 transition-transform">
                      🖼️
                    </div>
                    <div className="p-2.5 md:p-3">
                      <h3 className="font-semibold text-sm mb-0.5" style={{ color: 'var(--text-primary)' }}>
                        #{nft.tokenId}
                      </h3>
                      <p className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                        {nft.contractName}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Unified NFT Modal */}
      {selectedNFT && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
          onClick={closeModal}
        >
          <div 
            className="w-full max-w-md rounded-2xl border overflow-hidden"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* NFT Image */}
            <div className="aspect-[4/3] bg-gradient-to-br from-bazaar-primary to-bazaar-purple flex items-center justify-center text-6xl">
              🖼️
            </div>
            
            <div className="p-5">
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                    #{selectedNFT.tokenId}
                  </h2>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {selectedNFT.contractName}
                  </p>
                </div>
                <button
                  onClick={closeModal}
                  className="p-2 rounded-xl transition-colors"
                  style={{ backgroundColor: 'var(--bg-secondary)' }}
                >
                  ✕
                </button>
              </div>

              {modalMode === 'view' ? (
                <>
                  {/* Details */}
                  <div className="space-y-2 mb-5 text-sm">
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--text-tertiary)' }}>Type</span>
                      <span style={{ color: 'var(--text-primary)' }}>{selectedNFT.type}</span>
                    </div>
                    {selectedNFT.owner && (
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--text-tertiary)' }}>Owner</span>
                        <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>
                          {selectedNFT.owner.slice(0, 8)}...{selectedNFT.owner.slice(-6)}
                        </span>
                      </div>
                    )}
                    {selectedNFT.balance && (
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--text-tertiary)' }}>Quantity</span>
                        <span style={{ color: 'var(--text-primary)' }}>{selectedNFT.balance}</span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  {isOwner && hasMarketplace ? (
                    <button
                      onClick={() => setModalMode('sell')}
                      className="btn-primary w-full py-3"
                    >
                      List for Sale
                    </button>
                  ) : (
                    <button onClick={closeModal} className="btn-secondary w-full py-3">
                      Close
                    </button>
                  )}
                </>
              ) : (
                <>
                  {/* Sell Form */}
                  <div className="space-y-4 mb-5">
                    <div>
                      <label className="text-xs mb-1.5 block" style={{ color: 'var(--text-tertiary)' }}>
                        Price (ETH)
                      </label>
                      <input
                        type="number"
                        value={reservePrice}
                        onChange={(e) => setReservePrice(e.target.value)}
                        placeholder="0.1"
                        step="0.001"
                        className="input"
                      />
                    </div>

                    <div>
                      <label className="text-xs mb-1.5 block" style={{ color: 'var(--text-tertiary)' }}>
                        Duration
                      </label>
                      <select 
                        value={duration}
                        onChange={(e) => setDuration(e.target.value)}
                        className="input"
                      >
                        <option value="86400">1 Day</option>
                        <option value="259200">3 Days</option>
                        <option value="604800">7 Days</option>
                        <option value="1209600">14 Days</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs mb-1.5 block" style={{ color: 'var(--text-tertiary)' }}>
                        Buy Now Price (optional)
                      </label>
                      <input
                        type="number"
                        value={buyoutPrice}
                        onChange={(e) => setBuyoutPrice(e.target.value)}
                        placeholder="1.0"
                        step="0.001"
                        className="input"
                      />
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => setModalMode('view')}
                      className="btn-secondary flex-1 py-3"
                    >
                      Back
                    </button>
                    <button
                      onClick={handleList}
                      disabled={!reservePrice || parseFloat(reservePrice) <= 0}
                      className="btn-primary flex-1 py-3 disabled:opacity-50"
                    >
                      List NFT
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function NFTsPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>}>
      <NFTsPageContent />
    </Suspense>
  )
}
