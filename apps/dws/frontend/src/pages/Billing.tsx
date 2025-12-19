import { useState } from 'react';
import { useAccount } from 'wagmi';
import { CreditCard, RefreshCw, Plus, ArrowUpRight, ArrowDownLeft, DollarSign, Activity, Clock, Download } from 'lucide-react';
import { useUserAccount, useDeposit } from '../hooks';
import type { ViewMode } from '../types';

interface BillingProps {
  viewMode: ViewMode;
}

interface Transaction {
  id: string;
  type: 'deposit' | 'payment' | 'earning';
  amount: string;
  service: string;
  timestamp: number;
  status: 'completed' | 'pending';
}

export default function BillingPage({ viewMode }: BillingProps) {
  const { isConnected, address } = useAccount();
  const { data: account, isLoading: accountLoading, refetch } = useUserAccount();
  const deposit = useDeposit();
  
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [depositAmount, setDepositAmount] = useState('0.01');
  const [transactions] = useState<Transaction[]>([]);

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    await deposit.mutateAsync(depositAmount);
    setShowDepositModal(false);
    setDepositAmount('0.01');
  };

  const formatEth = (wei: string) => {
    return (parseFloat(wei) / 1e18).toFixed(4);
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">
            {viewMode === 'provider' ? 'Earnings & Payouts' : 'Billing & Usage'}
          </h1>
          <p className="page-subtitle">
            {viewMode === 'provider' 
              ? 'Track your earnings and request payouts'
              : 'Manage your x402 credits and view usage'
            }
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-secondary" onClick={() => refetch()}>
            <RefreshCw size={16} /> Refresh
          </button>
          {viewMode === 'consumer' && (
            <button className="btn btn-primary" onClick={() => setShowDepositModal(true)} disabled={!isConnected}>
              <Plus size={16} /> Add Credits
            </button>
          )}
          {viewMode === 'provider' && (
            <button className="btn btn-primary" disabled={!isConnected}>
              <ArrowUpRight size={16} /> Withdraw
            </button>
          )}
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        {viewMode === 'consumer' ? (
          <>
            <div className="stat-card">
              <div className="stat-icon compute"><DollarSign size={24} /></div>
              <div className="stat-content">
                <div className="stat-label">x402 Balance</div>
                <div className="stat-value">
                  {accountLoading ? '—' : `${formatEth(account?.balance ?? '0')} ETH`}
                </div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon storage"><Activity size={24} /></div>
              <div className="stat-content">
                <div className="stat-label">Total Spent</div>
                <div className="stat-value">
                  {accountLoading ? '—' : `${formatEth(account?.totalSpent ?? '0')} ETH`}
                </div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon network"><CreditCard size={24} /></div>
              <div className="stat-content">
                <div className="stat-label">Total Requests</div>
                <div className="stat-value">
                  {accountLoading ? '—' : parseInt(account?.totalRequests ?? '0').toLocaleString()}
                </div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon ai"><Clock size={24} /></div>
              <div className="stat-content">
                <div className="stat-label">Tier</div>
                <div className="stat-value">
                  <span className={`badge ${
                    account?.tier === 'premium' ? 'badge-accent' : 
                    account?.tier === 'standard' ? 'badge-success' : 
                    'badge-neutral'
                  }`}>
                    {account?.tier ?? 'Free'}
                  </span>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="stat-card">
              <div className="stat-icon storage"><DollarSign size={24} /></div>
              <div className="stat-content">
                <div className="stat-label">Total Earnings</div>
                <div className="stat-value">0.00 ETH</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon compute"><ArrowUpRight size={24} /></div>
              <div className="stat-content">
                <div className="stat-label">Pending Payout</div>
                <div className="stat-value">0.00 ETH</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon network"><Activity size={24} /></div>
              <div className="stat-content">
                <div className="stat-label">Requests Served</div>
                <div className="stat-value">0</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon ai"><Clock size={24} /></div>
              <div className="stat-content">
                <div className="stat-label">This Month</div>
                <div className="stat-value">0.00 ETH</div>
              </div>
            </div>
          </>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '1.5rem' }}>
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Activity size={18} /> 
              {viewMode === 'provider' ? 'Recent Earnings' : 'Recent Transactions'}
            </h3>
            <button className="btn btn-ghost btn-sm">
              <Download size={14} /> Export
            </button>
          </div>
          
          {transactions.length === 0 ? (
            <div className="empty-state" style={{ padding: '2rem' }}>
              <Activity size={32} />
              <p>No transactions yet</p>
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
                  <div style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: tx.type === 'earning' ? 'var(--success-soft)' : 
                               tx.type === 'deposit' ? 'var(--accent-soft)' : 
                               'var(--error-soft)',
                  }}>
                    {tx.type === 'earning' ? <ArrowDownLeft size={18} style={{ color: 'var(--success)' }} /> :
                     tx.type === 'deposit' ? <Plus size={18} style={{ color: 'var(--accent)' }} /> :
                     <ArrowUpRight size={18} style={{ color: 'var(--error)' }} />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500 }}>{tx.service}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {new Date(tx.timestamp).toLocaleString()}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ 
                      fontFamily: 'var(--font-mono)', 
                      fontWeight: 500,
                      color: tx.type === 'payment' ? 'var(--error)' : 'var(--success)'
                    }}>
                      {tx.type === 'payment' ? '-' : '+'}{formatEth(tx.amount)} ETH
                    </div>
                    <span className={`badge ${tx.status === 'completed' ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: '0.7rem' }}>
                      {tx.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title"><CreditCard size={18} /> x402 Payments</h3>
          </div>
          <div style={{ display: 'grid', gap: '1rem' }}>
            <div style={{ padding: '1rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                x402 enables micropayments per API request. Credits are deducted automatically when you make requests.
              </div>
            </div>
            <div style={{ padding: '1rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontWeight: 500, marginBottom: '0.5rem' }}>How it works:</div>
              <ol style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', paddingLeft: '1.25rem', display: 'grid', gap: '0.5rem' }}>
                <li>Deposit ETH to your x402 balance</li>
                <li>Make API requests with x402 header</li>
                <li>Credits deducted per request</li>
                <li>No monthly minimums or commitments</li>
              </ol>
            </div>
            <div style={{ padding: '1rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontWeight: 500, marginBottom: '0.5rem' }}>Example header:</div>
              <code style={{ 
                display: 'block', 
                padding: '0.75rem', 
                background: 'var(--bg-primary)', 
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.8rem',
                overflow: 'auto'
              }}>
                X-Payment: x402-payment address={address?.slice(0, 10)}... amount=1000
              </code>
            </div>
          </div>
        </div>
      </div>

      {showDepositModal && (
        <div className="modal-overlay" onClick={() => setShowDepositModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Add x402 Credits</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowDepositModal(false)}>×</button>
            </div>
            <form onSubmit={handleDeposit}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Amount (ETH)</label>
                  <input
                    className="input"
                    type="number"
                    step="0.001"
                    min="0.001"
                    value={depositAmount}
                    onChange={e => setDepositAmount(e.target.value)}
                    required
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
                  {['0.01', '0.05', '0.1', '0.5'].map(amt => (
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
                <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Current Balance</span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{formatEth(account?.balance ?? '0')} ETH</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>After Deposit</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--success)' }}>
                      {(parseFloat(formatEth(account?.balance ?? '0')) + parseFloat(depositAmount || '0')).toFixed(4)} ETH
                    </span>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowDepositModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={deposit.isPending}>
                  {deposit.isPending ? 'Processing...' : <><Plus size={16} /> Deposit</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


