/**
 * NFT Gallery Component
 * Displays user's NFTs across all chains
 */

import { ExternalLink, Grid, List, RefreshCw, Send } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { Address } from 'viem'
import { type NFT, type NFTCollection, nftService } from '../../services/nft'
import { SUPPORTED_CHAINS, type SupportedChainId } from '../../services/rpc'

interface NFTGalleryProps {
  address: Address
  onTransfer?: (nft: NFT) => void
}

type ViewMode = 'grid' | 'list'

export function NFTGallery({ address, onTransfer }: NFTGalleryProps) {
  const [collections, setCollections] = useState<NFTCollection[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [selectedChain, setSelectedChain] = useState<SupportedChainId | 'all'>(
    'all',
  )

  const fetchNFTs = useCallback(async () => {
    setIsLoading(true)
    const data = await nftService.getCollections(address)
    setCollections(data)
    setIsLoading(false)
  }, [address])

  useEffect(() => {
    fetchNFTs()
  }, [fetchNFTs])

  const filteredCollections =
    selectedChain === 'all'
      ? collections
      : collections.filter((c) => c.chainId === selectedChain)

  const totalNFTs = filteredCollections.reduce(
    (sum, c) => sum + c.nfts.length,
    0,
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">NFT Gallery</h2>
          <p className="text-muted-foreground">
            {totalNFTs} NFT{totalNFTs !== 1 ? 's' : ''} across{' '}
            {filteredCollections.length} collection
            {filteredCollections.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View Toggle */}
          <div className="flex bg-secondary rounded-lg p-1">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded ${viewMode === 'grid' ? 'bg-background' : ''}`}
            >
              <Grid className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`p-2 rounded ${viewMode === 'list' ? 'bg-background' : ''}`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>

          {/* Refresh */}
          <button
            type="button"
            onClick={fetchNFTs}
            className="flex items-center gap-2 px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-lg"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Chain Filter */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        <button
          type="button"
          onClick={() => setSelectedChain('all')}
          className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${
            selectedChain === 'all'
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary hover:bg-secondary/80'
          }`}
        >
          All Chains
        </button>
        {Object.entries(SUPPORTED_CHAINS).map(([id, chain]) => (
          <button
            type="button"
            key={id}
            onClick={() => setSelectedChain(Number(id) as SupportedChainId)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${
              selectedChain === Number(id)
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary hover:bg-secondary/80'
            }`}
          >
            {chain.name}
          </button>
        ))}
      </div>

      {/* Empty State */}
      {totalNFTs === 0 && (
        <div className="text-center py-12 bg-card border border-border rounded-xl">
          <div className="text-4xl mb-4">🖼️</div>
          <h3 className="text-lg font-medium">No NFTs Found</h3>
          <p className="text-muted-foreground">
            Your NFTs will appear here once you collect some.
          </p>
        </div>
      )}

      {/* Collections */}
      {filteredCollections.map((collection) => (
        <div
          key={`${collection.chainId}:${collection.address}`}
          className="space-y-4"
        >
          {/* Collection Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold">{collection.name}</h3>
              <span className="text-xs text-muted-foreground bg-secondary px-2 py-1 rounded">
                {SUPPORTED_CHAINS[collection.chainId].name}
              </span>
              <span className="text-xs text-muted-foreground">
                {collection.nfts.length} item
                {collection.nfts.length !== 1 ? 's' : ''}
              </span>
            </div>
            <a
              href={`${SUPPORTED_CHAINS[collection.chainId].blockExplorers.default.url}/address/${collection.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              View Contract <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* NFTs Grid/List */}
          <div
            className={
              viewMode === 'grid'
                ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4'
                : 'space-y-3'
            }
          >
            {collection.nfts.map((nft) => (
              <NFTCard
                key={`${nft.contractAddress}:${nft.tokenId}`}
                nft={nft}
                viewMode={viewMode}
                onTransfer={onTransfer}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// NFT Card Component
interface NFTCardProps {
  nft: NFT
  viewMode: ViewMode
  onTransfer?: (nft: NFT) => void
}

function NFTCard({ nft, viewMode, onTransfer }: NFTCardProps) {
  const [imageError, setImageError] = useState(false)
  const chain = SUPPORTED_CHAINS[nft.chainId]

  if (viewMode === 'list') {
    return (
      <div className="flex items-center gap-4 p-4 bg-card border border-border rounded-xl hover:border-primary/50 transition-colors">
        {/* Image */}
        <div className="w-16 h-16 rounded-lg bg-secondary flex-shrink-0 overflow-hidden relative">
          {!imageError && nft.imageUrl ? (
            <img
              src={nft.imageUrl}
              alt={nft.name}
              width={64}
              height={64}
              className="w-full h-full object-cover"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-2xl">
              🖼️
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{nft.name}</div>
          <div className="text-sm text-muted-foreground truncate">
            {nft.collectionName || 'Unknown Collection'}
          </div>
        </div>

        {/* Chain */}
        <div className="text-xs text-muted-foreground">{chain.name}</div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {onTransfer && (
            <button
              type="button"
              onClick={() => onTransfer(nft)}
              className="p-2 hover:bg-secondary rounded-lg"
              title="Transfer"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
          <a
            href={`${chain.blockExplorers.default.url}/token/${nft.contractAddress}?a=${nft.tokenId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 hover:bg-secondary rounded-lg"
            title="View on Explorer"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden hover:border-primary/50 transition-colors group">
      {/* Image */}
      <div className="aspect-square bg-secondary relative">
        {!imageError && nft.imageUrl ? (
          <img
            src={nft.imageUrl}
            alt={nft.name}
            className="absolute inset-0 w-full h-full object-cover"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl">
            🖼️
          </div>
        )}

        {/* Hover Actions */}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          {onTransfer && (
            <button
              type="button"
              onClick={() => onTransfer(nft)}
              className="p-3 bg-white/20 hover:bg-white/30 rounded-lg backdrop-blur"
              title="Transfer"
            >
              <Send className="w-5 h-5 text-white" />
            </button>
          )}
          <a
            href={`${chain.blockExplorers.default.url}/token/${nft.contractAddress}?a=${nft.tokenId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-3 bg-white/20 hover:bg-white/30 rounded-lg backdrop-blur"
            title="View on Explorer"
          >
            <ExternalLink className="w-5 h-5 text-white" />
          </a>
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <div className="font-medium truncate">{nft.name}</div>
        <div className="text-sm text-muted-foreground truncate">
          {nft.collectionName || 'Unknown'}
        </div>
        <div className="text-xs text-muted-foreground mt-1">{chain.name}</div>
      </div>
    </div>
  )
}

export default NFTGallery
