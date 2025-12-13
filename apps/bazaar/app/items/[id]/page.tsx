'use client'

import { useParams } from 'next/navigation'
import { useAccount } from 'wagmi'
import { useState } from 'react'

export default function NFTDetailPage() {
  const params = useParams()
  const { address, isConnected } = useAccount()
  const [showListModal, setShowListModal] = useState(false)
  const [showTransferModal, setShowTransferModal] = useState(false)

  const rawId = params?.id
  const id = Array.isArray(rawId) ? rawId[0] : rawId ?? ''
  const [nftContract, tokenId] = id.split('-')

  const isOwner = true

  return (
    <div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">
        {/* NFT Image */}
        <div className="rounded-2xl overflow-hidden bg-gradient-to-br from-bazaar-primary to-bazaar-purple aspect-square flex items-center justify-center text-6xl md:text-8xl">
          🖼️
        </div>

        {/* NFT Info */}
        <div>
          <h1 className="text-2xl md:text-4xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            Item #{tokenId}
          </h1>
          <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
            Collection: {nftContract?.slice(0, 6)}...
          </p>

          <div className="card p-5 md:p-6 mb-6">
            <h2 className="text-lg md:text-xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
              Details
            </h2>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-secondary)' }}>Owner</span>
                <span className="font-mono text-sm" style={{ color: 'var(--text-primary)' }}>
                  {address?.slice(0, 6)}...{address?.slice(-4)}
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-secondary)' }}>Token ID</span>
                <span style={{ color: 'var(--text-primary)' }}>{tokenId}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-secondary)' }}>Contract</span>
                <span className="font-mono text-xs" style={{ color: 'var(--text-primary)' }}>
                  {nftContract?.slice(0, 6)}...{nftContract?.slice(-4)}
                </span>
              </div>
            </div>
          </div>

          {/* Actions */}
          {isConnected && isOwner && (
            <div className="space-y-3">
              <button
                onClick={() => setShowListModal(true)}
                className="btn-primary w-full py-4"
                data-testid="list-item-button"
              >
                List for Sale
              </button>
              <button
                onClick={() => setShowTransferModal(true)}
                className="btn-secondary w-full py-4"
                data-testid="transfer-item-button"
              >
                Transfer Item
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Activity Feed */}
      <div className="mt-12">
        <h2 className="text-xl md:text-2xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>
          Activity
        </h2>
        <div className="card p-5 md:p-6">
          <p className="text-center py-8" style={{ color: 'var(--text-tertiary)' }}>
            Activity history will appear here (transfers, sales, bids)
          </p>
        </div>
      </div>

      {/* Transfer Modal */}
      {showTransferModal && (
        <div 
          className="fixed inset-0 flex items-center justify-center z-50 p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
        >
          <div 
            className="w-full max-w-md p-6 rounded-2xl border"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <h2 className="text-xl md:text-2xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>
              Transfer Item
            </h2>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                  Recipient Address
                </label>
                <input
                  type="text"
                  placeholder="0x..."
                  className="input"
                  data-testid="transfer-address-input"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowTransferModal(false)}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                className="btn-primary flex-1"
                data-testid="confirm-transfer-button"
              >
                Transfer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
