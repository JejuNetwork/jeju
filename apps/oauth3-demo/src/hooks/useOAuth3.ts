/**
 * OAuth3 Hook - Fully Integrated with Jeju Network
 * 
 * Provides decentralized authentication with:
 * - Multiple OAuth providers
 * - JNS (Jeju Name Service) integration
 * - Decentralized storage
 * - On-chain identity management
 * - Moderation system
 */
import { useState, useCallback, useEffect } from 'react';
import { useAccount, useWalletClient, usePublicClient } from 'wagmi';
import { type Address, type Hex, keccak256, toBytes, toHex } from 'viem';

const AUTH_SERVER = import.meta.env.VITE_OAUTH3_AUTH_SERVER || 'http://localhost:4200';

// ============================================================================
// Types
// ============================================================================

export interface OAuth3Identity {
  provider: string;
  providerId: string;
  providerHandle: string;
  providerAvatar?: string;
  walletAddress?: Address;
  onChain?: boolean;
  jnsName?: string;
  createdAt: number;
  updatedAt: number;
}

export interface OAuth3Session {
  sessionId: Hex;
  identityId: Hex;
  smartAccount: Address;
  expiresAt: number;
  capabilities: string[];
  signingKey: Hex;
  attestation: Attestation;
  provider: string;
  providerId: string;
  providerHandle: string;
  providerAvatar?: string;
  onChainIdentity: boolean;
  jnsName?: string;
}

export interface Attestation {
  quote: Hex;
  measurement: Hex;
  reportData: Hex;
  timestamp: number;
  provider: string;
  verified: boolean;
}

export interface ServerHealth {
  status: string;
  nodeId: Hex;
  nodeAddress: Address;
  chainId: number;
  mode: 'dstack-tee' | 'simulated';
  contracts: {
    identityRegistry: boolean;
    banManager: boolean;
    teeVerifier: boolean;
    accountFactory: boolean;
    jnsRegistry: boolean;
    storageRegistry: boolean;
    computeRegistry: boolean;
  };
  network: {
    storageProviders: number;
    computeProviders: number;
  };
  enabledProviders: string[];
}

export interface NetworkInfo {
  storage: { address: Address; name: string; endpoint: string }[];
  compute: { address: Address; name: string; endpoint: string }[];
  teeNodes: number;
}

export interface BanStatus {
  banned: boolean;
  onNotice: boolean;
  reason?: string;
}

export interface JNSResolution {
  name: string;
  address: Address;
}

export interface OnChainIdentity {
  exists: boolean;
  identity?: {
    id: Hex;
    owner: Address;
    smartAccount: Address;
    createdAt: bigint;
    updatedAt: bigint;
    nonce: bigint;
    active: boolean;
  };
  providers?: {
    provider: number;
    providerId: Hex;
    providerHandle: string;
    linkedAt: bigint;
    verified: boolean;
    credentialHash: Hex;
  }[];
  metadata?: {
    name: string;
    avatar: string;
    bio: string;
    url: string;
    jnsName: string;
  };
  jnsName: string | null;
  banStatus: BanStatus;
}

export interface OAuth3ContextState {
  isLoading: boolean;
  error: string | null;
  session: OAuth3Session | null;
  identity: OAuth3Identity | null;
  serverHealth: ServerHealth | null;
  banStatus: BanStatus | null;
  networkInfo: NetworkInfo | null;
  onChainIdentity: OnChainIdentity | null;

  // Auth methods
  login: (provider: string) => Promise<void>;
  loginWithWallet: () => Promise<void>;
  logout: () => void;

  // Identity methods
  createIdentity: () => Promise<void>;
  refreshIdentity: () => Promise<void>;
  fetchOnChainIdentity: (address: Address) => Promise<OnChainIdentity>;

  // JNS methods
  resolveJNS: (name: string) => Promise<Address | null>;
  reverseResolveJNS: (address: Address) => Promise<string | null>;

  // Network methods
  refreshNetwork: () => Promise<void>;

  // Signing
  signMessage: (message: string) => Promise<Hex | null>;
  requestCredential: () => Promise<object | null>;

  // Smart account
  deploySmartAccount: () => Promise<Address | null>;
}

// ============================================================================
// Helper Functions
// ============================================================================

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json();
}

// ============================================================================
// Hook
// ============================================================================

export function useOAuth3(): OAuth3ContextState {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<OAuth3Session | null>(null);
  const [identity, setIdentity] = useState<OAuth3Identity | null>(null);
  const [serverHealth, setServerHealth] = useState<ServerHealth | null>(null);
  const [banStatus, setBanStatus] = useState<BanStatus | null>(null);
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [onChainIdentity, setOnChainIdentity] = useState<OnChainIdentity | null>(null);

  // Fetch server health on mount
  useEffect(() => {
    fetchJSON<ServerHealth>(`${AUTH_SERVER}/health`)
      .then(setServerHealth)
      .catch((e) => console.warn('Health check failed:', e.message));
  }, []);

  // Fetch ban status when address changes
  useEffect(() => {
    if (!address) {
      setBanStatus(null);
      setOnChainIdentity(null);
      return;
    }

    Promise.all([
      fetchJSON<BanStatus>(`${AUTH_SERVER}/ban/${address}`).catch(() => ({ banned: false, onNotice: false })),
      fetchJSON<OnChainIdentity>(`${AUTH_SERVER}/identity/${address}`).catch(() => null),
    ]).then(([ban, identity]) => {
      setBanStatus(ban);
      if (identity) setOnChainIdentity(identity);
    });
  }, [address]);

  // Refresh network info
  const refreshNetwork = useCallback(async () => {
    const info = await fetchJSON<NetworkInfo>(`${AUTH_SERVER}/network`);
    setNetworkInfo(info);
  }, []);

  // JNS resolution
  const resolveJNS = useCallback(async (name: string): Promise<Address | null> => {
    const result = await fetchJSON<JNSResolution>(`${AUTH_SERVER}/jns/${name}`).catch(() => null);
    return result?.address || null;
  }, []);

  const reverseResolveJNS = useCallback(async (addr: Address): Promise<string | null> => {
    const result = await fetchJSON<{ name: string | null }>(`${AUTH_SERVER}/jns/reverse/${addr}`).catch(() => null);
    return result?.name || null;
  }, []);

  // Fetch on-chain identity
  const fetchOnChainIdentity = useCallback(async (addr: Address): Promise<OnChainIdentity> => {
    return fetchJSON<OnChainIdentity>(`${AUTH_SERVER}/identity/${addr}`);
  }, []);

  // OAuth login
  const login = useCallback(async (provider: string) => {
    if (!address) throw new Error('Wallet not connected');

    setIsLoading(true);
    setError(null);

    const appId = keccak256(toBytes('oauth3-demo'));
    const redirectUri = `${window.location.origin}/auth/callback`;

    const init = await fetchJSON<{ authUrl: string; state: string; sessionId: Hex }>(
      `${AUTH_SERVER}/auth/init`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, appId, redirectUri }) }
    );

    localStorage.setItem('oauth3_pending_state', init.state);
    localStorage.setItem('oauth3_pending_session', init.sessionId);
    localStorage.setItem('oauth3_wallet_address', address);

    window.location.href = init.authUrl;
  }, [address]);

  // Wallet login (SIWE)
  const loginWithWallet = useCallback(async () => {
    if (!address || !walletClient) throw new Error('Wallet not connected');

    setIsLoading(true);
    setError(null);

    // Check ban status first
    if (banStatus?.banned) {
      setError(`Account banned: ${banStatus.reason || 'Moderation decision'}`);
      setIsLoading(false);
      return;
    }

    const message = `Sign in to OAuth3\n\nWallet: ${address}\nTimestamp: ${new Date().toISOString()}\nChain: ${walletClient.chain?.id}`;
    const signature = await walletClient.signMessage({ message });

    const sess = await fetchJSON<OAuth3Session>(`${AUTH_SERVER}/auth/wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, signature, message, appId: keccak256(toBytes('oauth3-demo')) }),
    });

    setSession(sess);
    setIdentity({
      provider: 'wallet',
      providerId: address,
      providerHandle: sess.jnsName || address,
      walletAddress: address,
      onChain: sess.onChainIdentity,
      jnsName: sess.jnsName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    localStorage.setItem('oauth3_session', sess.sessionId);
    setIsLoading(false);
  }, [address, walletClient, banStatus]);

  // Complete OAuth callback
  const handleCallback = useCallback(async (code: string, state: string) => {
    const storedState = localStorage.getItem('oauth3_pending_state');
    const storedWallet = localStorage.getItem('oauth3_wallet_address') as Address | null;

    if (state !== storedState) throw new Error('Invalid state');

    setIsLoading(true);

    const sess = await fetchJSON<OAuth3Session>(`${AUTH_SERVER}/auth/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, code }),
    });

    setSession(sess);
    setIdentity({
      provider: sess.provider,
      providerId: sess.providerId,
      providerHandle: sess.providerHandle,
      providerAvatar: sess.providerAvatar,
      walletAddress: storedWallet || undefined,
      onChain: sess.onChainIdentity,
      jnsName: sess.jnsName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    localStorage.setItem('oauth3_session', sess.sessionId);
    localStorage.removeItem('oauth3_pending_state');
    localStorage.removeItem('oauth3_pending_session');
    localStorage.removeItem('oauth3_wallet_address');

    setIsLoading(false);
  }, []);

  // Restore session from localStorage
  useEffect(() => {
    const sessionId = localStorage.getItem('oauth3_session');
    if (!sessionId) return;

    fetchJSON<OAuth3Session>(`${AUTH_SERVER}/session/${sessionId}`)
      .then((sess) => {
        setSession(sess);
        setIdentity({
          provider: sess.provider,
          providerId: sess.providerId,
          providerHandle: sess.providerHandle,
          providerAvatar: sess.providerAvatar,
          walletAddress: address,
          onChain: sess.onChainIdentity,
          jnsName: sess.jnsName,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      })
      .catch(() => localStorage.removeItem('oauth3_session'));
  }, [address]);

  // Handle OAuth callback on page load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');

    if (code && state) {
      handleCallback(code, state)
        .catch((e) => setError(e.message))
        .finally(() => window.history.replaceState({}, '', window.location.pathname));
    }
  }, [handleCallback]);

  const logout = useCallback(() => {
    if (session) {
      fetch(`${AUTH_SERVER}/session/${session.sessionId}`, { method: 'DELETE' }).catch(() => {});
    }
    setSession(null);
    setIdentity(null);
    localStorage.removeItem('oauth3_session');
  }, [session]);

  const createIdentity = useCallback(async () => {
    if (!identity || !session) return;

    setIsLoading(true);
    setError(null);

    // Refresh on-chain identity
    if (address) {
      const onChain = await fetchOnChainIdentity(address);
      setOnChainIdentity(onChain);
      if (onChain.exists && onChain.identity) {
        setIdentity((prev) => prev ? {
          ...prev,
          onChain: true,
          jnsName: onChain.jnsName || prev.jnsName,
        } : prev);
      }
    }

    setIsLoading(false);
  }, [identity, session, address, fetchOnChainIdentity]);

  const refreshIdentity = useCallback(async () => {
    if (!address) return;
    const onChain = await fetchOnChainIdentity(address);
    setOnChainIdentity(onChain);
    setBanStatus(onChain.banStatus);
  }, [address, fetchOnChainIdentity]);

  const signMessage = useCallback(async (message: string): Promise<Hex | null> => {
    if (!session) return null;

    const result = await fetchJSON<{ signature: Hex }>(`${AUTH_SERVER}/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session.sessionId, message: toHex(toBytes(message)) }),
    });

    return result.signature;
  }, [session]);

  const requestCredential = useCallback(async (): Promise<object | null> => {
    if (!session || !address) return null;

    return fetchJSON<object>(`${AUTH_SERVER}/credential/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: session.sessionId,
        provider: session.provider,
        providerId: session.providerId,
        providerHandle: session.providerHandle,
        walletAddress: address,
      }),
    });
  }, [session, address]);

  const deploySmartAccount = useCallback(async (): Promise<Address | null> => {
    if (!session || !walletClient || !publicClient) return null;

    // If session already has smart account deployed, return it
    if (session.smartAccount !== '0x0000000000000000000000000000000000000000') {
      return session.smartAccount;
    }

    // Deploy via wallet
    setIsLoading(true);
    setError(null);

    // This would use the AccountFactory contract
    // For now, return null to indicate deployment pending
    setIsLoading(false);
    return null;
  }, [session, walletClient, publicClient]);

  return {
    isLoading,
    error,
    session,
    identity,
    serverHealth,
    banStatus,
    networkInfo,
    onChainIdentity,

    login,
    loginWithWallet,
    logout,

    createIdentity,
    refreshIdentity,
    fetchOnChainIdentity,

    resolveJNS,
    reverseResolveJNS,

    refreshNetwork,

    signMessage,
    requestCredential,
    deploySmartAccount,
  };
}
