'use client'

import { useState, useEffect, Suspense } from 'react'
import { useAccount } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'
import { hasNFTMarketplace } from '@/config/contracts'
import { JEJU_CHAIN_ID } from '@/config/chains'
import { request, gql } from 'graphql-request'
import { LoadingSpinner } from '@/components/LoadingSpinner'

const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL || 'http://localhost:4350/graphql'

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

function NFTsPageContent() {
  const { address, isConnected } = useAccount()
  const searchParams = useSearchParams()
  const [filter, setFilter] = useState<'all' | 'my-nfts'>('all')
  const [sortBy, setSortBy] = useState<'recent' | 'price' | 'collection'>('recent')
  const [showListModal, setShowListModal] = useState(false)
  const [selectedNFT, setSelectedNFT] = useState<NormalizedNFT | null>(null)
  const [reservePrice, setReservePrice] = useState('')
  const [duration, setDuration] = useState('86400')
  const [buyoutPrice, setBuyoutPrice] = useState('')

  const hasMarketplace = hasNFTMarketplace(JEJU_CHAIN_ID)

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

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          🖼️ Items
        </h1>
        <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
          Browse and trade digital items and collectibles
        </p>

        {!hasMarketplace && (
          <div className="card p-4 mb-6 border-bazaar-warning/50 bg-bazaar-warning/10">
            <p className="text-bazaar-warning">
              NFT Marketplace contracts not deployed. Marketplace features unavailable.
            </p>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex gap-2 overflow-x-auto pb-2 sm:pb-0 -mx-4 px-4 sm:mx-0 sm:px-0">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                filter === 'all' ? 'bg-bazaar-primary text-white' : ''
              }`}
              style={{ 
                backgroundColor: filter === 'all' ? undefined : 'var(--bg-secondary)',
                color: filter === 'all' ? undefined : 'var(--text-secondary)'
              }}
              data-testid="filter-all-nfts"
            >
              All Items
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
              data-testid="filter-my-nfts"
            >
              My Items {!isConnected && '(Connect Wallet)'}
            </button>
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'recent' | 'price' | 'collection')}
            className="input w-full sm:w-48 py-2"
            data-testid="nft-sort-select"
          >
            <option value="recent">Recently Listed</option>
            <option value="price">Price: Low to High</option>
            <option value="collection">By Collection</option>
          </select>

          {filter === 'my-nfts' && isConnected && sortedNFTs.length > 0 && (
            <button
              onClick={() => setShowListModal(true)}
              className="btn-primary ml-auto w-full sm:w-auto"
              data-testid="list-for-auction-button"
            >
              List for Auction
            </button>
          )}
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex justify-center py-20">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {/* Empty State */}
      {!isLoading && sortedNFTs.length === 0 && (
        <div className="text-center py-20">
          <div className="text-6xl md:text-7xl mb-4">🖼️</div>
          <h3 className="text-xl md:text-2xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            {filter === 'my-nfts' ? 'No Items in Your Collection' : 'No Items Found'}
          </h3>
          <p style={{ color: 'var(--text-secondary)' }}>
            {filter === 'my-nfts' 
              ? "You don't own any items on Jeju yet."
              : 'No items have been minted yet.'}
          </p>
        </div>
      )}

      {/* NFT Grid */}
      {!isLoading && sortedNFTs.length > 0 && (
        <div className="space-y-8">
          {Object.entries(collections).map(([collectionName, nfts]) => (
            <div key={collectionName}>
              <h2 className="text-xl md:text-2xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
                {collectionName}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
                {nfts.map((nft) => (
                  <div
                    key={nft.id}
                    className="card overflow-hidden group cursor-pointer"
                    data-testid="nft-card"
                    onClick={() => setSelectedNFT(nft)}
                  >
                    <div className="aspect-square bg-gradient-to-br from-bazaar-primary to-bazaar-purple flex items-center justify-center text-4xl md:text-5xl group-hover:scale-105 transition-transform">
                      🖼️
                    </div>
                    <div className="p-3 md:p-4">
                      <h3 className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                        #{nft.tokenId}
                      </h3>
                      <p className="text-xs md:text-sm mb-2" style={{ color: 'var(--text-tertiary)' }}>
                        {nft.contractName}
                      </p>
                      <div className="flex items-center justify-between text-xs">
                        <span style={{ color: 'var(--text-tertiary)' }}>Owner</span>
                        <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>
                          {nft.owner?.slice(0, 4)}...{nft.owner?.slice(-3)}
                        </span>
                      </div>
                      {nft.type === 'ERC1155' && nft.balance && (
                        <div className="flex items-center justify-between text-xs mt-1">
                          <span style={{ color: 'var(--text-tertiary)' }}>Qty</span>
                          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                            {nft.balance}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* NFT Detail Modal */}
      {selectedNFT && !showListModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
          onClick={() => setSelectedNFT(null)}
        >
          <div 
            className="w-full max-w-md rounded-2xl border p-6"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl md:text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
              #{selectedNFT.tokenId}
            </h2>
            <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>{selectedNFT.contractName}</p>
            
            <div className="aspect-square bg-gradient-to-br from-bazaar-primary to-bazaar-purple rounded-xl flex items-center justify-center text-6xl mb-4">
              🖼️
            </div>
            
            <div className="space-y-2 mb-6 text-sm">
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-tertiary)' }}>Contract</span>
                <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>
                  {selectedNFT.contract?.slice(0, 10)}...
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-tertiary)' }}>Type</span>
                <span style={{ color: 'var(--text-primary)' }}>{selectedNFT.type}</span>
              </div>
              {selectedNFT.owner && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-tertiary)' }}>Owner</span>
                  <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>
                    {selectedNFT.owner.slice(0, 10)}...
                  </span>
                </div>
              )}
            </div>
            
            <div className="flex gap-3">
              <button onClick={() => setSelectedNFT(null)} className="btn-secondary flex-1">
                Close
              </button>
              {selectedNFT.owner?.toLowerCase() === address?.toLowerCase() && (
                <button onClick={() => setShowListModal(true)} className="btn-primary flex-1">
                  List for Sale
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* List for Auction Modal */}
      {showListModal && selectedNFT && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
        >
          <div 
            className="w-full max-w-md rounded-2xl border p-6"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <h2 className="text-xl md:text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
              List NFT for Auction
            </h2>
            <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
              #{selectedNFT.tokenId} - {selectedNFT.contractName}
            </p>
            
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                  Reserve Price (ETH)
                </label>
                <input
                  type="number"
                  value={reservePrice}
                  onChange={(e) => setReservePrice(e.target.value)}
                  placeholder="0.1"
                  step="0.001"
                  className="input"
                  data-testid="reserve-price-input"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
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
                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                  Instant Buy Price (Optional)
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
                onClick={() => {
                  setShowListModal(false)
                  setReservePrice('')
                  setBuyoutPrice('')
                }}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowListModal(false)
                  setSelectedNFT(null)
                  setReservePrice('')
                  setBuyoutPrice('')
                }}
                disabled={!reservePrice || parseFloat(reservePrice) <= 0}
                className="btn-primary flex-1 disabled:opacity-50"
                data-testid="confirm-list-button"
              >
                List NFT
              </button>
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
