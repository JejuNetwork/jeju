import { AlertTriangle, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { Component } from 'react'

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
        <div className="card p-8 text-center animate-in">
          <div className="w-16 h-16 rounded-2xl bg-error-500/20 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-8 h-8 text-error-400" />
          </div>
          <h3 className="text-lg font-semibold text-surface-100 mb-2">
            Something went wrong
          </h3>
          <p className="text-surface-400 text-sm mb-4 max-w-md mx-auto">
            {this.state.error?.message ?? 'An unexpected error occurred'}
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="btn btn-primary"
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
