/**
 * MCP Server for Storage Marketplace
 * 
 * Complete Model Context Protocol integration for AI agent access:
 * - All storage capabilities as MCP tools
 * - Resources for discovery and monitoring
 * - x402 payment integration for paid operations
 * - ERC-8004 provider verification
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Contract, JsonRpcProvider, formatEther } from 'ethers';
import { database as db } from './database';
import {
  calculateStorageCost,
  calculateRetrievalCost,
  createStoragePaymentRequirement,
  parseX402Header,
  verifyX402Payment,
  formatStorageCost,
  STORAGE_PRICING,
  ZERO_ADDRESS,
  type X402PaymentRequirement,
} from './sdk/x402';

// ============================================================================
// Types
// ============================================================================

interface MCPConfig {
  rpcUrl: string;
  registryAddress: string;
  marketAddress: string;
  ledgerAddress: string;
  creditManagerAddress?: string;
  paymentRecipient?: string;
}

interface MCPToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
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
];

const LEDGER_ABI = [
  'function getLedger(address user) view returns (tuple(uint256 totalBalance, uint256 availableBalance, uint256 lockedBalance, uint256 createdAt))',
  'function getSubAccount(address user, address provider) view returns (tuple(uint256 balance, uint256 pendingRefund, uint256 refundUnlockTime, bool acknowledged))',
  'function getAvailableBalance(address user) view returns (uint256)',
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
// MCP Server Info & Capabilities
// ============================================================================

const MCP_SERVER_INFO = {
  name: 'jeju-storage',
  version: '2.0.0',
  description: 'Jeju Storage Marketplace - Decentralized IPFS/Cloud/Arweave storage with x402 payments',
  capabilities: { 
    resources: true, 
    tools: true, 
    prompts: false,
    experimental: {
      x402Payments: true,
      erc8004Integration: true,
    },
  },
};

const MCP_RESOURCES = [
  // Discovery Resources
  { uri: 'storage://providers', name: 'Storage Providers', description: 'All active storage providers with pricing and capacity', mimeType: 'application/json' },
  { uri: 'storage://providers/verified', name: 'Verified Providers', description: 'ERC-8004 verified storage providers', mimeType: 'application/json' },
  { uri: 'storage://pricing', name: 'Pricing Tiers', description: 'Storage tier pricing information', mimeType: 'application/json' },
  // Marketplace Resources
  { uri: 'storage://deals/recent', name: 'Recent Deals', description: 'Recent storage deals on the marketplace', mimeType: 'application/json' },
  { uri: 'storage://stats', name: 'Marketplace Stats', description: 'Global marketplace statistics', mimeType: 'application/json' },
  // Local Resources
  { uri: 'storage://pins', name: 'Local Pins', description: 'Locally pinned files', mimeType: 'application/json' },
  // Payment Resources
  { uri: 'storage://payment/options', name: 'Payment Options', description: 'Available x402 payment methods', mimeType: 'application/json' },
];

const MCP_TOOLS = [
  // === FREE TOOLS (No payment required) ===
  // Provider Discovery
  { 
    name: 'list_providers', 
    description: 'List active storage providers with filtering options',
    inputSchema: { 
      type: 'object', 
      properties: { 
        providerType: { type: 'string', enum: PROVIDER_TYPES, description: 'Filter by provider type' },
        minCapacityGB: { type: 'number', description: 'Minimum available capacity in GB' },
        tier: { type: 'string', enum: STORAGE_TIERS, description: 'Filter by supported tier' },
        limit: { type: 'number', description: 'Max providers to return', default: 20 },
      },
    },
    tags: ['query', 'providers', 'free'],
  },
  { 
    name: 'get_provider', 
    description: 'Get detailed information about a storage provider including reputation',
    inputSchema: { 
      type: 'object', 
      properties: { address: { type: 'string', description: 'Provider address' } }, 
      required: ['address'],
    },
    tags: ['query', 'provider', 'free'],
  },
  { 
    name: 'list_verified_providers', 
    description: 'List ERC-8004 verified storage providers',
    inputSchema: { type: 'object', properties: {} },
    tags: ['query', 'providers', 'erc8004', 'free'],
  },
  { 
    name: 'get_provider_by_agent', 
    description: 'Find storage provider by ERC-8004 agent ID',
    inputSchema: { 
      type: 'object', 
      properties: { agentId: { type: 'number', description: 'ERC-8004 Agent ID' } }, 
      required: ['agentId'],
    },
    tags: ['query', 'provider', 'erc8004', 'free'],
  },
  
  // Pricing & Quotes
  { 
    name: 'calculate_cost', 
    description: 'Calculate storage cost for given parameters',
    inputSchema: { 
      type: 'object', 
      properties: { 
        sizeBytes: { type: 'number', description: 'Size in bytes' },
        durationDays: { type: 'number', description: 'Duration in days' },
        tier: { type: 'string', enum: ['hot', 'warm', 'cold', 'permanent'], default: 'warm' },
      }, 
      required: ['sizeBytes', 'durationDays'],
    },
    tags: ['query', 'pricing', 'free'],
  },
  { 
    name: 'get_quote', 
    description: 'Get storage quote from a specific provider or best available',
    inputSchema: { 
      type: 'object', 
      properties: { 
        provider: { type: 'string', description: 'Provider address (optional - finds best if omitted)' },
        sizeBytes: { type: 'number', description: 'Size in bytes' },
        durationDays: { type: 'number', description: 'Duration in days' },
        tier: { type: 'string', enum: STORAGE_TIERS, default: 'WARM' },
      }, 
      required: ['sizeBytes', 'durationDays'],
    },
    tags: ['query', 'pricing', 'free'],
  },
  
  // Deal Management (Read)
  { 
    name: 'get_deal', 
    description: 'Get storage deal details by ID',
    inputSchema: { 
      type: 'object', 
      properties: { dealId: { type: 'string', description: 'Deal ID (bytes32)' } }, 
      required: ['dealId'],
    },
    tags: ['query', 'deal', 'free'],
  },
  { 
    name: 'list_user_deals', 
    description: 'List all storage deals for a user address',
    inputSchema: { 
      type: 'object', 
      properties: { 
        address: { type: 'string', description: 'User address' },
        limit: { type: 'number', default: 20 },
      }, 
      required: ['address'],
    },
    tags: ['query', 'deals', 'free'],
  },
  
  // File Operations (Read)
  { 
    name: 'get_gateway_url', 
    description: 'Get IPFS gateway URLs for a CID',
    inputSchema: { 
      type: 'object', 
      properties: { cid: { type: 'string', description: 'IPFS CID' } }, 
      required: ['cid'],
    },
    tags: ['query', 'ipfs', 'free'],
  },
  { 
    name: 'list_pins', 
    description: 'List locally pinned files',
    inputSchema: { 
      type: 'object', 
      properties: { 
        status: { type: 'string', enum: ['pinned', 'unpinned', 'queued'] },
        limit: { type: 'number', default: 20 },
      },
    },
    tags: ['query', 'pins', 'free'],
  },
  
  // Payment & Credits (Read)
  { 
    name: 'check_credits', 
    description: 'Check prepaid credit balance for an address',
    inputSchema: { 
      type: 'object', 
      properties: { address: { type: 'string', description: 'User address' } }, 
      required: ['address'],
    },
    tags: ['query', 'payment', 'free'],
  },
  { 
    name: 'check_ledger', 
    description: 'Check ledger and sub-account balances',
    inputSchema: { 
      type: 'object', 
      properties: { 
        address: { type: 'string', description: 'User address' },
        provider: { type: 'string', description: 'Provider address for sub-account' },
      }, 
      required: ['address'],
    },
    tags: ['query', 'payment', 'free'],
  },
  { 
    name: 'get_payment_options', 
    description: 'Get x402 payment options for an amount',
    inputSchema: { 
      type: 'object', 
      properties: { 
        amountWei: { type: 'string', description: 'Amount in wei' },
        resource: { type: 'string', description: 'Resource path' },
      }, 
      required: ['amountWei'],
    },
    tags: ['query', 'payment', 'free'],
  },
  
  // Reputation
  { 
    name: 'get_reputation', 
    description: 'Get reputation for a provider or user',
    inputSchema: { 
      type: 'object', 
      properties: { 
        address: { type: 'string', description: 'Address' },
        type: { type: 'string', enum: ['provider', 'user'] },
      }, 
      required: ['address', 'type'],
    },
    tags: ['query', 'reputation', 'free'],
  },
  
  // === PAID TOOLS (x402 payment required) ===
  { 
    name: 'upload_file', 
    description: 'Upload and pin a file to storage (REQUIRES x402 PAYMENT)',
    inputSchema: { 
      type: 'object', 
      properties: { 
        provider: { type: 'string', description: 'Provider address (optional)' },
        sizeBytes: { type: 'number', description: 'File size in bytes' },
        durationDays: { type: 'number', default: 30 },
        tier: { type: 'string', enum: ['hot', 'warm', 'cold', 'permanent'], default: 'warm' },
      },
    },
    tags: ['action', 'upload', 'x402'],
    requiresPayment: true,
  },
  { 
    name: 'pin_cid', 
    description: 'Pin an existing IPFS CID (REQUIRES x402 PAYMENT)',
    inputSchema: { 
      type: 'object', 
      properties: { 
        cid: { type: 'string', description: 'IPFS CID to pin' },
        provider: { type: 'string', description: 'Provider address (optional)' },
        sizeBytes: { type: 'number', description: 'Size estimate (default 1MB)' },
        durationDays: { type: 'number', default: 30 },
      }, 
      required: ['cid'],
    },
    tags: ['action', 'pin', 'x402'],
    requiresPayment: true,
  },
  { 
    name: 'create_deal', 
    description: 'Create an on-chain storage deal (REQUIRES x402 PAYMENT)',
    inputSchema: { 
      type: 'object', 
      properties: { 
        provider: { type: 'string', description: 'Provider address' },
        cid: { type: 'string', description: 'Content CID' },
        sizeBytes: { type: 'number', description: 'Size in bytes' },
        durationDays: { type: 'number', description: 'Duration in days' },
        tier: { type: 'string', enum: STORAGE_TIERS, default: 'WARM' },
        replicationFactor: { type: 'number', default: 1 },
      }, 
      required: ['provider', 'cid', 'sizeBytes', 'durationDays'],
    },
    tags: ['action', 'deal', 'x402'],
    requiresPayment: true,
  },
  { 
    name: 'extend_deal', 
    description: 'Extend storage deal duration (REQUIRES x402 PAYMENT)',
    inputSchema: { 
      type: 'object', 
      properties: { 
        dealId: { type: 'string', description: 'Deal ID' },
        additionalDays: { type: 'number', description: 'Days to add' },
      }, 
      required: ['dealId', 'additionalDays'],
    },
    tags: ['action', 'deal', 'x402'],
    requiresPayment: true,
  },
  { 
    name: 'terminate_deal', 
    description: 'Terminate a storage deal early',
    inputSchema: { 
      type: 'object', 
      properties: { dealId: { type: 'string', description: 'Deal ID' } }, 
      required: ['dealId'],
    },
    tags: ['action', 'deal'],
  },
  { 
    name: 'rate_deal', 
    description: 'Rate a completed storage deal',
    inputSchema: { 
      type: 'object', 
      properties: { 
        dealId: { type: 'string', description: 'Deal ID' },
        score: { type: 'number', minimum: 1, maximum: 100, description: 'Rating 1-100' },
        comment: { type: 'string', description: 'Optional comment' },
      }, 
      required: ['dealId', 'score'],
    },
    tags: ['action', 'reputation'],
  },
];

// ============================================================================
// MCP Server
// ============================================================================

export class StorageMCPServer {
  private app: Hono;
  private ethProvider: JsonRpcProvider | null;
  private registry: Contract | null;
  private market: Contract | null;
  private ledger: Contract | null;
  private creditManager: Contract | null;
  private config: MCPConfig;
  private contractsConfigured: boolean;

  constructor(config: MCPConfig) {
    this.config = config;
    this.app = new Hono();
    
    // Only initialize contracts if addresses are provided
    this.contractsConfigured = Boolean(config.registryAddress && config.marketAddress);
    
    if (this.contractsConfigured) {
      this.ethProvider = new JsonRpcProvider(config.rpcUrl);
      this.registry = new Contract(config.registryAddress, REGISTRY_ABI, this.ethProvider);
      this.market = new Contract(config.marketAddress, MARKET_ABI, this.ethProvider);
      this.ledger = config.ledgerAddress 
        ? new Contract(config.ledgerAddress, LEDGER_ABI, this.ethProvider)
        : null;
      this.creditManager = config.creditManagerAddress
        ? new Contract(config.creditManagerAddress, CREDIT_MANAGER_ABI, this.ethProvider)
        : null;
    } else {
      this.ethProvider = null;
      this.registry = null;
      this.market = null;
      this.ledger = null;
      this.creditManager = null;
    }
    
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.use('/*', cors());

    // MCP Initialize
    this.app.post('/initialize', (c) => c.json({
      protocolVersion: '2024-11-05',
      serverInfo: MCP_SERVER_INFO,
      capabilities: MCP_SERVER_INFO.capabilities,
    }));

    // List resources
    this.app.post('/resources/list', (c) => c.json({ resources: MCP_RESOURCES }));

    // Read resource
    this.app.post('/resources/read', async (c) => {
      const { uri } = await c.req.json<{ uri: string }>();
      const contents = await this.readResource(uri);
      
      if (contents === null) {
        return c.json({ error: `Resource not found: ${uri}` }, 404);
      }

      return c.json({ 
        contents: [{ 
          uri, 
          mimeType: 'application/json', 
          text: JSON.stringify(contents, null, 2),
        }],
      });
    });

    // List tools
    this.app.post('/tools/list', (c) => c.json({ tools: MCP_TOOLS }));

    // Call tool (with x402 payment support)
    this.app.post('/tools/call', async (c) => {
      const { name, arguments: args } = await c.req.json<{ name: string; arguments: Record<string, unknown> }>();
      const userAddress = c.req.header('x-jeju-address');
      const paymentHeader = c.req.header('x-payment');

      const result = await this.callTool(name, args || {}, userAddress, paymentHeader);

      // Return 402 if payment required
      if (result.requiresPayment) {
        return c.json({
          error: {
            code: 402,
            message: 'Payment Required',
            data: result.requiresPayment,
          },
        }, 402);
      }

      return c.json(result);
    });

    // Discovery endpoint
    this.app.get('/', (c) => c.json({
      server: MCP_SERVER_INFO.name,
      version: MCP_SERVER_INFO.version,
      description: MCP_SERVER_INFO.description,
      capabilities: MCP_SERVER_INFO.capabilities,
      resources: MCP_RESOURCES.length,
      tools: MCP_TOOLS.length,
      authentication: {
        schemes: ['x402'],
        headers: ['x-payment', 'x-jeju-address'],
      },
    }));

    // Health
    this.app.get('/health', (c) => c.json({ 
      status: 'ok', 
      server: MCP_SERVER_INFO.name,
      version: MCP_SERVER_INFO.version,
    }));
  }

  // ============================================================================
  // Resource Handlers
  // ============================================================================

  private async readResource(uri: string): Promise<unknown | null> {
    switch (uri) {
      case 'storage://providers': {
        if (!this.registry) {
          return { error: 'Contracts not configured', providers: [], mode: 'basic' };
        }
        const addresses: string[] = await this.registry.getActiveProviders();
        const providers = [];
        for (const addr of addresses.slice(0, 50)) {
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
            capacity: {
              totalGB: Number(info.capacity.totalCapacityGB),
              availableGB: Number(info.capacity.availableCapacityGB),
            },
            pricing: { 
              pricePerGBMonth: formatEther(info.pricing.pricePerGBMonth),
              uploadPricePerGB: formatEther(info.pricing.uploadPricePerGB),
              retrievalPricePerGB: formatEther(info.pricing.retrievalPricePerGB),
            },
            supportedTiers: info.supportedTiers.map((t: number) => STORAGE_TIERS[t]),
            healthScore: Number(info.healthScore),
          });
        }
        return { totalProviders: addresses.length, activeProviders: providers.length, providers };
      }

      case 'storage://providers/verified': {
        if (!this.registry) {
          return { error: 'Contracts not configured', providers: [], mode: 'basic' };
        }
        const addresses: string[] = await this.registry.getAgentLinkedProviders();
        const providers = [];
        for (const addr of addresses) {
          const info = await this.registry.getProviderInfo(addr);
          if (!info.provider.active) continue;
          providers.push({
            address: addr,
            name: info.provider.name,
            agentId: Number(info.provider.agentId),
            type: PROVIDER_TYPES[Number(info.provider.providerType)],
            healthScore: Number(info.healthScore),
          });
        }
        return { verifiedProviders: providers.length, providers };
      }

      case 'storage://pricing': {
        return {
          tiers: STORAGE_TIERS,
          descriptions: {
            HOT: 'Fast access, higher cost - best for frequently accessed data',
            WARM: 'Balanced access and cost - default tier',
            COLD: 'Slow access, archival pricing - best for backups',
            PERMANENT: 'Arweave permanent storage - one-time payment, stored forever',
          },
          pricing: {
            HOT: { perGBMonth: formatEther(STORAGE_PRICING.HOT_TIER_PER_GB_MONTH), description: '~$0.30/GB/month' },
            WARM: { perGBMonth: formatEther(STORAGE_PRICING.WARM_TIER_PER_GB_MONTH), description: '~$0.15/GB/month' },
            COLD: { perGBMonth: formatEther(STORAGE_PRICING.COLD_TIER_PER_GB_MONTH), description: '~$0.03/GB/month' },
            PERMANENT: { oneTime: formatEther(STORAGE_PRICING.PERMANENT_PER_GB), description: '~$15/GB one-time' },
          },
          bandwidth: {
            upload: formatEther(STORAGE_PRICING.UPLOAD_PER_GB),
            retrieval: formatEther(STORAGE_PRICING.RETRIEVAL_PER_GB),
          },
          minimumFees: {
            upload: formatEther(STORAGE_PRICING.MIN_UPLOAD_FEE),
            pin: formatEther(STORAGE_PRICING.MIN_PIN_FEE),
          },
        };
      }

      case 'storage://deals/recent': {
        if (!this.registry || !this.market) {
          return { error: 'Contracts not configured', deals: [], mode: 'basic' };
        }
        const addresses: string[] = await this.registry.getActiveProviders();
        const allDeals = [];
        for (const addr of addresses.slice(0, 10)) {
          const dealIds: string[] = await this.market.getProviderDeals(addr);
          for (const id of dealIds.slice(-5)) {
            const deal = await this.market.getDeal(id);
            allDeals.push({
              dealId: id,
              provider: deal.provider,
              status: DEAL_STATUS[Number(deal.status)],
              cid: deal.cid,
              sizeGB: (Number(deal.sizeBytes) / (1024 ** 3)).toFixed(4),
              tier: STORAGE_TIERS[Number(deal.tier)],
              cost: formatEther(deal.totalCost),
            });
          }
        }
        return { totalDeals: allDeals.length, deals: allDeals.slice(-50) };
      }

      case 'storage://stats': {
        const dbStats = await db.getStorageStats();
        
        if (!this.registry) {
          return {
            mode: 'basic',
            marketplace: null,
            local: {
              totalPins: dbStats.totalPins,
              totalSizeGB: dbStats.totalSizeGB.toFixed(4),
            },
          };
        }
        
        const addresses: string[] = await this.registry.getActiveProviders();
        let activeCount = 0;
        let totalCapacity = 0;
        let usedCapacity = 0;
        for (const addr of addresses) {
          if (await this.registry.isActive(addr)) {
            activeCount++;
            const info = await this.registry.getProviderInfo(addr);
            totalCapacity += Number(info.capacity.totalCapacityGB);
            usedCapacity += Number(info.capacity.usedCapacityGB);
          }
        }
        
        return {
          mode: 'marketplace',
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
        };
      }

      case 'storage://pins': {
        const pins = await db.listPins({ limit: 50, offset: 0 });
        const count = await db.countPins();
        return {
          total: count,
          pins: pins.map(p => ({
            id: p.id,
            cid: p.cid,
            name: p.name,
            status: p.status,
            sizeBytes: p.sizeBytes,
          })),
        };
      }

      case 'storage://payment/options': {
        const paymentRecipient = (this.config.paymentRecipient || ZERO_ADDRESS) as `0x${string}`;
        return {
          x402: {
            enabled: true,
            recipient: paymentRecipient,
            schemes: ['exact', 'credit', 'paymaster'],
          },
          headers: {
            required: ['x-payment', 'x-jeju-address'],
            format: 'scheme=exact;network=jeju;payload=<signature>;amount=<wei>',
          },
          credits: {
            available: this.creditManager !== null,
            address: this.config.creditManagerAddress || null,
          },
          ledger: {
            available: this.ledger !== null,
            address: this.config.ledgerAddress || null,
          },
        };
      }

      default:
        return null;
    }
  }

  // ============================================================================
  // Tool Handlers
  // ============================================================================

  private async callTool(
    name: string, 
    args: Record<string, unknown>,
    userAddress?: string,
    paymentHeader?: string
  ): Promise<MCPToolResult> {
    const makeResult = (data: unknown, isError = false): MCPToolResult => ({
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      isError,
    });

    const paymentRecipient = (this.config.paymentRecipient || ZERO_ADDRESS) as `0x${string}`;

    switch (name) {
      // ========== Provider Discovery ==========
      case 'list_providers': {
        if (!this.registry) {
          return makeResult({ error: 'Contracts not configured - provider discovery unavailable', mode: 'basic' }, true);
        }
        const addresses: string[] = await this.registry.getActiveProviders();
        const limit = (args.limit as number) || 20;
        const providers = [];
        
        for (const addr of addresses.slice(0, 50)) {
          if (providers.length >= limit) break;
          const isActive = await this.registry.isActive(addr);
          if (!isActive) continue;
          
          const info = await this.registry.getProviderInfo(addr);
          const providerType = PROVIDER_TYPES[Number(info.provider.providerType)];
          
          if (args.providerType && providerType !== args.providerType) continue;
          if (args.minCapacityGB && Number(info.capacity.availableCapacityGB) < (args.minCapacityGB as number)) continue;
          if (args.tier) {
            const tierIndex = STORAGE_TIERS.indexOf(args.tier as string);
            if (!info.supportedTiers.includes(tierIndex)) continue;
          }
          
          providers.push({
            address: addr,
            name: info.provider.name,
            type: providerType,
            agentId: Number(info.provider.agentId) || null,
            verified: info.provider.verified,
            availableGB: Number(info.capacity.availableCapacityGB),
            pricePerGBMonth: formatEther(info.pricing.pricePerGBMonth),
            healthScore: Number(info.healthScore),
            supportedTiers: info.supportedTiers.map((t: number) => STORAGE_TIERS[t]),
          });
        }
        
        return makeResult({ total: providers.length, providers });
      }

      case 'get_provider': {
        if (!this.registry || !this.market) {
          return makeResult({ error: 'Contracts not configured', mode: 'basic' }, true);
        }
        const address = args.address as string;
        if (!address) return makeResult({ error: 'address required' }, true);
        
        const isActive = await this.registry.isActive(address);
        if (!isActive) return makeResult({ error: 'Provider not found or inactive' }, true);
        
        const info = await this.registry.getProviderInfo(address);
        const record = await this.market.getProviderRecord(address);
        const hasAgent = await this.registry.hasValidAgent(address);
        
        return makeResult({
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
        });
      }

      case 'list_verified_providers': {
        if (!this.registry) {
          return makeResult({ error: 'Contracts not configured', mode: 'basic' }, true);
        }
        const addresses: string[] = await this.registry.getAgentLinkedProviders();
        const providers = [];
        for (const addr of addresses) {
          const info = await this.registry.getProviderInfo(addr);
          if (!info.provider.active) continue;
          providers.push({
            address: addr,
            name: info.provider.name,
            agentId: Number(info.provider.agentId),
            type: PROVIDER_TYPES[Number(info.provider.providerType)],
            healthScore: Number(info.healthScore),
          });
        }
        return makeResult({ total: providers.length, providers });
      }

      case 'get_provider_by_agent': {
        if (!this.registry) {
          return makeResult({ error: 'Contracts not configured', mode: 'basic' }, true);
        }
        const agentId = args.agentId as number;
        if (!agentId) return makeResult({ error: 'agentId required' }, true);
        
        const address = await this.registry.getProviderByAgent(agentId);
        if (address === ZERO_ADDRESS) {
          return makeResult({ agentId, found: false, error: 'No provider found for agent' }, true);
        }
        
        // Recursively get full provider info
        return this.callTool('get_provider', { address }, userAddress, paymentHeader);
      }

      // ========== Pricing & Quotes ==========
      case 'calculate_cost': {
        const sizeBytes = args.sizeBytes as number;
        const durationDays = args.durationDays as number;
        const tier = ((args.tier as string) || 'warm').toLowerCase() as 'hot' | 'warm' | 'cold' | 'permanent';
        
        if (!sizeBytes || !durationDays) {
          return makeResult({ error: 'sizeBytes and durationDays required' }, true);
        }
        
        const cost = calculateStorageCost(sizeBytes, durationDays, tier);
        const sizeGB = sizeBytes / (1024 ** 3);
        
        return makeResult({
          sizeBytes,
          sizeGB: sizeGB.toFixed(4),
          durationDays,
          tier,
          costETH: formatEther(cost),
          costWei: cost.toString(),
          humanReadable: formatStorageCost(cost),
        });
      }

      case 'get_quote': {
        if (!this.registry || !this.market) {
          // Fall back to local pricing calculation
          const sizeBytes = args.sizeBytes as number;
          const durationDays = args.durationDays as number;
          const tier = ((args.tier as string) || 'warm').toLowerCase() as 'hot' | 'warm' | 'cold' | 'permanent';
          const cost = calculateStorageCost(sizeBytes, durationDays, tier);
          return makeResult({
            mode: 'basic',
            sizeBytes,
            durationDays,
            tier,
            costETH: formatEther(cost),
            costWei: cost.toString(),
            note: 'Using local pricing - contracts not configured',
          });
        }
        
        const sizeBytes = BigInt(args.sizeBytes as number);
        const durationDays = args.durationDays as number;
        const tier = STORAGE_TIERS.indexOf(((args.tier as string) || 'WARM').toUpperCase());

        if (args.provider) {
          const cost = await this.market.calculateDealCost(args.provider as string, sizeBytes, durationDays, tier >= 0 ? tier : 1);
          return makeResult({
            provider: args.provider,
            sizeBytes: sizeBytes.toString(),
            durationDays,
            tier: STORAGE_TIERS[tier >= 0 ? tier : 1],
            costETH: formatEther(cost),
            costWei: cost.toString(),
          });
        }

        // Find best quote
        const addresses: string[] = await this.registry.getActiveProviders();
        let bestQuote = { provider: '', cost: 0n, name: '' };
        for (const addr of addresses.slice(0, 10)) {
          const isActive = await this.registry.isActive(addr);
          if (!isActive) continue;
          const cost = await this.market.calculateDealCost(addr, sizeBytes, durationDays, tier >= 0 ? tier : 1);
          if (bestQuote.cost === 0n || cost < bestQuote.cost) {
            const info = await this.registry.getProviderInfo(addr);
            bestQuote = { provider: addr, cost, name: info.provider.name };
          }
        }
        
        if (!bestQuote.provider) {
          return makeResult({ error: 'No active providers found' }, true);
        }
        
        return makeResult({
          provider: bestQuote.provider,
          providerName: bestQuote.name,
          sizeBytes: sizeBytes.toString(),
          durationDays,
          tier: STORAGE_TIERS[tier >= 0 ? tier : 1],
          costETH: formatEther(bestQuote.cost),
          costWei: bestQuote.cost.toString(),
          note: 'Best available quote',
        });
      }

      // ========== Deal Management ==========
      case 'get_deal': {
        if (!this.market) {
          return makeResult({ error: 'Contracts not configured', mode: 'basic' }, true);
        }
        const dealId = args.dealId as string;
        if (!dealId) return makeResult({ error: 'dealId required' }, true);
        
        const deal = await this.market.getDeal(dealId);
        if (deal.dealId === '0x0000000000000000000000000000000000000000000000000000000000000000') {
          return makeResult({ error: 'Deal not found', dealId }, true);
        }
        
        const isActive = await this.market.isDealActive(dealId);
        
        return makeResult({
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
        });
      }

      case 'list_user_deals': {
        if (!this.market) {
          return makeResult({ error: 'Contracts not configured', mode: 'basic' }, true);
        }
        const address = args.address as string;
        const limit = (args.limit as number) || 20;
        if (!address) return makeResult({ error: 'address required' }, true);
        
        const dealIds: string[] = await this.market.getUserDeals(address);
        const deals = [];
        for (const id of dealIds.slice(-limit)) {
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
        
        return makeResult({ total: dealIds.length, deals: deals.reverse() });
      }

      // ========== File Operations ==========
      case 'get_gateway_url': {
        const cid = args.cid as string;
        if (!cid) return makeResult({ error: 'cid required' }, true);
        
        let gateway = 'https://ipfs.io';
        
        // Try to get provider gateway if contracts configured
        if (this.registry) {
          const addresses: string[] = await this.registry.getActiveProviders();
          for (const addr of addresses.slice(0, 5)) {
            const info = await this.registry.getProviderInfo(addr);
            if (info.ipfsGateway) {
              gateway = info.ipfsGateway;
              break;
            }
          }
        }
        
        return makeResult({
          cid,
          primary: `${gateway}/ipfs/${cid}`,
          alternatives: [
            `https://ipfs.io/ipfs/${cid}`,
            `https://cloudflare-ipfs.com/ipfs/${cid}`,
            `https://dweb.link/ipfs/${cid}`,
          ],
          local: `/ipfs/${cid}`,
        });
      }

      case 'list_pins': {
        const status = args.status as string;
        const limit = (args.limit as number) || 20;
        
        const pins = await db.listPins({ status, limit, offset: 0 });
        const count = await db.countPins();
        
        return makeResult({
          total: count,
          pins: pins.map(p => ({
            id: p.id,
            cid: p.cid,
            name: p.name,
            status: p.status,
            sizeBytes: p.sizeBytes,
          })),
        });
      }

      // ========== Payment Tools ==========
      case 'check_credits': {
        const address = args.address as string;
        if (!address) return makeResult({ error: 'address required' }, true);
        if (!this.creditManager) return makeResult({ error: 'Credit system not configured' }, true);
        
        const [usdcBalance, elizaBalance, ethBalance] = await this.creditManager.getAllBalances(address);
        
        return makeResult({
          address,
          balances: {
            eth: formatEther(ethBalance),
            ethWei: ethBalance.toString(),
            usdc: (Number(usdcBalance) / 1e6).toFixed(2),
            elizaOS: formatEther(elizaBalance),
          },
        });
      }

      case 'check_ledger': {
        const address = args.address as string;
        if (!address) return makeResult({ error: 'address required' }, true);
        if (!this.ledger) return makeResult({ error: 'Ledger system not configured' }, true);
        
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
        
        if (args.provider) {
          const subAccount = await this.ledger.getSubAccount(address, args.provider as string);
          result.subAccount = {
            provider: args.provider,
            balance: formatEther(subAccount.balance),
            pendingRefund: formatEther(subAccount.pendingRefund),
            acknowledged: subAccount.acknowledged,
          };
        }
        
        return makeResult(result);
      }

      case 'get_payment_options': {
        const amount = BigInt(args.amountWei as string || '0');
        const resource = (args.resource as string) || '/storage';
        
        const requirement = createStoragePaymentRequirement(
          resource,
          amount,
          paymentRecipient,
          `Storage payment: ${formatEther(amount)} ETH`
        );
        
        return makeResult({
          amountWei: amount.toString(),
          amountETH: formatEther(amount),
          requirement,
          headers: {
            'x-payment': 'scheme=exact;network=jeju;payload=<signature>;amount=<wei>',
            'x-jeju-address': '<your-wallet-address>',
          },
        });
      }

      case 'get_reputation': {
        if (!this.market) {
          return makeResult({ error: 'Contracts not configured', mode: 'basic' }, true);
        }
        const address = args.address as string;
        const type = args.type as 'provider' | 'user';
        if (!address || !type) return makeResult({ error: 'address and type required' }, true);
        
        if (type === 'provider') {
          const record = await this.market.getProviderRecord(address);
          return makeResult({
            address,
            type: 'provider',
            avgRating: Number(record.ratingCount) > 0 ? (Number(record.avgRating) / 100).toFixed(2) : 'N/A',
            ratingCount: Number(record.ratingCount),
            totalDeals: Number(record.totalDeals),
            activeDeals: Number(record.activeDeals),
            completedDeals: Number(record.completedDeals),
            failedDeals: Number(record.failedDeals),
            totalStoredGB: Number(record.totalStoredGB),
            totalEarningsETH: formatEther(record.totalEarnings),
            uptimePercent: Number(record.uptimePercent),
            banned: record.banned,
          });
        } else {
          const record = await this.market.getUserRecord(address);
          return makeResult({
            address,
            type: 'user',
            totalDeals: Number(record.totalDeals),
            activeDeals: Number(record.activeDeals),
            completedDeals: Number(record.completedDeals),
            disputedDeals: Number(record.disputedDeals),
            totalStoredGB: Number(record.totalStoredGB),
            totalSpentETH: formatEther(record.totalSpent),
            banned: record.banned,
          });
        }
      }

      // ========== PAID TOOLS (require x402) ==========
      case 'upload_file': {
        const sizeBytes = (args.sizeBytes as number) || 1024 * 1024;
        const durationDays = (args.durationDays as number) || 30;
        const tier = ((args.tier as string) || 'warm').toLowerCase() as 'hot' | 'warm' | 'cold' | 'permanent';
        
        const cost = calculateStorageCost(sizeBytes, durationDays, tier);
        
        if (!paymentHeader) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ 
              message: 'Payment required for upload',
              estimatedCostWei: cost.toString(),
              estimatedCostETH: formatEther(cost),
            }, null, 2) }],
            requiresPayment: createStoragePaymentRequirement(
              '/mcp/upload_file',
              cost,
              paymentRecipient,
              `Upload file: ${(sizeBytes / (1024 * 1024)).toFixed(2)} MB for ${durationDays} days`
            ),
          };
        }
        
        return makeResult({
          message: 'Payment verified. Submit file to POST /upload endpoint',
          endpoint: '/upload',
          method: 'POST',
          headers: {
            'X-Payment': paymentHeader,
            'x-jeju-address': userAddress || '',
            'Content-Type': 'multipart/form-data',
          },
          estimatedCostETH: formatEther(cost),
        });
      }

      case 'pin_cid': {
        const cid = args.cid as string;
        if (!cid) return makeResult({ error: 'cid required' }, true);
        
        const sizeBytes = (args.sizeBytes as number) || 1024 * 1024;
        const durationDays = (args.durationDays as number) || 30;
        const cost = calculateStorageCost(sizeBytes, durationDays, 'warm');
        
        if (!paymentHeader) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ 
              message: 'Payment required for pinning',
              cid,
              estimatedCostWei: cost.toString(),
            }, null, 2) }],
            requiresPayment: createStoragePaymentRequirement(
              '/mcp/pin_cid',
              cost,
              paymentRecipient,
              `Pin CID: ${cid} for ${durationDays} days`
            ),
          };
        }
        
        return makeResult({
          message: 'Payment verified. Submit pin request',
          endpoint: '/pins',
          method: 'POST',
          body: { cid, name: args.name || cid },
          headers: { 'X-Payment': paymentHeader, 'x-jeju-address': userAddress || '' },
        });
      }

      case 'create_deal': {
        if (!this.market) {
          return makeResult({ error: 'Contracts not configured - deals unavailable', mode: 'basic' }, true);
        }
        const provider = args.provider as string;
        const cid = args.cid as string;
        const sizeBytes = BigInt(args.sizeBytes as number);
        const durationDays = args.durationDays as number;
        const tier = STORAGE_TIERS.indexOf(((args.tier as string) || 'WARM').toUpperCase());
        const replicationFactor = (args.replicationFactor as number) || 1;
        
        if (!provider || !cid || !sizeBytes || !durationDays) {
          return makeResult({ error: 'provider, cid, sizeBytes, durationDays required' }, true);
        }
        
        const cost = await this.market.calculateDealCost(provider, sizeBytes, durationDays, tier >= 0 ? tier : 1);
        
        if (!paymentHeader) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ 
              message: 'Payment required to create deal',
              provider,
              cid,
              costWei: cost.toString(),
              costETH: formatEther(cost),
            }, null, 2) }],
            requiresPayment: createStoragePaymentRequirement(
              '/mcp/create_deal',
              cost,
              provider as `0x${string}`,
              `Storage deal: ${cid} for ${durationDays} days`
            ),
          };
        }
        
        return makeResult({
          message: 'Payment verified. Call createDeal on-chain',
          contract: this.config.marketAddress,
          method: 'createDeal',
          args: { provider, cid, sizeBytes: sizeBytes.toString(), durationDays, tier: tier >= 0 ? tier : 1, replicationFactor },
          costWei: cost.toString(),
          costETH: formatEther(cost),
        });
      }

      case 'extend_deal': {
        if (!this.market) {
          return makeResult({ error: 'Contracts not configured', mode: 'basic' }, true);
        }
        const dealId = args.dealId as string;
        const additionalDays = args.additionalDays as number;
        
        if (!dealId || !additionalDays) {
          return makeResult({ error: 'dealId and additionalDays required' }, true);
        }
        
        const deal = await this.market.getDeal(dealId);
        const cost = await this.market.calculateDealCost(deal.provider, deal.sizeBytes, additionalDays, Number(deal.tier));
        
        if (!paymentHeader) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ 
              message: 'Payment required to extend deal',
              dealId,
              additionalDays,
              costWei: cost.toString(),
            }, null, 2) }],
            requiresPayment: createStoragePaymentRequirement(
              '/mcp/extend_deal',
              cost,
              deal.provider as `0x${string}`,
              `Extend deal ${dealId.slice(0, 10)}... by ${additionalDays} days`
            ),
          };
        }
        
        return makeResult({
          message: 'Payment verified. Call extendDeal on-chain',
          contract: this.config.marketAddress,
          method: 'extendDeal',
          args: { dealId, additionalDays },
          costWei: cost.toString(),
        });
      }

      case 'terminate_deal': {
        const dealId = args.dealId as string;
        if (!dealId) return makeResult({ error: 'dealId required' }, true);
        
        return makeResult({
          message: 'Call terminateDeal on-chain',
          contract: this.config.marketAddress,
          method: 'terminateDeal',
          args: { dealId },
          note: 'Early termination may result in partial refund',
        });
      }

      case 'rate_deal': {
        const dealId = args.dealId as string;
        const score = args.score as number;
        const comment = (args.comment as string) || '';
        
        if (!dealId || !score) return makeResult({ error: 'dealId and score required' }, true);
        if (score < 1 || score > 100) return makeResult({ error: 'score must be 1-100' }, true);
        
        return makeResult({
          message: 'Call rateDeal on-chain',
          contract: this.config.marketAddress,
          method: 'rateDeal',
          args: { dealId, score, comment },
        });
      }

      default:
        return makeResult({ error: `Tool not found: ${name}` }, true);
    }
  }

  getRouter(): Hono {
    return this.app;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createStorageMCPServer(config: MCPConfig): StorageMCPServer {
  return new StorageMCPServer(config);
}

export function createMCPRouter(config: MCPConfig): Hono {
  return new StorageMCPServer(config).getRouter();
}
