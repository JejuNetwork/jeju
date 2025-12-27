import {
  Activity,
  Clock,
  Code,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useDeployWorker, useInvokeWorker, useWorkers } from '../../hooks'

const SAMPLE_CODE = `// Hello World Worker
export default {
  async fetch(request) {
    return new Response('Hello from DWS Worker!');
  }
};`

export default function WorkersPage() {
  const { isConnected } = useAccount()
  const { data: workersData, isLoading, refetch } = useWorkers()
  const deployWorker = useDeployWorker()
  const invokeWorker = useInvokeWorker()

  const [showModal, setShowModal] = useState(false)
  const [showInvokeModal, setShowInvokeModal] = useState<string | null>(null)
  const [invokePayload, setInvokePayload] = useState('{}')
  const [invokeResult, setInvokeResult] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    name: '',
    code: SAMPLE_CODE,
    runtime: 'bun',
    handler: 'index.handler',
    memory: '256',
    timeout: '30000',
  })

  const handleDeploy = async (e: React.FormEvent) => {
    e.preventDefault()
    await deployWorker.mutateAsync({
      name: formData.name,
      code: formData.code,
      runtime: formData.runtime,
      handler: formData.handler,
      memory: parseInt(formData.memory, 10),
      timeout: parseInt(formData.timeout, 10),
    })
    setShowModal(false)
    setFormData({
      name: '',
      code: SAMPLE_CODE,
      runtime: 'bun',
      handler: 'index.handler',
      memory: '256',
      timeout: '30000',
    })
  }

  const handleInvoke = async (id: string) => {
    const result = await invokeWorker.mutateAsync({
      id,
      payload: JSON.parse(invokePayload),
    })
    setInvokeResult(JSON.stringify(result, null, 2))
  }

  const workers = workersData?.functions ?? []
  const active = workers.filter((w) => w.status === 'active').length
  const totalInvocations = workers.reduce(
    (sum, w) => sum + w.invocationCount,
    0,
  )

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
          <h1 className="page-title">Workers</h1>
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
            <Plus size={16} /> Deploy Worker
          </button>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon compute">
            <Zap size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Active Workers</div>
            <div className="stat-value">{active}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon storage">
            <Activity size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Total Invocations</div>
            <div className="stat-value">
              {totalInvocations.toLocaleString()}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon network">
            <Clock size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Avg Duration</div>
            <div className="stat-value">
              {workers.length > 0
                ? `${(workers.reduce((sum, w) => sum + w.avgDurationMs, 0) / workers.length).toFixed(0)}ms`
                : '—'}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div
            className="stat-icon"
            style={{ background: 'var(--error-soft)', color: 'var(--error)' }}
          >
            <Activity size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Error Rate</div>
            <div className="stat-value">
              {totalInvocations > 0
                ? `${((workers.reduce((sum, w) => sum + w.errorCount, 0) / totalInvocations) * 100).toFixed(1)}%`
                : '0%'}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">
            <Code size={18} /> Functions
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
        ) : workers.length === 0 ? (
          <div className="empty-state">
            <Zap size={48} />
            <h3>No workers yet</h3>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowModal(true)}
              disabled={!isConnected}
            >
              <Plus size={16} /> Deploy Worker
            </button>
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Runtime</th>
                  <th>Status</th>
                  <th>Invocations</th>
                  <th>Avg Duration</th>
                  <th>Memory</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {workers.map((worker) => (
                  <tr key={worker.id}>
                    <td style={{ fontWeight: 500 }}>{worker.name}</td>
                    <td>
                      <span className="badge badge-neutral">
                        {worker.runtime}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`badge ${worker.status === 'active' ? 'badge-success' : 'badge-error'}`}
                      >
                        {worker.status}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>
                      {worker.invocationCount.toLocaleString()}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>
                      {worker.avgDurationMs.toFixed(0)}ms
                    </td>
                    <td>{worker.memory}MB</td>
                    <td style={{ display: 'flex', gap: '0.25rem' }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        title="Invoke"
                        onClick={() => setShowInvokeModal(worker.id)}
                      >
                        <Play size={14} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
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
            style={{ maxWidth: '700px' }}
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
              <h3 className="modal-title">Deploy Worker</h3>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setShowModal(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleDeploy}>
              <div className="modal-body">
                <div className="form-group">
                  <label htmlFor="worker-name" className="form-label">
                    Function Name *
                  </label>
                  <input
                    id="worker-name"
                    className="input"
                    placeholder="my-worker"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    required
                    pattern="[a-zA-Z0-9_-]+"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="worker-code" className="form-label">
                    Code *
                  </label>
                  <textarea
                    id="worker-code"
                    className="input"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      minHeight: '200px',
                    }}
                    value={formData.code}
                    onChange={(e) =>
                      setFormData({ ...formData, code: e.target.value })
                    }
                    required
                  />
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: '1rem',
                  }}
                >
                  <div className="form-group">
                    <label htmlFor="worker-runtime" className="form-label">
                      Runtime
                    </label>
                    <select
                      id="worker-runtime"
                      className="input"
                      value={formData.runtime}
                      onChange={(e) =>
                        setFormData({ ...formData, runtime: e.target.value })
                      }
                    >
                      <option value="bun">Bun</option>
                      <option value="node">Node.js</option>
                      <option value="deno">Deno</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="worker-handler" className="form-label">
                      Handler
                    </label>
                    <input
                      id="worker-handler"
                      className="input"
                      value={formData.handler}
                      onChange={(e) =>
                        setFormData({ ...formData, handler: e.target.value })
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="worker-memory" className="form-label">
                      Memory
                    </label>
                    <select
                      id="worker-memory"
                      className="input"
                      value={formData.memory}
                      onChange={(e) =>
                        setFormData({ ...formData, memory: e.target.value })
                      }
                    >
                      <option value="128">128 MB</option>
                      <option value="256">256 MB</option>
                      <option value="512">512 MB</option>
                      <option value="1024">1 GB</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="worker-timeout" className="form-label">
                      Timeout
                    </label>
                    <select
                      id="worker-timeout"
                      className="input"
                      value={formData.timeout}
                      onChange={(e) =>
                        setFormData({ ...formData, timeout: e.target.value })
                      }
                    >
                      <option value="10000">10 seconds</option>
                      <option value="30000">30 seconds</option>
                      <option value="60000">1 minute</option>
                      <option value="300000">5 minutes</option>
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
                  disabled={deployWorker.isPending}
                >
                  {deployWorker.isPending ? (
                    'Deploying...'
                  ) : (
                    <>
                      <Zap size={16} /> Deploy
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showInvokeModal && (
        <div className="modal-overlay">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            onClick={() => {
              setShowInvokeModal(null)
              setInvokeResult(null)
            }}
            aria-label="Close modal"
          />
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') {
                setShowInvokeModal(null)
                setInvokeResult(null)
              }
            }}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header">
              <h3 className="modal-title">Invoke Worker</h3>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => {
                  setShowInvokeModal(null)
                  setInvokeResult(null)
                }}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label htmlFor="worker-invoke-payload" className="form-label">
                  Payload (JSON)
                </label>
                <textarea
                  id="worker-invoke-payload"
                  className="input"
                  style={{ fontFamily: 'var(--font-mono)', minHeight: '100px' }}
                  value={invokePayload}
                  onChange={(e) => setInvokePayload(e.target.value)}
                />
              </div>
              {invokeResult && (
                <div className="form-group">
                  <span className="form-label">Result</span>
                  <pre
                    style={{
                      background: 'var(--bg-tertiary)',
                      padding: '1rem',
                      borderRadius: 'var(--radius-md)',
                      overflow: 'auto',
                      maxHeight: '200px',
                    }}
                  >
                    {invokeResult}
                  </pre>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setShowInvokeModal(null)
                  setInvokeResult(null)
                }}
              >
                Close
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleInvoke(showInvokeModal)}
                disabled={invokeWorker.isPending}
              >
                {invokeWorker.isPending ? (
                  'Invoking...'
                ) : (
                  <>
                    <Play size={16} /> Invoke
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
