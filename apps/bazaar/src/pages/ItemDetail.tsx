/**
 * Item Detail Page
 */

import { Link, useParams } from 'react-router-dom'

export default function ItemDetailPage() {
  const { id } = useParams<{ id: string }>()

  return (
    <div className="max-w-2xl mx-auto">
      <Link
        to="/items"
        className="text-sm mb-4 inline-block"
        style={{ color: 'var(--text-secondary)' }}
      >
        ← Back to NFTs
      </Link>

      <div className="card overflow-hidden">
        <div className="aspect-square bg-gradient-to-br from-bazaar-primary to-bazaar-purple flex items-center justify-center text-8xl">
          🖼️
        </div>

        <div className="p-6">
          <h1
            className="text-2xl font-bold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            NFT #{id}
          </h1>
          <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
            Collection Name
          </p>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div
              className="p-4 rounded-xl"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
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
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Token ID
              </p>
              <p
                className="font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                #{id}
              </p>
            </div>
          </div>

          <button className="btn-primary w-full py-3">Make Offer</button>
        </div>
      </div>
    </div>
  )
}
