import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { LoadingSpinner } from '../components/LoadingSpinner'

export default function AuthCallbackPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  useEffect(() => {
    // OAuth3 callback handling
    const code = searchParams.get('code')
    const error = searchParams.get('error')

    if (error) {
      console.error('Auth error:', error)
      navigate('/')
      return
    }

    if (code) {
      // OAuth3 will handle this automatically through the provider
      // Just redirect back to home after a short delay
      setTimeout(() => {
        navigate('/')
      }, 1000)
    } else {
      navigate('/')
    }
  }, [navigate, searchParams])

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <LoadingSpinner size="lg" />
      <p className="mt-4 text-lg" style={{ color: 'var(--text-secondary)' }}>
        Completing authentication...
      </p>
    </div>
  )
}
