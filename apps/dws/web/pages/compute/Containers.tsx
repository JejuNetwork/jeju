import {
  AlertCircle,
  Box,
  HardDrive,
  Play,
  Plus,
  RefreshCw,
  Square,
} from 'lucide-react'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useContainers, useHealth, useRunContainer } from '../../hooks'

export default function ContainersPage() {
  const { isConnected } = useAccount()
  const { data: containersData, isLoading, refetch } = useContainers()
  const { data: health } = useHealth()
  const runContainer = useRunContainer()

  const [showModal, setShowModal] = useState(false)
  const [formData, setFormData] = useState({
    image: '',
    command: '',
    mode: 'serverless',
    cpuCores: '1',
    memoryMb: '512',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await runContainer.mutateAsync({
      image: formData.image,
      command: formData.command ? formData.command.split(' ') : undefined,
      mode: formData.mode,
    })
    setShowModal(false)
    setFormData({
      image: '',
      command: '',
      mode: 'serverless',
      cpuCores: '1',
      memoryMb: '512',
    })
  }

  const containers = containersData?.executions ?? []
  const running = containers.filter((c) => c.status === 'running').length
  const completed = containers.filter((c) => c.status === 'completed').length
  const failed = containers.filter((c) => c.status === 'failed').length

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
          <h1 className="page-title">Containers</h1>
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
            onClick={() => setShowModal(true)}
            disabled={!isConnected}
          >
            <Plus size={16} /> Run Container
          </button>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon compute">
            <Play size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Running</div>
            <div className="stat-value">{running}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon storage">
            <Box size={24} />
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
            <AlertCircle size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Failed</div>
            <div className="stat-value">{failed}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon network">
            <HardDrive size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Available Nodes</div>
            <div className="stat-value">
              {health?.decentralized.registeredNodes ?? 0}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">
            <Box size={18} /> Executions
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
        ) : containers.length === 0 ? (
          <div className="empty-state">
            <Box size={48} />
            <h3>No containers</h3>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowModal(true)}
              disabled={!isConnected}
            >
              <Plus size={16} /> Run Container
            </button>
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Execution ID</th>
                  <th>Image</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>Started</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {containers.map((container) => (
                  <tr key={container.executionId}>
                    <td
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.85rem',
                      }}
                    >
                      {container.executionId.slice(0, 12)}...
                    </td>
                    <td
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.85rem',
                      }}
                    >
                      {container.image}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          container.status === 'running'
                            ? 'badge-info'
                            : container.status === 'completed'
                              ? 'badge-success'
                              : container.status === 'failed'
                                ? 'badge-error'
                                : container.status === 'pending'
                                  ? 'badge-warning'
                                  : 'badge-neutral'
                        }`}
                      >
                        {container.status}
                      </span>
                    </td>
                    <td>
                      {container.metrics?.durationMs
                        ? `${(container.metrics.durationMs / 1000).toFixed(2)}s`
                        : '—'}
                    </td>
                    <td>
                      {container.startedAt
                        ? new Date(container.startedAt).toLocaleTimeString()
                        : '—'}
                    </td>
                    <td>
                      {container.status === 'running' && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          title="Stop"
                        >
                          <Square size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            onClick={() => setShowModal(false)}
            aria-label="Close modal"
          />
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') {
                setShowModal(false)
              }
            }}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header">
              <h3 className="modal-title">Run Container</h3>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setShowModal(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label htmlFor="container-image-modal" className="form-label">
                    Image *
                  </label>
                  <input
                    id="container-image-modal"
                    className="input"
                    placeholder="e.g., ubuntu:22.04, python:3.11"
                    value={formData.image}
                    onChange={(e) =>
                      setFormData({ ...formData, image: e.target.value })
                    }
                    required
                  />
                  <div className="form-hint">Docker image to run</div>
                </div>
                <div className="form-group">
                  <label
                    htmlFor="container-command-modal"
                    className="form-label"
                  >
                    Command
                  </label>
                  <input
                    id="container-command-modal"
                    className="input"
                    placeholder="e.g., python script.py"
                    value={formData.command}
                    onChange={(e) =>
                      setFormData({ ...formData, command: e.target.value })
                    }
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="container-mode-modal" className="form-label">
                    Mode
                  </label>
                  <select
                    id="container-mode-modal"
                    className="input"
                    value={formData.mode}
                    onChange={(e) =>
                      setFormData({ ...formData, mode: e.target.value })
                    }
                  >
                    <option value="serverless">Serverless (auto-scale)</option>
                    <option value="dedicated">Dedicated (reserved)</option>
                    <option value="spot">Spot (preemptible)</option>
                  </select>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '1rem',
                  }}
                >
                  <div className="form-group">
                    <label htmlFor="container-cpu-modal" className="form-label">
                      CPU Cores
                    </label>
                    <select
                      id="container-cpu-modal"
                      className="input"
                      value={formData.cpuCores}
                      onChange={(e) =>
                        setFormData({ ...formData, cpuCores: e.target.value })
                      }
                    >
                      <option value="1">1 vCPU</option>
                      <option value="2">2 vCPU</option>
                      <option value="4">4 vCPU</option>
                      <option value="8">8 vCPU</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label
                      htmlFor="container-memory-modal"
                      className="form-label"
                    >
                      Memory
                    </label>
                    <select
                      id="container-memory-modal"
                      className="input"
                      value={formData.memoryMb}
                      onChange={(e) =>
                        setFormData({ ...formData, memoryMb: e.target.value })
                      }
                    >
                      <option value="512">512 MB</option>
                      <option value="1024">1 GB</option>
                      <option value="2048">2 GB</option>
                      <option value="4096">4 GB</option>
                      <option value="8192">8 GB</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={runContainer.isPending}
                >
                  {runContainer.isPending ? (
                    <>
                      <div
                        className="spinner"
                        style={{ width: 16, height: 16 }}
                      />{' '}
                      Running...
                    </>
                  ) : (
                    <>
                      <Play size={16} /> Run
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
