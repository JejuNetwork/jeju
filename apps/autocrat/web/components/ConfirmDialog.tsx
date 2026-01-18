import { AlertTriangle, X } from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'

interface ConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'warning' | 'info'
  isLoading?: boolean
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  isLoading = false,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (isOpen) {
      dialog.showModal()
      cancelButtonRef.current?.focus()
    } else {
      dialog.close()
    }
  }, [isOpen])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    },
    [onClose],
  )

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === dialogRef.current) {
        onClose()
      }
    },
    [onClose],
  )

  const variantStyles = {
    danger: {
      iconBg: 'rgba(239, 68, 68, 0.12)',
      iconColor: 'var(--color-error)',
      buttonBg: 'var(--color-error)',
    },
    warning: {
      iconBg: 'rgba(245, 158, 11, 0.12)',
      iconColor: 'var(--color-warning)',
      buttonBg: 'var(--color-warning)',
    },
    info: {
      iconBg: 'rgba(6, 214, 160, 0.12)',
      iconColor: 'var(--color-primary)',
      buttonBg: 'var(--color-primary)',
    },
  }

  const styles = variantStyles[variant]

  if (!isOpen) return null

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 z-50 m-0 max-w-none max-h-none w-full h-full bg-transparent backdrop:bg-black/50"
      onKeyDown={handleKeyDown}
      onClick={handleBackdropClick}
      aria-labelledby="dialog-title"
      aria-describedby="dialog-description"
    >
      <div className="flex items-center justify-center min-h-full p-4">
        <div
          className="w-full max-w-md rounded-2xl p-6 animate-scale-in"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-elevated)',
          }}
        >
          {/* Header */}
          <div className="flex items-start gap-4">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: styles.iconBg }}
            >
              <AlertTriangle
                className="w-6 h-6"
                style={{ color: styles.iconColor }}
              />
            </div>
            <div className="flex-1 min-w-0">
              <h3
                id="dialog-title"
                className="text-lg font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                {title}
              </h3>
              <p
                id="dialog-description"
                className="mt-1 text-sm"
                style={{ color: 'var(--text-secondary)' }}
              >
                {description}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg transition-colors hover:bg-[var(--bg-secondary)]"
              style={{ color: 'var(--text-tertiary)' }}
              aria-label="Close dialog"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Actions */}
          <div className="mt-6 flex gap-3 justify-end">
            <button
              ref={cancelButtonRef}
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2.5 rounded-xl font-medium transition-colors"
              style={{
                backgroundColor: 'var(--surface)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
              }}
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isLoading}
              className="px-4 py-2.5 rounded-xl font-semibold text-white transition-all disabled:opacity-60"
              style={{ backgroundColor: styles.buttonBg }}
            >
              {isLoading ? 'Processing...' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  )
}
