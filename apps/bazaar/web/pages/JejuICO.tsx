/**
 * JEJU ICO Page
 */

import { Link } from 'react-router-dom'

export default function JejuICOPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1
        className="text-3xl md:text-4xl font-bold mb-4 text-center"
        style={{ color: 'var(--text-primary)' }}
      >
        🏝️ JEJU Token Sale
      </h1>

      <div className="card p-6 mb-6">
        <div className="text-center mb-6">
          <div className="text-6xl mb-4">🏝️</div>
          <h2
            className="text-2xl font-bold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            JEJU Token
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            Governance and utility token for the Jeju Network
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div
            className="p-4 rounded-xl"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              Price
            </p>
            <p
              className="text-xl font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              $0.05
            </p>
          </div>
          <div
            className="p-4 rounded-xl"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              Raised
            </p>
            <p
              className="text-xl font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              $2.5M
            </p>
          </div>
        </div>

        <div className="progress-bar mb-4">
          <div
            className="progress-bar-fill progress-bar-primary"
            style={{ width: '50%' }}
          />
        </div>
        <p
          className="text-center text-sm mb-6"
          style={{ color: 'var(--text-tertiary)' }}
        >
          50% of target reached
        </p>

        <button type="button" className="btn-primary w-full py-3 mb-4">
          Participate in ICO
        </button>

        <Link
          to="/coins/jeju-ico/whitepaper"
          className="btn-secondary w-full py-3 text-center block"
        >
          Read Whitepaper
        </Link>
      </div>
    </div>
  )
}
