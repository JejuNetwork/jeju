/**
 * Compute Gateway
 *
 * A decentralized proxy service that:
 * - Routes API requests to compute providers
 * - Proxies SSH connections for non-P2P access
 * - Handles provider discovery via ERC-8004
 * - Manages session authentication
 * - Registers to ERC-8004 as a gateway agent
 * - Reports feedback to ReputationRegistry
 *
 * ERC-8004 Integration:
 * - Gateway registers as an ERC-8004 agent with "gateway" tag
 * - Can report feedback on provider behavior
 * - Uses reputation to rank providers
 *
 * Architecture:
 * ```
 *   User → Gateway → Provider Node
 *            ↓
 *      ERC-8004 Registry (discovery + reputation)
 *      ComputeRental (session auth)
 *      ReputationRegistry (feedback)
 * ```
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Contract, JsonRpcProvider, Wallet, verifyMessage } from 'ethers';
import net from 'node:net';
import type { Context } from 'hono';
import type { Address } from 'viem';
import {
  ContentModerator,
  createContentModerator,
  MemoryIncidentStorage,
  SeverityEnum,
  type ModerationIncident,
} from '../compute/sdk/content-moderation';
import {
  createCloudBridge,
  type CloudProviderBridge,
} from '../compute/sdk/cloud-integration';
import { ModelTypeEnum, type ModelType } from '../compute/sdk/types';

// ============================================================================
// Types
// ============================================================================

interface GatewayConfig {
  port: number;
  sshProxyPort: number;
  rpcUrl: string;
  registryAddress: string;
  rentalAddress: string;
  identityRegistryAddress?: string; // ERC-8004 IdentityRegistry
  reputationRegistryAddress?: string; // ERC-8004 ReputationRegistry
  privateKey?: string;
  gatewayName?: string;
  gatewayEndpoint?: string;
  // Moderation
  moderationEnabled?: boolean;
  aiModerationEndpoint?: string;
  aiModerationModel?: string;
  // Cloud integration
  cloudEndpoint?: string;
  cloudApiKey?: string;
}

interface Provider {
  address: string;
  name: string;
  endpoint: string;
  attestationHash: string;
  stake: bigint;
  agentId: number;
  active: boolean;
}

interface Route {
  routeId: string;
  rentalId: string;
  type: 'ssh' | 'http' | 'tcp';
  targetHost: string;
  targetPort: number;
  user: string;
  provider: string;
  createdAt: number;
  expiresAt: number;
}

interface ProxySession {
  sessionId: string;
  route: Route;
  socket: net.Socket;
  bytesIn: number;
  bytesOut: number;
  connectedAt: number;
}

// ============================================================================
// Contract ABIs
// ============================================================================

const REGISTRY_ABI = [
  'function getProvider(address provider) view returns (tuple(address owner, string name, string endpoint, bytes32 attestationHash, uint256 stake, uint256 registeredAt, uint256 agentId, bool active))',
  'function isActive(address provider) view returns (bool)',
  'function getActiveProviders() view returns (address[])',
];

const RENTAL_ABI = [
  'function getRental(bytes32 rentalId) view returns (tuple(bytes32 rentalId, address user, address provider, uint8 status, uint256 startTime, uint256 endTime, uint256 totalCost, uint256 paidAmount, uint256 refundedAmount, string sshPublicKey, string containerImage, string startupScript, string sshHost, uint16 sshPort))',
  'function isRentalActive(bytes32 rentalId) view returns (bool)',
  'function getUserRentals(address user) view returns (bytes32[])',
  'function getProviderRentals(address provider) view returns (bytes32[])',
  // Write functions
  'function createRental(address provider, uint256 duration, string sshPublicKey, string containerImage, string startupScript) payable returns (bytes32)',
  'function extendRental(bytes32 rentalId, uint256 additionalHours) payable',
  'function cancelRental(bytes32 rentalId)',
  'function rateRental(bytes32 rentalId, uint8 rating, string review)',
  // Reputation
  'function getProviderRecord(address provider) view returns (tuple(uint256 totalRentals, uint256 completedRentals, uint256 failedRentals, uint256 totalEarnings, uint256 avgRating, uint256 ratingCount, bool banned))',
  'function getUserRecord(address user) view returns (tuple(uint256 totalRentals, uint256 completedRentals, uint256 cancelledRentals, uint256 disputedRentals, uint256 abuseReports, bool banned, uint256 bannedAt, string banReason))',
  'function isUserBanned(address user) view returns (bool)',
  'function isProviderBanned(address provider) view returns (bool)',
  // Pricing
  'function calculateRentalCost(address provider, uint256 duration) view returns (uint256)',
];

// ERC-8004 IdentityRegistry ABI (for gateway registration) - reserved for future use
const _IDENTITY_REGISTRY_ABI = [
  'function register(string tokenURI) returns (uint256)',
  'function registerWithStake(string tokenURI, tuple(string key, bytes value)[] metadata, uint8 tier, address stakeToken) payable returns (uint256)',
  'function setMetadata(uint256 agentId, string key, bytes value)',
  'function updateTags(uint256 agentId, string[] tags)',
  'function getAgent(uint256 agentId) view returns (tuple(uint256 agentId, address owner, uint8 tier, address stakedToken, uint256 stakedAmount, uint256 registeredAt, uint256 lastActivityAt, bool isBanned, bool isSlashed))',
  'function agentExists(uint256 agentId) view returns (bool)',
  'function getAgentsByTag(string tag) view returns (uint256[])',
];

// ERC-8004 ReputationRegistry ABI (for feedback reporting) - reserved for future use
const _REPUTATION_REGISTRY_ABI = [
  'function giveFeedback(uint256 agentId, uint8 score, bytes32 tag1, bytes32 tag2, string fileuri, bytes32 filehash, bytes feedbackAuth)',
  'function getSummary(uint256 agentId, address[] clientAddresses, bytes32 tag1, bytes32 tag2) view returns (uint64 count, uint8 avgScore)',
  'function readFeedback(uint256 agentId, address clientAddress, uint64 index) view returns (uint8 score, bytes32 tag1, bytes32 tag2, bool isRevoked)',
];

// Suppress unused variable warnings for reserved ABIs
void _IDENTITY_REGISTRY_ABI;
void _REPUTATION_REGISTRY_ABI;

// ============================================================================
// Gateway
// ============================================================================

export class ComputeGateway {
  private app: Hono;
  private config: GatewayConfig;
  private rpcProvider: JsonRpcProvider;
  private wallet: Wallet | null = null;
  private registry: Contract;
  private rental: Contract;
  private identityRegistry: Contract | null = null;
  private reputationRegistry: Contract | null = null;

  // Gateway's ERC-8004 agent ID (set after registration)
  private gatewayAgentId: bigint | null = null;

  // Active proxy sessions
  private routes: Map<string, Route> = new Map();
  private sessions: Map<string, ProxySession> = new Map();
  private sshServer: net.Server | null = null;

  // Provider cache (refresh every 60s)
  private providerCache: Map<string, Provider> = new Map();
  private lastCacheRefresh = 0;
  private cacheRefreshInterval = 60_000;
  
  // Content moderation
  private moderator: ContentModerator;
  private moderationStorage: MemoryIncidentStorage;
  private moderationEnabled: boolean;
  
  // Cloud integration
  private cloudBridge: CloudProviderBridge | null = null;

  constructor(config: GatewayConfig) {
    this.config = config;
    this.app = new Hono();
    this.rpcProvider = new JsonRpcProvider(config.rpcUrl);

    // Initialize wallet for signing if private key provided
    if (config.privateKey) {
      this.wallet = new Wallet(config.privateKey, this.rpcProvider);
    }

    const signerOrProvider = this.wallet || this.rpcProvider;

    this.registry = new Contract(
      config.registryAddress,
      REGISTRY_ABI,
      signerOrProvider
    );

    this.rental = new Contract(
      config.rentalAddress,
      RENTAL_ABI,
      signerOrProvider
    );

    // Initialize ERC-8004 contracts if addresses provided
    if (config.identityRegistryAddress) {
      this.identityRegistry = new Contract(
        config.identityRegistryAddress,
        _IDENTITY_REGISTRY_ABI,
        signerOrProvider
      );
    }

    if (config.reputationRegistryAddress) {
      this.reputationRegistry = new Contract(
        config.reputationRegistryAddress,
        _REPUTATION_REGISTRY_ABI,
        signerOrProvider
      );
    }

    // Initialize content moderation
    this.moderationEnabled = config.moderationEnabled ?? true;
    this.moderationStorage = new MemoryIncidentStorage();
    this.moderator = createContentModerator({
      enableLocalFilter: true,
      enableAIClassifier: !!config.aiModerationEndpoint,
      aiClassifierEndpoint: config.aiModerationEndpoint,
      aiClassifierModel: config.aiModerationModel || 'moderation',
      recordIncidents: true,
      minConfidenceToFlag: 70,
      minConfidenceToBlock: 85,
      onIncident: async (incident: ModerationIncident) => {
        await this.moderationStorage.save(incident);
        if (incident.highestSeverity >= SeverityEnum.HIGH) {
          console.warn(`[Gateway Moderation] High severity incident: ${incident.id}`);
        }
      },
    });

    // Initialize cloud bridge if endpoint configured
    if (config.cloudEndpoint) {
      this.cloudBridge = createCloudBridge({
        cloudEndpoint: config.cloudEndpoint,
        cloudApiKey: config.cloudApiKey,
        rpcUrl: config.rpcUrl,
      });
    }

    this.setupRoutes();
  }

  /**
   * Register gateway as an ERC-8004 agent
   * This enables the gateway to be discovered by other agents
   * and to submit reputation feedback
   */
  async registerAsAgent(): Promise<bigint> {
    if (!this.identityRegistry || !this.wallet) {
      throw new Error('IdentityRegistry not configured or wallet missing');
    }

    const name = this.config.gatewayName || 'Jeju Compute Gateway';
    const endpoint = this.config.gatewayEndpoint || `http://localhost:${this.config.port}`;

    // Create tokenURI with gateway metadata
    const tokenUri = JSON.stringify({
      name,
      description: 'Jeju Compute Gateway - Proxy and discovery service for compute providers',
      type: 'compute-gateway',
      endpoint,
      version: '1.0.0',
    });

    // Register as free agent
    const tx = await this.identityRegistry.register(tokenUri);
    const receipt = await tx.wait();

    // Get agent ID from event
    const event = receipt?.logs.find((log: { topics: string[]; data: string }) => {
      const parsed = this.identityRegistry!.interface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      return parsed?.name === 'Registered';
    });

    if (!event) {
      throw new Error('Failed to get agent ID from registration');
    }

    const parsed = this.identityRegistry.interface.parseLog({
      topics: event.topics,
      data: event.data,
    });
    this.gatewayAgentId = BigInt(parsed?.args[0]);

    // Set tags for discovery
    await this.identityRegistry.updateTags(this.gatewayAgentId, [
      'compute',
      'gateway',
      'proxy',
      'jeju',
    ]);

    console.log(`✅ Gateway registered as ERC-8004 agent #${this.gatewayAgentId}`);
    return this.gatewayAgentId;
  }

  /**
   * Get the gateway's ERC-8004 agent ID
   */
  getAgentId(): bigint | null {
    return this.gatewayAgentId;
  }

  /**
   * Check if a user or provider is banned based on reputation
   */
  async checkReputation(address: string, type: 'user' | 'provider'): Promise<{
    banned: boolean;
    rating?: number;
    totalRentals?: number;
    completedRentals?: number;
    failedRentals?: number;
    abuseReports?: number;
  }> {
    if (type === 'user') {
      const record = await this.rental.getUserRecord(address);
      return {
        banned: record.banned,
        totalRentals: Number(record.totalRentals),
        completedRentals: Number(record.completedRentals),
        abuseReports: Number(record.abuseReports),
      };
    }

    const record = await this.rental.getProviderRecord(address);
    return {
      banned: record.banned,
      rating: Number(record.avgRating) / 100, // Scale from 0-10000 to 0-100
      totalRentals: Number(record.totalRentals),
      completedRentals: Number(record.completedRentals),
      failedRentals: Number(record.failedRentals),
    };
  }

  /**
   * Setup HTTP routes
   */
  private setupRoutes(): void {
    this.app.use('/*', cors());

    // Health check
    this.app.get('/health', (c) => c.json({
      status: 'ok',
      type: 'compute-gateway',
      activeRoutes: this.routes.size,
      activeSessions: this.sessions.size,
    }));

    // ========== A2A Agent Card ==========
    this.app.get('/.well-known/agent-card.json', (c) => c.json({
      protocolVersion: '0.3.0',
      name: 'Jeju Compute Gateway',
      description: 'Decentralized compute marketplace gateway - rent GPUs, CPUs, TEE. SSH access, Docker containers, AI inference.',
      url: '/a2a',
      preferredTransport: 'http',
      provider: { organization: 'Jeju Network', url: 'https://jeju.network' },
      version: '1.0.0',
      capabilities: { streaming: true, pushNotifications: false, stateTransitionHistory: true },
      defaultInputModes: ['text', 'data'],
      defaultOutputModes: ['text', 'data'],
      skills: [
        { id: 'list-providers', name: 'List Compute Providers', description: 'Get all active compute providers', tags: ['query', 'providers'] },
        { id: 'get-provider', name: 'Get Provider Details', description: 'Get info about a provider', tags: ['query', 'provider'] },
        { id: 'get-quote', name: 'Get Rental Quote', description: 'Get cost estimate for rental', tags: ['query', 'pricing'] },
        { id: 'create-rental', name: 'Create Compute Rental', description: 'Rent compute resources (requires payment)', tags: ['action', 'rental', 'payment'] },
        { id: 'get-rental', name: 'Get Rental Status', description: 'Check rental status', tags: ['query', 'rental'] },
        { id: 'get-ssh-access', name: 'Get SSH Access', description: 'Get SSH connection details', tags: ['query', 'ssh'] },
        { id: 'list-my-rentals', name: 'List My Rentals', description: 'Get user rentals', tags: ['query', 'rentals'] },
        { id: 'rate-rental', name: 'Rate Rental', description: 'Rate a completed rental', tags: ['action', 'rating'] },
        { id: 'get-reputation', name: 'Get Reputation', description: 'Get provider/user reputation', tags: ['query', 'reputation'] },
        { id: 'list-models', name: 'List AI Models', description: 'Get available AI models', tags: ['query', 'ai'] },
        { id: 'inference', name: 'AI Inference', description: 'Execute AI inference (requires payment)', tags: ['action', 'ai', 'payment'] },
      ],
    }));

    // ========== Provider Discovery ==========

    // List all active providers
    this.app.get('/v1/providers', async (c: Context) => {
      await this.refreshProviderCache();

      const providers = Array.from(this.providerCache.values()).map((p) => ({
        address: p.address,
        name: p.name,
        endpoint: p.endpoint,
        stake: p.stake.toString(),
        agentId: p.agentId,
        active: p.active,
      }));

      return c.json({ providers });
    });

    // Get specific provider with reputation
    this.app.get('/v1/providers/:address', async (c: Context) => {
      const address = c.req.param('address');
      const provider = await this.getProvider(address);

      if (!provider) {
        return c.json({ error: 'Provider not found' }, 404);
      }

      // Get reputation data
      const reputation = await this.checkReputation(address, 'provider');

      return c.json({
        address: provider.address,
        name: provider.name,
        endpoint: provider.endpoint,
        stake: provider.stake.toString(),
        agentId: provider.agentId,
        active: provider.active,
        reputation: {
          banned: reputation.banned,
          rating: reputation.rating,
          totalRentals: reputation.totalRentals,
          completedRentals: reputation.completedRentals,
          failedRentals: reputation.failedRentals,
        },
      });
    });

    // Check user reputation
    this.app.get('/v1/reputation/user/:address', async (c: Context) => {
      const address = c.req.param('address');
      const reputation = await this.checkReputation(address, 'user');
      return c.json(reputation);
    });

    // Check provider reputation
    this.app.get('/v1/reputation/provider/:address', async (c: Context) => {
      const address = c.req.param('address');
      const reputation = await this.checkReputation(address, 'provider');
      return c.json(reputation);
    });

    // Get gateway info (including ERC-8004 agent ID)
    this.app.get('/v1/gateway/info', (c: Context) => {
      return c.json({
        name: this.config.gatewayName || 'Jeju Compute Gateway',
        agentId: this.gatewayAgentId?.toString() ?? null,
        port: this.config.port,
        sshProxyPort: this.config.sshProxyPort,
        hasIdentityRegistry: !!this.identityRegistry,
        hasReputationRegistry: !!this.reputationRegistry,
      });
    });

    // ========== Rental Management ==========

    // List user's rentals
    this.app.get('/v1/rentals', async (c: Context) => {
      const userAddress = c.req.query('user');
      if (!userAddress) {
        return c.json({ error: 'User address required' }, 400);
      }

      const rentalIds = await this.rental.getUserRentals(userAddress);
      const rentals = [];

      for (const rentalId of rentalIds) {
        const rental = await this.rental.getRental(rentalId);
        if (rental) {
          const provider = await this.getProvider(rental.provider);
          rentals.push({
            rentalId: rental.rentalId,
            user: rental.user,
            provider: rental.provider,
            providerName: provider?.name || 'Unknown',
            status: this.rentalStatusToString(rental.status),
            startTime: Number(rental.startTime) * 1000,
            endTime: Number(rental.endTime) * 1000,
            totalCost: rental.totalCost.toString(),
            paidAmount: rental.paidAmount.toString(),
            sshHost: rental.sshHost,
            sshPort: Number(rental.sshPort),
            containerImage: rental.containerImage,
          });
        }
      }

      return c.json({ rentals });
    });

    // Get rental quote
    this.app.get('/v1/rentals/quote', async (c: Context) => {
      const provider = c.req.query('provider');
      const duration = c.req.query('duration');
      
      if (!provider || !duration) {
        return c.json({ error: 'Provider and duration required' }, 400);
      }

      const cost = await this.rental.calculateRentalCost(provider, duration);
      const providerInfo = await this.getProvider(provider);

      return c.json({
        provider,
        providerName: providerInfo?.name || 'Unknown',
        durationHours: Number(duration),
        totalCostWei: cost.toString(),
        totalCostEth: (Number(cost) / 1e18).toFixed(6),
      });
    });

    // Create rental
    this.app.post('/v1/rentals', async (c: Context) => {
      const authResult = await this.verifyAuth(c);
      if (!authResult.valid) {
        return c.json({ error: authResult.reason }, 401);
      }

      const body = await c.req.json<{
        provider: string;
        duration: number;
        sshPublicKey: string;
        containerImage?: string;
        startupScript?: string;
      }>();

      // Verify provider is active
      const provider = await this.getProvider(body.provider);
      if (!provider || !provider.active) {
        return c.json({ error: 'Provider not found or inactive' }, 400);
      }

      // Check user is not banned
      const userRep = await this.checkReputation(authResult.address!, 'user');
      if (userRep.banned) {
        return c.json({ error: 'User is banned' }, 403);
      }

      // Calculate cost
      const cost = await this.rental.calculateRentalCost(body.provider, body.duration);

      // Return transaction data for frontend to execute
      return c.json({
        success: true,
        transaction: {
          to: this.config.rentalAddress,
          value: cost.toString(),
          data: this.rental.interface.encodeFunctionData('createRental', [
            body.provider,
            body.duration,
            body.sshPublicKey,
            body.containerImage || '',
            body.startupScript || '',
          ]),
        },
        estimatedCost: cost.toString(),
        provider: body.provider,
        duration: body.duration,
      });
    });

    // Get specific rental
    this.app.get('/v1/rentals/:rentalId', async (c: Context) => {
      const rentalId = c.req.param('rentalId');
      const rental = await this.rental.getRental(rentalId);

      if (!rental || rental.rentalId === '0x0000000000000000000000000000000000000000000000000000000000000000') {
        return c.json({ error: 'Rental not found' }, 404);
      }

      const provider = await this.getProvider(rental.provider);

      return c.json({
        rentalId: rental.rentalId,
        user: rental.user,
        provider: rental.provider,
        providerName: provider?.name || 'Unknown',
        status: this.rentalStatusToString(rental.status),
        startTime: Number(rental.startTime) * 1000,
        endTime: Number(rental.endTime) * 1000,
        totalCost: rental.totalCost.toString(),
        paidAmount: rental.paidAmount.toString(),
        refundedAmount: rental.refundedAmount.toString(),
        sshPublicKey: rental.sshPublicKey,
        containerImage: rental.containerImage,
        startupScript: rental.startupScript,
        sshHost: rental.sshHost,
        sshPort: Number(rental.sshPort),
      });
    });

    // Extend rental
    this.app.post('/v1/rentals/:rentalId/extend', async (c: Context) => {
      const authResult = await this.verifyAuth(c);
      if (!authResult.valid) {
        return c.json({ error: authResult.reason }, 401);
      }

      const rentalId = c.req.param('rentalId');
      const body = await c.req.json<{ additionalHours: number }>();

      const rental = await this.rental.getRental(rentalId);
      if (!rental || rental.user.toLowerCase() !== authResult.address!.toLowerCase()) {
        return c.json({ error: 'Rental not found or not owned by user' }, 404);
      }

      if (rental.status !== 1) { // ACTIVE
        return c.json({ error: 'Rental is not active' }, 400);
      }

      const extensionCost = await this.rental.calculateRentalCost(rental.provider, body.additionalHours);

      return c.json({
        success: true,
        transaction: {
          to: this.config.rentalAddress,
          value: extensionCost.toString(),
          data: this.rental.interface.encodeFunctionData('extendRental', [
            rentalId,
            body.additionalHours,
          ]),
        },
        estimatedCost: extensionCost.toString(),
        additionalHours: body.additionalHours,
      });
    });

    // Cancel rental
    this.app.post('/v1/rentals/:rentalId/cancel', async (c: Context) => {
      const authResult = await this.verifyAuth(c);
      if (!authResult.valid) {
        return c.json({ error: authResult.reason }, 401);
      }

      const rentalId = c.req.param('rentalId');
      const rental = await this.rental.getRental(rentalId);

      if (!rental || rental.user.toLowerCase() !== authResult.address!.toLowerCase()) {
        return c.json({ error: 'Rental not found or not owned by user' }, 404);
      }

      if (rental.status !== 1) { // ACTIVE
        return c.json({ error: 'Rental is not active' }, 400);
      }

      return c.json({
        success: true,
        transaction: {
          to: this.config.rentalAddress,
          value: '0',
          data: this.rental.interface.encodeFunctionData('cancelRental', [rentalId]),
        },
      });
    });

    // Rate rental
    this.app.post('/v1/rentals/:rentalId/rate', async (c: Context) => {
      const authResult = await this.verifyAuth(c);
      if (!authResult.valid) {
        return c.json({ error: authResult.reason }, 401);
      }

      const rentalId = c.req.param('rentalId');
      const body = await c.req.json<{ rating: number; review?: string }>();

      if (body.rating < 1 || body.rating > 5) {
        return c.json({ error: 'Rating must be between 1 and 5' }, 400);
      }

      const rental = await this.rental.getRental(rentalId);
      if (!rental || rental.user.toLowerCase() !== authResult.address!.toLowerCase()) {
        return c.json({ error: 'Rental not found or not owned by user' }, 404);
      }

      if (rental.status !== 2) { // COMPLETED
        return c.json({ error: 'Can only rate completed rentals' }, 400);
      }

      return c.json({
        success: true,
        transaction: {
          to: this.config.rentalAddress,
          value: '0',
          data: this.rental.interface.encodeFunctionData('rateRental', [
            rentalId,
            body.rating,
            body.review || '',
          ]),
        },
      });
    });

    // ========== Proxy Route Management ==========

    // Create proxy route for a rental
    this.app.post('/v1/routes', async (c: Context) => {
      const authResult = await this.verifyAuth(c);
      if (!authResult.valid) {
        return c.json({ error: authResult.reason }, 401);
      }

      const body = await c.req.json<{
        rentalId: string;
        type: 'ssh' | 'http' | 'tcp';
      }>();

      // Verify rental exists and is active
      const rentalData = await this.rental.getRental(body.rentalId);
      if (!rentalData || rentalData.status !== 1) {
        return c.json({ error: 'Rental not active' }, 400);
      }

      // Verify user owns the rental
      if (rentalData.user.toLowerCase() !== authResult.address!.toLowerCase()) {
        return c.json({ error: 'Not rental owner' }, 403);
      }

      // Create route
      const routeId = crypto.randomUUID();
      const route: Route = {
        routeId,
        rentalId: body.rentalId,
        type: body.type,
        targetHost: rentalData.sshHost,
        targetPort: Number(rentalData.sshPort),
        user: rentalData.user,
        provider: rentalData.provider,
        createdAt: Date.now(),
        expiresAt: Number(rentalData.endTime) * 1000,
      };

      this.routes.set(routeId, route);

      return c.json({
        routeId,
        type: body.type,
        proxyHost: 'gateway.jeju.network', // Replace with actual gateway hostname
        proxyPort: body.type === 'ssh' ? this.config.sshProxyPort : this.config.port,
        expiresAt: route.expiresAt,
      });
    });

    // List user's routes
    this.app.get('/v1/routes', async (c: Context) => {
      const authResult = await this.verifyAuth(c);
      if (!authResult.valid) {
        return c.json({ error: authResult.reason }, 401);
      }

      const userRoutes = Array.from(this.routes.values())
        .filter((r) => r.user.toLowerCase() === authResult.address!.toLowerCase())
        .map((r) => ({
          routeId: r.routeId,
          rentalId: r.rentalId,
          type: r.type,
          targetHost: r.targetHost,
          targetPort: r.targetPort,
          createdAt: r.createdAt,
          expiresAt: r.expiresAt,
        }));

      return c.json({ routes: userRoutes });
    });

    // Delete a route
    this.app.delete('/v1/routes/:routeId', async (c: Context) => {
      const authResult = await this.verifyAuth(c);
      if (!authResult.valid) {
        return c.json({ error: authResult.reason }, 401);
      }

      const routeId = c.req.param('routeId');
      const route = this.routes.get(routeId);

      if (!route) {
        return c.json({ error: 'Route not found' }, 404);
      }

      if (route.user.toLowerCase() !== authResult.address!.toLowerCase()) {
        return c.json({ error: 'Not route owner' }, 403);
      }

      // Close any active sessions
      for (const [sessionId, session] of this.sessions) {
        if (session.route.routeId === routeId) {
          session.socket.destroy();
          this.sessions.delete(sessionId);
        }
      }

      this.routes.delete(routeId);
      return c.json({ success: true });
    });

    // ========== Proxy Endpoints ==========

    // Proxy HTTP request to provider (with content moderation)
    this.app.all('/v1/proxy/:provider/*', async (c: Context) => {
      const providerAddress = c.req.param('provider');
      const provider = await this.getProvider(providerAddress);

      if (!provider || !provider.active) {
        return c.json({ error: 'Provider not found or inactive' }, 404);
      }

      // Get the path after /v1/proxy/:provider
      const fullPath = c.req.path;
      const proxyPath = fullPath.split('/').slice(4).join('/');
      const targetUrl = `${provider.endpoint}/${proxyPath}`;

      // Content moderation for inference requests
      const userAddress = c.req.header('x-jeju-address') as Address | undefined;
      if (this.moderationEnabled && proxyPath.includes('chat/completions')) {
        const bodyClone = await c.req.text();
        
        // Parse request to extract messages (skip moderation if invalid JSON)
        let parsedBody: { messages?: Array<{ content: string }>; model?: string } | null = null;
        try {
          parsedBody = JSON.parse(bodyClone) as { 
            messages?: Array<{ content: string }>;
            model?: string;
          };
        } catch {
          // Invalid JSON - let the provider handle the error
          parsedBody = null;
        }
        
        if (parsedBody?.messages) {
          const content = parsedBody.messages.map(m => m.content).join('\n');
          const moderationResult = await this.moderator.moderate(content, {
            userAddress: userAddress ?? '0x0000000000000000000000000000000000000000' as Address,
            providerAddress: providerAddress as Address,
            modelId: parsedBody.model || 'unknown',
            requestType: 'inference',
          });
          
          if (!moderationResult.allowed) {
            const categories = moderationResult.flags.map(f => 
              ContentModerator.getCategoryName(f.category)
            ).join(', ');
            
            return c.json({
              error: {
                message: `Content blocked by moderation policy: ${categories}`,
                code: 'content_policy_violation',
                incidentId: moderationResult.incidentId,
              }
            }, 400);
          }
        }

        // Forward request (body already read)
        const headers: Record<string, string> = {};
        for (const [key, value] of c.req.raw.headers) {
          if (!['host', 'connection'].includes(key.toLowerCase())) {
            headers[key] = value;
          }
        }

        const response = await fetch(targetUrl, {
          method: c.req.method,
          headers,
          body: bodyClone,
        });

        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        return new Response(response.body, {
          status: response.status,
          headers: responseHeaders,
        });
      }

      // Forward request without moderation for non-inference endpoints
      const headers: Record<string, string> = {};
      for (const [key, value] of c.req.raw.headers) {
        if (!['host', 'connection'].includes(key.toLowerCase())) {
          headers[key] = value;
        }
      }

      const response = await fetch(targetUrl, {
        method: c.req.method,
        headers,
        body: c.req.method !== 'GET' && c.req.method !== 'HEAD'
          ? await c.req.blob()
          : undefined,
      });

      // Return proxied response
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      return new Response(response.body, {
        status: response.status,
        headers: responseHeaders,
      });
    });

    // ========== Stats ==========

    this.app.get('/v1/stats', (c: Context) => {
      return c.json({
        totalProviders: this.providerCache.size,
        activeRoutes: this.routes.size,
        activeSessions: this.sessions.size,
        totalBytesIn: Array.from(this.sessions.values()).reduce((sum, s) => sum + s.bytesIn, 0),
        totalBytesOut: Array.from(this.sessions.values()).reduce((sum, s) => sum + s.bytesOut, 0),
      });
    });
    
    // ========== Moderation Endpoints ==========
    
    // Get moderation incidents
    this.app.get('/v1/moderation/incidents', async (c: Context) => {
      const limit = parseInt(c.req.query('limit') || '100', 10);
      const incidents = await this.moderationStorage.getUnreviewed(limit);
      return c.json({ incidents, count: incidents.length });
    });
    
    // Get moderation stats
    this.app.get('/v1/moderation/stats', (c: Context) => {
      return c.json({
        enabled: this.moderationEnabled,
        incidentCount: this.moderationStorage.size(),
      });
    });
    
    // ========== Model Discovery (Cloud Integration) ==========
    
    // List available models from cloud and decentralized providers
    this.app.get('/v1/models', async (c: Context) => {
      const modelType = c.req.query('type'); // llm, image, video, audio, embedding
      const source = c.req.query('source'); // cloud, decentralized, all
      
      const models: Array<{
        id: string;
        name: string;
        provider: string;
        type: string;
        source: 'cloud' | 'decentralized';
        capabilities?: string[];
        contextWindow?: number;
        pricing?: { inputPerMillion?: number; outputPerMillion?: number };
      }> = [];
      
      // Get cloud models
      if (this.cloudBridge && (source === 'cloud' || source === 'all' || !source)) {
        await this.cloudBridge.initialize();
        const parsedModelType = modelType ? (this.parseModelType(modelType) as unknown as ModelType) : undefined;
        const cloudModels = await this.cloudBridge.discoverModels(
          parsedModelType ? { modelType: parsedModelType } : undefined
        );
        
        for (const result of cloudModels) {
          models.push({
            id: result.model.modelId,
            name: result.model.name,
            provider: result.model.creator.name,
            type: this.modelTypeToString(result.model.modelType),
            source: 'cloud',
            capabilities: this.capabilitiesToStrings(result.model.capabilities),
            contextWindow: result.model.contextWindow,
            pricing: {
              inputPerMillion: Number(result.model.pricing.pricePerInputToken) / 1e12,
              outputPerMillion: Number(result.model.pricing.pricePerOutputToken) / 1e12,
            },
          });
        }
      }
      
      return c.json({
        models,
        count: models.length,
        cloudEnabled: !!this.cloudBridge,
      });
    });
    
    // Get cloud status
    this.app.get('/v1/cloud/status', async (c: Context) => {
      if (!this.cloudBridge) {
        return c.json({ enabled: false, endpoint: null, modelCount: 0 });
      }
      
      const status = await this.cloudBridge.getStatus();
      return c.json({
        enabled: true,
        ...status,
      });
    });
    
    // List cloud A2A skills
    this.app.get('/v1/cloud/skills', (c: Context) => {
      if (!this.cloudBridge) {
        return c.json({ skills: [], count: 0 });
      }
      
      const skills = this.cloudBridge.getAvailableSkills();
      return c.json({ skills, count: skills.length });
    });
    
    // Proxy inference to cloud
    this.app.post('/v1/cloud/inference', async (c: Context) => {
      if (!this.cloudBridge) {
        return c.json({ error: 'Cloud integration not enabled' }, 503);
      }
      
      const body = await c.req.json<{
        model: string;
        messages: Array<{ role: string; content: string }>;
        temperature?: number;
        max_tokens?: number;
      }>();
      
      const result = await this.cloudBridge.inference(
        body.model,
        body.messages,
        {
          temperature: body.temperature,
          maxTokens: body.max_tokens,
        }
      );
      
      return c.json(result);
    });
    
    this.app.post('/v1/cloud/skills/:skillId', (c: Context) => {
      return c.json({ error: 'Skills not supported' }, 501);
    });
  }
  
  // Helper to parse model type from query
  private parseModelType(type: string): ModelType {
    const types: Record<string, ModelType> = {
      llm: ModelTypeEnum.LLM,
      image: ModelTypeEnum.IMAGE_GEN,
      video: ModelTypeEnum.VIDEO_GEN,
      audio: ModelTypeEnum.AUDIO_GEN,
      speech_to_text: ModelTypeEnum.SPEECH_TO_TEXT,
      text_to_speech: ModelTypeEnum.TEXT_TO_SPEECH,
      embedding: ModelTypeEnum.EMBEDDING,
      multimodal: ModelTypeEnum.MULTIMODAL,
    };
    return types[type.toLowerCase()] ?? ModelTypeEnum.LLM;
  }
  
  // Helper to convert model type to string
  private modelTypeToString(type: number): string {
    const types = ['llm', 'image', 'video', 'audio', 'speech_to_text', 'text_to_speech', 'embedding', 'multimodal'];
    return types[type] ?? 'unknown';
  }
  
  // Helper to convert capability bitmask to strings
  private capabilitiesToStrings(caps: number): string[] {
    const result: string[] = [];
    if (caps & 1) result.push('text_generation');
    if (caps & 2) result.push('code_generation');
    if (caps & 4) result.push('vision');
    if (caps & 8) result.push('function_calling');
    if (caps & 16) result.push('streaming');
    if (caps & 32) result.push('embeddings');
    if (caps & 64) result.push('long_context');
    if (caps & 128) result.push('reasoning');
    if (caps & 256) result.push('image_generation');
    if (caps & 512) result.push('image_editing');
    if (caps & 1024) result.push('speech_to_text');
    if (caps & 2048) result.push('text_to_speech');
    if (caps & 4096) result.push('audio_generation');
    if (caps & 8192) result.push('video_generation');
    if (caps & 16384) result.push('video_analysis');
    if (caps & 32768) result.push('multimodal');
    return result;
  }

  /**
   * Start the SSH proxy server
   */
  private startSSHProxy(): void {
    this.sshServer = net.createServer((clientSocket) => {
      this.handleSSHConnection(clientSocket);
    });

    this.sshServer.listen(this.config.sshProxyPort, () => {
      console.log(`🔐 SSH Proxy listening on port ${this.config.sshProxyPort}`);
    });
  }

  /**
   * Handle incoming SSH connection
   */
  private async handleSSHConnection(clientSocket: net.Socket): Promise<void> {
    let targetSocket: net.Socket | null = null;
    let sessionId: string | null = null;

    clientSocket.once('data', async (data: Buffer) => {

      // Parse SSH-CONNECT header with route ID
      // Format: SSH-CONNECT routeId\r\n
      const header = data.toString('utf8', 0, Math.min(100, data.length));
      const match = header.match(/^SSH-CONNECT ([a-f0-9-]+)\r\n/);

      if (!match) {
        // Legacy mode: try to find route by source IP
        clientSocket.write('SSH-ERROR: Route ID required\r\n');
        clientSocket.destroy();
        return;
      }

      const routeId = match[1];
      const route = this.routes.get(routeId);

      if (!route) {
        clientSocket.write('SSH-ERROR: Route not found\r\n');
        clientSocket.destroy();
        return;
      }

      // Check expiration
      if (Date.now() > route.expiresAt) {
        this.routes.delete(routeId);
        clientSocket.write('SSH-ERROR: Route expired\r\n');
        clientSocket.destroy();
        return;
      }

      // Connect to target
      targetSocket = net.createConnection({
        host: route.targetHost,
        port: route.targetPort,
      });

      sessionId = crypto.randomUUID();
      const session: ProxySession = {
        sessionId,
        route,
        socket: clientSocket,
        bytesIn: 0,
        bytesOut: 0,
        connectedAt: Date.now(),
      };

      this.sessions.set(sessionId, session);

      // Acknowledge connection
      clientSocket.write('SSH-OK\r\n');

      // Setup bidirectional pipe
      targetSocket.on('connect', () => {
        // Forward remaining initial data if any
        const sshDataStart = header.indexOf('\r\n') + 2;
        if (sshDataStart < data.length) {
          targetSocket!.write(data.subarray(sshDataStart));
          session.bytesOut += data.length - sshDataStart;
        }

        // Pipe data
        clientSocket.on('data', (chunk: Buffer) => {
          session.bytesOut += chunk.length;
          targetSocket!.write(chunk);
        });

        targetSocket!.on('data', (chunk: Buffer) => {
          session.bytesIn += chunk.length;
          clientSocket.write(chunk);
        });
      });

      targetSocket.on('error', (err: Error) => {
        console.error(`SSH proxy target error: ${err.message}`);
        clientSocket.destroy();
        if (sessionId) this.sessions.delete(sessionId);
      });

      targetSocket.on('close', () => {
        clientSocket.destroy();
        if (sessionId) this.sessions.delete(sessionId);
      });

      clientSocket.on('error', (err: Error) => {
        console.error(`SSH proxy client error: ${err.message}`);
        targetSocket?.destroy();
        if (sessionId) this.sessions.delete(sessionId);
      });

      clientSocket.on('close', () => {
        targetSocket?.destroy();
        if (sessionId) this.sessions.delete(sessionId);
      });
    });
  }

  /**
   * Convert rental status number to string
   */
  private rentalStatusToString(status: number): string {
    const statuses = ['PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'DISPUTED'];
    return statuses[status] || 'UNKNOWN';
  }

  /**
   * Get provider info (from cache or chain)
   */
  private async getProvider(address: string): Promise<Provider | null> {
    // Check cache first
    if (this.providerCache.has(address)) {
      return this.providerCache.get(address)!;
    }

    // Fetch from chain
    const data = await this.registry.getProvider(address);
    if (!data || !data.active) {
      return null;
    }

    const provider: Provider = {
      address,
      name: data.name,
      endpoint: data.endpoint,
      attestationHash: data.attestationHash,
      stake: data.stake,
      agentId: Number(data.agentId),
      active: data.active,
    };

    this.providerCache.set(address, provider);
    return provider;
  }

  /**
   * Refresh provider cache
   */
  private async refreshProviderCache(): Promise<void> {
    if (Date.now() - this.lastCacheRefresh < this.cacheRefreshInterval) {
      return;
    }

    const activeProviders = await this.registry.getActiveProviders();

    for (const address of activeProviders) {
      const data = await this.registry.getProvider(address);
      if (data && data.active) {
        this.providerCache.set(address, {
          address,
          name: data.name,
          endpoint: data.endpoint,
          attestationHash: data.attestationHash,
          stake: data.stake,
          agentId: Number(data.agentId),
          active: data.active,
        });
      }
    }

    this.lastCacheRefresh = Date.now();
  }

  /**
   * Verify auth headers
   */
  private async verifyAuth(c: Context): Promise<{ valid: boolean; reason?: string; address?: string }> {
    const address = c.req.header('x-jeju-address');
    const nonce = c.req.header('x-jeju-nonce');
    const signature = c.req.header('x-jeju-signature');
    const timestamp = c.req.header('x-jeju-timestamp');

    if (!address || !nonce || !signature || !timestamp) {
      return { valid: false, reason: 'Missing auth headers' };
    }

    // Check timestamp freshness
    const ts = parseInt(timestamp, 10);
    const now = Date.now();
    if (Math.abs(now - ts) > 5 * 60 * 1000) {
      return { valid: false, reason: 'Timestamp expired' };
    }

    // Verify signature
    const message = `${address}:${nonce}:${timestamp}`;
    const recovered = verifyMessage(message, signature);

    if (recovered.toLowerCase() !== address.toLowerCase()) {
      return { valid: false, reason: 'Invalid signature' };
    }

    return { valid: true, address };
  }

  /**
   * Start the gateway
   */
  start(): void {
    console.log('🚀 Compute Gateway starting...');
    console.log(`   HTTP Port: ${this.config.port}`);
    console.log(`   SSH Proxy Port: ${this.config.sshProxyPort}`);
    console.log(`   Registry: ${this.config.registryAddress}`);
    console.log(`   Rental: ${this.config.rentalAddress}`);

    // Start HTTP server
    Bun.serve({
      port: this.config.port,
      fetch: this.app.fetch,
    });

    // Start SSH proxy
    this.startSSHProxy();

    // Initial provider cache refresh
    this.refreshProviderCache();

    console.log(`✅ Compute Gateway running`);
  }

  /**
   * Get the Hono app for testing
   */
  getApp(): Hono {
    return this.app;
  }
}

/**
 * Start gateway from environment
 */
export async function startComputeGateway(): Promise<ComputeGateway> {
  const config: GatewayConfig = {
    port: parseInt(process.env.GATEWAY_PORT || '4009', 10),
    sshProxyPort: parseInt(process.env.SSH_PROXY_PORT || '2222', 10),
    rpcUrl: process.env.RPC_URL || process.env.JEJU_RPC_URL || 'http://localhost:9545',
    registryAddress: process.env.COMPUTE_REGISTRY_ADDRESS || process.env.REGISTRY_ADDRESS || '',
    rentalAddress: process.env.RENTAL_ADDRESS || '',
    identityRegistryAddress: process.env.IDENTITY_REGISTRY_ADDRESS,
    reputationRegistryAddress: process.env.REPUTATION_REGISTRY_ADDRESS,
    privateKey: process.env.PRIVATE_KEY,
    gatewayName: process.env.GATEWAY_NAME || 'Jeju Compute Gateway',
    gatewayEndpoint: process.env.GATEWAY_ENDPOINT,
    // Moderation config
    moderationEnabled: process.env.MODERATION_ENABLED !== 'false',
    aiModerationEndpoint: process.env.AI_MODERATION_ENDPOINT,
    aiModerationModel: process.env.AI_MODERATION_MODEL,
    // Cloud integration config
    cloudEndpoint: process.env.CLOUD_ENDPOINT || process.env.NEXT_PUBLIC_APP_URL,
    cloudApiKey: process.env.CLOUD_API_KEY,
  };

  const gateway = new ComputeGateway(config);
  gateway.start();

  // Register as ERC-8004 agent if identity registry configured
  if (config.identityRegistryAddress && config.privateKey) {
    console.log('📝 Registering gateway as ERC-8004 agent...');
    await gateway.registerAsAgent();
  }

  return gateway;
}

// Run as standalone
if (import.meta.main) {
  await startComputeGateway();
}

