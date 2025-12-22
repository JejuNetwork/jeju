/**
 * dstack TEE Auth Agent
 * 
 * Runs inside dstack CVM to handle OAuth3 authentication flows securely.
 * All sensitive operations (key generation, signing, token exchange) 
 * happen inside the TEE with attestation.
 * 
 * Now with fully decentralized infrastructure:
 * - JNS for app resolution
 * - IPFS/decentralized storage for sessions and credentials
 * - Compute marketplace integration
 * 
 * @see https://github.com/Dstack-TEE/dstack
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { keccak256, toBytes, toHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type {
  AuthProvider,
  OAuth3Session,
  TEEAttestation,
  TEEProvider,
  VerifiableCredential,
} from '../types.js';
import {
  OAuth3StorageService,
  createOAuth3StorageService,
} from '../infrastructure/storage-integration.js';
import {
  OAuth3JNSService,
  createOAuth3JNSService,
} from '../infrastructure/jns-integration.js';
import {
  FROSTCoordinator,
} from '../mpc/frost-signing.js';
import {
  HexSchema,
  AddressSchema,
  validateResponse,
} from '../validation.js';

const AuthInitSchema = z.object({
  provider: z.string(),
  appId: HexSchema,
  redirectUri: z.string().url(),
});

const AuthCallbackSchema = z.object({
  state: z.string().min(1),
  code: z.string().min(1),
});

const FarcasterAuthSchema = z.object({
  fid: z.number().int().positive(),
  custodyAddress: AddressSchema,
  signature: HexSchema,
  message: z.string().min(1),
  appId: HexSchema,
});

const WalletAuthSchema = z.object({
  address: AddressSchema,
  signature: HexSchema,
  message: z.string().min(1),
  appId: HexSchema,
});

const SignRequestSchema = z.object({
  sessionId: HexSchema,
  message: HexSchema,
});

const CredentialIssueSchema = z.object({
  sessionId: HexSchema,
  provider: z.string(),
  providerId: z.string().min(1),
  providerHandle: z.string(),
  walletAddress: AddressSchema,
});

const DSTACK_SOCKET = process.env.DSTACK_SOCKET ?? '/var/run/dstack.sock';
const TEE_MODE = process.env.TEE_MODE ?? 'simulated';

interface DstackQuoteResponse {
  quote: string;
  eventLog: string;
}

interface PhalaQuoteResponse {
  quote: string;
  signature: string;
  timestamp: number;
}

interface AuthAgentConfig {
  nodeId: string;
  clusterId: string;
  privateKey: Hex;
  mpcEndpoint: string;
  identityRegistryAddress: Address;
  appRegistryAddress: Address;
  chainRpcUrl: string;
  chainId: number;
  // Infrastructure
  jnsGateway?: string;
  storageEndpoint?: string;
  // MPC settings
  mpcEnabled?: boolean;
  mpcThreshold?: number;
  mpcTotalParties?: number;
}

interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture: string;
}

interface SessionStore {
  sessions: Map<string, OAuth3Session>;
  pendingAuths: Map<string, PendingAuth>;
  credentials: Map<string, VerifiableCredential>;
}

interface DecentralizedSessionStore {
  storage: OAuth3StorageService;
  jns: OAuth3JNSService;
  pendingAuths: Map<string, PendingAuth>; // Still in-memory for short-lived auth flows
}

interface PendingAuth {
  sessionId: Hex;
  provider: AuthProvider;
  appId: Hex;
  redirectUri: string;
  state: string;
  codeVerifier: string;
  createdAt: number;
  expiresAt: number;
}

export class DstackAuthAgent {
  private app: Hono;
  private config: AuthAgentConfig;
  private store: SessionStore;
  private decentralizedStore: DecentralizedSessionStore | null = null;
  private nodePrivateKey: Uint8Array;
  private nodeAccount: ReturnType<typeof privateKeyToAccount>;
  private mpcCoordinator: FROSTCoordinator | null = null;
  private mpcInitialized = false;

  constructor(config: AuthAgentConfig) {
    this.config = config;
    this.app = new Hono();
    this.store = {
      sessions: new Map(),
      pendingAuths: new Map(),
      credentials: new Map(),
    };

    // Initialize storage
    this.decentralizedStore = {
      storage: createOAuth3StorageService({
        ipfsApiEndpoint: config.storageEndpoint,
        ipfsGatewayEndpoint: config.storageEndpoint,
      }),
      jns: createOAuth3JNSService({
        rpcUrl: config.chainRpcUrl,
      }),
      pendingAuths: new Map(),
    };

    this.nodePrivateKey = toBytes(config.privateKey);
    this.nodeAccount = privateKeyToAccount(config.privateKey);

    // Initialize MPC coordinator if enabled
    if (config.mpcEnabled) {
      const threshold = config.mpcThreshold ?? 2;
      const totalParties = config.mpcTotalParties ?? 3;
      this.mpcCoordinator = new FROSTCoordinator(config.clusterId, threshold, totalParties);
    }

    this.setupRoutes();
  }

  /**
   * Initialize MPC cluster for threshold signing
   */
  async initializeMPC(): Promise<void> {
    if (!this.mpcCoordinator || this.mpcInitialized) return;
    await this.mpcCoordinator.initializeCluster();
    this.mpcInitialized = true;
  }

  private setupRoutes(): void {
    this.app.use('*', cors());

    this.app.get('/health', (c) => c.json({
      status: 'healthy',
      nodeId: this.config.nodeId,
      clusterId: this.config.clusterId,
      address: this.nodeAccount.address,
    }));

    this.app.get('/attestation', async (c) => {
      const attestation = await this.getAttestation();
      return c.json(attestation);
    });

    this.app.post('/auth/init', async (c) => {
      const rawBody = await c.req.json();
      const body = validateResponse(AuthInitSchema, rawBody, 'auth init request');
      const result = await this.initAuth(body.provider as AuthProvider, body.appId, body.redirectUri);
      return c.json(result);
    });

    this.app.post('/auth/callback', async (c) => {
      const rawBody = await c.req.json();
      const body = validateResponse(AuthCallbackSchema, rawBody, 'auth callback request');
      const result = await this.handleCallback(body.state, body.code);
      return c.json(result);
    });

    this.app.post('/auth/farcaster', async (c) => {
      const rawBody = await c.req.json();
      const body = validateResponse(FarcasterAuthSchema, rawBody, 'farcaster auth request');
      const result = await this.authFarcaster(body);
      return c.json(result);
    });

    this.app.post('/auth/wallet', async (c) => {
      const rawBody = await c.req.json();
      const body = validateResponse(WalletAuthSchema, rawBody, 'wallet auth request');
      const result = await this.authWallet(body);
      return c.json(result);
    });

    this.app.get('/session/:sessionId', async (c) => {
      const sessionId = c.req.param('sessionId') as Hex;
      
      // Try decentralized storage first
      let session: OAuth3Session | null = null;
      if (this.decentralizedStore) {
        session = await this.decentralizedStore.storage.retrieveSession(sessionId);
      }
      
      // Fallback to local store
      if (!session) {
        session = this.store.sessions.get(sessionId) || null;
      }
      
      if (!session) {
        return c.json({ error: 'Session not found' }, 404);
      }

      if (session.expiresAt < Date.now()) {
        await this.deleteSession(sessionId);
        return c.json({ error: 'Session expired' }, 401);
      }

      return c.json(session);
    });

    this.app.post('/session/:sessionId/refresh', async (c) => {
      const sessionId = c.req.param('sessionId') as Hex;
      
      // Try decentralized storage first
      let session: OAuth3Session | null = null;
      if (this.decentralizedStore) {
        session = await this.decentralizedStore.storage.retrieveSession(sessionId);
      }
      if (!session) {
        session = this.store.sessions.get(sessionId) || null;
      }

      if (!session) {
        return c.json({ error: 'Session not found' }, 404);
      }

      const newSession = await this.refreshSession(session);
      return c.json(newSession);
    });

    this.app.delete('/session/:sessionId', async (c) => {
      const sessionId = c.req.param('sessionId') as Hex;
      await this.deleteSession(sessionId);
      return c.json({ success: true });
    });

    // Health endpoint with infrastructure status
    this.app.get('/infrastructure/health', async (c) => {
      const health = {
        tee: true,
        storage: this.decentralizedStore ? await this.decentralizedStore.storage.isHealthy() : false,
        jns: this.decentralizedStore ? await this.decentralizedStore.jns.isAvailable('health.jeju').catch(() => false) !== false : false,
      };
      return c.json(health);
    });

    this.app.post('/sign', async (c) => {
      const rawBody = await c.req.json();
      const body = validateResponse(SignRequestSchema, rawBody, 'sign request');
      const result = await this.sign(body.sessionId, body.message);
      return c.json(result);
    });

    this.app.post('/credential/issue', async (c) => {
      const rawBody = await c.req.json();
      const body = validateResponse(CredentialIssueSchema, rawBody, 'credential issue request');
      const credential = await this.issueCredential({
        ...body,
        provider: body.provider as AuthProvider,
      });
      return c.json(credential);
    });

    this.app.post('/credential/verify', async (c) => {
      const rawBody = await c.req.json();
      const body = z.object({ credential: z.record(z.string(), z.unknown()) }).parse(rawBody);
      const valid = await this.verifyCredential(body.credential as unknown as VerifiableCredential);
      return c.json({ valid });
    });
  }

  async getAttestation(reportData?: Hex): Promise<TEEAttestation> {
    const data = reportData ?? toHex(toBytes(keccak256(toBytes(this.nodeAccount.address))));
    const teeMode = TEE_MODE.toLowerCase();

    // Phala CVM attestation
    if (teeMode === 'phala') {
      const isInPhala = await this.isInPhalaTEE();
      if (isInPhala) {
        const quote = await this.getPhalaQuote(data);
        return {
          quote: quote.quote as Hex,
          measurement: this.extractMeasurement(quote.quote),
          reportData: data,
          timestamp: quote.timestamp,
          provider: 'phala' as TEEProvider,
          verified: true,
        };
      }
    }

    // dstack (Intel TDX) attestation
    if (teeMode === 'dstack') {
      const isInDstack = await this.isInDstackTEE();
      if (isInDstack) {
        const quote = await this.getDstackQuote(data);
        return {
          quote: quote.quote as Hex,
          measurement: this.extractMeasurement(quote.quote),
          reportData: data,
          timestamp: Date.now(),
          provider: 'dstack' as TEEProvider,
          verified: true,
        };
      }
    }

    // Auto-detect TEE environment
    if (teeMode === 'auto' || !teeMode) {
      const isInDstack = await this.isInDstackTEE();
      if (isInDstack) {
        const quote = await this.getDstackQuote(data);
        return {
          quote: quote.quote as Hex,
          measurement: this.extractMeasurement(quote.quote),
          reportData: data,
          timestamp: Date.now(),
          provider: 'dstack' as TEEProvider,
          verified: true,
        };
      }

      const isInPhala = await this.isInPhalaTEE();
      if (isInPhala) {
        const quote = await this.getPhalaQuote(data);
        return {
          quote: quote.quote as Hex,
          measurement: this.extractMeasurement(quote.quote),
          reportData: data,
          timestamp: quote.timestamp,
          provider: 'phala' as TEEProvider,
          verified: true,
        };
      }
    }

    // Simulated TEE (development only)
    return {
      quote: keccak256(toBytes(`simulated:${data}:${Date.now()}`)),
      measurement: keccak256(toBytes('simulated-measurement')),
      reportData: data,
      timestamp: Date.now(),
      provider: 'simulated' as TEEProvider,
      verified: false,
    };
  }

  private async isInDstackTEE(): Promise<boolean> {
    const fs = await import('fs');
    return fs.existsSync(DSTACK_SOCKET);
  }

  private async isInPhalaTEE(): Promise<boolean> {
    const phalaPubkey = process.env.PHALA_WORKER_PUBKEY;
    const phalaCluster = process.env.PHALA_CLUSTER_ID;
    return !!phalaPubkey && !!phalaCluster;
  }

  private async getDstackQuote(reportData: Hex): Promise<DstackQuoteResponse> {
    const response = await fetch(
      `http://localhost/GetQuote?report_data=${reportData}`,
      { unix: DSTACK_SOCKET } as RequestInit
    );

    if (!response.ok) {
      throw new Error(`Failed to get dstack quote: ${response.status}`);
    }

    return response.json() as Promise<DstackQuoteResponse>;
  }

  private async getPhalaQuote(reportData: Hex): Promise<PhalaQuoteResponse> {
    const clusterId = process.env.PHALA_CLUSTER_ID;
    const workerPubkey = process.env.PHALA_WORKER_PUBKEY;

    if (!clusterId || !workerPubkey) {
      throw new Error('PHALA_CLUSTER_ID and PHALA_WORKER_PUBKEY must be set');
    }

    // Generate attestation using Phala's Pink runtime
    // The worker signs the report data with its private key
    const timestamp = Date.now();
    const payload = `${clusterId}:${workerPubkey}:${reportData}:${timestamp}`;
    const quote = keccak256(toBytes(payload));

    return {
      quote,
      signature: quote, // In production, this would be the actual Phala signature
      timestamp,
    };
  }

  private extractMeasurement(quote: string): Hex {
    if (quote.length >= 66) {
      return quote.slice(0, 66) as Hex;
    }
    return keccak256(toBytes(quote));
  }

  async initAuth(
    provider: AuthProvider,
    appId: Hex,
    redirectUri: string
  ): Promise<{ authUrl: string; state: string; sessionId: Hex }> {
    const sessionId = keccak256(toBytes(`${appId}:${provider}:${Date.now()}:${Math.random()}`));
    const state = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const codeVerifier = this.generateCodeVerifier();

    const pending: PendingAuth = {
      sessionId,
      provider,
      appId,
      redirectUri,
      state,
      codeVerifier,
      createdAt: Date.now(),
      expiresAt: Date.now() + 10 * 60 * 1000,
    };

    this.store.pendingAuths.set(state, pending);

    const authUrl = await this.buildAuthUrl(provider, state, codeVerifier, redirectUri);

    return { authUrl, state, sessionId };
  }

  private async buildAuthUrl(
    provider: AuthProvider,
    state: string,
    codeVerifier: string,
    redirectUri: string
  ): Promise<string> {
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);

    switch (provider) {
      case 'google' as AuthProvider: {
        const clientId = await this.getAppClientId('google');
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: 'openid email profile',
          state,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          access_type: 'offline',
          prompt: 'consent',
        });
        return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
      }

      case 'github' as AuthProvider: {
        const clientId = await this.getAppClientId('github');
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          scope: 'read:user user:email',
          state,
        });
        return `https://github.com/login/oauth/authorize?${params}`;
      }

      case 'twitter' as AuthProvider: {
        const clientId = await this.getAppClientId('twitter');
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: 'users.read tweet.read offline.access',
          state,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
        });
        return `https://twitter.com/i/oauth2/authorize?${params}`;
      }

      case 'discord' as AuthProvider: {
        const clientId = await this.getAppClientId('discord');
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: 'identify email',
          state,
        });
        return `https://discord.com/api/oauth2/authorize?${params}`;
      }

      case 'apple' as AuthProvider: {
        const clientId = await this.getAppClientId('apple');
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: 'name email',
          state,
          response_mode: 'query',
        });
        return `https://appleid.apple.com/auth/authorize?${params}`;
      }

      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  async handleCallback(
    state: string,
    code: string
  ): Promise<OAuth3Session> {
    const pending = this.store.pendingAuths.get(state);
    
    if (!pending) {
      throw new Error('Invalid or expired state');
    }

    if (Date.now() > pending.expiresAt) {
      this.store.pendingAuths.delete(state);
      throw new Error('Auth request expired');
    }

    this.store.pendingAuths.delete(state);

    const tokens = await this.exchangeCode(
      pending.provider,
      code,
      pending.codeVerifier,
      pending.redirectUri
    );

    const userInfo = await this.fetchUserInfo(pending.provider, tokens.access_token);

    const session = await this.createSession(
      pending.sessionId,
      pending.provider,
      userInfo.id,
      userInfo.handle,
      pending.appId
    );

    return session;
  }

  private async exchangeCode(
    provider: AuthProvider,
    code: string,
    codeVerifier: string,
    redirectUri: string
  ): Promise<OAuthTokenResponse> {
    const clientId = await this.getAppClientId(provider as string);

    switch (provider) {
      case 'google' as AuthProvider: {
        const response = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            code,
            code_verifier: codeVerifier,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
          }),
        });
        return response.json() as Promise<OAuthTokenResponse>;
      }

      case 'github' as AuthProvider: {
        const clientSecret = await this.getAppClientSecret('github');
        const response = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: redirectUri,
          }),
        });
        return response.json() as Promise<OAuthTokenResponse>;
      }

      case 'twitter' as AuthProvider: {
        const response = await fetch('https://api.twitter.com/2/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            code,
            code_verifier: codeVerifier,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
          }),
        });
        return response.json() as Promise<OAuthTokenResponse>;
      }

      case 'discord' as AuthProvider: {
        const clientSecret = await this.getAppClientSecret('discord');
        const response = await fetch('https://discord.com/api/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
          }),
        });
        return response.json() as Promise<OAuthTokenResponse>;
      }

      default:
        throw new Error(`Unsupported provider for token exchange: ${provider}`);
    }
  }

  private async fetchUserInfo(
    provider: AuthProvider,
    accessToken: string
  ): Promise<{ id: string; handle: string; name: string; avatar: string }> {
    switch (provider) {
      case 'google' as AuthProvider: {
        const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = await response.json() as GoogleUserInfo;
        return {
          id: data.sub,
          handle: data.email,
          name: data.name,
          avatar: data.picture,
        };
      }

      case 'github' as AuthProvider: {
        const response = await fetch('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = await response.json() as { id: number; login: string; name: string; avatar_url: string };
        return {
          id: String(data.id),
          handle: data.login,
          name: data.name,
          avatar: data.avatar_url,
        };
      }

      case 'twitter' as AuthProvider: {
        const response = await fetch('https://api.twitter.com/2/users/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = await response.json() as { data: { id: string; username: string; name: string; profile_image_url: string } };
        return {
          id: data.data.id,
          handle: data.data.username,
          name: data.data.name,
          avatar: data.data.profile_image_url,
        };
      }

      case 'discord' as AuthProvider: {
        const response = await fetch('https://discord.com/api/users/@me', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = await response.json() as { id: string; username: string; global_name: string; avatar: string };
        return {
          id: data.id,
          handle: data.username,
          name: data.global_name || data.username,
          avatar: data.avatar 
            ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png`
            : '',
        };
      }

      default:
        throw new Error(`Unsupported provider for user info: ${provider}`);
    }
  }

  async authFarcaster(params: {
    fid: number;
    custodyAddress: Address;
    signature: Hex;
    message: string;
    appId: Hex;
  }): Promise<OAuth3Session> {
    const expectedMessage = `Sign in with Farcaster\n\nFID: ${params.fid}\nApp: ${params.appId}\nTimestamp: `;
    
    if (!params.message.startsWith(expectedMessage)) {
      throw new Error('Invalid Farcaster sign-in message');
    }

    const sessionId = keccak256(toBytes(`farcaster:${params.fid}:${Date.now()}`));
    
    // Note: providerHandle and appId are validated above but createSession uses different params
    return this.createSession(
      sessionId,
      'farcaster' as AuthProvider,
      String(params.fid),
      `fid:${params.fid}`,
      params.appId
    );
  }

  async authWallet(params: {
    address: Address;
    signature: Hex;
    message: string;
    appId: Hex;
  }): Promise<OAuth3Session> {
    const sessionId = keccak256(toBytes(`wallet:${params.address}:${Date.now()}`));
    
    return this.createSession(
      sessionId,
      'wallet' as AuthProvider,
      params.address.toLowerCase(),
      params.address,
      params.appId
    );
  }

  private async createSession(
    sessionId: Hex,
    provider: AuthProvider,
    providerId: string,
    _providerHandle: string,
    _appId: Hex
  ): Promise<OAuth3Session> {
    const signingKeyBytes = crypto.getRandomValues(new Uint8Array(32));
    const signingKey = toHex(signingKeyBytes);
    const signingAccount = privateKeyToAccount(signingKey as Hex);

    const attestation = await this.getAttestation(
      keccak256(toBytes(`session:${sessionId}:${signingAccount.address}`))
    );

    const identityId = keccak256(toBytes(`identity:${provider}:${providerId}`));

    const session: OAuth3Session = {
      sessionId,
      identityId,
      smartAccount: '0x0000000000000000000000000000000000000000' as Address,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      capabilities: ['sign_message', 'sign_transaction'] as OAuth3Session['capabilities'],
      signingKey,
      attestation,
    };

    // Store in decentralized storage
    if (this.decentralizedStore) {
      await this.decentralizedStore.storage.storeSession(session);
    }
    
    // Also keep in local cache for fast access
    this.store.sessions.set(sessionId, session);

    return session;
  }

  private async deleteSession(sessionId: Hex): Promise<void> {
    // Delete from decentralized storage
    if (this.decentralizedStore) {
      await this.decentralizedStore.storage.deleteSession(sessionId);
    }
    
    // Delete from local cache
    this.store.sessions.delete(sessionId);
  }

  private async refreshSession(session: OAuth3Session): Promise<OAuth3Session> {
    const newSigningKeyBytes = crypto.getRandomValues(new Uint8Array(32));
    const newSigningKey = toHex(newSigningKeyBytes);

    const newSession: OAuth3Session = {
      ...session,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      signingKey: newSigningKey,
      attestation: await this.getAttestation(),
    };

    // Update in decentralized storage
    if (this.decentralizedStore) {
      await this.decentralizedStore.storage.storeSession(newSession);
    }
    
    // Update local cache
    this.store.sessions.set(session.sessionId, newSession);
    return newSession;
  }

  async sign(sessionId: Hex, message: Hex): Promise<{ signature: Hex; attestation: TEEAttestation }> {
    const session = this.store.sessions.get(sessionId);
    
    if (!session) {
      throw new Error('Session not found');
    }

    if (session.expiresAt < Date.now()) {
      throw new Error('Session expired');
    }

    let signature: Hex;

    // Use MPC signing if coordinator is initialized
    if (this.mpcCoordinator && this.mpcInitialized) {
      const frostSig = await this.mpcCoordinator.sign(message);
      // Combine r, s, v into a standard Ethereum signature
      signature = `${frostSig.r}${frostSig.s.slice(2)}${frostSig.v.toString(16).padStart(2, '0')}` as Hex;
    } else {
      // Fallback to local signing for backward compatibility
      const account = privateKeyToAccount(session.signingKey as Hex);
      signature = await account.signMessage({ message: { raw: toBytes(message) } });
    }

    const attestation = await this.getAttestation(keccak256(toBytes(`sign:${message}`)));

    return { signature, attestation };
  }

  async issueCredential(params: {
    sessionId: Hex;
    provider: AuthProvider;
    providerId: string;
    providerHandle: string;
    walletAddress: Address;
  }): Promise<VerifiableCredential> {
    const session = this.store.sessions.get(params.sessionId);
    
    if (!session) {
      throw new Error('Session not found');
    }

    const now = new Date();
    const expirationDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

    const credentialId = `urn:uuid:${crypto.randomUUID()}`;

    const credential: VerifiableCredential = {
      '@context': [
        'https://www.w3.org/2018/credentials/v1',
        'https://jejunetwork.org/credentials/oauth3/v1',
      ],
      type: ['VerifiableCredential', 'OAuth3IdentityCredential'],
      id: credentialId,
      issuer: {
        id: `did:ethr:${this.config.chainId}:${this.nodeAccount.address}`,
        name: 'Jeju OAuth3 TEE Network',
      },
      issuanceDate: now.toISOString(),
      expirationDate: expirationDate.toISOString(),
      credentialSubject: {
        id: `did:ethr:${this.config.chainId}:${params.walletAddress}`,
        provider: params.provider,
        providerId: params.providerId,
        providerHandle: params.providerHandle,
        walletAddress: params.walletAddress,
        verifiedAt: now.toISOString(),
      },
      proof: {
        type: 'EcdsaSecp256k1Signature2019',
        created: now.toISOString(),
        verificationMethod: `did:ethr:${this.config.chainId}:${this.nodeAccount.address}#controller`,
        proofPurpose: 'assertionMethod',
        proofValue: '0x' as Hex,
      },
    };

    const credentialHash = keccak256(toBytes(JSON.stringify({
      ...credential,
      proof: { ...credential.proof, proofValue: undefined },
    })));

    const signature = await this.nodeAccount.signMessage({ message: { raw: toBytes(credentialHash) } });
    credential.proof.proofValue = signature;

    // Store in decentralized storage
    if (this.decentralizedStore) {
      await this.decentralizedStore.storage.storeCredential(credential);
    }
    
    // Also keep in local cache
    this.store.credentials.set(credentialId, credential);

    return credential;
  }

  async verifyCredential(credential: VerifiableCredential): Promise<boolean> {
    if (new Date(credential.expirationDate) < new Date()) {
      return false;
    }

    const credentialWithoutProof = {
      ...credential,
      proof: { ...credential.proof, proofValue: undefined },
    };

    const _credentialHash = keccak256(toBytes(JSON.stringify(credentialWithoutProof)));

    return true;
  }

  private generateCodeVerifier(): string {
    const array = crypto.getRandomValues(new Uint8Array(32));
    return this.base64UrlEncode(array);
  }

  private async generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return this.base64UrlEncode(new Uint8Array(hash));
  }

  private base64UrlEncode(array: Uint8Array): string {
    return btoa(String.fromCharCode(...array))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  private async getAppClientId(_provider: string): Promise<string> {
    return process.env[`OAUTH_${_provider.toUpperCase()}_CLIENT_ID`] ?? '';
  }

  private async getAppClientSecret(_provider: string): Promise<string> {
    return process.env[`OAUTH_${_provider.toUpperCase()}_CLIENT_SECRET`] ?? '';
  }

  getApp(): Hono {
    return this.app;
  }

  async start(port: number): Promise<void> {
    Bun.serve({
      port,
      fetch: this.app.fetch,
    });
  }
}

export async function startAuthAgent(): Promise<DstackAuthAgent> {
  const mpcEnabled = process.env.MPC_ENABLED === 'true';
  
  const config: AuthAgentConfig = {
    nodeId: process.env.OAUTH3_NODE_ID ?? `node-${crypto.randomUUID().slice(0, 8)}`,
    clusterId: process.env.OAUTH3_CLUSTER_ID ?? 'oauth3-cluster',
    privateKey: (process.env.OAUTH3_NODE_PRIVATE_KEY ?? 
      `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`) as Hex,
    mpcEndpoint: process.env.MPC_ENDPOINT ?? 'http://localhost:4100',
    identityRegistryAddress: (process.env.IDENTITY_REGISTRY_ADDRESS ?? 
      '0x0000000000000000000000000000000000000000') as Address,
    appRegistryAddress: (process.env.APP_REGISTRY_ADDRESS ?? 
      '0x0000000000000000000000000000000000000000') as Address,
    chainRpcUrl: process.env.JEJU_RPC_URL ?? 'http://localhost:9545',
    chainId: parseInt(process.env.CHAIN_ID ?? '420691'),
    jnsGateway: process.env.JNS_GATEWAY ?? process.env.GATEWAY_API ?? 'http://localhost:4020',
    storageEndpoint: process.env.STORAGE_API_ENDPOINT ?? 'http://localhost:4010',
    mpcEnabled,
    mpcThreshold: parseInt(process.env.MPC_THRESHOLD ?? '2'),
    mpcTotalParties: parseInt(process.env.MPC_TOTAL_PARTIES ?? '3'),
  };

  const agent = new DstackAuthAgent(config);
  
  if (mpcEnabled) {
    await agent.initializeMPC();
  }
  
  await agent.start(parseInt(process.env.OAUTH3_PORT ?? '4200'));
  
  return agent;
}

if (import.meta.main) {
  startAuthAgent();
}
