/**
 * Games Page
 */

import { Link } from 'react-router-dom'

export default function GamesPage() {
  return (
    <div>
      <div className="mb-6">
        <h1
          className="text-2xl sm:text-3xl md:text-4xl font-bold mb-1"
          style={{ color: 'var(--text-primary)' }}
        >
          🎮 Games
        </h1>
        <p
          className="text-sm sm:text-base"
          style={{ color: 'var(--text-secondary)' }}
        >
          Play games and earn rewards
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Link
          to="/games/hyperscape"
          className="card p-5 hover:scale-[1.02] transition-all"
        >
          <div className="text-4xl mb-3">🚀</div>
          <h3
            className="text-lg font-bold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Hyperscape
          </h3>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Fast-paced trading simulation game
          </p>
          <div className="mt-4 flex items-center gap-2">
            <span className="badge badge-success">Live</span>
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              1,234 players
            </span>
          </div>
        </Link>

        <div className="card p-5 opacity-60">
          <div className="text-4xl mb-3">🎰</div>
          <h3
            className="text-lg font-bold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Lottery
          </h3>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Win big with daily draws
          </p>
          <div className="mt-4">
            <span className="badge badge-warning">Coming Soon</span>
          </div>
        </div>

        <div className="card p-5 opacity-60">
          <div className="text-4xl mb-3">🎯</div>
          <h3
            className="text-lg font-bold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Prediction Battles
          </h3>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Compete head-to-head in predictions
          </p>
          <div className="mt-4">
            <span className="badge badge-warning">Coming Soon</span>
          </div>
        </div>
      </div>
    </div>
  )
}
