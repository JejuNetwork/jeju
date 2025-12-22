import { AlertCircle, CheckCircle, Info, type LucideProps } from 'lucide-react'
import { type ComponentType, useState } from 'react'
import { useAccount } from 'wagmi'
import { useProtocolTokens } from '../hooks/useProtocolTokens'
import { useRegistry, useRequiredStake } from '../hooks/useRegistry'
import { formatTokenAmount } from '../lib/tokenUtils'
import TokenSelector, { type TokenOption } from './TokenSelector'

const InfoIcon = Info as ComponentType<LucideProps>
const AlertCircleIcon = AlertCircle as ComponentType<LucideProps>
const CheckCircleIcon = CheckCircle as ComponentType<LucideProps>

const AVAILABLE_TAGS = [
  { value: 'developer', label: 'Developer', icon: '👨‍💻' },
  { value: 'agent', label: 'AI Agent', icon: '🤖' },
  { value: 'app', label: 'Application', icon: '📱' },
  { value: 'game', label: 'Game', icon: '🎮' },
  { value: 'marketplace', label: 'Marketplace', icon: '🏪' },
  { value: 'defi', label: 'DeFi', icon: '💰' },
  { value: 'social', label: 'Social', icon: '💬' },
  { value: 'info-provider', label: 'Information Provider', icon: '📊' },
  { value: 'service', label: 'Service', icon: '⚙️' },
]

export default function RegisterAppForm() {
  const { address } = useAccount()
  const { tokens } = useProtocolTokens()
  const { registerApp } = useRegistry()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [a2aEndpoint, setA2aEndpoint] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [selectedToken, setSelectedToken] = useState<TokenOption | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const requiredStake = useRequiredStake(
    selectedToken?.address as `0x${string}` | undefined,
  )

  const handleTagToggle = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    if (!address) {
      setError('Please connect your wallet')
      return
    }

    if (!name.trim()) {
      setError('App name is required')
      return
    }

    if (selectedTags.length === 0) {
      setError('Please select at least one tag')
      return
    }

    if (!selectedToken) {
      setError('Please select a stake token')
      return
    }

    if (!requiredStake) {
      setError('Unable to calculate required stake')
      return
    }

    setIsSubmitting(true)

    const tokenURI = JSON.stringify({
      name,
      description,
      owner: address,
      registeredAt: new Date().toISOString(),
    })

    const result = await registerApp({
      tokenURI,
      tags: selectedTags,
      a2aEndpoint: a2aEndpoint.trim() || '',
      stakeToken: selectedToken.address as `0x${string}`,
      stakeAmount: requiredStake,
    })

    setIsSubmitting(false)

    if (result.success) {
      setSuccess(true)
      setName('')
      setDescription('')
      setA2aEndpoint('')
      setSelectedTags([])
      setSelectedToken(null)
    } else {
      setError(result.error || 'Registration failed')
    }
  }

  return (
    <div>
      {/* Info Banner */}
      <div
        className="card"
        style={{
          marginBottom: '1rem',
          background: 'var(--primary-soft)',
          border: '1px solid var(--primary)',
        }}
      >
        <div
          style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}
        >
          <InfoIcon
            size={20}
            style={{ color: 'var(--primary)', flexShrink: 0, marginTop: '2px' }}
          />
          <div>
            <p
              style={{
                fontWeight: 600,
                color: 'var(--primary)',
                marginBottom: '0.25rem',
              }}
            >
              ERC-8004 Identity Registry
            </p>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Register your identity to access the <strong>JEJU Faucet</strong>,
              participate in governance, and list your apps in the Bazaar. Your
              stake is refundable when you unregister.
            </p>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>
          Register Identity
        </h2>

        {error && (
          <div
            style={{
              padding: '1rem',
              background: 'var(--error-soft)',
              border: '1px solid var(--error)',
              borderRadius: '8px',
              marginBottom: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <AlertCircleIcon size={20} style={{ color: 'var(--error)' }} />
            <span style={{ color: 'var(--error)' }}>{error}</span>
          </div>
        )}

        {success && (
          <div
            style={{
              padding: '1rem',
              background: 'var(--success-soft)',
              border: '1px solid var(--success)',
              borderRadius: '8px',
              marginBottom: '1.5rem',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.5rem',
              }}
            >
              <CheckCircleIcon
                size={20}
                style={{
                  color: 'var(--success)',
                  flexShrink: 0,
                  marginTop: '2px',
                }}
              />
              <div>
                <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                  Registration successful!
                </span>
                <p
                  style={{
                    fontSize: '0.875rem',
                    color: 'var(--text-secondary)',
                    marginTop: '0.25rem',
                  }}
                >
                  You can now claim from the JEJU Faucet and access all protocol
                  features.
                </p>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Name */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label className="input-label">
              Name <span style={{ color: 'var(--error)' }}>*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Agent / My App / My Name"
              className="input"
              required
            />
            <p
              style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                marginTop: '0.25rem',
              }}
            >
              This can be your name, your agent's name, or your app name
            </p>
          </div>

          {/* Description */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label className="input-label">
              Description{' '}
              <span
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  fontWeight: 'normal',
                }}
              >
                (optional)
              </span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What you're building or working on..."
              className="input"
              rows={2}
              style={{ resize: 'vertical' }}
            />
          </div>

          {/* A2A Endpoint */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label className="input-label">
              A2A Endpoint URL
              <span
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  marginLeft: '0.5rem',
                }}
              >
                (Optional - for agent discovery)
              </span>
            </label>
            <input
              type="url"
              value={a2aEndpoint}
              onChange={(e) => setA2aEndpoint(e.target.value)}
              placeholder="https://myapp.com/a2a"
              className="input"
            />
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label className="input-label">
              Category <span style={{ color: 'var(--error)' }}>*</span>
            </label>
            <p
              style={{
                fontSize: '0.75rem',
                color: 'var(--text-secondary)',
                marginBottom: '0.75rem',
              }}
            >
              What best describes you? Select one or more.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {AVAILABLE_TAGS.map((tag) => (
                <button
                  key={tag.value}
                  type="button"
                  onClick={() => handleTagToggle(tag.value)}
                  className={`pill ${selectedTags.includes(tag.value) ? 'pill-active' : ''}`}
                >
                  {tag.icon} {tag.label}
                </button>
              ))}
            </div>
          </div>

          {/* Stake Token Selection */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label className="input-label">
              Stake Token <span style={{ color: 'var(--error)' }}>*</span>
            </label>
            <TokenSelector
              tokens={tokens.map((t) => ({
                symbol: t.symbol,
                name: t.name,
                address: t.address,
                decimals: t.decimals,
                priceUSD: t.priceUSD,
                logoUrl: t.logoUrl,
              }))}
              selectedToken={selectedToken?.symbol}
              onSelect={setSelectedToken}
              showBalances={false}
              placeholder="Select stake token..."
            />
          </div>

          {/* Required Stake Display */}
          {selectedToken && requiredStake && (
            <div
              style={{
                padding: '1rem',
                background: 'var(--surface-hover)',
                border: '1px solid var(--border-strong)',
                borderRadius: '8px',
                marginBottom: '1.5rem',
              }}
            >
              <p
                style={{
                  fontSize: '0.875rem',
                  color: 'var(--text-secondary)',
                  marginBottom: '0.5rem',
                }}
              >
                Required Stake:
              </p>
              <p
                style={{
                  fontSize: '1.25rem',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                }}
              >
                {formatTokenAmount(requiredStake, selectedToken.decimals, 6)}{' '}
                {selectedToken.symbol}
              </p>
              <p
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  marginTop: '0.25rem',
                }}
              >
                ≈ $3.50 USD
              </p>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            className="button"
            disabled={
              isSubmitting ||
              !name.trim() ||
              selectedTags.length === 0 ||
              !selectedToken
            }
            style={{
              width: '100%',
              padding: '1rem',
              fontSize: '1rem',
              fontWeight: 600,
            }}
          >
            {isSubmitting ? 'Registering...' : 'Register & Stake'}
          </button>
          <p
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              marginTop: '0.75rem',
              textAlign: 'center',
            }}
          >
            Your stake is fully refundable when you unregister
          </p>
        </form>
      </div>
    </div>
  )
}
