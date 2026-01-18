import { useEffect, useState } from 'react'

type CallbackStatus = 'loading' | 'success' | 'error'

export function AuthCallback() {
  const [status, setStatus] = useState<CallbackStatus>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')
    const errorParam = params.get('error')
    const errorDescription = params.get('error_description')

    const postToOpener = (data: {
      code?: string
      state?: string
      error?: string
    }) => {
      if (window.opener) {
        window.opener.postMessage(data, window.location.origin)
      }
    }

    if (errorParam) {
      const message = errorDescription || errorParam
      setStatus('error')
      setError(message)
      postToOpener({ error: message })
      return
    }

    if (!code || !state) {
      setStatus('error')
      setError('Missing authorization code or state')
      postToOpener({ error: 'Missing authorization code or state' })
      return
    }

    const storedState = sessionStorage.getItem('oauth3_state')
    if (state !== storedState) {
      setStatus('error')
      setError('Invalid state parameter')
      postToOpener({ error: 'Invalid state parameter' })
      return
    }

    setStatus('success')
    postToOpener({ code, state })
    sessionStorage.removeItem('oauth3_state')
    sessionStorage.removeItem('oauth3_session_id')
    sessionStorage.removeItem('oauth3_provider')

    setTimeout(() => {
      window.close()
    }, 1500)
  }, [])

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0b0b0c',
        color: '#f5f5f7',
        padding: '24px',
        textAlign: 'center',
      }}
    >
      <div>
        {status === 'loading' && <p>Completing sign in...</p>}
        {status === 'success' && <p>Sign in successful. Closing...</p>}
        {status === 'error' && (
          <>
            <p>Sign in failed</p>
            {error && (
              <p style={{ color: '#f87171', marginTop: '8px' }}>{error}</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default AuthCallback
