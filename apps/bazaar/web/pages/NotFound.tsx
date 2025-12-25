/**
 * Not Found Page (404)
 */

import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="text-8xl mb-6">🏝️</div>
      <h1
        className="text-4xl font-bold mb-4"
        style={{ color: 'var(--text-primary)' }}
      >
        Page Not Found
      </h1>
      <p className="text-lg mb-8" style={{ color: 'var(--text-secondary)' }}>
        The page you're looking for doesn't exist or has been moved.
      </p>
      <Link to="/" className="btn-primary">
        Back to Home
      </Link>
    </div>
  )
}
