/**
 * ErrorState Component
 *
 * Error state with icon, message, and retry option.
 */

import { AlertTriangle, RefreshCw } from 'lucide-react'

interface ErrorStateProps {
  title?: string
  message?: string
  onRetry?: () => void
}

export function ErrorState({
  title = 'Something went wrong',
  message = 'We encountered an error loading this content. Please try again.',
  onRetry,
}: ErrorStateProps) {
  return (
    <div
      className="card p-8 sm:p-12 text-center animate-in"
      role="alert"
      aria-labelledby="error-title"
      aria-describedby="error-description"
    >
      <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-error-500/10 border border-error-500/20 flex items-center justify-center">
        <AlertTriangle
          className="w-8 h-8 text-error-400"
          aria-hidden="true"
        />
      </div>

      <h3
        id="error-title"
        className="text-lg sm:text-xl font-semibold text-surface-200 mb-2 font-display"
      >
        {title}
      </h3>

      <p
        id="error-description"
        className="text-surface-400 text-sm sm:text-base mb-6 max-w-md mx-auto"
      >
        {message}
      </p>

      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="btn btn-secondary inline-flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Try Again
        </button>
      )}
    </div>
  )
}
