/**
 * AuthModal - Enhanced Authentication Modal for Gateway
 * 
 * Integrates:
 * - RainbowKit wallet connections (MetaMask, WalletConnect, Coinbase, etc.)
 * - SIWE (Sign In With Ethereum) 
 * - SIWF (Sign In With Farcaster)
 * - Passkeys (WebAuthn)
 * - Social logins via OAuth3
 */

import { useState, useEffect } from 'react';
import { useAccount, useSignMessage, useDisconnect } from 'wagmi';
import { ConnectButton, useConnectModal } from '@rainbow-me/rainbowkit';
import { X, Key, User, Wallet, Chrome, Github, Twitter, MessageCircle, Fingerprint, ExternalLink, Loader2 } from 'lucide-react';
import { createSIWEMessage, formatSIWEMessage } from '@jejunetwork/shared/auth/siwe';
import { isPlatformAuthenticatorAvailable } from '@jejunetwork/shared/auth/passkeys';
import { CHAIN_ID } from '../../config';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (session: AuthSession) => void;
}

interface AuthSession {
  address: string;
  method: 'siwe' | 'siwf' | 'passkey' | 'social';
  expiresAt: number;
  provider?: string;
}

type AuthStep = 'choose' | 'wallet' | 'signing' | 'success' | 'error';

const SESSION_KEY = 'gateway_auth_session';

export function AuthModal({ isOpen, onClose, onSuccess }: AuthModalProps) {
  const [step, setStep] = useState<AuthStep>('choose');
  const [error, setError] = useState<string | null>(null);
  const [hasPasskeys, setHasPasskeys] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { disconnect } = useDisconnect();
  const { openConnectModal } = useConnectModal();

  useEffect(() => {
    isPlatformAuthenticatorAvailable().then(setHasPasskeys);
  }, []);

  // Handle SIWE after wallet connects
  useEffect(() => {
    if (isConnected && address && step === 'wallet') {
      handleSIWE();
    }
  }, [isConnected, address, step]);

  const handleSIWE = async () => {
    if (!address) return;
    
    setStep('signing');
    setError(null);

    try {
      const message = createSIWEMessage({
        domain: window.location.host,
        address,
        uri: window.location.origin,
        chainId: CHAIN_ID,
        statement: 'Sign in to Gateway Portal',
        expirationMinutes: 60 * 24,
      });

      const messageString = formatSIWEMessage(message);
      await signMessageAsync({ message: messageString });

      const session: AuthSession = {
        address,
        method: 'siwe',
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      };

      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      setStep('success');
      onSuccess?.(session);
      
      setTimeout(() => onClose(), 1500);
    } catch (err) {
      setError((err as Error).message);
      setStep('error');
    }
  };

  const handleWalletConnect = () => {
    setStep('wallet');
    if (openConnectModal) {
      openConnectModal();
    }
  };

  const handleFarcaster = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const oauth3Url = import.meta.env.VITE_OAUTH3_AGENT_URL || 'http://localhost:4200';
      const redirectUri = `${window.location.origin}/auth/callback`;

      const response = await fetch(`${oauth3Url}/auth/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'farcaster',
          appId: 'gateway.apps.jeju',
          redirectUri,
        }),
      });

      if (!response.ok) throw new Error('Failed to initialize Farcaster auth');

      const { authUrl, state } = await response.json();
      sessionStorage.setItem('oauth3_state', state);
      sessionStorage.setItem('oauth3_provider', 'farcaster');
      window.location.href = authUrl;
    } catch (err) {
      setError((err as Error).message);
      setIsLoading(false);
    }
  };

  const handleSocial = async (provider: 'google' | 'github' | 'twitter' | 'discord') => {
    setIsLoading(true);
    setError(null);

    try {
      const oauth3Url = import.meta.env.VITE_OAUTH3_AGENT_URL || 'http://localhost:4200';
      const redirectUri = `${window.location.origin}/auth/callback`;

      const response = await fetch(`${oauth3Url}/auth/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          appId: 'gateway.apps.jeju',
          redirectUri,
        }),
      });

      if (!response.ok) throw new Error(`Failed to initialize ${provider} auth`);

      const { authUrl, state } = await response.json();
      sessionStorage.setItem('oauth3_state', state);
      sessionStorage.setItem('oauth3_provider', provider);
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

      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      onSuccess?.(session);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Key className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Sign In</h2>
              <p className="text-sm text-muted-foreground">to Gateway Portal</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-accent transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-6 mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Content */}
        <div className="p-6 space-y-4">
          {step === 'choose' && (
            <>
              {/* Wallet Section */}
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Wallet (SIWE)
                </label>
                <button
                  onClick={handleWalletConnect}
                  className="w-full flex items-center gap-4 p-4 rounded-xl bg-secondary/50 border border-border hover:bg-secondary hover:border-violet-500/30 transition-all group"
                >
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center">
                    <Wallet className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-medium">Connect Wallet</p>
                    <p className="text-xs text-muted-foreground">MetaMask, WalletConnect, Coinbase...</p>
                  </div>
                </button>
              </div>

              {/* Farcaster */}
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Farcaster (SIWF)
                </label>
                <button
                  onClick={handleFarcaster}
                  disabled={isLoading}
                  className="w-full flex items-center gap-4 p-4 rounded-xl bg-secondary/50 border border-border hover:bg-purple-500/10 hover:border-purple-500/30 transition-all"
                >
                  <div className="w-10 h-10 rounded-xl bg-purple-600 flex items-center justify-center">
                    <span className="text-white font-bold text-sm">FC</span>
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-medium">Farcaster</p>
                    <p className="text-xs text-muted-foreground">Sign in with Warpcast</p>
                  </div>
                  {isLoading && <Loader2 className="w-5 h-5 animate-spin" />}
                </button>
              </div>

              {/* Social Logins */}
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Social (OAuth3)
                </label>
                <div className="grid grid-cols-4 gap-2">
                  <button
                    onClick={() => handleSocial('google')}
                    disabled={isLoading}
                    className="flex items-center justify-center p-3 rounded-xl bg-secondary/50 border border-border hover:bg-red-500/10 hover:border-red-500/30 transition-all"
                    title="Google"
                  >
                    <Chrome className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => handleSocial('github')}
                    disabled={isLoading}
                    className="flex items-center justify-center p-3 rounded-xl bg-secondary/50 border border-border hover:bg-gray-500/10 hover:border-gray-500/30 transition-all"
                    title="GitHub"
                  >
                    <Github className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => handleSocial('twitter')}
                    disabled={isLoading}
                    className="flex items-center justify-center p-3 rounded-xl bg-secondary/50 border border-border hover:bg-blue-500/10 hover:border-blue-500/30 transition-all"
                    title="Twitter"
                  >
                    <Twitter className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => handleSocial('discord')}
                    disabled={isLoading}
                    className="flex items-center justify-center p-3 rounded-xl bg-secondary/50 border border-border hover:bg-indigo-500/10 hover:border-indigo-500/30 transition-all"
                    title="Discord"
                  >
                    <MessageCircle className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Passkeys */}
              {hasPasskeys && (
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Passkey (WebAuthn)
                  </label>
                  <button
                    onClick={handlePasskey}
                    disabled={isLoading}
                    className="w-full flex items-center gap-4 p-4 rounded-xl bg-secondary/50 border border-border hover:bg-emerald-500/10 hover:border-emerald-500/30 transition-all"
                  >
                    <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center">
                      <Fingerprint className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 text-left">
                      <p className="font-medium">Passkey</p>
                      <p className="text-xs text-muted-foreground">Touch ID, Face ID, or security key</p>
                    </div>
                    {isLoading && <Loader2 className="w-5 h-5 animate-spin" />}
                  </button>
                </div>
              )}
            </>
          )}

          {step === 'wallet' && (
            <div className="text-center py-8">
              <Loader2 className="w-12 h-12 animate-spin mx-auto text-violet-500" />
              <p className="mt-4 text-muted-foreground">Connecting wallet...</p>
              <p className="text-xs text-muted-foreground mt-2">Please check your wallet</p>
            </div>
          )}

          {step === 'signing' && (
            <div className="text-center py-8">
              <Loader2 className="w-12 h-12 animate-spin mx-auto text-violet-500" />
              <p className="mt-4 text-muted-foreground">Signing message...</p>
              <p className="text-xs text-muted-foreground mt-2">Please sign the message in your wallet</p>
            </div>
          )}

          {step === 'success' && (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto">
                <span className="text-3xl">✓</span>
              </div>
              <p className="mt-4 font-semibold text-emerald-400">Successfully signed in!</p>
              <p className="text-xs text-muted-foreground mt-2">Redirecting...</p>
            </div>
          )}

          {step === 'error' && (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto">
                <X className="w-8 h-8 text-red-400" />
              </div>
              <p className="mt-4 font-semibold text-red-400">Sign in failed</p>
              <button
                onClick={() => { setStep('choose'); setError(null); }}
                className="mt-4 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white transition-colors"
              >
                Try Again
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6">
          <p className="text-xs text-center text-muted-foreground">
            By signing in, you agree to Jeju's{' '}
            <a href="/terms" className="text-violet-400 hover:underline">Terms</a>
            {' '}and{' '}
            <a href="/privacy" className="text-violet-400 hover:underline">Privacy Policy</a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default AuthModal;
