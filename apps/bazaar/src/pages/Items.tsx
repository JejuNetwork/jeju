/**
 * NFT Items Page
 */

import { useQuery } from '@tanstack/react-query'
import { gql, request } from 'graphql-request'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { LoadingSpinner } from '../../components/LoadingSpinner'
import { INDEXER_URL } from '../../config'
import { JEJU_CHAIN_ID } from '../../config/chains'
import { hasNFTMarketplace } from '../../config/contracts'
import {
  type ERC721TokenInput,
  type ERC1155BalanceInput,
  filterNFTsByOwner,
  groupNFTsByCollection,
  isNFTOwner,
  type NFTSortOption,
  normalizeNFTQueryResult,
  sortNFTs,
} from '../../lib/nft'
import type { NormalizedNFT } from '../../schemas/nft'

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
    erc1155Balances(
      where: { balance_gt: "0", account: { address_eq: $owner } }
      limit: 100
    ) {
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

interface NFTQueryResult {
  erc721Tokens: ERC721TokenInput[]
  erc1155Balances: ERC1155BalanceInput[]
}

export default function ItemsPage() {
  const { address, isConnected } = useAccount()
  const [searchParams] = useSearchParams()
  const [filter, setFilter] = useState<'all' | 'my-nfts'>(
    searchParams.get('filter') === 'my-nfts' ? 'my-nfts' : 'all',
  )
  const [sortBy, setSortBy] = useState<NFTSortOption>('recent')
  const [selectedNFT, setSelectedNFT] = useState<NormalizedNFT | null>(null)

  const hasMarketplace = hasNFTMarketplace(JEJU_CHAIN_ID)
  const isOwner =
    selectedNFT && address ? isNFTOwner(selectedNFT, address) : false

  const { data: nftData, isLoading } = useQuery<NFTQueryResult>({
    queryKey: ['nfts', filter === 'my-nfts' ? address : null],
    queryFn: async () => {
      const data = await request<NFTQueryResult>(INDEXER_URL, NFT_QUERY, {
        owner: filter === 'my-nfts' ? address?.toLowerCase() : undefined,
      })
      return data
    },
    enabled: filter === 'all' || (filter === 'my-nfts' && !!address),
    refetchInterval: 10000,
  })

  const allNFTs = normalizeNFTQueryResult(
    nftData?.erc721Tokens ?? [],
    nftData?.erc1155Balances ?? [],
  )

  const filteredNFTs =
    filter === 'my-nfts' && address
      ? filterNFTsByOwner(allNFTs, address)
      : allNFTs

  const sortedNFTs = sortNFTs(filteredNFTs, sortBy)
  const collections = groupNFTsByCollection(sortedNFTs)

  return (
    <div>
      <div className="mb-6 md:mb-8">
        <h1
          className="text-2xl sm:text-3xl md:text-4xl font-bold mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          🖼️ NFTs
        </h1>
        <p
          className="text-sm sm:text-base mb-4"
          style={{ color: 'var(--text-secondary)' }}
        >
          Browse, collect, and trade digital items
        </p>

        {!hasMarketplace && (
          <div className="card p-3 mb-4 border-yellow-500/30 bg-yellow-500/10">
            <p className="text-yellow-400 text-sm">Marketplace coming soon</p>
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex gap-2 overflow-x-auto pb-2 sm:pb-0 -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                filter === 'all' ? 'bg-bazaar-primary text-white' : ''
              }`}
              style={{
                backgroundColor:
                  filter === 'all' ? undefined : 'var(--bg-secondary)',
                color: filter === 'all' ? undefined : 'var(--text-secondary)',
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
                backgroundColor:
                  filter === 'my-nfts' ? undefined : 'var(--bg-secondary)',
                color:
                  filter === 'my-nfts' ? undefined : 'var(--text-secondary)',
              }}
            >
              My Collection
            </button>
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as NFTSortOption)}
            className="input w-full sm:w-40 py-2 text-sm"
          >
            <option value="recent">Newest</option>
            <option value="collection">Collection</option>
          </select>
        </div>
      </div>

      {isLoading && (
        <div className="flex justify-center py-16">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {!isLoading && sortedNFTs.length === 0 && (
        <div className="text-center py-16">
          <div className="text-5xl md:text-6xl mb-4">🖼️</div>
          <h3
            className="text-lg md:text-xl font-semibold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            {filter === 'my-nfts' ? 'No NFTs Yet' : 'No NFTs Found'}
          </h3>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {filter === 'my-nfts'
              ? "You don't own any NFTs yet"
              : 'No NFTs have been minted'}
          </p>
        </div>
      )}

      {!isLoading && sortedNFTs.length > 0 && (
        <div className="space-y-6 md:space-y-8">
          {Object.entries(collections).map(([collectionName, nfts]) => (
            <div key={collectionName}>
              <h2
                className="text-lg md:text-xl font-bold mb-3 md:mb-4"
                style={{ color: 'var(--text-primary)' }}
              >
                {collectionName}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
                {nfts.map((nft) => (
                  <div
                    key={nft.id}
                    className="card overflow-hidden group cursor-pointer active:scale-[0.98] transition-transform"
                    onClick={() => setSelectedNFT(nft)}
                  >
                    <div className="aspect-square bg-gradient-to-br from-bazaar-primary to-bazaar-purple flex items-center justify-center text-3xl md:text-4xl group-hover:scale-105 transition-transform">
                      🖼️
                    </div>
                    <div className="p-2.5 md:p-3">
                      <h3
                        className="font-semibold text-sm mb-0.5"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        #{nft.tokenId}
                      </h3>
                      <p
                        className="text-xs truncate"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
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

      {/* NFT Modal */}
      {selectedNFT && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
          onClick={() => setSelectedNFT(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border overflow-hidden"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="aspect-[4/3] bg-gradient-to-br from-bazaar-primary to-bazaar-purple flex items-center justify-center text-6xl">
              🖼️
            </div>

            <div className="p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2
                    className="text-xl font-bold"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    #{selectedNFT.tokenId}
                  </h2>
                  <p
                    className="text-sm"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {selectedNFT.contractName}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedNFT(null)}
                  className="p-2 rounded-xl transition-colors"
                  style={{ backgroundColor: 'var(--bg-secondary)' }}
                >
                  ✕
                </button>
              </div>

              <div className="space-y-2 mb-5 text-sm">
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-tertiary)' }}>Type</span>
                  <span style={{ color: 'var(--text-primary)' }}>
                    {selectedNFT.type}
                  </span>
                </div>
                {selectedNFT.owner && (
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--text-tertiary)' }}>Owner</span>
                    <span
                      className="font-mono"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {selectedNFT.owner.slice(0, 8)}...
                      {selectedNFT.owner.slice(-6)}
                    </span>
                  </div>
                )}
              </div>

              {isOwner && hasMarketplace ? (
                <button className="btn-primary w-full py-3">
                  List for Sale
                </button>
              ) : (
                <button
                  onClick={() => setSelectedNFT(null)}
                  className="btn-secondary w-full py-3"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
