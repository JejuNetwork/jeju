import {
  AlertCircle,
  CheckCircle,
  Clock,
  Cpu,
  Play,
  Plus,
  RefreshCw,
  XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useJobs, useSubmitJob } from '../../hooks'

export default function JobsPage() {
  const { isConnected } = useAccount()
  const { data: jobsData, isLoading, refetch } = useJobs()
  const submitJob = useSubmitJob()

  const [showModal, setShowModal] = useState(false)
  const [selectedJob, setSelectedJob] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    command: '',
    shell: 'bash',
    timeout: '300000',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await submitJob.mutateAsync({
      command: formData.command,
      shell: formData.shell,
      timeout: parseInt(formData.timeout, 10),
    })
    setShowModal(false)
    setFormData({ command: '', shell: 'bash', timeout: '300000' })
  }

  const jobs = jobsData?.jobs ?? []
  const queued = jobs.filter((j) => j.status === 'queued').length
  const running = jobs.filter((j) => j.status === 'running').length
  const completed = jobs.filter((j) => j.status === 'completed').length
  const failed = jobs.filter((j) => j.status === 'failed').length

  const selectedJobData = jobs.find((j) => j.jobId === selectedJob)

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
          <h1 className="page-title">Compute Jobs</h1>
          <p className="page-subtitle">
            Submit and monitor shell command execution on compute nodes
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
            onClick={() => setShowModal(true)}
            disabled={!isConnected}
          >
            <Plus size={16} /> Submit Job
          </button>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div
            className="stat-icon"
            style={{
              background: 'var(--warning-soft)',
              color: 'var(--warning)',
            }}
          >
            <Clock size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Queued</div>
            <div className="stat-value">{queued}</div>
          </div>
        </div>
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
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: selectedJob ? '1fr 1fr' : '1fr',
          gap: '1.5rem',
        }}
      >
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Cpu size={18} /> Jobs
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
          ) : jobs.length === 0 ? (
            <div className="empty-state">
              <Cpu size={48} />
              <h3>Ready to compute</h3>
              <p>Run shell commands on distributed compute nodes with pay-per-use pricing</p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowModal(true)}
                disabled={!isConnected}
              >
                <Plus size={16} /> Submit Job
              </button>
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Job ID</th>
                    <th>Status</th>
                    <th>Exit Code</th>
                    <th>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr
                      key={job.jobId}
                      onClick={() => setSelectedJob(job.jobId)}
                      style={{
                        cursor: 'pointer',
                        background:
                          selectedJob === job.jobId
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
                        {job.jobId.slice(0, 12)}...
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            job.status === 'running'
                              ? 'badge-info'
                              : job.status === 'completed'
                                ? 'badge-success'
                                : job.status === 'failed'
                                  ? 'badge-error'
                                  : job.status === 'queued'
                                    ? 'badge-warning'
                                    : 'badge-neutral'
                          }`}
                        >
                          {job.status}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>
                        {job.exitCode !== null ? job.exitCode : '—'}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>
                        {job.duration
                          ? `${(job.duration / 1000).toFixed(2)}s`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {selectedJob && selectedJobData && (
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">
                <AlertCircle size={18} /> Job Details
              </h3>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setSelectedJob(null)}
              >
                ×
              </button>
            </div>
            <div style={{ display: 'grid', gap: '1rem' }}>
              <div>
                <div
                  style={{
                    fontSize: '0.8rem',
                    color: 'var(--text-muted)',
                    marginBottom: '0.25rem',
                  }}
                >
                  Job ID
                </div>
                <code style={{ fontSize: '0.85rem' }}>
                  {selectedJobData.jobId}
                </code>
              </div>
              <div>
                <div
                  style={{
                    fontSize: '0.8rem',
                    color: 'var(--text-muted)',
                    marginBottom: '0.25rem',
                  }}
                >
                  Command
                </div>
                <code style={{ fontSize: '0.85rem' }}>
                  {selectedJobData.command}
                </code>
              </div>
              <div>
                <div
                  style={{
                    fontSize: '0.8rem',
                    color: 'var(--text-muted)',
                    marginBottom: '0.25rem',
                  }}
                >
                  Shell
                </div>
                <span>{selectedJobData.shell}</span>
              </div>
              <div>
                <div
                  style={{
                    fontSize: '0.8rem',
                    color: 'var(--text-muted)',
                    marginBottom: '0.25rem',
                  }}
                >
                  Output
                </div>
                <pre
                  style={{
                    background: 'var(--bg-tertiary)',
                    padding: '1rem',
                    borderRadius: 'var(--radius-md)',
                    overflow: 'auto',
                    maxHeight: '300px',
                    fontSize: '0.8rem',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {selectedJobData.output.length > 0
                    ? selectedJobData.output
                    : '(No output yet)'}
                </pre>
              </div>
            </div>
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
              <h3 className="modal-title">Submit Job</h3>
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
                  <label htmlFor="job-command" className="form-label">
                    Command *
                  </label>
                  <textarea
                    id="job-command"
                    className="input"
                    placeholder="echo 'Hello World'"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      minHeight: '100px',
                    }}
                    value={formData.command}
                    onChange={(e) =>
                      setFormData({ ...formData, command: e.target.value })
                    }
                    required
                  />
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '1rem',
                  }}
                >
                  <div className="form-group">
                    <label htmlFor="job-shell" className="form-label">
                      Shell
                    </label>
                    <select
                      id="job-shell"
                      className="input"
                      value={formData.shell}
                      onChange={(e) =>
                        setFormData({ ...formData, shell: e.target.value })
                      }
                    >
                      <option value="bash">Bash</option>
                      <option value="sh">Sh</option>
                      <option value="pwsh">PowerShell</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="job-timeout" className="form-label">
                      Timeout
                    </label>
                    <select
                      id="job-timeout"
                      className="input"
                      value={formData.timeout}
                      onChange={(e) =>
                        setFormData({ ...formData, timeout: e.target.value })
                      }
                    >
                      <option value="60000">1 minute</option>
                      <option value="300000">5 minutes</option>
                      <option value="600000">10 minutes</option>
                      <option value="1800000">30 minutes</option>
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
                  disabled={submitJob.isPending}
                >
                  {submitJob.isPending ? (
                    'Submitting...'
                  ) : (
                    <>
                      <Play size={16} /> Submit
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
