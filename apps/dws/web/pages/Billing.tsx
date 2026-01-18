import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  CreditCard,
  DollarSign,
  Download,
  Plus,
  RefreshCw,
  Server,
} from 'lucide-react'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { SkeletonStatCard, SkeletonTable } from '../components/Skeleton'
import { useToast } from '../context/AppContext'
import { useDeposit, useTransactionHistory, useUserAccount } from '../hooks'

export default function BillingPage() {
  const { isConnected, address } = useAccount()
  const { showSuccess, showError } = useToast()
  const { data: account, isLoading: accountLoading, refetch } = useUserAccount()
  const { data: txHistory, isLoading: txLoading } = useTransactionHistory()
  const deposit = useDeposit()

  const [showDepositModal, setShowDepositModal] = useState(false)
  const [depositAmount, setDepositAmount] = useState('0.01')

  const transactions = txHistory?.transactions ?? []

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault()
    const result = await deposit
      .mutateAsync(depositAmount)
      .catch((error: Error) => {
        showError('Deposit failed', error.message)
        return null
      })
    if (result) {
      showSuccess(
        'Deposit successful',
        `Added ${depositAmount} ETH to your balance`,
      )
      setShowDepositModal(false)
      setDepositAmount('0.01')
    }
  }

  const formatEth = (wei: string) => {
    return (parseFloat(wei) / 1e18).toFixed(4)
  }

  return (
    <div>
      <div
        className="page-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <h1 className="page-title">Billing & Usage</h1>
          <p className="page-subtitle">
            Manage your x402 payment balance and view usage
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => refetch()}
          >
            <RefreshCw size={16} /> Refresh
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowDepositModal(true)}
            disabled={!isConnected}
          >
            <Plus size={16} /> Add Credits
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        {accountLoading ? (
          <>
            <SkeletonStatCard />
            <SkeletonStatCard />
            <SkeletonStatCard />
            <SkeletonStatCard />
          </>
        ) : (
          <>
            <div className="stat-card">
              <div className="stat-icon compute">
                <DollarSign size={24} />
              </div>
              <div className="stat-content">
                <div className="stat-label">x402 Balance</div>
                <div className="stat-value">
                  {formatEth(account?.balance ?? '0')} ETH
                </div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon storage">
                <Activity size={24} />
              </div>
              <div className="stat-content">
                <div className="stat-label">Total Spent</div>
                <div className="stat-value">
                  {formatEth(account?.totalSpent ?? '0')} ETH
                </div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon network">
                <CreditCard size={24} />
              </div>
              <div className="stat-content">
                <div className="stat-label">Total Requests</div>
                <div className="stat-value">
                  {parseInt(account?.totalRequests ?? '0', 10).toLocaleString()}
                </div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon ai">
                <Clock size={24} />
              </div>
              <div className="stat-content">
                <div className="stat-label">Tier</div>
                <div className="stat-value">
                  <span
                    className={`badge ${
                      account?.tier === 'premium'
                        ? 'badge-accent'
                        : account?.tier === 'standard'
                          ? 'badge-success'
                          : 'badge-neutral'
                    }`}
                  >
                    {account?.tier ?? 'Free'}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Content Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
          gap: '1.5rem',
        }}
      >
        {/* Recent Transactions */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Activity size={18} /> Recent Transactions
            </h3>
            <button type="button" className="btn btn-ghost btn-sm">
              <Download size={14} /> Export
            </button>
          </div>

          {txLoading ? (
            <SkeletonTable rows={3} columns={3} />
          ) : transactions.length === 0 ? (
            <div className="empty-state" style={{ padding: '2rem' }}>
              <Activity size={32} />
              <h3>No transactions yet</h3>
              <p>Deposit credits to start using DWS services</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {transactions.map((tx) => (
                <div
                  key={tx.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                    padding: '0.75rem',
                    background: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background:
                        tx.type === 'earning'
                          ? 'var(--success-soft)'
                          : tx.type === 'deposit'
                            ? 'var(--accent-soft)'
                            : 'var(--error-soft)',
                    }}
                  >
                    {tx.type === 'earning' ? (
                      <ArrowDownLeft
                        size={18}
                        style={{ color: 'var(--success)' }}
                      />
                    ) : tx.type === 'deposit' ? (
                      <Plus size={18} style={{ color: 'var(--accent)' }} />
                    ) : (
                      <ArrowUpRight
                        size={18}
                        style={{ color: 'var(--error)' }}
                      />
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500 }}>{tx.service}</div>
                    <div
                      style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}
                    >
                      {new Date(tx.timestamp).toLocaleString()}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 500,
                        color:
                          tx.type === 'payment'
                            ? 'var(--error)'
                            : 'var(--success)',
                      }}
                    >
                      {tx.type === 'payment' ? '-' : '+'}
                      {formatEth(tx.amount)} ETH
                    </div>
                    <span
                      className={`badge ${tx.status === 'completed' ? 'badge-success' : 'badge-warning'}`}
                      style={{ fontSize: '0.7rem' }}
                    >
                      {tx.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* x402 Info */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <CreditCard size={18} /> x402 Payments
            </h3>
          </div>
          <div style={{ display: 'grid', gap: '1rem' }}>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              DWS uses the x402 protocol for micropayments. Add credits to your
              balance, and payments are automatically deducted as you use
              services.
            </p>
            <div
              style={{
                padding: '1rem',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-muted)',
                  marginBottom: '0.5rem',
                }}
              >
                Example payment header:
              </div>
              <code
                style={{
                  display: 'block',
                  padding: '0.75rem',
                  background: 'var(--bg-primary)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.8rem',
                  overflow: 'auto',
                }}
              >
                X-Payment: x402-payment address={address?.slice(0, 10)}...
                amount=1000
              </code>
            </div>
          </div>
        </div>

        {/* Provider CTA */}
        <div
          className="card"
          style={{
            background:
              'linear-gradient(135deg, var(--accent-soft) 0%, var(--bg-elevated) 100%)',
            border: '1px solid var(--accent)',
          }}
        >
          <div className="card-header">
            <h3 className="card-title">
              <Server size={18} /> Running Nodes?
            </h3>
          </div>
          <p
            style={{
              color: 'var(--text-secondary)',
              marginBottom: '1rem',
            }}
          >
            View your node earnings, pending rewards, and payout history in the
            Provider section.
          </p>
          <a href="/provider/earnings" className="btn btn-primary">
            <DollarSign size={16} /> View Earnings
          </a>
        </div>
      </div>

      {/* Deposit Modal */}
      {showDepositModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <button
            type="button"
            className="modal-backdrop"
            onClick={() => setShowDepositModal(false)}
            tabIndex={-1}
            aria-label="Close"
          />
          <div className="modal">
            <div className="modal-header">
              <h3 className="modal-title">Add x402 Credits</h3>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setShowDepositModal(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleDeposit}>
              <div className="modal-body">
                <div className="form-group">
                  <label htmlFor="deposit-amount" className="form-label">
                    Amount (ETH)
                  </label>
                  <input
                    id="deposit-amount"
                    className="input"
                    type="number"
                    step="0.001"
                    min="0.001"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    required
                  />
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: '0.5rem',
                  }}
                >
                  {['0.01', '0.05', '0.1', '0.5'].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      className={`btn ${depositAmount === amt ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setDepositAmount(amt)}
                    >
                      {amt} ETH
                    </button>
                  ))}
                </div>
                <div
                  style={{
                    marginTop: '1rem',
                    padding: '1rem',
                    background: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: '0.5rem',
                    }}
                  >
                    <span style={{ color: 'var(--text-muted)' }}>
                      Current Balance
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                      {formatEth(account?.balance ?? '0')} ETH
                    </span>
                  </div>
                  <div
                    style={{ display: 'flex', justifyContent: 'space-between' }}
                  >
                    <span style={{ color: 'var(--text-muted)' }}>
                      After Deposit
                    </span>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--success)',
                      }}
                    >
                      {(
                        parseFloat(formatEth(account?.balance ?? '0')) +
                        parseFloat(depositAmount)
                      ).toFixed(4)}{' '}
                      ETH
                    </span>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowDepositModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={deposit.isPending}
                >
                  {deposit.isPending ? (
                    'Processing...'
                  ) : (
                    <>
                      <Plus size={16} /> Deposit
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
