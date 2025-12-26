/**
 * Market Create Page
 * Form for creating a new prediction market
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

type ResolutionType = 'manual' | 'date' | 'oracle'

interface MarketForm {
  question: string
  description: string
  category: string
  resolutionType: ResolutionType
  resolutionDate: string
  initialLiquidity: string
}

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
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [form, setForm] = useState<MarketForm>({
    question: '',
    description: '',
    category: 'crypto',
    resolutionType: 'date',
    resolutionDate: '',
    initialLiquidity: '100',
  })

  const updateForm = <K extends keyof MarketForm>(
    key: K,
    value: MarketForm[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

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

    setIsSubmitting(true)

    // TODO: Implement contract interaction to create market
    toast.info(
      'Market creation coming soon. Connect your wallet to create markets.',
    )
    setIsSubmitting(false)
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
            <label
              className="text-sm block mb-1.5 font-medium"
              style={{ color: 'var(--text-primary)' }}
            >
              Category
            </label>
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
            <label
              className="text-sm block mb-1.5 font-medium"
              style={{ color: 'var(--text-primary)' }}
            >
              How will this market be resolved?
            </label>
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
                disabled
                className="w-full text-left px-4 py-3 rounded-xl border border-transparent opacity-50 cursor-not-allowed"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
              >
                <p
                  className="font-medium text-sm"
                  style={{ color: 'var(--text-primary)' }}
                >
                  By oracle (coming soon)
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
          disabled={isSubmitting}
          className="btn-primary w-full py-3 text-lg font-semibold disabled:opacity-50"
        >
          {isSubmitting ? 'Creating...' : 'Create Market'}
        </button>
      </form>
    </div>
  )
}
