import { WalletButton } from '@jejunetwork/ui'
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
  Sparkles,
  Zap,
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
  txHash: z.string().optional(),
  amount: z.string().optional(),
  error: z.string().optional(),
  cooldownRemaining: z.number().optional(),
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
const SparklesIcon = Sparkles as ComponentType<LucideProps>
const ZapIcon = Zap as ComponentType<LucideProps>

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
  const { status, loading, claiming, claimResult, info, claim, refresh, error } =
    useFaucet()
  const [showApiDocs, setShowApiDocs] = useState(false)

  const isRegistered = status?.isRegistered ?? false
  const cooldownReady = status?.cooldownRemaining === 0

  return (
    <div>
      {/* Hero Section */}
      <div
        style={{
          position: 'relative',
          padding: '2.5rem 2rem',
          marginBottom: '1.5rem',
          borderRadius: '20px',
          background:
            'linear-gradient(135deg, var(--primary) 0%, #6366f1 50%, #8b5cf6 100%)',
          overflow: 'hidden',
        }}
      >
        {/* Decorative elements */}
        <div
          style={{
            position: 'absolute',
            top: '-50%',
            right: '-20%',
            width: '300px',
            height: '300px',
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.1)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '-30%',
            left: '-10%',
            width: '200px',
            height: '200px',
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.05)',
          }}
        />

        <div style={{ position: 'relative', zIndex: 1 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '0.75rem',
            }}
          >
            <div
              style={{
                padding: '0.75rem',
                background: 'rgba(255,255,255,0.2)',
                borderRadius: '12px',
                backdropFilter: 'blur(10px)',
              }}
            >
              <DropletIcon size={28} style={{ color: 'white' }} />
            </div>
            <div>
              <h1
                style={{
                  fontSize: 'clamp(1.5rem, 4vw, 2rem)',
                  fontWeight: 800,
                  color: 'white',
                  margin: 0,
                  letterSpacing: '-0.02em',
                }}
              >
                JEJU Faucet
              </h1>
              <p
                style={{
                  color: 'rgba(255,255,255,0.8)',
                  fontSize: '0.9375rem',
                  margin: 0,
                }}
              >
                Get testnet tokens to build and experiment
              </p>
            </div>
          </div>

          {/* Stats */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: '1rem',
              marginTop: '1.5rem',
            }}
          >
            <div
              style={{
                padding: '1rem 1.25rem',
                background: 'rgba(255,255,255,0.15)',
                borderRadius: '14px',
                backdropFilter: 'blur(10px)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  marginBottom: '0.25rem',
                }}
              >
                <ZapIcon size={14} style={{ color: 'rgba(255,255,255,0.7)' }} />
                <span
                  style={{
                    fontSize: '0.75rem',
                    color: 'rgba(255,255,255,0.7)',
                    fontWeight: 500,
                  }}
                >
                  Per Claim
                </span>
              </div>
              <p
                style={{
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  color: 'white',
                  margin: 0,
                }}
              >
                {status?.amountPerClaim ?? info?.amountPerClaim ?? '100'}{' '}
                <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                  JEJU
                </span>
              </p>
            </div>

            <div
              style={{
                padding: '1rem 1.25rem',
                background: 'rgba(255,255,255,0.15)',
                borderRadius: '14px',
                backdropFilter: 'blur(10px)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  marginBottom: '0.25rem',
                }}
              >
                <ClockIcon size={14} style={{ color: 'rgba(255,255,255,0.7)' }} />
                <span
                  style={{
                    fontSize: '0.75rem',
                    color: 'rgba(255,255,255,0.7)',
                    fontWeight: 500,
                  }}
                >
                  Cooldown
                </span>
              </div>
              <p
                style={{
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  color: 'white',
                  margin: 0,
                }}
              >
                {info?.cooldownHours ?? 12}{' '}
                <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                  hours
                </span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="card" style={{ padding: '1.5rem' }}>
        {/* Status Section - only show when connected */}
        {isConnected && (
          <div style={{ marginBottom: '1.5rem' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '1rem',
              }}
            >
              <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>
                Eligibility Status
              </h3>
              <button
                type="button"
                onClick={refresh}
                disabled={loading}
                style={{
                  padding: '0.5rem',
                  background: 'var(--surface-hover)',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <RefreshCwIcon
                  size={16}
                  style={{
                    color: 'var(--text-secondary)',
                    animation: loading ? 'spin 1s linear infinite' : 'none',
                  }}
                />
              </button>
            </div>

            {/* Status Cards */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '0.75rem',
              }}
            >
              {/* Registration Status */}
              <div
                style={{
                  padding: '1rem 1.25rem',
                  background: isRegistered
                    ? 'var(--success-soft)'
                    : 'var(--warning-soft)',
                  borderRadius: '12px',
                  border: `1px solid ${isRegistered ? 'var(--success)' : 'var(--warning)'}`,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                  }}
                >
                  {loading ? (
                    <RefreshCwIcon
                      size={20}
                      style={{
                        color: 'var(--text-muted)',
                        animation: 'spin 1s linear infinite',
                      }}
                    />
                  ) : isRegistered ? (
                    <CheckCircle2Icon
                      size={20}
                      style={{ color: 'var(--success)' }}
                    />
                  ) : (
                    <AlertCircleIcon
                      size={20}
                      style={{ color: 'var(--warning)' }}
                    />
                  )}
                  <div>
                    <p
                      style={{
                        fontSize: '0.8125rem',
                        fontWeight: 600,
                        color: isRegistered
                          ? 'var(--success)'
                          : 'var(--warning)',
                        margin: 0,
                      }}
                    >
                      {loading
                        ? 'Checking...'
                        : isRegistered
                          ? 'Registered'
                          : 'Not Registered'}
                    </p>
                    <p
                      style={{
                        fontSize: '0.75rem',
                        color: 'var(--text-secondary)',
                        margin: 0,
                      }}
                    >
                      ERC-8004 Identity
                    </p>
                  </div>
                </div>
              </div>

              {/* Cooldown Status */}
              <div
                style={{
                  padding: '1rem 1.25rem',
                  background: cooldownReady
                    ? 'var(--success-soft)'
                    : 'var(--surface-hover)',
                  borderRadius: '12px',
                  border: cooldownReady
                    ? '1px solid var(--success)'
                    : '1px solid var(--border)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                  }}
                >
                  {loading ? (
                    <RefreshCwIcon
                      size={20}
                      style={{
                        color: 'var(--text-muted)',
                        animation: 'spin 1s linear infinite',
                      }}
                    />
                  ) : cooldownReady ? (
                    <CheckCircle2Icon
                      size={20}
                      style={{ color: 'var(--success)' }}
                    />
                  ) : (
                    <ClockIcon size={20} style={{ color: 'var(--warning)' }} />
                  )}
                  <div>
                    <p
                      style={{
                        fontSize: '0.8125rem',
                        fontWeight: 600,
                        color: cooldownReady
                          ? 'var(--success)'
                          : 'var(--text-primary)',
                        margin: 0,
                      }}
                    >
                      {loading
                        ? 'Checking...'
                        : status?.cooldownRemaining
                          ? formatTime(status.cooldownRemaining)
                          : 'Ready'}
                    </p>
                    <p
                      style={{
                        fontSize: '0.75rem',
                        color: 'var(--text-secondary)',
                        margin: 0,
                      }}
                    >
                      Cooldown Timer
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Registration CTA */}
        {isConnected && !loading && !isRegistered && (
          <div
            style={{
              padding: '1.25rem',
              background:
                'linear-gradient(135deg, rgba(251, 191, 36, 0.1) 0%, rgba(245, 158, 11, 0.1) 100%)',
              border: '1px solid rgba(251, 191, 36, 0.3)',
              borderRadius: '14px',
              marginBottom: '1.5rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
              <div
                style={{
                  padding: '0.5rem',
                  background: 'rgba(251, 191, 36, 0.2)',
                  borderRadius: '8px',
                  flexShrink: 0,
                }}
              >
                <SparklesIcon size={20} style={{ color: 'var(--warning)' }} />
              </div>
              <div style={{ flex: 1 }}>
                <p
                  style={{
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    margin: 0,
                    fontSize: '0.9375rem',
                  }}
                >
                  Registration Required
                </p>
                <p
                  style={{
                    color: 'var(--text-secondary)',
                    fontSize: '0.8125rem',
                    margin: '0.25rem 0 0.75rem',
                    lineHeight: 1.5,
                  }}
                >
                  Register in the ERC-8004 Identity Registry to claim tokens.
                  This prevents bots and ensures tokens go to real developers.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('navigate-to-register'))
                    const tabs = document.querySelectorAll('button')
                    for (const tab of tabs) {
                      if (tab.textContent?.includes('Registry')) {
                        tab.click()
                        break
                      }
                    }
                  }}
                  style={{
                    padding: '0.625rem 1rem',
                    background: 'var(--warning)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 600,
                    fontSize: '0.8125rem',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  Register Now
                  <ExternalLinkIcon size={14} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div
            style={{
              padding: '1rem',
              background: 'var(--error-soft)',
              border: '1px solid var(--error)',
              borderRadius: '12px',
              marginBottom: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
            }}
          >
            <AlertCircleIcon size={18} style={{ color: 'var(--error)' }} />
            <span style={{ color: 'var(--error)', fontSize: '0.875rem' }}>
              {error}
            </span>
          </div>
        )}

        {/* Claim Button */}
        {isConnected ? (
          <button
            type="button"
            className="button"
            onClick={claim}
            disabled={!status?.eligible || claiming || loading}
            style={{
              width: '100%',
              padding: '1rem 1.5rem',
              fontSize: '1rem',
              fontWeight: 600,
              borderRadius: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              background: status?.eligible
                ? 'linear-gradient(135deg, var(--primary) 0%, #6366f1 100%)'
                : 'var(--surface-hover)',
              color: status?.eligible ? 'white' : 'var(--text-muted)',
              cursor: status?.eligible ? 'pointer' : 'not-allowed',
            }}
          >
            {claiming ? (
              <>
                <RefreshCwIcon
                  size={18}
                  style={{ animation: 'spin 1s linear infinite' }}
                />
                Claiming...
              </>
            ) : (
              <>
                <DropletIcon size={18} />
                {status?.eligible
                  ? `Claim ${status.amountPerClaim} JEJU`
                  : 'Claim JEJU'}
              </>
            )}
          </button>
        ) : (
          <div
            style={{
              padding: '2rem',
              background: 'var(--surface-hover)',
              borderRadius: '14px',
              textAlign: 'center',
            }}
          >
            <DropletIcon
              size={32}
              style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }}
            />
            <p
              style={{
                color: 'var(--text-secondary)',
                marginBottom: '1rem',
                fontSize: '0.9375rem',
              }}
            >
              Connect your wallet to claim tokens
            </p>
            <WalletButton />
          </div>
        )}

        {/* Claim Result */}
        {claimResult && (
          <div
            style={{
              marginTop: '1.25rem',
              padding: '1.25rem',
              borderRadius: '14px',
              background: claimResult.success
                ? 'var(--success-soft)'
                : 'var(--error-soft)',
              border: `1px solid ${claimResult.success ? 'var(--success)' : 'var(--error)'}`,
            }}
          >
            {claimResult.success ? (
              <div
                style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}
              >
                <CheckCircle2Icon
                  size={22}
                  style={{ color: 'var(--success)', flexShrink: 0 }}
                />
                <div>
                  <p
                    style={{
                      fontWeight: 600,
                      color: 'var(--success)',
                      margin: 0,
                      fontSize: '0.9375rem',
                    }}
                  >
                    Claim Successful
                  </p>
                  <p
                    style={{
                      color: 'var(--text-secondary)',
                      fontSize: '0.8125rem',
                      margin: '0.25rem 0 0',
                    }}
                  >
                    You received {claimResult.amount} JEJU
                  </p>
                  {claimResult.txHash && (
                    <a
                      href={`${EXPLORER_URL}/tx/${claimResult.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.375rem',
                        marginTop: '0.5rem',
                        color: 'var(--primary)',
                        fontSize: '0.8125rem',
                        fontWeight: 500,
                        textDecoration: 'none',
                      }}
                    >
                      View Transaction
                      <ExternalLinkIcon size={14} />
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <div
                style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}
              >
                <AlertCircleIcon
                  size={22}
                  style={{ color: 'var(--error)', flexShrink: 0 }}
                />
                <div>
                  <p
                    style={{
                      fontWeight: 600,
                      color: 'var(--error)',
                      margin: 0,
                      fontSize: '0.9375rem',
                    }}
                  >
                    Claim Failed
                  </p>
                  <p
                    style={{
                      color: 'var(--text-secondary)',
                      fontSize: '0.8125rem',
                      margin: '0.25rem 0 0',
                    }}
                  >
                    {claimResult.error}
                  </p>
                  {claimResult.cooldownRemaining && (
                    <p
                      style={{
                        color: 'var(--text-muted)',
                        fontSize: '0.8125rem',
                        margin: '0.25rem 0 0',
                      }}
                    >
                      Try again in {formatTime(claimResult.cooldownRemaining)}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Developer API Card */}
      <div className="card" style={{ marginTop: '1rem', padding: '1rem 1.25rem' }}>
        <button
          type="button"
          onClick={() => setShowApiDocs(!showApiDocs)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            color: 'inherit',
          }}
        >
          <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>
            Developer API
          </span>
          {showApiDocs ? (
            <ChevronUpIcon size={18} style={{ color: 'var(--text-secondary)' }} />
          ) : (
            <ChevronDownIcon size={18} style={{ color: 'var(--text-secondary)' }} />
          )}
        </button>

        {showApiDocs && (
          <div style={{ marginTop: '1rem' }}>
            <p
              style={{
                color: 'var(--text-secondary)',
                fontSize: '0.8125rem',
                marginBottom: '0.75rem',
              }}
            >
              Integrate the faucet into your agents and applications.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div
                style={{
                  padding: '0.75rem 1rem',
                  background: 'var(--surface-hover)',
                  borderRadius: '8px',
                  fontFamily: 'monospace',
                  fontSize: '0.8125rem',
                }}
              >
                <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                  GET
                </span>{' '}
                /api/faucet/status/:address
              </div>
              <div
                style={{
                  padding: '0.75rem 1rem',
                  background: 'var(--surface-hover)',
                  borderRadius: '8px',
                  fontFamily: 'monospace',
                  fontSize: '0.8125rem',
                }}
              >
                <span style={{ color: 'var(--info)', fontWeight: 600 }}>POST</span>{' '}
                /api/faucet/claim {'{ address }'}
              </div>
              <div
                style={{
                  padding: '0.75rem 1rem',
                  background: 'var(--surface-hover)',
                  borderRadius: '8px',
                  fontFamily: 'monospace',
                  fontSize: '0.8125rem',
                }}
              >
                <span style={{ color: '#a855f7', fontWeight: 600 }}>A2A</span>{' '}
                faucet-status, faucet-claim
              </div>
              <div
                style={{
                  padding: '0.75rem 1rem',
                  background: 'var(--surface-hover)',
                  borderRadius: '8px',
                  fontFamily: 'monospace',
                  fontSize: '0.8125rem',
                }}
              >
                <span style={{ color: '#f97316', fontWeight: 600 }}>MCP</span>{' '}
                faucet_status, faucet_claim
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
