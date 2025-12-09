/**
 * A2A Server for Storage Marketplace
 * 
 * Complete agent-to-agent interface for decentralized storage:
 * - Provider discovery and selection
 * - Storage deals with x402 payments
 * - File upload, pin, and retrieval
 * - Credit management
 * - Reputation queries
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Contract, JsonRpcProvider, Wallet, formatEther, parseEther } from 'ethers';
import {
  calculateStorageCost,
  calculateRetrievalCost,
  createStoragePaymentRequirement,
  parseX402Header,
  verifyX402Payment,
  type X402PaymentRequirement,
  ZERO_ADDRESS,
  STORAGE_PRICING,
} from './sdk/x402';
import { database as db } from './database';

// ============================================================================
// Types
// ============================================================================

interface A2AConfig {
  rpcUrl: string;
  registryAddress: string;
  ledgerAddress: string;
  marketAddress: string;
  creditManagerAddress?: string;
  paymentRecipient?: string;
  privateKey?: string;
}

interface A2ARequest {
  jsonrpc: string;
  method: string;
  params?: {
    message?: {
      messageId: string;
      parts: Array<{ kind: string; text?: string; data?: Record<string, unknown> }>;
    };
  };
  id: number | string;
}

interface SkillResult {
  message: string;
  data: Record<string, unknown>;
  requiresPayment?: X402PaymentRequirement;
}

// ============================================================================
// Contract ABIs
// ============================================================================

const REGISTRY_ABI = [
  'function getActiveProviders() view returns (address[])',
  'function getProvider(address) view returns (tuple(address owner, string name, string endpoint, uint8 providerType, bytes32 attestationHash, uint256 stake, uint256 registeredAt, uint256 agentId, bool active, bool verified))',
  'function getProviderInfo(address) view returns (tuple(tuple(address owner, string name, string endpoint, uint8 providerType, bytes32 attestationHash, uint256 stake, uint256 registeredAt, uint256 agentId, bool active, bool verified) provider, tuple(uint256 totalCapacityGB, uint256 usedCapacityGB, uint256 availableCapacityGB, uint256 reservedCapacityGB) capacity, tuple(uint256 pricePerGBMonth, uint256 minStoragePeriodDays, uint256 maxStoragePeriodDays, uint256 retrievalPricePerGB, uint256 uploadPricePerGB) pricing, uint8[] supportedTiers, uint256 replicationFactor, string ipfsGateway, uint256 healthScore, uint256 avgLatencyMs))',
  'function isActive(address) view returns (bool)',
  'function getProviderByAgent(uint256 agentId) view returns (address)',
  'function getAgentLinkedProviders() view returns (address[])',
  'function hasValidAgent(address provider) view returns (bool)',
  'function minProviderStake() view returns (uint256)',
];

const MARKET_ABI = [
  'function getDeal(bytes32 dealId) view returns (tuple(bytes32 dealId, address user, address provider, uint8 status, string cid, uint256 sizeBytes, uint8 tier, uint256 startTime, uint256 endTime, uint256 totalCost, uint256 paidAmount, uint256 refundedAmount, uint256 replicationFactor, uint256 retrievalCount))',
  'function getUserDeals(address user) view returns (bytes32[])',
  'function getProviderDeals(address provider) view returns (bytes32[])',
  'function calculateDealCost(address provider, uint256 sizeBytes, uint256 durationDays, uint8 tier) view returns (uint256)',
  'function getQuote(address provider, uint256 sizeBytes, uint256 durationDays, uint8 tier) view returns (tuple(address provider, uint256 sizeBytes, uint256 durationDays, uint8 tier, uint256 cost, tuple(uint256 storageCost, uint256 bandwidth, uint256 retrieval) costBreakdown, uint256 expiresAt))',
  'function getUserRecord(address user) view returns (tuple(uint256 totalDeals, uint256 activeDeals, uint256 completedDeals, uint256 disputedDeals, uint256 totalStoredGB, uint256 totalSpent, bool banned))',
  'function getProviderRecord(address provider) view returns (tuple(uint256 totalDeals, uint256 activeDeals, uint256 completedDeals, uint256 failedDeals, uint256 totalStoredGB, uint256 totalEarnings, uint256 avgRating, uint256 ratingCount, uint256 uptimePercent, bool banned))',
  'function isDealActive(bytes32 dealId) view returns (bool)',
  // Write functions (require signer)
  'function createDeal(address provider, string cid, uint256 sizeBytes, uint256 durationDays, uint8 tier, uint256 replicationFactor) payable returns (bytes32)',
  'function extendDeal(bytes32 dealId, uint256 additionalDays) payable',
  'function terminateDeal(bytes32 dealId)',
  'function rateDeal(bytes32 dealId, uint8 score, string comment)',
];

const LEDGER_ABI = [
  'function getLedger(address user) view returns (tuple(uint256 totalBalance, uint256 availableBalance, uint256 lockedBalance, uint256 createdAt))',
  'function getSubAccount(address user, address provider) view returns (tuple(uint256 balance, uint256 pendingRefund, uint256 refundUnlockTime, bool acknowledged))',
  'function getAvailableBalance(address user) view returns (uint256)',
  'function ledgerExists(address user) view returns (bool)',
  // Write functions
  'function createLedger() payable',
  'function deposit() payable',
  'function transferToProvider(address provider, uint256 amount)',
];

const CREDIT_MANAGER_ABI = [
  'function getBalance(address user, address token) view returns (uint256)',
  'function getAllBalances(address user) view returns (uint256 usdcBalance, uint256 elizaBalance, uint256 ethBalance)',
  'function hasSufficientCredit(address user, address token, uint256 amount) view returns (bool sufficient, uint256 available)',
];

const PROVIDER_TYPES = ['IPFS_NODE', 'FILECOIN', 'ARWEAVE', 'CLOUD_S3', 'CLOUD_VERCEL', 'CLOUD_R2', 'HYBRID'];
const STORAGE_TIERS = ['HOT', 'WARM', 'COLD', 'PERMANENT'];
const DEAL_STATUS = ['PENDING', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'FAILED', 'DISPUTED'];

// ============================================================================
// A2A Server
// ============================================================================

export class StorageA2AServer {
  private app: Hono;
  private provider: JsonRpcProvider;
  private registry: Contract;
  private market: Contract;
  private ledger: Contract | null;
  private creditManager: Contract | null;
  private config: A2AConfig;
  private signer: Wallet | null = null;

  constructor(config: A2AConfig) {
    this.config = config;
    this.app = new Hono();
    this.provider = new JsonRpcProvider(config.rpcUrl);
    this.registry = new Contract(config.registryAddress, REGISTRY_ABI, this.provider);
    this.market = new Contract(config.marketAddress, MARKET_ABI, this.provider);
    this.ledger = config.ledgerAddress 
      ? new Contract(config.ledgerAddress, LEDGER_ABI, this.provider)
      : null;
    this.creditManager = config.creditManagerAddress
      ? new Contract(config.creditManagerAddress, CREDIT_MANAGER_ABI, this.provider)
      : null;
    
    if (config.privateKey) {
      this.signer = new Wallet(config.privateKey, this.provider);
    }

    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.use('/*', cors());

    this.app.get('/.well-known/agent-card.json', (c) => c.json(this.getAgentCard()));

    this.app.post('/a2a', async (c) => {
      const body = await c.req.json<A2ARequest>();
      if (body.method !== 'message/send') {
        return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Method not found' } });
      }

      const message = body.params?.message;
      if (!message?.parts) {
        return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'Invalid params' } });
      }

      const dataPart = message.parts.find((p) => p.kind === 'data');
      if (!dataPart?.data) {
        return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'No data part found' } });
      }

      const skillId = dataPart.data.skillId as string;
      const params = (dataPart.data.params as Record<string, unknown>) || dataPart.data;
      const userAddress = c.req.header('x-jeju-address');
      const paymentHeader = c.req.header('x-payment');

      if (!skillId) {
        return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'No skillId specified' } });
      }

      const result = await this.executeSkill(skillId, params, userAddress, paymentHeader);

      if (result.requiresPayment) {
        return c.json({
          jsonrpc: '2.0', id: body.id,
          error: { code: 402, message: 'Payment Required', data: result.requiresPayment },
        }, 402);
      }

      return c.json({
        jsonrpc: '2.0', id: body.id,
        result: {
          role: 'agent',
          parts: [{ kind: 'text', text: result.message }, { kind: 'data', data: result.data }],
          messageId: message.messageId,
          kind: 'message',
        },
      });
    });

    this.app.get('/health', (c) => c.json({ status: 'ok', service: 'storage-a2a' }));
  }

  private getAgentCard(): Record<string, unknown> {
    return {
      protocolVersion: '0.3.0',
      name: 'Jeju Storage Marketplace',
      description: 'Decentralized storage marketplace with x402 payments - IPFS pinning, cloud storage, permanent Arweave storage',
      url: '/a2a',
      preferredTransport: 'http',
      provider: { organization: 'Jeju Network', url: 'https://jeju.network' },
      version: '2.0.0',
      capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: true },
      defaultInputModes: ['text', 'data', 'binary'],
      defaultOutputModes: ['text', 'data', 'binary'],
      authentication: { schemes: ['x402', 'bearer'] },
      skills: [
        // ========== Provider Discovery ==========
        { id: 'list-providers', name: 'List Storage Providers', description: 'Get all active storage providers with pricing and capacity', tags: ['query', 'providers', 'free'] },
        { id: 'get-provider', name: 'Get Provider Details', description: 'Get detailed info about a storage provider including reputation', tags: ['query', 'provider', 'free'], inputSchema: { type: 'object', properties: { address: { type: 'string', description: 'Provider address' } }, required: ['address'] } },
        { id: 'list-verified-providers', name: 'List Verified Providers', description: 'Get providers with ERC-8004 agent verification', tags: ['query', 'providers', 'erc8004', 'free'] },
        { id: 'get-provider-by-agent', name: 'Get Provider by Agent ID', description: 'Find provider by ERC-8004 agent ID', tags: ['query', 'provider', 'erc8004', 'free'], inputSchema: { type: 'object', properties: { agentId: { type: 'number' } }, required: ['agentId'] } },
        
        // ========== Pricing & Quotes ==========
        { id: 'calculate-cost', name: 'Calculate Storage Cost', description: 'Calculate cost for given size, duration, and tier', tags: ['query', 'pricing', 'free'], inputSchema: { type: 'object', properties: { sizeBytes: { type: 'number' }, durationDays: { type: 'number' }, tier: { type: 'string', enum: STORAGE_TIERS } }, required: ['sizeBytes', 'durationDays'] } },
        { id: 'get-quote', name: 'Get Provider Quote', description: 'Get detailed quote from a specific provider', tags: ['query', 'pricing', 'free'], inputSchema: { type: 'object', properties: { provider: { type: 'string' }, sizeBytes: { type: 'number' }, durationDays: { type: 'number' }, tier: { type: 'string' } }, required: ['provider', 'sizeBytes', 'durationDays'] } },
        { id: 'get-best-quote', name: 'Get Best Quote', description: 'Find best-priced provider for storage requirements', tags: ['query', 'pricing', 'free'], inputSchema: { type: 'object', properties: { sizeBytes: { type: 'number' }, durationDays: { type: 'number' }, tier: { type: 'string' } }, required: ['sizeBytes', 'durationDays'] } },
        
        // ========== Storage Operations (x402 payment required) ==========
        { id: 'upload-file', name: 'Upload File', description: 'Upload and pin a file to storage (requires x402 payment)', tags: ['action', 'upload', 'x402'], inputSchema: { type: 'object', properties: { provider: { type: 'string' }, sizeBytes: { type: 'number' }, durationDays: { type: 'number' }, tier: { type: 'string' } } } },
        { id: 'pin-cid', name: 'Pin Existing CID', description: 'Pin an existing IPFS CID (requires x402 payment)', tags: ['action', 'pin', 'x402'], inputSchema: { type: 'object', properties: { cid: { type: 'string' }, provider: { type: 'string' }, durationDays: { type: 'number' } }, required: ['cid'] } },
        { id: 'retrieve-file', name: 'Retrieve File', description: 'Get file by CID from storage network', tags: ['query', 'retrieve', 'free'], inputSchema: { type: 'object', properties: { cid: { type: 'string' } }, required: ['cid'] } },
        
        // ========== Deal Management ==========
        { id: 'create-deal', name: 'Create Storage Deal', description: 'Create an on-chain storage deal (requires x402 payment)', tags: ['action', 'deal', 'x402'], inputSchema: { type: 'object', properties: { provider: { type: 'string' }, cid: { type: 'string' }, sizeBytes: { type: 'number' }, durationDays: { type: 'number' }, tier: { type: 'string' }, replicationFactor: { type: 'number' } }, required: ['provider', 'cid', 'sizeBytes', 'durationDays'] } },
        { id: 'get-deal', name: 'Get Deal Status', description: 'Check storage deal status and details', tags: ['query', 'deal', 'free'], inputSchema: { type: 'object', properties: { dealId: { type: 'string' } }, required: ['dealId'] } },
        { id: 'list-my-deals', name: 'List My Deals', description: 'Get all storage deals for an address', tags: ['query', 'deals', 'free'], inputSchema: { type: 'object', properties: { address: { type: 'string' } }, required: ['address'] } },
        { id: 'extend-deal', name: 'Extend Deal', description: 'Extend storage deal duration (requires x402 payment)', tags: ['action', 'deal', 'x402'], inputSchema: { type: 'object', properties: { dealId: { type: 'string' }, additionalDays: { type: 'number' } }, required: ['dealId', 'additionalDays'] } },
        { id: 'terminate-deal', name: 'Terminate Deal', description: 'Early termination of a storage deal', tags: ['action', 'deal'], inputSchema: { type: 'object', properties: { dealId: { type: 'string' } }, required: ['dealId'] } },
        { id: 'rate-deal', name: 'Rate Deal', description: 'Rate a completed storage deal', tags: ['action', 'reputation'], inputSchema: { type: 'object', properties: { dealId: { type: 'string' }, score: { type: 'number', minimum: 1, maximum: 100 }, comment: { type: 'string' } }, required: ['dealId', 'score'] } },
        
        // ========== Payment & Credits ==========
        { id: 'check-credits', name: 'Check Credit Balance', description: 'Check prepaid credit balance for an address', tags: ['query', 'payment', 'free'], inputSchema: { type: 'object', properties: { address: { type: 'string' } }, required: ['address'] } },
        { id: 'check-ledger', name: 'Check Ledger Balance', description: 'Check ledger and sub-account balances', tags: ['query', 'payment', 'free'], inputSchema: { type: 'object', properties: { address: { type: 'string' }, provider: { type: 'string' } }, required: ['address'] } },
        { id: 'get-payment-options', name: 'Get Payment Options', description: 'Get available payment methods for a storage operation', tags: ['query', 'payment', 'free'], inputSchema: { type: 'object', properties: { amountWei: { type: 'string' }, resource: { type: 'string' } }, required: ['amountWei'] } },
        
        // ========== Reputation & Stats ==========
        { id: 'get-reputation', name: 'Get Reputation', description: 'Get provider or user reputation and history', tags: ['query', 'reputation', 'free'], inputSchema: { type: 'object', properties: { address: { type: 'string' }, type: { type: 'string', enum: ['provider', 'user'] } }, required: ['address', 'type'] } },
        { id: 'get-storage-stats', name: 'Get Storage Statistics', description: 'Get marketplace-wide statistics', tags: ['query', 'stats', 'free'] },
        { id: 'list-pins', name: 'List Pins', description: 'List pinned files (local database)', tags: ['query', 'pins', 'free'], inputSchema: { type: 'object', properties: { limit: { type: 'number' }, status: { type: 'string' } } } },
      ],
    };
  }

  private async executeSkill(
    skillId: string, 
    params: Record<string, unknown>, 
    userAddress?: string,
    paymentHeader?: string
  ): Promise<SkillResult> {
    switch (skillId) {
      // Provider Discovery
      case 'list-providers': return this.listProviders();
      case 'get-provider': return this.getProvider(params.address as string);
      case 'list-verified-providers': return this.listVerifiedProviders();
      case 'get-provider-by-agent': return this.getProviderByAgent(params.agentId as number);
      
      // Pricing
      case 'calculate-cost': return this.calculateCost(params);
      case 'get-quote': return this.getQuote(params);
      case 'get-best-quote': return this.getBestQuote(params);
      
      // Storage Operations
      case 'upload-file': return this.uploadFile(params, userAddress, paymentHeader);
      case 'pin-cid': return this.pinCid(params, userAddress, paymentHeader);
      case 'retrieve-file': return this.retrieveFile(params.cid as string);
      
      // Deal Management
      case 'create-deal': return this.createDeal(params, userAddress, paymentHeader);
      case 'get-deal': return this.getDeal(params.dealId as string);
      case 'list-my-deals': return this.listUserDeals(params.address as string);
      case 'extend-deal': return this.extendDeal(params, userAddress, paymentHeader);
      case 'terminate-deal': return this.terminateDeal(params.dealId as string, userAddress);
      case 'rate-deal': return this.rateDeal(params, userAddress);
      
      // Payment
      case 'check-credits': return this.checkCredits(params.address as string);
      case 'check-ledger': return this.checkLedger(params.address as string, params.provider as string);
      case 'get-payment-options': return this.getPaymentOptions(params.amountWei as string, params.resource as string);
      
      // Stats
      case 'get-reputation': return this.getReputation(params.address as string, params.type as 'provider' | 'user');
      case 'get-storage-stats': return this.getStorageStats();
      case 'list-pins': return this.listPins(params);
      
      default: 
        return { message: 'Unknown skill', data: { error: `Skill '${skillId}' not found`, availableSkills: this.getAgentCard().skills } };
    }
  }

  // ============================================================================
  // Provider Discovery
  // ============================================================================

  private async listProviders(): Promise<SkillResult> {
    const addresses: string[] = await this.registry.getActiveProviders();
    const providers = [];
    for (const addr of addresses.slice(0, 20)) {
      const isActive = await this.registry.isActive(addr);
      if (!isActive) continue;
      const info = await this.registry.getProviderInfo(addr);
      providers.push({
        address: addr,
        name: info.provider.name,
        endpoint: info.provider.endpoint,
        type: PROVIDER_TYPES[Number(info.provider.providerType)],
        agentId: Number(info.provider.agentId) || null,
        verified: info.provider.verified,
        stake: formatEther(info.provider.stake),
        capacity: { totalGB: Number(info.capacity.totalCapacityGB), availableGB: Number(info.capacity.availableCapacityGB) },
        pricing: { pricePerGBMonth: formatEther(info.pricing.pricePerGBMonth) },
        supportedTiers: info.supportedTiers.map((t: number) => STORAGE_TIERS[t]),
        healthScore: Number(info.healthScore),
      });
    }
    return { message: `Found ${providers.length} active storage providers`, data: { providers, total: addresses.length } };
  }

  private async getProvider(address: string): Promise<SkillResult> {
    if (!address) return { message: 'Error: address required', data: { error: 'Missing address' } };
    const isActive = await this.registry.isActive(address);
    if (!isActive) return { message: 'Provider not found or inactive', data: { error: 'Not found' } };
    
    const info = await this.registry.getProviderInfo(address);
    const record = await this.market.getProviderRecord(address);
    const hasAgent = await this.registry.hasValidAgent(address);

    return {
      message: `Provider: ${info.provider.name}`,
      data: {
        address,
        name: info.provider.name,
        endpoint: info.provider.endpoint,
        type: PROVIDER_TYPES[Number(info.provider.providerType)],
        agentId: Number(info.provider.agentId) || null,
        hasValidAgent: hasAgent,
        verified: info.provider.verified,
        stake: formatEther(info.provider.stake),
        capacity: {
          totalGB: Number(info.capacity.totalCapacityGB),
          usedGB: Number(info.capacity.usedCapacityGB),
          availableGB: Number(info.capacity.availableCapacityGB),
        },
        pricing: {
          pricePerGBMonth: formatEther(info.pricing.pricePerGBMonth),
          uploadPricePerGB: formatEther(info.pricing.uploadPricePerGB),
          retrievalPricePerGB: formatEther(info.pricing.retrievalPricePerGB),
          minDays: Number(info.pricing.minStoragePeriodDays),
          maxDays: Number(info.pricing.maxStoragePeriodDays),
        },
        supportedTiers: info.supportedTiers.map((t: number) => STORAGE_TIERS[t]),
        replicationFactor: Number(info.replicationFactor),
        healthScore: Number(info.healthScore),
        avgLatencyMs: Number(info.avgLatencyMs),
        ipfsGateway: info.ipfsGateway,
        reputation: {
          avgRating: Number(record.ratingCount) > 0 ? (Number(record.avgRating) / 100).toFixed(2) : 'N/A',
          ratingCount: Number(record.ratingCount),
          totalDeals: Number(record.totalDeals),
          completedDeals: Number(record.completedDeals),
          failedDeals: Number(record.failedDeals),
          uptimePercent: Number(record.uptimePercent),
          banned: record.banned,
        },
      },
    };
  }

  private async listVerifiedProviders(): Promise<SkillResult> {
    const addresses: string[] = await this.registry.getAgentLinkedProviders();
    const providers = [];
    for (const addr of addresses) {
      const info = await this.registry.getProviderInfo(addr);
      if (!info.provider.active) continue;
      providers.push({
        address: addr,
        name: info.provider.name,
        agentId: Number(info.provider.agentId),
        endpoint: info.provider.endpoint,
        type: PROVIDER_TYPES[Number(info.provider.providerType)],
        healthScore: Number(info.healthScore),
      });
    }
    return { message: `Found ${providers.length} ERC-8004 verified providers`, data: { providers } };
  }

  private async getProviderByAgent(agentId: number): Promise<SkillResult> {
    if (!agentId) return { message: 'Error: agentId required', data: { error: 'Missing agentId' } };
    const address = await this.registry.getProviderByAgent(agentId);
    if (address === ZERO_ADDRESS) {
      return { message: 'No provider found for agent', data: { agentId, found: false } };
    }
    return this.getProvider(address);
  }

  // ============================================================================
  // Pricing
  // ============================================================================

  private calculateCost(params: Record<string, unknown>): SkillResult {
    const sizeBytes = params.sizeBytes as number;
    const durationDays = params.durationDays as number;
    const tier = ((params.tier as string) || 'warm').toLowerCase() as 'hot' | 'warm' | 'cold' | 'permanent';

    if (!sizeBytes || !durationDays) {
      return { message: 'Error: sizeBytes and durationDays required', data: { error: 'Missing params' } };
    }

    const cost = calculateStorageCost(sizeBytes, durationDays, tier);
    const sizeGB = sizeBytes / (1024 ** 3);

    return {
      message: `Storage cost: ${formatEther(cost)} ETH for ${sizeGB.toFixed(4)} GB for ${durationDays} days (${tier} tier)`,
      data: {
        sizeBytes,
        sizeGB: Number(sizeGB.toFixed(4)),
        durationDays,
        tier,
        costETH: formatEther(cost),
        costWei: cost.toString(),
        pricePerGBMonth: formatEther(STORAGE_PRICING.WARM_TIER_PER_GB_MONTH),
      },
    };
  }

  private async getQuote(params: Record<string, unknown>): Promise<SkillResult> {
    const provider = params.provider as string;
    const sizeBytes = params.sizeBytes as number;
    const durationDays = params.durationDays as number;
    const tier = STORAGE_TIERS.indexOf((params.tier as string)?.toUpperCase() || 'WARM');

    if (!provider || !sizeBytes || !durationDays) {
      return { message: 'Error: provider, sizeBytes, and durationDays required', data: { error: 'Missing params' } };
    }

    const quote = await this.market.getQuote(provider, BigInt(sizeBytes), durationDays, tier >= 0 ? tier : 1);
    
    return {
      message: `Quote from provider: ${formatEther(quote.cost)} ETH`,
      data: {
        provider: quote.provider,
        sizeBytes: Number(quote.sizeBytes),
        durationDays: Number(quote.durationDays),
        tier: STORAGE_TIERS[Number(quote.tier)],
        costETH: formatEther(quote.cost),
        costWei: quote.cost.toString(),
        breakdown: {
          storage: formatEther(quote.costBreakdown.storageCost),
          bandwidth: formatEther(quote.costBreakdown.bandwidth),
          retrieval: formatEther(quote.costBreakdown.retrieval),
        },
        expiresAt: new Date(Number(quote.expiresAt) * 1000).toISOString(),
      },
    };
  }

  private async getBestQuote(params: Record<string, unknown>): Promise<SkillResult> {
    const sizeBytes = params.sizeBytes as number;
    const durationDays = params.durationDays as number;
    const tier = STORAGE_TIERS.indexOf((params.tier as string)?.toUpperCase() || 'WARM');

    if (!sizeBytes || !durationDays) {
      return { message: 'Error: sizeBytes and durationDays required', data: { error: 'Missing params' } };
    }

    const addresses: string[] = await this.registry.getActiveProviders();
    let bestQuote = { provider: '', cost: 0n, name: '' };

    for (const addr of addresses.slice(0, 10)) {
      const isActive = await this.registry.isActive(addr);
      if (!isActive) continue;
      
      const cost = await this.market.calculateDealCost(addr, BigInt(sizeBytes), durationDays, tier >= 0 ? tier : 1);
      if (bestQuote.cost === 0n || cost < bestQuote.cost) {
        const info = await this.registry.getProviderInfo(addr);
        bestQuote = { provider: addr, cost, name: info.provider.name };
      }
    }

    if (!bestQuote.provider) {
      return { message: 'No active providers found', data: { error: 'No providers' } };
    }

    return {
      message: `Best price: ${formatEther(bestQuote.cost)} ETH from ${bestQuote.name}`,
      data: {
        provider: bestQuote.provider,
        providerName: bestQuote.name,
        sizeBytes,
        durationDays,
        tier: STORAGE_TIERS[tier >= 0 ? tier : 1],
        costETH: formatEther(bestQuote.cost),
        costWei: bestQuote.cost.toString(),
      },
    };
  }

  // ============================================================================
  // Storage Operations
  // ============================================================================

  private async uploadFile(params: Record<string, unknown>, userAddress?: string, paymentHeader?: string): Promise<SkillResult> {
    const sizeBytes = params.sizeBytes as number || 1024 * 1024;
    const durationDays = params.durationDays as number || 30;
    const tier = ((params.tier as string) || 'warm').toLowerCase() as 'hot' | 'warm' | 'cold' | 'permanent';

    const cost = calculateStorageCost(sizeBytes, durationDays, tier);

    if (!paymentHeader) {
      return {
        message: 'Payment required for upload',
        data: { estimatedCostWei: cost.toString(), estimatedCostETH: formatEther(cost) },
        requiresPayment: createStoragePaymentRequirement(
          '/a2a/upload-file',
          cost,
          (this.config.paymentRecipient || ZERO_ADDRESS) as `0x${string}`,
          `Upload file: ${(sizeBytes / (1024 * 1024)).toFixed(2)} MB for ${durationDays} days`
        ),
      };
    }

    return {
      message: 'Payment verified. Submit file to POST /upload endpoint',
      data: {
        endpoint: '/upload',
        method: 'POST',
        headers: { 
          'X-Payment': paymentHeader, 
          'x-jeju-address': userAddress || '',
          'Content-Type': 'multipart/form-data',
        },
        estimatedCostETH: formatEther(cost),
      },
    };
  }

  private async pinCid(params: Record<string, unknown>, userAddress?: string, paymentHeader?: string): Promise<SkillResult> {
    const cid = params.cid as string;
    const sizeBytes = params.sizeBytes as number || 1024 * 1024;
    const durationDays = params.durationDays as number || 30;

    if (!cid) return { message: 'Error: cid required', data: { error: 'Missing cid' } };

    const cost = calculateStorageCost(sizeBytes, durationDays, 'warm');

    if (!paymentHeader) {
      return {
        message: 'Payment required for pinning',
        data: { cid, estimatedCostWei: cost.toString() },
        requiresPayment: createStoragePaymentRequirement(
          '/a2a/pin-cid',
          cost,
          (this.config.paymentRecipient || ZERO_ADDRESS) as `0x${string}`,
          `Pin CID: ${cid} for ${durationDays} days`
        ),
      };
    }

    return {
      message: 'Payment verified. Submit pin request to POST /pins endpoint',
      data: {
        endpoint: '/pins',
        method: 'POST',
        body: { cid, name: params.name || cid },
        headers: { 'X-Payment': paymentHeader, 'x-jeju-address': userAddress || '' },
      },
    };
  }

  private async retrieveFile(cid: string): Promise<SkillResult> {
    if (!cid) return { message: 'Error: cid required', data: { error: 'Missing cid' } };

    const addresses: string[] = await this.registry.getActiveProviders();
    let gateway = 'https://ipfs.io';

    for (const addr of addresses.slice(0, 5)) {
      const info = await this.registry.getProviderInfo(addr);
      if (info.ipfsGateway) {
        gateway = info.ipfsGateway;
        break;
      }
    }

    return {
      message: `File available via IPFS gateway`,
      data: {
        cid,
        gatewayUrl: `${gateway}/ipfs/${cid}`,
        directUrl: `https://ipfs.io/ipfs/${cid}`,
        localEndpoint: `/ipfs/${cid}`,
      },
    };
  }

  // ============================================================================
  // Deal Management
  // ============================================================================

  private async createDeal(params: Record<string, unknown>, userAddress?: string, paymentHeader?: string): Promise<SkillResult> {
    const provider = params.provider as string;
    const cid = params.cid as string;
    const sizeBytes = params.sizeBytes as number;
    const durationDays = params.durationDays as number;
    const tier = STORAGE_TIERS.indexOf((params.tier as string)?.toUpperCase() || 'WARM');
    const replicationFactor = params.replicationFactor as number || 1;

    if (!provider || !cid || !sizeBytes || !durationDays) {
      return { message: 'Error: provider, cid, sizeBytes, durationDays required', data: { error: 'Missing params' } };
    }

    const cost = await this.market.calculateDealCost(provider, BigInt(sizeBytes), durationDays, tier >= 0 ? tier : 1);

    if (!paymentHeader) {
      return {
        message: 'Payment required to create deal',
        data: { provider, cid, costWei: cost.toString(), costETH: formatEther(cost) },
        requiresPayment: createStoragePaymentRequirement(
          '/a2a/create-deal',
          cost,
          provider as `0x${string}`,
          `Storage deal: ${cid} for ${durationDays} days`
        ),
      };
    }

    return {
      message: 'Payment verified. Use SDK or contract to finalize deal on-chain',
      data: {
        contract: this.config.marketAddress,
        method: 'createDeal',
        args: { provider, cid, sizeBytes, durationDays, tier: tier >= 0 ? tier : 1, replicationFactor },
        costWei: cost.toString(),
        note: 'Call createDeal with value = costWei',
      },
    };
  }

  private async getDeal(dealId: string): Promise<SkillResult> {
    if (!dealId) return { message: 'Error: dealId required', data: { error: 'Missing dealId' } };

    const deal = await this.market.getDeal(dealId);
    if (deal.dealId === '0x0000000000000000000000000000000000000000000000000000000000000000') {
      return { message: 'Deal not found', data: { error: 'Not found', dealId } };
    }

    const isActive = await this.market.isDealActive(dealId);

    return {
      message: `Deal is ${DEAL_STATUS[Number(deal.status)]}`,
      data: {
        dealId: deal.dealId,
        user: deal.user,
        provider: deal.provider,
        status: DEAL_STATUS[Number(deal.status)],
        isActive,
        cid: deal.cid,
        sizeBytes: deal.sizeBytes.toString(),
        sizeGB: (Number(deal.sizeBytes) / (1024 ** 3)).toFixed(4),
        tier: STORAGE_TIERS[Number(deal.tier)],
        startTime: Number(deal.startTime) > 0 ? new Date(Number(deal.startTime) * 1000).toISOString() : null,
        endTime: Number(deal.endTime) > 0 ? new Date(Number(deal.endTime) * 1000).toISOString() : null,
        totalCostETH: formatEther(deal.totalCost),
        paidETH: formatEther(deal.paidAmount),
        refundedETH: formatEther(deal.refundedAmount),
        retrievalCount: Number(deal.retrievalCount),
      },
    };
  }

  private async listUserDeals(address: string): Promise<SkillResult> {
    if (!address) return { message: 'Error: address required', data: { error: 'Missing address' } };

    const dealIds: string[] = await this.market.getUserDeals(address);
    const deals = [];
    for (const id of dealIds.slice(-10)) {
      const deal = await this.market.getDeal(id);
      deals.push({
        dealId: id,
        provider: deal.provider,
        status: DEAL_STATUS[Number(deal.status)],
        cid: deal.cid,
        sizeGB: (Number(deal.sizeBytes) / (1024 ** 3)).toFixed(4),
        costETH: formatEther(deal.totalCost),
        endTime: Number(deal.endTime) > 0 ? new Date(Number(deal.endTime) * 1000).toISOString() : null,
      });
    }

    return { message: `Found ${dealIds.length} deals for ${address}`, data: { total: dealIds.length, recent: deals.reverse() } };
  }

  private async extendDeal(params: Record<string, unknown>, userAddress?: string, paymentHeader?: string): Promise<SkillResult> {
    const dealId = params.dealId as string;
    const additionalDays = params.additionalDays as number;

    if (!dealId || !additionalDays) {
      return { message: 'Error: dealId and additionalDays required', data: { error: 'Missing params' } };
    }

    const deal = await this.market.getDeal(dealId);
    if (deal.user.toLowerCase() !== userAddress?.toLowerCase()) {
      return { message: 'Error: Not deal owner', data: { error: 'Unauthorized' } };
    }

    const cost = await this.market.calculateDealCost(deal.provider, deal.sizeBytes, additionalDays, Number(deal.tier));

    if (!paymentHeader) {
      return {
        message: 'Payment required to extend deal',
        data: { dealId, additionalDays, costWei: cost.toString() },
        requiresPayment: createStoragePaymentRequirement(
          '/a2a/extend-deal',
          cost,
          deal.provider as `0x${string}`,
          `Extend deal ${dealId} by ${additionalDays} days`
        ),
      };
    }

    return {
      message: 'Payment verified. Call extendDeal on-chain',
      data: {
        contract: this.config.marketAddress,
        method: 'extendDeal',
        args: { dealId, additionalDays },
        costWei: cost.toString(),
      },
    };
  }

  private async terminateDeal(dealId: string, userAddress?: string): Promise<SkillResult> {
    if (!dealId) return { message: 'Error: dealId required', data: { error: 'Missing dealId' } };

    const deal = await this.market.getDeal(dealId);
    if (deal.user.toLowerCase() !== userAddress?.toLowerCase()) {
      return { message: 'Error: Not deal owner', data: { error: 'Unauthorized' } };
    }

    return {
      message: 'Call terminateDeal on-chain to terminate',
      data: {
        contract: this.config.marketAddress,
        method: 'terminateDeal',
        args: { dealId },
        note: 'Early termination may result in partial refund',
      },
    };
  }

  private async rateDeal(params: Record<string, unknown>, userAddress?: string): Promise<SkillResult> {
    const dealId = params.dealId as string;
    const score = params.score as number;
    const comment = (params.comment as string) || '';

    if (!dealId || !score) return { message: 'Error: dealId and score required', data: { error: 'Missing params' } };
    if (score < 1 || score > 100) return { message: 'Error: score must be 1-100', data: { error: 'Invalid score' } };

    const deal = await this.market.getDeal(dealId);
    if (deal.user.toLowerCase() !== userAddress?.toLowerCase()) {
      return { message: 'Error: Not deal owner', data: { error: 'Unauthorized' } };
    }

    return {
      message: 'Call rateDeal on-chain to submit rating',
      data: {
        contract: this.config.marketAddress,
        method: 'rateDeal',
        args: { dealId, score, comment },
      },
    };
  }

  // ============================================================================
  // Payment & Credits
  // ============================================================================

  private async checkCredits(address: string): Promise<SkillResult> {
    if (!address) return { message: 'Error: address required', data: { error: 'Missing address' } };
    if (!this.creditManager) return { message: 'Credit system not configured', data: { error: 'Not configured' } };

    const [usdcBalance, elizaBalance, ethBalance] = await this.creditManager.getAllBalances(address);
    
    return {
      message: `Credit balance: ${formatEther(ethBalance)} ETH`,
      data: {
        address,
        balances: {
          eth: formatEther(ethBalance),
          ethWei: ethBalance.toString(),
          usdc: (Number(usdcBalance) / 1e6).toFixed(2),
          elizaOS: formatEther(elizaBalance),
        },
      },
    };
  }

  private async checkLedger(address: string, provider?: string): Promise<SkillResult> {
    if (!address) return { message: 'Error: address required', data: { error: 'Missing address' } };
    if (!this.ledger) return { message: 'Ledger system not configured', data: { error: 'Not configured' } };

    const ledger = await this.ledger.getLedger(address);
    const result: Record<string, unknown> = {
      address,
      ledger: {
        totalBalance: formatEther(ledger.totalBalance),
        availableBalance: formatEther(ledger.availableBalance),
        lockedBalance: formatEther(ledger.lockedBalance),
        createdAt: Number(ledger.createdAt) > 0 ? new Date(Number(ledger.createdAt) * 1000).toISOString() : null,
      },
    };

    if (provider) {
      const subAccount = await this.ledger.getSubAccount(address, provider);
      result.subAccount = {
        provider,
        balance: formatEther(subAccount.balance),
        pendingRefund: formatEther(subAccount.pendingRefund),
        refundUnlockTime: Number(subAccount.refundUnlockTime) > 0 
          ? new Date(Number(subAccount.refundUnlockTime) * 1000).toISOString() 
          : null,
        acknowledged: subAccount.acknowledged,
      };
    }

    return { message: `Ledger balance: ${formatEther(ledger.availableBalance)} ETH available`, data: result };
  }

  private getPaymentOptions(amountWei: string, resource?: string): SkillResult {
    const amount = BigInt(amountWei || '0');
    const requirement = createStoragePaymentRequirement(
      resource || '/storage',
      amount,
      (this.config.paymentRecipient || ZERO_ADDRESS) as `0x${string}`,
      `Storage payment: ${formatEther(amount)} ETH`
    );

    return {
      message: `Payment options for ${formatEther(amount)} ETH`,
      data: {
        amountWei: amount.toString(),
        amountETH: formatEther(amount),
        options: requirement.accepts,
        headers: {
          'X-Payment': 'scheme=exact;network=...;payload=<signature>;amount=<wei>',
          'x-jeju-address': '<your-address>',
        },
      },
    };
  }

  // ============================================================================
  // Reputation & Stats
  // ============================================================================

  private async getReputation(address: string, type: 'provider' | 'user'): Promise<SkillResult> {
    if (!address || !type) return { message: 'Error: address and type required', data: { error: 'Missing params' } };

    if (type === 'provider') {
      const record = await this.market.getProviderRecord(address);
      const avgRating = Number(record.ratingCount) > 0 ? Number(record.avgRating) / 100 : 0;
      return {
        message: `Provider rating: ${avgRating.toFixed(1)}/5 (${record.ratingCount} reviews)`,
        data: {
          address,
          type: 'provider',
          totalDeals: Number(record.totalDeals),
          activeDeals: Number(record.activeDeals),
          completedDeals: Number(record.completedDeals),
          failedDeals: Number(record.failedDeals),
          totalStoredGB: Number(record.totalStoredGB),
          totalEarningsETH: formatEther(record.totalEarnings),
          avgRating: avgRating.toFixed(2),
          ratingCount: Number(record.ratingCount),
          uptimePercent: Number(record.uptimePercent),
          banned: record.banned,
        },
      };
    } else {
      const record = await this.market.getUserRecord(address);
      return {
        message: `User: ${record.totalDeals} deals, ${formatEther(record.totalSpent)} ETH spent`,
        data: {
          address,
          type: 'user',
          totalDeals: Number(record.totalDeals),
          activeDeals: Number(record.activeDeals),
          completedDeals: Number(record.completedDeals),
          disputedDeals: Number(record.disputedDeals),
          totalStoredGB: Number(record.totalStoredGB),
          totalSpentETH: formatEther(record.totalSpent),
          banned: record.banned,
        },
      };
    }
  }

  private async getStorageStats(): Promise<SkillResult> {
    const addresses: string[] = await this.registry.getActiveProviders();
    let activeCount = 0;
    let totalCapacity = 0;
    let usedCapacity = 0;

    for (const addr of addresses) {
      const isActive = await this.registry.isActive(addr);
      if (!isActive) continue;
      activeCount++;

      const info = await this.registry.getProviderInfo(addr);
      totalCapacity += Number(info.capacity.totalCapacityGB);
      usedCapacity += Number(info.capacity.usedCapacityGB);
    }

    // Also get local DB stats
    const dbStats = await db.getStorageStats();

    return {
      message: `Storage marketplace: ${activeCount} active providers, ${(totalCapacity / 1024).toFixed(1)} TB capacity`,
      data: {
        marketplace: {
          totalProviders: addresses.length,
          activeProviders: activeCount,
          totalCapacityTB: (totalCapacity / 1024).toFixed(2),
          usedCapacityTB: (usedCapacity / 1024).toFixed(2),
          utilizationPercent: totalCapacity > 0 ? ((usedCapacity / totalCapacity) * 100).toFixed(1) : '0',
        },
        local: {
          totalPins: dbStats.totalPins,
          totalSizeGB: dbStats.totalSizeGB.toFixed(4),
        },
      },
    };
  }

  private async listPins(params: Record<string, unknown>): Promise<SkillResult> {
    const limit = (params.limit as number) || 20;
    const status = params.status as string;

    const pins = await db.listPins({ status, limit, offset: 0 });
    const count = await db.countPins();

    return {
      message: `Found ${count} pins`,
      data: {
        total: count,
        results: pins.map(p => ({
          id: p.id,
          cid: p.cid,
          name: p.name,
          status: p.status,
          sizeBytes: p.sizeBytes,
        })),
      },
    };
  }

  getRouter(): Hono {
    return this.app;
  }
}

export function createStorageA2AServer(config: A2AConfig): StorageA2AServer {
  return new StorageA2AServer(config);
}
