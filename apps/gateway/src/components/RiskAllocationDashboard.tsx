import { Flame, type LucideProps, Shield, Zap } from 'lucide-react'
import { type ComponentType, useState } from 'react'
import { type Address, formatEther, parseEther } from 'viem'
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { useEILConfig } from '../hooks/useEIL'

const ShieldIcon = Shield as ComponentType<LucideProps>
const ZapIcon = Zap as ComponentType<LucideProps>
const FlameIcon = Flame as ComponentType<LucideProps>

// Risk tier const object matching the contract
const RiskTier = {
  CONSERVATIVE: 0,
  BALANCED: 1,
  AGGRESSIVE: 2,
} as const
type RiskTier = (typeof RiskTier)[keyof typeof RiskTier]

const RISK_SLEEVE_ABI = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'tier', type: 'uint8' }],
    outputs: [],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tier', type: 'uint8' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'claimYield',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'tier', type: 'uint8' }],
    outputs: [],
  },
  {
    name: 'getUserPosition',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'tier', type: 'uint8' },
    ],
    outputs: [
      { name: 'deposited', type: 'uint256' },
      { name: 'pendingYield', type: 'uint256' },
      { name: 'depositDuration', type: 'uint256' },
    ],
  },
  {
    name: 'getSleeveStats',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tier', type: 'uint8' }],
    outputs: [
      { name: 'deposited', type: 'uint256' },
      { name: 'utilized', type: 'uint256' },
      { name: 'available', type: 'uint256' },
      { name: 'utilizationBps', type: 'uint256' },
      { name: 'yieldBps', type: 'uint256' },
    ],
  },
] as const

interface TierConfig {
  tier: RiskTier
  name: string
  description: string
  icon: ComponentType<LucideProps>
  color: string
  bgColor: string
  expectedApy: string
}

const TIER_CONFIGS: TierConfig[] = [
  {
    tier: RiskTier.CONSERVATIVE,
    name: 'Conservative',
    description: 'Low risk, stable yields. Suitable for long-term holders.',
    icon: ShieldIcon,
    color: 'var(--success)',
    bgColor: 'var(--success-soft)',
    expectedApy: '3-5%',
  },
  {
    tier: RiskTier.BALANCED,
    name: 'Balanced',
    description: 'Moderate risk with competitive returns.',
    icon: ZapIcon,
    color: 'var(--info)',
    bgColor: 'var(--info-soft)',
    expectedApy: '8-12%',
  },
  {
    tier: RiskTier.AGGRESSIVE,
    name: 'Aggressive',
    description: 'Higher risk, higher potential returns.',
    icon: FlameIcon,
    color: 'var(--warning)',
    bgColor: 'var(--warning-soft)',
    expectedApy: '15-25%',
  },
]

function TierCard({
  config,
  riskSleeveAddress,
  userDeposit,
  totalDeposited,
  isExpanded,
  onToggle,
}: {
  config: TierConfig
  riskSleeveAddress: Address
  userDeposit: bigint
  totalDeposited: bigint
  isExpanded: boolean
  onToggle: () => void
}) {
  const [depositAmount, setDepositAmount] = useState('')
  const [withdrawAmount, setWithdrawAmount] = useState('')

  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const isLoading = isPending || isConfirming
  const Icon = config.icon

  const handleDeposit = (e: React.FormEvent) => {
    e.preventDefault()
    const amount = parseEther(depositAmount)
    writeContract({
      address: riskSleeveAddress,
      abi: RISK_SLEEVE_ABI,
      functionName: 'deposit',
      args: [config.tier],
      value: amount,
    })
    setDepositAmount('')
  }

  const handleWithdraw = (e: React.FormEvent) => {
    e.preventDefault()
    const amount = parseEther(withdrawAmount)
    writeContract({
      address: riskSleeveAddress,
      abi: RISK_SLEEVE_ABI,
      functionName: 'withdraw',
      args: [config.tier, amount],
    })
    setWithdrawAmount('')
  }

  const handleClaimYield = () => {
    writeContract({
      address: riskSleeveAddress,
      abi: RISK_SLEEVE_ABI,
      functionName: 'claimYield',
      args: [config.tier],
    })
  }

  return (
    <div
      style={{
        padding: '1.5rem',
        background: isExpanded ? config.bgColor : 'var(--surface)',
        borderRadius: '16px',
        border: `2px solid ${isExpanded ? config.color : 'var(--border)'}`,
        cursor: 'pointer',
        transition: 'all 0.2s',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: 'flex',
          width: '100%',
          border: 'none',
          background: 'inherit',
          cursor: 'pointer',
          alignItems: 'center',
          gap: '1rem',
          marginBottom: isExpanded ? '1.5rem' : 0,
        }}
      >
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: config.bgColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon size={24} style={{ color: config.color }} />
        </div>

        <div style={{ flex: 1 }}>
          <h3
            style={{
              fontSize: '1.125rem',
              fontWeight: '700',
              margin: 0,
              color: config.color,
            }}
          >
            {config.name}
          </h3>
          <p
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
              margin: '0.25rem 0 0',
            }}
          >
            {config.description}
          </p>
        </div>

        <div style={{ textAlign: 'right' }}>
          <p
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              margin: 0,
            }}
          >
            Expected APY
          </p>
          <p
            style={{
              fontSize: '1.25rem',
              fontWeight: '700',
              margin: 0,
              color: config.color,
            }}
          >
            {config.expectedApy}
          </p>
        </div>
      </button>

      {isExpanded && (
        <div>
          <div
            className="grid grid-2"
            style={{ gap: '1rem', marginBottom: '1.5rem' }}
          >
            <div
              style={{
                padding: '1rem',
                background: 'var(--surface)',
                borderRadius: '12px',
                textAlign: 'center',
              }}
            >
              <p
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-secondary)',
                  margin: 0,
                }}
              >
                Your Deposit
              </p>
              <p
                style={{
                  fontSize: '1.25rem',
                  fontWeight: '700',
                  margin: '0.5rem 0',
                  color: config.color,
                }}
              >
                {formatEther(userDeposit)} ETH
              </p>
            </div>

            <div
              style={{
                padding: '1rem',
                background: 'var(--surface)',
                borderRadius: '12px',
                textAlign: 'center',
              }}
            >
              <p
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-secondary)',
                  margin: 0,
                }}
              >
                Total in Pool
              </p>
              <p
                style={{
                  fontSize: '1.25rem',
                  fontWeight: '700',
                  margin: '0.5rem 0',
                }}
              >
                {formatEther(totalDeposited)} ETH
              </p>
            </div>
          </div>

          <form onSubmit={handleDeposit} style={{ marginBottom: '1rem' }}>
            <label
              htmlFor="deposit-amount"
              style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontWeight: '600',
                fontSize: '0.875rem',
              }}
            >
              Deposit ETH
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                id="deposit-amount"
                className="input"
                type="number"
                step="0.01"
                placeholder="0.0"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                disabled={isLoading}
                style={{ flex: 1 }}
              />
              <button
                type="submit"
                className="button"
                disabled={isLoading || !depositAmount}
                style={{ background: config.color }}
              >
                Deposit
              </button>
            </div>
          </form>

          {userDeposit > 0n && (
            <>
              <form onSubmit={handleWithdraw} style={{ marginBottom: '1rem' }}>
                <label
                  htmlFor="withdraw-amount"
                  style={{
                    display: 'block',
                    marginBottom: '0.5rem',
                    fontWeight: '600',
                    fontSize: '0.875rem',
                  }}
                >
                  Withdraw ETH
                </label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    id="withdraw-amount"
                    className="input"
                    type="number"
                    step="0.01"
                    placeholder="0.0"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    disabled={isLoading}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="submit"
                    className="button button-secondary"
                    disabled={isLoading || !withdrawAmount}
                  >
                    Withdraw
                  </button>
                </div>
              </form>

              <button
                type="button"
                className="button"
                style={{ width: '100%', background: config.color }}
                onClick={handleClaimYield}
                disabled={isLoading}
              >
                Claim Yield
              </button>
            </>
          )}

          {isSuccess && (
            <div
              style={{
                padding: '1rem',
                background: 'var(--success-soft)',
                borderRadius: '8px',
                marginTop: '1rem',
              }}
            >
              <p
                style={{
                  color: 'var(--success)',
                  margin: 0,
                  fontWeight: '600',
                }}
              >
                Transaction successful.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function RiskAllocationDashboard() {
  const { isConnected, address } = useAccount()
  const { riskSleeve } = useEILConfig()
  const [expandedTier, setExpandedTier] = useState<RiskTier | null>(null)

  // Fetch user positions for each tier (getUserPosition returns: deposited, pendingYield, depositDuration)
  const { data: conservativePositionData } = useReadContract({
    address: riskSleeve,
    abi: RISK_SLEEVE_ABI,
    functionName: 'getUserPosition',
    args: address ? [address, RiskTier.CONSERVATIVE] : undefined,
    query: { enabled: !!address && !!riskSleeve },
  })
  const conservativeDeposit = conservativePositionData?.[0] ?? 0n

  const { data: balancedPositionData } = useReadContract({
    address: riskSleeve,
    abi: RISK_SLEEVE_ABI,
    functionName: 'getUserPosition',
    args: address ? [address, RiskTier.BALANCED] : undefined,
    query: { enabled: !!address && !!riskSleeve },
  })
  const balancedDeposit = balancedPositionData?.[0] ?? 0n

  const { data: aggressivePositionData } = useReadContract({
    address: riskSleeve,
    abi: RISK_SLEEVE_ABI,
    functionName: 'getUserPosition',
    args: address ? [address, RiskTier.AGGRESSIVE] : undefined,
    query: { enabled: !!address && !!riskSleeve },
  })
  const aggressiveDeposit = aggressivePositionData?.[0] ?? 0n

  // Fetch sleeve stats for each tier (getSleeveStats returns: deposited, utilized, available, utilizationBps, yieldBps)
  const { data: conservativeSleeveData } = useReadContract({
    address: riskSleeve,
    abi: RISK_SLEEVE_ABI,
    functionName: 'getSleeveStats',
    args: [RiskTier.CONSERVATIVE],
    query: { enabled: !!riskSleeve },
  })
  const conservativeTotal = conservativeSleeveData?.[0] ?? 0n // deposited is first element

  const { data: balancedSleeveData } = useReadContract({
    address: riskSleeve,
    abi: RISK_SLEEVE_ABI,
    functionName: 'getSleeveStats',
    args: [RiskTier.BALANCED],
    query: { enabled: !!riskSleeve },
  })
  const balancedTotal = balancedSleeveData?.[0] ?? 0n // deposited is first element

  const { data: aggressiveSleeveData } = useReadContract({
    address: riskSleeve,
    abi: RISK_SLEEVE_ABI,
    functionName: 'getSleeveStats',
    args: [RiskTier.AGGRESSIVE],
    query: { enabled: !!riskSleeve },
  })
  const aggressiveTotal = aggressiveSleeveData?.[0] ?? 0n // deposited is first element

  const deposits: Record<RiskTier, bigint> = {
    [RiskTier.CONSERVATIVE]: conservativeDeposit,
    [RiskTier.BALANCED]: balancedDeposit,
    [RiskTier.AGGRESSIVE]: aggressiveDeposit,
  }

  const totals: Record<RiskTier, bigint> = {
    [RiskTier.CONSERVATIVE]: conservativeTotal,
    [RiskTier.BALANCED]: balancedTotal,
    [RiskTier.AGGRESSIVE]: aggressiveTotal,
  }

  const totalUserDeposit =
    conservativeDeposit + balancedDeposit + aggressiveDeposit
  const totalPoolValue = conservativeTotal + balancedTotal + aggressiveTotal

  if (!isConnected) {
    return (
      <div className="card">
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>
          Risk-Based Liquidity
        </h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          Connect your wallet to manage liquidity allocations
        </p>
      </div>
    )
  }

  if (!riskSleeve) {
    return (
      <div className="card">
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>
          Risk-Based Liquidity
        </h2>
        <div
          style={{
            padding: '1rem',
            background: 'var(--warning-soft)',
            borderRadius: '8px',
          }}
        >
          <p style={{ color: 'var(--warning)', margin: 0 }}>
            RiskSleeve contract not configured. Please deploy first.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2
          style={{ fontSize: '1.25rem', margin: '0 0 0.5rem', fontWeight: 700 }}
        >
          Risk-Based Liquidity
        </h2>
        <p
          style={{
            color: 'var(--text-secondary)',
            margin: '0 0 1.5rem',
            fontSize: '0.875rem',
          }}
        >
          Allocate your liquidity across different risk tiers for optimized
          yields
        </p>

        <div
          className="grid grid-2"
          style={{ gap: '1rem', marginBottom: '1.5rem' }}
        >
          <div
            style={{
              padding: '1.5rem',
              background: 'var(--surface-hover)',
              borderRadius: '12px',
              textAlign: 'center',
            }}
          >
            <p
              style={{
                fontSize: '0.75rem',
                color: 'var(--text-secondary)',
                margin: 0,
              }}
            >
              Your Total Deposits
            </p>
            <p
              style={{
                fontSize: '1.5rem',
                fontWeight: '700',
                margin: '0.5rem 0',
              }}
            >
              {formatEther(totalUserDeposit)} ETH
            </p>
          </div>

          <div
            style={{
              padding: '1.5rem',
              background: 'var(--surface-hover)',
              borderRadius: '12px',
              textAlign: 'center',
            }}
          >
            <p
              style={{
                fontSize: '0.75rem',
                color: 'var(--text-secondary)',
                margin: 0,
              }}
            >
              Total Pool Value
            </p>
            <p
              style={{
                fontSize: '1.5rem',
                fontWeight: '700',
                margin: '0.5rem 0',
              }}
            >
              {formatEther(totalPoolValue)} ETH
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {TIER_CONFIGS.map((config) => (
            <TierCard
              key={config.tier}
              config={config}
              riskSleeveAddress={riskSleeve}
              userDeposit={deposits[config.tier]}
              totalDeposited={totals[config.tier]}
              isExpanded={expandedTier === config.tier}
              onToggle={() =>
                setExpandedTier(
                  expandedTier === config.tier ? null : config.tier,
                )
              }
            />
          ))}
        </div>
      </div>
    </div>
  )
}
