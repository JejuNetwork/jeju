/**
 * Hyperscape Game Page
 */

import { Link } from 'react-router-dom'

export default function HyperscapePage() {
  return (
    <div>
      <Link
        to="/games"
        className="text-sm mb-4 inline-block"
        style={{ color: 'var(--text-secondary)' }}
      >
        ← Back to Games
      </Link>

      <div className="mb-6">
        <h1
          className="text-2xl sm:text-3xl md:text-4xl font-bold mb-1"
          style={{ color: 'var(--text-primary)' }}
        >
          🚀 Hyperscape
        </h1>
        <p
          className="text-sm sm:text-base"
          style={{ color: 'var(--text-secondary)' }}
        >
          Fast-paced trading simulation game
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card p-6">
          <div
            className="aspect-video rounded-xl flex items-center justify-center mb-4"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <span className="text-6xl">🚀</span>
          </div>
          <h2
            className="text-xl font-bold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Game Loading...
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            Connect your wallet to start playing
          </p>
        </div>

        <div className="space-y-4">
          <div className="card p-5">
            <h3
              className="font-bold mb-3"
              style={{ color: 'var(--text-primary)' }}
            >
              📊 Your Stats
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-tertiary)' }}>
                  Games Played
                </span>
                <span style={{ color: 'var(--text-primary)' }}>0</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-tertiary)' }}>Win Rate</span>
                <span style={{ color: 'var(--text-primary)' }}>--%</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-tertiary)' }}>
                  Total Earned
                </span>
                <span className="text-green-400">0 JEJU</span>
              </div>
            </div>
          </div>

          <div className="card p-5">
            <h3
              className="font-bold mb-3"
              style={{ color: 'var(--text-primary)' }}
            >
              🏆 Leaderboard
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>🥇 Player1</span>
                <span className="text-green-400">5,420 JEJU</span>
              </div>
              <div className="flex justify-between">
                <span>🥈 Player2</span>
                <span className="text-green-400">3,210 JEJU</span>
              </div>
              <div className="flex justify-between">
                <span>🥉 Player3</span>
                <span className="text-green-400">2,100 JEJU</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
