import { AlertCircle, RefreshCw } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
    this.setState({ errorInfo })
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="error-boundary">
          <div className="error-boundary-content">
            <div className="error-boundary-icon">
              <AlertCircle size={48} />
            </div>
            <h2 className="error-boundary-title">Something went wrong</h2>
            <p className="error-boundary-message">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            <button type="button" className="button" onClick={this.handleReset}>
              <RefreshCw size={16} />
              <span>Try again</span>
            </button>
            {process.env.NODE_ENV === 'development' && this.state.errorInfo && (
              <details className="error-boundary-details">
                <summary>Error details</summary>
                <pre>{this.state.error?.stack}</pre>
                <pre>{this.state.errorInfo.componentStack}</pre>
              </details>
            )}
          </div>

          <style>{`
            .error-boundary {
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 400px;
              padding: 2rem;
            }

            .error-boundary-content {
              text-align: center;
              max-width: 400px;
            }

            .error-boundary-icon {
              width: 80px;
              height: 80px;
              margin: 0 auto 1.5rem;
              background: var(--error-soft);
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              color: var(--error);
            }

            .error-boundary-title {
              font-size: 1.5rem;
              font-weight: 700;
              margin-bottom: 0.5rem;
              color: var(--text-primary);
            }

            .error-boundary-message {
              color: var(--text-secondary);
              margin-bottom: 1.5rem;
            }

            .error-boundary-details {
              margin-top: 1.5rem;
              text-align: left;
              background: var(--surface-hover);
              padding: 1rem;
              border-radius: var(--radius-md);
            }

            .error-boundary-details summary {
              cursor: pointer;
              color: var(--text-secondary);
              font-size: 0.875rem;
            }

            .error-boundary-details pre {
              font-size: 0.75rem;
              overflow-x: auto;
              margin-top: 0.5rem;
              color: var(--error);
            }
          `}</style>
        </div>
      )
    }

    return this.props.children
  }
}
