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
import { BackLink, InfoCard } from '../components/ui'

const TOKEN_FACTORY_ABI = parseAbi([
  'function createToken(string name, string symbol, uint8 decimals, uint256 initialSupply) returns (address)',
])

const TOKEN_FACTORY_ADDRESS = getContract('bazaar', 'tokenFactory', NETWORK) as
  | `0x${string}`
  | undefined

export default function CoinLaunchPage() {
  const navigate = useNavigate()
  const { address, isConnected } = useAccount()
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [description, setDescription] = useState('')
  const [initialSupply, setInitialSupply] = useState('1000000')

  const { writeContract, data: txHash, isPending } = useWriteContract()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  if (isSuccess && txHash) {
    toast.success('Token created successfully.')
    navigate('/coins')
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!isConnected || !address) {
      toast.error('Connect your wallet first')
      return
    }

    if (!TOKEN_FACTORY_ADDRESS) {
      toast.error('Token factory not deployed on this network')
      return
    }

    if (!name.trim() || !symbol.trim()) {
      toast.error('Name and symbol are required')
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
  }

  const isSubmitting = isPending || isConfirming

  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      <BackLink to="/coins" label="Back to Coins" />

      {/* Header */}
      <header className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gradient-warm flex items-center gap-3 mb-2">
          <span className="text-3xl animate-bounce-subtle" aria-hidden="true">
            🚀
          </span>
          <span>Launch Token</span>
        </h1>
        <p className="text-secondary">
          Create your token with a bonding curve and watch it grow
        </p>
      </header>

      {!TOKEN_FACTORY_ADDRESS && (
        <InfoCard variant="warning" className="mb-6">
          Token factory not deployed. Run the bootstrap script to deploy
          contracts.
        </InfoCard>
      )}

      {TOKEN_FACTORY_ADDRESS && (
        <InfoCard variant="info" className="mb-6">
          <p className="font-medium mb-1">How it works</p>
          <p className="text-sm opacity-80">
            Create an ERC20 token with a fixed initial supply. Tokens will be
            minted to your wallet.
          </p>
        </InfoCard>
      )}

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

        {name && symbol && initialSupply && (
          <div className="p-4 rounded-xl bg-surface-secondary animate-fade-in">
            <h3 className="text-sm font-medium text-primary mb-2">Preview</h3>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl gradient-warm flex items-center justify-center text-white font-bold">
                {symbol.slice(0, 2)}
              </div>
              <div>
                <p className="font-semibold text-primary">{name}</p>
                <p className="text-sm text-tertiary">
                  ${symbol} • {Number(initialSupply).toLocaleString()} tokens
                </p>
              </div>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting || !isConnected || !TOKEN_FACTORY_ADDRESS}
          className="btn-primary w-full py-4 text-lg disabled:opacity-50"
        >
          {!isConnected
            ? 'Connect Wallet'
            : !TOKEN_FACTORY_ADDRESS
              ? 'Factory Not Deployed'
              : isPending
                ? 'Confirm in Wallet...'
                : isConfirming
                  ? 'Creating Token...'
                  : '🚀 Create Token'}
        </button>
      </form>
    </div>
  )
}
