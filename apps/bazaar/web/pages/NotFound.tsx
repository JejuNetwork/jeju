/**
 * Not Found Page (404)
 *
 * Friendly error page for missing routes
 */

import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 animate-fade-in">
      <div className="text-8xl md:text-9xl mb-6 animate-float" aria-hidden="true">
        🏝️
      </div>
      <h1 className="text-3xl md:text-5xl font-bold text-gradient mb-4">
        Page Not Found
      </h1>
      <p className="text-lg md:text-xl text-secondary mb-8 max-w-md">
        Looks like you've wandered off the island. Let's get you back to familiar shores.
      </p>
      <div className="flex flex-col sm:flex-row gap-4">
        <Link to="/" className="btn-primary">
          Back to Home
        </Link>
        <Link to="/coins" className="btn-secondary">
          Explore Coins
        </Link>
      </div>
    </div>
  )
}
