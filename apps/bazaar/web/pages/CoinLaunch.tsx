/**
 * Token Launch Page
 *
 * Two launch modes:
 * 1. Simple Token - Fixed supply ERC20 (via TokenFactory)
 * 2. Bonding Curve - Fair launch with price curve (via TokenLaunchpad)
 *
 * The launchpad deploys the bonding curve contract and handles graduation to DEX.
 */

import { getContract } from '@jejunetwork/config'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { parseAbi, parseEther } from 'viem'
import {
  useAccount,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { NETWORK } from '../../config'
import { calculateInitialPrice } from '../../lib/launchpad'
import { BackLink, InfoCard, PageHeader } from '../components/ui'

// ABIs
const TOKEN_FACTORY_ABI = parseAbi([
  'function createToken(string name, string symbol, uint8 decimals, uint256 initialSupply) returns (address)',
])

const TOKEN_LAUNCHPAD_ABI = parseAbi([
  'function launchBondingCurve(string name, string symbol, uint16 creatorFeeBps, address communityVault, (uint256 virtualEthReserves, uint256 graduationTarget, uint256 tokenSupply) curveConfig) returns (uint256 launchId, address tokenAddress)',
])

// Contract addresses
let TOKEN_FACTORY_ADDRESS: `0x${string}` | undefined
let TOKEN_LAUNCHPAD_ADDRESS: `0x${string}` | undefined

try {
  const factoryAddr = getContract('bazaar', 'tokenFactory', NETWORK)
  TOKEN_FACTORY_ADDRESS = factoryAddr
    ? (factoryAddr as `0x${string}`)
    : undefined
} catch {
  TOKEN_FACTORY_ADDRESS = undefined
}

try {
  const launchpadAddr = getContract('bazaar', 'tokenLaunchpad', NETWORK)
  TOKEN_LAUNCHPAD_ADDRESS = launchpadAddr
    ? (launchpadAddr as `0x${string}`)
    : undefined
} catch {
  TOKEN_LAUNCHPAD_ADDRESS = undefined
}

type LaunchMode = 'simple' | 'bonding'

// Default bonding curve config (pump.fun style)
const DEFAULT_VIRTUAL_ETH = '2' // 2 ETH virtual reserves
const DEFAULT_GRADUATION_TARGET = '10' // 10 ETH to graduate
const DEFAULT_TOKEN_SUPPLY = '1000000000' // 1 billion tokens

export default function CoinLaunchPage() {
  const navigate = useNavigate()
  const { address, isConnected } = useAccount()

  // Form state
  const [mode, setMode] = useState<LaunchMode>('simple')
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [description, setDescription] = useState('')

  // Simple token options
  const [initialSupply, setInitialSupply] = useState('1000000')

  // Bonding curve options
  const [virtualEth, setVirtualEth] = useState(DEFAULT_VIRTUAL_ETH)
  const [graduationTarget, setGraduationTarget] = useState(
    DEFAULT_GRADUATION_TARGET,
  )
  const [tokenSupply, setTokenSupply] = useState(DEFAULT_TOKEN_SUPPLY)
  const [creatorFeeBps, setCreatorFeeBps] = useState(500) // 5%

  const { writeContract, data: txHash, isPending } = useWriteContract()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  if (isSuccess && txHash) {
    toast.success('Token launched successfully')
    navigate('/coins')
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!isConnected || !address) {
      toast.error('Connect your wallet first')
      return
    }

    if (!name.trim() || !symbol.trim()) {
      toast.error('Name and symbol are required')
      return
    }

    if (mode === 'simple') {
      if (!TOKEN_FACTORY_ADDRESS) {
        toast.error('Token factory not deployed on this network')
        return
      }

      const supply = parseFloat(initialSupply)
      if (Number.isNaN(supply) || supply <= 0) {
        toast.error('Initial supply must be positive')
        return
      }

      writeContract({
        address: TOKEN_FACTORY_ADDRESS,
        abi: TOKEN_FACTORY_ABI,
        functionName: 'createToken',
        args: [name, symbol.toUpperCase(), 18, parseEther(initialSupply)],
      })
    } else {
      if (!TOKEN_LAUNCHPAD_ADDRESS) {
        toast.error('Token launchpad not deployed on this network')
        return
      }

      const curveConfig = {
        virtualEthReserves: parseEther(virtualEth),
        graduationTarget: parseEther(graduationTarget),
        tokenSupply: parseEther(tokenSupply),
      }

      writeContract({
        address: TOKEN_LAUNCHPAD_ADDRESS,
        abi: TOKEN_LAUNCHPAD_ABI,
        functionName: 'launchBondingCurve',
        args: [
          name,
          symbol.toUpperCase(),
          creatorFeeBps,
          '0x0000000000000000000000000000000000000000', // Use default community vault
          curveConfig,
        ],
      })
    }
  }

  const isSubmitting = isPending || isConfirming

  // Calculate bonding curve preview values
  const initialPrice =
    virtualEth && tokenSupply && graduationTarget
      ? calculateInitialPrice({
          virtualEthReserves: virtualEth,
          graduationTarget: graduationTarget,
          tokenSupply: tokenSupply,
        })
      : 0

  const hasFactory = !!TOKEN_FACTORY_ADDRESS
  const hasLaunchpad = !!TOKEN_LAUNCHPAD_ADDRESS
  const noContracts = !hasFactory && !hasLaunchpad

  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      <BackLink to="/coins" label="Back to Coins" />

      <PageHeader
        icon="🚀"
        title="Launch Token"
        description="Create your own token and launch it to the market"
      />

      {noContracts && (
        <InfoCard variant="warning" className="mb-6">
          <p className="font-medium">No Launch Contracts Deployed</p>
          <p className="text-sm opacity-80">
            Neither the Token Factory nor the Token Launchpad are deployed on
            this network. Run the deployment scripts to enable token creation.
          </p>
        </InfoCard>
      )}

      {/* Mode Selection */}
      {(hasFactory || hasLaunchpad) && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <button
            type="button"
            onClick={() => setMode('simple')}
            disabled={!hasFactory}
            className={`card p-4 text-left transition-all ${
              mode === 'simple'
                ? 'ring-2 ring-primary-color bg-surface-secondary'
                : 'hover:bg-surface-secondary'
            } ${!hasFactory ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <div className="text-2xl mb-2">🪙</div>
            <h3 className="font-semibold text-primary mb-1">Simple Token</h3>
            <p className="text-xs text-tertiary">
              Fixed supply ERC20. All tokens minted to your wallet.
            </p>
            {!hasFactory && (
              <p className="text-xs text-error mt-2">Not available</p>
            )}
          </button>

          <button
            type="button"
            onClick={() => setMode('bonding')}
            disabled={!hasLaunchpad}
            className={`card p-4 text-left transition-all ${
              mode === 'bonding'
                ? 'ring-2 ring-primary-color bg-surface-secondary'
                : 'hover:bg-surface-secondary'
            } ${!hasLaunchpad ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <div className="text-2xl mb-2">📈</div>
            <h3 className="font-semibold text-primary mb-1">Bonding Curve</h3>
            <p className="text-xs text-tertiary">
              Fair launch with automatic price discovery. Graduates to DEX.
            </p>
            {!hasLaunchpad && (
              <p className="text-xs text-error mt-2">Not available</p>
            )}
          </button>
        </div>
      )}

      {/* Mode Info */}
      {mode === 'simple' && hasFactory && (
        <InfoCard variant="info" className="mb-6">
          <p className="font-medium mb-1">Simple Token Launch</p>
          <p className="text-sm opacity-80">
            Create a standard ERC20 token with a fixed supply. All tokens will
            be minted directly to your wallet. You control distribution.
          </p>
        </InfoCard>
      )}

      {mode === 'bonding' && hasLaunchpad && (
        <InfoCard variant="info" className="mb-6">
          <p className="font-medium mb-1">Bonding Curve Launch</p>
          <p className="text-sm opacity-80">
            Launch with automatic market making. Price increases as more tokens
            are bought. When the target is reached, liquidity graduates to DEX
            and locks.
          </p>
        </InfoCard>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        {/* Basic Info */}
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
        </div>

        <div>
          <label
            htmlFor="description"
            className="block text-sm font-medium text-primary mb-2"
          >
            Description (Optional)
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Tell people what makes your token special..."
            className="input min-h-[80px] resize-y"
            maxLength={500}
          />
        </div>

        {/* Simple Token Options */}
        {mode === 'simple' && (
          <div>
            <label
              htmlFor="initial-supply"
              className="block text-sm font-medium text-primary mb-2"
            >
              Initial Supply
            </label>
            <input
              id="initial-supply"
              type="number"
              value={initialSupply}
              onChange={(e) => setInitialSupply(e.target.value)}
              placeholder="1000000"
              step="1"
              min="1"
              className="input"
              required
            />
            <p className="text-xs text-tertiary mt-1">
              Total number of tokens to mint. All tokens go to your wallet.
            </p>
          </div>
        )}

        {/* Bonding Curve Options */}
        {mode === 'bonding' && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="virtual-eth"
                  className="block text-sm font-medium text-primary mb-2"
                >
                  Virtual ETH
                </label>
                <input
                  id="virtual-eth"
                  type="number"
                  value={virtualEth}
                  onChange={(e) => setVirtualEth(e.target.value)}
                  step="0.1"
                  min="0.1"
                  className="input"
                  required
                />
                <p className="text-xs text-tertiary mt-1">Sets initial price</p>
              </div>

              <div>
                <label
                  htmlFor="graduation-target"
                  className="block text-sm font-medium text-primary mb-2"
                >
                  Graduation Target (ETH)
                </label>
                <input
                  id="graduation-target"
                  type="number"
                  value={graduationTarget}
                  onChange={(e) => setGraduationTarget(e.target.value)}
                  step="1"
                  min="1"
                  className="input"
                  required
                />
                <p className="text-xs text-tertiary mt-1">
                  ETH to graduate to DEX
                </p>
              </div>
            </div>

            <div>
              <label
                htmlFor="token-supply"
                className="block text-sm font-medium text-primary mb-2"
              >
                Total Supply
              </label>
              <input
                id="token-supply"
                type="number"
                value={tokenSupply}
                onChange={(e) => setTokenSupply(e.target.value)}
                step="1000000"
                min="1000000"
                className="input"
                required
              />
            </div>

            <div>
              <label
                htmlFor="creator-fee"
                className="block text-sm font-medium text-primary mb-2"
              >
                Creator Fee: {(creatorFeeBps / 100).toFixed(1)}%
              </label>
              <input
                id="creator-fee"
                type="range"
                value={creatorFeeBps}
                onChange={(e) =>
                  setCreatorFeeBps(Number.parseInt(e.target.value, 10))
                }
                min="0"
                max="1000"
                step="50"
                className="w-full"
              />
              <p className="text-xs text-tertiary mt-1">
                Your share of trading fees. Remaining goes to community vault.
              </p>
            </div>

            {/* Bonding Curve Preview */}
            <div className="p-4 rounded-xl bg-surface-secondary">
              <h4 className="text-sm font-medium text-primary mb-3">
                Curve Preview
              </h4>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-xs text-tertiary">Initial Price</p>
                  <p className="font-semibold text-primary">
                    {initialPrice < 0.000001
                      ? initialPrice.toExponential(4)
                      : initialPrice.toFixed(8)}{' '}
                    ETH
                  </p>
                </div>
                <div>
                  <p className="text-xs text-tertiary">Total Supply</p>
                  <p className="font-semibold text-primary">
                    {Number(tokenSupply).toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-tertiary">Target Cap</p>
                  <p className="font-semibold text-primary">
                    {graduationTarget} ETH
                  </p>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Preview */}
        {name &&
          symbol &&
          (mode === 'simple' ? initialSupply : tokenSupply) && (
            <div className="p-4 rounded-xl bg-surface-secondary animate-fade-in">
              <h3 className="text-sm font-medium text-primary mb-2">
                Token Preview
              </h3>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl gradient-warm flex items-center justify-center text-white font-bold">
                  {symbol.slice(0, 2)}
                </div>
                <div>
                  <p className="font-semibold text-primary">{name}</p>
                  <p className="text-sm text-tertiary">
                    ${symbol} •{' '}
                    {mode === 'simple'
                      ? `${Number(initialSupply).toLocaleString()} tokens`
                      : 'Bonding Curve'}
                  </p>
                </div>
              </div>
            </div>
          )}

        <button
          type="submit"
          disabled={
            isSubmitting ||
            !isConnected ||
            (mode === 'simple' && !hasFactory) ||
            (mode === 'bonding' && !hasLaunchpad)
          }
          className="btn-primary w-full py-4 text-lg disabled:opacity-50"
        >
          {!isConnected
            ? 'Connect Wallet'
            : mode === 'simple' && !hasFactory
              ? 'Factory Not Deployed'
              : mode === 'bonding' && !hasLaunchpad
                ? 'Launchpad Not Deployed'
                : isPending
                  ? 'Confirm in Wallet...'
                  : isConfirming
                    ? 'Creating Token...'
                    : mode === 'simple'
                      ? '🪙 Create Token'
                      : '🚀 Launch Token'}
        </button>
      </form>
    </div>
  )
}
