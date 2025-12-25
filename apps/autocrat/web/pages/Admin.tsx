import {
  Activity,
  ChevronRight,
  Cpu,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Settings,
  Users,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  cancelRLAIFRun,
  createRLAIFRun,
  fetchActiveDAOs,
  fetchDAO,
  fetchDAOCouncil,
  fetchDAOPersona,
  fetchDAOs,
  fetchRLAIFHealth,
  fetchRLAIFRun,
  fetchRLAIFRuns,
  fetchTrajectoryStats,
  startRLAIFRun,
} from '../config/api'

interface DAO {
  id: string
  name: string
  description: string
  memberCount: number
  proposalCount: number
  isActive: boolean
}

interface DAOPersona {
  name: string
  mission: string
  values: string[]
  tone: string
}

interface DAOCouncilMember {
  address: string
  role: string
  addedAt: number
}

interface RLAIFRun {
  id: string
  environment: { id: string; type: string }
  baseModel: string
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed'
  iterations: number
  currentScore: number
  createdAt: number
  startedAt?: number
  completedAt?: number
}

interface RLAIFHealth {
  status: string
  gpuAvailable: boolean
  activeRuns: number
  queuedRuns: number
}

interface TrajectoryStats {
  total: number
  byQuality: { high: number; medium: number; low: number }
  averageReward: number
  lastUpdated: number
}

export default function AdminPage() {
  const [activeSection, setActiveSection] = useState<'daos' | 'rlaif'>('daos')

  // DAO state
  const [daos, setDaos] = useState<DAO[]>([])
  const [activeDAOs, setActiveDAOs] = useState<DAO[]>([])
  const [selectedDAO, setSelectedDAO] = useState<DAO | null>(null)
  const [persona, setPersona] = useState<DAOPersona | null>(null)
  const [council, setCouncil] = useState<DAOCouncilMember[]>([])
  const [daoLoading, setDaoLoading] = useState(true)

  // RLAIF state
  const [runs, setRuns] = useState<RLAIFRun[]>([])
  const [selectedRun, setSelectedRun] = useState<RLAIFRun | null>(null)
  const [health, setHealth] = useState<RLAIFHealth | null>(null)
  const [trajectoryStats, setTrajectoryStats] =
    useState<TrajectoryStats | null>(null)
  const [rlaifLoading, setRlaifLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)

  // Load DAOs
  const loadDAOs = useCallback(async () => {
    setDaoLoading(true)
    const [allDAOs, active] = await Promise.all([
      fetchDAOs().catch(() => ({ daos: [] })),
      fetchActiveDAOs().catch(() => ({ daos: [] })),
    ])
    setDaos((allDAOs as { daos: DAO[] }).daos ?? [])
    setActiveDAOs((active as { daos: DAO[] }).daos ?? [])
    setDaoLoading(false)
  }, [])

  // Load RLAIF data
  const loadRLAIF = useCallback(async () => {
    setRlaifLoading(true)
    const [runsData, healthData, trajStats] = await Promise.all([
      fetchRLAIFRuns().catch(() => ({ runs: [] })),
      fetchRLAIFHealth().catch(() => null),
      fetchTrajectoryStats().catch(() => null),
    ])
    setRuns((runsData as { runs: RLAIFRun[] }).runs ?? [])
    setHealth(healthData as RLAIFHealth | null)
    setTrajectoryStats(trajStats as TrajectoryStats | null)
    setRlaifLoading(false)
  }, [])

  useEffect(() => {
    if (activeSection === 'daos') {
      loadDAOs()
    } else {
      loadRLAIF()
    }
  }, [activeSection, loadDAOs, loadRLAIF])

  // Load DAO details
  const loadDAODetails = async (daoId: string) => {
    setDaoLoading(true)
    const [daoData, personaData, councilData] = await Promise.all([
      fetchDAO(daoId).catch(() => null),
      fetchDAOPersona(daoId).catch(() => null),
      fetchDAOCouncil(daoId).catch(() => ({ members: [] })),
    ])
    setSelectedDAO(daoData as DAO | null)
    setPersona(personaData as DAOPersona | null)
    setCouncil((councilData as { members: DAOCouncilMember[] }).members ?? [])
    setDaoLoading(false)
  }

  // Load RLAIF run details
  const loadRunDetails = async (runId: string) => {
    setRlaifLoading(true)
    const runData = await fetchRLAIFRun(runId).catch(() => null)
    setSelectedRun(runData as RLAIFRun | null)
    setRlaifLoading(false)
  }

  // Start RLAIF run
  const handleStartRun = async (runId: string) => {
    setActionLoading(true)
    await startRLAIFRun(runId).catch(() => null)
    await loadRLAIF()
    setActionLoading(false)
  }

  // Cancel RLAIF run
  const handleCancelRun = async (runId: string) => {
    setActionLoading(true)
    await cancelRLAIFRun(runId).catch(() => null)
    await loadRLAIF()
    setActionLoading(false)
  }

  // Create new RLAIF run
  const handleCreateRun = async () => {
    setActionLoading(true)
    await createRLAIFRun({
      environment: { id: 'babylon', type: 'game', configCID: '' },
      baseModel: 'gpt-4o-mini',
      trainingConfig: { steps: 1000, batchSize: 32, learningRate: 0.0001 },
    }).catch(() => null)
    await loadRLAIF()
    setActionLoading(false)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Settings size={24} />
          Admin
        </h1>
      </div>

      {/* Section Tabs */}
      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={() => setActiveSection('daos')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeSection === 'daos'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Users size={16} className="inline mr-2" />
          DAOs
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('rlaif')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeSection === 'rlaif'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Cpu size={16} className="inline mr-2" />
          RLAIF Training
        </button>
      </div>

      {/* DAO Section */}
      {activeSection === 'daos' && (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* DAO List */}
          <div className="lg:col-span-2">
            <div className="card-static p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold">All DAOs</h2>
                <button
                  type="button"
                  onClick={loadDAOs}
                  disabled={daoLoading}
                  className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                >
                  <RefreshCw
                    size={16}
                    className={daoLoading ? 'animate-spin' : ''}
                  />
                </button>
              </div>

              {daoLoading && daos.length === 0 ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="animate-spin" size={24} />
                </div>
              ) : (
                <div className="space-y-2">
                  {daos.map((dao) => (
                    <button
                      key={dao.id}
                      type="button"
                      onClick={() => loadDAODetails(dao.id)}
                      className={`w-full p-3 rounded-lg border text-left transition-colors flex items-center justify-between ${
                        selectedDAO?.id === dao.id
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{dao.name}</span>
                          {dao.isActive && (
                            <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded">
                              Active
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 truncate">
                          {dao.description}
                        </p>
                      </div>
                      <ChevronRight size={16} className="text-gray-400" />
                    </button>
                  ))}
                  {daos.length === 0 && (
                    <p className="text-center text-gray-500 py-8">
                      No DAOs found
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* DAO Details */}
          <div className="space-y-4">
            {selectedDAO ? (
              <>
                <div className="card-static p-4">
                  <h3 className="font-semibold mb-3">{selectedDAO.name}</h3>
                  <p className="text-sm text-gray-500 mb-4">
                    {selectedDAO.description}
                  </p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-500">Members</span>
                      <p className="font-medium">{selectedDAO.memberCount}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Proposals</span>
                      <p className="font-medium">{selectedDAO.proposalCount}</p>
                    </div>
                  </div>
                </div>

                {persona && (
                  <div className="card-static p-4">
                    <h3 className="font-semibold mb-3">Persona</h3>
                    <div className="space-y-2 text-sm">
                      <div>
                        <span className="text-gray-500">Mission</span>
                        <p>{persona.mission}</p>
                      </div>
                      <div>
                        <span className="text-gray-500">Tone</span>
                        <p>{persona.tone}</p>
                      </div>
                      <div>
                        <span className="text-gray-500">Values</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {persona.values.map((v) => (
                            <span
                              key={v}
                              className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-xs"
                            >
                              {v}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {council.length > 0 && (
                  <div className="card-static p-4">
                    <h3 className="font-semibold mb-3">Council</h3>
                    <div className="space-y-2">
                      {council.map((member) => (
                        <div
                          key={member.address}
                          className="flex items-center justify-between text-sm"
                        >
                          <span className="font-mono truncate">
                            {member.address.slice(0, 10)}...
                          </span>
                          <span className="text-gray-500">{member.role}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="card-static p-8 text-center text-gray-500">
                <Users size={32} className="mx-auto mb-2 opacity-30" />
                <p>Select a DAO to view details</p>
              </div>
            )}

            {/* Active DAOs Summary */}
            <div className="card-static p-4">
              <h3 className="font-semibold mb-3">Active DAOs</h3>
              <p className="text-2xl font-bold">{activeDAOs.length}</p>
              <p className="text-sm text-gray-500">of {daos.length} total</p>
            </div>
          </div>
        </div>
      )}

      {/* RLAIF Section */}
      {activeSection === 'rlaif' && (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Stats */}
          <div className="lg:col-span-3 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="card-static p-4">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <Activity size={16} />
                <span className="text-sm">Status</span>
              </div>
              <p
                className={`text-lg font-semibold ${health?.status === 'healthy' ? 'text-green-600' : 'text-yellow-600'}`}
              >
                {health?.status ?? 'Unknown'}
              </p>
            </div>
            <div className="card-static p-4">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <Zap size={16} />
                <span className="text-sm">GPU Available</span>
              </div>
              <p className="text-lg font-semibold">
                {health?.gpuAvailable ? 'Yes' : 'No'}
              </p>
            </div>
            <div className="card-static p-4">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <Play size={16} />
                <span className="text-sm">Active Runs</span>
              </div>
              <p className="text-lg font-semibold">{health?.activeRuns ?? 0}</p>
            </div>
            <div className="card-static p-4">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <Cpu size={16} />
                <span className="text-sm">Trajectories</span>
              </div>
              <p className="text-lg font-semibold">
                {trajectoryStats?.total ?? 0}
              </p>
            </div>
          </div>

          {/* Runs List */}
          <div className="lg:col-span-2">
            <div className="card-static p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold">Training Runs</h2>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={loadRLAIF}
                    disabled={rlaifLoading}
                    className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                  >
                    <RefreshCw
                      size={16}
                      className={rlaifLoading ? 'animate-spin' : ''}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateRun}
                    disabled={actionLoading}
                    className="btn-primary text-sm"
                  >
                    New Run
                  </button>
                </div>
              </div>

              {rlaifLoading && runs.length === 0 ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="animate-spin" size={24} />
                </div>
              ) : (
                <div className="space-y-2">
                  {runs.map((run) => (
                    <button
                      key={run.id}
                      type="button"
                      onClick={() => loadRunDetails(run.id)}
                      className={`w-full p-3 rounded-lg border text-left transition-colors ${
                        selectedRun?.id === run.id
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-mono text-sm">{run.id}</span>
                          <div className="flex items-center gap-2 mt-1">
                            <span
                              className={`px-1.5 py-0.5 text-xs rounded ${
                                run.status === 'running'
                                  ? 'bg-green-100 text-green-700'
                                  : run.status === 'completed'
                                    ? 'bg-blue-100 text-blue-700'
                                    : run.status === 'failed'
                                      ? 'bg-red-100 text-red-700'
                                      : 'bg-gray-100 text-gray-700'
                              }`}
                            >
                              {run.status}
                            </span>
                            <span className="text-xs text-gray-500">
                              {run.baseModel}
                            </span>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium">
                            {run.iterations} iterations
                          </p>
                          <p className="text-xs text-gray-500">
                            Score: {run.currentScore.toFixed(2)}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                  {runs.length === 0 && (
                    <p className="text-center text-gray-500 py-8">
                      No training runs found
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Run Details */}
          <div className="space-y-4">
            {selectedRun ? (
              <div className="card-static p-4">
                <h3 className="font-semibold mb-3">Run Details</h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">ID</span>
                    <span className="font-mono">{selectedRun.id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Status</span>
                    <span
                      className={
                        selectedRun.status === 'running' ? 'text-green-600' : ''
                      }
                    >
                      {selectedRun.status}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Model</span>
                    <span>{selectedRun.baseModel}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Environment</span>
                    <span>{selectedRun.environment.type}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Iterations</span>
                    <span>{selectedRun.iterations}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Score</span>
                    <span className="font-semibold">
                      {selectedRun.currentScore.toFixed(4)}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2 mt-4">
                  {selectedRun.status === 'pending' && (
                    <button
                      type="button"
                      onClick={() => handleStartRun(selectedRun.id)}
                      disabled={actionLoading}
                      className="btn-primary flex-1 text-sm flex items-center justify-center gap-1"
                    >
                      <Play size={14} />
                      Start
                    </button>
                  )}
                  {selectedRun.status === 'running' && (
                    <button
                      type="button"
                      onClick={() => handleCancelRun(selectedRun.id)}
                      disabled={actionLoading}
                      className="btn-secondary flex-1 text-sm flex items-center justify-center gap-1"
                    >
                      <Pause size={14} />
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="card-static p-8 text-center text-gray-500">
                <Cpu size={32} className="mx-auto mb-2 opacity-30" />
                <p>Select a run to view details</p>
              </div>
            )}

            {/* Trajectory Stats */}
            {trajectoryStats && (
              <div className="card-static p-4">
                <h3 className="font-semibold mb-3">Trajectory Quality</h3>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-green-600">High Quality</span>
                    <span>{trajectoryStats.byQuality.high}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-yellow-600">Medium</span>
                    <span>{trajectoryStats.byQuality.medium}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-red-600">Low</span>
                    <span>{trajectoryStats.byQuality.low}</span>
                  </div>
                  <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Avg Reward</span>
                      <span className="font-medium">
                        {trajectoryStats.averageReward.toFixed(4)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
