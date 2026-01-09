/**
 * Node Registration Wizard
 *
 * Multi-step wizard for registering a new node on the Jeju Network.
 * Uses wagmi's useWriteContract for actual on-chain transactions.
 */

import { ZERO_ADDRESS } from '@jejunetwork/types'
import {
  Region,
  type RegionValue,
  useNodeStaking,
  useWallet,
} from '@jejunetwork/ui'
import {
  AlertCircle,
  ArrowRight,
  Check,
  Coins,
  ExternalLink,
  Loader2,
  Server,
  Shield,
  Wallet,
  Wifi,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatEther } from 'viem'
import { CONTRACTS } from '../config'

type WizardStep =
  | 'connect'
  | 'services'
  | 'stake'
  | 'approve'
  | 'confirm'
  | 'complete'

interface ServiceOption {
  id: string
  name: string
  icon: React.ReactNode
  description: string
  // Stake requirements will be fetched from contract
  selected: boolean
}

const DEFAULT_SERVICES: ServiceOption[] = [
  {
    id: 'vpn',
    name: 'VPN Node',
    icon: <Shield size={20} />,
    description: 'Route encrypted VPN traffic',
    selected: false,
  },
  {
    id: 'cdn',
    name: 'CDN Edge',
    icon: <Wifi size={20} />,
    description: 'Cache and serve content',
    selected: false,
  },
  {
    id: 'storage',
    name: 'Storage Node',
    icon: <Server size={20} />,
    description: 'Store network data',
    selected: false,
  },
  {
    id: 'rpc',
    name: 'RPC Provider',
    icon: <Server size={20} />,
    description: 'Serve blockchain queries',
    selected: false,
  },
]

// Token addresses from config - use JEJU token for staking and rewards
import { TOKENS } from '../config'

// Use configured token addresses, falling back to zero address if not configured
const DEFAULT_STAKING_TOKEN = TOKENS.jeju
const DEFAULT_REWARD_TOKEN = TOKENS.jeju

function formatStakeAmount(wei: bigint): string {
  const value = Number(formatEther(wei))
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K JEJU`
  if (value >= 1) return `${value.toFixed(0)} JEJU`
  return `${value.toFixed(2)} JEJU`
}

export default function NodeRegistrationWizard() {
  const { address, isConnected, isConnecting, connect } = useWallet()

  // Get staking manager address from config
  const stakingManagerAddress =
    CONTRACTS.nodeStakingManager !== ZERO_ADDRESS
      ? CONTRACTS.nodeStakingManager
      : undefined

  // Use the real staking hook
  const {
    minStakeUSD,
    baseRewardPerMonthUSD,
    approveStaking,
    isApproving,
    isApprovalSuccess,
    approvalHash,
    registerNode,
    isRegistering,
    isRegistrationSuccess,
    registrationHash,
  } = useNodeStaking(stakingManagerAddress, address)

  const [step, setStep] = useState<WizardStep>('connect')
  const [services, setServices] = useState<ServiceOption[]>(DEFAULT_SERVICES)
  const [error, setError] = useState<string | null>(null)
  const [selectedRegion, setSelectedRegion] = useState<RegionValue>(
    Region.NorthAmerica,
  )
  const [nodeRpcUrl, setNodeRpcUrl] = useState('')

  const selectedServices = services.filter((s) => s.selected)

  // Calculate required stake from contract's minStakeUSD
  const requiredStake = useMemo(() => {
    if (!minStakeUSD) return BigInt(0)
    // Multiply by number of services selected
    return minStakeUSD * BigInt(Math.max(selectedServices.length, 1))
  }, [minStakeUSD, selectedServices.length])

  // Calculate estimated reward from contract's baseRewardPerMonthUSD
  const estimatedMonthlyReward = useMemo(() => {
    if (!baseRewardPerMonthUSD) return '$0'
    const perService = Number(formatEther(baseRewardPerMonthUSD))
    const total = perService * selectedServices.length
    return `~$${total.toFixed(0)}`
  }, [baseRewardPerMonthUSD, selectedServices.length])

  const toggleService = useCallback((serviceId: string) => {
    setServices((prev) =>
      prev.map((s) =>
        s.id === serviceId ? { ...s, selected: !s.selected } : s,
      ),
    )
  }, [])

  const handleNextStep = useCallback(() => {
    setError(null)
    if (step === 'connect' && isConnected) {
      setStep('services')
    } else if (step === 'services' && selectedServices.length > 0) {
      setStep('stake')
    } else if (step === 'stake') {
      setStep('approve')
    } else if (step === 'approve' && isApprovalSuccess) {
      setStep('confirm')
    }
  }, [step, isConnected, selectedServices.length, isApprovalSuccess])

  const handlePrevStep = useCallback(() => {
    setError(null)
    if (step === 'services') {
      setStep('connect')
    } else if (step === 'stake') {
      setStep('services')
    } else if (step === 'approve') {
      setStep('stake')
    } else if (step === 'confirm') {
      setStep('approve')
    }
  }, [step])

  const handleApprove = useCallback(() => {
    if (!stakingManagerAddress) {
      setError('Staking manager not configured for this network')
      return
    }
    if (DEFAULT_STAKING_TOKEN === ZERO_ADDRESS) {
      setError('Staking token not configured')
      return
    }
    setError(null)
    approveStaking(DEFAULT_STAKING_TOKEN, requiredStake)
  }, [stakingManagerAddress, requiredStake, approveStaking])

  const handleRegister = useCallback(() => {
    if (!stakingManagerAddress) {
      setError('Staking manager not configured for this network')
      return
    }
    if (!nodeRpcUrl) {
      setError('Please enter your node RPC URL')
      return
    }
    setError(null)
    registerNode({
      stakingToken: DEFAULT_STAKING_TOKEN,
      stakeAmount: requiredStake,
      rewardToken: DEFAULT_REWARD_TOKEN,
      rpcUrl: nodeRpcUrl,
      region: selectedRegion,
    })
  }, [
    stakingManagerAddress,
    nodeRpcUrl,
    requiredStake,
    selectedRegion,
    registerNode,
  ])

  // Auto-advance when approval succeeds
  useEffect(() => {
    if (step === 'approve' && isApprovalSuccess) {
      setStep('confirm')
    }
  }, [step, isApprovalSuccess])

  // Auto-advance when registration succeeds
  useEffect(() => {
    if (step === 'confirm' && isRegistrationSuccess) {
      setStep('complete')
    }
  }, [step, isRegistrationSuccess])

  const renderStepIndicator = () => {
    const steps: { key: WizardStep; label: string }[] = [
      { key: 'connect', label: 'Connect' },
      { key: 'services', label: 'Services' },
      { key: 'stake', label: 'Stake' },
      { key: 'approve', label: 'Approve' },
      { key: 'confirm', label: 'Register' },
    ]

    const currentIndex = steps.findIndex((s) => s.key === step)

    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '0.5rem',
          marginBottom: '2rem',
          flexWrap: 'wrap',
        }}
      >
        {steps.map((s, i) => {
          const isActive = s.key === step
          const isComplete = i < currentIndex || step === 'complete'

          return (
            <div
              key={s.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: isComplete
                    ? 'var(--success)'
                    : isActive
                      ? 'var(--accent)'
                      : 'var(--bg-tertiary)',
                  color: isComplete || isActive ? 'white' : 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  transition: 'all 0.2s ease',
                }}
              >
                {isComplete ? <Check size={14} /> : i + 1}
              </div>
              <span
                style={{
                  fontSize: '0.85rem',
                  color: isActive
                    ? 'var(--text-primary)'
                    : 'var(--text-secondary)',
                  fontWeight: isActive ? 600 : 400,
                }}
              >
                {s.label}
              </span>
              {i < steps.length - 1 && (
                <div
                  style={{
                    width: '24px',
                    height: '2px',
                    background: isComplete ? 'var(--success)' : 'var(--border)',
                    borderRadius: '1px',
                    marginLeft: '0.5rem',
                  }}
                />
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // Check if staking manager is configured
  if (!stakingManagerAddress) {
    return (
      <div className="card" style={{ marginBottom: '2rem' }}>
        <div className="card-header">
          <h3 className="card-title">
            <Server size={18} /> Register Your Node
          </h3>
        </div>
        <div
          style={{
            padding: '2rem',
            textAlign: 'center',
            color: 'var(--text-secondary)',
          }}
        >
          <AlertCircle
            size={48}
            style={{ marginBottom: '1rem', color: 'var(--warning)' }}
          />
          <h4>Staking Not Available</h4>
          <p>
            Node staking contracts are not deployed on this network yet.
            <br />
            Please check back later or switch to a supported network.
          </p>
        </div>
      </div>
    )
  }

  const renderConnectStep = () => (
    <div style={{ textAlign: 'center', padding: '1rem' }}>
      <div
        style={{
          width: '64px',
          height: '64px',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--accent-soft)',
          color: 'var(--accent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 1.5rem',
        }}
      >
        <Wallet size={32} />
      </div>
      <h3 style={{ marginBottom: '0.75rem' }}>Connect Your Wallet</h3>
      <p
        style={{
          color: 'var(--text-secondary)',
          marginBottom: '1.5rem',
          maxWidth: '400px',
          margin: '0 auto 1.5rem',
        }}
      >
        Connect your Ethereum wallet to register your node. Your wallet will
        receive all earnings from providing services.
      </p>

      {isConnected ? (
        <div
          style={{
            padding: '1rem',
            background: 'var(--success-soft)',
            borderRadius: 'var(--radius-md)',
            marginBottom: '1.5rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              color: 'var(--success)',
              marginBottom: '0.5rem',
            }}
          >
            <Check size={18} />
            <span style={{ fontWeight: 600 }}>Wallet Connected</span>
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.9rem',
              color: 'var(--text-secondary)',
            }}
          >
            {address?.slice(0, 6)}...{address?.slice(-4)}
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => connect()}
          disabled={isConnecting}
          style={{ padding: '0.875rem 2rem' }}
        >
          {isConnecting ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Connecting...
            </>
          ) : (
            <>
              <Wallet size={18} />
              Connect Wallet
            </>
          )}
        </button>
      )}

      {isConnected && (
        <div style={{ marginTop: '1rem' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleNextStep}
            style={{ padding: '0.875rem 2rem' }}
          >
            Continue <ArrowRight size={16} />
          </button>
        </div>
      )}
    </div>
  )

  const renderServicesStep = () => (
    <div>
      <h3 style={{ marginBottom: '0.5rem', textAlign: 'center' }}>
        Select Services
      </h3>
      <p
        style={{
          color: 'var(--text-secondary)',
          textAlign: 'center',
          marginBottom: '1.5rem',
        }}
      >
        Choose which services you want to provide.
      </p>

      <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {services.map((service) => (
          <button
            key={service.id}
            type="button"
            onClick={() => toggleService(service.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              padding: '1rem 1.25rem',
              background: service.selected
                ? 'var(--accent-soft)'
                : 'var(--bg-tertiary)',
              border: service.selected
                ? '2px solid var(--accent)'
                : '2px solid transparent',
              borderRadius: 'var(--radius-md)',
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            <div
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '4px',
                border: service.selected
                  ? '2px solid var(--accent)'
                  : '2px solid var(--border)',
                background: service.selected ? 'var(--accent)' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                flexShrink: 0,
              }}
            >
              {service.selected && <Check size={14} />}
            </div>
            <div
              style={{
                color: service.selected
                  ? 'var(--accent)'
                  : 'var(--text-secondary)',
              }}
            >
              {service.icon}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{service.name}</div>
              <div
                style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}
              >
                {service.description}
              </div>
            </div>
          </button>
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '1rem',
        }}
      >
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handlePrevStep}
        >
          Back
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleNextStep}
          disabled={selectedServices.length === 0}
        >
          Continue ({selectedServices.length} selected) <ArrowRight size={16} />
        </button>
      </div>
    </div>
  )

  const renderStakeStep = () => (
    <div>
      <h3 style={{ marginBottom: '0.5rem', textAlign: 'center' }}>
        Stake Requirement
      </h3>
      <p
        style={{
          color: 'var(--text-secondary)',
          textAlign: 'center',
          marginBottom: '1.5rem',
        }}
      >
        You need to stake JEJU tokens to register. Stake is returned when you
        deregister.
      </p>

      <div
        style={{
          padding: '1.5rem',
          background: 'var(--bg-tertiary)',
          borderRadius: 'var(--radius-md)',
          marginBottom: '1.5rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: '1rem',
          }}
        >
          <span style={{ color: 'var(--text-secondary)' }}>
            Selected Services
          </span>
          <span style={{ fontWeight: 600 }}>{selectedServices.length}</span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: '1rem',
          }}
        >
          <span style={{ color: 'var(--text-secondary)' }}>
            Min Stake per Service
          </span>
          <span style={{ fontWeight: 600 }}>
            {minStakeUSD ? formatStakeAmount(minStakeUSD) : 'Loading...'}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            paddingTop: '1rem',
            borderTop: '2px solid var(--border)',
            fontWeight: 700,
          }}
        >
          <span>Total Required</span>
          <span style={{ color: 'var(--accent)' }}>
            {formatStakeAmount(requiredStake)}
          </span>
        </div>
      </div>

      <div
        style={{
          padding: '1rem',
          background: 'var(--info-soft)',
          borderRadius: 'var(--radius-md)',
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0.75rem',
        }}
      >
        <Coins size={18} style={{ color: 'var(--info)', marginTop: '2px' }} />
        <div style={{ fontSize: '0.9rem' }}>
          <strong>Estimated Monthly Earnings:</strong> {estimatedMonthlyReward}
          /mo
          <br />
          <span style={{ color: 'var(--text-secondary)' }}>
            Based on contract parameters and your selected services.
          </span>
        </div>
      </div>

      {/* Node RPC URL input */}
      <div style={{ marginBottom: '1.5rem' }}>
        <label
          htmlFor="node-rpc-url"
          style={{
            display: 'block',
            marginBottom: '0.5rem',
            fontWeight: 500,
          }}
        >
          Node RPC URL
        </label>
        <input
          id="node-rpc-url"
          type="text"
          value={nodeRpcUrl}
          onChange={(e) => setNodeRpcUrl(e.target.value)}
          placeholder="https://your-node.example.com:8545"
          style={{
            width: '100%',
            padding: '0.75rem',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
          }}
        />
        <p
          style={{
            fontSize: '0.85rem',
            color: 'var(--text-muted)',
            marginTop: '0.5rem',
          }}
        >
          The public URL where your node will accept requests.
        </p>
      </div>

      {/* Region selector */}
      <div style={{ marginBottom: '1.5rem' }}>
        <label
          htmlFor="region-select"
          style={{
            display: 'block',
            marginBottom: '0.5rem',
            fontWeight: 500,
          }}
        >
          Region
        </label>
        <select
          id="region-select"
          value={selectedRegion}
          onChange={(e) =>
            setSelectedRegion(Number(e.target.value) as RegionValue)
          }
          style={{
            width: '100%',
            padding: '0.75rem',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
          }}
        >
          <option value={Region.NorthAmerica}>North America</option>
          <option value={Region.SouthAmerica}>South America</option>
          <option value={Region.Europe}>Europe</option>
          <option value={Region.Asia}>Asia</option>
          <option value={Region.Africa}>Africa</option>
          <option value={Region.Oceania}>Oceania</option>
          <option value={Region.Global}>Global</option>
        </select>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '1rem',
        }}
      >
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handlePrevStep}
        >
          Back
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleNextStep}
          disabled={!nodeRpcUrl}
        >
          Continue <ArrowRight size={16} />
        </button>
      </div>
    </div>
  )

  const renderApproveStep = () => (
    <div>
      <h3 style={{ marginBottom: '0.5rem', textAlign: 'center' }}>
        Approve Token Spending
      </h3>
      <p
        style={{
          color: 'var(--text-secondary)',
          textAlign: 'center',
          marginBottom: '1.5rem',
        }}
      >
        Before staking, you need to approve the staking contract to spend your
        tokens.
      </p>

      <div
        style={{
          padding: '1.5rem',
          background: 'var(--bg-tertiary)',
          borderRadius: 'var(--radius-md)',
          marginBottom: '1.5rem',
          textAlign: 'center',
        }}
      >
        <div style={{ marginBottom: '1rem' }}>
          <div
            style={{
              fontSize: '0.85rem',
              color: 'var(--text-muted)',
              marginBottom: '0.25rem',
            }}
          >
            Amount to Approve
          </div>
          <div
            style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              color: 'var(--accent)',
            }}
          >
            {formatStakeAmount(requiredStake)}
          </div>
        </div>

        {approvalHash && (
          <div style={{ marginTop: '1rem' }}>
            <a
              href={`https://explorer.jejunetwork.org/tx/${approvalHash}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                color: 'var(--accent)',
                fontSize: '0.9rem',
              }}
            >
              View Transaction <ExternalLink size={14} />
            </a>
          </div>
        )}

        {isApprovalSuccess && (
          <div
            style={{
              marginTop: '1rem',
              padding: '0.75rem',
              background: 'var(--success-soft)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--success)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
            }}
          >
            <Check size={18} />
            Approval Confirmed
          </div>
        )}
      </div>

      {error && (
        <div
          style={{
            padding: '1rem',
            background: 'var(--error-soft)',
            borderRadius: 'var(--radius-md)',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem',
            color: 'var(--error)',
          }}
        >
          <AlertCircle size={18} style={{ marginTop: '2px' }} />
          <div>{error}</div>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '1rem',
        }}
      >
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handlePrevStep}
          disabled={isApproving}
        >
          Back
        </button>
        {isApprovalSuccess ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleNextStep}
          >
            Continue <ArrowRight size={16} />
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleApprove}
            disabled={isApproving}
          >
            {isApproving ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Approving...
              </>
            ) : (
              <>
                <Check size={18} />
                Approve Tokens
              </>
            )}
          </button>
        )}
      </div>
    </div>
  )

  const renderConfirmStep = () => (
    <div>
      <h3 style={{ marginBottom: '0.5rem', textAlign: 'center' }}>
        Register Node
      </h3>
      <p
        style={{
          color: 'var(--text-secondary)',
          textAlign: 'center',
          marginBottom: '1.5rem',
        }}
      >
        Review your registration details and submit the transaction.
      </p>

      <div
        style={{
          padding: '1.5rem',
          background: 'var(--bg-tertiary)',
          borderRadius: 'var(--radius-md)',
          marginBottom: '1.5rem',
        }}
      >
        <div style={{ marginBottom: '1rem' }}>
          <div
            style={{
              fontSize: '0.8rem',
              color: 'var(--text-muted)',
              marginBottom: '0.25rem',
            }}
          >
            Wallet Address
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>
            {address}
          </div>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <div
            style={{
              fontSize: '0.8rem',
              color: 'var(--text-muted)',
              marginBottom: '0.25rem',
            }}
          >
            Services
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {selectedServices.map((s) => (
              <span key={s.id} className="badge badge-info">
                {s.name}
              </span>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <div
            style={{
              fontSize: '0.8rem',
              color: 'var(--text-muted)',
              marginBottom: '0.25rem',
            }}
          >
            Node RPC URL
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>
            {nodeRpcUrl}
          </div>
        </div>

        <div>
          <div
            style={{
              fontSize: '0.8rem',
              color: 'var(--text-muted)',
              marginBottom: '0.25rem',
            }}
          >
            Total Stake
          </div>
          <div
            style={{
              fontSize: '1.25rem',
              fontWeight: 700,
              color: 'var(--accent)',
            }}
          >
            {formatStakeAmount(requiredStake)}
          </div>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '1rem',
            background: 'var(--error-soft)',
            borderRadius: 'var(--radius-md)',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem',
            color: 'var(--error)',
          }}
        >
          <AlertCircle size={18} style={{ marginTop: '2px' }} />
          <div>{error}</div>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '1rem',
        }}
      >
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handlePrevStep}
          disabled={isRegistering}
        >
          Back
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleRegister}
          disabled={isRegistering}
        >
          {isRegistering ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Registering...
            </>
          ) : (
            <>
              <Check size={18} />
              Register Node
            </>
          )}
        </button>
      </div>
    </div>
  )

  const renderCompleteStep = () => (
    <div style={{ textAlign: 'center', padding: '1rem' }}>
      <div
        style={{
          width: '64px',
          height: '64px',
          borderRadius: '50%',
          background: 'var(--success)',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 1.5rem',
        }}
      >
        <Check size={32} />
      </div>
      <h3 style={{ marginBottom: '0.75rem' }}>Registration Complete</h3>
      <p
        style={{
          color: 'var(--text-secondary)',
          marginBottom: '1.5rem',
          maxWidth: '400px',
          margin: '0 auto 1.5rem',
        }}
      >
        Your node has been registered on the network. Download and run the Jeju
        Node app to start earning.
      </p>

      {registrationHash && (
        <div
          style={{
            padding: '1rem',
            background: 'var(--bg-tertiary)',
            borderRadius: 'var(--radius-md)',
            marginBottom: '1.5rem',
          }}
        >
          <div
            style={{
              fontSize: '0.8rem',
              color: 'var(--text-muted)',
              marginBottom: '0.25rem',
            }}
          >
            Transaction Hash
          </div>
          <a
            href={`https://explorer.jejunetwork.org/tx/${registrationHash}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.85rem',
              color: 'var(--accent)',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            {registrationHash.slice(0, 10)}...{registrationHash.slice(-8)}
            <ExternalLink size={14} />
          </a>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
        <a href="/provider/nodes" className="btn btn-primary">
          <Server size={18} />
          View My Nodes
        </a>
        <a href="#downloads" className="btn btn-secondary">
          Download App
        </a>
      </div>
    </div>
  )

  return (
    <div className="card" style={{ marginBottom: '2rem' }}>
      <div className="card-header">
        <h3 className="card-title">
          <Server size={18} /> Register Your Node
        </h3>
      </div>

      {step !== 'complete' && renderStepIndicator()}

      {step === 'connect' && renderConnectStep()}
      {step === 'services' && renderServicesStep()}
      {step === 'stake' && renderStakeStep()}
      {step === 'approve' && renderApproveStep()}
      {step === 'confirm' && renderConfirmStep()}
      {step === 'complete' && renderCompleteStep()}
    </div>
  )
}
