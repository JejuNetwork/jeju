/**
 * A2A Server for Compute Marketplace
 * Agent-to-agent communication for decentralized compute rentals
 * 
 * Supports ALL compute types:
 * - GPU/CPU Rentals (hourly, SSH/Docker)
 * - Inference (LLM, Image, Video, Audio, Embedding, Multimodal)
 * - Triggers (Cron, Webhook, Event - serverless workers)
 * - Reputation & Moderation via ERC-8004
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Contract, JsonRpcProvider, formatEther, parseEther } from 'ethers';

// ============================================================================
// Types
// ============================================================================

interface A2AConfig {
  rpcUrl: string;
  registryAddress: string;
  rentalAddress: string;
  inferenceAddress: string;
  ledgerAddress: string;
  triggerRegistryAddress?: string;
  banManagerAddress?: string;
  privateKey?: string;
  paymentRecipient?: string;
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

interface PaymentRequirement {
  x402Version: number;
  error: string;
  accepts: Array<{
    scheme: string;
    network: string;
    maxAmountRequired: string;
    asset: string;
    payTo: string;
    resource: string;
    description: string;
  }>;
}

interface SkillResult {
  message: string;
  data: Record<string, unknown>;
  requiresPayment?: PaymentRequirement;
}

// Contract ABIs
const REGISTRY_ABI = [
  'function getAllProviders() view returns (address[])',
  'function getProvider(address) view returns (tuple(string name, string endpoint, uint256 stake, bool active, uint256 registeredAt, uint256 agentId))',
  'function isActive(address) view returns (bool)',
];

const RENTAL_ABI = [
  'function getProviderResources(address) view returns (tuple(tuple(uint256 cpuCores, uint256 memoryGb, uint256 storageGb, uint256 bandwidthMbps, uint8 gpuType, uint256 gpuCount, uint256 gpuMemoryGb, bool teeSupported) resources, tuple(uint256 pricePerHour, uint256 minimumRentalHours, uint256 maximumRentalHours, uint256 depositRequired) pricing, uint256 activeRentals, uint256 maxConcurrentRentals, bool available, bool sshEnabled, bool dockerEnabled))',
  'function calculateRentalCost(address provider, uint256 durationHours) view returns (uint256)',
  'function getPaymentRequirement(address provider, uint256 durationHours) view returns (uint256 cost, address asset, address payTo, string network, string description)',
  'function getRental(bytes32 rentalId) view returns (tuple(bytes32 rentalId, address user, address provider, uint8 status, uint256 startTime, uint256 endTime, uint256 totalCost, uint256 paidAmount, uint256 refundedAmount, string sshPublicKey, string containerImage, string startupScript, string sshHost, uint16 sshPort))',
  'function getUserRentals(address user) view returns (bytes32[])',
  'function getUserRecord(address user) view returns (tuple(uint256 totalRentals, uint256 completedRentals, uint256 cancelledRentals, uint256 disputesInitiated, uint256 disputesLost, uint256 abuseReports, bool banned))',
  'function getProviderRecord(address provider) view returns (tuple(uint256 totalRentals, uint256 completedRentals, uint256 cancelledRentals, uint256 disputesReceived, uint256 disputesLost, uint256 totalRatingScore, uint256 ratingCount, uint256 slashedAmount, bool banned))',
];

const INFERENCE_ABI = [
  'function getServices(address provider) view returns (tuple(address provider, string model, string endpoint, uint256 pricePerInputToken, uint256 pricePerOutputToken, bool active)[])',
];

const GPU_TYPES = ['NONE', 'NVIDIA_RTX_4090', 'NVIDIA_A100_40GB', 'NVIDIA_A100_80GB', 'NVIDIA_H100', 'NVIDIA_H200', 'AMD_MI300X', 'APPLE_M1_MAX', 'APPLE_M2_ULTRA', 'APPLE_M3_MAX'];
const RENTAL_STATUS = ['PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'DISPUTED'];

// Trigger Registry ABI
const TRIGGER_REGISTRY_ABI = [
  'function getTrigger(bytes32 triggerId) view returns (address owner, uint8 triggerType, string name, string endpoint, bool active, uint256 executionCount, uint256 lastExecutedAt, uint256 agentId)',
  'function getActiveTriggers(uint8 triggerType) view returns (bytes32[])',
  'function getOwnerTriggers(address owner) view returns (bytes32[])',
  'function prepaidBalances(address) view returns (uint256)',
  'function getTriggerCount() view returns (uint256)',
];

// Ban Manager ABI
const BAN_MANAGER_ABI = [
  'function isNetworkBanned(uint256 agentId) view returns (bool)',
  'function getNetworkBan(uint256 agentId) view returns (tuple(bool isBanned, uint256 bannedAt, string reason, bytes32 proposalId))',
];

// ============================================================================
// A2A Server
// ============================================================================

export class ComputeA2AServer {
  private app: Hono;
  private provider: JsonRpcProvider;
  private registry: Contract;
  private rental: Contract;
  private inferenceContract: Contract;
  private triggerRegistry: Contract | null;
  private banManager: Contract | null;
  private config: A2AConfig;

  constructor(config: A2AConfig) {
    this.config = config;
    this.app = new Hono();
    this.provider = new JsonRpcProvider(config.rpcUrl);
    this.registry = new Contract(config.registryAddress, REGISTRY_ABI, this.provider);
    this.rental = new Contract(config.rentalAddress, RENTAL_ABI, this.provider);
    this.inferenceContract = new Contract(config.inferenceAddress, INFERENCE_ABI, this.provider);
    this.triggerRegistry = config.triggerRegistryAddress 
      ? new Contract(config.triggerRegistryAddress, TRIGGER_REGISTRY_ABI, this.provider)
      : null;
    this.banManager = config.banManagerAddress
      ? new Contract(config.banManagerAddress, BAN_MANAGER_ABI, this.provider)
      : null;
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
      const params = (dataPart.data.params as Record<string, unknown>) || {};
      const paymentHeader = c.req.header('x-payment');

      if (!skillId) {
        return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'No skillId specified' } });
      }

      const result = await this.executeSkill(skillId, params, paymentHeader);

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

    this.app.get('/health', (c) => c.json({ status: 'ok', service: 'compute-a2a' }));
  }

  private getAgentCard(): Record<string, unknown> {
    return {
      protocolVersion: '0.3.0',
      name: 'Jeju Compute Marketplace',
      description: 'Decentralized compute marketplace - rent GPUs, CPUs, TEE resources, serverless triggers, and AI inference',
      url: '/a2a',
      preferredTransport: 'http',
      provider: { organization: 'Jeju Network', url: 'https://jeju.network' },
      version: '1.0.0',
      capabilities: { streaming: true, pushNotifications: false, stateTransitionHistory: true },
      defaultInputModes: ['text', 'data'],
      defaultOutputModes: ['text', 'data'],
      skills: [
        // Provider Discovery
        { id: 'list-providers', name: 'List Compute Providers', description: 'Get all active compute providers with optional sorting', tags: ['query', 'providers'], inputSchema: { type: 'object', properties: { sortBy: { type: 'string', enum: ['price', 'rating', 'stake'] }, gpuType: { type: 'string' }, minRating: { type: 'number' }, hideUnrated: { type: 'boolean' } } } },
        { id: 'get-provider', name: 'Get Provider Details', description: 'Get info about a provider including reputation', tags: ['query', 'provider'], inputSchema: { type: 'object', properties: { address: { type: 'string' } }, required: ['address'] } },
        
        // Rentals (GPU/CPU/CVM)
        { id: 'get-quote', name: 'Get Rental Quote', description: 'Get cost estimate for rental', tags: ['query', 'pricing'], inputSchema: { type: 'object', properties: { provider: { type: 'string' }, durationHours: { type: 'number' } }, required: ['provider', 'durationHours'] } },
        { id: 'create-rental', name: 'Create Compute Rental', description: 'Rent GPU/CPU/CVM resources (requires payment)', tags: ['action', 'rental', 'payment'] },
        { id: 'get-rental', name: 'Get Rental Status', description: 'Check rental status', tags: ['query', 'rental'], inputSchema: { type: 'object', properties: { rentalId: { type: 'string' } }, required: ['rentalId'] } },
        { id: 'get-ssh-access', name: 'Get SSH Access', description: 'Get SSH connection details', tags: ['query', 'ssh'], inputSchema: { type: 'object', properties: { rentalId: { type: 'string' } }, required: ['rentalId'] } },
        { id: 'list-my-rentals', name: 'List My Rentals', description: 'Get user rentals', tags: ['query', 'rentals'], inputSchema: { type: 'object', properties: { address: { type: 'string' } }, required: ['address'] } },
        { id: 'list-active-services', name: 'List Active Services', description: 'Get currently running rentals/services for a user', tags: ['query', 'services'], inputSchema: { type: 'object', properties: { address: { type: 'string' } }, required: ['address'] } },
        
        // Rating & Reputation
        { id: 'rate-rental', name: 'Rate Rental', description: 'Rate a completed rental', tags: ['action', 'rating'] },
        { id: 'get-reputation', name: 'Get Reputation', description: 'Get provider/user reputation', tags: ['query', 'reputation'], inputSchema: { type: 'object', properties: { address: { type: 'string' }, type: { type: 'string', enum: ['provider', 'user'] } }, required: ['address', 'type'] } },
        { id: 'check-banned', name: 'Check Ban Status', description: 'Check if a provider/user is banned', tags: ['query', 'moderation'], inputSchema: { type: 'object', properties: { agentId: { type: 'number' } }, required: ['agentId'] } },
        
        // AI Inference
        { id: 'list-models', name: 'List AI Models', description: 'Get available AI models with sorting', tags: ['query', 'ai'], inputSchema: { type: 'object', properties: { type: { type: 'string', enum: ['llm', 'image', 'video', 'audio', 'embedding'] }, sortBy: { type: 'string', enum: ['price', 'rating'] } } } },
        { id: 'inference', name: 'AI Inference', description: 'Execute AI inference (requires payment)', tags: ['action', 'ai', 'payment'] },
        
        // Triggers (Serverless Workers)
        { id: 'list-triggers', name: 'List Triggers', description: 'Get cron/webhook/event triggers', tags: ['query', 'triggers'], inputSchema: { type: 'object', properties: { type: { type: 'string', enum: ['cron', 'webhook', 'event'] }, owner: { type: 'string' } } } },
        { id: 'get-trigger', name: 'Get Trigger Details', description: 'Get trigger execution stats', tags: ['query', 'trigger'], inputSchema: { type: 'object', properties: { triggerId: { type: 'string' } }, required: ['triggerId'] } },
        { id: 'create-trigger', name: 'Create Trigger', description: 'Create cron/webhook/event trigger', tags: ['action', 'trigger'], inputSchema: { type: 'object', properties: { type: { type: 'string', enum: ['cron', 'webhook', 'event'] }, name: { type: 'string' }, endpoint: { type: 'string' }, cronExpression: { type: 'string' } }, required: ['type', 'name', 'endpoint'] } },
        { id: 'get-prepaid-balance', name: 'Get Prepaid Balance', description: 'Get prepaid trigger balance', tags: ['query', 'balance'], inputSchema: { type: 'object', properties: { address: { type: 'string' } }, required: ['address'] } },
      ],
    };
  }

  private async executeSkill(skillId: string, params: Record<string, unknown>, paymentHeader?: string): Promise<SkillResult> {
    switch (skillId) {
      case 'list-providers': return this.listProviders(params);
      case 'get-provider': return this.getProvider(params.address as string);
      case 'get-quote': return this.getQuote(params.provider as string, params.durationHours as number);
      case 'create-rental': return this.createRental(params, paymentHeader);
      case 'get-rental': return this.getRental(params.rentalId as string);
      case 'get-ssh-access': return this.getSSHAccess(params.rentalId as string);
      case 'list-my-rentals': return this.listUserRentals(params.address as string);
      case 'list-active-services': return this.listActiveServices(params.address as string);
      case 'rate-rental': return this.rateRental(params);
      case 'get-reputation': return this.getReputation(params.address as string, params.type as 'provider' | 'user');
      case 'check-banned': return this.checkBanned(params.agentId as number);
      case 'list-models': return this.listModels(params);
      case 'inference': return this.inferenceSkill(params, paymentHeader);
      case 'list-triggers': return this.listTriggers(params);
      case 'get-trigger': return this.getTrigger(params.triggerId as string);
      case 'create-trigger': return this.createTriggerSkill(params, paymentHeader);
      case 'get-prepaid-balance': return this.getPrepaidBalance(params.address as string);
      default: return { message: 'Unknown skill', data: { error: `Skill '${skillId}' not found` } };
    }
  }

  private async listProviders(params: Record<string, unknown>): Promise<SkillResult> {
    const sortBy = params.sortBy as 'price' | 'rating' | 'stake' | undefined;
    const gpuType = params.gpuType as string | undefined;
    const minRating = params.minRating as number | undefined;
    const hideUnrated = params.hideUnrated as boolean | undefined;
    
    const addresses: string[] = await this.registry.getAllProviders();
    const providers: Array<{
      address: string; name: string; endpoint: string; stake: string;
      resources: { cpuCores: number; memoryGb: number; gpuType: string; gpuCount: number };
      pricing: { pricePerHour: string; minimumHours: number; priceWei: bigint };
      available: boolean; sshEnabled: boolean; dockerEnabled: boolean;
      reputation: { avgRating: number; ratingCount: number; banned: boolean };
    }> = [];
    
    for (const addr of addresses.slice(0, 50)) {
      const isActive = await this.registry.isActive(addr);
      if (!isActive) continue;
      
      // Check if provider is banned
      const record = await this.rental.getProviderRecord(addr);
      if (record.banned) continue;
      
      const info = await this.registry.getProvider(addr);
      const resources = await this.rental.getProviderResources(addr);
      const gpuTypeStr = GPU_TYPES[Number(resources.resources.gpuType)];
      
      // Filter by GPU type
      if (gpuType && gpuTypeStr !== gpuType) continue;
      
      const avgRating = record.ratingCount > 0 ? Number(record.totalRatingScore) / Number(record.ratingCount) : 0;
      
      // Filter by minimum rating
      if (minRating && avgRating < minRating) continue;
      
      // Hide unrated if requested
      if (hideUnrated && record.ratingCount === 0n) continue;
      
      providers.push({
        address: addr, name: info.name, endpoint: info.endpoint, stake: formatEther(info.stake),
        resources: { cpuCores: Number(resources.resources.cpuCores), memoryGb: Number(resources.resources.memoryGb), gpuType: gpuTypeStr, gpuCount: Number(resources.resources.gpuCount) },
        pricing: { pricePerHour: formatEther(resources.pricing.pricePerHour), minimumHours: Number(resources.pricing.minimumRentalHours), priceWei: resources.pricing.pricePerHour },
        available: resources.available, sshEnabled: resources.sshEnabled, dockerEnabled: resources.dockerEnabled,
        reputation: { avgRating, ratingCount: Number(record.ratingCount), banned: record.banned },
      });
    }
    
    // Sort providers
    if (sortBy === 'price') {
      providers.sort((a, b) => Number(a.pricing.priceWei - b.pricing.priceWei));
    } else if (sortBy === 'rating') {
      providers.sort((a, b) => b.reputation.avgRating - a.reputation.avgRating);
    } else if (sortBy === 'stake') {
      providers.sort((a, b) => parseFloat(b.stake) - parseFloat(a.stake));
    }
    
    // Remove priceWei from output (used only for sorting)
    const output = providers.map(p => ({ ...p, pricing: { pricePerHour: p.pricing.pricePerHour, minimumHours: p.pricing.minimumHours } }));
    
    return { message: `Found ${output.length} active compute providers`, data: { providers: output } };
  }

  private async getProvider(address: string): Promise<SkillResult> {
    if (!address) return { message: 'Error: address required', data: { error: 'Missing address' } };
    const isActive = await this.registry.isActive(address);
    if (!isActive) return { message: 'Provider not found', data: { error: 'Not found' } };
    const info = await this.registry.getProvider(address);
    const resources = await this.rental.getProviderResources(address);
    const record = await this.rental.getProviderRecord(address);
    const avgRating = record.ratingCount > 0 ? Number(record.totalRatingScore) / Number(record.ratingCount) : 0;
    return {
      message: `Provider: ${info.name}`,
      data: { address, name: info.name, endpoint: info.endpoint, stake: formatEther(info.stake), agentId: info.agentId.toString(),
        resources: { cpuCores: Number(resources.resources.cpuCores), memoryGb: Number(resources.resources.memoryGb), gpuType: GPU_TYPES[Number(resources.resources.gpuType)], gpuCount: Number(resources.resources.gpuCount), teeSupported: resources.resources.teeSupported },
        pricing: { pricePerHour: formatEther(resources.pricing.pricePerHour), minimumHours: Number(resources.pricing.minimumRentalHours), depositRequired: formatEther(resources.pricing.depositRequired) },
        reputation: { avgRating: avgRating.toFixed(2), ratingCount: Number(record.ratingCount), disputesLost: Number(record.disputesLost), banned: record.banned },
        available: resources.available, sshEnabled: resources.sshEnabled, dockerEnabled: resources.dockerEnabled },
    };
  }

  private async getQuote(provider: string, durationHours: number): Promise<SkillResult> {
    if (!provider || !durationHours) return { message: 'Error: params required', data: { error: 'Missing params' } };
    const [cost, asset, payTo, network, description] = await this.rental.getPaymentRequirement(provider, durationHours);
    return { message: `Quote: ${formatEther(cost)} ETH for ${durationHours} hours`, data: { provider, durationHours, cost: formatEther(cost), costWei: cost.toString(), asset: asset === '0x0000000000000000000000000000000000000000' ? 'ETH' : asset, payTo, network, description } };
  }

  private async createRental(params: Record<string, unknown>, paymentHeader?: string): Promise<SkillResult> {
    const provider = params.provider as string;
    const durationHours = params.durationHours as number;
    if (!provider || !durationHours) return { message: 'Error: params required', data: { error: 'Missing params' } };
    const cost = await this.rental.calculateRentalCost(provider, durationHours);
    if (!paymentHeader) {
      return { message: 'Payment required', data: {}, requiresPayment: { x402Version: 1, error: 'Payment required', accepts: [{ scheme: 'exact', network: 'jeju', maxAmountRequired: cost.toString(), asset: '0x0000000000000000000000000000000000000000', payTo: this.config.rentalAddress, resource: '/a2a/create-rental', description: `Compute rental: ${durationHours} hours` }] } };
    }
    return { message: 'Submit tx to ComputeRental.createRental()', data: { contract: this.config.rentalAddress, method: 'createRental', params: { provider, durationHours, sshPublicKey: params.sshPublicKey || '', containerImage: params.containerImage || '', startupScript: params.startupScript || '' }, value: cost.toString() } };
  }

  private async getRental(rentalId: string): Promise<SkillResult> {
    if (!rentalId) return { message: 'Error: rentalId required', data: { error: 'Missing rentalId' } };
    const rental = await this.rental.getRental(rentalId);
    if (rental.rentalId === '0x0000000000000000000000000000000000000000000000000000000000000000') return { message: 'Rental not found', data: { error: 'Not found' } };
    return { message: `Rental is ${RENTAL_STATUS[Number(rental.status)]}`, data: { rentalId: rental.rentalId, user: rental.user, provider: rental.provider, status: RENTAL_STATUS[Number(rental.status)], startTime: rental.startTime > 0 ? new Date(Number(rental.startTime) * 1000).toISOString() : null, endTime: rental.endTime > 0 ? new Date(Number(rental.endTime) * 1000).toISOString() : null, totalCost: formatEther(rental.totalCost), sshHost: rental.sshHost, sshPort: Number(rental.sshPort) } };
  }

  private async getSSHAccess(rentalId: string): Promise<SkillResult> {
    if (!rentalId) return { message: 'Error: rentalId required', data: { error: 'Missing rentalId' } };
    const rental = await this.rental.getRental(rentalId);
    if (Number(rental.status) !== 1) return { message: 'Rental not active', data: { error: 'Not active' } };
    if (!rental.sshHost) return { message: 'SSH not available yet', data: { error: 'Pending' } };
    return { message: 'SSH Access Ready', data: { rentalId, sshHost: rental.sshHost, sshPort: Number(rental.sshPort), command: `ssh -p ${rental.sshPort} user@${rental.sshHost}`, expiresAt: new Date(Number(rental.endTime) * 1000).toISOString() } };
  }

  private async listUserRentals(address: string): Promise<SkillResult> {
    if (!address) return { message: 'Error: address required', data: { error: 'Missing address' } };
    const rentalIds: string[] = await this.rental.getUserRentals(address);
    const rentals = [];
    for (const id of rentalIds.slice(-10)) {
      const rental = await this.rental.getRental(id);
      rentals.push({ rentalId: id, provider: rental.provider, status: RENTAL_STATUS[Number(rental.status)], cost: formatEther(rental.totalCost) });
    }
    return { message: `Found ${rentalIds.length} rentals`, data: { total: rentalIds.length, rentals: rentals.reverse() } };
  }

  private async rateRental(params: Record<string, unknown>): Promise<SkillResult> {
    const { rentalId, score } = params as { rentalId: string; score: number };
    if (!rentalId || !score || score < 1 || score > 5) return { message: 'Error: rentalId and score (1-5) required', data: { error: 'Invalid params' } };
    return { message: 'Submit tx to ComputeRental.rateRental()', data: { contract: this.config.rentalAddress, method: 'rateRental', params: { rentalId, score, review: params.review || '' } } };
  }

  private async getReputation(address: string, type: 'provider' | 'user'): Promise<SkillResult> {
    if (!address || !type) return { message: 'Error: params required', data: { error: 'Missing params' } };
    if (type === 'provider') {
      const record = await this.rental.getProviderRecord(address);
      const avgRating = record.ratingCount > 0 ? Number(record.totalRatingScore) / Number(record.ratingCount) : 0;
      return { message: `Provider rating: ${avgRating.toFixed(1)}/5`, data: { address, type: 'provider', totalRentals: Number(record.totalRentals), avgRating: avgRating.toFixed(2), ratingCount: Number(record.ratingCount), disputesLost: Number(record.disputesLost), banned: record.banned } };
    } else {
      const record = await this.rental.getUserRecord(address);
      return { message: `User: ${record.totalRentals} rentals`, data: { address, type: 'user', totalRentals: Number(record.totalRentals), completedRentals: Number(record.completedRentals), abuseReports: Number(record.abuseReports), banned: record.banned } };
    }
  }

  private async listModels(params: Record<string, unknown>): Promise<SkillResult> {
    const modelType = params.type as 'llm' | 'image' | 'video' | 'audio' | 'embedding' | undefined;
    const sortBy = params.sortBy as 'price' | 'rating' | undefined;
    
    const providers: string[] = await this.registry.getAllProviders();
    const allServices: Array<{
      model: string; provider: string; pricePerInputToken: string; pricePerOutputToken: string;
      totalPriceWei: bigint; providerRating: number;
    }> = [];
    
    for (const addr of providers.slice(0, 20)) {
      const isActive = await this.registry.isActive(addr);
      if (!isActive) continue;
      
      // Get provider reputation
      const record = await this.rental.getProviderRecord(addr);
      if (record.banned) continue;
      const avgRating = record.ratingCount > 0 ? Number(record.totalRatingScore) / Number(record.ratingCount) : 0;
      
      const services = await this.inferenceContract.getServices(addr);
      for (const svc of services) {
        if (!svc.active) continue;
        
        // Filter by model type (based on model name patterns)
        if (modelType) {
          const modelLower = svc.model.toLowerCase();
          const typeMatches = {
            llm: /gpt|llama|claude|mistral|gemma|phi|qwen|deepseek|vicuna|solar/i,
            image: /dalle|sdxl|stable-diffusion|flux|midjourney|imagen/i,
            video: /sora|runway|pika|gen-2|cogvideo/i,
            audio: /whisper|tts|bark|eleven|xtts/i,
            embedding: /embed|ada|bge|e5|gte/i,
          };
          if (!typeMatches[modelType].test(modelLower)) continue;
        }
        
        allServices.push({
          model: svc.model, provider: svc.provider,
          pricePerInputToken: formatEther(svc.pricePerInputToken),
          pricePerOutputToken: formatEther(svc.pricePerOutputToken),
          totalPriceWei: svc.pricePerInputToken + svc.pricePerOutputToken,
          providerRating: avgRating,
        });
      }
    }
    
    // Sort models
    if (sortBy === 'price') {
      allServices.sort((a, b) => Number(a.totalPriceWei - b.totalPriceWei));
    } else if (sortBy === 'rating') {
      allServices.sort((a, b) => b.providerRating - a.providerRating);
    }
    
    // Remove internal fields from output
    const output = allServices.map(({ totalPriceWei, providerRating, ...rest }) => ({ ...rest, rating: providerRating.toFixed(2) }));
    
    return { message: `Found ${output.length} models`, data: { models: output } };
  }

  private async inferenceSkill(params: Record<string, unknown>, paymentHeader?: string): Promise<SkillResult> {
    const { model, prompt } = params as { model: string; prompt: string };
    if (!model || !prompt) return { message: 'Error: model and prompt required', data: { error: 'Missing params' } };
    const estimatedCost = parseEther('0.001');
    if (!paymentHeader) {
      return { message: 'Payment required', data: {}, requiresPayment: { x402Version: 1, error: 'Payment required', accepts: [{ scheme: 'exact', network: 'jeju', maxAmountRequired: estimatedCost.toString(), asset: '0x0000000000000000000000000000000000000000', payTo: this.config.ledgerAddress, resource: '/a2a/inference', description: `AI inference on ${model}` }] } };
    }
    return { message: 'Use inference endpoint directly', data: { steps: ['1. Deposit to LedgerManager', '2. Acknowledge provider', '3. Call provider endpoint', '4. Provider settles via InferenceServing'] } };
  }

  // ============ Active Services ============
  
  private async listActiveServices(address: string): Promise<SkillResult> {
    if (!address) return { message: 'Error: address required', data: { error: 'Missing address' } };
    
    const rentalIds: string[] = await this.rental.getUserRentals(address);
    const activeServices: Array<{
      type: 'rental'; id: string; provider: string; status: string;
      expiresAt: string; remainingTime: string;
    }> = [];
    
    for (const id of rentalIds) {
      const rental = await this.rental.getRental(id);
      const status = RENTAL_STATUS[Number(rental.status)];
      if (status !== 'ACTIVE') continue;
      
      const endTime = Number(rental.endTime);
      const now = Math.floor(Date.now() / 1000);
      const remaining = Math.max(0, endTime - now);
      const hours = Math.floor(remaining / 3600);
      const minutes = Math.floor((remaining % 3600) / 60);
      
      activeServices.push({
        type: 'rental',
        id,
        provider: rental.provider,
        status,
        expiresAt: new Date(endTime * 1000).toISOString(),
        remainingTime: `${hours}h ${minutes}m`,
      });
    }
    
    // Add triggers if available
    if (this.triggerRegistry) {
      const triggerIds: string[] = await this.triggerRegistry.getOwnerTriggers(address);
      for (const id of triggerIds) {
        const trigger = await this.triggerRegistry.getTrigger(id);
        if (!trigger.active) continue;
        activeServices.push({
          type: 'rental', // Simplified for output
          id,
          provider: 'trigger-service',
          status: 'ACTIVE',
          expiresAt: 'N/A',
          remainingTime: `Executions: ${trigger.executionCount.toString()}`,
        });
      }
    }
    
    return { 
      message: `Found ${activeServices.length} active services`, 
      data: { services: activeServices } 
    };
  }

  // ============ Ban & Moderation ============
  
  private async checkBanned(agentId: number): Promise<SkillResult> {
    if (!this.banManager) {
      return { message: 'Ban manager not configured', data: { error: 'Not available' } };
    }
    
    const isBanned = await this.banManager.isNetworkBanned(agentId);
    if (!isBanned) {
      return { message: 'Agent is not banned', data: { agentId, banned: false } };
    }
    
    const banRecord = await this.banManager.getNetworkBan(agentId);
    return { 
      message: 'Agent is network banned', 
      data: { 
        agentId, 
        banned: true, 
        bannedAt: new Date(Number(banRecord.bannedAt) * 1000).toISOString(),
        reason: banRecord.reason,
      } 
    };
  }

  // ============ Trigger Skills ============
  
  private async listTriggers(params: Record<string, unknown>): Promise<SkillResult> {
    if (!this.triggerRegistry) {
      return { message: 'Trigger registry not configured', data: { error: 'Not available', triggers: [] } };
    }
    
    const triggerType = params.type as 'cron' | 'webhook' | 'event' | undefined;
    const owner = params.owner as string | undefined;
    
    // Get triggers
    let triggerIds: string[] = [];
    if (owner) {
      triggerIds = await this.triggerRegistry.getOwnerTriggers(owner);
    } else if (triggerType) {
      const typeMap = { cron: 0, webhook: 1, event: 2 };
      triggerIds = await this.triggerRegistry.getActiveTriggers(typeMap[triggerType]);
    }
    
    const triggers = [];
    for (const id of triggerIds.slice(0, 20)) {
      const trigger = await this.triggerRegistry.getTrigger(id);
      const typeNames = ['cron', 'webhook', 'event'];
      triggers.push({
        id,
        type: typeNames[Number(trigger.triggerType)],
        name: trigger.name,
        endpoint: trigger.endpoint,
        active: trigger.active,
        executionCount: Number(trigger.executionCount),
        lastExecutedAt: trigger.lastExecutedAt > 0 ? new Date(Number(trigger.lastExecutedAt) * 1000).toISOString() : null,
        agentId: trigger.agentId > 0 ? trigger.agentId.toString() : null,
      });
    }
    
    return { message: `Found ${triggers.length} triggers`, data: { triggers } };
  }
  
  private async getTrigger(triggerId: string): Promise<SkillResult> {
    if (!triggerId) return { message: 'Error: triggerId required', data: { error: 'Missing triggerId' } };
    if (!this.triggerRegistry) {
      return { message: 'Trigger registry not configured', data: { error: 'Not available' } };
    }
    
    const trigger = await this.triggerRegistry.getTrigger(triggerId);
    const typeNames = ['cron', 'webhook', 'event'];
    
    return { 
      message: `Trigger: ${trigger.name}`, 
      data: { 
        id: triggerId,
        type: typeNames[Number(trigger.triggerType)],
        name: trigger.name,
        endpoint: trigger.endpoint,
        active: trigger.active,
        owner: trigger.owner,
        executionCount: Number(trigger.executionCount),
        lastExecutedAt: trigger.lastExecutedAt > 0 ? new Date(Number(trigger.lastExecutedAt) * 1000).toISOString() : null,
        agentId: trigger.agentId > 0 ? trigger.agentId.toString() : null,
      } 
    };
  }
  
  private async createTriggerSkill(params: Record<string, unknown>, paymentHeader?: string): Promise<SkillResult> {
    const { type, name, endpoint, cronExpression } = params as { 
      type: 'cron' | 'webhook' | 'event'; 
      name: string; 
      endpoint: string; 
      cronExpression?: string;
    };
    
    if (!type || !name || !endpoint) {
      return { message: 'Error: type, name, and endpoint required', data: { error: 'Missing params' } };
    }
    
    if (type === 'cron' && !cronExpression) {
      return { message: 'Error: cronExpression required for cron triggers', data: { error: 'Missing cronExpression' } };
    }
    
    const registrationCost = parseEther('0.01'); // Registration fee
    if (!paymentHeader) {
      return { 
        message: 'Payment required for trigger registration', 
        data: {}, 
        requiresPayment: { 
          x402Version: 1, 
          error: 'Payment required', 
          accepts: [{ 
            scheme: 'exact', 
            network: 'jeju', 
            maxAmountRequired: registrationCost.toString(), 
            asset: '0x0000000000000000000000000000000000000000', 
            payTo: this.config.triggerRegistryAddress || this.config.ledgerAddress, 
            resource: '/a2a/create-trigger', 
            description: `Create ${type} trigger: ${name}` 
          }] 
        } 
      };
    }
    
    const typeMap = { cron: 0, webhook: 1, event: 2 };
    return { 
      message: 'Submit tx to TriggerRegistry.registerTrigger()', 
      data: { 
        contract: this.config.triggerRegistryAddress, 
        method: 'registerTrigger', 
        params: { 
          triggerType: typeMap[type], 
          name, 
          endpoint, 
          cronExpression: cronExpression || '',
          agentId: params.agentId || 0,
        },
        value: registrationCost.toString(),
      } 
    };
  }
  
  private async getPrepaidBalance(address: string): Promise<SkillResult> {
    if (!address) return { message: 'Error: address required', data: { error: 'Missing address' } };
    if (!this.triggerRegistry) {
      return { message: 'Trigger registry not configured', data: { error: 'Not available' } };
    }
    
    const balance = await this.triggerRegistry.prepaidBalances(address);
    return { 
      message: `Prepaid balance: ${formatEther(balance)} ETH`, 
      data: { address, balance: formatEther(balance), balanceWei: balance.toString() } 
    };
  }

  getRouter(): Hono { return this.app; }
}

export function createComputeA2AServer(config: A2AConfig): ComputeA2AServer {
  return new ComputeA2AServer(config);
}

