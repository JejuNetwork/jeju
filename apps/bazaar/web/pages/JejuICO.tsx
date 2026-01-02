/**
 * JEJU ICO Page
 *
 * Token sale page with real ICOPresale contract integration.
 * Shows presale status, allows contributions, and handles claims/refunds.
 */

import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { formatEther, parseEther } from 'viem'
import { useAccount, useBalance } from 'wagmi'
import { Grid, InfoCard, PageHeader, StatCard } from '../components/ui'
import { useICOPresale, useJejuICOAddress } from '../hooks/useICOPresale'

function formatProgress(bps: bigint): string {
  return `${(Number(bps) / 100).toFixed(1)}%`
}

function formatTimeRemaining(seconds: bigint): string {
  const s = Number(seconds)
  if (s <= 0) return 'Ended'
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const mins = Math.floor((s % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

function formatDuration(seconds: bigint): string {
  const s = Number(seconds)
  const days = Math.floor(s / 86400)
  if (days > 0) return `${days} days`
  const hours = Math.floor(s / 3600)
  return `${hours} hours`
}

export default function JejuICOPage() {
  const { address, isConnected } = useAccount()
  const { data: ethBalance } = useBalance({ address })
  const icoAddress = useJejuICOAddress()
  const {
    status,
    config,
    contribution,
    isLoading,
    isPending,
    contribute,
    claim,
    refund,
  } = useICOPresale(icoAddress)

  const [amount, setAmount] = useState('')

  const handleContribute = async () => {
    if (!amount) return
    await contribute(amount)
    setAmount('')
  }

  const handleSetMax = () => {
    if (ethBalance) {
      // Leave 0.01 ETH for gas
      const max = ethBalance.value - parseEther('0.01')
      if (max > 0n) {
        setAmount(formatEther(max))
      }
    }
  }

  // Calculate token allocation for current amount
  const tokenAllocation =
    amount && config?.presalePrice
      ? (parseEther(amount) * 10n ** 18n) / config.presalePrice
      : 0n

  // No ICO deployed yet
  if (!icoAddress) {
    return (
      <div className="max-w-2xl mx-auto animate-fade-in">
        <PageHeader
          icon="🏝️"
          title="JEJU Token Sale"
          description="Governance and utility token for the Jeju Network"
        />

        <div className="card p-6 mb-6">
          <div className="text-center mb-6">
            <div className="text-6xl mb-4 animate-float">🏝️</div>
            <h2 className="text-2xl font-bold text-primary mb-2">JEJU Token</h2>
            <p className="text-secondary">
              The native token powering the Jeju Network ecosystem
            </p>
          </div>

          <InfoCard variant="info" className="mb-6">
            <p className="font-medium">Token Sale Not Yet Deployed</p>
            <p className="text-sm opacity-80">
              The JEJU token sale contract has not been deployed yet. Check back
              soon or read the whitepaper for more details about the token
              economics and distribution.
            </p>
          </InfoCard>

          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-surface-secondary">
              <h3 className="font-medium text-primary mb-3">Token Utility</h3>
              <ul className="space-y-2 text-sm text-secondary">
                <li className="flex items-center gap-2">
                  <span className="text-success">✓</span>
                  Governance voting on network proposals
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-success">✓</span>
                  Staking rewards for validators and delegators
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-success">✓</span>
                  Fee discounts on DWS services
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-success">✓</span>
                  Access to premium marketplace features
                </li>
              </ul>
            </div>

            <Link
              to="/coins/jeju-ico/whitepaper"
              className="btn-primary w-full py-3 text-center block"
            >
              Read Whitepaper
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto animate-fade-in">
        <PageHeader
          icon="🏝️"
          title="JEJU Token Sale"
          description="Loading presale information..."
        />
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary-color" />
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      <PageHeader
        icon="🏝️"
        title="JEJU Token Sale"
        description="Participate in the JEJU token presale"
      />

      {/* Status Cards */}
      <Grid cols={4} className="mb-6">
        <StatCard
          icon="💰"
          label="Raised"
          value={`${Number(formatEther(status?.raised ?? 0n)).toFixed(2)} ETH`}
        />
        <StatCard
          icon="👥"
          label="Participants"
          value={String(status?.participants ?? 0n)}
        />
        <StatCard
          icon="📊"
          label="Progress"
          value={formatProgress(status?.progress ?? 0n)}
        />
        <StatCard
          icon="⏱️"
          label="Time Left"
          value={formatTimeRemaining(status?.timeRemaining ?? 0n)}
        />
      </Grid>

      {/* Progress Bar */}
      <div className="card p-6 mb-6">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-tertiary">Progress to Hard Cap</span>
          <span className="text-primary font-medium">
            {formatProgress(status?.progress ?? 0n)}
          </span>
        </div>
        <div className="h-4 rounded-full bg-surface-secondary overflow-hidden">
          <div
            className="h-full bg-gradient-warm transition-all duration-500"
            style={{
              width: `${Math.min(100, Number(status?.progress ?? 0n) / 100)}%`,
            }}
          />
        </div>
        <div className="flex justify-between text-xs text-tertiary mt-2">
          <span>Soft Cap: {formatEther(config?.softCap ?? 0n)} ETH</span>
          <span>Hard Cap: {formatEther(config?.hardCap ?? 0n)} ETH</span>
        </div>
      </div>

      {/* Sale Status Messages */}
      {status?.isFailed && (
        <InfoCard variant="error" className="mb-6">
          <p className="font-medium">Presale Failed</p>
          <p className="text-sm opacity-80">
            The soft cap was not reached. You can claim a refund for your
            contribution.
          </p>
        </InfoCard>
      )}

      {status?.isFinalized && !status.isFailed && (
        <InfoCard variant="success" className="mb-6">
          <p className="font-medium">Presale Successful!</p>
          <p className="text-sm opacity-80">
            The presale has concluded successfully. Liquidity has been added and
            locked. You can claim your tokens below.
          </p>
        </InfoCard>
      )}

      {!status?.isActive && !status?.isFinalized && (
        <InfoCard variant="warning" className="mb-6">
          <p className="font-medium">Presale Not Active</p>
          <p className="text-sm opacity-80">
            The presale has not started yet or has ended. Check back soon!
          </p>
        </InfoCard>
      )}

      {/* Contribution Form */}
      {status?.isActive && (
        <div className="card p-6 mb-6">
          <h2 className="text-lg font-bold text-primary mb-4">Contribute</h2>

          <div className="mb-4">
            <div className="flex justify-between text-sm mb-2">
              <label htmlFor="contribution-amount" className="text-tertiary">
                Amount (ETH)
              </label>
              <button
                type="button"
                onClick={handleSetMax}
                className="text-primary-color hover:underline text-xs"
              >
                Max:{' '}
                {ethBalance
                  ? Number(formatEther(ethBalance.value)).toFixed(4)
                  : '0'}{' '}
                ETH
              </button>
            </div>
            <input
              id="contribution-amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              step="0.01"
              min="0"
              className="input text-xl font-semibold"
            />
          </div>

          {amount && tokenAllocation > 0n && (
            <div className="p-4 rounded-xl bg-surface-secondary mb-4 animate-fade-in">
              <div className="flex justify-between">
                <span className="text-tertiary">You will receive</span>
                <span className="font-semibold text-primary">
                  ~{Number(formatEther(tokenAllocation)).toLocaleString()} JEJU
                </span>
              </div>
              <div className="flex justify-between text-sm mt-1">
                <span className="text-tertiary">Price</span>
                <span className="text-secondary">
                  {formatEther(config?.presalePrice ?? 0n)} ETH per JEJU
                </span>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={handleContribute}
            disabled={!isConnected || !amount || isPending}
            className="btn-primary w-full py-4 text-lg"
          >
            {!isConnected
              ? 'Connect Wallet'
              : isPending
                ? 'Confirming...'
                : 'Contribute'}
          </button>
        </div>
      )}

      {/* User Contribution */}
      {contribution && contribution.ethAmount > 0n && (
        <div className="card p-6 mb-6">
          <h2 className="text-lg font-bold text-primary mb-4">
            Your Contribution
          </h2>

          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-tertiary">ETH Contributed</span>
              <span className="font-medium text-primary">
                {formatEther(contribution.ethAmount)} ETH
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-tertiary">Token Allocation</span>
              <span className="font-medium text-primary">
                {Number(
                  formatEther(contribution.tokenAllocation),
                ).toLocaleString()}{' '}
                JEJU
              </span>
            </div>
            {contribution.claimedTokens > 0n && (
              <div className="flex justify-between">
                <span className="text-tertiary">Already Claimed</span>
                <span className="font-medium text-success">
                  {Number(
                    formatEther(contribution.claimedTokens),
                  ).toLocaleString()}{' '}
                  JEJU
                </span>
              </div>
            )}
          </div>

          {/* Claim Button */}
          {status?.isFinalized &&
            !status.isFailed &&
            contribution.claimable > 0n && (
              <button
                type="button"
                onClick={claim}
                disabled={isPending}
                className="btn-primary w-full py-3 mt-4"
              >
                {isPending
                  ? 'Claiming...'
                  : `Claim ${Number(formatEther(contribution.claimable)).toLocaleString()} JEJU`}
              </button>
            )}

          {/* Refund Button */}
          {status?.isFailed && !contribution.isRefunded && (
            <button
              type="button"
              onClick={refund}
              disabled={isPending}
              className="btn-secondary w-full py-3 mt-4"
            >
              {isPending
                ? 'Processing...'
                : `Refund ${formatEther(contribution.ethAmount)} ETH`}
            </button>
          )}

          {contribution.isRefunded && (
            <p className="text-center text-success mt-4">
              ✓ Refund claimed successfully
            </p>
          )}
        </div>
      )}

      {/* Presale Info */}
      <div className="card p-6">
        <h2 className="text-lg font-bold text-primary mb-4">Presale Details</h2>

        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="text-tertiary">Token Price</span>
            <span className="text-primary">
              {config ? formatEther(config.presalePrice) : '—'} ETH
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-tertiary">LP Funding</span>
            <span className="text-primary">
              {config ? `${Number(config.lpFundingBps) / 100}%` : '—'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-tertiary">LP Lock Duration</span>
            <span className="text-primary">
              {config ? formatDuration(config.lpLockDuration) : '—'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-tertiary">Token Claim Lock</span>
            <span className="text-primary">
              {config ? formatDuration(config.buyerLockDuration) : '—'}
            </span>
          </div>
        </div>

        <div
          className="mt-6 pt-4 border-t"
          style={{ borderColor: 'var(--border)' }}
        >
          <Link
            to="/coins/jeju-ico/whitepaper"
            className="btn-secondary w-full py-3 text-center block"
          >
            Read Whitepaper
          </Link>
        </div>
      </div>
    </div>
  )
}
