'use client';

/**
 * AuthButton - Universal Authentication for Autocrat
 * 
 * Supports:
 * - Wallet (MetaMask, WalletConnect) with SIWE
 * - Farcaster (SIWF)
 * - Passkeys (WebAuthn)
 * - Social OAuth (Google, GitHub, Twitter, Discord)
 */

import { useState, useEffect } from 'react';
import { useAccount, useConnect, useDisconnect, useSignMessage } from 'wagmi';
import { injected, walletConnect } from 'wagmi/connectors';
import { X, Wallet, Key, Fingerprint, Chrome, Github, Loader2 } from 'lucide-react';

interface AuthSession {
  address: string;
  method: 'siwe' | 'siwf' | 'passkey' | 'social';
  expiresAt: number;
}

interface AuthButtonProps {
  onSuccess?: (session: AuthSession) => void;
  className?: string;
}

const CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '420691', 10);
const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '';

export function AuthButton({ onSuccess, className = '' }: AuthButtonProps) {
  const [showModal, setShowModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasPasskeys, setHasPasskeys] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { address, isConnected } = useAccount();
  const { connectAsync } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();

  useEffect(() => {
    if (typeof window !== 'undefined' && window.PublicKeyCredential) {
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
        .then(setHasPasskeys)
        .catch(() => setHasPasskeys(false));
    }
  }, []);

  const handleWalletConnect = async (type: 'injected' | 'walletConnect') => {
    setIsLoading(true);
    setError(null);

    try {
      const connector = type === 'injected' 
        ? injected()
        : walletConnect({ projectId: WALLETCONNECT_PROJECT_ID });

      const result = await connectAsync({ connector });
      const walletAddress = result.accounts[0];

      // SIWE message
      const now = new Date();
      const message = [
        `${window.location.host} wants you to sign in with your Ethereum account:`,
        walletAddress,
        '',
        'Sign in to Autocrat DAO',
        '',
        `URI: ${window.location.origin}`,
        `Version: 1`,
        `Chain ID: ${CHAIN_ID}`,
        `Nonce: ${Math.random().toString(36).slice(2)}`,
        `Issued At: ${now.toISOString()}`,
      ].join('\n');

      await signMessageAsync({ message });

      const session: AuthSession = {
        address: walletAddress,
        method: 'siwe',
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      };

      localStorage.setItem('autocrat_session', JSON.stringify(session));
      onSuccess?.(session);
      setShowModal(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFarcaster = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const oauth3Url = process.env.NEXT_PUBLIC_OAUTH3_AGENT_URL || 'http://localhost:4200';
      const redirectUri = `${window.location.origin}/auth/callback`;

      const response = await fetch(`${oauth3Url}/auth/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'farcaster',
          appId: 'autocrat.apps.jeju',
          redirectUri,
        }),
      });

      if (!response.ok) throw new Error('Failed to initialize Farcaster auth');

      const { authUrl, state } = await response.json();
      sessionStorage.setItem('oauth3_state', state);
      window.location.href = authUrl;
    } catch (err) {
      setError((err as Error).message);
      setIsLoading(false);
    }
  };

  const handleSocial = async (provider: 'google' | 'github') => {
    setIsLoading(true);
    setError(null);

    try {
      const oauth3Url = process.env.NEXT_PUBLIC_OAUTH3_AGENT_URL || 'http://localhost:4200';
      const redirectUri = `${window.location.origin}/auth/callback`;

      const response = await fetch(`${oauth3Url}/auth/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          appId: 'autocrat.apps.jeju',
          redirectUri,
        }),
      });

      if (!response.ok) throw new Error(`Failed to initialize ${provider} auth`);

      const { authUrl, state } = await response.json();
      sessionStorage.setItem('oauth3_state', state);
      window.location.href = authUrl;
    } catch (err) {
      setError((err as Error).message);
      setIsLoading(false);
    }
  };

  const handlePasskey = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rpId: window.location.hostname,
          userVerification: 'preferred',
          timeout: 60000,
        },
      });

      if (!credential) throw new Error('Passkey authentication cancelled');

      const session: AuthSession = {
        address: `passkey:${credential.id.slice(0, 20)}`,
        method: 'passkey',
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      };

      localStorage.setItem('autocrat_session', JSON.stringify(session));
      onSuccess?.(session);
      setShowModal(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  // Already connected
  if (isConnected && address) {
    return (
      <button
        onClick={() => disconnectAsync()}
        className={`btn-secondary text-xs py-2 px-3 ${className}`}
      >
        <span className="hidden sm:inline">{address.slice(0, 6)}...</span>
        <span className="sm:hidden">{address.slice(0, 4)}...</span>
      </button>
    );
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className={`btn-primary text-xs py-2 px-3 ${className}`}
      >
        Connect
      </button>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          
          <div 
            className="relative w-full max-w-sm rounded-xl border shadow-2xl"
            style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2">
                <span className="text-xl">🏛️</span>
                <span className="font-semibold">Sign In</span>
              </div>
              <button onClick={() => setShowModal(false)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
                <X size={18} />
              </button>
            </div>

            {/* Error */}
            {error && (
              <div className="mx-4 mt-4 p-2 rounded bg-red-500/10 border border-red-500/30 text-red-500 text-xs">
                {error}
              </div>
            )}

            {/* Content */}
            <div className="p-4 space-y-3">
              {/* Wallet */}
              <button
                onClick={() => handleWalletConnect('injected')}
                disabled={isLoading}
                className="w-full flex items-center gap-3 p-3 rounded-lg border transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                style={{ borderColor: 'var(--border)' }}
              >
                <Wallet size={20} />
                <div className="flex-1 text-left">
                  <p className="text-sm font-medium">MetaMask</p>
                </div>
                {isLoading && <Loader2 size={16} className="animate-spin" />}
              </button>

              {/* Farcaster */}
              <button
                onClick={handleFarcaster}
                disabled={isLoading}
                className="w-full flex items-center gap-3 p-3 rounded-lg border transition-colors hover:bg-purple-500/10"
                style={{ borderColor: 'var(--border)' }}
              >
                <div className="w-5 h-5 rounded bg-purple-600 flex items-center justify-center">
                  <span className="text-white text-[10px] font-bold">FC</span>
                </div>
                <div className="flex-1 text-left">
                  <p className="text-sm font-medium">Farcaster</p>
                </div>
              </button>

              {/* Social */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleSocial('google')}
                  disabled={isLoading}
                  className="flex items-center justify-center gap-2 p-2.5 rounded-lg border transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <Chrome size={16} />
                  <span className="text-xs">Google</span>
                </button>
                <button
                  onClick={() => handleSocial('github')}
                  disabled={isLoading}
                  className="flex items-center justify-center gap-2 p-2.5 rounded-lg border transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <Github size={16} />
                  <span className="text-xs">GitHub</span>
                </button>
              </div>

              {/* Passkey */}
              {hasPasskeys && (
                <button
                  onClick={handlePasskey}
                  disabled={isLoading}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border transition-colors hover:bg-emerald-500/10"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <Fingerprint size={20} className="text-emerald-500" />
                  <div className="flex-1 text-left">
                    <p className="text-sm font-medium">Passkey</p>
                  </div>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default AuthButton;
