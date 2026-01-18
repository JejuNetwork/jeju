import {
  AlertCircle,
  Box,
  Clock,
  Copy,
  Download,
  RefreshCw,
  Square,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useConfirm, useToast } from '../context/AppContext'
import { useCancelContainer, useContainerDetails } from '../hooks'
import { Skeleton } from './Skeleton'

interface ContainerLogsModalProps {
  executionId: string
  onClose: () => void
}

export default function ContainerLogsModal({
  executionId,
  onClose,
}: ContainerLogsModalProps) {
  const {
    data: container,
    isLoading,
    refetch,
  } = useContainerDetails(executionId)
  const cancelContainer = useCancelContainer()
  const { showSuccess, showError } = useToast()
  const confirm = useConfirm()
  const logsEndRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    },
    [onClose],
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleKeyDown])

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [autoScroll])

  const handleCopyLogs = () => {
    if (container?.logs) {
      navigator.clipboard.writeText(container.logs)
      showSuccess('Logs copied to clipboard')
    }
  }

  const handleDownloadLogs = () => {
    if (container?.logs) {
      const blob = new Blob([container.logs], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `container-${executionId}-logs.txt`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showSuccess('Logs downloaded')
    }
  }

  const handleCancel = async () => {
    const confirmed = await confirm({
      title: 'Cancel Container',
      message:
        'Are you sure you want to cancel this running container? This action cannot be undone.',
      confirmText: 'Cancel Container',
      destructive: true,
    })
    if (confirmed) {
      try {
        await cancelContainer.mutateAsync(executionId)
        showSuccess('Container cancelled')
      } catch (error) {
        showError(
          'Failed to cancel',
          error instanceof Error ? error.message : 'Unknown error',
        )
      }
    }
  }

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'running':
        return 'badge-info'
      case 'completed':
        return 'badge-success'
      case 'failed':
        return 'badge-error'
      case 'pending':
        return 'badge-warning'
      case 'cancelled':
        return 'badge-neutral'
      default:
        return 'badge-neutral'
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <button
        type="button"
        className="modal-backdrop"
        onClick={onClose}
        tabIndex={-1}
        aria-label="Close"
      />
      <div className="modal modal-large">
        <div className="modal-header">
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}
          >
            <Box size={20} />
            <h3 className="modal-title" style={{ margin: 0 }}>
              Container Execution
            </h3>
            {container && (
              <span
                className={`badge ${getStatusBadgeClass(container.status)}`}
              >
                {container.status}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {container?.status === 'running' && (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={handleCancel}
                disabled={cancelContainer.isPending}
              >
                <Square size={14} /> Stop
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => refetch()}
            >
              <RefreshCw size={14} />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          {isLoading ? (
            <div style={{ display: 'grid', gap: '1rem' }}>
              <Skeleton height="80px" />
              <Skeleton height="200px" />
            </div>
          ) : container ? (
            <>
              {/* Container Info */}
              <div
                className="container-info-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '1rem',
                  marginBottom: '1.5rem',
                }}
              >
                <div className="info-item">
                  <div
                    className="info-label"
                    style={{
                      color: 'var(--text-secondary)',
                      fontSize: '0.85rem',
                      marginBottom: '0.25rem',
                    }}
                  >
                    Execution ID
                  </div>
                  <div
                    className="info-value"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.9rem',
                    }}
                  >
                    {container.executionId}
                  </div>
                </div>
                <div className="info-item">
                  <div
                    className="info-label"
                    style={{
                      color: 'var(--text-secondary)',
                      fontSize: '0.85rem',
                      marginBottom: '0.25rem',
                    }}
                  >
                    Image
                  </div>
                  <div
                    className="info-value"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.9rem',
                    }}
                  >
                    {container.image}
                  </div>
                </div>
                {container.startedAt && (
                  <div className="info-item">
                    <div
                      className="info-label"
                      style={{
                        color: 'var(--text-secondary)',
                        fontSize: '0.85rem',
                        marginBottom: '0.25rem',
                      }}
                    >
                      <Clock
                        size={14}
                        style={{ display: 'inline', marginRight: '0.25rem' }}
                      />
                      Started
                    </div>
                    <div className="info-value" style={{ fontSize: '0.9rem' }}>
                      {new Date(container.startedAt).toLocaleString()}
                    </div>
                  </div>
                )}
                {container.metrics?.durationMs !== undefined && (
                  <div className="info-item">
                    <div
                      className="info-label"
                      style={{
                        color: 'var(--text-secondary)',
                        fontSize: '0.85rem',
                        marginBottom: '0.25rem',
                      }}
                    >
                      Duration
                    </div>
                    <div className="info-value" style={{ fontSize: '0.9rem' }}>
                      {(container.metrics.durationMs / 1000).toFixed(2)}s
                    </div>
                  </div>
                )}
                {container.exitCode !== undefined &&
                  container.exitCode !== null && (
                    <div className="info-item">
                      <div
                        className="info-label"
                        style={{
                          color: 'var(--text-secondary)',
                          fontSize: '0.85rem',
                          marginBottom: '0.25rem',
                        }}
                      >
                        Exit Code
                      </div>
                      <div
                        className="info-value"
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.9rem',
                          color:
                            container.exitCode === 0
                              ? 'var(--success)'
                              : 'var(--error)',
                        }}
                      >
                        {container.exitCode}
                      </div>
                    </div>
                  )}
              </div>

              {/* Output Section */}
              {container.output !== undefined && container.output !== null && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <h4
                    style={{
                      fontSize: '0.9rem',
                      color: 'var(--text-secondary)',
                      marginBottom: '0.5rem',
                    }}
                  >
                    Output
                  </h4>
                  <pre
                    style={{
                      background: 'var(--bg-tertiary)',
                      padding: '1rem',
                      borderRadius: 'var(--radius-md)',
                      fontSize: '0.85rem',
                      fontFamily: 'var(--font-mono)',
                      overflow: 'auto',
                      maxHeight: '150px',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {JSON.stringify(container.output, null, 2)}
                  </pre>
                </div>
              )}

              {/* Logs Section */}
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.5rem',
                  }}
                >
                  <h4
                    style={{
                      fontSize: '0.9rem',
                      color: 'var(--text-secondary)',
                      margin: 0,
                    }}
                  >
                    Logs
                  </h4>
                  <div
                    style={{
                      display: 'flex',
                      gap: '0.5rem',
                      alignItems: 'center',
                    }}
                  >
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        fontSize: '0.85rem',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={autoScroll}
                        onChange={(e) => setAutoScroll(e.target.checked)}
                      />
                      Auto-scroll
                    </label>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={handleCopyLogs}
                      disabled={!container.logs}
                      title="Copy logs"
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={handleDownloadLogs}
                      disabled={!container.logs}
                      title="Download logs"
                    >
                      <Download size={14} />
                    </button>
                  </div>
                </div>
                <div
                  className="logs-container"
                  style={{
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '1rem',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.8rem',
                    lineHeight: 1.6,
                    maxHeight: '300px',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {container.logs ? (
                    <>
                      {container.logs}
                      <div ref={logsEndRef} />
                    </>
                  ) : container.status === 'running' ||
                    container.status === 'pending' ? (
                    <div
                      style={{
                        color: 'var(--text-tertiary)',
                        fontStyle: 'italic',
                      }}
                    >
                      Waiting for logs...
                    </div>
                  ) : (
                    <div
                      style={{
                        color: 'var(--text-tertiary)',
                        fontStyle: 'italic',
                      }}
                    >
                      No logs available
                    </div>
                  )}
                </div>
              </div>

              {/* Error indicator */}
              {container.status === 'failed' && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    marginTop: '1rem',
                    padding: '0.75rem 1rem',
                    background: 'var(--error-soft)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--error)',
                  }}
                >
                  <AlertCircle size={16} />
                  <span>
                    Container execution failed with exit code{' '}
                    {container.exitCode ?? 'unknown'}
                  </span>
                </div>
              )}
            </>
          ) : (
            <div
              style={{
                textAlign: 'center',
                padding: '2rem',
                color: 'var(--text-secondary)',
              }}
            >
              Container not found
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
