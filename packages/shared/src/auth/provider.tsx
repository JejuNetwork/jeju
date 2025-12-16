/**
 * AuthProvider - React Context for Authentication
 * 
 * Provides unified authentication state and actions across the app.
 * Framework-agnostic - accepts wallet operations as props.
 */

'use client';

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { Address, Hex } from 'viem';
import type { AuthConfig, AuthSession, AuthState, AuthContextType, SocialProvider, LinkedProvider, PasskeyCredential } from './types';
import { createSIWEMessage, formatSIWEMessage, verifySIWESignature } from './siwe';
import { createSIWFMessage, verifySIWFSignature, createAuthChannel, pollAuthChannel } from './siwf';
import { registerPasskey, authenticateWithPasskey, type PasskeyConfig } from './passkeys';

const AuthContext = createContext<AuthContextType | null>(null);

export interface WalletAdapter {
  address: Address | undefined;
  isConnected: boolean;
  connect: () => Promise<{ address: Address }>;
  disconnect: () => Promise<void>;
  signMessage: (message: string) => Promise<Hex>;
}

export interface AuthProviderProps {
  children: ReactNode;
  config: AuthConfig;
  wallet?: WalletAdapter;
  onSessionChange?: (session: AuthSession | null) => void;
}

const SESSION_KEY = 'jeju_auth_session';

export function AuthProvider({ children, config, wallet, onSessionChange }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({
    session: null,
    isLoading: true,
    isAuthenticated: false,
    error: null,
  });

  // Load session from storage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored) {
      const session = JSON.parse(stored) as AuthSession;
      if (session.expiresAt > Date.now()) {
        setState(s => ({ ...s, session, isAuthenticated: true, isLoading: false }));
        onSessionChange?.(session);
      } else {
        localStorage.removeItem(SESSION_KEY);
        setState(s => ({ ...s, isLoading: false }));
      }
    } else {
      setState(s => ({ ...s, isLoading: false }));
    }
  }, [onSessionChange]);

  // Save session to storage when it changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    if (state.session) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(state.session));
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  }, [state.session]);

  const setSession = useCallback((session: AuthSession | null) => {
    setState(s => ({ 
      ...s, 
      session, 
      isAuthenticated: !!session,
      isLoading: false,
      error: null,
    }));
    onSessionChange?.(session);
  }, [onSessionChange]);

  // Login with wallet (SIWE)
  const loginWithWallet = useCallback(async (): Promise<AuthSession> => {
    if (!wallet) {
      throw new Error('Wallet adapter not provided');
    }

    setState(s => ({ ...s, isLoading: true, error: null }));

    let walletAddress = wallet.address;

    // Connect wallet if not connected
    if (!wallet.isConnected || !walletAddress) {
      const result = await wallet.connect();
      walletAddress = result.address;
    }

    // Create and sign SIWE message
    const message = createSIWEMessage({
      domain: window.location.host,
      address: walletAddress,
      uri: window.location.origin,
      chainId: config.chainId,
      statement: `Sign in to ${config.appName}`,
      expirationMinutes: 60 * 24,
    });

    const messageString = formatSIWEMessage(message);
    const signature = await wallet.signMessage(messageString);

    // Verify signature
    const verification = await verifySIWESignature({ message, signature });
    if (!verification.valid) {
      throw new Error(verification.error || 'Invalid signature');
    }

    // Create session
    const session: AuthSession = {
      id: `siwe-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      method: 'siwe',
      address: walletAddress,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      linkedProviders: [{ 
        provider: 'wallet', 
        providerId: walletAddress, 
        handle: walletAddress.slice(0, 6) + '...' + walletAddress.slice(-4),
        linkedAt: Date.now(),
        verified: true,
      }],
    };

    setSession(session);
    return session;
  }, [wallet, config, setSession]);

  // Login with Farcaster (SIWF)
  const loginWithFarcaster = useCallback(async (): Promise<AuthSession> => {
    setState(s => ({ ...s, isLoading: true, error: null }));

    const nonce = Math.random().toString(36).slice(2);
    
    // Create auth channel
    const channel = await createAuthChannel({
      domain: window.location.host,
      siweUri: window.location.origin,
      nonce,
    });

    // Open Warpcast in popup
    const popup = window.open(channel.url, 'farcaster-auth', 'width=500,height=700');

    // Poll for completion
    const result = await pollAuthChannel({
      channelToken: channel.channelToken,
      timeoutMs: 300000,
    });

    popup?.close();

    if (!result) {
      throw new Error('Farcaster authentication timed out');
    }

    // Verify signature
    const message = createSIWFMessage({
      domain: window.location.host,
      fid: result.fid,
      custody: result.custodyAddress,
      nonce: result.nonce,
    });

    const verification = await verifySIWFSignature({
      message,
      signature: result.signature,
    });

    if (!verification.valid) {
      throw new Error(verification.error || 'Invalid Farcaster signature');
    }

    // Create session
    const session: AuthSession = {
      id: `siwf-${result.fid}-${Date.now()}`,
      method: 'siwf',
      address: result.custodyAddress,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      linkedProviders: [{
        provider: 'farcaster',
        providerId: String(result.fid),
        handle: result.username || `fid:${result.fid}`,
        linkedAt: Date.now(),
        verified: true,
      }],
    };

    setSession(session);
    return session;
  }, [setSession]);

  // Login with Passkey
  const loginWithPasskey = useCallback(async (): Promise<AuthSession> => {
    setState(s => ({ ...s, isLoading: true, error: null }));

    const passkeyConfig: PasskeyConfig = {
      rpId: window.location.hostname,
      rpName: config.appName,
      origin: window.location.origin,
    };

    const result = await authenticateWithPasskey({ config: passkeyConfig });

    const mockAddress = `0x${result.credentialId.slice(0, 40)}` as Address;

    const session: AuthSession = {
      id: `passkey-${Date.now()}-${result.credentialId.slice(0, 8)}`,
      method: 'passkey',
      address: mockAddress,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      linkedProviders: [{
        provider: 'wallet',
        providerId: result.credentialId,
        handle: 'Passkey',
        linkedAt: Date.now(),
        verified: true,
      }],
    };

    setSession(session);
    return session;
  }, [config.appName, setSession]);

  // Login with social provider
  const loginWithSocial = useCallback(async (provider: SocialProvider): Promise<AuthSession> => {
    setState(s => ({ ...s, isLoading: true, error: null }));

    const agentUrl = config.oauth3AgentUrl || 'http://localhost:4200';
    const redirectUri = `${window.location.origin}/auth/callback`;

    const initResponse = await fetch(`${agentUrl}/auth/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider,
        appId: config.appId,
        redirectUri,
      }),
    });

    if (!initResponse.ok) {
      throw new Error(`Failed to initialize OAuth: ${initResponse.status}`);
    }

    const { authUrl, state: authState } = await initResponse.json() as { authUrl: string; state: string };

    sessionStorage.setItem('oauth3_state', authState);
    sessionStorage.setItem('oauth3_provider', provider);

    window.location.href = authUrl;
    throw new Error('Redirecting to OAuth provider...');
  }, [config]);

  // Logout
  const logout = useCallback(async (): Promise<void> => {
    if (wallet) {
      await wallet.disconnect().catch(() => {});
    }
    setSession(null);
  }, [wallet, setSession]);

  // Link a social provider to existing session
  const linkProvider = useCallback(async (provider: SocialProvider | 'farcaster'): Promise<LinkedProvider> => {
    if (!state.session) {
      throw new Error('Not authenticated');
    }

    // Check if already linked
    const existingLink = state.session.linkedProviders.find(p => p.provider === provider);
    if (existingLink) {
      return existingLink;
    }

    if (provider === 'farcaster') {
      // Use SIWF flow for Farcaster
      const nonce = Math.random().toString(36).slice(2);
      const channelResponse = await createAuthChannel({
        domain: window.location.host,
        siweUri: window.location.origin,
        nonce,
      });
      window.open(channelResponse.url, '_blank', 'width=500,height=600');
      
      const response = await pollAuthChannel({ channelToken: channelResponse.channelToken });
      if (!response) {
        throw new Error('Farcaster linking cancelled or timed out');
      }

      const linkedProvider: LinkedProvider = {
        provider: 'farcaster',
        providerId: response.fid.toString(),
        handle: response.username || `fid:${response.fid}`,
        linkedAt: Date.now(),
        verified: true,
      };

      // Update session with new linked provider
      const updatedSession = {
        ...state.session,
        linkedProviders: [...state.session.linkedProviders, linkedProvider],
      };
      setSession(updatedSession);
      
      return linkedProvider;
    }

    // OAuth flow for other social providers
    const oauth3AgentUrl = config.oauth3AgentUrl || 'http://localhost:4200';
    const callbackUrl = `${window.location.origin}/auth/callback`;
    
    // Initiate OAuth flow
    const authUrl = `${oauth3AgentUrl}/oauth/${provider}/authorize?` + 
      `redirect_uri=${encodeURIComponent(callbackUrl)}&` +
      `state=${encodeURIComponent(JSON.stringify({ action: 'link', address: state.session.address }))}`;
    
    // Open popup for OAuth
    const popup = window.open(authUrl, 'oauth-link', 'width=500,height=600');
    if (!popup) {
      throw new Error('Popup blocked - please allow popups for this site');
    }

    // Wait for callback
    const linkedProvider = await new Promise<LinkedProvider>((resolve, reject) => {
      const handleMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        
        if (event.data?.type === 'oauth-link-success') {
          window.removeEventListener('message', handleMessage);
          popup.close();
          resolve(event.data.provider as LinkedProvider);
        } else if (event.data?.type === 'oauth-link-error') {
          window.removeEventListener('message', handleMessage);
          popup.close();
          reject(new Error(event.data.error || 'OAuth linking failed'));
        }
      };
      
      window.addEventListener('message', handleMessage);
      
      // Timeout after 5 minutes
      setTimeout(() => {
        window.removeEventListener('message', handleMessage);
        popup.close();
        reject(new Error('OAuth linking timed out'));
      }, 300000);
    });

    // Update session with new linked provider
    const updatedSession = {
      ...state.session,
      linkedProviders: [...state.session.linkedProviders, linkedProvider],
    };
    setSession(updatedSession);
    
    return linkedProvider;
  }, [state.session, config, setSession]);

  // Unlink a provider
  const unlinkProvider = useCallback(async (provider: SocialProvider | 'farcaster'): Promise<void> => {
    if (!state.session) {
      throw new Error('Not authenticated');
    }

    const updatedProviders = state.session.linkedProviders.filter(p => p.provider !== provider);
    setSession({ ...state.session, linkedProviders: updatedProviders });
  }, [state.session, setSession]);

  // Sign a message
  const signMessage = useCallback(async (message: string | Uint8Array): Promise<Hex> => {
    if (!state.session) {
      throw new Error('Not authenticated');
    }
    if (!wallet) {
      throw new Error('Wallet adapter not provided');
    }

    const messageStr = typeof message === 'string' ? message : new TextDecoder().decode(message);
    return wallet.signMessage(messageStr);
  }, [state.session, wallet]);

  // Register a new passkey
  const registerNewPasskey = useCallback(async (name?: string): Promise<PasskeyCredential> => {
    if (!state.session) {
      throw new Error('Not authenticated');
    }

    const passkeyConfig: PasskeyConfig = {
      rpId: window.location.hostname,
      rpName: config.appName,
      origin: window.location.origin,
    };

    const result = await registerPasskey({
      config: passkeyConfig,
      userId: state.session.id,
      userName: state.session.address,
      userDisplayName: name || state.session.address.slice(0, 10),
      name,
    });

    return result.credential;
  }, [state.session, config.appName]);

  // Refresh session
  const refreshSession = useCallback(async (): Promise<AuthSession> => {
    if (!state.session) {
      throw new Error('No session to refresh');
    }

    const refreshedSession: AuthSession = {
      ...state.session,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };

    setSession(refreshedSession);
    return refreshedSession;
  }, [state.session, setSession]);

  const contextValue: AuthContextType = {
    ...state,
    loginWithWallet,
    loginWithFarcaster,
    loginWithPasskey,
    loginWithSocial,
    logout,
    linkProvider,
    unlinkProvider,
    signMessage,
    registerPasskey: registerNewPasskey,
    refreshSession,
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export { AuthContext };
