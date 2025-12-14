'use client'

import { useState } from 'react'
import { useAccount } from 'wagmi'
import { JEJU_CHAIN_ID } from '@/config/chains'
import { toast } from 'sonner'
import Link from 'next/link'

type LaunchType = 'bonding' | 'ico'

interface BondingConfig {
  virtualEth: string
  graduationTarget: string
  tokenSupply: string
}

interface ICOConfig {
  presaleAllocation: number
  presalePrice: string
  lpFunding: number
  lpLockDuration: number
  buyerLockDuration: number
  softCap: string
  hardCap: string
  presaleDuration: number
}

export default function LaunchTokenPage() {
  const { isConnected, chain } = useAccount()
  const isCorrectChain = chain?.id === JEJU_CHAIN_ID || chain?.id === 1337

  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [creatorFeePercent, setCreatorFeePercent] = useState(80)
  const [communityVault, setCommunityVault] = useState('')
  const [launchType, setLaunchType] = useState<LaunchType>('bonding')
  const [isLaunching, setIsLaunching] = useState(false)

  const [bondingConfig, setBondingConfig] = useState<BondingConfig>({
    virtualEth: '30',
    graduationTarget: '10',
    tokenSupply: '1000000000',
  })

  const [icoConfig, setICOConfig] = useState<ICOConfig>({
    presaleAllocation: 30,
    presalePrice: '0.0001',
    lpFunding: 80,
    lpLockDuration: 30,
    buyerLockDuration: 7,
    softCap: '5',
    hardCap: '50',
    presaleDuration: 7,
  })

  const handleLaunch = () => {
    if (!isConnected) {
      toast.error('Please connect your wallet')
      return
    }
    if (!isCorrectChain) {
      toast.error('Please switch to the network network')
      return
    }
    if (!name || !symbol) {
      toast.error('Please fill in token name and symbol')
      return
    }

    toast.info('Launchpad contract deployment coming soon', {
      description: 'This feature will be available after contract deployment',
    })
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="text-center mb-8">
        <h1 className="text-3xl md:text-4xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          Launch Token
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Launch your token with zero platform fees - 100% to creators and community
        </p>
      </div>

      {!isConnected && (
        <div className="card p-4 mb-6 border-bazaar-warning/50 bg-bazaar-warning/10">
          <p className="text-bazaar-warning">Please connect your wallet to launch a token</p>
        </div>
      )}

      <div className="card p-5 md:p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          Token Details
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
              Token Name <span className="text-bazaar-error">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Awesome Token"
              className="input"
              data-testid="token-name-input"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
              Symbol <span className="text-bazaar-error">*</span>
            </label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="MAT"
              maxLength={10}
              className="input"
              data-testid="token-symbol-input"
            />
          </div>
        </div>
      </div>

      <div className="card p-5 md:p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          Fee Distribution
        </h2>
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
          100% of trading fees go to creators and community - zero platform fees
        </p>
        
        <div className="mb-4">
          <div className="flex justify-between text-sm mb-2">
            <span style={{ color: 'var(--text-secondary)' }}>Creator: {creatorFeePercent}%</span>
            <span style={{ color: 'var(--text-secondary)' }}>Community: {100 - creatorFeePercent}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={creatorFeePercent}
            onChange={(e) => setCreatorFeePercent(Number(e.target.value))}
            className="w-full h-2 bg-[var(--bg-tertiary)] rounded-lg appearance-none cursor-pointer accent-bazaar-primary"
            data-testid="fee-slider"
          />
          <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
            <span>100% Community</span>
            <span>100% Creator</span>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
            Community Vault Address (optional)
          </label>
          <input
            type="text"
            value={communityVault}
            onChange={(e) => setCommunityVault(e.target.value)}
            placeholder="0x... (leave empty for default)"
            className="input font-mono text-sm"
          />
        </div>
      </div>

      <div className="card p-5 md:p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          Launch Type
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => setLaunchType('bonding')}
            className={`p-4 rounded-xl border-2 text-left transition-all ${
              launchType === 'bonding'
                ? 'border-bazaar-primary bg-bazaar-primary/10'
                : 'border-[var(--border-primary)] hover:border-bazaar-primary/50'
            }`}
            data-testid="bonding-type-btn"
          >
            <div className="text-2xl mb-2">📈</div>
            <h3 className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
              Pump Style
            </h3>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Bonding curve that graduates to LP when target is reached.
            </p>
          </button>

          <button
            type="button"
            onClick={() => setLaunchType('ico')}
            className={`p-4 rounded-xl border-2 text-left transition-all ${
              launchType === 'ico'
                ? 'border-bazaar-primary bg-bazaar-primary/10'
                : 'border-[var(--border-primary)] hover:border-bazaar-primary/50'
            }`}
            data-testid="ico-type-btn"
          >
            <div className="text-2xl mb-2">💰</div>
            <h3 className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
              ICO Style
            </h3>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Presale that funds LP with configurable lock periods.
            </p>
          </button>
        </div>
      </div>

      {launchType === 'bonding' && (
        <div className="card p-5 md:p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            Bonding Curve Settings
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                Virtual ETH Reserves
              </label>
              <input
                type="number"
                value={bondingConfig.virtualEth}
                onChange={(e) => setBondingConfig({ ...bondingConfig, virtualEth: e.target.value })}
                className="input"
              />
              <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                Sets initial price
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                Graduation Target (ETH)
              </label>
              <input
                type="number"
                value={bondingConfig.graduationTarget}
                onChange={(e) => setBondingConfig({ ...bondingConfig, graduationTarget: e.target.value })}
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                Token Supply
              </label>
              <input
                type="number"
                value={bondingConfig.tokenSupply}
                onChange={(e) => setBondingConfig({ ...bondingConfig, tokenSupply: e.target.value })}
                className="input"
              />
            </div>
          </div>
        </div>
      )}

      {launchType === 'ico' && (
        <div className="card p-5 md:p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            ICO Presale Settings
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                Presale Allocation: {icoConfig.presaleAllocation}%
              </label>
              <input
                type="range"
                min="10"
                max="50"
                value={icoConfig.presaleAllocation}
                onChange={(e) => setICOConfig({ ...icoConfig, presaleAllocation: Number(e.target.value) })}
                className="w-full accent-bazaar-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                Presale Price (ETH/token)
              </label>
              <input
                type="number"
                step="0.0001"
                value={icoConfig.presalePrice}
                onChange={(e) => setICOConfig({ ...icoConfig, presalePrice: e.target.value })}
                className="input"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                Soft Cap (ETH)
              </label>
              <input
                type="number"
                value={icoConfig.softCap}
                onChange={(e) => setICOConfig({ ...icoConfig, softCap: e.target.value })}
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                Hard Cap (ETH)
              </label>
              <input
                type="number"
                value={icoConfig.hardCap}
                onChange={(e) => setICOConfig({ ...icoConfig, hardCap: e.target.value })}
                className="input"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                LP Funding: {icoConfig.lpFunding}%
              </label>
              <input
                type="range"
                min="50"
                max="100"
                value={icoConfig.lpFunding}
                onChange={(e) => setICOConfig({ ...icoConfig, lpFunding: Number(e.target.value) })}
                className="w-full accent-bazaar-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                LP Lock Duration
              </label>
              <select
                value={icoConfig.lpLockDuration}
                onChange={(e) => setICOConfig({ ...icoConfig, lpLockDuration: Number(e.target.value) })}
                className="input"
              >
                <option value={7}>1 week</option>
                <option value={30}>1 month</option>
                <option value={90}>3 months</option>
                <option value={180}>6 months</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                Buyer Token Lock
              </label>
              <select
                value={icoConfig.buyerLockDuration}
                onChange={(e) => setICOConfig({ ...icoConfig, buyerLockDuration: Number(e.target.value) })}
                className="input"
              >
                <option value={7}>1 week</option>
                <option value={30}>1 month</option>
                <option value={90}>3 months</option>
                <option value={180}>6 months</option>
              </select>
            </div>
          </div>
        </div>
      )}

      <div className="card p-5 md:p-6 mb-6 border-bazaar-primary/30 bg-bazaar-primary/5">
        <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          Launch Summary
        </h2>
        <div className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <p><strong>Token:</strong> {name || 'Not set'} ({symbol || 'N/A'})</p>
          <p><strong>Launch Type:</strong> {launchType === 'bonding' ? 'Pump Style' : 'ICO Style'}</p>
          <p><strong>Fee Split:</strong> {creatorFeePercent}% creator, {100 - creatorFeePercent}% community</p>
          <p><strong>Platform Fee:</strong> 0% (totally free)</p>
        </div>
      </div>

      <button
        onClick={handleLaunch}
        disabled={!isConnected || !isCorrectChain || isLaunching || !name || !symbol}
        className="btn-primary w-full py-4 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
        data-testid="launch-btn"
      >
        {isLaunching ? 'Launching...' : !isConnected ? 'Connect Wallet' : 'Launch Token'}
      </button>

      <div className="text-center mt-6">
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Need a simple token?{' '}
          <Link href="/coins/create" className="text-bazaar-primary hover:underline">
            Create basic ERC20
          </Link>
        </p>
      </div>
    </div>
  )
}
