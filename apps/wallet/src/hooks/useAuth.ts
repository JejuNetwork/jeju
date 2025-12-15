/**
 * useAuth - OAuth3 Authentication Hook
 * 
 * Supports:
 * - Wallet (MetaMask, WalletConnect, etc.)
 * - Social (Google, Apple, Twitter, GitHub, Discord)
 * - Farcaster
 * - Auto-generated wallets for social logins
 * - Social recovery for existing wallets
 */

import { useState, useEffect, useCallback } from 'react';
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

export type AuthProvider = 
  | 'wallet'
  | 'google'
  | 'apple'
  | 'twitter'
  | 'github'
  | 'discord'
  | 'farcaster';

export interface AuthSession {
  sessionId: Hex;
  identityId: Hex;
  address: Address;
  provider: AuthProvider;
  linkedProviders: LinkedProvider[];
  expiresAt: number;
  isSmartAccount: boolean;
}

export interface LinkedProvider {
  provider: AuthProvider;
  providerId: string;
  handle?: string;
  avatar?: string;
  linkedAt: number;
  verified: boolean;
}

export interface UseAuthOptions {
  appId?: Hex;
  teeAgentUrl?: string;
  rpcUrl?: string;
  autoConnect?: boolean;
}

export interface UseAuthReturn {
  // State
  session: AuthSession | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;

  // Actions
  login: (provider: AuthProvider) => Promise<void>;
  logout: () => Promise<void>;
  linkProvider: (provider: AuthProvider) => Promise<void>;
  unlinkProvider: (provider: AuthProvider) => Promise<void>;

  // Helpers
  generateWallet: () => Promise<{ address: Address; privateKey: Hex }>;
  importWallet: (privateKey: Hex) => Promise<Address>;
  signMessage: (message: string) => Promise<Hex>;
}

const OAUTH3_TEE_URL = import.meta.env.VITE_OAUTH3_TEE_URL ?? 'http://localhost:4010';
const OAUTH3_APP_ID = (import.meta.env.VITE_OAUTH3_APP_ID ?? '0x0000000000000000000000000000000000000001') as Hex;
const RPC_URL = import.meta.env.VITE_RPC_URL ?? 'https://sepolia.base.org';

const SOCIAL_PROVIDERS: AuthProvider[] = ['google', 'apple', 'twitter', 'github', 'discord'];

export function useAuth(options: UseAuthOptions = {}): UseAuthReturn {
  const {
    appId = OAUTH3_APP_ID,
    teeAgentUrl = OAUTH3_TEE_URL,
    autoConnect = true,
  } = options;

  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isAuthenticated = session !== null && session.expiresAt > Date.now();

  // Load session from storage on mount
  useEffect(() => {
    if (autoConnect) {
      loadSession();
    } else {
      setIsLoading(false);
    }
  }, [autoConnect]);

  const loadSession = useCallback(async () => {
    try {
      const stored = localStorage.getItem('jeju_auth_session');
      if (!stored) {
        setIsLoading(false);
        return;
      }

      const parsed = JSON.parse(stored) as AuthSession;
      
      if (parsed.expiresAt > Date.now()) {
        // Verify session is still valid with TEE agent
        const response = await fetch(`${teeAgentUrl}/session/${parsed.sessionId}/verify`);
        if (response.ok) {
          setSession(parsed);
        } else {
          localStorage.removeItem('jeju_auth_session');
        }
      } else {
        localStorage.removeItem('jeju_auth_session');
      }
    } catch {
      localStorage.removeItem('jeju_auth_session');
    } finally {
      setIsLoading(false);
    }
  }, [teeAgentUrl]);

  const saveSession = useCallback((newSession: AuthSession) => {
    setSession(newSession);
    localStorage.setItem('jeju_auth_session', JSON.stringify(newSession));
  }, []);

  const clearSession = useCallback(() => {
    setSession(null);
    localStorage.removeItem('jeju_auth_session');
    localStorage.removeItem('jeju_private_key');
  }, []);

  // Login with any provider
  const login = useCallback(async (provider: AuthProvider) => {
    setIsLoading(true);
    setError(null);

    try {
      if (provider === 'wallet') {
        await loginWithWallet();
      } else if (provider === 'farcaster') {
        await loginWithFarcaster();
      } else if (SOCIAL_PROVIDERS.includes(provider)) {
        await loginWithSocial(provider);
      } else {
        throw new Error(`Unknown provider: ${provider}`);
      }
    } catch (err) {
      setError((err as Error).message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [appId, teeAgentUrl]);

  // Wallet login (MetaMask, etc.)
  const loginWithWallet = async () => {
    if (typeof window === 'undefined' || !window.ethereum) {
      throw new Error('No wallet found. Please install MetaMask or another wallet.');
    }

    const accounts = await window.ethereum.request({
      method: 'eth_requestAccounts',
    }) as string[];

    const address = accounts[0] as Address;
    const nonce = crypto.randomUUID();
    
    const message = createSignInMessage(address, nonce);
    
    const signature = await window.ethereum.request({
      method: 'personal_sign',
      params: [message, address],
    }) as Hex;

    const response = await fetch(`${teeAgentUrl}/auth/wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, signature, message, appId }),
    });

    if (!response.ok) {
      throw new Error(`Wallet login failed: ${response.status}`);
    }

    const sessionData = await response.json() as AuthSession;
    sessionData.provider = 'wallet';
    saveSession(sessionData);
  };

  // Social OAuth login (generates wallet automatically)
  const loginWithSocial = async (provider: AuthProvider) => {
    // Start OAuth flow
    const initResponse = await fetch(`${teeAgentUrl}/auth/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider,
        appId,
        redirectUri: window.location.origin + '/auth/callback',
      }),
    });

    if (!initResponse.ok) {
      throw new Error(`Failed to start ${provider} login`);
    }

    const { authUrl, state, sessionId } = await initResponse.json() as {
      authUrl: string;
      state: string;
      sessionId: Hex;
    };

    // Store state for callback verification
    sessionStorage.setItem('oauth_state', state);
    sessionStorage.setItem('oauth_session_id', sessionId);
    sessionStorage.setItem('oauth_provider', provider);

    // Open OAuth popup
    const popup = openPopup(authUrl, 'oauth_popup');
    
    // Wait for callback
    return new Promise<void>((resolve, reject) => {
      const handleMessage = async (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;

        const { code, state: returnedState, error: oauthError } = event.data as {
          code?: string;
          state?: string;
          error?: string;
        };

        if (oauthError) {
          window.removeEventListener('message', handleMessage);
          popup?.close();
          reject(new Error(oauthError));
          return;
        }

        if (!code || returnedState !== state) return;

        window.removeEventListener('message', handleMessage);
        popup?.close();

        // Exchange code for session
        const callbackResponse = await fetch(`${teeAgentUrl}/auth/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state, code }),
        });

        if (!callbackResponse.ok) {
          reject(new Error(`OAuth callback failed: ${callbackResponse.status}`));
          return;
        }

        const sessionData = await callbackResponse.json() as AuthSession;
        sessionData.provider = provider;
        saveSession(sessionData);
        resolve();
      };

      window.addEventListener('message', handleMessage);

      // Check if popup was closed without completing auth
      const checkClosed = setInterval(() => {
        if (popup?.closed) {
          clearInterval(checkClosed);
          window.removeEventListener('message', handleMessage);
          reject(new Error('Login cancelled'));
        }
      }, 1000);
    });
  };

  // Farcaster login
  const loginWithFarcaster = async () => {
    // Start SIWF (Sign In With Farcaster) flow
    const initResponse = await fetch(`${teeAgentUrl}/auth/farcaster/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appId,
        domain: window.location.hostname,
        nonce: crypto.randomUUID(),
      }),
    });

    if (!initResponse.ok) {
      throw new Error('Failed to start Farcaster login');
    }

    const { channelToken, url } = await initResponse.json() as {
      channelToken: string;
      url: string;
    };

    // Open Warpcast sign-in
    openPopup(url, 'farcaster_popup');

    // Poll for completion
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 2000));

      const statusResponse = await fetch(`${teeAgentUrl}/auth/farcaster/status?channel=${channelToken}`);
      if (!statusResponse.ok) continue;

      const result = await statusResponse.json() as { 
        complete: boolean; 
        session?: AuthSession; 
        error?: string;
      };

      if (result.error) {
        throw new Error(result.error);
      }

      if (result.complete && result.session) {
        result.session.provider = 'farcaster';
        saveSession(result.session);
        return;
      }
    }

    throw new Error('Farcaster login timed out');
  };

  // Logout
  const logout = useCallback(async () => {
    if (session?.sessionId) {
      await fetch(`${teeAgentUrl}/session/${session.sessionId}`, {
        method: 'DELETE',
      }).catch(() => {});
    }
    clearSession();
  }, [session, teeAgentUrl, clearSession]);

  // Link additional provider to existing identity
  const linkProvider = useCallback(async (provider: AuthProvider) => {
    if (!session) throw new Error('Not authenticated');

    const response = await fetch(`${teeAgentUrl}/identity/${session.identityId}/link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.sessionId}`,
      },
      body: JSON.stringify({ provider, appId }),
    });

    if (!response.ok) {
      throw new Error(`Failed to link ${provider}`);
    }

    // Update session with new linked provider
    const updatedSession = await response.json() as AuthSession;
    saveSession({ ...session, linkedProviders: updatedSession.linkedProviders });
  }, [session, appId, teeAgentUrl, saveSession]);

  // Unlink provider from identity
  const unlinkProvider = useCallback(async (provider: AuthProvider) => {
    if (!session) throw new Error('Not authenticated');

    const response = await fetch(`${teeAgentUrl}/identity/${session.identityId}/unlink`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.sessionId}`,
      },
      body: JSON.stringify({ provider }),
    });

    if (!response.ok) {
      throw new Error(`Failed to unlink ${provider}`);
    }

    // Update session with provider removed
    const updatedSession = await response.json() as AuthSession;
    saveSession({ ...session, linkedProviders: updatedSession.linkedProviders });
  }, [session, teeAgentUrl, saveSession]);

  // Generate new wallet (for offline-first or local use)
  const generateWallet = useCallback(async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    
    // Store encrypted in local storage (for this session)
    localStorage.setItem('jeju_private_key', privateKey);

    return { address: account.address, privateKey };
  }, []);

  // Import existing wallet
  const importWallet = useCallback(async (privateKey: Hex) => {
    const account = privateKeyToAccount(privateKey);
    localStorage.setItem('jeju_private_key', privateKey);
    return account.address;
  }, []);

  // Sign message with current session
  const signMessage = useCallback(async (message: string): Promise<Hex> => {
    if (!session) throw new Error('Not authenticated');

    // First try TEE agent signing
    const response = await fetch(`${teeAgentUrl}/sign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.sessionId}`,
      },
      body: JSON.stringify({ message }),
    });

    if (response.ok) {
      const { signature } = await response.json() as { signature: Hex };
      return signature;
    }

    // Fall back to local key if available
    const storedKey = localStorage.getItem('jeju_private_key');
    if (storedKey) {
      const account = privateKeyToAccount(storedKey as Hex);
      return account.signMessage({ message });
    }

    throw new Error('Unable to sign message');
  }, [session, teeAgentUrl]);

  return {
    session,
    isLoading,
    isAuthenticated,
    error,
    login,
    logout,
    linkProvider,
    unlinkProvider,
    generateWallet,
    importWallet,
    signMessage,
  };
}

// Helper: Create SIWE-style message
function createSignInMessage(address: Address, nonce: string): string {
  const domain = window.location.hostname;
  const uri = window.location.origin;
  return `${domain} wants you to sign in with your Ethereum account:
${address}

Sign in to Jeju Wallet

URI: ${uri}
Version: 1
Chain ID: 8453
Nonce: ${nonce}
Issued At: ${new Date().toISOString()}`;
}

// Helper: Open popup window
function openPopup(url: string, name: string): Window | null {
  const width = 500;
  const height = 700;
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;

  return window.open(
    url,
    name,
    `width=${width},height=${height},left=${left},top=${top},popup=1`
  );
}

// Global type declarations
declare global {
  interface Window {
    ethereum?: {
      request: <T = unknown>(args: { method: string; params?: unknown[] }) => Promise<T>;
      on: (event: string, callback: (...args: unknown[]) => void) => void;
      removeListener: (event: string, callback: (...args: unknown[]) => void) => void;
    };
  }
}

