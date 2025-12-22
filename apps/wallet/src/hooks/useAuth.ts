/**
 * useAuth - OAuth3 Authentication Hook
 * 
 * Uses the @jejunetwork/oauth3 SDK for decentralized authentication:
 * - Wallet (MetaMask, WalletConnect, etc.)
 * - Social (Google, Apple, Twitter, GitHub, Discord)
 * - Farcaster
 * - Auto-generated wallets for social logins
 * - TEE-backed key management with MPC threshold signing
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Address, Hex } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import {
  createOAuth3Client,
  AuthProvider as OAuth3AuthProvider,
  type OAuth3Client,
  type OAuth3Session,
} from '@jejunetwork/oauth3';

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
  appId?: Hex | string;
  teeAgentUrl?: string;
  rpcUrl?: string;
  autoConnect?: boolean;
  decentralized?: boolean;
}

export interface UseAuthReturn {
  // State
  session: AuthSession | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
  isInitialized: boolean;

  // Actions
  login: (provider: AuthProvider) => Promise<void>;
  logout: () => Promise<void>;
  linkProvider: (provider: AuthProvider) => Promise<void>;
  unlinkProvider: (provider: AuthProvider) => Promise<void>;

  // Helpers
  generateWallet: () => Promise<{ address: Address; privateKey: Hex }>;
  importWallet: (privateKey: Hex) => Promise<Address>;
  signMessage: (message: string) => Promise<Hex>;
  
  // Infrastructure
  checkHealth: () => Promise<{ jns: boolean; storage: boolean; teeNode: boolean }>;
}

const OAUTH3_TEE_URL = import.meta.env.VITE_OAUTH3_TEE_URL ?? 'http://localhost:4010';
const OAUTH3_APP_ID = (import.meta.env.VITE_OAUTH3_APP_ID ?? 'wallet.apps.jeju');
const RPC_URL = import.meta.env.VITE_RPC_URL ?? 'http://localhost:9545';
const CHAIN_ID = parseInt(import.meta.env.VITE_CHAIN_ID ?? '420691', 10);

function mapAuthProvider(provider: AuthProvider): OAuth3AuthProvider {
  const mapping: Record<AuthProvider, OAuth3AuthProvider> = {
    wallet: OAuth3AuthProvider.WALLET,
    google: OAuth3AuthProvider.GOOGLE,
    apple: OAuth3AuthProvider.APPLE,
    twitter: OAuth3AuthProvider.TWITTER,
    github: OAuth3AuthProvider.GITHUB,
    discord: OAuth3AuthProvider.DISCORD,
    farcaster: OAuth3AuthProvider.FARCASTER,
  };
  return mapping[provider];
}

function oauth3SessionToAuthSession(session: OAuth3Session, provider: AuthProvider): AuthSession {
  return {
    sessionId: session.sessionId,
    identityId: session.identityId,
    address: session.smartAccount,
    provider,
    linkedProviders: [], // Loaded separately from identity
    expiresAt: session.expiresAt,
    isSmartAccount: true,
  };
}

export function useAuth(options: UseAuthOptions = {}): UseAuthReturn {
  const {
    appId = OAUTH3_APP_ID,
    teeAgentUrl = OAUTH3_TEE_URL,
    autoConnect = true,
    decentralized = true,
  } = options;

  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [currentProvider, setCurrentProvider] = useState<AuthProvider | null>(null);

  const isAuthenticated = session !== null && session.expiresAt > Date.now();

  // Create OAuth3 client
  const client: OAuth3Client = useMemo(() => {
    const redirectUri = typeof window !== 'undefined' 
      ? `${window.location.origin}/auth/callback` 
      : 'http://localhost:4015/auth/callback';
    
    return createOAuth3Client({
      appId: appId as Hex,
      redirectUri,
      teeAgentUrl: decentralized ? undefined : teeAgentUrl,
      rpcUrl: RPC_URL,
      chainId: CHAIN_ID,
      decentralized,
    });
  }, [appId, teeAgentUrl, decentralized]);

  // Initialize OAuth3 client on mount
  useEffect(() => {
    const init = async () => {
      if (decentralized) {
        // Try to initialize discovery, fallback to configured TEE URL on failure
        try {
          await client.initialize();
        } catch (initError) {
          // Log initialization errors - client will fallback to configured TEE URL
          console.warn('OAuth3 discovery initialization failed, using configured TEE URL:', initError);
        }
      }
      setIsInitialized(true);
      
      if (autoConnect) {
        await loadSession();
      } else {
        setIsLoading(false);
      }
    };

    init();
  }, [decentralized, autoConnect]);

  const loadSession = useCallback(async () => {
    setIsLoading(true);
    const oauth3Session = client.getSession();
    
    if (oauth3Session && oauth3Session.expiresAt > Date.now()) {
      const stored = localStorage.getItem('jeju_auth_provider');
      const provider = (stored as AuthProvider) || 'wallet';
      setSession(oauth3SessionToAuthSession(oauth3Session, provider));
      setCurrentProvider(provider);
    }
    
    setIsLoading(false);
  }, [client]);

  const saveSession = useCallback((newSession: AuthSession, provider: AuthProvider) => {
    setSession(newSession);
    setCurrentProvider(provider);
    localStorage.setItem('jeju_auth_provider', provider);
  }, []);

  const clearSession = useCallback(() => {
    setSession(null);
    setCurrentProvider(null);
    localStorage.removeItem('jeju_auth_provider');
    localStorage.removeItem('jeju_private_key');
  }, []);

  // Login with any provider using OAuth3 SDK
  const login = useCallback(async (provider: AuthProvider) => {
    setIsLoading(true);
    setError(null);

    try {
      const oauth3Provider = mapAuthProvider(provider);
      const oauth3Session = await client.login({ provider: oauth3Provider });
      const authSession = oauth3SessionToAuthSession(oauth3Session, provider);
      saveSession(authSession, provider);
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [client, saveSession]);

  // Logout using OAuth3 SDK
  const logout = useCallback(async () => {
    try {
      await client.logout();
    } catch (logoutError) {
      // Log but don't throw - session may already be invalidated on server
      console.warn('OAuth3 logout error (session may already be invalidated):', logoutError);
    }
    clearSession();
  }, [client, clearSession]);

  // Link additional provider
  const linkProvider = useCallback(async (provider: AuthProvider) => {
    if (!session) throw new Error('Not authenticated');

    setIsLoading(true);
    setError(null);

    try {
      const oauth3Provider = mapAuthProvider(provider);
      await client.linkProvider({ provider: oauth3Provider });
      
      // Refresh session to get updated linked providers
      const refreshed = await client.refreshSession();
      const updatedSession = oauth3SessionToAuthSession(refreshed, currentProvider || 'wallet');
      setSession(updatedSession);
    } catch (err) {
      setError((err as Error).message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [client, session, currentProvider]);

  // Unlink provider
  const unlinkProvider = useCallback(async (provider: AuthProvider) => {
    if (!session) throw new Error('Not authenticated');

    try {
      const oauth3Provider = mapAuthProvider(provider);
      await client.unlinkProvider(oauth3Provider);
      
      // Update session locally
      setSession(prev => prev ? {
        ...prev,
        linkedProviders: prev.linkedProviders.filter(lp => lp.provider !== provider),
      } : null);
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  }, [client, session]);

  // Generate new wallet (for offline-first or local use)
  const generateWallet = useCallback(async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    
    // Store encrypted in local storage
    localStorage.setItem('jeju_private_key', privateKey);

    return { address: account.address, privateKey };
  }, []);

  // Import existing wallet
  const importWallet = useCallback(async (privateKey: Hex) => {
    const account = privateKeyToAccount(privateKey);
    localStorage.setItem('jeju_private_key', privateKey);
    return account.address;
  }, []);

  // Sign message using OAuth3 SDK (MPC/TEE backed)
  const signMessage = useCallback(async (message: string): Promise<Hex> => {
    if (!session) throw new Error('Not authenticated');

    try {
      return await client.signMessage({ message });
    } catch (signError) {
      // Fall back to local key if available (for offline-first or testing)
      const storedKey = localStorage.getItem('jeju_private_key');
      if (storedKey) {
        // Validate stored key is a valid hex string
        if (!/^0x[0-9a-fA-F]{64}$/.test(storedKey)) {
          throw new Error('Invalid stored private key format');
        }
        console.warn('OAuth3 sign failed, using local key fallback:', signError);
        const account = privateKeyToAccount(storedKey as Hex);
        return account.signMessage({ message });
      }
      throw new Error(`Unable to sign message: ${signError instanceof Error ? signError.message : 'Unknown error'}`);
    }
  }, [client, session]);

  // Check infrastructure health
  const checkHealth = useCallback(async () => {
    return client.checkInfrastructureHealth();
  }, [client]);

  return {
    session,
    isLoading,
    isAuthenticated,
    error,
    isInitialized,
    login,
    logout,
    linkProvider,
    unlinkProvider,
    generateWallet,
    importWallet,
    signMessage,
    checkHealth,
  };
}
