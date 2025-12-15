/**
 * OAuth3 Client SDK
 * 
 * TypeScript SDK for integrating OAuth3 authentication into web applications.
 * Supports all authentication providers and credential management.
 * 
 * Now with full decentralized infrastructure:
 * - JNS for app discovery
 * - Decentralized TEE node selection
 * - IPFS storage for credentials
 */

import {
  toHex,
  createPublicClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import {
  AuthProvider,
  type OAuth3Identity,
  type OAuth3Session,
  type OAuth3App,
  type LinkedProvider,
  type VerifiableCredential,
  type FarcasterIdentity,
  type TEEAttestation,
} from '../types.js';
import { FarcasterProvider } from '../providers/farcaster.js';
import {
  OAuth3DecentralizedDiscovery,
  createDecentralizedDiscovery,
  type DiscoveredApp,
  type DiscoveredNode,
} from '../infrastructure/discovery.js';
import {
  OAuth3StorageService,
  createOAuth3StorageService,
} from '../infrastructure/storage-integration.js';
import {
  OAuth3JNSService,
  createOAuth3JNSService,
} from '../infrastructure/jns-integration.js';

export interface OAuth3Config {
  /** App ID (hex) or JNS name (e.g., 'myapp.oauth3.jeju') */
  appId: Hex | string;
  redirectUri: string;
  /** TEE agent URL - if not provided, will use decentralized discovery */
  teeAgentUrl?: string;
  rpcUrl?: string;
  chainId?: number;
  identityRegistryAddress?: Address;
  appRegistryAddress?: Address;
  accountFactoryAddress?: Address;
  /** JNS gateway endpoint */
  jnsGateway?: string;
  /** Storage API endpoint */
  storageEndpoint?: string;
  /** Enable fully decentralized mode */
  decentralized?: boolean;
}

export interface LoginOptions {
  provider: AuthProvider;
  scope?: string[];
  nonce?: string;
  state?: Record<string, unknown>;
}

export interface LinkOptions {
  provider: AuthProvider;
  scope?: string[];
}

export interface SignMessageOptions {
  message: string | Uint8Array;
  useSessionKey?: boolean;
}

export interface TransactionOptions {
  to: Address;
  value?: bigint;
  data?: Hex;
  gasLimit?: bigint;
}

export type OAuth3EventType = 
  | 'login'
  | 'logout'
  | 'sessionRefresh'
  | 'providerLinked'
  | 'providerUnlinked'
  | 'error';

export interface OAuth3Event {
  type: OAuth3EventType;
  data?: unknown;
  timestamp: number;
}

export type OAuth3EventHandler = (event: OAuth3Event) => void;

export class OAuth3Client {
  private config: OAuth3Config;
  private session: OAuth3Session | null = null;
  private identity: OAuth3Identity | null = null;
  private publicClient: PublicClient;
  private farcasterProvider: FarcasterProvider;
  private eventHandlers: Map<OAuth3EventType, Set<OAuth3EventHandler>> = new Map();
  
  // Decentralized infrastructure
  private discovery: OAuth3DecentralizedDiscovery | null = null;
  private storage: OAuth3StorageService | null = null;
  private jns: OAuth3JNSService | null = null;
  private discoveredApp: DiscoveredApp | null = null;
  private currentNode: DiscoveredNode | null = null;

  constructor(config: OAuth3Config) {
    this.config = config;
    this.publicClient = createPublicClient({
      transport: http(config.rpcUrl || 'http://localhost:9545'),
    });
    this.farcasterProvider = new FarcasterProvider();

    // Initialize decentralized services if enabled
    if (config.decentralized !== false) {
      this.discovery = createDecentralizedDiscovery({
        rpcUrl: config.rpcUrl,
        chainId: config.chainId,
        ipfsApiEndpoint: config.storageEndpoint,
      });
      this.storage = createOAuth3StorageService({
        ipfsApiEndpoint: config.storageEndpoint,
      });
      this.jns = createOAuth3JNSService({
        rpcUrl: config.rpcUrl,
        chainId: config.chainId,
      });
    }

    this.loadSession();
  }

  /**
   * Initialize the client with decentralized discovery
   * Call this before login to discover the app and TEE nodes
   */
  async initialize(): Promise<{ app: DiscoveredApp; nodes: DiscoveredNode[] }> {
    if (!this.discovery) {
      throw new Error('Decentralized mode not enabled');
    }

    // Discover the app
    const appId = this.config.appId as string;
    this.discoveredApp = await this.discovery.discoverApp(appId);
    
    if (!this.discoveredApp) {
      throw new Error(`App not found: ${appId}`);
    }

    // Get available TEE nodes
    const nodes = await this.discovery.discoverNodes();
    
    // Select the best node
    this.currentNode = await this.discovery.getBestNode();

    return {
      app: this.discoveredApp,
      nodes,
    };
  }

  /**
   * Get the current TEE agent URL (from config or discovered node)
   */
  private getTeeAgentUrl(): string {
    if (this.config.teeAgentUrl) {
      return this.config.teeAgentUrl;
    }
    if (this.currentNode) {
      return this.currentNode.endpoint;
    }
    throw new Error('No TEE agent URL configured. Call initialize() first or provide teeAgentUrl in config.');
  }

  /**
   * Failover to next available TEE node
   */
  private async failoverToNextNode(): Promise<void> {
    if (!this.discovery) return;

    const nodes = await this.discovery.discoverNodes();
    const currentEndpoint = this.currentNode?.endpoint;
    
    // Find a healthy node that isn't the current one
    const nextNode = nodes.find(n => n.healthy && n.endpoint !== currentEndpoint);
    
    if (nextNode) {
      this.currentNode = nextNode;
      this.emit('error', { type: 'failover', previousNode: currentEndpoint, newNode: nextNode.endpoint });
    } else {
      throw new Error('No healthy TEE nodes available');
    }
  }

  async login(options: LoginOptions): Promise<OAuth3Session> {
    this.emit('login', { provider: options.provider, status: 'started' });

    // If decentralized mode and not initialized, do auto-initialization
    if (this.discovery && !this.currentNode) {
      await this.initialize();
    }

    try {
      let session: OAuth3Session;
      
      switch (options.provider) {
        case AuthProvider.WALLET:
          session = await this.loginWithWallet();
          break;
        case AuthProvider.FARCASTER:
          session = await this.loginWithFarcaster();
          break;
        default:
          session = await this.loginWithOAuth(options);
      }

      // Store session in decentralized storage
      if (this.storage) {
        await this.storage.storeSession(session);
      }

      return session;
    } catch (error) {
      // Try failover on error
      if (this.discovery && this.currentNode) {
        await this.failoverToNextNode();
        return this.login(options);
      }
      throw error;
    }
  }

  private async loginWithWallet(): Promise<OAuth3Session> {
    if (typeof window === 'undefined' || !window.ethereum) {
      throw new Error('No Ethereum provider found');
    }

    const accounts = await window.ethereum.request({
      method: 'eth_requestAccounts',
    }) as string[];

    const address = accounts[0] as Address;
    const nonce = crypto.randomUUID();
    
    const message = this.createSignInMessage(address, nonce);
    
    const signature = await window.ethereum.request({
      method: 'personal_sign',
      params: [message, address],
    }) as Hex;

    const teeAgentUrl = this.getTeeAgentUrl();
    const appId = this.discoveredApp?.appId || this.config.appId;

    const response = await fetch(`${teeAgentUrl}/auth/wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address,
        signature,
        message,
        appId,
      }),
    });

    if (!response.ok) {
      throw new Error(`Wallet login failed: ${response.status}`);
    }

    const session = await response.json() as OAuth3Session;
    this.setSession(session);
    this.emit('login', { provider: 'wallet', session });

    return session;
  }

  private async loginWithFarcaster(): Promise<OAuth3Session> {
    const nonce = crypto.randomUUID();
    const domain = new URL(this.config.redirectUri).hostname;

    const message = this.farcasterProvider.generateSignInMessage({
      domain,
      address: '0x0000000000000000000000000000000000000000' as Address,
      fid: 0,
      custody: '0x0000000000000000000000000000000000000000' as Address,
      nonce,
    });

    const signatureRequest = {
      type: 'farcaster_sign_in',
      message,
      nonce,
      domain,
    };

    const result = await this.requestFarcasterSignature(signatureRequest);

    const teeAgentUrl = this.getTeeAgentUrl();
    const appId = this.discoveredApp?.appId || this.config.appId;

    const response = await fetch(`${teeAgentUrl}/auth/farcaster`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fid: result.fid,
        custodyAddress: result.custodyAddress,
        signature: result.signature,
        message: result.message,
        appId,
      }),
    });

    if (!response.ok) {
      throw new Error(`Farcaster login failed: ${response.status}`);
    }

    const session = await response.json() as OAuth3Session;
    this.setSession(session);
    this.emit('login', { provider: 'farcaster', session });

    return session;
  }

  private async loginWithOAuth(options: LoginOptions): Promise<OAuth3Session> {
    const teeAgentUrl = this.getTeeAgentUrl();
    const appId = this.discoveredApp?.appId || this.config.appId;

    const initResponse = await fetch(`${teeAgentUrl}/auth/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: options.provider,
        appId,
        redirectUri: this.config.redirectUri,
      }),
    });

    if (!initResponse.ok) {
      throw new Error(`Failed to initialize OAuth: ${initResponse.status}`);
    }

    const { authUrl, state, sessionId } = await initResponse.json() as {
      authUrl: string;
      state: string;
      sessionId: Hex;
    };

    sessionStorage.setItem('oauth3_state', state);
    sessionStorage.setItem('oauth3_session_id', sessionId);

    const popup = this.openPopup(authUrl);

    return new Promise((resolve, reject) => {
      const handleMessage = async (event: MessageEvent) => {
        if (event.origin !== new URL(this.config.redirectUri).origin) return;

        const { code, state: returnedState, error } = event.data as {
          code?: string;
          state?: string;
          error?: string;
        };

        if (error) {
          window.removeEventListener('message', handleMessage);
          popup?.close();
          reject(new Error(error));
          return;
        }

        if (!code || returnedState !== state) {
          return;
        }

        window.removeEventListener('message', handleMessage);
        popup?.close();

        const callbackResponse = await fetch(`${teeAgentUrl}/auth/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state, code }),
        });

        if (!callbackResponse.ok) {
          reject(new Error(`OAuth callback failed: ${callbackResponse.status}`));
          return;
        }

        const session = await callbackResponse.json() as OAuth3Session;
        this.setSession(session);
        this.emit('login', { provider: options.provider, session });
        resolve(session);
      };

      window.addEventListener('message', handleMessage);

      const checkClosed = setInterval(() => {
        if (popup?.closed) {
          clearInterval(checkClosed);
          window.removeEventListener('message', handleMessage);
          reject(new Error('Login cancelled'));
        }
      }, 1000);
    });
  }

  async logout(): Promise<void> {
    if (!this.session) return;

    const teeAgentUrl = this.getTeeAgentUrl();

    await fetch(`${teeAgentUrl}/session/${this.session.sessionId}`, {
      method: 'DELETE',
    });

    // Remove from decentralized storage
    if (this.storage) {
      await this.storage.deleteSession(this.session.sessionId);
    }

    this.clearSession();
    this.emit('logout', {});
  }

  async linkProvider(options: LinkOptions): Promise<LinkedProvider> {
    if (!this.session) {
      throw new Error('Not logged in');
    }

    const linkSession = await this.login(options as LoginOptions);

    const linkedProvider: LinkedProvider = {
      provider: options.provider,
      providerId: linkSession.identityId,
      providerHandle: '',
      linkedAt: Date.now(),
      verified: true,
      credential: null,
    };

    this.emit('providerLinked', { provider: options.provider });
    return linkedProvider;
  }

  async unlinkProvider(provider: AuthProvider): Promise<void> {
    if (!this.session) {
      throw new Error('Not logged in');
    }

    this.emit('providerUnlinked', { provider });
  }

  async signMessage(options: SignMessageOptions): Promise<Hex> {
    if (!this.session) {
      throw new Error('Not logged in');
    }

    const messageHex = typeof options.message === 'string'
      ? toHex(new TextEncoder().encode(options.message))
      : toHex(options.message);

    const teeAgentUrl = this.getTeeAgentUrl();

    const response = await fetch(`${teeAgentUrl}/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this.session.sessionId,
        message: messageHex,
      }),
    });

    if (!response.ok) {
      // Try failover
      if (this.discovery) {
        await this.failoverToNextNode();
        return this.signMessage(options);
      }
      throw new Error(`Signing failed: ${response.status}`);
    }

    const { signature } = await response.json() as { signature: Hex };
    return signature;
  }

  async issueCredential(
    provider: AuthProvider,
    providerId: string,
    providerHandle: string
  ): Promise<VerifiableCredential> {
    if (!this.session) {
      throw new Error('Not logged in');
    }

    const teeAgentUrl = this.getTeeAgentUrl();

    const response = await fetch(`${teeAgentUrl}/credential/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this.session.sessionId,
        provider,
        providerId,
        providerHandle,
        walletAddress: this.session.smartAccount,
      }),
    });

    if (!response.ok) {
      throw new Error(`Credential issuance failed: ${response.status}`);
    }

    const credential = await response.json() as VerifiableCredential;

    // Store credential in decentralized storage
    if (this.storage) {
      await this.storage.storeCredential(credential);
    }

    return credential;
  }

  async verifyCredential(credential: VerifiableCredential): Promise<boolean> {
    const teeAgentUrl = this.getTeeAgentUrl();

    const response = await fetch(`${teeAgentUrl}/credential/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
    });

    if (!response.ok) {
      return false;
    }

    const { valid } = await response.json() as { valid: boolean };
    return valid;
  }

  /**
   * Retrieve a credential from decentralized storage
   */
  async retrieveCredential(credentialId: string): Promise<VerifiableCredential | null> {
    if (!this.storage) {
      throw new Error('Decentralized storage not enabled');
    }
    return this.storage.retrieveCredential(credentialId);
  }

  /**
   * List all credentials for the current identity
   */
  async listCredentials(): Promise<VerifiableCredential[]> {
    if (!this.session || !this.storage) {
      return [];
    }

    const subjectDid = `did:ethr:${this.config.chainId || 420691}:${this.session.smartAccount}`;
    const storedCredentials = await this.storage.listCredentialsForSubject(subjectDid);
    
    const credentials: VerifiableCredential[] = [];
    for (const stored of storedCredentials) {
      const credential = await this.storage.retrieveCredential(stored.credentialId);
      if (credential) {
        credentials.push(credential);
      }
    }

    return credentials;
  }

  async getAttestation(): Promise<TEEAttestation> {
    const teeAgentUrl = this.getTeeAgentUrl();

    const response = await fetch(`${teeAgentUrl}/attestation`);
    
    if (!response.ok) {
      throw new Error(`Failed to get attestation: ${response.status}`);
    }

    return response.json() as Promise<TEEAttestation>;
  }

  async refreshSession(): Promise<OAuth3Session> {
    if (!this.session) {
      throw new Error('No session to refresh');
    }

    const teeAgentUrl = this.getTeeAgentUrl();

    const response = await fetch(
      `${teeAgentUrl}/session/${this.session.sessionId}/refresh`,
      { method: 'POST' }
    );

    if (!response.ok) {
      throw new Error(`Session refresh failed: ${response.status}`);
    }

    const newSession = await response.json() as OAuth3Session;
    this.setSession(newSession);

    // Update in decentralized storage
    if (this.storage) {
      await this.storage.storeSession(newSession);
    }

    this.emit('sessionRefresh', { session: newSession });

    return newSession;
  }

  // ============ Decentralized Infrastructure Access ============

  /**
   * Get the discovered app details
   */
  getDiscoveredApp(): DiscoveredApp | null {
    return this.discoveredApp;
  }

  /**
   * Get the current TEE node
   */
  getCurrentNode(): DiscoveredNode | null {
    return this.currentNode;
  }

  /**
   * Get the JNS service for name resolution
   */
  getJNS(): OAuth3JNSService | null {
    return this.jns;
  }

  /**
   * Get the storage service for credential management
   */
  getStorage(): OAuth3StorageService | null {
    return this.storage;
  }

  /**
   * Get the discovery service
   */
  getDiscovery(): OAuth3DecentralizedDiscovery | null {
    return this.discovery;
  }

  /**
   * Check infrastructure health
   */
  async checkInfrastructureHealth(): Promise<{
    jns: boolean;
    storage: boolean;
    teeNode: boolean;
  }> {
    return {
      jns: this.jns ? await this.jns.isAvailable('health.jeju').catch(() => false) !== false : false,
      storage: this.storage ? await this.storage.isHealthy() : false,
      teeNode: this.currentNode ? this.currentNode.healthy : false,
    };
  }

  getSession(): OAuth3Session | null {
    return this.session;
  }

  getIdentity(): OAuth3Identity | null {
    return this.identity;
  }

  isLoggedIn(): boolean {
    return this.session !== null && this.session.expiresAt > Date.now();
  }

  on(event: OAuth3EventType, handler: OAuth3EventHandler): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);

    return () => {
      this.eventHandlers.get(event)?.delete(handler);
    };
  }

  private emit(type: OAuth3EventType, data?: unknown): void {
    const event: OAuth3Event = { type, data, timestamp: Date.now() };
    this.eventHandlers.get(type)?.forEach(handler => handler(event));
  }

  private setSession(session: OAuth3Session): void {
    this.session = session;
    
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('oauth3_session', JSON.stringify(session));
    }
  }

  private clearSession(): void {
    this.session = null;
    this.identity = null;
    
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('oauth3_session');
    }
  }

  private loadSession(): void {
    if (typeof localStorage === 'undefined') return;

    const stored = localStorage.getItem('oauth3_session');
    if (!stored) return;

    const session = JSON.parse(stored) as OAuth3Session;
    
    if (session.expiresAt > Date.now()) {
      this.session = session;
    } else {
      localStorage.removeItem('oauth3_session');
    }
  }

  private createSignInMessage(address: Address, nonce: string): string {
    const domain = new URL(this.config.redirectUri).hostname;
    return `${domain} wants you to sign in with your Ethereum account:
${address}

Sign in to OAuth3

URI: ${this.config.redirectUri}
Version: 1
Chain ID: ${this.config.chainId}
Nonce: ${nonce}
Issued At: ${new Date().toISOString()}`;
  }

  private openPopup(url: string): Window | null {
    const width = 500;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    return window.open(
      url,
      'oauth3_popup',
      `width=${width},height=${height},left=${left},top=${top},popup=1`
    );
  }

  private async requestFarcasterSignature(_request: {
    type: string;
    message: string;
    nonce: string;
    domain: string;
  }): Promise<{
    fid: number;
    custodyAddress: Address;
    signature: Hex;
    message: string;
  }> {
    throw new Error('Farcaster signature request must be handled by frame or wallet');
  }
}

export function createOAuth3Client(config: OAuth3Config): OAuth3Client {
  return new OAuth3Client(config);
}

declare global {
  interface Window {
    ethereum?: {
      request: <T = unknown>(args: { method: string; params?: unknown[] }) => Promise<T>;
      on: (event: string, callback: (...args: unknown[]) => void) => void;
      removeListener: (event: string, callback: (...args: unknown[]) => void) => void;
    };
  }
}
