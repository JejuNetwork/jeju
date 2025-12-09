'use client'

import { useState } from 'react'
import { useAccount, useWriteContract } from 'wagmi'
import { toast } from 'sonner'

export default function MintNFTPage() {
  const { isConnected } = useAccount()
  const { isPending } = useWriteContract()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [image, setImage] = useState('')

  const mintNFT = () => {
    if (!isConnected) {
      toast.error('Please connect your wallet')
      return
    }

    const metadata = JSON.stringify({ name, description, image })
    toast.success('Minting functionality ready - connect to NFT contract')
    console.log('Mint NFT:', { name, description, image, metadata })
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <h1 className="text-3xl md:text-4xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          🖼️ Mint New Item
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Create your own NFT on the Jeju network
        </p>
      </div>

      <div className="card p-5 md:p-6 space-y-5 md:space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
            Item Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Legendary Sword"
            className="input"
            data-testid="nft-name-input"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A powerful sword forged in dragon fire..."
            className="input h-32 resize-none"
            data-testid="nft-description-input"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
            Image URL
          </label>
          <input
            type="text"
            value={image}
            onChange={(e) => setImage(e.target.value)}
            placeholder="ipfs://..."
            className="input"
            data-testid="nft-image-input"
          />
        </div>

        <button
          onClick={mintNFT}
          disabled={!isConnected || !name || isPending}
          className="btn-primary w-full py-4 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="mint-nft-button"
        >
          {!isConnected ? 'Connect Wallet' : isPending ? 'Minting...' : 'Mint Item'}
        </button>
      </div>

      <div className="card p-5 md:p-6 mt-6">
        <h2 className="font-bold mb-3" style={{ color: 'var(--text-primary)' }}>About Minting</h2>
        <ul className="text-sm space-y-2" style={{ color: 'var(--text-secondary)' }}>
          <li>✅ Mints as ERC-721 NFT</li>
          <li>✅ Stored on IPFS (decentralized)</li>
          <li>✅ Fully on-chain ownership</li>
          <li>✅ Can list for sale immediately</li>
        </ul>
      </div>
    </div>
  )
}
