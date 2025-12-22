/**
 * Share PnL Page
 * Converted from Next.js to React Router
 * Redirects to user profile
 */

import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { LoadingSpinner } from '../../components/LoadingSpinner'

export default function SharePnLPage() {
  const { userId } = useParams<{ userId?: string }>()
  const navigate = useNavigate()
  const decodedUserId = userId ? decodeURIComponent(userId) : ''

  useEffect(() => {
    if (!decodedUserId) {
      navigate('/', { replace: true })
      return
    }
    navigate(`/profile/${encodeURIComponent(decodedUserId)}`, { replace: true })
  }, [decodedUserId, navigate])

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center">
      <LoadingSpinner size="lg" />
      <h1
        className="mt-4 font-bold text-xl"
        style={{ color: 'var(--text-primary)' }}
      >
        Redirecting...
      </h1>
      <p style={{ color: 'var(--text-secondary)' }}>
        Taking you to the profile
      </p>
    </div>
  )
}
