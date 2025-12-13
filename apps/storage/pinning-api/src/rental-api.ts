/**
 * Infrastructure Rental API - Decentralized infrastructure (DB, cache, storage, compute) with x402.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

export type ResourceType = 'database' | 'cache' | 'storage' | 'compute';
export type ResourceTier = 'free' | 'basic' | 'pro' | 'enterprise';
export type RentalStatus = 'pending' | 'active' | 'suspended' | 'terminated';

export interface ResourceConfig {
  type: ResourceType;
  tier: ResourceTier;
  /** CPU cores for compute, replicas for DB */
  units: number;
  /** Memory in GB */
  memoryGb: number;
  /** Storage in GB */
  storageGb: number;
  /** Region preference */
  region?: string;
  /** High availability mode */
  highAvailability?: boolean;
}

export interface Rental {
  id: string;
  owner: string;
  resource: ResourceConfig;
  status: RentalStatus;
  endpoint?: string;
  credentials?: {
    host: string;
    port: number;
    username?: string;
    password?: string;
    database?: string;
  };
  createdAt: number;
  expiresAt: number;
  lastPaymentAt: number;
  totalPaid: bigint;
}

export interface RentalPricing {
  type: ResourceType;
  tier: ResourceTier;
  hourlyRate: string;
  dailyRate: string;
  monthlyRate: string;
  setupFee: string;
}

export const RENTAL_AGENT_CARD = {
  protocolVersion: '0.3.0',
  name: 'Jeju Infrastructure Rental',
  description: 'Decentralized infrastructure rental for databases, caches, storage, and compute',
  url: '/rental/a2a',
  preferredTransport: 'http',
  provider: { organization: 'Jeju Network', url: 'https://jeju.network' },
  version: '1.0.0',
  capabilities: { streaming: false, pushNotifications: true, stateTransitionHistory: true },
  defaultInputModes: ['text', 'data'],
  defaultOutputModes: ['text', 'data'],
  skills: [
    // Query Skills
    { id: 'list-resources', name: 'List Resources', description: 'List available resource types', tags: ['query', 'resources'] },
    { id: 'get-pricing', name: 'Get Pricing', description: 'Get pricing for resources', tags: ['query', 'pricing'] },
    { id: 'list-rentals', name: 'List Rentals', description: 'List active rentals for an account', tags: ['query', 'rentals'] },
    { id: 'get-rental', name: 'Get Rental', description: 'Get rental details', tags: ['query', 'rental'] },
    
    // Action Skills
    { id: 'create-rental', name: 'Create Rental', description: 'Create a new resource rental', tags: ['action', 'create'] },
    { id: 'extend-rental', name: 'Extend Rental', description: 'Extend rental period', tags: ['action', 'extend'] },
    { id: 'upgrade-rental', name: 'Upgrade Rental', description: 'Upgrade to higher tier', tags: ['action', 'upgrade'] },
    { id: 'terminate-rental', name: 'Terminate Rental', description: 'Terminate a rental', tags: ['action', 'terminate'] },
    
    // Database Skills
    { id: 'create-database', name: 'Create Database', description: 'Create a CovenantSQL database', tags: ['action', 'database'] },
    { id: 'get-database-stats', name: 'Get Database Stats', description: 'Get database usage statistics', tags: ['query', 'database'] },
    
    // Cache Skills
    { id: 'create-cache', name: 'Create Cache', description: 'Create a Redis-compatible cache', tags: ['action', 'cache'] },
    { id: 'flush-cache', name: 'Flush Cache', description: 'Flush all cache data', tags: ['action', 'cache'] },
    
    // Account Skills
    { id: 'get-balance', name: 'Get Balance', description: 'Get account balance', tags: ['query', 'account'] },
    { id: 'topup', name: 'Top Up', description: 'Add funds to account', tags: ['action', 'payment'] },
  ],
};

const PRICING: RentalPricing[] = [
  // Database pricing
  { type: 'database', tier: 'free', hourlyRate: '0', dailyRate: '0', monthlyRate: '0', setupFee: '0' },
  { type: 'database', tier: 'basic', hourlyRate: '0.01', dailyRate: '0.20', monthlyRate: '5', setupFee: '0' },
  { type: 'database', tier: 'pro', hourlyRate: '0.05', dailyRate: '1.00', monthlyRate: '25', setupFee: '0' },
  { type: 'database', tier: 'enterprise', hourlyRate: '0.20', dailyRate: '4.00', monthlyRate: '100', setupFee: '50' },
  
  // Cache pricing
  { type: 'cache', tier: 'free', hourlyRate: '0', dailyRate: '0', monthlyRate: '0', setupFee: '0' },
  { type: 'cache', tier: 'basic', hourlyRate: '0.005', dailyRate: '0.10', monthlyRate: '2.50', setupFee: '0' },
  { type: 'cache', tier: 'pro', hourlyRate: '0.02', dailyRate: '0.40', monthlyRate: '10', setupFee: '0' },
  { type: 'cache', tier: 'enterprise', hourlyRate: '0.10', dailyRate: '2.00', monthlyRate: '50', setupFee: '25' },
  
  // Storage pricing
  { type: 'storage', tier: 'free', hourlyRate: '0', dailyRate: '0', monthlyRate: '0', setupFee: '0' },
  { type: 'storage', tier: 'basic', hourlyRate: '0.002', dailyRate: '0.05', monthlyRate: '1', setupFee: '0' },
  { type: 'storage', tier: 'pro', hourlyRate: '0.01', dailyRate: '0.20', monthlyRate: '5', setupFee: '0' },
  { type: 'storage', tier: 'enterprise', hourlyRate: '0.05', dailyRate: '1.00', monthlyRate: '25', setupFee: '10' },
  
  // Compute pricing
  { type: 'compute', tier: 'free', hourlyRate: '0', dailyRate: '0', monthlyRate: '0', setupFee: '0' },
  { type: 'compute', tier: 'basic', hourlyRate: '0.02', dailyRate: '0.40', monthlyRate: '10', setupFee: '0' },
  { type: 'compute', tier: 'pro', hourlyRate: '0.10', dailyRate: '2.00', monthlyRate: '50', setupFee: '0' },
  { type: 'compute', tier: 'enterprise', hourlyRate: '0.50', dailyRate: '10.00', monthlyRate: '250', setupFee: '100' },
];

const rentals: Map<string, Rental> = new Map();
const accountBalances: Map<string, bigint> = new Map();

export function createRentalRouter(): Hono {
  const app = new Hono();
  app.use('/*', cors());

  app.get('/resources', (c) => {
    return c.json({
      types: ['database', 'cache', 'storage', 'compute'],
      tiers: ['free', 'basic', 'pro', 'enterprise'],
      pricing: PRICING,
    });
  });

  // Get pricing for specific resource
  app.get('/pricing/:type/:tier', (c) => {
    const type = c.req.param('type') as ResourceType;
    const tier = c.req.param('tier') as ResourceTier;
    
    const pricing = PRICING.find(p => p.type === type && p.tier === tier);
    if (!pricing) {
      return c.json({ error: 'Invalid resource type or tier' }, 400);
    }
    
    return c.json(pricing);
  });

  // List rentals for account
  app.get('/rentals', (c) => {
    const owner = c.req.header('X-Account-Address');
    if (!owner) {
      return c.json({ error: 'X-Account-Address header required' }, 401);
    }

    const accountRentals = Array.from(rentals.values())
      .filter(r => r.owner === owner)
      .map(r => ({
        ...r,
        totalPaid: r.totalPaid.toString(),
      }));

    return c.json({ rentals: accountRentals });
  });

  // Get specific rental
  app.get('/rentals/:id', (c) => {
    const id = c.req.param('id');
    const rental = rentals.get(id);
    
    if (!rental) {
      return c.json({ error: 'Rental not found' }, 404);
    }

    return c.json({
      ...rental,
      totalPaid: rental.totalPaid.toString(),
    });
  });

  // Create new rental
  app.post('/rentals', async (c) => {
    const owner = c.req.header('X-Account-Address');
    if (!owner) {
      return c.json({ error: 'X-Account-Address header required' }, 401);
    }

    const body = await c.req.json<{
      type: ResourceType;
      tier: ResourceTier;
      units?: number;
      memoryGb?: number;
      storageGb?: number;
      durationHours?: number;
    }>();

    const pricing = PRICING.find(p => p.type === body.type && p.tier === body.tier);
    if (!pricing) {
      return c.json({ error: 'Invalid resource type or tier' }, 400);
    }

    const durationHours = body.durationHours ?? 24;
    const cost = BigInt(Math.ceil(parseFloat(pricing.hourlyRate) * durationHours * 1e6));
    const balance = accountBalances.get(owner) ?? 0n;

    if (body.tier !== 'free' && balance < cost) {
      return c.json({
        error: 'Insufficient balance',
        required: cost.toString(),
        balance: balance.toString(),
      }, 402);
    }

    const id = crypto.randomUUID();
    const now = Date.now();

    const rental: Rental = {
      id,
      owner,
      resource: {
        type: body.type,
        tier: body.tier,
        units: body.units ?? 1,
        memoryGb: body.memoryGb ?? (body.tier === 'free' ? 0.5 : body.tier === 'basic' ? 1 : body.tier === 'pro' ? 4 : 16),
        storageGb: body.storageGb ?? (body.tier === 'free' ? 1 : body.tier === 'basic' ? 10 : body.tier === 'pro' ? 100 : 1000),
      },
      status: 'active',
      endpoint: generateEndpoint(body.type, id),
      credentials: generateCredentials(body.type, id),
      createdAt: now,
      expiresAt: now + durationHours * 60 * 60 * 1000,
      lastPaymentAt: now,
      totalPaid: cost,
    };

    rentals.set(id, rental);
    
    if (body.tier !== 'free') {
      accountBalances.set(owner, balance - cost);
    }

    return c.json({
      ...rental,
      totalPaid: rental.totalPaid.toString(),
    }, 201);
  });

  // Extend rental
  app.post('/rentals/:id/extend', async (c) => {
    const id = c.req.param('id');
    const owner = c.req.header('X-Account-Address');
    
    const rental = rentals.get(id);
    if (!rental) {
      return c.json({ error: 'Rental not found' }, 404);
    }
    if (rental.owner !== owner) {
      return c.json({ error: 'Not authorized' }, 403);
    }

    const body = await c.req.json<{ durationHours: number }>();
    const pricing = PRICING.find(p => p.type === rental.resource.type && p.tier === rental.resource.tier);
    
    if (!pricing) {
      return c.json({ error: 'Pricing not found' }, 500);
    }

    const cost = BigInt(Math.ceil(parseFloat(pricing.hourlyRate) * body.durationHours * 1e6));
    const balance = accountBalances.get(owner) ?? 0n;

    if (rental.resource.tier !== 'free' && balance < cost) {
      return c.json({ error: 'Insufficient balance' }, 402);
    }

    rental.expiresAt += body.durationHours * 60 * 60 * 1000;
    rental.lastPaymentAt = Date.now();
    rental.totalPaid += cost;

    if (rental.resource.tier !== 'free') {
      accountBalances.set(owner, balance - cost);
    }

    return c.json({
      ...rental,
      totalPaid: rental.totalPaid.toString(),
    });
  });

  // Terminate rental
  app.delete('/rentals/:id', (c) => {
    const id = c.req.param('id');
    const owner = c.req.header('X-Account-Address');
    
    const rental = rentals.get(id);
    if (!rental) {
      return c.json({ error: 'Rental not found' }, 404);
    }
    if (rental.owner !== owner) {
      return c.json({ error: 'Not authorized' }, 403);
    }

    rental.status = 'terminated';
    return c.json({ success: true, rental: { ...rental, totalPaid: rental.totalPaid.toString() } });
  });

  // Account balance
  app.get('/account/balance', (c) => {
    const owner = c.req.header('X-Account-Address');
    if (!owner) {
      return c.json({ error: 'X-Account-Address header required' }, 401);
    }

    const balance = accountBalances.get(owner) ?? 0n;
    return c.json({ address: owner, balance: balance.toString() });
  });

  // Top up account (in production, verify on-chain payment)
  app.post('/account/topup', async (c) => {
    const owner = c.req.header('X-Account-Address');
    if (!owner) {
      return c.json({ error: 'X-Account-Address header required' }, 401);
    }

    const body = await c.req.json<{ amount: string; txHash: string }>();
    const amount = BigInt(body.amount);
    const currentBalance = accountBalances.get(owner) ?? 0n;
    
    accountBalances.set(owner, currentBalance + amount);

    return c.json({
      address: owner,
      added: amount.toString(),
      newBalance: (currentBalance + amount).toString(),
      txHash: body.txHash,
    });
  });

  app.get('/a2a/.well-known/agent-card.json', (c) => c.json(RENTAL_AGENT_CARD));

  app.post('/a2a', async (c) => {
    const body = await c.req.json() as {
      jsonrpc: string;
      id: number | string;
      method: string;
      params?: {
        message?: {
          messageId: string;
          parts: Array<{ kind: string; data?: Record<string, unknown> }>;
        };
      };
    };

    if (body.method !== 'message/send') {
      return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Method not found' } });
    }

    const dataPart = body.params?.message?.parts?.find(p => p.kind === 'data');
    const skillId = dataPart?.data?.skillId as string;
    const result = await executeSkill(skillId, dataPart?.data ?? {});

    return c.json({
      jsonrpc: '2.0',
      id: body.id,
      result: {
        role: 'agent',
        parts: [
          { kind: 'text', text: result.message },
          { kind: 'data', data: result.data },
        ],
        messageId: body.params?.message?.messageId,
        kind: 'message',
      },
    });
  });

  app.post('/mcp/initialize', (c) => {
    return c.json({
      protocolVersion: '2024-11-05',
      serverInfo: {
        name: 'jeju-infrastructure-rental',
        version: '1.0.0',
        description: 'Decentralized infrastructure rental service',
      },
      capabilities: { resources: true, tools: true, prompts: false },
    });
  });

  app.post('/mcp/resources/list', (c) => {
    return c.json({
      resources: [
        { uri: 'rental://pricing', name: 'Pricing', description: 'Resource pricing', mimeType: 'application/json' },
        { uri: 'rental://rentals', name: 'Rentals', description: 'Active rentals', mimeType: 'application/json' },
        { uri: 'rental://balance', name: 'Balance', description: 'Account balance', mimeType: 'application/json' },
      ],
    });
  });

  app.post('/mcp/resources/read', async (c) => {
    const { uri } = await c.req.json() as { uri: string };
    let contents: unknown = {};

    switch (uri) {
      case 'rental://pricing':
        contents = { pricing: PRICING };
        break;
      case 'rental://rentals':
        contents = { rentals: Array.from(rentals.values()).map(r => ({ ...r, totalPaid: r.totalPaid.toString() })) };
        break;
      default:
        return c.json({ error: 'Resource not found' }, 404);
    }

    return c.json({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(contents) }] });
  });

  app.post('/mcp/tools/list', (c) => {
    return c.json({
      tools: [
        {
          name: 'create_rental',
          description: 'Create a new infrastructure rental',
          inputSchema: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['database', 'cache', 'storage', 'compute'] },
              tier: { type: 'string', enum: ['free', 'basic', 'pro', 'enterprise'] },
              durationHours: { type: 'number' },
            },
            required: ['type', 'tier'],
          },
        },
        {
          name: 'extend_rental',
          description: 'Extend an existing rental',
          inputSchema: {
            type: 'object',
            properties: {
              rentalId: { type: 'string' },
              durationHours: { type: 'number' },
            },
            required: ['rentalId', 'durationHours'],
          },
        },
        {
          name: 'get_balance',
          description: 'Get account balance',
          inputSchema: { type: 'object', properties: { address: { type: 'string' } }, required: ['address'] },
        },
      ],
    });
  });

  app.post('/mcp/tools/call', async (c) => {
    const { name, arguments: args } = await c.req.json() as { name: string; arguments: Record<string, unknown> };
    let result: unknown = {};

    switch (name) {
      case 'create_rental':
        result = {
          rentalId: crypto.randomUUID(),
          type: args.type,
          tier: args.tier,
          status: 'active',
        };
        break;
      case 'extend_rental':
        result = { success: true, rentalId: args.rentalId };
        break;
      case 'get_balance':
        result = { address: args.address, balance: (accountBalances.get(args.address as string) ?? 0n).toString() };
        break;
      default:
        return c.json({ content: [{ type: 'text', text: 'Tool not found' }], isError: true });
    }

    return c.json({ content: [{ type: 'text', text: JSON.stringify(result) }], isError: false });
  });

  // Health check
  app.get('/health', (c) => {
    return c.json({
      status: 'healthy',
      service: 'jeju-infrastructure-rental',
      version: '1.0.0',
      activeRentals: rentals.size,
    });
  });

  // Root info
  app.get('/', (c) => {
    return c.json({
      name: 'Jeju Infrastructure Rental',
      version: '1.0.0',
      endpoints: {
        rest: '/rental',
        a2a: '/rental/a2a',
        mcp: '/rental/mcp',
        health: '/rental/health',
      },
    });
  });

  return app;
}

function generateEndpoint(type: ResourceType, id: string): string {
  const shortId = id.slice(0, 8);
  switch (type) {
    case 'database':
      return `cql-${shortId}.jeju.network:4661`;
    case 'cache':
      return `cache-${shortId}.jeju.network:6379`;
    case 'storage':
      return `storage-${shortId}.jeju.network:5001`;
    case 'compute':
      return `compute-${shortId}.jeju.network:8080`;
  }
}

function generateCredentials(type: ResourceType, id: string): Rental['credentials'] {
  const shortId = id.slice(0, 8);
  switch (type) {
    case 'database':
      return {
        host: `cql-${shortId}.jeju.network`,
        port: 4661,
        database: `db_${shortId}`,
      };
    case 'cache':
      return {
        host: `cache-${shortId}.jeju.network`,
        port: 6379,
        password: crypto.randomUUID().replace(/-/g, ''),
      };
    default:
      return {
        host: `${type}-${shortId}.jeju.network`,
        port: 8080,
      };
  }
}

async function executeSkill(skillId: string, params: Record<string, unknown>): Promise<{ message: string; data: Record<string, unknown> }> {
  switch (skillId) {
    case 'list-resources':
      return {
        message: 'Available resources',
        data: {
          types: ['database', 'cache', 'storage', 'compute'],
          tiers: ['free', 'basic', 'pro', 'enterprise'],
        },
      };
    case 'get-pricing':
      return {
        message: 'Resource pricing',
        data: { pricing: PRICING },
      };
    case 'list-rentals':
      return {
        message: 'Active rentals',
        data: { rentals: Array.from(rentals.values()).map(r => ({ ...r, totalPaid: r.totalPaid.toString() })) },
      };
    case 'create-rental':
      return {
        message: 'Rental created',
        data: { rentalId: crypto.randomUUID(), type: params.type, tier: params.tier },
      };
    case 'get-balance':
      return {
        message: 'Account balance',
        data: { address: params.address, balance: (accountBalances.get(params.address as string) ?? 0n).toString() },
      };
    default:
      return { message: 'Unknown skill', data: { error: 'Skill not found' } };
  }
}
