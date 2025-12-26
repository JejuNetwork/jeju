/**
 * Edge Functions Page
 *
 * Deploy and manage serverless edge functions on DWS.
 */

import {
  Activity,
  AlertCircle,
  CheckCircle,
  Clock,
  ExternalLink,
  FileCode,
  Globe,
  Loader,
  Pause,
  Plus,
  RefreshCw,
  Settings,
  Terminal,
  Upload,
  XCircle,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import {
  type EdgeFunction as ApiEdgeFunction,
  functionsApi,
} from '../../lib/api'

// Extended type for local UI state
type EdgeFunction = ApiEdgeFunction & {
  invocations24h?: number
  codeSize?: number
  memoryLimit?: number
  cpuLimit?: number
}

interface FunctionLog {
  timestamp: number
  level: 'info' | 'warn' | 'error'
  message: string
  requestId: string
}

export default function FunctionsPage() {
  const { isConnected, address } = useAccount()
  const [functions, setFunctions] = useState<EdgeFunction[]>([])
  const [logs] = useState<FunctionLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNewFunction, setShowNewFunction] = useState(false)
  const [showLogs, setShowLogs] = useState(false)

  const fetchFunctions = useCallback(async () => {
    if (!address) return
    setLoading(true)
    setError(null)

    const result = await functionsApi.list(address).catch((err: Error) => {
      setError(err.message)
      return []
    })

    // Map API response to local type with defaults
    setFunctions(
      result.map((f) => ({
        ...f,
        invocations24h: f.invocations || 0,
        codeSize: 0,
        memoryLimit: f.memoryMb || 128,
        cpuLimit: f.cpuMs || 10,
      })),
    )
    setLoading(false)
  }, [address])

  useEffect(() => {
    if (isConnected && address) {
      fetchFunctions()
    }
  }, [isConnected, address, fetchFunctions])

  if (!isConnected) {
    return (
      <div className="empty-state" style={{ paddingTop: '4rem' }}>
        <Zap size={64} />
        <h3>Connect Wallet</h3>
        <p>Connect your wallet to manage edge functions</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="empty-state" style={{ paddingTop: '4rem' }}>
        <Loader size={48} className="spin" />
        <h3>Loading functions...</h3>
      </div>
    )
  }

  const totalInvocations = functions.reduce(
    (sum, f) => sum + (f.invocations24h || 0),
    0,
  )
  const avgLatency =
    functions.length > 0
      ? Math.round(
          functions.reduce((sum, f) => sum + f.avgLatency, 0) /
            functions.length,
        )
      : 0

  const getStatusBadge = (status: EdgeFunction['status']) => {
    const classes = {
      active: 'badge-success',
      deploying: 'badge-warning',
      stopped: 'badge-neutral',
      error: 'badge-error',
    }
    return classes[status]
  }

  const getStatusIcon = (status: EdgeFunction['status']) => {
    switch (status) {
      case 'active':
        return <CheckCircle size={14} />
      case 'deploying':
        return <Loader size={14} className="spin" />
      case 'stopped':
        return <Pause size={14} />
      case 'error':
        return <AlertCircle size={14} />
    }
  }

  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp
    if (diff < 60000) return 'Just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return new Date(timestamp).toLocaleDateString()
  }

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toString()
  }

  return (
    <div>
      {error && (
        <div
          className="card"
          style={{
            background: 'var(--error-bg)',
            border: '1px solid var(--error)',
            marginBottom: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertCircle size={18} style={{ color: 'var(--error)' }} />
            <span>{error}</span>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              style={{ marginLeft: 'auto' }}
              onClick={() => setError(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">Edge Functions</h1>
          <p className="page-subtitle">
            Deploy serverless functions at the edge with V8 isolates
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowNewFunction(true)}
        >
          <Plus size={18} />
          New Function
        </button>
      </div>

      {/* Stats */}
      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon compute">
            <Zap size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Functions</div>
            <div className="stat-value">{functions.length}</div>
            <div className="stat-change positive">
              {functions.filter((f) => f.status === 'active').length} active
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon storage">
            <Activity size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Invocations (24h)</div>
            <div className="stat-value">{formatNumber(totalInvocations)}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon network">
            <Clock size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Avg Latency</div>
            <div className="stat-value">{avgLatency}ms</div>
            <div className="stat-change positive">P50</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon ai">
            <Globe size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Edge Regions</div>
            <div className="stat-value">
              {new Set(functions.map((f) => f.region)).size}
            </div>
          </div>
        </div>
      </div>

      {/* Functions List */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">
            <Zap size={18} /> Your Functions
          </h3>
          <button type="button" className="btn btn-sm btn-secondary">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>

        {functions.length === 0 ? (
          <div className="empty-state" style={{ padding: '3rem' }}>
            <Zap size={48} />
            <h3>No edge functions</h3>
            <p>Deploy your first serverless function</p>
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: '1rem' }}
              onClick={() => setShowNewFunction(true)}
            >
              <Plus size={18} /> Create Function
            </button>
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Function</th>
                  <th>Status</th>
                  <th>Routes</th>
                  <th>Invocations</th>
                  <th>Latency</th>
                  <th>Region</th>
                  <th>Last Deploy</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {functions.map((fn) => (
                  <tr key={fn.id}>
                    <td>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                        }}
                      >
                        <FileCode
                          size={18}
                          style={{ color: 'var(--accent)' }}
                        />
                        <span style={{ fontWeight: 600 }}>{fn.name}</span>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`badge ${getStatusBadge(fn.status)}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                        }}
                      >
                        {getStatusIcon(fn.status)}
                        {fn.status}
                      </span>
                    </td>
                    <td>
                      <div
                        style={{
                          display: 'flex',
                          gap: '0.25rem',
                          flexWrap: 'wrap',
                        }}
                      >
                        {fn.routes.slice(0, 2).map((route) => (
                          <span
                            key={route}
                            className="badge badge-neutral"
                            style={{
                              fontSize: '0.75rem',
                              fontFamily: 'var(--font-mono)',
                            }}
                          >
                            {route}
                          </span>
                        ))}
                        {fn.routes.length > 2 && (
                          <span
                            className="badge badge-neutral"
                            style={{ fontSize: '0.75rem' }}
                          >
                            +{fn.routes.length - 2}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>
                      {formatNumber(fn.invocations24h || 0)}
                    </td>
                    <td>
                      <span
                        style={{
                          color:
                            fn.avgLatency < 20
                              ? 'var(--success)'
                              : fn.avgLatency < 50
                                ? 'var(--warning)'
                                : 'var(--error)',
                        }}
                      >
                        {fn.avgLatency}ms
                      </span>
                    </td>
                    <td>{fn.region}</td>
                    <td style={{ color: 'var(--text-muted)' }}>
                      {formatTime(fn.lastDeployed)}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.25rem' }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          title="Logs"
                          onClick={(e) => {
                            e.stopPropagation()
                            setShowLogs(true)
                          }}
                        >
                          <Terminal size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          title="Settings"
                        >
                          <Settings size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* New Function Modal */}
      {showNewFunction && (
        <div className="modal-overlay">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            onClick={() => setShowNewFunction(false)}
            aria-label="Close modal"
          />
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setShowNewFunction(false)
            }}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header">
              <h2>New Edge Function</h2>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => setShowNewFunction(false)}
              >
                <XCircle size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label htmlFor="fn-name">Function Name</label>
                <input
                  id="fn-name"
                  type="text"
                  placeholder="my-function"
                  className="input"
                />
              </div>

              <div className="form-group">
                <label htmlFor="fn-routes">Routes</label>
                <input
                  id="fn-routes"
                  type="text"
                  placeholder="/api/*, /webhooks/*"
                  className="input"
                />
                <small style={{ color: 'var(--text-muted)' }}>
                  Comma-separated URL patterns
                </small>
              </div>

              <div className="form-group">
                <label htmlFor="fn-runtime">Runtime</label>
                <select id="fn-runtime" className="input">
                  <option value="v8-isolate">
                    V8 Isolate (Cloudflare Workers compatible)
                  </option>
                  <option value="bun">Bun Runtime</option>
                  <option value="wasm">WebAssembly</option>
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
                  <label htmlFor="fn-memory">Memory Limit</label>
                  <select id="fn-memory" className="input" defaultValue="128">
                    <option value="64">64 MB</option>
                    <option value="128">128 MB</option>
                    <option value="256">256 MB</option>
                    <option value="512">512 MB</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="fn-cpu">CPU Limit (ms)</label>
                  <select id="fn-cpu" className="input" defaultValue="10">
                    <option value="10">10ms</option>
                    <option value="50">50ms</option>
                    <option value="100">100ms</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="fn-region">Region</label>
                <select id="fn-region" className="input">
                  <option value="global">Global (All Regions)</option>
                  <option value="us-east-1">US East</option>
                  <option value="eu-west-1">EU West</option>
                  <option value="ap-northeast-1">Asia Pacific</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="fn-code">Code</label>
                <textarea
                  id="fn-code"
                  className="input"
                  rows={8}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}
                  defaultValue={`export default {
  async fetch(request, env, ctx) {
    return new Response('Hello from the edge!', {
      headers: { 'content-type': 'text/plain' },
    });
  },
};`}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowNewFunction(false)}
              >
                Cancel
              </button>
              <button type="button" className="btn btn-primary">
                <Upload size={18} /> Deploy Function
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logs Modal */}
      {showLogs && (
        <div className="modal-overlay">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            onClick={() => setShowLogs(false)}
            aria-label="Close modal"
          />
          <div
            className="modal"
            style={{ maxWidth: '800px' }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setShowLogs(false)
            }}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header">
              <h2>
                <Terminal size={20} /> Function Logs
              </h2>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => setShowLogs(false)}
              >
                <XCircle size={18} />
              </button>
            </div>
            <div
              className="modal-body"
              style={{ maxHeight: '400px', overflow: 'auto' }}
            >
              <div
                style={{
                  background: 'var(--bg-primary)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.85rem',
                }}
              >
                {logs.map((log, i) => (
                  <div
                    key={log.requestId}
                    style={{
                      display: 'flex',
                      gap: '1rem',
                      padding: '0.5rem 0',
                      borderBottom:
                        i < logs.length - 1
                          ? '1px solid var(--border)'
                          : 'none',
                      color:
                        log.level === 'error'
                          ? 'var(--error)'
                          : log.level === 'warn'
                            ? 'var(--warning)'
                            : 'var(--text-primary)',
                    }}
                  >
                    <span
                      style={{ color: 'var(--text-muted)', minWidth: '80px' }}
                    >
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span
                      className={`badge badge-${log.level === 'error' ? 'error' : log.level === 'warn' ? 'warning' : 'info'}`}
                      style={{ minWidth: '50px', textAlign: 'center' }}
                    >
                      {log.level.toUpperCase()}
                    </span>
                    <span style={{ flex: 1 }}>{log.message}</span>
                    <span
                      style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}
                    >
                      {log.requestId}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary">
                <RefreshCw size={18} /> Refresh
              </button>
              <button type="button" className="btn btn-primary">
                <ExternalLink size={18} /> Full Logs
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
