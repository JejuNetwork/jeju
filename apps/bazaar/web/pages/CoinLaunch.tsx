/**
 * Token Launch Page
 *
 * Create and launch a new token with bonding curve
 */

import { useState } from 'react'
import { BackLink, InfoCard } from '../components/ui'

export default function CoinLaunchPage() {
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [description, setDescription] = useState('')
  const [liquidity, setLiquidity] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Token launch logic would go here
  }

  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      <BackLink to="/coins" label="Back to Coins" />

      {/* Header */}
      <header className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gradient-warm flex items-center gap-3 mb-2">
          <span className="text-3xl animate-bounce-subtle" aria-hidden="true">🚀</span>
          <span>Launch Token</span>
        </h1>
        <p className="text-secondary">
          Create your token with a bonding curve and watch it grow
        </p>
      </header>

      {/* Info Card */}
      <InfoCard variant="info" className="mb-6">
        <p className="font-medium mb-1">How it works</p>
        <p className="text-sm opacity-80">
          Your token will be launched with an automated bonding curve. The price increases as more people buy, creating fair price discovery.
        </p>
      </InfoCard>

      {/* Form */}
      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        <div>
          <label
            htmlFor="token-name"
            className="block text-sm font-medium text-primary mb-2"
          >
            Token Name
          </label>
          <input
            id="token-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Awesome Token"
            className="input"
            required
            maxLength={32}
          />
          <p className="text-xs text-tertiary mt-1">
            The full name of your token (e.g., "Bitcoin", "Ethereum")
          </p>
        </div>

        <div>
          <label
            htmlFor="symbol"
            className="block text-sm font-medium text-primary mb-2"
          >
            Symbol
          </label>
          <input
            id="symbol"
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="MTK"
            className="input uppercase"
            required
            maxLength={8}
          />
          <p className="text-xs text-tertiary mt-1">
            A short ticker symbol (e.g., "BTC", "ETH")
          </p>
        </div>

        <div>
          <label
            htmlFor="description"
            className="block text-sm font-medium text-primary mb-2"
          >
            Description
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Tell people what makes your token special..."
            className="input min-h-[100px] resize-y"
            maxLength={500}
          />
          <p className="text-xs text-tertiary mt-1">
            {description.length}/500 characters
          </p>
        </div>

        <div>
          <label
            htmlFor="initial-liquidity"
            className="block text-sm font-medium text-primary mb-2"
          >
            Initial Liquidity (ETH)
          </label>
          <input
            id="initial-liquidity"
            type="number"
            value={liquidity}
            onChange={(e) => setLiquidity(e.target.value)}
            placeholder="0.1"
            step="0.01"
            min="0.01"
            className="input"
            required
          />
          <p className="text-xs text-tertiary mt-1">
            The amount of ETH to seed the bonding curve. More liquidity = less price impact.
          </p>
        </div>

        {/* Summary */}
        {name && symbol && liquidity && (
          <div className="p-4 rounded-xl bg-surface-secondary animate-fade-in">
            <h3 className="text-sm font-medium text-primary mb-2">Preview</h3>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl gradient-warm flex items-center justify-center text-white font-bold">
                {symbol.slice(0, 2)}
              </div>
              <div>
                <p className="font-semibold text-primary">{name}</p>
                <p className="text-sm text-tertiary">${symbol} • {liquidity} ETH liquidity</p>
              </div>
            </div>
          </div>
        )}

        <button type="submit" className="btn-primary w-full py-4 text-lg">
          🚀 Launch Token
        </button>
      </form>
    </div>
  )
}
