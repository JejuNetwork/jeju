/**
 * Mint NFT Page
 */

import { Link } from 'react-router-dom'

export default function ItemMintPage() {
  return (
    <div className="max-w-xl mx-auto">
      <Link
        to="/items"
        className="text-sm mb-4 inline-block"
        style={{ color: 'var(--text-secondary)' }}
      >
        ← Back to NFTs
      </Link>

      <h1
        className="text-2xl sm:text-3xl font-bold mb-6"
        style={{ color: 'var(--text-primary)' }}
      >
        🖼️ Mint NFT
      </h1>

      <div className="card p-6">
        <form className="space-y-4">
          <div>
            <label
              className="text-sm block mb-1.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Name
            </label>
            <input type="text" placeholder="My NFT" className="input" />
          </div>

          <div>
            <label
              className="text-sm block mb-1.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Description
            </label>
            <textarea
              placeholder="Describe your NFT..."
              className="input min-h-[100px]"
            />
          </div>

          <div>
            <label
              className="text-sm block mb-1.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Image URL
            </label>
            <input type="url" placeholder="https://..." className="input" />
          </div>

          <button type="submit" className="btn-primary w-full py-3">
            Mint NFT
          </button>
        </form>
      </div>
    </div>
  )
}
