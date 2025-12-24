/**
 * 404 Not Found Page
 */

import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="text-6xl mb-4">🔥</div>
      <h1
        className="text-4xl font-bold mb-2"
        style={{ color: 'var(--text-primary)' }}
      >
        404
      </h1>
      <p className="text-lg mb-8" style={{ color: 'var(--text-secondary)' }}>
        Page not found
      </p>
      <Link to="/" className="btn-primary">
        Back to Home
      </Link>
    </div>
  )
}
