/**
 * Confirmation Dialog - For destructive actions
 */

import { AlertTriangle } from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'
import { useApp } from '../context/AppContext'

export function ConfirmDialog() {
  const { confirmState, resolveConfirm } = useApp()
  const confirmButtonRef = useRef<HTMLButtonElement>(null)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        resolveConfirm(false)
      }
    },
    [resolveConfirm],
  )

  useEffect(() => {
    if (!confirmState) return

    document.addEventListener('keydown', handleKeyDown)
    // Focus confirm button when dialog opens
    confirmButtonRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [confirmState, handleKeyDown])

  if (!confirmState) return null

  const {
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    destructive = false,
  } = confirmState

  return (
    <div
      className="modal-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
    >
      <button
        type="button"
        className="modal-backdrop"
        onClick={() => resolveConfirm(false)}
        tabIndex={-1}
        aria-label="Cancel"
      />
      <div className="modal" style={{ maxWidth: '420px' }}>
        <div className="modal-body" style={{ padding: '1.5rem' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '1rem',
            }}
          >
            {destructive && (
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--error-soft)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <AlertTriangle size={20} style={{ color: 'var(--error)' }} />
              </div>
            )}
            <div>
              <h3
                id="confirm-title"
                style={{
                  fontSize: '1.1rem',
                  fontWeight: 600,
                  marginBottom: '0.5rem',
                }}
              >
                {title}
              </h3>
              <p
                id="confirm-message"
                style={{
                  color: 'var(--text-secondary)',
                  fontSize: '0.95rem',
                  lineHeight: 1.5,
                }}
              >
                {message}
              </p>
            </div>
          </div>
        </div>
        <div
          className="modal-footer"
          style={{ padding: '1rem 1.5rem', gap: '0.75rem' }}
        >
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => resolveConfirm(false)}
            style={{ flex: 1 }}
          >
            {cancelText}
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            className={`btn ${destructive ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => resolveConfirm(true)}
            style={{ flex: 1 }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
