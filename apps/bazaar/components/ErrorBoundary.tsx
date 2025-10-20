'use client'

import { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="min-h-screen flex items-center justify-center">
            <div className="max-w-md p-8 rounded-xl bg-red-500/10 border border-red-500/50 text-center">
              <div className="text-6xl mb-4">⚠️</div>
              <h2 className="text-2xl font-bold mb-2">Something went wrong</h2>
              <p className="text-slate-400 mb-6">
                {this.state.error?.message || 'An unexpected error occurred'}
              </p>
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-3 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 font-semibold transition-all"
              >
                Reload Page
              </button>
            </div>
          </div>
        )
      )
    }

    return this.props.children
  }
}

