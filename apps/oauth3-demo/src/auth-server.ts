/**
 * OAuth3 Decentralized Auth Server - Fully Integrated with Jeju Network
 * 
 * Integrations:
 * - TEE attestation (dstack/simulated)
 * - On-chain identity registry (OAuth3IdentityRegistry)
 * - JNS (Jeju Name Service) for .jeju names
 * - Decentralized storage for profiles/credentials
 * - Moderation system (BanManager/ModerationMarketplace)
 * - Smart account deployment (AccountFactory)
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createPublicClient, createWalletClient, http, parseAbi, keccak256, toBytes, toHex, verifyMessage, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const app = new Hono();
const PORT = parseInt(process.env.OAUTH3_AUTH_PORT || '4200');
const CHAIN_ID = parseInt(process.env.CHAIN_ID || '420691');
const RPC_URL = process.env.JEJU_RPC_URL || 'http://localhost:9545';
const DSTACK_SOCKET = process.env.DSTACK_SOCKET ?? '/var/run/dstack.sock';

// ============================================================================
// Contract Addresses
// ============================================================================

const ZERO = '0x0000000000000000000000000000000000000000' as Address;
const IDENTITY_REGISTRY = (process.env.IDENTITY_REGISTRY_ADDRESS || ZERO) as Address;
const BAN_MANAGER = (process.env.BAN_MANAGER_ADDRESS || ZERO) as Address;
const TEE_VERIFIER = (process.env.TEE_VERIFIER_ADDRESS || ZERO) as Address;
const ACCOUNT_FACTORY = (process.env.ACCOUNT_FACTORY_ADDRESS || ZERO) as Address;
const JNS_REGISTRY = (process.env.JNS_REGISTRY_ADDRESS || ZERO) as Address;
const JNS_RESOLVER = (process.env.JNS_RESOLVER_ADDRESS || ZERO) as Address;
const STORAGE_REGISTRY = (process.env.STORAGE_REGISTRY_ADDRESS || ZERO) as Address;
const COMPUTE_REGISTRY = (process.env.COMPUTE_REGISTRY_ADDRESS || ZERO) as Address;

// ============================================================================
// Contract ABIs
// ============================================================================

const IDENTITY_REGISTRY_ABI = parseAbi([
  'function createIdentity(address owner, address smartAccount, (string name, string avatar, string bio, string url, string jnsName) metadata) returns (bytes32)',
  'function linkProvider(bytes32 identityId, uint8 provider, bytes32 providerId, string providerHandle, bytes proof)',
  'function getIdentity(bytes32 identityId) view returns ((bytes32 id, address owner, address smartAccount, uint256 createdAt, uint256 updatedAt, uint256 nonce, bool active))',
  'function getIdentityByOwner(address owner) view returns ((bytes32 id, address owner, address smartAccount, uint256 createdAt, uint256 updatedAt, uint256 nonce, bool active))',
  'function getLinkedProviders(bytes32 identityId) view returns ((uint8 provider, bytes32 providerId, string providerHandle, uint256 linkedAt, bool verified, bytes32 credentialHash)[])',
  'function issueCredential(bytes32 identityId, uint8 provider, bytes32 credentialHash)',
  'function getMetadata(bytes32 identityId) view returns ((string name, string avatar, string bio, string url, string jnsName))',
  'function updateMetadata(bytes32 identityId, (string name, string avatar, string bio, string url, string jnsName) metadata)',
]);

const BAN_MANAGER_ABI = parseAbi([
  'function isAddressBanned(address target) view returns (bool)',
  'function isOnNotice(address target) view returns (bool)',
  'function getAddressBan(address target) view returns ((bool isBanned, uint8 banType, uint256 bannedAt, uint256 expiresAt, string reason, bytes32 proposalId, address reporter, bytes32 caseId))',
]);

const JNS_REGISTRY_ABI = parseAbi([
  'function owner(bytes32 node) view returns (address)',
  'function resolver(bytes32 node) view returns (address)',
  'function recordExists(bytes32 node) view returns (bool)',
  'function setSubnodeOwner(bytes32 node, bytes32 label, address owner) returns (bytes32)',
]);

const JNS_RESOLVER_ABI = parseAbi([
  'function addr(bytes32 node) view returns (address)',
  'function name(bytes32 node) view returns (string)',
  'function text(bytes32 node, string key) view returns (string)',
  'function setAddr(bytes32 node, address a)',
  'function setName(bytes32 node, string name)',
  'function setText(bytes32 node, string key, string value)',
]);

const ACCOUNT_FACTORY_ABI = parseAbi([
  'function createAccount(address owner, uint256 salt) returns (address)',
  'function getAddress(address owner, uint256 salt) view returns (address)',
]);

const TEE_VERIFIER_ABI = parseAbi([
  'function isNodeActive(bytes32 nodeId) view returns (bool)',
  'function getActiveNodes() view returns (bytes32[])',
]);

const STORAGE_REGISTRY_ABI = parseAbi([
  'function getActiveProviders() view returns (address[])',
  'function getProvider(address provider) view returns ((address owner, string name, string endpoint, uint8 providerType, bytes32 attestationHash, uint256 stake, uint256 registeredAt, uint256 agentId, bool active, bool verified))',
]);

const COMPUTE_REGISTRY_ABI = parseAbi([
  'function getActiveProviders() view returns (address[])',
  'function getProvider(address provider) view returns ((address owner, string name, string endpoint, bytes32 attestationHash, uint256 stake, uint256 registeredAt, uint256 agentId, bool active))',
]);

// ============================================================================
// OAuth Provider Configs
// ============================================================================

const PROVIDERS: Record<string, { authUrl: string; tokenUrl: string; userInfoUrl: string; scopes: string[]; pkce: boolean }> = {
  discord: { authUrl: 'https://discord.com/api/oauth2/authorize', tokenUrl: 'https://discord.com/api/oauth2/token', userInfoUrl: 'https://discord.com/api/users/@me', scopes: ['identify', 'email'], pkce: false },
  twitter: { authUrl: 'https://twitter.com/i/oauth2/authorize', tokenUrl: 'https://api.twitter.com/2/oauth2/token', userInfoUrl: 'https://api.twitter.com/2/users/me?user.fields=profile_image_url', scopes: ['tweet.read', 'users.read', 'offline.access'], pkce: true },
  google: { authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo', scopes: ['openid', 'email', 'profile'], pkce: true },
  github: { authUrl: 'https://github.com/login/oauth/authorize', tokenUrl: 'https://github.com/login/oauth/access_token', userInfoUrl: 'https://api.github.com/user', scopes: ['read:user', 'user:email'], pkce: false },
  facebook: { authUrl: 'https://www.facebook.com/v19.0/dialog/oauth', tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token', userInfoUrl: 'https://graph.facebook.com/v19.0/me?fields=id,name,email,picture', scopes: ['email', 'public_profile'], pkce: false },
  linkedin: { authUrl: 'https://www.linkedin.com/oauth/v2/authorization', tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken', userInfoUrl: 'https://api.linkedin.com/v2/me', scopes: ['openid', 'profile', 'email'], pkce: false },
  slack: { authUrl: 'https://slack.com/oauth/v2/authorize', tokenUrl: 'https://slack.com/api/oauth.v2.access', userInfoUrl: 'https://slack.com/api/users.identity', scopes: ['identity.basic', 'identity.email'], pkce: false },
  tiktok: { authUrl: 'https://www.tiktok.com/v2/auth/authorize/', tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/', userInfoUrl: 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url', scopes: ['user.info.basic'], pkce: true },
  notion: { authUrl: 'https://api.notion.com/v1/oauth/authorize', tokenUrl: 'https://api.notion.com/v1/oauth/token', userInfoUrl: 'https://api.notion.com/v1/users/me', scopes: [], pkce: false },
  instagram: { authUrl: 'https://api.instagram.com/oauth/authorize', tokenUrl: 'https://api.instagram.com/oauth/access_token', userInfoUrl: 'https://graph.instagram.com/me?fields=id,username', scopes: ['user_profile'], pkce: false },
};

const ENV_KEYS: Record<string, { id: string; secret: string }> = {
  discord: { id: 'OAUTH_DISCORD_CLIENT_ID', secret: 'OAUTH_DISCORD_CLIENT_SECRET' },
  twitter: { id: 'OAUTH_TWITTER_CLIENT_ID', secret: 'OAUTH_TWITTER_CLIENT_SECRET' },
  google: { id: 'OAUTH_GOOGLE_CLIENT_ID', secret: 'OAUTH_GOOGLE_CLIENT_SECRET' },
  facebook: { id: 'OAUTH_FACEBOOK_APP_ID', secret: 'OAUTH_FACEBOOK_APP_SECRET' },
  github: { id: 'OAUTH_GITHUB_CLIENT_ID', secret: 'OAUTH_GITHUB_CLIENT_SECRET' },
  linkedin: { id: 'OAUTH_LINKEDIN_CLIENT_ID', secret: 'OAUTH_LINKEDIN_CLIENT_SECRET' },
  slack: { id: 'OAUTH_SLACK_CLIENT_ID', secret: 'OAUTH_SLACK_CLIENT_SECRET' },
  tiktok: { id: 'OAUTH_TIKTOK_CLIENT_KEY', secret: 'OAUTH_TIKTOK_CLIENT_SECRET' },
  notion: { id: 'OAUTH_NOTION_CLIENT_ID', secret: 'OAUTH_NOTION_CLIENT_SECRET' },
  instagram: { id: 'OAUTH_INSTAGRAM_CLIENT_ID', secret: 'OAUTH_INSTAGRAM_CLIENT_SECRET' },
};

// On-chain provider enum - used when linking providers to identity registry

function getCredentials(provider: string) {
  const env = ENV_KEYS[provider];
  if (!env) return null;
  const clientId = process.env[env.id];
  if (!clientId) return null;
  return { clientId, clientSecret: process.env[env.secret] || '' };
}

// ============================================================================
// Initialize Clients
// ============================================================================

const chain = { id: CHAIN_ID, name: 'Jeju', nativeCurrency: { decimals: 18, name: 'ETH', symbol: 'ETH' }, rpcUrls: { default: { http: [RPC_URL] } } };
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

const NODE_KEY = process.env.OAUTH3_NODE_PRIVATE_KEY || `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}` as Hex;
const nodeAccount = privateKeyToAccount(NODE_KEY as Hex);
const walletClient = createWalletClient({ account: nodeAccount, chain, transport: http(RPC_URL) });
const NODE_ID = keccak256(toBytes(`oauth3-node:${nodeAccount.address}:${CHAIN_ID}`));

// ============================================================================
// Storage
// ============================================================================

const sessions = new Map<string, Session>();
const pendingAuths = new Map<string, PendingAuth>();

interface Session {
  sessionId: Hex; identityId: Hex; smartAccount: Address; expiresAt: number;
  capabilities: string[]; signingKey: Hex; attestation: Attestation;
  provider: string; providerId: string; providerHandle: string; providerAvatar?: string;
  onChainIdentity: boolean; jnsName?: string;
}

interface Attestation { quote: Hex; measurement: Hex; reportData: Hex; timestamp: number; provider: string; verified: boolean; }
interface PendingAuth { sessionId: Hex; provider: string; appId: Hex; redirectUri: string; state: string; codeVerifier: string; expiresAt: number; }

// ============================================================================
// TEE Functions
// ============================================================================

async function isInRealTEE(): Promise<boolean> {
  const fs = await import('fs');
  return fs.existsSync(DSTACK_SOCKET);
}

async function getDstackQuote(reportData: Hex): Promise<{ quote: string }> {
  const response = await fetch(`http://localhost/GetQuote?report_data=${reportData}`, { unix: DSTACK_SOCKET } as RequestInit);
  if (!response.ok) throw new Error(`dstack quote failed: ${response.status}`);
  return response.json();
}

async function genAttestation(data?: Hex): Promise<Attestation> {
  const reportData = data || toHex(toBytes(keccak256(toBytes(nodeAccount.address))));
  const inTEE = await isInRealTEE();

  if (inTEE) {
    const quote = await getDstackQuote(reportData);
    return { quote: quote.quote as Hex, measurement: quote.quote.slice(0, 66) as Hex, reportData, timestamp: Date.now(), provider: 'dstack', verified: true };
  }

  return { quote: keccak256(toBytes(`simulated:${reportData}:${Date.now()}`)), measurement: keccak256(toBytes('oauth3-demo-measurement')), reportData, timestamp: Date.now(), provider: 'simulated', verified: false };
}

// ============================================================================
// JNS Functions
// ============================================================================

function namehash(name: string): Hex {
  let node = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;
  if (!name) return node;
  const labels = name.split('.').reverse();
  for (const label of labels) {
    const labelHash = keccak256(toBytes(label));
    node = keccak256(toBytes(node + labelHash.slice(2))) as Hex;
  }
  return node;
}

async function resolveJNS(name: string): Promise<Address | null> {
  if (JNS_REGISTRY === ZERO || JNS_RESOLVER === ZERO) return null;
  const node = namehash(name);
  const exists = await publicClient.readContract({ address: JNS_REGISTRY, abi: JNS_REGISTRY_ABI, functionName: 'recordExists', args: [node] }).catch(() => false);
  if (!exists) return null;
  return publicClient.readContract({ address: JNS_RESOLVER, abi: JNS_RESOLVER_ABI, functionName: 'addr', args: [node] }).catch(() => null);
}

async function reverseResolveJNS(address: Address): Promise<string | null> {
  if (JNS_REGISTRY === ZERO || JNS_RESOLVER === ZERO) return null;
  const reverseNode = namehash(`${address.toLowerCase().slice(2)}.addr.reverse`);
  return publicClient.readContract({ address: JNS_RESOLVER, abi: JNS_RESOLVER_ABI, functionName: 'name', args: [reverseNode] }).catch(() => null);
}

// ============================================================================
// Storage Functions
// ============================================================================

interface StorageProviderInfo { address: Address; name: string; endpoint: string; active: boolean; }

async function getStorageProviders(): Promise<StorageProviderInfo[]> {
  if (STORAGE_REGISTRY === ZERO) return [];
  const addresses = await publicClient.readContract({ address: STORAGE_REGISTRY, abi: STORAGE_REGISTRY_ABI, functionName: 'getActiveProviders', args: [] }).catch(() => []);
  const providers: StorageProviderInfo[] = [];
  for (const addr of addresses) {
    const info = await publicClient.readContract({ address: STORAGE_REGISTRY, abi: STORAGE_REGISTRY_ABI, functionName: 'getProvider', args: [addr] }).catch(() => null);
    if (info && info.active) providers.push({ address: addr, name: info.name, endpoint: info.endpoint, active: info.active });
  }
  return providers;
}

async function storeCredentialToIPFS(credential: object): Promise<string | null> {
  const providers = await getStorageProviders();
  if (providers.length === 0) return null;
  
  const provider = providers[0]!;
  const response = await fetch(`${provider.endpoint}/api/v0/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credential),
  }).catch(() => null);
  
  if (!response?.ok) return null;
  const result = await response.json() as { Hash?: string; cid?: string };
  return result.Hash || result.cid || null;
}

// ============================================================================
// Compute Functions
// ============================================================================

interface ComputeProviderInfo { address: Address; name: string; endpoint: string; active: boolean; }

async function getComputeProviders(): Promise<ComputeProviderInfo[]> {
  if (COMPUTE_REGISTRY === ZERO) return [];
  const addresses = await publicClient.readContract({ address: COMPUTE_REGISTRY, abi: COMPUTE_REGISTRY_ABI, functionName: 'getActiveProviders', args: [] }).catch(() => []);
  const providers: ComputeProviderInfo[] = [];
  for (const addr of addresses) {
    const info = await publicClient.readContract({ address: COMPUTE_REGISTRY, abi: COMPUTE_REGISTRY_ABI, functionName: 'getProvider', args: [addr] }).catch(() => null);
    if (info && info.active) providers.push({ address: addr, name: info.name, endpoint: info.endpoint, active: info.active });
  }
  return providers;
}

// ============================================================================
// Moderation Functions
// ============================================================================

async function checkBanStatus(address: Address): Promise<{ banned: boolean; onNotice: boolean; reason?: string }> {
  if (BAN_MANAGER === ZERO) return { banned: false, onNotice: false };
  const [isBanned, isOnNotice] = await Promise.all([
    publicClient.readContract({ address: BAN_MANAGER, abi: BAN_MANAGER_ABI, functionName: 'isAddressBanned', args: [address] }).catch(() => false),
    publicClient.readContract({ address: BAN_MANAGER, abi: BAN_MANAGER_ABI, functionName: 'isOnNotice', args: [address] }).catch(() => false),
  ]);
  if (isBanned || isOnNotice) {
    const banRecord = await publicClient.readContract({ address: BAN_MANAGER, abi: BAN_MANAGER_ABI, functionName: 'getAddressBan', args: [address] }).catch(() => null);
    return { banned: isBanned, onNotice: isOnNotice, reason: banRecord?.reason };
  }
  return { banned: false, onNotice: false };
}

// ============================================================================
// Identity Functions
// ============================================================================

async function getOrCreateIdentity(owner: Address, provider: string, providerId: string, providerHandle: string): Promise<{ identityId: Hex; smartAccount: Address; jnsName: string | null; isNew: boolean }> {
  // Resolve JNS name
  const jnsName = await reverseResolveJNS(owner);

  if (IDENTITY_REGISTRY === ZERO) {
    return { identityId: keccak256(toBytes(`identity:${provider}:${providerId}`)), smartAccount: ZERO, jnsName, isNew: false };
  }

  const existingIdentity = await publicClient.readContract({ address: IDENTITY_REGISTRY, abi: IDENTITY_REGISTRY_ABI, functionName: 'getIdentityByOwner', args: [owner] }).catch(() => null);
  if (existingIdentity && existingIdentity.id !== keccak256(toBytes(''))) {
    // Get metadata for JNS name
    const metadata = await publicClient.readContract({ address: IDENTITY_REGISTRY, abi: IDENTITY_REGISTRY_ABI, functionName: 'getMetadata', args: [existingIdentity.id] }).catch(() => null);
    return { identityId: existingIdentity.id, smartAccount: existingIdentity.smartAccount, jnsName: metadata?.jnsName || jnsName, isNew: false };
  }

  // Create new identity
  const metadata = { name: providerHandle, avatar: '', bio: '', url: '', jnsName: jnsName || '' };
  let smartAccount = ZERO;
  if (ACCOUNT_FACTORY !== ZERO) {
    smartAccount = await publicClient.readContract({ address: ACCOUNT_FACTORY, abi: ACCOUNT_FACTORY_ABI, functionName: 'getAddress', args: [owner, 0n] }).catch(() => ZERO);
  }

  const hash = await walletClient.writeContract({ address: IDENTITY_REGISTRY, abi: IDENTITY_REGISTRY_ABI, functionName: 'createIdentity', args: [owner, smartAccount, metadata] });
  await publicClient.waitForTransactionReceipt({ hash });
  const newIdentity = await publicClient.readContract({ address: IDENTITY_REGISTRY, abi: IDENTITY_REGISTRY_ABI, functionName: 'getIdentityByOwner', args: [owner] });
  return { identityId: newIdentity.id, smartAccount: newIdentity.smartAccount, jnsName, isNew: true };
}

// ============================================================================
// Helpers
// ============================================================================

const b64url = (arr: Uint8Array) => btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const genVerifier = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const genChallenge = async (v: string) => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))));

async function createSession(sessionId: Hex, provider: string, providerId: string, providerHandle: string, providerAvatar?: string, ownerAddress?: Address): Promise<Session> {
  const attestation = await genAttestation(keccak256(toBytes(`session:${sessionId}`)));
  const owner = ownerAddress || (provider === 'wallet' ? providerId as Address : ZERO);
  const { identityId, smartAccount, jnsName, isNew } = await getOrCreateIdentity(owner, provider, providerId, providerHandle);

  return {
    sessionId, identityId, smartAccount,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    capabilities: ['sign_message', 'sign_transaction'],
    signingKey: toHex(crypto.getRandomValues(new Uint8Array(32))),
    attestation, provider, providerId, providerHandle, providerAvatar,
    onChainIdentity: IDENTITY_REGISTRY !== ZERO && isNew,
    jnsName: jnsName || undefined,
  };
}

// ============================================================================
// Routes
// ============================================================================

app.use('*', cors());

app.get('/health', async (c) => {
  const teeMode = await isInRealTEE();
  const [storageProviders, computeProviders] = await Promise.all([getStorageProviders(), getComputeProviders()]);
  
  return c.json({
    status: 'healthy',
    nodeId: NODE_ID,
    nodeAddress: nodeAccount.address,
    chainId: CHAIN_ID,
    mode: teeMode ? 'dstack-tee' : 'simulated',
    contracts: {
      identityRegistry: IDENTITY_REGISTRY !== ZERO,
      banManager: BAN_MANAGER !== ZERO,
      teeVerifier: TEE_VERIFIER !== ZERO,
      accountFactory: ACCOUNT_FACTORY !== ZERO,
      jnsRegistry: JNS_REGISTRY !== ZERO,
      storageRegistry: STORAGE_REGISTRY !== ZERO,
      computeRegistry: COMPUTE_REGISTRY !== ZERO,
    },
    network: {
      storageProviders: storageProviders.length,
      computeProviders: computeProviders.length,
    },
    enabledProviders: ['wallet', ...Object.keys(PROVIDERS).filter(p => getCredentials(p))],
  });
});

app.get('/providers', (c) => c.json({
  providers: [
    { id: 'wallet', enabled: true, scopes: [] },
    { id: 'farcaster', enabled: !!process.env.NEYNAR_API_KEY, scopes: [] },
    ...Object.entries(PROVIDERS).map(([id, cfg]) => ({ id, enabled: !!getCredentials(id), scopes: cfg.scopes })),
  ],
}));

app.get('/attestation', async (c) => c.json(await genAttestation()));

app.get('/network', async (c) => {
  const [storageProviders, computeProviders, activeNodes] = await Promise.all([
    getStorageProviders(),
    getComputeProviders(),
    TEE_VERIFIER !== ZERO ? publicClient.readContract({ address: TEE_VERIFIER, abi: TEE_VERIFIER_ABI, functionName: 'getActiveNodes', args: [] }).catch(() => []) : [],
  ]);

  return c.json({
    storage: storageProviders.map(p => ({ address: p.address, name: p.name, endpoint: p.endpoint })),
    compute: computeProviders.map(p => ({ address: p.address, name: p.name, endpoint: p.endpoint })),
    teeNodes: activeNodes.length,
  });
});

// JNS resolution
app.get('/jns/:name', async (c) => {
  const name = c.req.param('name');
  const fullName = name.endsWith('.jeju') ? name : `${name}.jeju`;
  const address = await resolveJNS(fullName);
  if (!address) return c.json({ error: 'Name not found' }, 404);
  return c.json({ name: fullName, address });
});

app.get('/jns/reverse/:address', async (c) => {
  const address = c.req.param('address') as Address;
  const name = await reverseResolveJNS(address);
  return c.json({ address, name });
});

// OAuth init
app.post('/auth/init', async (c) => {
  const { provider, appId, redirectUri } = await c.req.json<{ provider: string; appId: Hex; redirectUri: string }>();
  const cfg = PROVIDERS[provider];
  const creds = getCredentials(provider);
  if (!cfg) return c.json({ error: `Unsupported: ${provider}` }, 400);
  if (!creds) return c.json({ error: `Not configured: ${provider}` }, 400);

  const sessionId = keccak256(toBytes(`${appId}:${provider}:${Date.now()}:${Math.random()}`));
  const state = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const codeVerifier = genVerifier();
  pendingAuths.set(state, { sessionId, provider, appId, redirectUri, state, codeVerifier, expiresAt: Date.now() + 600000 });

  const params = new URLSearchParams({ client_id: creds.clientId, redirect_uri: redirectUri, response_type: 'code', state });
  if (cfg.scopes.length) params.set('scope', cfg.scopes.join(' '));
  if (cfg.pkce) { params.set('code_challenge', await genChallenge(codeVerifier)); params.set('code_challenge_method', 'S256'); }
  if (provider === 'google') { params.set('access_type', 'offline'); params.set('prompt', 'consent'); }
  if (provider === 'tiktok') { params.delete('client_id'); params.set('client_key', creds.clientId); }
  if (provider === 'notion') params.set('owner', 'user');

  return c.json({ authUrl: `${cfg.authUrl}?${params}`, state, sessionId });
});

// OAuth callback
app.post('/auth/callback', async (c) => {
  const { state, code } = await c.req.json<{ state: string; code: string }>();
  const pending = pendingAuths.get(state);
  if (!pending || Date.now() > pending.expiresAt) return c.json({ error: 'Invalid state' }, 400);
  pendingAuths.delete(state);

  const cfg = PROVIDERS[pending.provider];
  const creds = getCredentials(pending.provider);
  if (!cfg || !creds) return c.json({ error: 'Config error' }, 400);

  // Token exchange
  const params = new URLSearchParams({ code, redirect_uri: pending.redirectUri, grant_type: 'authorization_code' });
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };

  if (['discord', 'instagram', 'facebook', 'linkedin', 'slack'].includes(pending.provider)) {
    params.set('client_id', creds.clientId); params.set('client_secret', creds.clientSecret);
  } else if (pending.provider === 'twitter') {
    params.set('client_id', creds.clientId); params.set('code_verifier', pending.codeVerifier);
    headers['Authorization'] = `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`;
  } else if (pending.provider === 'google') {
    params.set('client_id', creds.clientId); params.set('client_secret', creds.clientSecret); params.set('code_verifier', pending.codeVerifier);
  } else if (pending.provider === 'github') {
    params.set('client_id', creds.clientId); params.set('client_secret', creds.clientSecret); headers['Accept'] = 'application/json';
  } else if (pending.provider === 'tiktok') {
    params.delete('grant_type'); params.set('client_key', creds.clientId); params.set('client_secret', creds.clientSecret); params.set('code_verifier', pending.codeVerifier);
  } else if (pending.provider === 'notion') {
    headers['Authorization'] = `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`; headers['Content-Type'] = 'application/json';
  }

  const tokenRes = await fetch(cfg.tokenUrl, { method: 'POST', headers, body: pending.provider === 'notion' ? JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: pending.redirectUri }) : params });
  if (!tokenRes.ok) return c.json({ error: 'Token exchange failed' }, 400);
  const tokens = await tokenRes.json() as { access_token: string };

  // User info
  const userHeaders: Record<string, string> = { 'Authorization': `Bearer ${tokens.access_token}` };
  if (pending.provider === 'github') userHeaders['Accept'] = 'application/vnd.github+json';
  if (pending.provider === 'notion') userHeaders['Notion-Version'] = '2022-06-28';
  if (pending.provider === 'linkedin') userHeaders['X-Restli-Protocol-Version'] = '2.0.0';

  const userRes = await fetch(cfg.userInfoUrl, { headers: userHeaders });
  if (!userRes.ok) return c.json({ error: 'User info failed' }, 400);
  const data = await userRes.json();

  let id: string, handle: string, avatar = '';
  switch (pending.provider) {
    case 'discord': id = data.id; handle = data.username; avatar = data.avatar ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png` : ''; break;
    case 'twitter': id = data.data.id; handle = data.data.username; avatar = data.data.profile_image_url || ''; break;
    case 'google': id = data.sub; handle = data.email; avatar = data.picture || ''; break;
    case 'github': id = String(data.id); handle = data.login; avatar = data.avatar_url || ''; break;
    case 'facebook': id = data.id; handle = data.name; avatar = data.picture?.data?.url || ''; break;
    case 'linkedin': id = data.id; handle = `${data.localizedFirstName} ${data.localizedLastName}`; break;
    case 'slack': id = data.user?.id; handle = data.user?.name; avatar = data.user?.image_72 || ''; break;
    case 'tiktok': id = data.data?.user?.open_id; handle = data.data?.user?.display_name; avatar = data.data?.user?.avatar_url || ''; break;
    case 'notion': id = data.id; handle = data.name || data.id; avatar = data.avatar_url || ''; break;
    case 'instagram': id = data.id; handle = data.username; break;
    default: return c.json({ error: 'Unknown provider' }, 400);
  }

  const session = await createSession(pending.sessionId, pending.provider, id, handle, avatar);
  sessions.set(pending.sessionId, session);
  return c.json(session);
});

// Wallet auth
app.post('/auth/wallet', async (c) => {
  const { address, signature, message } = await c.req.json<{ address: Address; signature: Hex; message: string; appId: Hex }>();

  const banStatus = await checkBanStatus(address);
  if (banStatus.banned) return c.json({ error: `Account banned: ${banStatus.reason || 'Moderation decision'}` }, 403);
  if (banStatus.onNotice) return c.json({ error: `Account on notice: ${banStatus.reason || 'Pending review'}` }, 403);

  const valid = await verifyMessage({ address, message, signature });
  if (!valid) return c.json({ error: 'Invalid signature' }, 401);

  const sessionId = keccak256(toBytes(`wallet:${address}:${Date.now()}`));
  const session = await createSession(sessionId, 'wallet', address.toLowerCase(), address, undefined, address);
  sessions.set(sessionId, session);
  return c.json(session);
});

// Session management
app.get('/session/:sessionId', (c) => {
  const session = sessions.get(c.req.param('sessionId'));
  if (!session) return c.json({ error: 'Not found' }, 404);
  if (session.expiresAt < Date.now()) { sessions.delete(session.sessionId); return c.json({ error: 'Expired' }, 401); }
  return c.json(session);
});

app.delete('/session/:sessionId', (c) => { sessions.delete(c.req.param('sessionId') as Hex); return c.json({ success: true }); });

// Signing
app.post('/sign', async (c) => {
  const { sessionId, message } = await c.req.json<{ sessionId: Hex; message: Hex }>();
  const session = sessions.get(sessionId);
  if (!session || session.expiresAt < Date.now()) return c.json({ error: 'Invalid session' }, 401);
  const sig = await privateKeyToAccount(session.signingKey).signMessage({ message: { raw: toBytes(message) } });
  return c.json({ signature: sig, attestation: await genAttestation(keccak256(toBytes(`sign:${message}`))) });
});

// Credential issuance with IPFS storage
app.post('/credential/issue', async (c) => {
  const { sessionId, provider, providerId, providerHandle, walletAddress } = await c.req.json<{
    sessionId: Hex; provider: string; providerId: string; providerHandle: string; walletAddress: Address;
  }>();
  if (!sessions.get(sessionId)) return c.json({ error: 'Invalid session' }, 401);

  const now = new Date();
  const credential = {
    '@context': ['https://www.w3.org/2018/credentials/v1', 'https://jeju.network/credentials/oauth3/v1'],
    type: ['VerifiableCredential', 'OAuth3IdentityCredential'],
    id: `urn:uuid:${crypto.randomUUID()}`,
    issuer: { id: `did:ethr:${CHAIN_ID}:${nodeAccount.address}`, name: 'Jeju OAuth3 TEE Network' },
    issuanceDate: now.toISOString(),
    expirationDate: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    credentialSubject: { id: `did:ethr:${CHAIN_ID}:${walletAddress}`, provider, providerId, providerHandle, walletAddress, verifiedAt: now.toISOString() },
    proof: { type: 'EcdsaSecp256k1Signature2019', created: now.toISOString(), verificationMethod: `did:ethr:${CHAIN_ID}:${nodeAccount.address}#controller`, proofPurpose: 'assertionMethod', proofValue: '0x' as Hex },
  };

  const hash = keccak256(toBytes(JSON.stringify({ ...credential, proof: { ...credential.proof, proofValue: undefined } })));
  credential.proof.proofValue = await nodeAccount.signMessage({ message: { raw: toBytes(hash) } });

  // Store to IPFS if storage providers available
  const ipfsCid = await storeCredentialToIPFS(credential);
  
  return c.json({ ...credential, ipfsCid });
});

// Identity lookup
app.get('/identity/:address', async (c) => {
  const address = c.req.param('address') as Address;
  
  // Check ban status
  const banStatus = await checkBanStatus(address);
  
  // Resolve JNS
  const jnsName = await reverseResolveJNS(address);

  if (IDENTITY_REGISTRY === ZERO) return c.json({ exists: false, jnsName, banStatus });

  const identity = await publicClient.readContract({ address: IDENTITY_REGISTRY, abi: IDENTITY_REGISTRY_ABI, functionName: 'getIdentityByOwner', args: [address] }).catch(() => null);
  if (!identity || identity.id === keccak256(toBytes(''))) return c.json({ exists: false, jnsName, banStatus });

  const [providers, metadata] = await Promise.all([
    publicClient.readContract({ address: IDENTITY_REGISTRY, abi: IDENTITY_REGISTRY_ABI, functionName: 'getLinkedProviders', args: [identity.id] }).catch(() => []),
    publicClient.readContract({ address: IDENTITY_REGISTRY, abi: IDENTITY_REGISTRY_ABI, functionName: 'getMetadata', args: [identity.id] }).catch(() => null),
  ]);

  return c.json({ exists: true, identity, providers, metadata, jnsName: metadata?.jnsName || jnsName, banStatus });
});

// Ban status
app.get('/ban/:address', async (c) => c.json(await checkBanStatus(c.req.param('address') as Address)));

// ============================================================================
// Start Server
// ============================================================================

const enabled = Object.keys(PROVIDERS).filter(p => getCredentials(p));
const contracts = [
  IDENTITY_REGISTRY !== ZERO ? 'Identity' : null,
  BAN_MANAGER !== ZERO ? 'Moderation' : null,
  JNS_REGISTRY !== ZERO ? 'JNS' : null,
  STORAGE_REGISTRY !== ZERO ? 'Storage' : null,
  COMPUTE_REGISTRY !== ZERO ? 'Compute' : null,
].filter(Boolean);

console.log(`OAuth3 Auth Server | Port ${PORT} | Node: ${nodeAccount.address.slice(0, 10)}...`);
console.log(`Providers: wallet${enabled.length ? ', ' + enabled.join(', ') : ''}`);
console.log(`Contracts: ${contracts.length ? contracts.join(', ') : 'None (off-chain mode)'}`);

Promise.all([isInRealTEE(), getStorageProviders(), getComputeProviders()]).then(([inTEE, storage, compute]) => {
  console.log(`TEE: ${inTEE ? 'dstack' : 'simulated'} | Storage: ${storage.length} providers | Compute: ${compute.length} providers`);
});

Bun.serve({ port: PORT, fetch: app.fetch });
