'use client'

import { useState, useEffect } from 'react'
import { 
  Crown, Brain, TrendingUp, TrendingDown, Clock, 
  CheckCircle, XCircle, AlertTriangle, BarChart3,
  Users, Coins, RefreshCw, ChevronDown, ChevronUp
} from 'lucide-react'
import { 
  fetchCEOStatus, 
  fetchModelCandidates, 
  fetchRecentDecisions,
  type CEOStatus,
  type ModelCandidate,
  type Decision
} from '@/config/api'

interface CEODashboardProps {
  compact?: boolean
}

export function CEODashboard({ compact = false }: CEODashboardProps) {
  const [ceoStatus, setCeoStatus] = useState<CEOStatus | null>(null)
  const [models, setModels] = useState<ModelCandidate[]>([])
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedModel, setExpandedModel] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [status, modelCandidates, recentDecisions] = await Promise.all([
        fetchCEOStatus(),
        fetchModelCandidates(),
        fetchRecentDecisions(10)
      ])
      setCeoStatus(status)
      setModels(modelCandidates)
      setDecisions(recentDecisions)
    } catch (err) {
      console.error('Failed to load CEO data:', err)
    }
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="card-static p-6 animate-pulse">
        <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4" />
        <div className="h-24 bg-gray-200 dark:bg-gray-700 rounded mb-4" />
        <div className="h-48 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    )
  }

  if (compact) {
    return (
      <div className="card-static p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2">
            <Crown className="text-yellow-500" size={18} />
            AI CEO
          </h3>
          <button onClick={loadData} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
            <RefreshCw size={14} />
          </button>
        </div>

        {ceoStatus && (
          <>
            <div className="flex items-center gap-3">
              <Brain size={32} className="text-accent" />
              <div>
                <div className="font-medium">{ceoStatus.currentModel.name}</div>
                <div className="text-xs text-gray-500">{ceoStatus.currentModel.provider}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded">
                <div className="text-lg font-bold text-green-500">
                  {ceoStatus.stats.approvalRate}%
                </div>
                <div className="text-xs text-gray-500">Approval Rate</div>
              </div>
              <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded">
                <div className="text-lg font-bold">
                  {ceoStatus.stats.totalDecisions}
                </div>
                <div className="text-xs text-gray-500">Decisions</div>
              </div>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Crown className="text-yellow-500" size={24} />
          AI CEO Dashboard
        </h2>
        <button 
          onClick={loadData}
          className="btn-secondary text-sm flex items-center gap-2"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Current CEO */}
      {ceoStatus && (
        <div className="card-static p-6">
          <h3 className="text-sm font-medium text-gray-500 mb-4">Current AI CEO</h3>
          
          <div className="flex items-center gap-4 mb-6">
            <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center">
              <Brain size={32} className="text-accent" />
            </div>
            <div>
              <div className="text-xl font-bold">{ceoStatus.currentModel.name}</div>
              <div className="text-sm text-gray-500">
                {ceoStatus.currentModel.provider} • Model ID: {ceoStatus.currentModel.modelId.slice(0, 20)}...
              </div>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              icon={<CheckCircle className="text-green-500" />}
              label="Approval Rate"
              value={`${ceoStatus.stats.approvalRate}%`}
              trend={+2.3}
            />
            <StatCard
              icon={<BarChart3 className="text-blue-500" />}
              label="Total Decisions"
              value={ceoStatus.stats.totalDecisions}
            />
            <StatCard
              icon={<AlertTriangle className="text-yellow-500" />}
              label="Override Rate"
              value={`${ceoStatus.stats.overrideRate}%`}
              trend={-1.5}
              trendGood="down"
            />
            <StatCard
              icon={<TrendingUp className="text-accent" />}
              label="Benchmark Score"
              value={`${ceoStatus.currentModel.benchmarkScore || '92'}%`}
            />
          </div>
        </div>
      )}

      {/* Model Election */}
      <div className="card-static p-6">
        <h3 className="text-sm font-medium text-gray-500 mb-4 flex items-center justify-between">
          Model Election
          <span className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
            {models.length} candidates
          </span>
        </h3>

        {models.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <Brain className="mx-auto mb-2 opacity-50" size={32} />
            <p className="text-sm">No model candidates registered</p>
            <p className="text-xs mt-1">CEOAgent contract may not be deployed</p>
          </div>
        )}

        <div className="space-y-3">
          {models.map((model, index) => (
            <div 
              key={model.modelId}
              className={`border rounded-lg overflow-hidden ${
                index === 0 ? 'border-accent' : 'border-gray-200 dark:border-gray-700'
              }`}
            >
              <button
                onClick={() => setExpandedModel(expandedModel === model.modelId ? null : model.modelId)}
                className="w-full p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {index === 0 && <Crown className="text-yellow-500" size={18} />}
                  <div className="text-left">
                    <div className="font-medium flex items-center gap-2">
                      {model.modelName}
                      {index === 0 && (
                        <span className="text-xs bg-accent text-white px-2 py-0.5 rounded">
                          Current CEO
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">{model.provider}</div>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <div className="font-medium">{model.totalStaked} ETH</div>
                    <div className="text-xs text-gray-500">Staked</div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium">{model.benchmarkScore}%</div>
                    <div className="text-xs text-gray-500">Benchmark</div>
                  </div>
                  {expandedModel === model.modelId ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </div>
              </button>

              {expandedModel === model.modelId && (
                <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-800">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                    <div className="text-center p-3 bg-gray-50 dark:bg-gray-800/50 rounded">
                      <Coins className="mx-auto mb-1 text-yellow-500" size={18} />
                      <div className="text-sm font-medium">{model.totalStaked} ETH</div>
                      <div className="text-xs text-gray-500">Total Staked</div>
                    </div>
                    <div className="text-center p-3 bg-gray-50 dark:bg-gray-800/50 rounded">
                      <Users className="mx-auto mb-1 text-blue-500" size={18} />
                      <div className="text-sm font-medium">{model.totalReputation}</div>
                      <div className="text-xs text-gray-500">Reputation</div>
                    </div>
                    <div className="text-center p-3 bg-gray-50 dark:bg-gray-800/50 rounded">
                      <BarChart3 className="mx-auto mb-1 text-green-500" size={18} />
                      <div className="text-sm font-medium">{model.decisionsCount}</div>
                      <div className="text-xs text-gray-500">Decisions</div>
                    </div>
                    <div className="text-center p-3 bg-gray-50 dark:bg-gray-800/50 rounded">
                      <TrendingUp className="mx-auto mb-1 text-accent" size={18} />
                      <div className="text-sm font-medium">{model.benchmarkScore}%</div>
                      <div className="text-xs text-gray-500">Benchmark</div>
                    </div>
                  </div>

                  <div className="flex gap-3 mt-4">
                    <button className="btn-primary text-sm flex-1">
                      Stake on Model
                    </button>
                    <button className="btn-secondary text-sm">
                      View Details
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <button className="btn-accent text-sm w-full mt-4">
          + Nominate New Model
        </button>
      </div>

      {/* Recent Decisions */}
      <div className="card-static p-6">
        <h3 className="text-sm font-medium text-gray-500 mb-4">Recent Decisions</h3>

        {decisions.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <BarChart3 className="mx-auto mb-2 opacity-50" size={32} />
            <p className="text-sm">No decisions recorded yet</p>
            <p className="text-xs mt-1">Decisions will appear here after CEO review</p>
          </div>
        )}

        <div className="space-y-3">
          {decisions.map((decision) => (
            <div 
              key={decision.decisionId}
              className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg"
            >
              <div className="flex items-center gap-3">
                {decision.approved ? (
                  <CheckCircle className="text-green-500" size={20} />
                ) : (
                  <XCircle className="text-red-500" size={20} />
                )}
                <div>
                  <div className="text-sm font-medium">
                    Proposal {decision.proposalId.slice(0, 10)}...
                  </div>
                  <div className="text-xs text-gray-500 flex items-center gap-2">
                    <Clock size={12} />
                    {formatTimeAgo(decision.decidedAt)}
                    {decision.disputed && (
                      <span className="badge-warning text-xs px-1.5 py-0.5">Disputed</span>
                    )}
                    {decision.overridden && (
                      <span className="badge-error text-xs px-1.5 py-0.5">Overridden</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="text-right">
                <div className="text-sm">
                  <span className="text-gray-500">Confidence:</span>{' '}
                  <span className="font-medium">{decision.confidenceScore}%</span>
                </div>
                <div className="text-xs text-gray-500">
                  Alignment: {decision.alignmentScore}%
                </div>
              </div>
            </div>
          ))}
        </div>

        <button className="btn-secondary text-sm w-full mt-4">
          View All Decisions
        </button>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, trend, trendGood = 'up' }: { icon: React.ReactNode; label: string; value: string | number; trend?: number; trendGood?: 'up' | 'down' }) {
  const good = trend !== undefined && ((trendGood === 'up' && trend > 0) || (trendGood === 'down' && trend < 0))
  return (
    <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
      <div className="flex items-center gap-2 mb-2">{icon}<span className="text-xs text-gray-500">{label}</span></div>
      <div className="text-2xl font-bold">{value}</div>
      {trend !== undefined && (
        <div className={`text-xs flex items-center gap-1 mt-1 ${good ? 'text-green-500' : 'text-red-500'}`}>
          {trend > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {Math.abs(trend)}% vs last month
        </div>
      )}
    </div>
  )
}

const formatTimeAgo = (ts: number): string => {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default CEODashboard
