import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

type AuthMethod = 'siwe' | 'siwf' | 'passkey' | 'social'

interface AuthSession {
  address: string
  method: AuthMethod
  expiresAt: number
}

interface OAuth3CallbackResponse {
  address: string
  provider: string
}

export default function AuthCallbackPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const errorParam = searchParams.get('error')

    if (errorParam) {
      setError(errorParam)
      return
    }

    if (!code || !state) {
      setError('Invalid callback parameters')
      return
    }

    const storedState = sessionStorage.getItem('oauth3_state')
    if (state !== storedState) {
      setError('State mismatch - possible CSRF attack')
      return
    }

    // Exchange code for session
    async function exchangeCode() {
      const oauth3Url =
        import.meta.env.VITE_OAUTH3_AGENT_URL || 'http://localhost:4200'

      const response = await fetch(`${oauth3Url}/auth/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, state }),
      })

      if (!response.ok) {
        setError('Failed to complete authentication')
        return
      }

      const data: OAuth3CallbackResponse = await response.json()

      const session: AuthSession = {
        address: data.address,
        method: data.provider === 'farcaster' ? 'siwf' : 'social',
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      }

      localStorage.setItem('autocrat_session', JSON.stringify(session))
      sessionStorage.removeItem('oauth3_state')

      navigate('/')
    }

    exchangeCode()
  }, [searchParams, navigate])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <div className="text-red-500 text-lg">Authentication Failed</div>
        <p className="text-gray-500">{error}</p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="btn-primary"
        >
          Return to Dashboard
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
      <p className="text-gray-500">Completing authentication...</p>
    </div>
  )
}
