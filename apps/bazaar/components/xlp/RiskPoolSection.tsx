import { Activity, ChevronDown, ChevronUp, Flame, Shield } from 'lucide-react'
import { useState } from 'react'
import { type Address, formatEther, parseEther } from 'viem'
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'

// Risk tier const matching the contract
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
  icon: typeof Shield
  colorClass: string
  bgClass: string
  expectedApy: string
}

const TIER_CONFIGS: TierConfig[] = [
  {
    tier: RiskTier.CONSERVATIVE,
    name: 'Conservative',
    description: 'Low risk, stable yields. Suitable for long-term holders.',
    icon: Shield,
    colorClass: 'text-green-500',
    bgClass: 'bg-green-500/10',
    expectedApy: '3-5%',
  },
  {
    tier: RiskTier.BALANCED,
    name: 'Balanced',
    description: 'Moderate risk with competitive returns.',
    icon: Activity,
    colorClass: 'text-blue-500',
    bgClass: 'bg-blue-500/10',
    expectedApy: '8-12%',
  },
  {
    tier: RiskTier.AGGRESSIVE,
    name: 'Aggressive',
    description: 'Higher risk, higher potential returns.',
    icon: Flame,
    colorClass: 'text-orange-500',
    bgClass: 'bg-orange-500/10',
    expectedApy: '15-25%',
  },
]

interface RiskPoolCardProps {
  config: TierConfig
  riskSleeveAddress: Address
  userDeposit: bigint
  totalDeposited: bigint
  isExpanded: boolean
  onToggle: () => void
}

function RiskPoolCard({
  config,
  riskSleeveAddress,
  userDeposit,
  totalDeposited,
  isExpanded,
  onToggle,
}: RiskPoolCardProps) {
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
      className={`rounded-lg border-2 transition-all p-4 ${isExpanded ? 'border-primary' : 'border-border'}`}
    >
      <button
        type="button"
        className="cursor-pointer w-full text-left"
        onClick={onToggle}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${config.bgClass}`}>
              <Icon className={`h-5 w-5 ${config.colorClass}`} />
            </div>
            <div>
              <h3 className={`text-lg font-semibold ${config.colorClass}`}>
                {config.name}
              </h3>
              <p className="text-sm text-muted-foreground">
                {config.description}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Expected APY</p>
              <p className={`text-xl font-bold ${config.colorClass}`}>
                {config.expectedApy}
              </p>
            </div>
            {isExpanded ? (
              <ChevronUp className="h-5 w-5" />
            ) : (
              <ChevronDown className="h-5 w-5" />
            )}
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">Your Deposit</p>
              <p className={`text-xl font-bold ${config.colorClass}`}>
                {formatEther(userDeposit)} ETH
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">Total in Pool</p>
              <p className="text-xl font-bold">
                {formatEther(totalDeposited)} ETH
              </p>
            </div>
          </div>

          <form onSubmit={handleDeposit} className="space-y-2">
            <label
              htmlFor={`deposit-eth-${config.tier}`}
              className="text-sm font-medium"
            >
              Deposit ETH
            </label>
            <div className="flex gap-2">
              <input
                id={`deposit-eth-${config.tier}`}
                type="number"
                step="0.01"
                placeholder="0.0"
                value={depositAmount}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setDepositAmount(e.target.value)
                }
                disabled={isLoading}
                className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={isLoading || !depositAmount}
                className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50"
              >
                Deposit
              </button>
            </div>
          </form>

          {userDeposit > 0n && (
            <>
              <form onSubmit={handleWithdraw} className="space-y-2">
                <label
                  htmlFor={`withdraw-eth-${config.tier}`}
                  className="text-sm font-medium"
                >
                  Withdraw ETH
                </label>
                <div className="flex gap-2">
                  <input
                    id={`withdraw-eth-${config.tier}`}
                    type="number"
                    step="0.01"
                    placeholder="0.0"
                    value={withdrawAmount}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setWithdrawAmount(e.target.value)
                    }
                    disabled={isLoading}
                    className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                  />
                  <button
                    type="submit"
                    disabled={isLoading || !withdrawAmount}
                    className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium border border-input bg-transparent disabled:opacity-50"
                  >
                    Withdraw
                  </button>
                </div>
              </form>

              <button
                type="button"
                className="w-full inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50"
                onClick={handleClaimYield}
                disabled={isLoading}
              >
                Claim Yield
              </button>
            </>
          )}

          {isSuccess && (
            <div className="w-full text-center py-2 text-green-500 border border-green-500 rounded-full text-xs font-semibold">
              Transaction successful
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface RiskPoolSectionProps {
  riskSleeveAddress?: Address
}

export default function RiskPoolSection({
  riskSleeveAddress,
}: RiskPoolSectionProps) {
  const { isConnected, address } = useAccount()
  const [expandedTier, setExpandedTier] = useState<RiskTier | null>(null)

  // Fetch user positions for each tier
  const { data: conservativePositionData } = useReadContract({
    address: riskSleeveAddress,
    abi: RISK_SLEEVE_ABI,
    functionName: 'getUserPosition',
    args: address ? [address, RiskTier.CONSERVATIVE] : undefined,
    query: { enabled: !!address && !!riskSleeveAddress },
  })
  const conservativeDeposit = conservativePositionData?.[0] ?? 0n

  const { data: balancedPositionData } = useReadContract({
    address: riskSleeveAddress,
    abi: RISK_SLEEVE_ABI,
    functionName: 'getUserPosition',
    args: address ? [address, RiskTier.BALANCED] : undefined,
    query: { enabled: !!address && !!riskSleeveAddress },
  })
  const balancedDeposit = balancedPositionData?.[0] ?? 0n

  const { data: aggressivePositionData } = useReadContract({
    address: riskSleeveAddress,
    abi: RISK_SLEEVE_ABI,
    functionName: 'getUserPosition',
    args: address ? [address, RiskTier.AGGRESSIVE] : undefined,
    query: { enabled: !!address && !!riskSleeveAddress },
  })
  const aggressiveDeposit = aggressivePositionData?.[0] ?? 0n

  // Fetch sleeve stats for each tier
  const { data: conservativeSleeveData } = useReadContract({
    address: riskSleeveAddress,
    abi: RISK_SLEEVE_ABI,
    functionName: 'getSleeveStats',
    args: [RiskTier.CONSERVATIVE],
    query: { enabled: !!riskSleeveAddress },
  })
  const conservativeTotal = conservativeSleeveData?.[0] ?? 0n

  const { data: balancedSleeveData } = useReadContract({
    address: riskSleeveAddress,
    abi: RISK_SLEEVE_ABI,
    functionName: 'getSleeveStats',
    args: [RiskTier.BALANCED],
    query: { enabled: !!riskSleeveAddress },
  })
  const balancedTotal = balancedSleeveData?.[0] ?? 0n

  const { data: aggressiveSleeveData } = useReadContract({
    address: riskSleeveAddress,
    abi: RISK_SLEEVE_ABI,
    functionName: 'getSleeveStats',
    args: [RiskTier.AGGRESSIVE],
    query: { enabled: !!riskSleeveAddress },
  })
  const aggressiveTotal = aggressiveSleeveData?.[0] ?? 0n

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
      <div className="rounded-lg border p-6">
        <h3 className="text-lg font-semibold mb-2">Risk-Based Liquidity</h3>
        <p className="text-muted-foreground">
          Connect your wallet to manage risk-based liquidity allocations
        </p>
      </div>
    )
  }

  if (!riskSleeveAddress) {
    return (
      <div className="rounded-lg border p-6">
        <h3 className="text-lg font-semibold mb-2">Risk-Based Liquidity</h3>
        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-destructive text-destructive-foreground">
          RiskSleeve contract not configured
        </span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-6">
        <h3 className="text-lg font-semibold mb-1">
          Risk-Based Liquidity Pools
        </h3>
        <p className="text-sm text-muted-foreground mb-6">
          Allocate your liquidity across different risk tiers for optimized
          yields
        </p>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">Your Total Deposits</p>
            <p className="text-2xl font-bold">
              {formatEther(totalUserDeposit)} ETH
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">Total Pool Value</p>
            <p className="text-2xl font-bold">
              {formatEther(totalPoolValue)} ETH
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {TIER_CONFIGS.map((config) => (
            <RiskPoolCard
              key={config.tier}
              config={config}
              riskSleeveAddress={riskSleeveAddress}
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
