/**
 * 404 Not Found Page
 */

import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div
        className="text-7xl md:text-8xl mb-6 animate-float"
        role="img"
        aria-label="Fire"
      >
        🔥
      </div>
      <h1 className="text-5xl md:text-6xl font-bold mb-3 font-display text-gradient">
        404
      </h1>
      <p
        className="text-lg md:text-xl mb-8 max-w-md"
        style={{ color: 'var(--text-secondary)' }}
      >
        Page not found
      </p>
      <div className="flex flex-wrap justify-center gap-4">
        <Link to="/" className="btn-primary">
          Home
        </Link>
        <Link to="/agents" className="btn-secondary">
          Agents
        </Link>
      </div>
    </div>
  )
}
