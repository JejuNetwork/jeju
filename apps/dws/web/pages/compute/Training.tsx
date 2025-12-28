import { Activity, Gauge, Play, RefreshCw, Server, Users } from 'lucide-react'
import { useState } from 'react'
import { useComputeNodes, useTrainingRuns } from '../../hooks'

const TRAINING_STATES: Record<number, { label: string; color: string }> = {
  0: { label: 'Created', color: 'badge-neutral' },
  1: { label: 'Gathering', color: 'badge-warning' },
  2: { label: 'Preparing', color: 'badge-warning' },
  3: { label: 'Training', color: 'badge-info' },
  4: { label: 'Aggregating', color: 'badge-info' },
  5: { label: 'Validating', color: 'badge-accent' },
  6: { label: 'Completed', color: 'badge-success' },
  7: { label: 'Paused', color: 'badge-warning' },
  8: { label: 'Failed', color: 'badge-error' },
}

export default function TrainingPage() {
  const { data: runsData, isLoading, refetch } = useTrainingRuns()
  const { data: nodesData } = useComputeNodes()
  const [selectedRun, setSelectedRun] = useState<string | null>(null)

  const runs = runsData ?? []
  const activeRuns = runs.filter((r) => r.state >= 1 && r.state <= 5).length
  const nodes = nodesData?.nodes ?? []
  const totalNodes = nodes.length
  const gpuNodes = nodes.filter((n) => n.resources.totalCpu > 4).length

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
          <h1 className="page-title">Distributed Training</h1>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => refetch()}
          >
            <RefreshCw size={16} /> Refresh
          </button>
          <button type="button" className="btn btn-primary" disabled>
            <Play size={16} /> Start Training
          </button>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon ai">
            <Activity size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Active Runs</div>
            <div className="stat-value">{activeRuns}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon compute">
            <Server size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Training Nodes</div>
            <div className="stat-value">{totalNodes}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon storage">
            <Gauge size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">GPU Nodes</div>
            <div className="stat-value">{gpuNodes}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon network">
            <Users size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Total Clients</div>
            <div className="stat-value">
              {runs.reduce((sum, r) => sum + r.clients, 0)}
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: selectedRun ? '1fr 1fr' : '1fr',
          gap: '1.5rem',
        }}
      >
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Gauge size={18} /> Training Runs
            </h3>
          </div>

          {isLoading ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                padding: '3rem',
              }}
            >
              <div className="spinner" />
            </div>
          ) : runs.length === 0 ? (
            <div className="empty-state">
              <Gauge size={48} />
              <h3>No training runs</h3>
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Run ID</th>
                    <th>Model</th>
                    <th>State</th>
                    <th>Progress</th>
                    <th>Clients</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => {
                    const stateInfo = TRAINING_STATES[run.state] ?? {
                      label: 'Unknown',
                      color: 'badge-neutral',
                    }
                    const progress =
                      run.totalSteps > 0 ? (run.step / run.totalSteps) * 100 : 0

                    return (
                      <tr
                        key={run.runId}
                        onClick={() => setSelectedRun(run.runId)}
                        style={{
                          cursor: 'pointer',
                          background:
                            selectedRun === run.runId
                              ? 'var(--accent-soft)'
                              : undefined,
                        }}
                      >
                        <td
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.85rem',
                          }}
                        >
                          {run.runId.slice(0, 12)}...
                        </td>
                        <td>{run.model}</td>
                        <td>
                          <span className={`badge ${stateInfo.color}`}>
                            {stateInfo.label}
                          </span>
                        </td>
                        <td>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.5rem',
                            }}
                          >
                            <div
                              style={{
                                flex: 1,
                                height: '6px',
                                background: 'var(--bg-tertiary)',
                                borderRadius: '3px',
                                overflow: 'hidden',
                              }}
                            >
                              <div
                                style={{
                                  width: `${progress}%`,
                                  height: '100%',
                                  background: 'var(--accent)',
                                  borderRadius: '3px',
                                }}
                              />
                            </div>
                            <span
                              style={{
                                fontSize: '0.8rem',
                                fontFamily: 'var(--font-mono)',
                              }}
                            >
                              {progress.toFixed(0)}%
                            </span>
                          </div>
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>
                          {run.clients}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {selectedRun && (
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">
                <Activity size={18} /> Run Details
              </h3>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setSelectedRun(null)}
              >
                ×
              </button>
            </div>
            {(() => {
              const run = runs.find((r) => r.runId === selectedRun)
              if (!run) return null
              const stateInfo = TRAINING_STATES[run.state] ?? {
                label: 'Unknown',
                color: 'badge-neutral',
              }

              return (
                <div style={{ display: 'grid', gap: '1rem' }}>
                  <div>
                    <div
                      style={{
                        fontSize: '0.8rem',
                        color: 'var(--text-muted)',
                        marginBottom: '0.25rem',
                      }}
                    >
                      Run ID
                    </div>
                    <code style={{ fontSize: '0.85rem' }}>{run.runId}</code>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: '0.8rem',
                        color: 'var(--text-muted)',
                        marginBottom: '0.25rem',
                      }}
                    >
                      Model
                    </div>
                    <span>{run.model}</span>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: '0.8rem',
                        color: 'var(--text-muted)',
                        marginBottom: '0.25rem',
                      }}
                    >
                      State
                    </div>
                    <span className={`badge ${stateInfo.color}`}>
                      {stateInfo.label}
                    </span>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: '0.8rem',
                        color: 'var(--text-muted)',
                        marginBottom: '0.25rem',
                      }}
                    >
                      Progress
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                      {run.step} / {run.totalSteps} steps
                    </span>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: '0.8rem',
                        color: 'var(--text-muted)',
                        marginBottom: '0.25rem',
                      }}
                    >
                      Connected Clients
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                      {run.clients}
                    </span>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: '0.8rem',
                        color: 'var(--text-muted)',
                        marginBottom: '0.25rem',
                      }}
                    >
                      Created
                    </div>
                    <span>{new Date(run.createdAt).toLocaleString()}</span>
                  </div>
                </div>
              )
            })()}
          </div>
        )}
      </div>
    </div>
  )
}
