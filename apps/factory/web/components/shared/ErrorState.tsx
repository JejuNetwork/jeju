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
      className="relative bg-gradient-to-br from-surface-800/90 to-surface-900/95 border border-error-500/30 p-8 sm:p-12 text-center animate-in"
      style={{
        clipPath:
          'polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px))',
      }}
      role="alert"
      aria-labelledby="error-title"
      aria-describedby="error-description"
    >
      {/* Corner accents - error colored */}
      <div className="absolute top-0 right-0 w-4 h-4 bg-gradient-to-bl from-error-500/50 to-transparent" />
      <div className="absolute bottom-0 left-0 w-4 h-4 bg-gradient-to-tr from-error-500/50 to-transparent" />

      <div
        className="w-16 h-16 mx-auto mb-5 bg-error-500/10 border border-error-500/30 flex items-center justify-center"
        style={{
          clipPath: 'polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%)',
        }}
      >
        <AlertTriangle className="w-8 h-8 text-error-400" aria-hidden="true" />
      </div>

      <h3
        id="error-title"
        className="text-lg sm:text-xl font-bold text-surface-200 mb-2 font-display uppercase tracking-wider"
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
