import { useCallback, useEffect, useState } from 'react'
import { AUTOCRAT_API_URL } from '../../config/env'

interface FeeStats {
  registeredApps: number
  feeSplit: {
    apps: string
    liquidityProviders: string
    contributors: string
    network: string
  }
  totalDistributed: string
  totalAppEarnings: string
  totalLPEarnings: string
  totalContributorEarnings: string
  contributorPoolBalance: string
}

interface AppInfo {
  appId: string
  name: string
  description: string
  primaryContract: string
  feeRecipient: string
  isActive: boolean
  isVerified: boolean
  createdAt: number
  stats: {
    totalTransactions: string
    totalFeesEarned: string
    totalFeesClaimed: string
    lastClaimAt: number
  }
}

export function FeesTab({ daoId }: { daoId: string }) {
  const [stats, setStats] = useState<FeeStats | null>(null)
  const [apps, setApps] = useState<AppInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showRegister, setShowRegister] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [statsRes, appsRes] = await Promise.all([
        fetch(`${AUTOCRAT_API_URL}/apps/stats`),
        fetch(`${AUTOCRAT_API_URL}/apps?daoId=${daoId}`),
      ])

      const statsData = await statsRes.json()
      const appsData = await appsRes.json()

      if (statsData.success) {
        setStats(statsData)
      }
      if (appsData.success) {
        setApps(appsData.apps || [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch fee data')
    } finally {
      setLoading(false)
    }
  }, [daoId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Fee Distribution Overview */}
      <div className="bg-zinc-900 rounded-xl p-6 border border-zinc-800">
        <h3 className="text-lg font-semibold text-white mb-4">
          Fee Distribution
        </h3>
        <p className="text-sm text-zinc-400 mb-4">
          Jeju takes 0% of network fees. All fees go to apps and community.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-zinc-800/50 rounded-lg p-4">
            <div className="text-2xl font-bold text-purple-400">
              {stats?.feeSplit.apps || '45%'}
            </div>
            <div className="text-sm text-zinc-400">App Developers</div>
          </div>
          <div className="bg-zinc-800/50 rounded-lg p-4">
            <div className="text-2xl font-bold text-blue-400">
              {stats?.feeSplit.liquidityProviders || '45%'}
            </div>
            <div className="text-sm text-zinc-400">Liquidity Providers</div>
          </div>
          <div className="bg-zinc-800/50 rounded-lg p-4">
            <div className="text-2xl font-bold text-green-400">
              {stats?.feeSplit.contributors || '10%'}
            </div>
            <div className="text-sm text-zinc-400">Contributors</div>
          </div>
          <div className="bg-zinc-800/50 rounded-lg p-4">
            <div className="text-2xl font-bold text-zinc-500">
              {stats?.feeSplit.network || '0%'}
            </div>
            <div className="text-sm text-zinc-400">Network</div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <div className="text-sm text-zinc-500">Total Distributed</div>
            <div className="text-lg font-mono text-white">
              {stats?.totalDistributed || '0'} ETH
            </div>
          </div>
          <div>
            <div className="text-sm text-zinc-500">App Earnings</div>
            <div className="text-lg font-mono text-purple-400">
              {stats?.totalAppEarnings || '0'} ETH
            </div>
          </div>
          <div>
            <div className="text-sm text-zinc-500">LP Earnings</div>
            <div className="text-lg font-mono text-blue-400">
              {stats?.totalLPEarnings || '0'} ETH
            </div>
          </div>
          <div>
            <div className="text-sm text-zinc-500">Contributor Pool</div>
            <div className="text-lg font-mono text-green-400">
              {stats?.contributorPoolBalance || '0'} ETH
            </div>
          </div>
          <div>
            <div className="text-sm text-zinc-500">Registered Apps</div>
            <div className="text-lg font-mono text-white">
              {stats?.registeredApps || 0}
            </div>
          </div>
        </div>
      </div>

      {/* DAO Apps */}
      <div className="bg-zinc-900 rounded-xl p-6 border border-zinc-800">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">DAO Apps</h3>
          <button
            type="button"
            onClick={() => setShowRegister(!showRegister)}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Register App
          </button>
        </div>

        {showRegister && (
          <AppRegistrationForm daoId={daoId} onSuccess={fetchData} />
        )}

        {apps.length === 0 ? (
          <div className="text-center py-8 text-zinc-500">
            <p>No apps registered for this DAO yet.</p>
            <p className="text-sm mt-2">
              Register your app to start earning fees from transactions.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {apps.map((app) => (
              <AppCard key={app.appId} app={app} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AppCard({ app }: { app: AppInfo }) {
  const unclaimedFees =
    Number.parseFloat(app.stats.totalFeesEarned) -
    Number.parseFloat(app.stats.totalFeesClaimed)

  return (
    <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="font-medium text-white">{app.name}</h4>
            {app.isVerified && (
              <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full">
                Verified
              </span>
            )}
            {!app.isActive && (
              <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-xs rounded-full">
                Inactive
              </span>
            )}
          </div>
          <p className="text-sm text-zinc-400 mt-1">{app.description}</p>
          <div className="flex items-center gap-4 mt-2 text-xs text-zinc-500">
            <span>Contract: {app.primaryContract.slice(0, 10)}...</span>
            <span>
              Created: {new Date(app.createdAt * 1000).toLocaleDateString()}
            </span>
          </div>
        </div>

        <div className="text-right">
          <div className="text-sm text-zinc-500">Total Earned</div>
          <div className="font-mono text-purple-400">
            {app.stats.totalFeesEarned} ETH
          </div>
          {unclaimedFees > 0 && (
            <div className="text-xs text-green-400 mt-1">
              {unclaimedFees.toFixed(4)} ETH unclaimed
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 mt-4 pt-4 border-t border-zinc-700">
        <div>
          <div className="text-xs text-zinc-500">Transactions</div>
          <div className="font-mono text-white">
            {app.stats.totalTransactions}
          </div>
        </div>
        <div>
          <div className="text-xs text-zinc-500">Claimed</div>
          <div className="font-mono text-white">
            {app.stats.totalFeesClaimed} ETH
          </div>
        </div>
        <div className="flex-1" />
        {unclaimedFees > 0 && (
          <button
            type="button"
            className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-medium transition-colors"
          >
            Claim Fees
          </button>
        )}
      </div>
    </div>
  )
}

function AppRegistrationForm({
  daoId,
  onSuccess,
}: {
  daoId: string
  onSuccess: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [primaryContract, setPrimaryContract] = useState('')
  const [feeRecipient, setFeeRecipient] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      // Note: This would need wallet connection to actually submit
      // For now, just show the form structure
      console.log('Would register app:', {
        name,
        description,
        primaryContract,
        feeRecipient,
        daoId,
      })

      // Show success message - in real implementation this would call the contract
      setSuccess(true)
      setTimeout(() => {
        onSuccess()
        setSuccess(false)
        setName('')
        setDescription('')
        setPrimaryContract('')
        setFeeRecipient('')
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-zinc-800/50 rounded-lg p-4 mb-4 border border-zinc-700"
    >
      <h4 className="font-medium text-white mb-4">Register New App</h4>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded text-green-400 text-sm">
          App registration requires wallet connection. Connect your wallet to
          complete registration.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="app-name"
            className="block text-sm text-zinc-400 mb-1"
          >
            App Name
          </label>
          <input
            id="app-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My DApp"
            className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500"
            required
          />
        </div>

        <div>
          <label
            htmlFor="primary-contract"
            className="block text-sm text-zinc-400 mb-1"
          >
            Primary Contract
          </label>
          <input
            id="primary-contract"
            type="text"
            value={primaryContract}
            onChange={(e) => setPrimaryContract(e.target.value)}
            placeholder="0x..."
            className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-white font-mono text-sm placeholder-zinc-500 focus:outline-none focus:border-purple-500"
            required
          />
        </div>

        <div>
          <label
            htmlFor="fee-recipient"
            className="block text-sm text-zinc-400 mb-1"
          >
            Fee Recipient
          </label>
          <input
            id="fee-recipient"
            type="text"
            value={feeRecipient}
            onChange={(e) => setFeeRecipient(e.target.value)}
            placeholder="0x... (treasury or multisig)"
            className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-white font-mono text-sm placeholder-zinc-500 focus:outline-none focus:border-purple-500"
            required
          />
        </div>

        <div className="md:col-span-2">
          <label
            htmlFor="app-description"
            className="block text-sm text-zinc-400 mb-1"
          >
            Description
          </label>
          <textarea
            id="app-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does your app do?"
            rows={2}
            className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500"
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 mt-4">
        <button
          type="button"
          onClick={() => {
            setName('')
            setDescription('')
            setPrimaryContract('')
            setFeeRecipient('')
          }}
          className="px-4 py-2 text-zinc-400 hover:text-white transition-colors"
        >
          Clear
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-800 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
        >
          {submitting ? 'Registering...' : 'Register App'}
        </button>
      </div>
    </form>
  )
}
