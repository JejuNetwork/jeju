import { Droplets, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Address } from 'viem'
import { useAccount } from 'wagmi'
import { DWS_API_URL } from '../config'

// Faucet types
interface FaucetStatus {
  eligible: boolean
  isRegistered: boolean
  cooldownRemaining: number
  nextClaimAt: number | null
  amountPerClaim: string
  faucetBalance: string
}

interface FaucetClaimResult {
  success: boolean
  txHash?: string
  amount?: string
  error?: string
  cooldownRemaining?: number
}

interface FaucetInfo {
  name: string
  description: string
  tokenSymbol: string
  amountPerClaim: string
  cooldownHours: number
  requirements: string[]
  chainId: number
  chainName: string
  explorerUrl: string
  isConfigured: boolean
  isMainnet: boolean
}

function formatTime(ms: number): string {
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

async function getFaucetInfo(): Promise<FaucetInfo> {
  const response = await fetch(`${DWS_API_URL}/faucet/info`)
  if (!response.ok) {
    throw new Error('Failed to fetch faucet info')
  }
  return response.json()
}

async function getFaucetStatus(address: Address): Promise<FaucetStatus> {
  const response = await fetch(`${DWS_API_URL}/faucet/status/${address}`)
  if (!response.ok) {
    throw new Error('Failed to fetch faucet status')
  }
  return response.json()
}

async function claimFaucet(address: Address): Promise<FaucetClaimResult> {
  const response = await fetch(`${DWS_API_URL}/faucet/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }),
  })
  return response.json()
}

function useFaucet() {
  const { address } = useAccount()
  const [status, setStatus] = useState<FaucetStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [claimResult, setClaimResult] = useState<FaucetClaimResult | null>(null)
  const [info, setInfo] = useState<FaucetInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    if (!address) return
    setLoading(true)
    setError(null)

    const data = await getFaucetStatus(address as Address).catch((err) => {
      setError(
        err instanceof Error ? err.message : 'Failed to fetch faucet status',
      )
      return null
    })
    if (data) setStatus(data)
    setLoading(false)
  }, [address])

  const fetchInfo = useCallback(async () => {
    const data = await getFaucetInfo().catch((err) => {
      console.error('Failed to fetch faucet info:', err)
      return null
    })
    if (data) setInfo(data)
  }, [])

  const claim = useCallback(async () => {
    if (!address) return
    setClaiming(true)
    setClaimResult(null)

    const result = await claimFaucet(address as Address).catch((err) => ({
      success: false,
      error: err instanceof Error ? err.message : 'Claim failed',
    }))
    setClaimResult(result)
    if (result.success) {
      await fetchStatus()
    }
    setClaiming(false)
  }, [address, fetchStatus])

  useEffect(() => {
    fetchInfo()
    if (address) {
      fetchStatus()
    }
  }, [address, fetchInfo, fetchStatus])

  return {
    status,
    loading,
    claiming,
    claimResult,
    info,
    claim,
    refresh: fetchStatus,
    error,
  }
}

export default function FaucetPage() {
  const { isConnected } = useAccount()
  const {
    status,
    loading,
    claiming,
    claimResult,
    info,
    claim,
    refresh,
    error,
  } = useFaucet()
  const [showApiDocs, setShowApiDocs] = useState(false)

  // Mainnet guard - show disabled message
  if (info?.isMainnet) {
    return (
      <div style={{ maxWidth: '560px', margin: '0 auto' }}>
        <div className="card">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1rem',
            }}
          >
            <Droplets size={28} style={{ color: 'var(--text-muted)' }} />
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700 }}>
              Faucet Not Available
            </h1>
          </div>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
            The faucet is only available on testnet and localnet. Mainnet tokens
            must be acquired through exchanges or other means.
          </p>
          <Link to="/" className="btn btn-secondary">
            Back to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  if (!isConnected) {
    return (
      <div style={{ maxWidth: '560px', margin: '0 auto' }}>
        <div className="empty-state" style={{ paddingTop: '3rem' }}>
          <Droplets size={64} />
          <h3>Connect wallet to claim</h3>
        </div>
      </div>
    )
  }

  const isRegistered = status?.isRegistered ?? false

  return (
    <div
      style={{
        maxWidth: '560px',
        margin: '0 auto',
        display: 'grid',
        gap: '1.25rem',
      }}
    >
      <div className="card">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '1rem',
          }}
        >
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}
          >
            <div
              className="stat-icon compute"
              style={{ width: 44, height: 44 }}
            >
              <Droplets size={22} />
            </div>
            <h1 style={{ fontSize: '1.35rem', fontWeight: 700 }}>
              {info?.name ?? 'JEJU Faucet'}
            </h1>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={refresh}
            disabled={loading}
            aria-label="Refresh status"
          >
            <RefreshCw
              size={18}
              style={{
                animation: loading ? 'spin 0.75s linear infinite' : 'none',
              }}
            />
          </button>
        </div>

        <p
          style={{
            color: 'var(--text-secondary)',
            marginBottom: '1.5rem',
            lineHeight: 1.6,
          }}
        >
          {info?.description ??
            'Get free JEJU tokens to explore and test the network.'}
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '1rem',
            marginBottom: '1.5rem',
          }}
        >
          <div
            style={{
              padding: '1rem',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <div
              style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: '0.25rem',
              }}
            >
              Amount per claim
            </div>
            <div
              style={{
                fontWeight: 700,
                fontSize: '1.1rem',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {status?.amountPerClaim ?? info?.amountPerClaim ?? '100'} JEJU
            </div>
          </div>
          <div
            style={{
              padding: '1rem',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <div
              style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: '0.25rem',
              }}
            >
              Cooldown
            </div>
            <div
              style={{
                fontWeight: 700,
                fontSize: '1.1rem',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {info?.cooldownHours ?? 12} hours
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gap: '0.75rem',
            marginBottom: '1.5rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.875rem 1rem',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}
            >
              {loading ? (
                <div
                  className="spinner"
                  style={{ width: 16, height: 16, borderWidth: 2 }}
                />
              ) : (
                <span
                  className={`badge ${isRegistered ? 'badge-success' : 'badge-warning'}`}
                  style={{ fontSize: '0.65rem', padding: '0.2rem 0.5rem' }}
                >
                  {isRegistered ? 'OK' : 'REQ'}
                </span>
              )}
              <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>
                ERC-8004 Registry
              </span>
            </div>
            <span
              style={{
                fontSize: '0.85rem',
                fontWeight: 600,
                color: loading
                  ? 'var(--text-dim)'
                  : isRegistered
                    ? 'var(--success)'
                    : 'var(--warning)',
              }}
            >
              {loading
                ? 'Checking...'
                : isRegistered
                  ? 'Registered'
                  : 'Not Registered'}
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.875rem 1rem',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}
            >
              {loading ? (
                <div
                  className="spinner"
                  style={{ width: 16, height: 16, borderWidth: 2 }}
                />
              ) : (
                <span
                  className={`badge ${status?.cooldownRemaining === 0 ? 'badge-success' : 'badge-warning'}`}
                  style={{ fontSize: '0.65rem', padding: '0.2rem 0.5rem' }}
                >
                  {status?.cooldownRemaining === 0 ? 'OK' : 'WAIT'}
                </span>
              )}
              <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>
                Cooldown Status
              </span>
            </div>
            <span
              style={{
                fontSize: '0.85rem',
                fontWeight: 600,
                color: loading
                  ? 'var(--text-dim)'
                  : status?.cooldownRemaining === 0
                    ? 'var(--success)'
                    : 'var(--warning)',
              }}
            >
              {loading
                ? 'Checking...'
                : status?.cooldownRemaining
                  ? formatTime(status.cooldownRemaining)
                  : 'Ready'}
            </span>
          </div>
        </div>

        {error && (
          <div
            style={{
              padding: '1rem',
              background: 'var(--error-soft)',
              borderLeft: '3px solid var(--error)',
              borderRadius: 'var(--radius-md)',
              marginBottom: '1rem',
              color: 'var(--error)',
              fontSize: '0.9rem',
            }}
          >
            {error}
          </div>
        )}

        <button
          type="button"
          className="btn btn-primary"
          onClick={claim}
          disabled={!status?.eligible || claiming || loading}
          style={{ width: '100%' }}
        >
          {claiming ? (
            <>
              <div className="spinner" style={{ width: 18, height: 18 }} />
              Claiming...
            </>
          ) : (
            <>
              <Droplets size={18} />
              {status?.eligible
                ? `Claim ${status.amountPerClaim} JEJU`
                : 'Claim JEJU'}
            </>
          )}
        </button>

        {claimResult && (
          <div
            style={{
              marginTop: '1rem',
              padding: '1rem',
              background: claimResult.success
                ? 'var(--success-soft)'
                : 'var(--error-soft)',
              borderLeft: `3px solid ${claimResult.success ? 'var(--success)' : 'var(--error)'}`,
              borderRadius: 'var(--radius-md)',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
              {claimResult.success ? 'Claim Successful' : 'Claim Failed'}
            </div>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              {claimResult.success
                ? `You received ${claimResult.amount} JEJU`
                : claimResult.error}
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <button
          type="button"
          onClick={() => setShowApiDocs(!showApiDocs)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            color: 'var(--text-primary)',
          }}
        >
          <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>
            Developer API
          </span>
          <span style={{ color: 'var(--text-muted)' }}>
            {showApiDocs ? '▲' : '▼'}
          </span>
        </button>

        {showApiDocs && (
          <div style={{ marginTop: '1rem' }}>
            <p
              style={{
                fontSize: '0.9rem',
                marginBottom: '1rem',
                color: 'var(--text-secondary)',
              }}
            >
              Integrate the faucet into your agents and applications.
            </p>
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              <code
                style={{
                  display: 'block',
                  padding: '0.625rem 0.875rem',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.8rem',
                }}
              >
                <span style={{ color: 'var(--success)' }}>GET</span>{' '}
                /faucet/status/:address
              </code>
              <code
                style={{
                  display: 'block',
                  padding: '0.625rem 0.875rem',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.8rem',
                }}
              >
                <span style={{ color: 'var(--info)' }}>POST</span> /faucet/claim
              </code>
              <code
                style={{
                  display: 'block',
                  padding: '0.625rem 0.875rem',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.8rem',
                }}
              >
                <span style={{ color: 'var(--accent)' }}>GET</span> /faucet/info
              </code>
            </div>
          </div>
        )}
      </div>

      <div style={{ textAlign: 'center' }}>
        <Link to="/" style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          ← Back to Dashboard
        </Link>
      </div>
    </div>
  )
}
