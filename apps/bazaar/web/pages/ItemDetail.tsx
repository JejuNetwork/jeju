/**
 * Item Detail Page
 *
 * Shows NFT item details with integrated Farcaster channel feed.
 */

import { Link, useParams } from 'react-router-dom'
import type { Address } from 'viem'
import { ChannelFeed } from '../components/ChannelFeed'
import { getItemChannel } from '../hooks/useMessaging'

export default function ItemDetailPage() {
  const { id } = useParams<{ id: string }>()

  if (!id) {
    return (
      <div className="text-center py-12">
        <p style={{ color: 'var(--text-secondary)' }}>Invalid item URL</p>
      </div>
    )
  }

  // Parse the id to get collection address and token ID
  // Format: collectionAddress-tokenId or just tokenId with default collection
  const [collectionPart, tokenIdPart] = id.includes('-')
    ? id.split('-')
    : ['0x0000000000000000000000000000000000000000', id]

  const collectionAddress = (collectionPart ??
    '0x0000000000000000000000000000000000000000') as Address
  const tokenId = tokenIdPart ?? id
  const itemName = `Item #${tokenId}`
  const collectionName = 'Collection Name'
  const channel = getItemChannel(collectionAddress, tokenId, itemName)

  return (
    <div className="max-w-4xl mx-auto">
      <Link
        to="/items"
        className="text-sm mb-4 inline-block"
        style={{ color: 'var(--text-secondary)' }}
      >
        ← Back to Items
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Image Section */}
        <div className="card overflow-hidden">
          <div className="aspect-square bg-gradient-to-br from-bazaar-primary to-bazaar-purple flex items-center justify-center text-8xl">
            🖼️
          </div>
        </div>

        {/* Details Section */}
        <div className="space-y-4">
          <div className="card p-6">
            <h1
              className="text-2xl font-bold mb-2"
              style={{ color: 'var(--text-primary)' }}
            >
              {itemName}
            </h1>
            <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
              {collectionName}
            </p>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div
                className="p-4 rounded-xl"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
              >
                <p
                  className="text-xs"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Owner
                </p>
                <p
                  className="font-mono text-sm truncate"
                  style={{ color: 'var(--text-primary)' }}
                >
                  0x1234...5678
                </p>
              </div>
              <div
                className="p-4 rounded-xl"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
              >
                <p
                  className="text-xs"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Token ID
                </p>
                <p
                  className="font-semibold"
                  style={{ color: 'var(--text-primary)' }}
                >
                  #{tokenId}
                </p>
              </div>
            </div>

            <button type="button" className="btn-primary w-full py-3">
              Make Offer
            </button>
          </div>

          {/* Farcaster Channel Feed */}
          <ChannelFeed channel={channel} compact />
        </div>
      </div>
    </div>
  )
}
