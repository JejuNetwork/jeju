/**
 * OAuth3 React Provider
 * 
 * Wraps your app to provide OAuth3 authentication context.
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react';
import type { Address, Hex } from 'viem';
import {
  OAuth3Client,
  createOAuth3Client,
  type OAuth3Config,
  type OAuth3Session,
  type LoginOptions,
  AuthProvider,
  type VerifiableCredential,
  type OAuth3Event,
} from '../index.js';

export interface OAuth3ProviderProps {
  children: ReactNode;
  config: OAuth3Config;
  autoConnect?: boolean;
  onSessionChange?: (session: OAuth3Session | null) => void;
}

export interface OAuth3ContextValue {
  // State
  client: OAuth3Client;
  session: OAuth3Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
  
  // Auth methods
  login: (provider: AuthProvider, options?: Partial<LoginOptions>) => Promise<OAuth3Session>;
  logout: () => Promise<void>;
  linkProvider: (provider: AuthProvider) => Promise<void>;
  unlinkProvider: (provider: AuthProvider) => Promise<void>;
  
  // Session
  refreshSession: () => Promise<OAuth3Session>;
  
  // Signing
  signMessage: (message: string | Uint8Array) => Promise<Hex>;
  
  // Credentials
  getCredentials: () => Promise<VerifiableCredential[]>;
  issueCredential: (provider: AuthProvider, providerId: string, providerHandle: string) => Promise<VerifiableCredential>;
  
  // Helpers
  smartAccountAddress: Address | null;
  identityId: Hex | null;
}

const OAuth3Context = createContext<OAuth3ContextValue | null>(null);

export function OAuth3Provider({
  children,
  config,
  autoConnect = true,
  onSessionChange,
}: OAuth3ProviderProps) {
  const [client] = useState(() => createOAuth3Client(config));
  const [session, setSession] = useState<OAuth3Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize client and load session
  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      setError(null);

      // Initialize decentralized discovery if enabled
      if (config.decentralized !== false) {
        await client.initialize().catch(() => {});
      }

      // Check for existing session
      const existingSession = client.getSession();
      if (existingSession && autoConnect) {
        setSession(existingSession);
        onSessionChange?.(existingSession);
      }

      setIsLoading(false);
    };

    init();
  }, [client, config.decentralized, autoConnect, onSessionChange]);

  // Listen for client events
  useEffect(() => {
    const handleLogin = (event: OAuth3Event) => {
      const data = event.data as { session?: OAuth3Session } | undefined;
      if (data?.session) {
        setSession(data.session);
        onSessionChange?.(data.session);
      }
    };

    const handleLogout = () => {
      setSession(null);
      onSessionChange?.(null);
    };

    const handleSessionRefresh = (event: OAuth3Event) => {
      const data = event.data as { session?: OAuth3Session } | undefined;
      if (data?.session) {
        setSession(data.session);
        onSessionChange?.(data.session);
      }
    };

    const handleError = (event: OAuth3Event) => {
      const data = event.data as { message?: string; error?: string } | undefined;
      setError(data?.message ?? data?.error ?? 'An error occurred');
    };

    const unsubLogin = client.on('login', handleLogin);
    const unsubLogout = client.on('logout', handleLogout);
    const unsubRefresh = client.on('sessionRefresh', handleSessionRefresh);
    const unsubError = client.on('error', handleError);

    return () => {
      unsubLogin();
      unsubLogout();
      unsubRefresh();
      unsubError();
    };
  }, [client, onSessionChange]);

  const login = useCallback(async (provider: AuthProvider, options: Partial<LoginOptions> = {}) => {
    setIsLoading(true);
    setError(null);

    const newSession = await client.login({ provider, ...options });
    setSession(newSession);
    setIsLoading(false);
    return newSession;
  }, [client]);

  const logout = useCallback(async () => {
    setIsLoading(true);
    await client.logout();
    setSession(null);
    setIsLoading(false);
  }, [client]);

  const linkProvider = useCallback(async (provider: AuthProvider) => {
    await client.linkProvider({ provider });
  }, [client]);

  const unlinkProvider = useCallback(async (provider: AuthProvider) => {
    await client.unlinkProvider(provider);
  }, [client]);

  const refreshSession = useCallback(async () => {
    const newSession = await client.refreshSession();
    setSession(newSession);
    return newSession;
  }, [client]);

  const signMessage = useCallback(async (message: string | Uint8Array) => {
    return client.signMessage({ message });
  }, [client]);

  const getCredentials = useCallback(async () => {
    return client.listCredentials();
  }, [client]);

  const issueCredential = useCallback(async (
    provider: AuthProvider,
    providerId: string,
    providerHandle: string
  ) => {
    return client.issueCredential(provider, providerId, providerHandle);
  }, [client]);

  const value = useMemo<OAuth3ContextValue>(() => ({
    client,
    session,
    isLoading,
    isAuthenticated: session !== null && session.expiresAt > Date.now(),
    error,
    login,
    logout,
    linkProvider,
    unlinkProvider,
    refreshSession,
    signMessage,
    getCredentials,
    issueCredential,
    smartAccountAddress: session?.smartAccount ?? null,
    identityId: session?.identityId ?? null,
  }), [
    client,
    session,
    isLoading,
    error,
    login,
    logout,
    linkProvider,
    unlinkProvider,
    refreshSession,
    signMessage,
    getCredentials,
    issueCredential,
  ]);

  return (
    <OAuth3Context.Provider value={value}>
      {children}
    </OAuth3Context.Provider>
  );
}

export function useOAuth3(): OAuth3ContextValue {
  const context = useContext(OAuth3Context);
  if (!context) {
    throw new Error('useOAuth3 must be used within an OAuth3Provider');
  }
  return context;
}

export function useOAuth3Client(): OAuth3Client {
  const { client } = useOAuth3();
  return client;
}
