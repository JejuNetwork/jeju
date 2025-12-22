/**
 * OAuth Callback Handler
 *
 * Receives OAuth callbacks and posts result back to opener window.
 * Should be mounted at /auth/callback route.
 */

import { Check, Loader2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

export function AuthCallback() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>(
    'loading',
  )
  const [error, setError] = useState<string | null>(null)

  const postToOpener = useCallback(
    (data: { code?: string; state?: string; error?: string }) => {
      if (window.opener) {
        window.opener.postMessage(data, window.location.origin)
      }
    },
    [],
  )

  const handleCallback = useCallback(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')
    const errorParam = params.get('error')
    const errorDescription = params.get('error_description')

    if (errorParam) {
      setStatus('error')
      setError(errorDescription || errorParam)
      postToOpener({ error: errorDescription || errorParam })
      return
    }

    if (!code || !state) {
      setStatus('error')
      setError('Missing authorization code or state')
      postToOpener({ error: 'Missing authorization code or state' })
      return
    }

    // Verify state matches
    const storedState = sessionStorage.getItem('oauth_state')
    if (state !== storedState) {
      setStatus('error')
      setError('Invalid state parameter')
      postToOpener({ error: 'Invalid state parameter' })
      return
    }

    // Success - post back to opener
    setStatus('success')
    postToOpener({ code, state })

    // Clean up
    sessionStorage.removeItem('oauth_state')
    sessionStorage.removeItem('oauth_session_id')
    sessionStorage.removeItem('oauth_provider')

    // Close window after short delay
    setTimeout(() => {
      window.close()
    }, 1500)
  }, [postToOpener])

  useEffect(() => {
    handleCallback()
  }, [handleCallback])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4">
        {status === 'loading' && (
          <>
            <Loader2 className="w-12 h-12 animate-spin text-emerald-400 mx-auto" />
            <p className="text-lg text-muted-foreground">
              Completing sign in...
            </p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto">
              <Check className="w-6 h-6 text-emerald-400" />
            </div>
            <p className="text-lg text-emerald-400">Sign in successful</p>
            <p className="text-sm text-muted-foreground">
              This window will close automatically
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mx-auto">
              <X className="w-6 h-6 text-red-400" />
            </div>
            <p className="text-lg text-red-400">Sign in failed</p>
            <p className="text-sm text-muted-foreground">{error}</p>
            <button
              type="button"
              onClick={() => window.close()}
              className="mt-4 px-4 py-2 bg-secondary rounded-lg hover:bg-secondary/80 transition-colors"
            >
              Close
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default AuthCallback
