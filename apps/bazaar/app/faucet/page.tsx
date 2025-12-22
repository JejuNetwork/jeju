'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAccount } from 'wagmi'
import Link from 'next/link'
import { z } from 'zod'
import {
  FaucetStatusSchema,
  FaucetClaimResultSchema,
  FaucetInfoSchema,
  type FaucetStatus,
  type FaucetClaimResult,
  type FaucetInfo,
} from '@/lib/faucet'

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

    const response = await fetch(`/api/faucet/status/${address}`)
    if (!response.ok) {
      setError('Failed to fetch faucet status')
      setLoading(false)
      return
    }
    const data: unknown = await response.json()
    const result = FaucetStatusSchema.safeParse(data)
    if (!result.success) {
      setError('Invalid faucet status response')
      setLoading(false)
      return
    }
    setStatus(result.data)
    setLoading(false)
  }, [address])

  const fetchInfo = useCallback(async () => {
    const response = await fetch('/api/faucet/info')
    if (!response.ok) return
    const data: unknown = await response.json()
    const result = FaucetInfoSchema.safeParse(data)
    if (!result.success) {
      console.error('Invalid faucet info response:', result.error)
      return
    }
    setInfo(result.data)
  }, [])

  const claim = useCallback(async () => {
    if (!address) return
    setClaiming(true)
    setClaimResult(null)

    const response = await fetch('/api/faucet/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    })
    const data: unknown = await response.json()
    const result = FaucetClaimResultSchema.safeParse(data)
    if (!result.success) {
      setClaimResult({ success: false, error: 'Invalid claim response' })
      setClaiming(false)
      return
    }
    setClaimResult(result.data)
    setClaiming(false)
    if (result.data.success) {
      await fetchStatus()
    }
  }, [address, fetchStatus])

  useEffect(() => {
    fetchInfo()
    if (address) {
      fetchStatus()
    }
  }, [address, fetchInfo, fetchStatus])

  return { status, loading, claiming, claimResult, info, claim, refresh: fetchStatus, error }
}

export default function FaucetPage() {
  const { isConnected } = useAccount()
  const { status, loading, claiming, claimResult, info, claim, refresh, error } = useFaucet()
  const [showApiDocs, setShowApiDocs] = useState(false)

  if (!isConnected) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="card max-w-xl mx-auto">
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
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-xl mx-auto space-y-4">
        {/* Main Faucet Card */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-2xl">💧</span>
              <h1 className="text-xl font-bold">{info?.name || 'JEJU Faucet'}</h1>
            </div>
            <button
              className="btn btn-secondary p-2"
              onClick={refresh}
              disabled={loading}
              title="Refresh status"
              aria-label="Refresh status"
            >
              <span className={loading ? 'animate-spin inline-block' : ''}>🔄</span>
            </button>
          </div>

          <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
            {info?.description || 'Get JEJU tokens for testing on the network.'}
          </p>

          {/* Not Configured Warning */}
          {info && !info.isConfigured && (
            <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 mb-4">
              <div className="flex items-start gap-3">
                <span className="text-xl">⚠️</span>
                <div>
                  <p className="font-medium text-yellow-500">Faucet Not Configured</p>
                  <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Set FAUCET_PRIVATE_KEY environment variable to enable the faucet.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="p-3 rounded-lg" style={{ background: 'var(--card-bg)' }}>
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Amount per claim
              </span>
              <div className="font-bold">
                {status?.amountPerClaim || info?.amountPerClaim || '100'} JEJU
              </div>
            </div>
            <div className="p-3 rounded-lg" style={{ background: 'var(--card-bg)' }}>
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Cooldown
              </span>
              <div className="font-bold">{info?.cooldownHours || 12} hours</div>
            </div>
          </div>

          {/* Status Checklist */}
          <div className="space-y-3 mb-4">
            {/* Registration Check */}
            <div
              className="flex items-center justify-between p-3 rounded-lg"
              style={{ background: 'var(--card-bg)' }}
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
                  loading ? 'text-gray-400' : isRegistered ? 'text-green-500' : 'text-yellow-500'
                }`}
              >
                {loading ? 'Checking...' : isRegistered ? 'Registered' : 'Not Registered'}
              </span>
            </div>

            {/* Cooldown Check */}
            <div
              className="flex items-center justify-between p-3 rounded-lg"
              style={{ background: 'var(--card-bg)' }}
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

          {/* Registration CTA */}
          {!loading && !isRegistered && (
            <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 mb-4">
              <div className="flex items-start gap-3">
                <span className="text-xl">⚠️</span>
                <div>
                  <p className="font-medium text-yellow-500">Registration Required</p>
                  <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Register in the ERC-8004 Identity Registry to claim tokens. This prevents bots
                    and ensures tokens go to real developers.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 mb-4">
              <div className="flex items-center gap-2">
                <span>❌</span>
                <span className="text-red-500 text-sm">{error}</span>
              </div>
            </div>
          )}

          {/* Claim Button */}
          <button
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
                {status?.eligible ? `Claim ${status.amountPerClaim} JEJU` : 'Claim JEJU'}
              </span>
            )}
          </button>

          {/* Claim Result */}
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
                    <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                      You received {claimResult.amount} JEJU
                    </p>
                    {claimResult.txHash && info?.explorerUrl && (
                      <a
                        href={`${info.explorerUrl}/tx/${claimResult.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm mt-2 inline-flex items-center gap-1 hover:underline"
                        style={{ color: 'var(--bazaar-primary)' }}
                      >
                        View Transaction 🔗
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <span className="text-xl">❌</span>
                  <div>
                    <p className="font-medium text-red-500">Claim Failed</p>
                    <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                      {claimResult.error}
                    </p>
                    {claimResult.cooldownRemaining && (
                      <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                        Try again in {formatTime(claimResult.cooldownRemaining)}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Collapsible API Documentation */}
        <div className="card">
          <button
            className="flex items-center justify-between w-full"
            onClick={() => setShowApiDocs(!showApiDocs)}
          >
            <h3 className="text-sm font-semibold">Developer API</h3>
            <span>{showApiDocs ? '▲' : '▼'}</span>
          </button>

          {showApiDocs && (
            <div className="mt-4">
              <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
                Integrate the faucet into your agents and applications.
              </p>
              <div className="space-y-2 text-xs font-mono">
                <div className="p-2 rounded" style={{ background: 'var(--card-bg)' }}>
                  <span className="text-green-500">GET</span> /api/faucet/status/:address
                </div>
                <div className="p-2 rounded" style={{ background: 'var(--card-bg)' }}>
                  <span className="text-blue-500">POST</span> /api/faucet/claim {'{ address }'}
                </div>
                <div className="p-2 rounded" style={{ background: 'var(--card-bg)' }}>
                  <span className="text-purple-500">GET</span> /api/faucet/info
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Back to Home */}
        <div className="text-center">
          <Link href="/" className="text-sm hover:underline" style={{ color: 'var(--text-secondary)' }}>
            ← Back to Home
          </Link>
        </div>
      </div>
    </div>
  )
}
