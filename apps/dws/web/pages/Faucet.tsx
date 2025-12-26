/**
 * Faucet Page for DWS
 * Testnet-only JEJU token faucet.
 */

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
      <div className="max-w-xl mx-auto">
        <div className="card bg-base-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-2xl">🚫</span>
            <h1 className="text-xl font-bold">Faucet Not Available</h1>
          </div>
          <p className="text-base-content/70">
            The faucet is only available on testnet and localnet. Mainnet tokens
            must be acquired through exchanges or other means.
          </p>
          <div className="mt-4">
            <Link to="/" className="btn btn-ghost btn-sm">
              ← Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (!isConnected) {
    return (
      <div className="max-w-xl mx-auto">
        <div className="card bg-base-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-2xl">💧</span>
            <h1 className="text-xl font-bold">JEJU Faucet</h1>
          </div>
          <p className="text-base-content/70">
            Connect your wallet to use the faucet.
          </p>
        </div>
      </div>
    )
  }

  const isRegistered = status?.isRegistered ?? false

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <div className="card bg-base-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-2xl">💧</span>
            <h1 className="text-xl font-bold">{info?.name ?? 'JEJU Faucet'}</h1>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={refresh}
            disabled={loading}
            title="Refresh status"
          >
            <span className={loading ? 'animate-spin inline-block' : ''}>
              🔄
            </span>
          </button>
        </div>

        <p className="mb-4 text-base-content/70">
          {info?.description ?? 'Get JEJU tokens for testing on the network.'}
        </p>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="p-3 rounded-lg bg-base-300">
            <span className="text-xs text-base-content/60">
              Amount per claim
            </span>
            <div className="font-bold">
              {status?.amountPerClaim ?? info?.amountPerClaim ?? '100'} JEJU
            </div>
          </div>
          <div className="p-3 rounded-lg bg-base-300">
            <span className="text-xs text-base-content/60">Cooldown</span>
            <div className="font-bold">{info?.cooldownHours ?? 12} hours</div>
          </div>
        </div>

        <div className="space-y-3 mb-4">
          <div className="flex items-center justify-between p-3 rounded-lg bg-base-300">
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
                  ? 'text-base-content/50'
                  : isRegistered
                    ? 'text-success'
                    : 'text-warning'
              }`}
            >
              {loading
                ? 'Checking...'
                : isRegistered
                  ? 'Registered'
                  : 'Not Registered'}
            </span>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-base-300">
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
                  ? 'text-base-content/50'
                  : status?.cooldownRemaining === 0
                    ? 'text-success'
                    : 'text-warning'
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
          <div className="alert alert-error mb-4">
            <span>❌</span>
            <span className="text-sm">{error}</span>
          </div>
        )}

        <button
          type="button"
          className="btn btn-primary w-full"
          onClick={claim}
          disabled={!status?.eligible || claiming || loading}
        >
          {claiming ? (
            <span className="flex items-center justify-center gap-2">
              <span className="loading loading-spinner loading-sm" />
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
            className={`mt-4 alert ${
              claimResult.success ? 'alert-success' : 'alert-error'
            }`}
          >
            {claimResult.success ? (
              <div className="flex items-start gap-3">
                <span className="text-xl">✅</span>
                <div>
                  <p className="font-medium">Claim Successful</p>
                  <p className="text-sm mt-1 opacity-70">
                    You received {claimResult.amount} JEJU
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <span className="text-xl">❌</span>
                <div>
                  <p className="font-medium">Claim Failed</p>
                  <p className="text-sm mt-1 opacity-70">{claimResult.error}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card bg-base-200 p-4">
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
            <p className="text-sm mb-3 text-base-content/70">
              Integrate the faucet into your agents and applications.
            </p>
            <div className="space-y-2 text-xs font-mono">
              <div className="p-2 rounded bg-base-300">
                <span className="text-success">GET</span>{' '}
                /faucet/status/:address
              </div>
              <div className="p-2 rounded bg-base-300">
                <span className="text-info">POST</span> /faucet/claim{' '}
                {'{ address }'}
              </div>
              <div className="p-2 rounded bg-base-300">
                <span className="text-secondary">GET</span> /faucet/info
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="text-center">
        <Link to="/" className="text-sm hover:underline text-base-content/70">
          ← Back to Dashboard
        </Link>
      </div>
    </div>
  )
}
