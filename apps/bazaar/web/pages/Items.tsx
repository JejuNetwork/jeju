import { useQuery } from '@tanstack/react-query'
import { gql, request } from 'graphql-request'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { type Address, parseEther } from 'viem'
import { useAccount } from 'wagmi'
import { INDEXER_URL } from '../../config'
import {
  filterNFTsByOwner,
  isNFTOwner,
  type NFTSortOption,
  sortNFTs,
} from '../../lib/nft'
import type { NormalizedNFT } from '../../schemas/nft'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { JEJU_CHAIN_ID } from '../config/chains'
import { hasNFTMarketplace } from '../config/contracts'
import {
  AssetType,
  type CreateListingParams,
  Currency,
  type FormattedListing,
  useMarketplace,
  usePlatformFee,
  useTokenListing,
} from '../hooks/useMarketplace'

// Query NFT contracts and balances from the indexer schema
// The schema uses Contract (with isERC721/isERC1155 flags) and TokenBalance
const NFT_QUERY = gql`
  query GetNFTs {
    contracts(
      where: { OR: [{ isERC721_eq: true }, { isERC1155_eq: true }] }
      limit: 100
      orderBy: firstSeenAt_DESC
    ) {
      id
      address
      contractType
      isERC721
      isERC1155
      verified
      creator {
        address
      }
    }
    tokenBalances(
      where: { 
        balance_gt: "0"
        token: { OR: [{ isERC721_eq: true }, { isERC1155_eq: true }] }
      }
      limit: 100
    ) {
      id
      balance
      account {
        address
      }
      token {
        address
        isERC721
        isERC1155
      }
    }
  }
`

interface ContractResult {
  id: string
  address: string
  contractType: string
  isERC721: boolean
  isERC1155: boolean
  verified: boolean
  creator: { address: string } | null
}

interface TokenBalanceResult {
  id: string
  balance: string
  account: { address: string }
  token: {
    address: string
    isERC721: boolean
    isERC1155: boolean
  }
}

interface NFTQueryResult {
  contracts: ContractResult[]
  tokenBalances: TokenBalanceResult[]
}

type FilterType = 'all' | 'listed' | 'my-collection'

interface ListingModalState {
  nft: NormalizedNFT
  price: string
  duration: string
  currency: 'ETH' | 'USDC'
}

export default function ItemsPage() {
  const { address, isConnected } = useAccount()
  const [searchParams] = useSearchParams()
  const [filter, setFilter] = useState<FilterType>(
    (searchParams.get('filter') as FilterType) ?? 'all',
  )
  const [sortBy, setSortBy] = useState<NFTSortOption>('recent')
  const [selectedNFT, setSelectedNFT] = useState<NormalizedNFT | null>(null)
  const [listingModal, setListingModal] = useState<ListingModalState | null>(
    null,
  )
  const [buyConfirmModal, setBuyConfirmModal] = useState<{
    nft: NormalizedNFT
    listing: FormattedListing
  } | null>(null)

  const hasMarketplace = hasNFTMarketplace(JEJU_CHAIN_ID)

  const marketplace = useMarketplace()
  const { data: platformFee } = usePlatformFee()

  const { data: nftData, isLoading } = useQuery<NFTQueryResult>({
    queryKey: ['nfts', filter === 'my-collection' ? address : null],
    queryFn: async () => {
      const data = await request<NFTQueryResult>(INDEXER_URL, NFT_QUERY)
      return data
    },
    enabled:
      filter === 'all' ||
      filter === 'listed' ||
      (filter === 'my-collection' && !!address),
    refetchInterval: 10000,
  })

  // Convert indexer contracts and balances to normalized NFT format
  const allNFTs = useMemo((): NormalizedNFT[] => {
    if (!nftData) return []

    const nfts: NormalizedNFT[] = []

    // Convert NFT contracts to NFT items
    // Each contract represents a potential collection
    for (const contract of nftData.contracts) {
      // Find balances for this contract
      const contractBalances = nftData.tokenBalances.filter(
        (b) => b.token.address.toLowerCase() === contract.address.toLowerCase(),
      )

      if (contractBalances.length > 0) {
        // Add items for each balance
        for (const balance of contractBalances) {
          nfts.push({
            id: balance.id,
            tokenId: balance.id.split('-').pop() ?? '0', // Extract tokenId from id
            owner: balance.account.address as `0x${string}`,
            contract: contract.address as `0x${string}`,
            contractName: contract.contractType ?? 'Unknown',
            type: contract.isERC721 ? 'ERC721' : 'ERC1155',
            balance: balance.balance,
          })
        }
      } else {
        // Contract exists but no balances indexed yet - show as empty collection
        nfts.push({
          id: contract.id,
          tokenId: '0',
          contract: contract.address as `0x${string}`,
          contractName: contract.contractType ?? 'Unknown',
          type: contract.isERC721 ? 'ERC721' : 'ERC1155',
        })
      }
    }

    return nfts
  }, [nftData])

  const filteredNFTs = useMemo(() => {
    if (filter === 'my-collection' && address) {
      return filterNFTsByOwner(allNFTs, address)
    }
    return allNFTs
  }, [allNFTs, filter, address])

  const sortedNFTs = sortNFTs(filteredNFTs, sortBy)

  const handleListItem = async () => {
    if (!listingModal) return

    const params: CreateListingParams = {
      assetType:
        listingModal.nft.type === 'ERC721'
          ? AssetType.ERC721
          : AssetType.ERC1155,
      assetContract: listingModal.nft.contract as Address,
      tokenId: BigInt(listingModal.nft.tokenId),
      amount: 1n,
      currency: listingModal.currency === 'ETH' ? Currency.ETH : Currency.USDC,
      price: parseEther(listingModal.price),
      durationSeconds: BigInt(
        parseInt(listingModal.duration, 10) * 24 * 60 * 60,
      ),
    }

    await marketplace.createListing(params)
    setListingModal(null)
    setSelectedNFT(null)
  }

  const handleBuyItem = async () => {
    if (!buyConfirmModal) return

    await marketplace.buyListing(
      buyConfirmModal.listing.listingId,
      buyConfirmModal.listing,
    )
    setBuyConfirmModal(null)
    setSelectedNFT(null)
  }

  const handleCancelListing = async (listingId: bigint) => {
    await marketplace.cancelListing(listingId)
    setSelectedNFT(null)
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 md:mb-8">
        <h1
          className="text-2xl sm:text-3xl md:text-4xl font-bold mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          🖼️ Items
        </h1>
        <p
          className="text-sm sm:text-base mb-4"
          style={{ color: 'var(--text-secondary)' }}
        >
          Browse, collect, and trade digital collectibles
        </p>

        {!hasMarketplace && (
          <div className="card p-3 mb-4 border-yellow-500/30 bg-yellow-500/10">
            <p className="text-yellow-400 text-sm">
              Marketplace contract not deployed. Items can be viewed but not
              traded.
            </p>
          </div>
        )}

        {marketplace.isBanned && (
          <div className="card p-3 mb-4 border-red-500/30 bg-red-500/10">
            <p className="text-red-400 text-sm">
              Your account has been restricted from marketplace activities.
            </p>
          </div>
        )}

        {/* Filter Tabs */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex gap-2 overflow-x-auto pb-2 sm:pb-0 -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide">
            <button
              type="button"
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
              All Items
            </button>
            <button
              type="button"
              onClick={() => setFilter('listed')}
              disabled={!hasMarketplace}
              className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all disabled:opacity-50 ${
                filter === 'listed' ? 'bg-bazaar-primary text-white' : ''
              }`}
              style={{
                backgroundColor:
                  filter === 'listed' ? undefined : 'var(--bg-secondary)',
                color:
                  filter === 'listed' ? undefined : 'var(--text-secondary)',
              }}
            >
              🏷️ For Sale
            </button>
            <button
              type="button"
              onClick={() => setFilter('my-collection')}
              disabled={!isConnected}
              className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all disabled:opacity-50 ${
                filter === 'my-collection' ? 'bg-bazaar-primary text-white' : ''
              }`}
              style={{
                backgroundColor:
                  filter === 'my-collection'
                    ? undefined
                    : 'var(--bg-secondary)',
                color:
                  filter === 'my-collection'
                    ? undefined
                    : 'var(--text-secondary)',
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
            <option value="price">Price</option>
          </select>
        </div>

        {/* Stats Row */}
        {hasMarketplace && platformFee && (
          <div
            className="flex gap-4 mt-4 text-xs"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <span>Platform fee: {platformFee.percent}%</span>
            <span>•</span>
            <span>{sortedNFTs.length} items</span>
          </div>
        )}
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
          <h3
            className="text-lg md:text-xl font-semibold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            {filter === 'my-collection'
              ? 'No Items Yet'
              : filter === 'listed'
                ? 'No Items Listed'
                : 'No Items Found'}
          </h3>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {filter === 'my-collection'
              ? "You don't own any collectibles yet"
              : filter === 'listed'
                ? 'No items are currently listed for sale'
                : 'No items have been minted on the network'}
          </p>
        </div>
      )}

      {/* Items Grid */}
      {!isLoading && sortedNFTs.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
          {sortedNFTs.map((nft) => (
            <NFTCard
              key={nft.id}
              nft={nft}
              onClick={() => setSelectedNFT(nft)}
            />
          ))}
        </div>
      )}

      {/* NFT Detail Modal */}
      {selectedNFT && (
        <NFTDetailModal
          nft={selectedNFT}
          onClose={() => setSelectedNFT(null)}
          onList={() =>
            setListingModal({
              nft: selectedNFT,
              price: '',
              duration: '7',
              currency: 'ETH',
            })
          }
          onBuy={(listing) => setBuyConfirmModal({ nft: selectedNFT, listing })}
          onCancel={handleCancelListing}
          address={address}
          hasMarketplace={hasMarketplace}
          isPending={marketplace.isPendingCancel}
        />
      )}

      {/* List Item Modal */}
      {listingModal && (
        <ListItemModal
          state={listingModal}
          onStateChange={setListingModal}
          onConfirm={handleListItem}
          onClose={() => setListingModal(null)}
          platformFee={platformFee}
          isPending={marketplace.isPendingCreate}
        />
      )}

      {/* Buy Confirmation Modal */}
      {buyConfirmModal && (
        <BuyConfirmModal
          nft={buyConfirmModal.nft}
          listing={buyConfirmModal.listing}
          onConfirm={handleBuyItem}
          onClose={() => setBuyConfirmModal(null)}
          isPending={marketplace.isPendingBuy}
        />
      )}
    </div>
  )
}

// NFT Card Component
function NFTCard({
  nft,
  onClick,
}: {
  nft: NormalizedNFT
  onClick: () => void
}) {
  const { data: listing } = useTokenListing(
    nft.contract as Address | undefined,
    nft.tokenId ? BigInt(nft.tokenId) : undefined,
  )

  const isListed = listing?.status === 'active'

  return (
    <button
      type="button"
      className="card overflow-hidden group cursor-pointer active:scale-[0.98] transition-transform text-left relative"
      onClick={onClick}
    >
      {/* Listed Badge */}
      {isListed && (
        <div className="absolute top-2 right-2 z-10 px-2 py-1 rounded-lg bg-green-500/90 text-white text-xs font-medium">
          🏷️ {listing.priceFormatted} {listing.currency}
        </div>
      )}

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
        {nft.type === 'ERC1155' && nft.balance && (
          <p
            className="text-xs mt-1"
            style={{ color: 'var(--text-secondary)' }}
          >
            Qty: {nft.balance}
          </p>
        )}
      </div>
    </button>
  )
}

// NFT Detail Modal Component
function NFTDetailModal({
  nft,
  onClose,
  onList,
  onBuy,
  onCancel,
  address,
  hasMarketplace,
  isPending,
}: {
  nft: NormalizedNFT
  onClose: () => void
  onList: () => void
  onBuy: (listing: FormattedListing) => void
  onCancel: (listingId: bigint) => void
  address: Address | undefined
  hasMarketplace: boolean
  isPending: boolean
}) {
  const isOwner = address ? isNFTOwner(nft, address) : false

  const { data: listing } = useTokenListing(
    nft.contract as Address | undefined,
    nft.tokenId ? BigInt(nft.tokenId) : undefined,
  )

  const isListed = listing?.status === 'active'
  const isSellerOwner =
    listing?.seller?.toLowerCase() === address?.toLowerCase()

  return (
    <dialog
      open
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-transparent"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl border overflow-hidden"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="aspect-[4/3] bg-gradient-to-br from-bazaar-primary to-bazaar-purple flex items-center justify-center text-6xl relative">
          🖼️
          {isListed && (
            <div className="absolute top-4 right-4 px-3 py-1.5 rounded-lg bg-green-500/90 text-white text-sm font-medium">
              🏷️ For Sale
            </div>
          )}
        </div>

        <div className="p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2
                className="text-xl font-bold"
                style={{ color: 'var(--text-primary)' }}
              >
                #{nft.tokenId}
              </h2>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {nft.contractName}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl transition-colors"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              ✕
            </button>
          </div>

          {/* Item Details */}
          <div className="space-y-2 mb-5 text-sm">
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-tertiary)' }}>Type</span>
              <span style={{ color: 'var(--text-primary)' }}>{nft.type}</span>
            </div>
            {nft.owner && (
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-tertiary)' }}>Owner</span>
                <span
                  className="font-mono"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {nft.owner.slice(0, 8)}...{nft.owner.slice(-6)}
                </span>
              </div>
            )}
            {nft.type === 'ERC1155' && nft.balance && (
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-tertiary)' }}>Balance</span>
                <span style={{ color: 'var(--text-primary)' }}>
                  {nft.balance}
                </span>
              </div>
            )}
          </div>

          {/* Listing Info */}
          {isListed && listing && (
            <div
              className="p-4 rounded-xl mb-5"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <div className="flex justify-between items-center mb-2">
                <span style={{ color: 'var(--text-tertiary)' }}>Price</span>
                <span
                  className="text-xl font-bold"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {listing.priceFormatted} {listing.currency}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span style={{ color: 'var(--text-tertiary)' }}>Seller</span>
                <span
                  className="font-mono"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {listing.seller.slice(0, 8)}...{listing.seller.slice(-6)}
                </span>
              </div>
              {listing.expiresAt && (
                <div className="flex justify-between text-xs mt-1">
                  <span style={{ color: 'var(--text-tertiary)' }}>Expires</span>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {listing.expiresAt.toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-2">
            {/* Listed item owned by current user - can cancel */}
            {isListed && isSellerOwner && (
              <button
                type="button"
                onClick={() => onCancel(listing.listingId)}
                disabled={isPending}
                className="btn-secondary w-full py-3 disabled:opacity-50"
              >
                {isPending ? 'Cancelling...' : 'Cancel Listing'}
              </button>
            )}

            {/* Listed item not owned by current user - can buy */}
            {isListed && !isSellerOwner && hasMarketplace && (
              <button
                type="button"
                onClick={() => onBuy(listing)}
                disabled={!address}
                className="btn-primary w-full py-3 disabled:opacity-50"
              >
                {address
                  ? `Buy for ${listing.priceFormatted} ${listing.currency}`
                  : 'Connect Wallet to Buy'}
              </button>
            )}

            {/* Not listed but owned - can list */}
            {!isListed && isOwner && hasMarketplace && (
              <button
                type="button"
                onClick={onList}
                className="btn-primary w-full py-3"
              >
                List for Sale
              </button>
            )}

            {/* Close button for other cases */}
            {((!isListed && !isOwner) || !hasMarketplace) && (
              <button
                type="button"
                onClick={onClose}
                className="btn-secondary w-full py-3"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </dialog>
  )
}

// List Item Modal Component
function ListItemModal({
  state,
  onStateChange,
  onConfirm,
  onClose,
  platformFee,
  isPending,
}: {
  state: ListingModalState
  onStateChange: (state: ListingModalState | null) => void
  onConfirm: () => void
  onClose: () => void
  platformFee: { bps: number; percent: number } | undefined
  isPending: boolean
}) {
  const price = parseFloat(state.price) || 0
  const feeAmount = platformFee ? (price * platformFee.percent) / 100 : 0
  const youReceive = price - feeAmount

  return (
    <dialog
      open
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-transparent"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl border overflow-hidden"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="p-5">
          <div className="flex items-center justify-between mb-6">
            <h2
              className="text-xl font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              List Item for Sale
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl transition-colors"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              ✕
            </button>
          </div>

          {/* Item Preview */}
          <div
            className="flex items-center gap-3 p-3 rounded-xl mb-6"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-bazaar-primary to-bazaar-purple flex items-center justify-center text-2xl">
              🖼️
            </div>
            <div>
              <h3
                className="font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                #{state.nft.tokenId}
              </h3>
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                {state.nft.contractName}
              </p>
            </div>
          </div>

          {/* Form */}
          <div className="space-y-4">
            {/* Price */}
            <div>
              <label
                htmlFor="listing-price"
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                Price
              </label>
              <div className="flex gap-2">
                <input
                  id="listing-price"
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={state.price}
                  onChange={(e) =>
                    onStateChange({ ...state, price: e.target.value })
                  }
                  placeholder="0.00"
                  className="input flex-1"
                />
                <select
                  value={state.currency}
                  onChange={(e) =>
                    onStateChange({
                      ...state,
                      currency: e.target.value as 'ETH' | 'USDC',
                    })
                  }
                  className="input w-24"
                >
                  <option value="ETH">ETH</option>
                  <option value="USDC">USDC</option>
                </select>
              </div>
            </div>

            {/* Duration */}
            <div>
              <label
                htmlFor="listing-duration"
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                Duration
              </label>
              <select
                id="listing-duration"
                value={state.duration}
                onChange={(e) =>
                  onStateChange({ ...state, duration: e.target.value })
                }
                className="input w-full"
              >
                <option value="1">1 day</option>
                <option value="3">3 days</option>
                <option value="7">7 days</option>
                <option value="14">14 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
              </select>
            </div>

            {/* Fee Breakdown */}
            {price > 0 && (
              <div
                className="p-4 rounded-xl space-y-2 text-sm"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
              >
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-tertiary)' }}>
                    Platform fee ({platformFee?.percent ?? 2.5}%)
                  </span>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    -{feeAmount.toFixed(4)} {state.currency}
                  </span>
                </div>
                <div className="flex justify-between font-medium">
                  <span style={{ color: 'var(--text-secondary)' }}>
                    You receive
                  </span>
                  <span style={{ color: 'var(--text-primary)' }}>
                    {youReceive.toFixed(4)} {state.currency}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary flex-1 py-3"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={
                !state.price || parseFloat(state.price) <= 0 || isPending
              }
              className="btn-primary flex-1 py-3 disabled:opacity-50"
            >
              {isPending ? 'Listing...' : 'List Item'}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  )
}

// Buy Confirmation Modal Component
function BuyConfirmModal({
  nft,
  listing,
  onConfirm,
  onClose,
  isPending,
}: {
  nft: NormalizedNFT
  listing: FormattedListing
  onConfirm: () => void
  onClose: () => void
  isPending: boolean
}) {
  return (
    <dialog
      open
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-transparent"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl border overflow-hidden"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="p-5">
          <div className="flex items-center justify-between mb-6">
            <h2
              className="text-xl font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              Confirm Purchase
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl transition-colors"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              ✕
            </button>
          </div>

          {/* Item Preview */}
          <div
            className="flex items-center gap-3 p-3 rounded-xl mb-6"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-bazaar-primary to-bazaar-purple flex items-center justify-center text-2xl">
              🖼️
            </div>
            <div className="flex-1">
              <h3
                className="font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                #{nft.tokenId}
              </h3>
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                {nft.contractName}
              </p>
            </div>
            <div className="text-right">
              <p
                className="text-lg font-bold"
                style={{ color: 'var(--text-primary)' }}
              >
                {listing.priceFormatted}
              </p>
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                {listing.currency}
              </p>
            </div>
          </div>

          {/* Details */}
          <div
            className="p-4 rounded-xl space-y-2 text-sm mb-6"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-tertiary)' }}>Seller</span>
              <span
                className="font-mono"
                style={{ color: 'var(--text-secondary)' }}
              >
                {listing.seller.slice(0, 8)}...{listing.seller.slice(-6)}
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-tertiary)' }}>Item price</span>
              <span style={{ color: 'var(--text-secondary)' }}>
                {listing.priceFormatted} {listing.currency}
              </span>
            </div>
            <div
              className="border-t pt-2 mt-2"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="flex justify-between font-medium">
                <span style={{ color: 'var(--text-secondary)' }}>Total</span>
                <span style={{ color: 'var(--text-primary)' }}>
                  {listing.priceFormatted} {listing.currency}
                </span>
              </div>
            </div>
          </div>

          {/* Warning */}
          <p
            className="text-xs mb-4 text-center"
            style={{ color: 'var(--text-tertiary)' }}
          >
            By clicking "Buy Now", you agree to purchase this item at the listed
            price. This transaction cannot be reversed.
          </p>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary flex-1 py-3"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isPending}
              className="btn-primary flex-1 py-3 disabled:opacity-50"
            >
              {isPending ? 'Processing...' : 'Buy Now'}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  )
}
