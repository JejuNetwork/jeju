import {
  CheckCircle,
  Play,
  Plus,
  RefreshCw,
  Server,
  Sparkles,
  Upload,
  XCircle,
} from 'lucide-react'
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

export default function MLTrainingPage() {
  const { data: runsData, isLoading, refetch } = useTrainingRuns()
  const { data: nodesData } = useComputeNodes()

  const runs = runsData ?? []
  const completed = runs.filter((r) => r.state === 6).length
  const failed = runs.filter((r) => r.state === 8).length

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
          <h1 className="page-title">ML Training</h1>
          <p className="page-subtitle">
            Fine-tune and train models on distributed compute
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
          <button type="button" className="btn btn-primary">
            <Plus size={16} /> New Training Job
          </button>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon ai">
            <Sparkles size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Training Jobs</div>
            <div className="stat-value">{runs.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon storage">
            <CheckCircle size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Completed</div>
            <div className="stat-value">{completed}</div>
          </div>
        </div>
        <div className="stat-card">
          <div
            className="stat-icon"
            style={{ background: 'var(--error-soft)', color: 'var(--error)' }}
          >
            <XCircle size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Failed</div>
            <div className="stat-value">{failed}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon compute">
            <Server size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">GPU Nodes</div>
            <div className="stat-value">
              {
                (nodesData?.nodes ?? []).filter((n) => n.resources.totalCpu > 4)
                  .length
              }
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
          gap: '1.5rem',
        }}
      >
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Sparkles size={18} /> Training Jobs
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
              <Sparkles size={48} />
              <h3>No training jobs</h3>
              <p>Start training a model on the decentralized compute network</p>
              <button type="button" className="btn btn-primary">
                <Plus size={16} /> New Training Job
              </button>
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>State</th>
                    <th>Progress</th>
                    <th>Clients</th>
                    <th>Created</th>
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
                      <tr key={run.runId}>
                        <td style={{ fontWeight: 500 }}>{run.model}</td>
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
                                background: 'var(--bg-primary)',
                                borderRadius: '3px',
                                overflow: 'hidden',
                                minWidth: '60px',
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
                        <td>{new Date(run.createdAt).toLocaleDateString()}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Upload size={18} /> Quick Start
            </h3>
          </div>
          <div style={{ display: 'grid', gap: '1rem' }}>
            <div
              style={{
                padding: '1rem',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
              }}
            >
              <div style={{ fontWeight: 500, marginBottom: '0.5rem' }}>
                Fine-tune LLM
              </div>
              <div
                style={{
                  fontSize: '0.85rem',
                  color: 'var(--text-secondary)',
                  marginBottom: '0.75rem',
                }}
              >
                Fine-tune a language model with your custom dataset using LoRA
                or full fine-tuning.
              </div>
              <button type="button" className="btn btn-secondary btn-sm">
                <Play size={14} /> Start
              </button>
            </div>
            <div
              style={{
                padding: '1rem',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
              }}
            >
              <div style={{ fontWeight: 500, marginBottom: '0.5rem' }}>
                Train Embeddings
              </div>
              <div
                style={{
                  fontSize: '0.85rem',
                  color: 'var(--text-secondary)',
                  marginBottom: '0.75rem',
                }}
              >
                Train custom embedding models for your specific domain or use
                case.
              </div>
              <button type="button" className="btn btn-secondary btn-sm">
                <Play size={14} /> Start
              </button>
            </div>
            <div
              style={{
                padding: '1rem',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
              }}
            >
              <div style={{ fontWeight: 500, marginBottom: '0.5rem' }}>
                RLHF/DPO
              </div>
              <div
                style={{
                  fontSize: '0.85rem',
                  color: 'var(--text-secondary)',
                  marginBottom: '0.75rem',
                }}
              >
                Align models using Reinforcement Learning from Human Feedback or
                DPO.
              </div>
              <button type="button" className="btn btn-secondary btn-sm">
                <Play size={14} /> Start
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div className="card-header">
          <h3 className="card-title">
            <Server size={18} /> Supported Frameworks
          </h3>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {[
            'PyTorch',
            'TensorFlow',
            'JAX',
            'Hugging Face',
            'DeepSpeed',
            'FSDP',
            'LoRA',
            'QLoRA',
          ].map((fw) => (
            <span
              key={fw}
              className="badge badge-neutral"
              style={{ fontSize: '0.85rem', padding: '0.375rem 0.75rem' }}
            >
              {fw}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
