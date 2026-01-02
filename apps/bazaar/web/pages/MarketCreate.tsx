import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { keccak256, parseEther, toHex } from 'viem'
import {
  useAccount,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { PREDICTION_MARKET_ADDRESS } from '../../config'

// ABI for createMarket function
const PREDICTION_MARKET_ABI = [
  {
    inputs: [
      { name: 'sessionId', type: 'bytes32' },
      { name: 'question', type: 'string' },
      { name: 'initialLiquidity', type: 'uint256' },
    ],
    name: 'createMarket',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
] as const

type ResolutionType = 'manual' | 'date' | 'oracle'

interface MarketForm {
  question: string
  description: string
  category: string
  resolutionType: ResolutionType
  resolutionDate: string
  initialLiquidity: string
  // Oracle settings
  oracleSource: string
  oracleAsset: string
  oracleCondition: 'above' | 'below' | 'equals'
  oracleValue: string
}

const ORACLE_SOURCES = [
  {
    value: 'chainlink',
    label: 'Chainlink',
    description: 'Decentralized price feeds',
  },
  {
    value: 'pyth',
    label: 'Pyth Network',
    description: 'High-fidelity market data',
  },
  { value: 'api3', label: 'API3', description: 'First-party oracles' },
  {
    value: 'custom',
    label: 'Custom Oracle',
    description: 'Specify your own oracle address',
  },
]

const ORACLE_ASSETS = [
  { value: 'BTC/USD', label: 'BTC/USD' },
  { value: 'ETH/USD', label: 'ETH/USD' },
  { value: 'SOL/USD', label: 'SOL/USD' },
  { value: 'MATIC/USD', label: 'MATIC/USD' },
  { value: 'LINK/USD', label: 'LINK/USD' },
  { value: 'AVAX/USD', label: 'AVAX/USD' },
]

const CATEGORIES = [
  { value: 'crypto', label: 'Crypto', emoji: '₿' },
  { value: 'sports', label: 'Sports', emoji: '⚽' },
  { value: 'politics', label: 'Politics', emoji: '🏛️' },
  { value: 'entertainment', label: 'Entertainment', emoji: '🎬' },
  { value: 'science', label: 'Science', emoji: '🔬' },
  { value: 'finance', label: 'Finance', emoji: '📈' },
  { value: 'other', label: 'Other', emoji: '🔮' },
]

export default function MarketCreatePage() {
  const navigate = useNavigate()
  const { address, isConnected } = useAccount()
  const [form, setForm] = useState<MarketForm>({
    question: '',
    description: '',
    category: 'crypto',
    resolutionType: 'date',
    resolutionDate: '',
    initialLiquidity: '100',
    // Oracle defaults
    oracleSource: 'chainlink',
    oracleAsset: 'BTC/USD',
    oracleCondition: 'above',
    oracleValue: '',
  })

  const { writeContract, data: txHash, isPending, error } = useWriteContract()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  // Handle success
  if (isSuccess && txHash) {
    toast.success('Market created successfully!')
    navigate('/markets')
  }

  // Handle error
  if (error) {
    toast.error(error.message || 'Failed to create market')
  }

  const isSubmitting = isPending || isConfirming

  const updateForm = <K extends keyof MarketForm>(
    key: K,
    value: MarketForm[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!isConnected || !address) {
      toast.error('Please connect your wallet first')
      return
    }

    if (!form.question.trim()) {
      toast.error('Please enter a question')
      return
    }

    if (form.question.length < 10) {
      toast.error('Question must be at least 10 characters')
      return
    }

    if (form.resolutionType === 'date' && !form.resolutionDate) {
      toast.error('Please select a resolution date')
      return
    }

    const liquidity = parseFloat(form.initialLiquidity)
    if (Number.isNaN(liquidity) || liquidity < 10) {
      toast.error('Initial liquidity must be at least $10')
      return
    }

    // Generate unique sessionId from question + timestamp
    const sessionId = keccak256(
      toHex(`${form.question}-${Date.now()}-${address}`),
    )

    // Create market on-chain
    writeContract({
      address: PREDICTION_MARKET_ADDRESS,
      abi: PREDICTION_MARKET_ABI,
      functionName: 'createMarket',
      args: [sessionId, form.question, parseEther(form.initialLiquidity)],
      value: parseEther(form.initialLiquidity),
    })
  }

  // Get minimum date (tomorrow)
  const minDate = new Date()
  minDate.setDate(minDate.getDate() + 1)
  const minDateStr = minDate.toISOString().split('T')[0]

  return (
    <div className="max-w-xl mx-auto">
      <Link
        to="/markets"
        className="text-sm mb-4 inline-block"
        style={{ color: 'var(--text-secondary)' }}
      >
        ← Back to Markets
      </Link>

      <h1
        className="text-2xl sm:text-3xl font-bold mb-2"
        style={{ color: 'var(--text-primary)' }}
      >
        🔮 Create Prediction Market
      </h1>
      <p className="mb-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
        Create a market and let others bet on the outcome
      </p>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="card p-6 space-y-4">
          <div>
            <label
              htmlFor="question"
              className="text-sm block mb-1.5 font-medium"
              style={{ color: 'var(--text-primary)' }}
            >
              Question *
            </label>
            <p
              className="text-xs mb-2"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Make it clear and specific. Must have a yes/no answer.
            </p>
            <input
              id="question"
              type="text"
              placeholder="Will Bitcoin reach $100,000 by end of 2025?"
              className="input"
              value={form.question}
              onChange={(e) => updateForm('question', e.target.value)}
              maxLength={200}
            />
            <p
              className="text-xs mt-1 text-right"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {form.question.length}/200
            </p>
          </div>

          <div>
            <label
              htmlFor="description"
              className="text-sm block mb-1.5 font-medium"
              style={{ color: 'var(--text-primary)' }}
            >
              Description (optional)
            </label>
            <textarea
              id="description"
              placeholder="Add context, rules, or resolution criteria..."
              className="input min-h-[80px] resize-none"
              value={form.description}
              onChange={(e) => updateForm('description', e.target.value)}
              maxLength={500}
            />
          </div>

          <div>
            <span
              className="text-sm block mb-1.5 font-medium"
              style={{ color: 'var(--text-primary)' }}
            >
              Category
            </span>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => updateForm('category', cat.value)}
                  className={`px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                    form.category === cat.value
                      ? 'bg-bazaar-primary text-white'
                      : ''
                  }`}
                  style={
                    form.category !== cat.value
                      ? {
                          backgroundColor: 'var(--bg-secondary)',
                          color: 'var(--text-secondary)',
                        }
                      : undefined
                  }
                >
                  {cat.emoji} {cat.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="card p-6 space-y-4">
          <h2
            className="text-lg font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            Resolution
          </h2>

          <div>
            <span
              className="text-sm block mb-1.5 font-medium"
              style={{ color: 'var(--text-primary)' }}
            >
              How will this market be resolved?
            </span>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => updateForm('resolutionType', 'date')}
                className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                  form.resolutionType === 'date'
                    ? 'border-bazaar-primary bg-bazaar-primary/10'
                    : 'border-transparent'
                }`}
                style={{
                  backgroundColor:
                    form.resolutionType !== 'date'
                      ? 'var(--bg-secondary)'
                      : undefined,
                }}
              >
                <p
                  className="font-medium text-sm"
                  style={{ color: 'var(--text-primary)' }}
                >
                  On a specific date
                </p>
                <p
                  className="text-xs"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Market resolves on the selected date
                </p>
              </button>
              <button
                type="button"
                onClick={() => updateForm('resolutionType', 'manual')}
                className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                  form.resolutionType === 'manual'
                    ? 'border-bazaar-primary bg-bazaar-primary/10'
                    : 'border-transparent'
                }`}
                style={{
                  backgroundColor:
                    form.resolutionType !== 'manual'
                      ? 'var(--bg-secondary)'
                      : undefined,
                }}
              >
                <p
                  className="font-medium text-sm"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Manually by creator
                </p>
                <p
                  className="text-xs"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  You decide when and how to resolve
                </p>
              </button>
              <button
                type="button"
                onClick={() => updateForm('resolutionType', 'oracle')}
                className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                  form.resolutionType === 'oracle'
                    ? 'border-bazaar-primary bg-bazaar-primary/10'
                    : 'border-transparent'
                }`}
                style={{
                  backgroundColor:
                    form.resolutionType !== 'oracle'
                      ? 'var(--bg-secondary)'
                      : undefined,
                }}
              >
                <p
                  className="font-medium text-sm"
                  style={{ color: 'var(--text-primary)' }}
                >
                  By oracle
                </p>
                <p
                  className="text-xs"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Automated resolution via data feed
                </p>
              </button>
            </div>
          </div>

          {form.resolutionType === 'date' && (
            <div>
              <label
                htmlFor="resolution-date"
                className="text-sm block mb-1.5 font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                Resolution Date *
              </label>
              <input
                id="resolution-date"
                type="date"
                className="input"
                value={form.resolutionDate}
                onChange={(e) => updateForm('resolutionDate', e.target.value)}
                min={minDateStr}
              />
            </div>
          )}

          {form.resolutionType === 'oracle' && (
            <div className="space-y-4 animate-fade-in">
              <div>
                <label
                  htmlFor="oracle-source"
                  className="text-sm block mb-1.5 font-medium"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Oracle Source *
                </label>
                <select
                  id="oracle-source"
                  className="input"
                  value={form.oracleSource}
                  onChange={(e) => updateForm('oracleSource', e.target.value)}
                >
                  {ORACLE_SOURCES.map((source) => (
                    <option key={source.value} value={source.value}>
                      {source.label} - {source.description}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="oracle-asset"
                  className="text-sm block mb-1.5 font-medium"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Price Feed *
                </label>
                <select
                  id="oracle-asset"
                  className="input"
                  value={form.oracleAsset}
                  onChange={(e) => updateForm('oracleAsset', e.target.value)}
                >
                  {ORACLE_ASSETS.map((asset) => (
                    <option key={asset.value} value={asset.value}>
                      {asset.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="oracle-condition"
                    className="text-sm block mb-1.5 font-medium"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    Condition *
                  </label>
                  <select
                    id="oracle-condition"
                    className="input"
                    value={form.oracleCondition}
                    onChange={(e) =>
                      updateForm(
                        'oracleCondition',
                        e.target.value as 'above' | 'below' | 'equals',
                      )
                    }
                  >
                    <option value="above">Price Above</option>
                    <option value="below">Price Below</option>
                    <option value="equals">Price Equals</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="oracle-value"
                    className="text-sm block mb-1.5 font-medium"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    Target Price ($) *
                  </label>
                  <input
                    id="oracle-value"
                    type="number"
                    className="input"
                    placeholder="100000"
                    value={form.oracleValue}
                    onChange={(e) => updateForm('oracleValue', e.target.value)}
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>

              <div
                className="p-3 rounded-lg text-sm"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-secondary)',
                }}
              >
                <p
                  className="font-medium mb-1"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Resolution Condition:
                </p>
                <p>
                  Market resolves YES if {form.oracleAsset} is{' '}
                  <span className="font-semibold">
                    {form.oracleCondition === 'above'
                      ? 'above'
                      : form.oracleCondition === 'below'
                        ? 'below'
                        : 'equal to'}
                  </span>{' '}
                  ${form.oracleValue || '...'} at resolution time.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="card p-6 space-y-4">
          <h2
            className="text-lg font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            Liquidity
          </h2>

          <div>
            <label
              htmlFor="liquidity"
              className="text-sm block mb-1.5 font-medium"
              style={{ color: 'var(--text-primary)' }}
            >
              Initial Liquidity (USDC) *
            </label>
            <p
              className="text-xs mb-2"
              style={{ color: 'var(--text-tertiary)' }}
            >
              More liquidity = tighter spreads and better trading experience
            </p>
            <input
              id="liquidity"
              type="number"
              placeholder="100"
              className="input"
              value={form.initialLiquidity}
              onChange={(e) => updateForm('initialLiquidity', e.target.value)}
              min="10"
              step="1"
            />
            <div className="flex gap-2 mt-2">
              {['50', '100', '500', '1000'].map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => updateForm('initialLiquidity', amt)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    form.initialLiquidity === amt
                      ? 'bg-bazaar-primary text-white'
                      : ''
                  }`}
                  style={
                    form.initialLiquidity !== amt
                      ? {
                          backgroundColor: 'var(--bg-secondary)',
                          color: 'var(--text-secondary)',
                        }
                      : undefined
                  }
                >
                  ${amt}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div
          className="card p-4"
          style={{ backgroundColor: 'var(--bg-secondary)' }}
        >
          <div className="flex items-start gap-3">
            <span className="text-xl">ℹ️</span>
            <div>
              <p
                className="text-sm font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                Market Creation Fee
              </p>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Creating a market costs gas plus a 1% creation fee. You earn a
                portion of trading fees as the market creator.
              </p>
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting || !isConnected}
          className="btn-primary w-full py-3 text-lg font-semibold disabled:opacity-50"
        >
          {!isConnected
            ? 'Connect Wallet'
            : isPending
              ? 'Confirm in Wallet...'
              : isConfirming
                ? 'Creating Market...'
                : 'Create Market'}
        </button>
      </form>
    </div>
  )
}
