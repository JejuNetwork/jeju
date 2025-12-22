'use client'

/**
 * OAuth3 Callback Handler for Autocrat
 */

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'

function CallbackHandler() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>(
    'loading',
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function handleCallback() {
      const code = searchParams.get('code')
      const state = searchParams.get('state')
      const errorParam = searchParams.get('error')

      if (errorParam) {
        setStatus('error')
        setError(errorParam)
        return
      }

      if (!code || !state) {
        setStatus('error')
        setError('Missing code or state parameter')
        return
      }

      const storedState = sessionStorage.getItem('oauth3_state')
      if (state !== storedState) {
        setStatus('error')
        setError('Invalid state - possible CSRF attack')
        return
      }

      try {
        const oauth3Url =
          process.env.NEXT_PUBLIC_OAUTH3_AGENT_URL || 'http://localhost:4200'

        const response = await fetch(`${oauth3Url}/auth/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, state }),
        })

        if (!response.ok) {
          throw new Error(`Auth callback failed: ${response.status}`)
        }

        const session = await response.json()

        localStorage.setItem(
          'autocrat_session',
          JSON.stringify({
            ...session,
            expiresAt: Date.now() + 24 * 60 * 60 * 1000,
          }),
        )

        sessionStorage.removeItem('oauth3_state')
        setStatus('success')

        setTimeout(() => router.push('/'), 1000)
      } catch (err) {
        setStatus('error')
        setError((err as Error).message)
      }
    }

    handleCallback()
  }, [searchParams, router])

  return (
    <div className="text-center space-y-4">
      {status === 'loading' && (
        <>
          <div className="text-6xl animate-bounce">🏛️</div>
          <h1 className="text-2xl font-bold">Signing you in...</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Please wait</p>
        </>
      )}

      {status === 'success' && (
        <>
          <div className="text-6xl">✅</div>
          <h1 className="text-2xl font-bold text-emerald-500">Success!</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Redirecting...</p>
        </>
      )}

      {status === 'error' && (
        <>
          <div className="text-6xl">❌</div>
          <h1 className="text-2xl font-bold text-red-500">Failed</h1>
          <p style={{ color: 'var(--text-secondary)' }}>{error}</p>
          <button onClick={() => router.push('/')} className="mt-4 btn-primary">
            Back to Home
          </button>
        </>
      )}
    </div>
  )
}

function LoadingFallback() {
  return (
    <div className="text-center space-y-4">
      <div className="text-6xl animate-bounce">🏛️</div>
      <h1 className="text-2xl font-bold">Loading...</h1>
    </div>
  )
}

export default function AuthCallbackPage() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Suspense fallback={<LoadingFallback />}>
        <CallbackHandler />
      </Suspense>
    </div>
  )
}
