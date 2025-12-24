import { formatUsd } from '@jejunetwork/shared'
import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Coins,
  Gift,
  Lock,
  TrendingUp,
} from 'lucide-react'
import { useState } from 'react'
import { useAppStore } from '../context/AppContext'
import { formatEther } from '../utils'

export function Staking() {
  const {
    staking,
    services,
    stake,
    unstake,
    claimRewards,
    config,
    updateConfig,
  } = useAppStore()
  const [stakingService, setStakingService] = useState<string | null>(null)
  const [stakeAmount, setStakeAmount] = useState('0.1')
  const [isUnstaking, setIsUnstaking] = useState(false)

  const handleClaim = async (serviceId?: string) => {
    await claimRewards(serviceId)
  }

  const handleClaimAll = async () => {
    await claimRewards()
  }

  const toggleAutoClaim = async () => {
    if (!config) return
    await updateConfig({
      earnings: {
        ...config.earnings,
        auto_claim: !config.earnings.auto_claim,
      },
    })
  }

  const handleStake = async () => {
    if (!stakingService) return
    const amountWei = (parseFloat(stakeAmount) * 1e18).toString()
    await stake(stakingService, amountWei)
    setStakingService(null)
    setStakeAmount('0.1')
  }

  const handleUnstake = async () => {
    if (!stakingService) return
    const amountWei = (parseFloat(stakeAmount) * 1e18).toString()
    await unstake(stakingService, amountWei)
    setStakingService(null)
    setStakeAmount('0.1')
    setIsUnstaking(false)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Staking</h1>
        <p className="text-volcanic-400 mt-1">
          Manage your stakes and claim rewards
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-jeju-600/20">
              <Lock size={20} className="text-jeju-400" />
            </div>
            <div>
              <p className="text-sm text-volcanic-400">Total Staked</p>
              <p className="text-xl font-bold">
                {formatEther(staking?.total_staked_wei || '0')} ETH
              </p>
              <p className="text-xs text-volcanic-500">
                ≈ {formatUsd(staking?.total_staked_usd || 0)}
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-600/20">
              <Gift size={20} className="text-purple-400" />
            </div>
            <div>
              <p className="text-sm text-volcanic-400">Pending Rewards</p>
              <p className="text-xl font-bold text-purple-400">
                {formatEther(staking?.pending_rewards_wei || '0')} ETH
              </p>
              <p className="text-xs text-volcanic-500">
                ≈ {formatUsd(staking?.pending_rewards_usd || 0)}
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-600/20">
                <Clock size={20} className="text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-volcanic-400">Auto-Claim</p>
                <p className="text-sm font-medium">
                  {config?.earnings.auto_claim ? 'Enabled' : 'Disabled'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={toggleAutoClaim}
              className={clsx(
                'relative w-12 h-6 rounded-full transition-colors',
                config?.earnings.auto_claim ? 'bg-jeju-600' : 'bg-volcanic-700',
              )}
            >
              <span
                className={clsx(
                  'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
                  config?.earnings.auto_claim ? 'left-7' : 'left-1',
                )}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Claim All Button */}
      {parseFloat(staking?.pending_rewards_wei || '0') > 0 && (
        <div className="card bg-gradient-to-r from-purple-600/20 to-jeju-600/20 border-purple-500/30">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Claim All Rewards</h3>
              <p className="text-sm text-volcanic-400">
                {formatEther(staking?.pending_rewards_wei || '0')} ETH available
              </p>
            </div>
            <button
              type="button"
              onClick={handleClaimAll}
              className="btn-primary"
            >
              Claim All
            </button>
          </div>
        </div>
      )}

      {/* Stakes by Service */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Stakes by Service</h2>

        <div className="space-y-4">
          {services.map((service) => {
            const stakeInfo = staking?.staked_by_service.find(
              (s) => s.service_id === service.metadata.id,
            )
            const stakedAmount = parseFloat(stakeInfo?.staked_wei || '0')
            const pendingRewards = parseFloat(
              stakeInfo?.pending_rewards_wei || '0',
            )

            return (
              <div
                key={service.metadata.id}
                className="flex items-center justify-between py-4 border-b border-volcanic-800 last:border-0"
              >
                <div className="flex items-center gap-4">
                  <div
                    className={clsx(
                      'w-10 h-10 rounded-xl flex items-center justify-center',
                      stakedAmount > 0 ? 'bg-jeju-600/20' : 'bg-volcanic-800',
                    )}
                  >
                    <Coins
                      size={20}
                      className={
                        stakedAmount > 0 ? 'text-jeju-400' : 'text-volcanic-500'
                      }
                    />
                  </div>

                  <div>
                    <h3 className="font-medium">{service.metadata.name}</h3>
                    <div className="flex items-center gap-4 text-sm text-volcanic-400">
                      <span>Min: {service.metadata.min_stake_eth} ETH</span>
                      {stakedAmount > 0 && (
                        <span className="text-jeju-400">
                          Staked: {formatEther(stakeInfo?.staked_wei || '0')}{' '}
                          ETH
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {pendingRewards > 0 && (
                    <div className="text-right mr-4">
                      <p className="text-sm text-volcanic-400">Rewards</p>
                      <p className="font-medium text-purple-400">
                        {formatEther(stakeInfo?.pending_rewards_wei || '0')} ETH
                      </p>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setStakingService(service.metadata.id)
                      setIsUnstaking(false)
                    }}
                    className="btn-secondary"
                  >
                    Stake
                  </button>

                  {stakedAmount > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setStakingService(service.metadata.id)
                          setIsUnstaking(true)
                        }}
                        className="btn-ghost"
                      >
                        Unstake
                      </button>
                      {pendingRewards > 0 && (
                        <button
                          type="button"
                          onClick={() => handleClaim(service.metadata.id)}
                          className="btn-primary"
                        >
                          Claim
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Zero-to-Hero Path */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <TrendingUp size={18} className="text-jeju-400" />
          Zero-to-Hero Path
        </h2>

        <div className="space-y-4">
          <p className="text-sm text-volcanic-400">
            Start with no money and work your way up. Run free services first,
            earn enough to stake, then unlock more profitable services.
          </p>

          <div className="space-y-2">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-volcanic-800/50">
              <CheckCircle size={18} className="text-jeju-400" />
              <div className="flex-1">
                <p className="text-sm font-medium">
                  Step 1: Cron Executor (Free)
                </p>
                <p className="text-xs text-volcanic-500">
                  No stake required, ~$0.05/hr
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-volcanic-800/50">
              <div className="w-4 h-4 rounded-full border-2 border-volcanic-600" />
              <div className="flex-1">
                <p className="text-sm font-medium">
                  Step 2: Proxy Node (0.1 ETH)
                </p>
                <p className="text-xs text-volcanic-500">
                  Low stake, ~$0.15/hr
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-volcanic-800/50">
              <div className="w-4 h-4 rounded-full border-2 border-volcanic-600" />
              <div className="flex-1">
                <p className="text-sm font-medium">
                  Step 3: Storage/Compute (0.1 ETH + hardware)
                </p>
                <p className="text-xs text-volcanic-500">
                  Requires GPU or storage, ~$0.50/hr
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-volcanic-800/50">
              <div className="w-4 h-4 rounded-full border-2 border-volcanic-600" />
              <div className="flex-1">
                <p className="text-sm font-medium">
                  Step 4: XLP/Solver (0.5-1 ETH)
                </p>
                <p className="text-xs text-volcanic-500">
                  Higher stake, higher rewards, ~$0.40/hr
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stake/Unstake Modal */}
      <AnimatePresence>
        {stakingService && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-volcanic-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setStakingService(null)}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="card max-w-md w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-xl font-bold mb-4">
                {isUnstaking ? 'Unstake from' : 'Stake on'}{' '}
                {
                  services.find((s) => s.metadata.id === stakingService)
                    ?.metadata.name
                }
              </h2>

              <div className="space-y-4">
                <div>
                  <label htmlFor="stake-amount" className="label">
                    Amount (ETH)
                  </label>
                  <input
                    id="stake-amount"
                    type="number"
                    value={stakeAmount}
                    onChange={(e) => setStakeAmount(e.target.value)}
                    className="input"
                    step="0.01"
                    min="0"
                  />
                </div>

                {!isUnstaking && (
                  <div className="bg-volcanic-800/50 rounded-lg p-3 text-sm text-volcanic-400">
                    <p>
                      Minimum stake:{' '}
                      {
                        services.find((s) => s.metadata.id === stakingService)
                          ?.metadata.min_stake_eth
                      }{' '}
                      ETH
                    </p>
                  </div>
                )}

                {isUnstaking && (
                  <div className="flex items-start gap-2 text-sm text-yellow-400 bg-yellow-500/10 rounded-lg p-3">
                    <AlertTriangle size={16} className="mt-0.5" />
                    <p>
                      Unstaking may have a cooldown period. Check the service
                      requirements.
                    </p>
                  </div>
                )}
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setStakingService(null)}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={isUnstaking ? handleUnstake : handleStake}
                  className={clsx(
                    'flex-1',
                    isUnstaking ? 'btn-danger' : 'btn-primary',
                  )}
                >
                  {isUnstaking ? 'Unstake' : 'Stake'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
