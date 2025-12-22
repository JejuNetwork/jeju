/**
 * OAuth3 Authentication Service
 *
 * Wraps the @jejunetwork/oauth3 SDK for decentralized authentication with:
 * - TEE-backed key management
 * - MPC threshold signing
 * - Session management
 * - Decentralized infrastructure integration
 */

import {
  OAuth3Client,
  createOAuth3Client,
  type OAuth3Config,
  AuthProvider,
  type OAuth3Session,
  type OAuth3Identity,
  type DiscoveredApp,
  type DiscoveredNode,
} from '@jejunetwork/oauth3';
import { getNetworkName } from '@jejunetwork/config';
import type { Address, Hex } from 'viem';

export { AuthProvider } from '@jejunetwork/oauth3';

export interface OAuth3Service {
  initialize(): Promise<{ app: DiscoveredApp; nodes: DiscoveredNode[] }>;
  loginWithWallet(): Promise<OAuth3Session>;
  loginWithProvider(provider: AuthProvider): Promise<OAuth3Session>;
  logout(): Promise<void>;
  getSession(): OAuth3Session | null;
  getIdentity(): OAuth3Identity | null;
  isLoggedIn(): boolean;
  signMessage(message: string | Uint8Array): Promise<Hex>;
  getTeeAgentUrl(): string;
  getAppId(): Hex | string;
  getSmartAccountAddress(): Address | null;
  getOwnerAddress(): Address | null;
  checkInfrastructureHealth(): Promise<{ jns: boolean; storage: boolean; teeNode: boolean }>;
}

class OAuth3ServiceImpl implements OAuth3Service {
  private client: OAuth3Client;
  private config: OAuth3Config;

  constructor(config: OAuth3Config) {
    this.config = config;
    this.client = createOAuth3Client(config);
  }

  async initialize(): Promise<{ app: DiscoveredApp; nodes: DiscoveredNode[] }> {
    return this.client.initialize();
  }

  async loginWithWallet(): Promise<OAuth3Session> {
    return this.client.login({ provider: AuthProvider.WALLET });
  }

  async loginWithProvider(provider: AuthProvider): Promise<OAuth3Session> {
    return this.client.login({ provider });
  }

  async logout(): Promise<void> {
    return this.client.logout();
  }

  getSession(): OAuth3Session | null {
    return this.client.getSession();
  }

  getIdentity(): OAuth3Identity | null {
    return this.client.getIdentity();
  }

  isLoggedIn(): boolean {
    return this.client.isLoggedIn();
  }

  async signMessage(message: string | Uint8Array): Promise<Hex> {
    if (!message) {
      throw new Error('Message to sign is required');
    }
    return this.client.signMessage({ message });
  }

  getTeeAgentUrl(): string {
    const node = this.client.getCurrentNode();
    if (!node) {
      throw new Error('TEE agent not initialized or no node selected.');
    }
    return node.endpoint;
  }

  getAppId(): Hex | string {
    return this.config.appId;
  }

  getSmartAccountAddress(): Address | null {
    const session = this.client.getSession();
    if (!session) {
      return null;
    }
    return session.smartAccount;
  }

  getOwnerAddress(): Address | null {
    const identity = this.client.getIdentity();
    if (!identity) {
      return null;
    }
    return identity.owner;
  }

  async checkInfrastructureHealth(): Promise<{ jns: boolean; storage: boolean; teeNode: boolean }> {
    return this.client.checkInfrastructureHealth();
  }
}

let oauth3Service: OAuth3Service | null = null;

export function getOAuth3Service(): OAuth3Service {
  if (!oauth3Service) {
    const network = getNetworkName();
    const chainId = network === 'localnet' ? 420691 : network === 'testnet' ? 420690 : 8453;
    const appId = process.env.OAUTH3_APP_ID || 'example-app.oauth3.jeju';
    const frontendPort = process.env.FRONTEND_PORT || '4501';
    const redirectUri = process.env.OAUTH3_REDIRECT_URI || `http://localhost:${frontendPort}/oauth3/callback`;
    const rpcUrl = process.env.L2_RPC_URL || 'http://localhost:9545';
    const jnsGateway = process.env.JNS_GATEWAY_URL || 'http://localhost:4020';
    const storageEndpoint = process.env.STORAGE_API_ENDPOINT || 'http://localhost:4010';
    const teeAgentUrl = process.env.OAUTH3_TEE_AGENT_URL || 'http://localhost:8004';

    oauth3Service = new OAuth3ServiceImpl({
      appId,
      redirectUri,
      rpcUrl,
      chainId,
      jnsGateway,
      storageEndpoint,
      teeAgentUrl,
      decentralized: true,
    });
  }
  return oauth3Service;
}

export function resetOAuth3Service(): void {
  oauth3Service = null;
}
