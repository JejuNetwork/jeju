import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div
          className="min-h-[400px] flex flex-col items-center justify-center p-8"
          data-testid="error-boundary"
        >
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              color: 'var(--color-error)',
            }}
          >
            <AlertTriangle className="w-8 h-8" />
          </div>
          <h2
            className="text-xl font-bold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Something went wrong
          </h2>
          <p
            className="text-sm mb-6 text-center max-w-md"
            style={{ color: 'var(--text-secondary)' }}
          >
            {this.state.error?.message ?? 'An unexpected error occurred'}
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="btn-primary flex items-center gap-2"
            data-testid="error-retry-button"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
