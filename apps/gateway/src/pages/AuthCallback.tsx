/**
 * OAuth3 Callback Handler for Gateway
 */

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';

export function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function handleCallback() {
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const errorParam = searchParams.get('error');

      if (errorParam) {
        setStatus('error');
        setError(errorParam);
        return;
      }

      if (!code || !state) {
        setStatus('error');
        setError('Missing code or state parameter');
        return;
      }

      // Verify state
      const storedState = sessionStorage.getItem('oauth3_state');
      if (state !== storedState) {
        setStatus('error');
        setError('Invalid state - possible CSRF attack');
        return;
      }

      try {
        const oauth3Url = import.meta.env.VITE_OAUTH3_AGENT_URL || 'http://localhost:4200';
        
        const response = await fetch(`${oauth3Url}/auth/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, state }),
        });

        if (!response.ok) {
          throw new Error(`Auth callback failed: ${response.status}`);
        }

        const session = await response.json();

        localStorage.setItem('gateway_auth_session', JSON.stringify({
          ...session,
          expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        }));

        sessionStorage.removeItem('oauth3_state');
        sessionStorage.removeItem('oauth3_provider');

        setStatus('success');
        
        setTimeout(() => navigate('/'), 1500);
      } catch (err) {
        setStatus('error');
        setError((err as Error).message);
      }
    }

    handleCallback();
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4">
        {status === 'loading' && (
          <>
            <Loader2 className="w-16 h-16 animate-spin mx-auto text-violet-500" />
            <h1 className="text-2xl font-bold text-foreground">Signing you in...</h1>
            <p className="text-muted-foreground">Please wait while we complete authentication</p>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle className="w-16 h-16 mx-auto text-emerald-500" />
            <h1 className="text-2xl font-bold text-emerald-400">Success!</h1>
            <p className="text-muted-foreground">Redirecting you back...</p>
          </>
        )}

        {status === 'error' && (
          <>
            <XCircle className="w-16 h-16 mx-auto text-red-500" />
            <h1 className="text-2xl font-bold text-red-400">Authentication Failed</h1>
            <p className="text-muted-foreground">{error}</p>
            <button
              onClick={() => navigate('/')}
              className="mt-4 px-6 py-2 rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700 transition-colors"
            >
              Back to Home
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default AuthCallback;
