/**
 * Faucet Page
 *
 * Uses the typed Eden Treaty client for API calls.
 */

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Address } from 'viem'
import { useAccount } from 'wagmi'
import { claimFaucet, getFaucetInfo, getFaucetStatus } from '../../api/api'
import type {
  FaucetClaimResult,
  FaucetInfo,
  FaucetStatus,
} from '../../api/faucet'

function formatTime(ms: number): string {
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
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

    try {
      const data = await getFaucetStatus(address as Address)
      setStatus(data)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to fetch faucet status',
      )
    } finally {
      setLoading(false)
    }
  }, [address])

  const fetchInfo = useCallback(async () => {
    try {
      const data = await getFaucetInfo()
      setInfo(data)
    } catch (err) {
      console.error('Failed to fetch faucet info:', err)
    }
  }, [])

  const claim = useCallback(async () => {
    if (!address) return
    setClaiming(true)
    setClaimResult(null)

    try {
      const result = await claimFaucet(address as Address)
      setClaimResult(result)
      if (result.success) {
        await fetchStatus()
      }
    } catch (err) {
      setClaimResult({
        success: false,
        error: err instanceof Error ? err.message : 'Claim failed',
      })
    } finally {
      setClaiming(false)
    }
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

  if (!isConnected) {
    return (
      <div className="max-w-xl mx-auto">
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-2xl">💧</span>
            <h1 className="text-xl font-bold">JEJU Faucet</h1>
          </div>
          <p style={{ color: 'var(--text-secondary)' }}>
            Connect your wallet to use the faucet.
          </p>
        </div>
      </div>
    )
  }

  const isRegistered = status?.isRegistered ?? false

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-2xl">💧</span>
            <h1 className="text-xl font-bold">{info?.name ?? 'JEJU Faucet'}</h1>
          </div>
          <button
            type="button"
            className="btn btn-secondary p-2"
            onClick={refresh}
            disabled={loading}
            title="Refresh status"
          >
            <span className={loading ? 'animate-spin inline-block' : ''}>
              🔄
            </span>
          </button>
        </div>

        <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
          {info?.description ?? 'Get JEJU tokens for testing on the network.'}
        </p>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div
            className="p-3 rounded-lg"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <span
              className="text-xs"
              style={{ color: 'var(--text-secondary)' }}
            >
              Amount per claim
            </span>
            <div className="font-bold">
              {status?.amountPerClaim ?? info?.amountPerClaim ?? '100'} JEJU
            </div>
          </div>
          <div
            className="p-3 rounded-lg"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <span
              className="text-xs"
              style={{ color: 'var(--text-secondary)' }}
            >
              Cooldown
            </span>
            <div className="font-bold">{info?.cooldownHours ?? 12} hours</div>
          </div>
        </div>

        <div className="space-y-3 mb-4">
          <div
            className="flex items-center justify-between p-3 rounded-lg"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <div className="flex items-center gap-2">
              {loading ? (
                <span className="animate-spin">🔄</span>
              ) : isRegistered ? (
                <span>✅</span>
              ) : (
                <span>⚠️</span>
              )}
              <span className="text-sm">ERC-8004 Registry</span>
            </div>
            <span
              className={`text-sm font-medium ${
                loading
                  ? 'text-gray-400'
                  : isRegistered
                    ? 'text-green-500'
                    : 'text-yellow-500'
              }`}
            >
              {loading
                ? 'Checking...'
                : isRegistered
                  ? 'Registered'
                  : 'Not Registered'}
            </span>
          </div>

          <div
            className="flex items-center justify-between p-3 rounded-lg"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <div className="flex items-center gap-2">
              {loading ? (
                <span className="animate-spin">🔄</span>
              ) : status && status.cooldownRemaining === 0 ? (
                <span>✅</span>
              ) : (
                <span>⏰</span>
              )}
              <span className="text-sm">Cooldown</span>
            </div>
            <span
              className={`text-sm font-medium ${
                loading
                  ? 'text-gray-400'
                  : status?.cooldownRemaining === 0
                    ? 'text-green-500'
                    : 'text-yellow-500'
              }`}
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
          <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 mb-4">
            <div className="flex items-center gap-2">
              <span>❌</span>
              <span className="text-red-500 text-sm">{error}</span>
            </div>
          </div>
        )}

        <button
          type="button"
          className="btn btn-primary w-full py-3 font-semibold"
          onClick={claim}
          disabled={!status?.eligible || claiming || loading}
        >
          {claiming ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-spin">🔄</span>
              Claiming...
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <span>💧</span>
              {status?.eligible
                ? `Claim ${status.amountPerClaim} JEJU`
                : 'Claim JEJU'}
            </span>
          )}
        </button>

        {claimResult && (
          <div
            className={`mt-4 p-4 rounded-lg ${
              claimResult.success
                ? 'bg-green-500/10 border border-green-500/20'
                : 'bg-red-500/10 border border-red-500/20'
            }`}
          >
            {claimResult.success ? (
              <div className="flex items-start gap-3">
                <span className="text-xl">✅</span>
                <div>
                  <p className="font-medium text-green-500">Claim Successful</p>
                  <p
                    className="text-sm mt-1"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    You received {claimResult.amount} JEJU
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <span className="text-xl">❌</span>
                <div>
                  <p className="font-medium text-red-500">Claim Failed</p>
                  <p
                    className="text-sm mt-1"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {claimResult.error}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card p-4">
        <button
          type="button"
          className="flex items-center justify-between w-full"
          onClick={() => setShowApiDocs(!showApiDocs)}
        >
          <h3 className="text-sm font-semibold">Developer API</h3>
          <span>{showApiDocs ? '▲' : '▼'}</span>
        </button>

        {showApiDocs && (
          <div className="mt-4">
            <p
              className="text-sm mb-3"
              style={{ color: 'var(--text-secondary)' }}
            >
              Integrate the faucet into your agents and applications.
            </p>
            <div className="space-y-2 text-xs font-mono">
              <div
                className="p-2 rounded"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
              >
                <span className="text-green-500">GET</span>{' '}
                /api/faucet/status/:address
              </div>
              <div
                className="p-2 rounded"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
              >
                <span className="text-blue-500">POST</span> /api/faucet/claim{' '}
                {'{ address }'}
              </div>
              <div
                className="p-2 rounded"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
              >
                <span className="text-purple-500">GET</span> /api/faucet/info
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="text-center">
        <Link
          to="/"
          className="text-sm hover:underline"
          style={{ color: 'var(--text-secondary)' }}
        >
          ← Back to Home
        </Link>
      </div>
    </div>
  )
}
