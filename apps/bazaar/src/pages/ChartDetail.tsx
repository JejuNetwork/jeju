/**
 * Chart Detail Page
 */

import { Link, useParams } from 'react-router-dom'

export default function ChartDetailPage() {
  const { address } = useParams<{ address: string }>()

  return (
    <div>
      <Link
        to="/charts"
        className="text-sm mb-4 inline-block"
        style={{ color: 'var(--text-secondary)' }}
      >
        ← Back to Charts
      </Link>

      <div className="mb-6">
        <h1
          className="text-2xl sm:text-3xl md:text-4xl font-bold mb-1"
          style={{ color: 'var(--text-primary)' }}
        >
          📊 Token Chart
        </h1>
        <p
          className="text-sm font-mono"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {address}
        </p>
      </div>

      <div className="card p-6">
        <div
          className="h-64 flex items-center justify-center"
          style={{ backgroundColor: 'var(--bg-secondary)' }}
        >
          <span style={{ color: 'var(--text-tertiary)' }}>
            Chart loading...
          </span>
        </div>
      </div>
    </div>
  )
}
