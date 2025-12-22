/**
 * Charts Page
 */

import { Link } from 'react-router-dom'

export default function ChartsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1
          className="text-2xl sm:text-3xl md:text-4xl font-bold mb-1"
          style={{ color: 'var(--text-primary)' }}
        >
          📊 Charts
        </h1>
        <p
          className="text-sm sm:text-base"
          style={{ color: 'var(--text-secondary)' }}
        >
          Token price charts and analytics
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Link
          to="/charts/0x0000000000000000000000000000000000000000"
          className="card p-5 hover:scale-[1.02] transition-all"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-gradient-to-r from-blue-500 to-cyan-500 flex items-center justify-center text-white font-bold">
              ETH
            </div>
            <div>
              <h3
                className="font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                Ethereum
              </h3>
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                ETH
              </p>
            </div>
          </div>
          <div
            className="text-2xl font-bold"
            style={{ color: 'var(--text-primary)' }}
          >
            $3,450.00
          </div>
          <div className="text-sm text-green-400">+2.5%</div>
        </Link>
      </div>
    </div>
  )
}
