import { ExternalLink, Grid, List, RefreshCw, Send } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { Address } from 'viem'
import {
  type NFT,
  type NFTCollection,
  nftService,
} from '../../../api/services/nft'
import {
  SUPPORTED_CHAINS,
  type SupportedChainId,
} from '../../../api/services/rpc'

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
    <div className="space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20">
              <Grid className="w-6 h-6 text-purple-400" />
            </div>
            NFT Gallery
          </h2>
          <p className="text-muted-foreground mt-1">
            {totalNFTs} NFT{totalNFTs !== 1 ? 's' : ''} across{' '}
            {filteredCollections.length} collection
            {filteredCollections.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* View Toggle */}
          <fieldset
            className="flex bg-secondary rounded-xl p-1 border-0"
            aria-label="View mode"
          >
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              aria-pressed={viewMode === 'grid'}
              aria-label="Grid view"
              className={`p-2.5 rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-purple-500/50 ${viewMode === 'grid' ? 'bg-background shadow-sm text-purple-400' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Grid className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              aria-pressed={viewMode === 'list'}
              aria-label="List view"
              className={`p-2.5 rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-purple-500/50 ${viewMode === 'list' ? 'bg-background shadow-sm text-purple-400' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <List className="w-4 h-4" />
            </button>
          </fieldset>

          {/* Refresh */}
          <button
            type="button"
            onClick={fetchNFTs}
            aria-label="Refresh NFTs"
            className="flex items-center gap-2 px-4 py-2.5 bg-secondary hover:bg-secondary/80 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500/50"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Chain Filter */}
      <fieldset
        className="flex gap-2 overflow-x-auto pb-2 border-0"
        aria-label="Filter by chain"
      >
        <button
          type="button"
          onClick={() => setSelectedChain('all')}
          aria-pressed={selectedChain === 'all'}
          className={`px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all focus:outline-none focus:ring-2 focus:ring-purple-500/50 ${
            selectedChain === 'all'
              ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-md shadow-purple-500/20'
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
            aria-pressed={selectedChain === Number(id)}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all focus:outline-none focus:ring-2 focus:ring-purple-500/50 ${
              selectedChain === Number(id)
                ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-md shadow-purple-500/20'
                : 'bg-secondary hover:bg-secondary/80'
            }`}
          >
            {chain.name}
          </button>
        ))}
      </fieldset>

      {/* Empty State */}
      {totalNFTs === 0 && (
        <div className="text-center py-12 bg-card border border-border rounded-2xl">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center mb-4">
            <span className="text-3xl">🖼️</span>
          </div>
          <h3 className="text-lg font-bold">No NFTs Found</h3>
          <p className="text-muted-foreground mt-2">
            Your NFTs will appear here once you collect some
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
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="font-bold text-lg">{collection.name}</h3>
              <span className="text-xs font-medium text-purple-400 bg-purple-500/10 px-2.5 py-1 rounded-lg">
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
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-purple-400 transition-colors"
            >
              View Contract <ExternalLink className="w-3.5 h-3.5" />
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
      <div className="flex items-center gap-4 p-4 bg-card border border-border rounded-xl hover:border-purple-500/40 transition-all">
        {/* Image */}
        <div className="w-16 h-16 rounded-xl bg-secondary flex-shrink-0 overflow-hidden relative">
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
            <div className="w-full h-full flex items-center justify-center text-2xl bg-gradient-to-br from-purple-500/20 to-pink-500/20">
              🖼️
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="font-bold truncate">{nft.name}</div>
          <div className="text-sm text-muted-foreground truncate">
            {nft.collectionName ?? 'Unknown Collection'}
          </div>
        </div>

        {/* Chain */}
        <div className="text-xs font-medium text-purple-400 bg-purple-500/10 px-2 py-1 rounded-lg hidden sm:block">
          {chain.name}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {onTransfer && (
            <button
              type="button"
              onClick={() => onTransfer(nft)}
              className="p-2.5 hover:bg-secondary rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              aria-label={`Transfer ${nft.name}`}
            >
              <Send className="w-4 h-4" />
            </button>
          )}
          <a
            href={`${chain.blockExplorers.default.url}/token/${nft.contractAddress}?a=${nft.tokenId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2.5 hover:bg-secondary rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            aria-label={`View ${nft.name} on explorer`}
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden hover:border-purple-500/40 transition-all group hover:shadow-lg hover:shadow-purple-500/5">
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
          <div className="w-full h-full flex items-center justify-center text-4xl bg-gradient-to-br from-purple-500/10 to-pink-500/10">
            🖼️
          </div>
        )}

        {/* Hover Actions */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center gap-2 pb-4">
          {onTransfer && (
            <button
              type="button"
              onClick={() => onTransfer(nft)}
              className="p-3 bg-white/20 hover:bg-white/30 rounded-xl backdrop-blur-sm transition-colors"
              aria-label={`Transfer ${nft.name}`}
            >
              <Send className="w-5 h-5 text-white" />
            </button>
          )}
          <a
            href={`${chain.blockExplorers.default.url}/token/${nft.contractAddress}?a=${nft.tokenId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-3 bg-white/20 hover:bg-white/30 rounded-xl backdrop-blur-sm transition-colors"
            aria-label={`View ${nft.name} on explorer`}
          >
            <ExternalLink className="w-5 h-5 text-white" />
          </a>
        </div>
      </div>

      {/* Info */}
      <div className="p-4">
        <div className="font-bold truncate">{nft.name}</div>
        <div className="text-sm text-muted-foreground truncate">
          {nft.collectionName ?? 'Unknown'}
        </div>
        <div className="text-xs font-medium text-purple-400 mt-2">
          {chain.name}
        </div>
      </div>
    </div>
  )
}

export default NFTGallery
