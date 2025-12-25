import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Droplet,
  ExternalLink,
  type LucideProps,
  RefreshCw,
} from 'lucide-react'
import { type ComponentType, useState } from 'react'
import { useAccount } from 'wagmi'
import { z } from 'zod'
import type {
  FaucetClaimResult,
  FaucetInfo,
  FaucetStatus,
} from '../../api/services/faucet-service'
import { EXPLORER_URL } from '../../lib/config'

// Zod schemas for API response validation
const FaucetStatusSchema = z.object({
  eligible: z.boolean(),
  isRegistered: z.boolean(),
  cooldownRemaining: z.number(),
  nextClaimAt: z.number(),
  amountPerClaim: z.string(),
  faucetBalance: z.string(),
})

const FaucetClaimResultSchema = z.object({
  success: z.boolean(),
  txHash: z.string().nullable(),
  amount: z.string().nullable(),
  error: z.string().nullable(),
  cooldownRemaining: z.number().nullable(),
})

const FaucetInfoSchema = z.object({
  name: z.string(),
  description: z.string(),
  tokenSymbol: z.string(),
  amountPerClaim: z.string(),
  cooldownHours: z.number(),
  requirements: z.array(z.string()),
  chainId: z.number(),
  chainName: z.string(),
})

const DropletIcon = Droplet as ComponentType<LucideProps>
const RefreshCwIcon = RefreshCw as ComponentType<LucideProps>
const CheckCircle2Icon = CheckCircle2 as ComponentType<LucideProps>
const AlertCircleIcon = AlertCircle as ComponentType<LucideProps>
const ClockIcon = Clock as ComponentType<LucideProps>
const ExternalLinkIcon = ExternalLink as ComponentType<LucideProps>
const ChevronUpIcon = ChevronUp as ComponentType<LucideProps>
const ChevronDownIcon = ChevronDown as ComponentType<LucideProps>

function formatTime(ms: number): string {
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

async function fetchFaucetStatus(address: string): Promise<FaucetStatus> {
  const response = await fetch(`/api/faucet/status/${address}`)
  if (!response.ok) {
    throw new Error('Failed to fetch faucet status')
  }
  const data = await response.json()
  const result = FaucetStatusSchema.safeParse(data)
  if (!result.success) {
    throw new Error('Invalid faucet status response')
  }
  return {
    ...result.data,
    nextClaimAt: result.data.nextClaimAt ?? null,
  }
}

async function fetchFaucetInfo(): Promise<FaucetInfo> {
  const response = await fetch('/api/faucet/info')
  if (!response.ok) {
    throw new Error('Failed to fetch faucet info')
  }
  const data = await response.json()
  const result = FaucetInfoSchema.safeParse(data)
  if (!result.success) {
    throw new Error('Invalid faucet info response')
  }
  return result.data
}

async function claimFromFaucet(address: string): Promise<FaucetClaimResult> {
  const response = await fetch('/api/faucet/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }),
  })
  const data = await response.json()
  const result = FaucetClaimResultSchema.safeParse(data)
  if (!result.success) {
    return { success: false, error: 'Invalid claim response' }
  }
  return result.data
}

function useFaucet() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  const {
    data: status = null,
    isLoading: loading,
    error: statusError,
    refetch: refetchStatus,
  } = useQuery({
    queryKey: ['faucet-status', address],
    queryFn: () => fetchFaucetStatus(address ?? ''),
    enabled: !!address,
  })

  const { data: info = null } = useQuery({
    queryKey: ['faucet-info'],
    queryFn: fetchFaucetInfo,
    staleTime: 60000,
  })

  const claimMutation = useMutation({
    mutationFn: () => claimFromFaucet(address ?? ''),
    onSuccess: (result) => {
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ['faucet-status', address] })
      }
    },
  })

  return {
    status,
    loading,
    claiming: claimMutation.isPending,
    claimResult: claimMutation.data ?? null,
    info,
    claim: () => claimMutation.mutate(),
    refresh: () => {
      refetchStatus()
    },
    error: statusError?.message ?? null,
  }
}

export default function FaucetTab() {
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
      <div className="card">
        <div className="card-header">
          <DropletIcon size={20} />
          <h3>JEJU Faucet</h3>
        </div>
        <p className="text-secondary">Connect your wallet to use the faucet.</p>
      </div>
    )
  }

  const isRegistered = status?.isRegistered ?? false

  return (
    <div className="space-y-4">
      {/* Main Faucet Card */}
      <div className="card">
        <div className="card-header">
          <DropletIcon size={20} />
          <h3>{info?.name ?? 'JEJU Testnet Faucet'}</h3>
          <button
            type="button"
            className="button button-secondary"
            onClick={refresh}
            disabled={loading}
            title="Refresh status"
          >
            <RefreshCwIcon
              size={16}
              className={loading ? 'animate-spin' : ''}
            />
          </button>
        </div>

        <p className="text-secondary mb-4">
          {info?.description ?? 'Get JEJU tokens for testing on the testnet.'}
        </p>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="stat-card">
            <span className="stat-label">Amount per claim</span>
            <span className="stat-value">
              {status?.amountPerClaim ?? info?.amountPerClaim ?? '100'} JEJU
            </span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Cooldown</span>
            <span className="stat-value">
              {info?.cooldownHours ?? 12} hours
            </span>
          </div>
        </div>

        {/* Status Checklist */}
        <div className="space-y-3 mb-4">
          {/* Registration Check */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-surface">
            <div className="flex items-center gap-2">
              {loading ? (
                <RefreshCwIcon
                  size={18}
                  className="animate-spin text-gray-400"
                />
              ) : isRegistered ? (
                <CheckCircle2Icon size={18} className="text-green-500" />
              ) : (
                <AlertCircleIcon size={18} className="text-yellow-500" />
              )}
              <span className="text-sm">ERC-8004 Registry</span>
            </div>
            <span
              className={`text-sm font-medium ${loading ? 'text-gray-400' : isRegistered ? 'text-green-500' : 'text-yellow-500'}`}
            >
              {loading
                ? 'Checking...'
                : isRegistered
                  ? 'Registered'
                  : 'Not Registered'}
            </span>
          </div>

          {/* Cooldown Check */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-surface">
            <div className="flex items-center gap-2">
              {loading ? (
                <RefreshCwIcon
                  size={18}
                  className="animate-spin text-gray-400"
                />
              ) : status && status.cooldownRemaining === 0 ? (
                <CheckCircle2Icon size={18} className="text-green-500" />
              ) : (
                <ClockIcon size={18} className="text-yellow-500" />
              )}
              <span className="text-sm">Cooldown</span>
            </div>
            <span
              className={`text-sm font-medium ${loading ? 'text-gray-400' : status?.cooldownRemaining === 0 ? 'text-green-500' : 'text-yellow-500'}`}
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
              <AlertCircleIcon
                size={20}
                className="text-yellow-500 flex-shrink-0 mt-0.5"
              />
              <div>
                <p className="font-medium text-yellow-500">
                  Registration Required
                </p>
                <p className="text-secondary text-sm mt-1">
                  Register in the ERC-8004 Identity Registry to claim tokens.
                  This prevents bots and ensures tokens go to real developers.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    // Navigate to Bazaar tab and trigger registration view
                    window.dispatchEvent(
                      new CustomEvent('navigate-to-register'),
                    )
                    const tabs = document.querySelectorAll('button')
                    for (const tab of tabs) {
                      if (tab.textContent?.includes('Bazaar')) {
                        tab.click()
                        break
                      }
                    }
                  }}
                  className="text-primary text-sm mt-2 inline-flex items-center gap-1 hover:underline font-medium"
                >
                  Register Now <ExternalLinkIcon size={14} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 mb-4">
            <div className="flex items-center gap-2">
              <AlertCircleIcon size={18} className="text-red-500" />
              <span className="text-red-500 text-sm">{error}</span>
            </div>
          </div>
        )}

        {/* Claim Button */}
        <button
          type="button"
          className="button w-full"
          onClick={claim}
          disabled={!status?.eligible || claiming || loading}
        >
          {claiming ? (
            <>
              <RefreshCwIcon size={16} className="animate-spin" />
              Claiming...
            </>
          ) : (
            <>
              <DropletIcon size={16} />
              {status?.eligible
                ? `Claim ${status.amountPerClaim} JEJU`
                : 'Claim JEJU'}
            </>
          )}
        </button>

        {/* Claim Result */}
        {claimResult && (
          <div
            className={`mt-4 p-4 rounded-lg ${claimResult.success ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20'}`}
          >
            {claimResult.success ? (
              <div className="flex items-start gap-3">
                <CheckCircle2Icon
                  size={20}
                  className="text-green-500 flex-shrink-0 mt-0.5"
                />
                <div>
                  <p className="font-medium text-green-500">Claim Successful</p>
                  <p className="text-secondary text-sm mt-1">
                    You received {claimResult.amount} JEJU
                  </p>
                  {claimResult.txHash && (
                    <a
                      href={`${EXPLORER_URL}/tx/${claimResult.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary text-sm mt-2 inline-flex items-center gap-1 hover:underline"
                    >
                      View Transaction <ExternalLinkIcon size={14} />
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <AlertCircleIcon
                  size={20}
                  className="text-red-500 flex-shrink-0 mt-0.5"
                />
                <div>
                  <p className="font-medium text-red-500">Claim Failed</p>
                  <p className="text-secondary text-sm mt-1">
                    {claimResult.error}
                  </p>
                  {claimResult.cooldownRemaining && (
                    <p className="text-secondary text-sm mt-1">
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
          type="button"
          className="card-header w-full cursor-pointer"
          onClick={() => setShowApiDocs(!showApiDocs)}
        >
          <h3 className="text-sm">Developer API</h3>
          {showApiDocs ? (
            <ChevronUpIcon size={16} />
          ) : (
            <ChevronDownIcon size={16} />
          )}
        </button>

        {showApiDocs && (
          <div className="mt-4">
            <p className="text-secondary text-sm mb-3">
              Integrate the faucet into your agents and applications.
            </p>
            <div className="space-y-2 text-xs font-mono">
              <div className="p-2 rounded bg-surface">
                <span className="text-green-500">GET</span>{' '}
                /api/faucet/status/:address
              </div>
              <div className="p-2 rounded bg-surface">
                <span className="text-blue-500">POST</span> /api/faucet/claim{' '}
                {'{ address }'}
              </div>
              <div className="p-2 rounded bg-surface">
                <span className="text-purple-500">A2A</span> faucet-status,
                faucet-claim
              </div>
              <div className="p-2 rounded bg-surface">
                <span className="text-orange-500">MCP</span> faucet_status,
                faucet_claim
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
