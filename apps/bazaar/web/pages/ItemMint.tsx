/**
 * Mint Item Page
 * Full minting interface for SimpleCollectible contract
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { useMint } from '../hooks/useMint'

interface MintFormState {
  name: string
  description: string
  imageUrl: string
  externalUrl: string
}

export default function ItemMintPage() {
  const { isConnected } = useAccount()
  const mint = useMint()

  const [form, setForm] = useState<MintFormState>({
    name: '',
    description: '',
    imageUrl: '',
    externalUrl: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [mintedTokenId, setMintedTokenId] = useState<string | null>(null)

  const handleInputChange = (field: keyof MintFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    setError(null)
  }

  const validateForm = (): boolean => {
    if (!form.name.trim()) {
      setError('Name is required')
      return false
    }
    if (!form.imageUrl.trim()) {
      setError('Image URL is required')
      return false
    }
    // Basic URL validation
    try {
      new URL(form.imageUrl)
    } catch {
      setError('Please enter a valid image URL')
      return false
    }
    return true
  }

  const buildTokenURI = (): string => {
    // Create a data URI with the metadata JSON
    const metadata = {
      name: form.name,
      description: form.description,
      image: form.imageUrl,
      external_url: form.externalUrl || undefined,
      attributes: [],
    }

    // For production, you'd want to upload this to IPFS
    // For now, we'll use a data URI (base64 encoded JSON)
    const json = JSON.stringify(metadata)
    const base64 = btoa(json)
    return `data:application/json;base64,${base64}`
  }

  const handleMint = async () => {
    if (!validateForm()) return
    if (!mint.canMint) {
      setError('Minting not available')
      return
    }

    setError(null)

    try {
      const tokenURI = buildTokenURI()
      const result = await mint.mint({ tokenURI })
      setMintedTokenId(result.tokenId)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to mint'
      setError(message)
    }
  }

  // Success state
  if (mintedTokenId) {
    return (
      <div className="max-w-xl mx-auto">
        <div className="card p-8 text-center">
          <div className="text-6xl mb-4">🎉</div>
          <h1
            className="text-2xl font-bold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Item Minted Successfully
          </h1>
          <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
            Your collectible has been created with Token ID #{mintedTokenId}
          </p>

          {/* Preview */}
          <div
            className="rounded-xl overflow-hidden mb-6 mx-auto max-w-xs"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            {form.imageUrl && (
              <img
                src={form.imageUrl}
                alt={form.name}
                className="w-full aspect-square object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            )}
            <div className="p-4">
              <h3
                className="font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                {form.name}
              </h3>
              <p
                className="text-sm mt-1"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Token #{mintedTokenId}
              </p>
            </div>
          </div>

          <div className="flex gap-3 justify-center">
            <button
              type="button"
              onClick={() => {
                setMintedTokenId(null)
                setForm({
                  name: '',
                  description: '',
                  imageUrl: '',
                  externalUrl: '',
                })
              }}
              className="btn-secondary px-6 py-2"
            >
              Mint Another
            </button>
            <Link to="/items" className="btn-primary px-6 py-2">
              View Collection
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto">
      <Link
        to="/items"
        className="text-sm mb-4 inline-block"
        style={{ color: 'var(--text-secondary)' }}
      >
        ← Back to Items
      </Link>

      <h1
        className="text-2xl sm:text-3xl font-bold mb-2"
        style={{ color: 'var(--text-primary)' }}
      >
        🖼️ Mint Item
      </h1>
      <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
        Create a new collectible on the blockchain
      </p>

      {/* Contract Status */}
      {mint.isLoading ? (
        <div className="card p-4 mb-6 flex items-center gap-3">
          <LoadingSpinner size="sm" />
          <span style={{ color: 'var(--text-secondary)' }}>
            Loading contract...
          </span>
        </div>
      ) : !mint.isReady ? (
        <div className="card p-4 mb-6 border-yellow-500/30 bg-yellow-500/10">
          <p className="text-yellow-400">
            Collectible contract not deployed. Minting is not available.
          </p>
        </div>
      ) : !isConnected ? (
        <div className="card p-4 mb-6 border-blue-500/30 bg-blue-500/10">
          <p className="text-blue-400">
            Connect your wallet to mint a collectible.
          </p>
        </div>
      ) : null}

      {/* Stats */}
      {mint.isReady && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="card p-3 text-center">
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Total Minted
            </p>
            <p
              className="text-lg font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              {mint.totalSupply ?? '0'}
            </p>
          </div>
          <div className="card p-3 text-center">
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Max Supply
            </p>
            <p
              className="text-lg font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              {mint.maxSupply ?? '∞'}
            </p>
          </div>
          <div className="card p-3 text-center">
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Mint Fee
            </p>
            <p
              className="text-lg font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              {mint.mintFee?.isFree ? 'Free' : `${mint.mintFee?.eth} ETH`}
            </p>
          </div>
        </div>
      )}

      {/* Mint Form */}
      <div className="card p-6">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            handleMint()
          }}
        >
          {/* Name */}
          <div>
            <label
              htmlFor="item-name"
              className="text-sm block mb-1.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Name *
            </label>
            <input
              id="item-name"
              type="text"
              value={form.name}
              onChange={(e) => handleInputChange('name', e.target.value)}
              placeholder="My Collectible"
              className="input w-full"
              disabled={!mint.isReady || !isConnected || mint.isPending}
            />
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="item-description"
              className="text-sm block mb-1.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Description
            </label>
            <textarea
              id="item-description"
              value={form.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
              placeholder="Describe your collectible..."
              className="input min-h-[100px] w-full"
              disabled={!mint.isReady || !isConnected || mint.isPending}
            />
          </div>

          {/* Image URL */}
          <div>
            <label
              htmlFor="item-image-url"
              className="text-sm block mb-1.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Image URL *
            </label>
            <input
              id="item-image-url"
              type="url"
              value={form.imageUrl}
              onChange={(e) => handleInputChange('imageUrl', e.target.value)}
              placeholder="https://example.com/image.png"
              className="input w-full"
              disabled={!mint.isReady || !isConnected || mint.isPending}
            />
            <p
              className="text-xs mt-1"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Use an IPFS URL (ipfs://...) or HTTP URL for your image
            </p>
          </div>

          {/* External URL (optional) */}
          <div>
            <label
              htmlFor="item-external-url"
              className="text-sm block mb-1.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              External URL (optional)
            </label>
            <input
              id="item-external-url"
              type="url"
              value={form.externalUrl}
              onChange={(e) => handleInputChange('externalUrl', e.target.value)}
              placeholder="https://yoursite.com/item"
              className="input w-full"
              disabled={!mint.isReady || !isConnected || mint.isPending}
            />
          </div>

          {/* Image Preview */}
          {form.imageUrl && (
            <div>
              <label
                className="text-sm block mb-1.5"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Preview
              </label>
              <div
                className="rounded-xl overflow-hidden max-w-xs"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
              >
                <img
                  src={form.imageUrl}
                  alt="Preview"
                  className="w-full aspect-square object-cover"
                  onError={(e) => {
                    e.currentTarget.src = ''
                    e.currentTarget.alt = 'Failed to load image'
                    e.currentTarget.className =
                      'w-full aspect-square flex items-center justify-center text-red-400'
                  }}
                />
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 rounded-xl border-red-500/30 bg-red-500/10">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={
              !mint.isReady || !isConnected || !mint.canMint || mint.isPending
            }
            className="btn-primary w-full py-3 disabled:opacity-50"
          >
            {mint.isPending ? (
              <span className="flex items-center justify-center gap-2">
                <LoadingSpinner size="sm" />
                Minting...
              </span>
            ) : !isConnected ? (
              'Connect Wallet'
            ) : !mint.canMint ? (
              'Minting Unavailable'
            ) : mint.mintFee?.isFree ? (
              'Mint Item (Free)'
            ) : (
              `Mint Item (${mint.mintFee?.eth} ETH)`
            )}
          </button>

          {/* User stats */}
          {isConnected && mint.isReady && (
            <p
              className="text-xs text-center"
              style={{ color: 'var(--text-tertiary)' }}
            >
              You have minted {mint.userMintCount ?? '0'} item(s)
              {mint.maxPerAddress !== 'unlimited' &&
                ` (max: ${mint.maxPerAddress})`}
            </p>
          )}
        </form>
      </div>
    </div>
  )
}
