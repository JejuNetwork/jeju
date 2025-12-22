/**
 * Error boundary for the predictions market page.
 * Converted from Next.js to React Router.
 * Uses useRouteError hook for error information.
 */

import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useNavigate, useRouteError } from 'react-router-dom'

interface RouteError {
  message?: string
  digest?: string
  status?: number
  statusText?: string
}

export default function PredictionsErrorPage() {
  const navigate = useNavigate()
  const error = useRouteError() as RouteError

  const handleRetry = () => {
    window.location.reload()
  }

  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center p-8">
      <div className="max-w-md text-center">
        <AlertTriangle className="mx-auto mb-4 h-16 w-16 text-orange-500" />
        <h2
          className="mb-2 font-bold text-2xl"
          style={{ color: 'var(--text-primary)' }}
        >
          Chart Loading Error
        </h2>
        <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
          There was an issue loading the prediction markets. This may be due to
          a temporary connection issue.
        </p>
        {error?.message && (
          <p className="mb-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Error: {error.message}
          </p>
        )}
        <div className="flex justify-center gap-4">
          <button
            type="button"
            onClick={handleRetry}
            className="btn-primary flex items-center gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Try again
          </button>
          <button
            type="button"
            onClick={() => navigate('/markets')}
            className="btn-secondary"
          >
            Back to Markets
          </button>
        </div>
      </div>
    </div>
  )
}
