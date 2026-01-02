import {
  AlertTriangle,
  BarChart3,
  Brain,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  Coins,
  Crown,
  Plus,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Users,
  X,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  type Decision,
  type DirectorStatus,
  fetchDirectorStatus,
  fetchModelCandidates,
  fetchRecentDecisions,
  type ModelCandidate,
  type NominateModelRequest,
  nominateModel,
} from '../config/api'

// Available providers for nomination
const INFERENCE_PROVIDERS = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    models: ['claude-opus-4-5', 'claude-sonnet-4-5'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    models: ['gpt-5.2'],
  },
  {
    id: 'google',
    name: 'Google',
    models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash'],
  },
  {
    id: 'groq',
    name: 'Groq',
    models: ['llama-3.3-70b', 'mixtral-8x7b', 'gemma-7b'],
  },
  {
    id: 'together',
    name: 'Together AI',
    models: ['llama-3.2-90b', 'qwen-72b', 'deepseek-v3'],
  },
  { id: 'cerebras', name: 'Cerebras', models: ['llama-3.3-70b'] },
  { id: 'openrouter', name: 'OpenRouter', models: ['auto'] },
] as const

interface DirectorDashboardProps {
  compact?: boolean
}

export function DirectorDashboard({ compact = false }: DirectorDashboardProps) {
  const [directorStatus, setDirectorStatus] = useState<DirectorStatus | null>(
    null,
  )
  const [models, setModels] = useState<ModelCandidate[]>([])
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [expandedModel, setExpandedModel] = useState<string | null>(null)
  const [showNominateModal, setShowNominateModal] = useState(false)
  const [nominating, setNominating] = useState(false)
  const [nominateError, setNominateError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [status, modelCandidates, recentDecisions] = await Promise.all([
        fetchDirectorStatus(),
        fetchModelCandidates(),
        fetchRecentDecisions(10),
      ])
      setDirectorStatus(status)
      setModels(modelCandidates)
      setDecisions(recentDecisions)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load Director data'
      setLoadError(message)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleNominate = async (request: NominateModelRequest) => {
    setNominating(true)
    setNominateError(null)
    try {
      await nominateModel(request)
      setShowNominateModal(false)
      await loadData()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to nominate model'
      setNominateError(message)
    }
    setNominating(false)
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

  if (loadError) {
    return (
      <div className="card-static p-6">
        <div className="text-center">
          <div className="text-red-500 mb-2">Failed to load Director data</div>
          <p className="text-sm text-gray-500 mb-4">{loadError}</p>
          <button
            type="button"
            onClick={loadData}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (compact) {
    return (
      <div className="card-static p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2">
            <Crown className="text-yellow-500" size={18} />
            AI Director
          </h3>
          <button
            type="button"
            onClick={loadData}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {directorStatus && (
          <>
            <div className="flex items-center gap-3">
              <Brain size={32} className="text-accent" />
              <div>
                <div className="font-medium">
                  {directorStatus.currentModel.name}
                </div>
                <div className="text-xs text-gray-500">
                  {directorStatus.currentModel.provider}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded">
                <div className="text-lg font-bold text-green-500">
                  {directorStatus.stats.approvalRate}
                </div>
                <div className="text-xs text-gray-500">Approval Rate</div>
              </div>
              <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded">
                <div className="text-lg font-bold">
                  {directorStatus.stats.totalDecisions}
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
          AI Director Dashboard
        </h2>
        <button
          type="button"
          onClick={loadData}
          className="btn-secondary text-sm flex items-center gap-2"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Current Director */}
      {directorStatus && (
        <div className="card-static p-6">
          <h3 className="text-sm font-medium text-gray-500 mb-4">
            Current AI Director
          </h3>

          <div className="flex items-center gap-4 mb-6">
            <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center">
              <Brain size={32} className="text-accent" />
            </div>
            <div>
              <div className="text-xl font-bold">
                {directorStatus.currentModel.name}
              </div>
              <div className="text-sm text-gray-500">
                {directorStatus.currentModel.provider} • Model ID:{' '}
                {directorStatus.currentModel.modelId.slice(0, 20)}...
              </div>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              icon={<CheckCircle className="text-green-500" />}
              label="Approval Rate"
              value={directorStatus.stats.approvalRate}
              trend={+2.3}
            />
            <StatCard
              icon={<BarChart3 className="text-blue-500" />}
              label="Total Decisions"
              value={directorStatus.stats.totalDecisions}
            />
            <StatCard
              icon={<AlertTriangle className="text-yellow-500" />}
              label="Override Rate"
              value={directorStatus.stats.overrideRate}
              trend={-1.5}
              trendGood="down"
            />
            <StatCard
              icon={<TrendingUp className="text-accent" />}
              label="Benchmark Score"
              value={
                directorStatus.currentModel.benchmarkScore
                  ? `${directorStatus.currentModel.benchmarkScore}%`
                  : 'N/A'
              }
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
            <p className="text-sm">No model candidates registered yet</p>
            <p className="text-xs mt-1">
              Nominate AI models to participate in Director election
            </p>
          </div>
        )}

        <div className="space-y-3">
          {models.map((model, index) => (
            <div
              key={model.modelId}
              className={`border rounded-lg overflow-hidden ${
                index === 0
                  ? 'border-accent'
                  : 'border-gray-200 dark:border-gray-700'
              }`}
            >
              <button
                type="button"
                onClick={() =>
                  setExpandedModel(
                    expandedModel === model.modelId ? null : model.modelId,
                  )
                }
                className="w-full p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {index === 0 && (
                    <Crown className="text-yellow-500" size={18} />
                  )}
                  <div className="text-left">
                    <div className="font-medium flex items-center gap-2">
                      {model.modelName}
                      {index === 0 && (
                        <span className="text-xs bg-accent text-white px-2 py-0.5 rounded">
                          Current Director
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">
                      {model.provider}
                    </div>
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
                  {expandedModel === model.modelId ? (
                    <ChevronUp size={18} />
                  ) : (
                    <ChevronDown size={18} />
                  )}
                </div>
              </button>

              {expandedModel === model.modelId && (
                <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-800">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                    <div className="text-center p-3 bg-gray-50 dark:bg-gray-800/50 rounded">
                      <Coins
                        className="mx-auto mb-1 text-yellow-500"
                        size={18}
                      />
                      <div className="text-sm font-medium">
                        {model.totalStaked} ETH
                      </div>
                      <div className="text-xs text-gray-500">Total Staked</div>
                    </div>
                    <div className="text-center p-3 bg-gray-50 dark:bg-gray-800/50 rounded">
                      <Users className="mx-auto mb-1 text-blue-500" size={18} />
                      <div className="text-sm font-medium">
                        {model.totalReputation}
                      </div>
                      <div className="text-xs text-gray-500">Reputation</div>
                    </div>
                    <div className="text-center p-3 bg-gray-50 dark:bg-gray-800/50 rounded">
                      <BarChart3
                        className="mx-auto mb-1 text-green-500"
                        size={18}
                      />
                      <div className="text-sm font-medium">
                        {model.decisionsCount}
                      </div>
                      <div className="text-xs text-gray-500">Decisions</div>
                    </div>
                    <div className="text-center p-3 bg-gray-50 dark:bg-gray-800/50 rounded">
                      <TrendingUp
                        className="mx-auto mb-1 text-accent"
                        size={18}
                      />
                      <div className="text-sm font-medium">
                        {model.benchmarkScore}%
                      </div>
                      <div className="text-xs text-gray-500">Benchmark</div>
                    </div>
                  </div>

                  <div className="flex gap-3 mt-4">
                    <button
                      type="button"
                      className="btn-primary text-sm flex-1"
                    >
                      Stake on Model
                    </button>
                    <button type="button" className="btn-secondary text-sm">
                      View Details
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setShowNominateModal(true)}
          className="btn-accent text-sm w-full mt-4 flex items-center justify-center gap-2"
        >
          <Plus size={16} />
          Nominate New Model
        </button>
      </div>

      {/* Nomination Modal */}
      {showNominateModal && (
        <NominateModelModal
          onClose={() => {
            setShowNominateModal(false)
            setNominateError(null)
          }}
          onNominate={handleNominate}
          nominating={nominating}
          existingModels={models.map((m) => m.modelId)}
          error={nominateError}
        />
      )}

      {/* Recent Decisions */}
      <div className="card-static p-6">
        <h3 className="text-sm font-medium text-gray-500 mb-4">
          Recent Decisions
        </h3>

        {decisions.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <BarChart3 className="mx-auto mb-2 opacity-50" size={32} />
            <p className="text-sm">No decisions recorded yet</p>
            <p className="text-xs mt-1">
              Decisions will appear here after Director review
            </p>
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
                      <span className="badge-warning text-xs px-1.5 py-0.5">
                        Disputed
                      </span>
                    )}
                    {decision.overridden && (
                      <span className="badge-error text-xs px-1.5 py-0.5">
                        Overridden
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="text-right">
                <div className="text-sm">
                  <span className="text-gray-500">Confidence:</span>{' '}
                  <span className="font-medium">
                    {decision.confidenceScore}%
                  </span>
                </div>
                <div className="text-xs text-gray-500">
                  Alignment: {decision.alignmentScore}%
                </div>
              </div>
            </div>
          ))}
        </div>

        <button type="button" className="btn-secondary text-sm w-full mt-4">
          View All Decisions
        </button>
      </div>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  trend,
  trendGood = 'up',
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  trend?: number
  trendGood?: 'up' | 'down'
}) {
  const good =
    trend !== undefined &&
    ((trendGood === 'up' && trend > 0) || (trendGood === 'down' && trend < 0))
  return (
    <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
      {trend !== undefined && (
        <div
          className={`text-xs flex items-center gap-1 mt-1 ${good ? 'text-green-500' : 'text-red-500'}`}
        >
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

function NominateModelModal({
  onClose,
  onNominate,
  nominating,
  existingModels,
  error,
}: {
  onClose: () => void
  onNominate: (request: NominateModelRequest) => void
  nominating: boolean
  existingModels: string[]
  error: string | null
}) {
  const [selectedProvider, setSelectedProvider] = useState<string>('')
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [customModel, setCustomModel] = useState('')
  const [benchmarkScore, setBenchmarkScore] = useState(80)

  const provider = INFERENCE_PROVIDERS.find((p) => p.id === selectedProvider)
  const availableModels =
    provider?.models.filter((m) => !existingModels.includes(m)) ?? []

  const getModelName = (modelId: string) => {
    const names: Record<string, string> = {
      'claude-opus-4-5': 'Claude 4.5 Opus',
      'claude-sonnet-4-5': 'Claude 4.5 Sonnet',
      'gpt-5.2': 'GPT-5.2',
      'gemini-1.5-pro': 'Gemini 1.5 Pro',
      'gemini-1.5-flash': 'Gemini 1.5 Flash',
      'gemini-2.0-flash': 'Gemini 2.0 Flash',
      'llama-3.3-70b': 'Llama 3.3 70B',
      'llama-3.2-90b': 'Llama 3.2 90B',
      'mixtral-8x7b': 'Mixtral 8x7B',
      'gemma-7b': 'Gemma 7B',
      'qwen-72b': 'Qwen 72B',
      'deepseek-v3': 'DeepSeek V3',
      auto: 'Auto (Best Available)',
    }
    return names[modelId] ?? modelId
  }

  const handleSubmit = () => {
    const modelId = selectedModel || customModel
    if (!modelId || !selectedProvider) return

    onNominate({
      modelId,
      modelName: getModelName(modelId),
      provider: provider?.name ?? selectedProvider,
      benchmarkScore,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl max-w-lg w-full shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Brain className="text-accent" size={20} />
            Nominate AI Model
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Provider Selection */}
          <div>
            <label
              htmlFor="director-provider"
              className="block text-sm font-medium mb-2"
            >
              Provider
            </label>
            <select
              id="director-provider"
              value={selectedProvider}
              onChange={(e) => {
                setSelectedProvider(e.target.value)
                setSelectedModel('')
              }}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
            >
              <option value="">Select a provider...</option>
              {INFERENCE_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Model Selection */}
          {selectedProvider && (
            <div>
              <label
                htmlFor="director-model"
                className="block text-sm font-medium mb-2"
              >
                Model
              </label>
              <select
                id="director-model"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
              >
                <option value="">Select a model...</option>
                {availableModels.map((m) => (
                  <option key={m} value={m}>
                    {getModelName(m)}
                  </option>
                ))}
                <option value="custom">Custom Model ID...</option>
              </select>
            </div>
          )}

          {/* Custom Model Input */}
          {selectedModel === 'custom' && (
            <div>
              <label
                htmlFor="director-custom-model"
                className="block text-sm font-medium mb-2"
              >
                Custom Model ID
              </label>
              <input
                id="director-custom-model"
                type="text"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="e.g., claude-3-5-sonnet-20241022"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
              />
            </div>
          )}

          {/* Benchmark Score */}
          <div>
            <label
              htmlFor="director-benchmark"
              className="block text-sm font-medium mb-2"
            >
              Estimated Benchmark Score: {benchmarkScore}%
            </label>
            <input
              id="director-benchmark"
              type="range"
              min="50"
              max="100"
              value={benchmarkScore}
              onChange={(e) => setBenchmarkScore(parseInt(e.target.value, 10))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>50%</span>
              <span>100%</span>
            </div>
          </div>

          {/* Info */}
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 text-sm">
            <p className="text-blue-700 dark:text-blue-300">
              Nominated models participate in the Director election. Token
              holders can stake on their preferred model. The model with the
              most stake becomes the active Director.
            </p>
          </div>
        </div>

        <div className="flex gap-3 p-4 border-t border-gray-200 dark:border-gray-800">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary flex-1"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={
              nominating ||
              (!selectedModel && !customModel) ||
              !selectedProvider
            }
            className="btn-primary flex-1 disabled:opacity-50"
          >
            {nominating ? 'Nominating...' : 'Nominate Model'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default DirectorDashboard
