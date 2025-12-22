'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAccount } from 'wagmi'
import { JEJU_CHAIN_ID } from '@/config/chains'
import {
  type BondingCurveConfig,
  type ICOConfig,
  useTokenLaunchpad,
} from '@/hooks/launchpad'
import {
  DEFAULT_BONDING_CONFIG,
  DEFAULT_ICO_CONFIG,
  DEGEN_ICO_CONFIG,
} from '@/lib/launchpad'

type LaunchType = 'bonding' | 'ico' | 'modern'
type LaunchPreset = 'pump' | 'ico' | 'degen' | 'custom'

// Preset configurations
const PRESETS: Record<
  LaunchPreset,
  { name: string; description: string; emoji: string }
> = {
  pump: {
    name: 'Pump Style',
    description:
      'Bonding curve that graduates to LP. Fair launch, no presale, instant trading.',
    emoji: '📈',
  },
  ico: {
    name: 'ICO Style',
    description:
      'Traditional presale with soft/hard caps, LP lock, and buyer vesting.',
    emoji: '💰',
  },
  degen: {
    name: 'Modern Degen',
    description:
      'Short presale, small team allo, holder fees, creator fees. Fast and fair.',
    emoji: '🚀',
  },
  custom: {
    name: 'Custom',
    description:
      'Configure everything yourself. Full control over all parameters.',
    emoji: '⚙️',
  },
}

export default function LaunchTokenPage() {
  const { isConnected, chain } = useAccount()
  const isCorrectChain = chain?.id === JEJU_CHAIN_ID || chain?.id === 1337
  const successToastShown = useRef(false)

  // Launchpad hook
  const {
    isAvailable,
    launchCount,
    defaultCommunityVault,
    txHash,
    isPending,
    isSuccess,
    error,
    launchBondingCurve,
    launchICO,
  } = useTokenLaunchpad(chain?.id || JEJU_CHAIN_ID)

  // Form state
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [creatorFeePercent, setCreatorFeePercent] = useState(80)
  const [communityVault, setCommunityVault] = useState('')
  const [preset, setPreset] = useState<LaunchPreset>('pump')
  const [launchType, setLaunchType] = useState<LaunchType>('bonding')

  const [bondingConfig, setBondingConfig] = useState<BondingCurveConfig>(
    DEFAULT_BONDING_CONFIG,
  )
  const [icoConfig, setICOConfig] = useState<ICOConfig>(DEFAULT_ICO_CONFIG)

  // Update launch type based on preset
  useEffect(() => {
    if (preset === 'pump') {
      setLaunchType('bonding')
      setBondingConfig(DEFAULT_BONDING_CONFIG)
      setCreatorFeePercent(80)
    } else if (preset === 'ico') {
      setLaunchType('ico')
      setICOConfig(DEFAULT_ICO_CONFIG)
      setCreatorFeePercent(50)
    } else if (preset === 'degen') {
      setLaunchType('ico')
      setICOConfig(DEGEN_ICO_CONFIG)
      setCreatorFeePercent(70)
    }
  }, [preset])

  // Handle success
  useEffect(() => {
    if (isSuccess && txHash && !successToastShown.current) {
      successToastShown.current = true
      toast.success(`Token ${symbol} launched successfully.`, {
        description: 'Your token is now live and tradeable.',
        action: {
          label: 'View Token',
          onClick: () => (window.location.href = '/coins'),
        },
      })
    }
  }, [isSuccess, txHash, symbol])

  // Handle error
  useEffect(() => {
    if (error) {
      toast.error('Launch failed', {
        description: error.message,
      })
    }
  }, [error])

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
    if (!isAvailable) {
      toast.error('Launchpad not available on this network')
      return
    }

    successToastShown.current = false
    const creatorFeeBps = Math.round(creatorFeePercent * 100)
    const vaultAddress = communityVault || null

    if (launchType === 'bonding') {
      launchBondingCurve(
        name,
        symbol,
        creatorFeeBps,
        vaultAddress as `0x${string}` | null,
        bondingConfig,
      )
    } else {
      const totalSupply = preset === 'degen' ? '1000000000' : '1000000000'
      launchICO(
        name,
        symbol,
        totalSupply,
        creatorFeeBps,
        vaultAddress as `0x${string}` | null,
        icoConfig,
      )
    }

    toast.info(`Launching ${symbol}...`, {
      description: 'Please confirm the transaction in your wallet',
    })
  }

  const isLaunching = isPending

  return (
    <div className="max-w-3xl mx-auto">
      <div className="text-center mb-8">
        <h1
          className="text-3xl md:text-4xl font-bold mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          Launch Token
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Launch your token with zero platform fees - 100% to creators and
          community
        </p>
        {launchCount !== undefined && (
          <p className="text-sm mt-2" style={{ color: 'var(--text-tertiary)' }}>
            {Number(launchCount)} tokens launched on this network
          </p>
        )}
      </div>

      {/* Alerts */}
      {!isConnected && (
        <div className="card p-4 mb-6 border-bazaar-warning/50 bg-bazaar-warning/10">
          <p className="text-bazaar-warning">
            Please connect your wallet to launch a token
          </p>
        </div>
      )}

      {isConnected && !isCorrectChain && (
        <div className="card p-4 mb-6 border-bazaar-error/50 bg-bazaar-error/10">
          <p className="text-bazaar-error">Please switch to Jeju network</p>
        </div>
      )}

      {isConnected && isCorrectChain && !isAvailable && (
        <div className="card p-4 mb-6 border-bazaar-warning/50 bg-bazaar-warning/10">
          <p className="text-bazaar-warning">
            Launchpad contracts not yet deployed on this network.
            <br />
            <span className="text-sm">
              Run: bun run scripts/deploy-launchpad.ts --network=localnet
            </span>
          </p>
        </div>
      )}

      {/* Preset Selection */}
      <div className="card p-5 md:p-6 mb-6">
        <h2
          className="text-lg font-semibold mb-4"
          style={{ color: 'var(--text-primary)' }}
        >
          Choose Launch Style
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(Object.keys(PRESETS) as LaunchPreset[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              className={`p-4 rounded-xl border-2 text-left transition-all ${
                preset === p
                  ? 'border-bazaar-primary bg-bazaar-primary/10'
                  : 'border-[var(--border-primary)] hover:border-bazaar-primary/50'
              }`}
              data-testid={`preset-${p}-btn`}
            >
              <div className="text-2xl mb-2">{PRESETS[p].emoji}</div>
              <h3
                className="font-semibold text-sm mb-1"
                style={{ color: 'var(--text-primary)' }}
              >
                {PRESETS[p].name}
              </h3>
              <p
                className="text-xs line-clamp-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                {PRESETS[p].description}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Token Details */}
      <div className="card p-5 md:p-6 mb-6">
        <h2
          className="text-lg font-semibold mb-4"
          style={{ color: 'var(--text-primary)' }}
        >
          Token Details
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label
              className="block text-sm font-medium mb-2"
              style={{ color: 'var(--text-primary)' }}
            >
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
            <label
              className="block text-sm font-medium mb-2"
              style={{ color: 'var(--text-primary)' }}
            >
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

      {/* Fee Distribution */}
      <div className="card p-5 md:p-6 mb-6">
        <h2
          className="text-lg font-semibold mb-4"
          style={{ color: 'var(--text-primary)' }}
        >
          Fee Distribution
        </h2>
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
          100% of trading fees go to creators and community - zero platform fees
        </p>

        <div className="mb-4">
          <div className="flex justify-between text-sm mb-2">
            <span style={{ color: 'var(--text-secondary)' }}>
              Creator: {creatorFeePercent}%
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>
              Community: {100 - creatorFeePercent}%
            </span>
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
          <div
            className="flex justify-between text-xs mt-1"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <span>100% Community</span>
            <span>100% Creator</span>
          </div>
        </div>

        <div>
          <label
            className="block text-sm font-medium mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Community Vault Address (optional)
          </label>
          <input
            type="text"
            value={communityVault}
            onChange={(e) => setCommunityVault(e.target.value)}
            placeholder={
              defaultCommunityVault || '0x... (leave empty for default)'
            }
            className="input font-mono text-sm"
          />
        </div>
      </div>

      {/* Bonding Curve Settings */}
      {launchType === 'bonding' && preset !== 'custom' && (
        <div className="card p-5 md:p-6 mb-6">
          <h2
            className="text-lg font-semibold mb-4"
            style={{ color: 'var(--text-primary)' }}
          >
            Bonding Curve Settings
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-primary)' }}
              >
                Virtual ETH Reserves
              </label>
              <input
                type="number"
                value={bondingConfig.virtualEthReserves}
                onChange={(e) =>
                  setBondingConfig({
                    ...bondingConfig,
                    virtualEthReserves: e.target.value,
                  })
                }
                className="input"
              />
              <p
                className="text-xs mt-1"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Sets initial price curve
              </p>
            </div>
            <div>
              <label
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-primary)' }}
              >
                Graduation Target (ETH)
              </label>
              <input
                type="number"
                value={bondingConfig.graduationTarget}
                onChange={(e) =>
                  setBondingConfig({
                    ...bondingConfig,
                    graduationTarget: e.target.value,
                  })
                }
                className="input"
              />
              <p
                className="text-xs mt-1"
                style={{ color: 'var(--text-tertiary)' }}
              >
                ETH raised to graduate to LP
              </p>
            </div>
            <div>
              <label
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-primary)' }}
              >
                Token Supply
              </label>
              <input
                type="number"
                value={bondingConfig.tokenSupply}
                onChange={(e) =>
                  setBondingConfig({
                    ...bondingConfig,
                    tokenSupply: e.target.value,
                  })
                }
                className="input"
              />
            </div>
          </div>

          {/* Initial price estimate */}
          <div className="mt-4 p-3 rounded-lg bg-[var(--bg-secondary)]">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              <strong>Initial Price:</strong>{' '}
              {(
                (parseFloat(bondingConfig.virtualEthReserves) /
                  parseFloat(bondingConfig.tokenSupply)) *
                1e18
              ).toExponential(4)}{' '}
              ETH
            </p>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              <strong>Market Cap at Launch:</strong> ~
              {parseFloat(bondingConfig.virtualEthReserves).toFixed(2)} ETH
            </p>
          </div>
        </div>
      )}

      {/* ICO/Presale Settings */}
      {launchType === 'ico' && preset !== 'custom' && (
        <div className="card p-5 md:p-6 mb-6">
          <h2
            className="text-lg font-semibold mb-4"
            style={{ color: 'var(--text-primary)' }}
          >
            {preset === 'degen'
              ? 'Fast Presale Settings'
              : 'ICO Presale Settings'}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-primary)' }}
              >
                Presale Allocation: {icoConfig.presaleAllocationBps / 100}%
              </label>
              <input
                type="range"
                min="500"
                max="5000"
                step="100"
                value={icoConfig.presaleAllocationBps}
                onChange={(e) =>
                  setICOConfig({
                    ...icoConfig,
                    presaleAllocationBps: Number(e.target.value),
                  })
                }
                className="w-full accent-bazaar-primary"
              />
            </div>
            <div>
              <label
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-primary)' }}
              >
                Presale Price (ETH/token)
              </label>
              <input
                type="number"
                step="0.00001"
                value={icoConfig.presalePrice}
                onChange={(e) =>
                  setICOConfig({ ...icoConfig, presalePrice: e.target.value })
                }
                className="input"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-primary)' }}
              >
                Soft Cap (ETH)
              </label>
              <input
                type="number"
                value={icoConfig.softCap}
                onChange={(e) =>
                  setICOConfig({ ...icoConfig, softCap: e.target.value })
                }
                className="input"
              />
            </div>
            <div>
              <label
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-primary)' }}
              >
                Hard Cap (ETH)
              </label>
              <input
                type="number"
                value={icoConfig.hardCap}
                onChange={(e) =>
                  setICOConfig({ ...icoConfig, hardCap: e.target.value })
                }
                className="input"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-primary)' }}
              >
                LP Funding: {icoConfig.lpFundingBps / 100}%
              </label>
              <input
                type="range"
                min="5000"
                max="10000"
                step="500"
                value={icoConfig.lpFundingBps}
                onChange={(e) =>
                  setICOConfig({
                    ...icoConfig,
                    lpFundingBps: Number(e.target.value),
                  })
                }
                className="w-full accent-bazaar-primary"
              />
            </div>
            <div>
              <label
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-primary)' }}
              >
                LP Lock Duration
              </label>
              <select
                value={icoConfig.lpLockDuration}
                onChange={(e) =>
                  setICOConfig({
                    ...icoConfig,
                    lpLockDuration: Number(e.target.value),
                  })
                }
                className="input"
              >
                <option value={7 * 24 * 60 * 60}>1 week</option>
                <option value={30 * 24 * 60 * 60}>1 month</option>
                <option value={90 * 24 * 60 * 60}>3 months</option>
                <option value={180 * 24 * 60 * 60}>6 months</option>
              </select>
            </div>
            <div>
              <label
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-primary)' }}
              >
                Presale Duration
              </label>
              <select
                value={icoConfig.presaleDuration}
                onChange={(e) =>
                  setICOConfig({
                    ...icoConfig,
                    presaleDuration: Number(e.target.value),
                  })
                }
                className="input"
              >
                <option value={24 * 60 * 60}>1 day</option>
                <option value={2 * 24 * 60 * 60}>2 days</option>
                <option value={3 * 24 * 60 * 60}>3 days</option>
                <option value={7 * 24 * 60 * 60}>7 days</option>
                <option value={14 * 24 * 60 * 60}>14 days</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Launch Summary */}
      <div className="card p-5 md:p-6 mb-6 border-bazaar-primary/30 bg-bazaar-primary/5">
        <h2
          className="text-lg font-semibold mb-4"
          style={{ color: 'var(--text-primary)' }}
        >
          Launch Summary
        </h2>
        <div
          className="space-y-2 text-sm"
          style={{ color: 'var(--text-secondary)' }}
        >
          <p>
            <strong>Token:</strong> {name || 'Not set'} ({symbol || 'N/A'})
          </p>
          <p>
            <strong>Launch Style:</strong> {PRESETS[preset].name}
          </p>
          <p>
            <strong>Type:</strong>{' '}
            {launchType === 'bonding' ? 'Bonding Curve' : 'ICO Presale'}
          </p>
          <p>
            <strong>Fee Split:</strong> {creatorFeePercent}% creator,{' '}
            {100 - creatorFeePercent}% community
          </p>
          <p>
            <strong>Platform Fee:</strong> 0% (totally free)
          </p>
          {launchType === 'bonding' && (
            <p>
              <strong>Graduation:</strong> Token migrates to LP pool when{' '}
              {bondingConfig.graduationTarget} ETH raised
            </p>
          )}
          {launchType === 'ico' && (
            <>
              <p>
                <strong>Presale:</strong> {icoConfig.presaleAllocationBps / 100}
                % of supply at {icoConfig.presalePrice} ETH
              </p>
              <p>
                <strong>LP Lock:</strong> {icoConfig.lpLockDuration / 86400}{' '}
                days
              </p>
            </>
          )}
        </div>
      </div>

      {/* Launch Button */}
      <button
        onClick={handleLaunch}
        disabled={
          !isConnected ||
          !isCorrectChain ||
          isLaunching ||
          !name ||
          !symbol ||
          !isAvailable
        }
        className="btn-primary w-full py-4 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
        data-testid="launch-btn"
      >
        {isLaunching
          ? 'Launching...'
          : !isConnected
            ? 'Connect Wallet'
            : !isAvailable
              ? 'Launchpad Not Deployed'
              : 'Launch Token'}
      </button>

      <div className="text-center mt-6">
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Need a simple token?{' '}
          <Link
            href="/coins/create"
            className="text-bazaar-primary hover:underline"
          >
            Create basic ERC20
          </Link>
        </p>
      </div>
    </div>
  )
}
