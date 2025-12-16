/**
 * OAuth3 Integration for Bazaar
 * 
 * Provides decentralized authentication with:
 * - TEE-backed key management
 * - MPC threshold signing
 * - JNS name resolution
 * - IPFS credential storage
 */

import {
  createOAuth3Client,
  AuthProvider,
  type OAuth3Client,
  type OAuth3Session,
  type OAuth3Config,
  type VerifiableCredential,
} from '@jejunetwork/oauth3';
import type { Address, Hex } from 'viem';

export { AuthProvider } from '@jejunetwork/oauth3';

export interface BazaarAuthConfig {
  appId?: string;
  rpcUrl?: string;
  chainId?: number;
  teeAgentUrl?: string;
  decentralized?: boolean;
}

const DEFAULT_APP_ID = 'bazaar.apps.jeju';
const DEFAULT_RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'http://localhost:9545';
const DEFAULT_CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '420691', 10);

let oauth3Client: OAuth3Client | null = null;

export function getOAuth3Client(config: BazaarAuthConfig = {}): OAuth3Client {
  if (!oauth3Client) {
    const redirectUri = typeof window !== 'undefined' 
      ? `${window.location.origin}/auth/callback`
      : 'http://localhost:4006/auth/callback';

    const oauth3Config: OAuth3Config = {
      appId: (config.appId || DEFAULT_APP_ID) as Hex,
      redirectUri,
      rpcUrl: config.rpcUrl || DEFAULT_RPC_URL,
      chainId: config.chainId || DEFAULT_CHAIN_ID,
      teeAgentUrl: config.decentralized ? undefined : config.teeAgentUrl,
      decentralized: config.decentralized ?? true,
    };

    oauth3Client = createOAuth3Client(oauth3Config);
  }
  return oauth3Client;
}

export function resetOAuth3Client(): void {
  oauth3Client = null;
}

/**
 * Initialize OAuth3 for decentralized discovery
 */
export async function initializeOAuth3(config: BazaarAuthConfig = {}): Promise<void> {
  const client = getOAuth3Client(config);
  await client.initialize();
}

/**
 * Login with OAuth3
 */
export async function login(provider: AuthProvider): Promise<OAuth3Session> {
  const client = getOAuth3Client();
  return client.login({ provider });
}

/**
 * Logout
 */
export async function logout(): Promise<void> {
  const client = getOAuth3Client();
  await client.logout();
}

/**
 * Get current session
 */
export function getSession(): OAuth3Session | null {
  const client = getOAuth3Client();
  return client.getSession();
}

/**
 * Check if user is logged in
 */
export function isLoggedIn(): boolean {
  const client = getOAuth3Client();
  return client.isLoggedIn();
}

/**
 * Sign a message using MPC/TEE
 */
export async function signMessage(message: string | Uint8Array): Promise<Hex> {
  const client = getOAuth3Client();
  return client.signMessage({ message });
}

/**
 * Issue a verifiable credential
 */
export async function issueCredential(
  provider: AuthProvider,
  providerId: string,
  providerHandle: string
): Promise<VerifiableCredential> {
  const client = getOAuth3Client();
  return client.issueCredential(provider, providerId, providerHandle);
}

/**
 * Verify a credential
 */
export async function verifyCredential(credential: VerifiableCredential): Promise<boolean> {
  const client = getOAuth3Client();
  return client.verifyCredential(credential);
}

/**
 * Check infrastructure health
 */
export async function checkHealth(): Promise<{
  jns: boolean;
  storage: boolean;
  teeNode: boolean;
}> {
  const client = getOAuth3Client();
  return client.checkInfrastructureHealth();
}

/**
 * Get smart account address
 */
export function getSmartAccountAddress(): Address | null {
  const session = getSession();
  return session?.smartAccount || null;
}
