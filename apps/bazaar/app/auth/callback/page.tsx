'use client'

/**
 * OAuth3 Callback Handler
 *
 * Handles the callback from OAuth3 agent after social/Farcaster authentication.
 */

import { useRouter, useSearchParams } from 'next/navigation'
import { type JSX, Suspense, useEffect, useState } from 'react'

function AuthCallbackContent(): JSX.Element {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>(
    'loading',
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function handleCallback() {
      if (!searchParams) {
        setStatus('error')
        setError('No search params')
        return
      }

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

      // Verify state
      const storedState = sessionStorage.getItem('oauth3_state')
      if (state !== storedState) {
        setStatus('error')
        setError('Invalid state - possible CSRF attack')
        return
      }

      try {
        // Complete auth with OAuth3 agent
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

        // Store session
        localStorage.setItem(
          'bazaar_session',
          JSON.stringify({
            ...session,
            expiresAt: Date.now() + 24 * 60 * 60 * 1000,
          }),
        )

        // Clean up
        sessionStorage.removeItem('oauth3_state')
        sessionStorage.removeItem('oauth3_provider')

        setStatus('success')

        // Redirect to home or previous page
        const returnTo = sessionStorage.getItem('auth_return_to') || '/'
        sessionStorage.removeItem('auth_return_to')

        setTimeout(() => router.push(returnTo), 1000)
      } catch (err) {
        setStatus('error')
        setError((err as Error).message)
      }
    }

    handleCallback()
  }, [searchParams, router])

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: 'var(--bg)' }}
    >
      <div className="text-center space-y-4">
        {status === 'loading' && (
          <>
            <div className="text-6xl animate-bounce">🏝️</div>
            <h1 className="text-2xl font-bold">Signing you in...</h1>
            <p style={{ color: 'var(--text-secondary)' }}>
              Please wait while we complete authentication
            </p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="text-6xl">✅</div>
            <h1 className="text-2xl font-bold text-emerald-400">Success!</h1>
            <p style={{ color: 'var(--text-secondary)' }}>
              Redirecting you back...
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="text-6xl">❌</div>
            <h1 className="text-2xl font-bold text-red-400">
              Authentication Failed
            </h1>
            <p style={{ color: 'var(--text-secondary)' }}>{error}</p>
            <button
              onClick={() => router.push('/')}
              className="mt-4 px-6 py-2 rounded-xl bg-emerald-500 text-white font-medium hover:bg-emerald-600 transition-colors"
            >
              Back to Home
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default function AuthCallbackPage(): JSX.Element {
  return (
    <Suspense
      fallback={
        <div
          className="min-h-screen flex items-center justify-center"
          style={{ backgroundColor: 'var(--bg)' }}
        >
          <div className="text-center space-y-4">
            <div className="text-6xl animate-bounce">🏝️</div>
            <h1 className="text-2xl font-bold">Loading...</h1>
          </div>
        </div>
      }
    >
      <AuthCallbackContent />
    </Suspense>
  )
}
