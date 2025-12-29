import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { LoadingSpinner } from '../components/LoadingSpinner'
import {
  useAgent,
  useAgentBalance,
  useExecuteAgent,
  useFundVault,
} from '../hooks'
import { getBotTypeConfig } from '../lib/constants'
import { formatDistanceToNow } from '../lib/utils'

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: agent, isLoading, error } = useAgent(id ?? '')
  const { data: balance } = useAgentBalance(id ?? '')
  const executeAgent = useExecuteAgent()
  const fundVault = useFundVault()
  const [showFundModal, setShowFundModal] = useState(false)
  const [fundAmount, setFundAmount] = useState('')

  const handleExecute = async () => {
    if (!id) return
    try {
      await executeAgent.mutateAsync({ agentId: id })
      toast.success('Agent executed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Execution failed')
    }
  }

  const handleFund = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id || !fundAmount) return
    try {
      const amountWei = (Number(fundAmount) * 1e18).toString()
      await fundVault.mutateAsync({ agentId: id, amount: amountWei })
      toast.success('Vault funded')
      setShowFundModal(false)
      setFundAmount('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Funding failed')
    }
  }

  if (isLoading) {
    return (
      <output className="flex flex-col items-center justify-center py-20">
        <LoadingSpinner size="lg" />
        <p className="mt-4 text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Loading agent
        </p>
      </output>
    )
  }

  if (error || !agent) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20">
        <div className="text-6xl mb-6" role="img" aria-label="Error">
          ⚠️
        </div>
        <h1
          className="text-2xl font-bold mb-3 font-display"
          style={{ color: 'var(--color-error)' }}
        >
          Agent not found
        </h1>
        <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
          {error?.message ??
            'The agent may have been removed or the ID is invalid.'}
        </p>
        <Link to="/agents" className="btn-secondary">
          ← Back to Agents
        </Link>
      </div>
    )
  }

  const botType = getBotTypeConfig(agent.botType)
  const balanceEth = balance ? (Number(balance) / 1e18).toFixed(4) : '0.0000'

  return (
    <div className="max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-6">
        <Link
          to="/agents"
          className="text-sm flex items-center gap-1 hover:underline"
          style={{ color: 'var(--text-tertiary)' }}
        >
          ← Agents
        </Link>
      </nav>

      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-6 mb-8">
        <div className="flex items-center gap-4">
          <div className="text-5xl" role="img" aria-label={botType.label}>
            {botType.icon}
          </div>
          <div>
            <h1
              className="text-2xl sm:text-3xl font-bold mb-2 font-display"
              style={{ color: 'var(--text-primary)' }}
            >
              {agent.name}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <span className={agent.active ? 'badge-success' : 'badge-error'}>
                <span
                  className="w-1.5 h-1.5 rounded-full bg-current"
                  aria-hidden="true"
                />
                {agent.active ? 'Active' : 'Inactive'}
              </span>
              <span className={botType.badgeClass}>{botType.label}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          <Link to={`/chat?character=${id}`} className="btn-secondary">
            Chat
          </Link>
          <button
            type="button"
            onClick={handleExecute}
            disabled={executeAgent.isPending}
            className="btn-primary"
          >
            {executeAgent.isPending ? <LoadingSpinner size="sm" /> : 'Execute'}
          </button>
        </div>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Statistics Card */}
        <section className="card-static p-6" aria-labelledby="stats-heading">
          <h2
            id="stats-heading"
            className="text-lg font-bold mb-5 font-display"
            style={{ color: 'var(--text-primary)' }}
          >
            Activity
          </h2>
          <dl className="space-y-4">
            <div className="flex justify-between items-center">
              <dt style={{ color: 'var(--text-secondary)' }}>Executions</dt>
              <dd
                className="text-xl font-bold tabular-nums"
                style={{ color: 'var(--text-primary)' }}
              >
                {agent.executionCount.toLocaleString()}
              </dd>
            </div>
            <div className="flex justify-between items-center">
              <dt style={{ color: 'var(--text-secondary)' }}>Last Active</dt>
              <dd
                className="font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                {agent.lastExecutedAt > 0
                  ? formatDistanceToNow(agent.lastExecutedAt)
                  : 'Never'}
              </dd>
            </div>
            <div className="flex justify-between items-center">
              <dt style={{ color: 'var(--text-secondary)' }}>Registered</dt>
              <dd
                className="font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                {formatDistanceToNow(agent.registeredAt)}
              </dd>
            </div>
          </dl>
        </section>

        {/* Vault Card */}
        <section className="card-static p-6" aria-labelledby="vault-heading">
          <h2
            id="vault-heading"
            className="text-lg font-bold mb-5 font-display"
            style={{ color: 'var(--text-primary)' }}
          >
            Vault
          </h2>
          <div className="space-y-4">
            <div
              className="p-4 rounded-xl"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <p
                className="text-sm mb-1"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Balance
              </p>
              <p
                className="text-2xl font-bold font-mono"
                style={{ color: 'var(--text-primary)' }}
              >
                {balanceEth} <span className="text-base font-normal">ETH</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowFundModal(true)}
              className="btn-secondary w-full"
            >
              Fund Vault
            </button>
          </div>
        </section>
      </div>

      {showFundModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowFundModal(false)}
          onKeyDown={(e) => e.key === 'Escape' && setShowFundModal(false)}
        >
          <div
            role="document"
            className="card-static p-6 w-full max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <h3
              className="text-lg font-bold mb-4 font-display"
              style={{ color: 'var(--text-primary)' }}
            >
              Fund Vault
            </h3>
            <form onSubmit={handleFund} className="space-y-4">
              <div>
                <label
                  htmlFor="fund-amount"
                  className="block text-sm mb-2"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Amount
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="fund-amount"
                    type="number"
                    step="0.001"
                    min="0"
                    value={fundAmount}
                    onChange={(e) => setFundAmount(e.target.value)}
                    className="input flex-1"
                    required
                  />
                  <span
                    className="text-sm font-mono"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    ETH
                  </span>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowFundModal(false)}
                  className="btn-ghost flex-1"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!fundAmount || fundVault.isPending}
                  className="btn-primary flex-1"
                >
                  {fundVault.isPending ? <LoadingSpinner size="sm" /> : 'Fund'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Addresses Card */}
      <section className="card-static p-6" aria-labelledby="addresses-heading">
        <h2
          id="addresses-heading"
          className="text-lg font-bold mb-5 font-display"
          style={{ color: 'var(--text-primary)' }}
        >
          On-Chain Data
        </h2>
        <dl className="space-y-4">
          <AddressField label="Agent ID" value={agent.agentId} />
          <AddressField label="Owner" value={agent.owner} />
          <AddressField label="Vault" value={agent.vaultAddress} />
          {agent.characterCid && (
            <AddressField label="Character CID" value={agent.characterCid} />
          )}
        </dl>
      </section>
    </div>
  )
}

interface AddressFieldProps {
  label: string
  value: string
}

function AddressField({ label, value }: AddressFieldProps) {
  const handleCopy = () => {
    navigator.clipboard.writeText(value)
  }

  return (
    <div>
      <dt className="text-sm mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </dt>
      <dd className="flex items-center gap-2">
        <code
          className="text-sm font-mono px-3 py-2.5 rounded-lg flex-1 truncate"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-secondary)',
          }}
        >
          {value}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          className="icon-btn flex-shrink-0"
          style={{ backgroundColor: 'var(--bg-secondary)' }}
          aria-label={`Copy ${label}`}
          title="Copy"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
        </button>
      </dd>
    </div>
  )
}
