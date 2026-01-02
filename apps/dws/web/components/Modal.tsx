import { X } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useRef } from 'react'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string | ReactNode
  titleId?: string
  size?: 'default' | 'large' | 'xlarge'
  children: ReactNode
  footer?: ReactNode
  showCloseButton?: boolean
  closeOnOverlayClick?: boolean
  closeOnEscape?: boolean
}

export default function Modal({
  isOpen,
  onClose,
  title,
  titleId = 'modal-title',
  size = 'default',
  children,
  footer,
  showCloseButton = true,
  closeOnOverlayClick = true,
  closeOnEscape = true,
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (closeOnEscape && e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    },
    [closeOnEscape, onClose],
  )

  // Handle keyboard events
  useEffect(() => {
    if (!isOpen) return

    previouslyFocusedRef.current = document.activeElement as HTMLElement
    document.addEventListener('keydown', handleKeyDown)

    // Focus the modal when it opens
    if (modalRef.current) {
      modalRef.current.focus()
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      // Restore focus when modal closes
      if (previouslyFocusedRef.current) {
        previouslyFocusedRef.current.focus()
      }
    }
  }, [isOpen, handleKeyDown])

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  if (!isOpen) return null

  const sizeClass =
    size === 'large' ? 'modal-large' : size === 'xlarge' ? 'modal-xlarge' : ''

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
    >
      <button
        type="button"
        className="modal-backdrop"
        onClick={closeOnOverlayClick ? onClose : undefined}
        tabIndex={-1}
        aria-label="Close modal"
      />
      <div ref={modalRef} className={`modal ${sizeClass}`} tabIndex={-1}>
        {title && (
          <div className="modal-header">
            {typeof title === 'string' ? (
              <h3 id={titleId} className="modal-title">
                {title}
              </h3>
            ) : (
              <div id={titleId}>{title}</div>
            )}
            {showCloseButton && (
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={onClose}
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            )}
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}

// Helper for simple content modals
export function useModal() {
  const modalRef = useRef<{ isOpen: boolean; setOpen: (v: boolean) => void }>()
  return modalRef
}
