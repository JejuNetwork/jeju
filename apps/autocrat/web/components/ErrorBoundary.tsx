import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'

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

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null })
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div
          className="min-h-screen flex items-center justify-center p-4"
          style={{ backgroundColor: 'var(--bg-primary)' }}
        >
          <div className="text-center max-w-md">
            <div
              className="w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center"
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
              }}
            >
              <AlertTriangle
                className="w-10 h-10"
                style={{ color: 'var(--color-error)' }}
              />
            </div>
            <h1
              className="text-2xl font-bold mb-2"
              style={{ color: 'var(--text-primary)' }}
            >
              Something went wrong
            </h1>
            <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
              An unexpected error occurred. Please try refreshing the page.
            </p>
            {this.state.error && (
              <pre
                className="text-left text-xs p-4 rounded-lg mb-6 overflow-auto max-h-32"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--color-error)',
                }}
              >
                {this.state.error.message}
              </pre>
            )}
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-white transition-all"
              style={{ background: 'var(--gradient-primary)' }}
            >
              <RefreshCw className="w-4 h-4" />
              Refresh Page
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
