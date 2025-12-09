/**
 * A2A Server for Compute Marketplace
 * Agent-to-agent communication for decentralized compute rentals
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

// ============================================================================
// A2A Server
// ============================================================================

export class ComputeA2AServer {
  private app: Hono;
  private provider: JsonRpcProvider;
  private registry: Contract;
  private rental: Contract;
  private inferenceContract: Contract;
  private config: A2AConfig;

  constructor(config: A2AConfig) {
    this.config = config;
    this.app = new Hono();
    this.provider = new JsonRpcProvider(config.rpcUrl);
    this.registry = new Contract(config.registryAddress, REGISTRY_ABI, this.provider);
    this.rental = new Contract(config.rentalAddress, RENTAL_ABI, this.provider);
    this.inferenceContract = new Contract(config.inferenceAddress, INFERENCE_ABI, this.provider);
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
      description: 'Decentralized compute marketplace - rent GPUs, CPUs, and TEE resources',
      url: '/a2a',
      preferredTransport: 'http',
      provider: { organization: 'Jeju Network', url: 'https://jeju.network' },
      version: '1.0.0',
      capabilities: { streaming: true, pushNotifications: false, stateTransitionHistory: true },
      defaultInputModes: ['text', 'data'],
      defaultOutputModes: ['text', 'data'],
      skills: [
        { id: 'list-providers', name: 'List Compute Providers', description: 'Get all active compute providers', tags: ['query', 'providers'] },
        { id: 'get-provider', name: 'Get Provider Details', description: 'Get info about a provider', tags: ['query', 'provider'], inputSchema: { type: 'object', properties: { address: { type: 'string' } }, required: ['address'] } },
        { id: 'get-quote', name: 'Get Rental Quote', description: 'Get cost estimate for rental', tags: ['query', 'pricing'], inputSchema: { type: 'object', properties: { provider: { type: 'string' }, durationHours: { type: 'number' } }, required: ['provider', 'durationHours'] } },
        { id: 'create-rental', name: 'Create Compute Rental', description: 'Rent compute resources (requires payment)', tags: ['action', 'rental', 'payment'] },
        { id: 'get-rental', name: 'Get Rental Status', description: 'Check rental status', tags: ['query', 'rental'], inputSchema: { type: 'object', properties: { rentalId: { type: 'string' } }, required: ['rentalId'] } },
        { id: 'get-ssh-access', name: 'Get SSH Access', description: 'Get SSH connection details', tags: ['query', 'ssh'], inputSchema: { type: 'object', properties: { rentalId: { type: 'string' } }, required: ['rentalId'] } },
        { id: 'list-my-rentals', name: 'List My Rentals', description: 'Get user rentals', tags: ['query', 'rentals'], inputSchema: { type: 'object', properties: { address: { type: 'string' } }, required: ['address'] } },
        { id: 'rate-rental', name: 'Rate Rental', description: 'Rate a completed rental', tags: ['action', 'rating'] },
        { id: 'get-reputation', name: 'Get Reputation', description: 'Get provider/user reputation', tags: ['query', 'reputation'], inputSchema: { type: 'object', properties: { address: { type: 'string' }, type: { type: 'string', enum: ['provider', 'user'] } }, required: ['address', 'type'] } },
        { id: 'list-models', name: 'List AI Models', description: 'Get available AI models', tags: ['query', 'ai'] },
        { id: 'inference', name: 'AI Inference', description: 'Execute AI inference (requires payment)', tags: ['action', 'ai', 'payment'] },
      ],
    };
  }

  private async executeSkill(skillId: string, params: Record<string, unknown>, paymentHeader?: string): Promise<SkillResult> {
    switch (skillId) {
      case 'list-providers': return this.listProviders();
      case 'get-provider': return this.getProvider(params.address as string);
      case 'get-quote': return this.getQuote(params.provider as string, params.durationHours as number);
      case 'create-rental': return this.createRental(params, paymentHeader);
      case 'get-rental': return this.getRental(params.rentalId as string);
      case 'get-ssh-access': return this.getSSHAccess(params.rentalId as string);
      case 'list-my-rentals': return this.listUserRentals(params.address as string);
      case 'rate-rental': return this.rateRental(params);
      case 'get-reputation': return this.getReputation(params.address as string, params.type as 'provider' | 'user');
      case 'list-models': return this.listModels();
      case 'inference': return this.inferenceSkill(params, paymentHeader);
      default: return { message: 'Unknown skill', data: { error: `Skill '${skillId}' not found` } };
    }
  }

  private async listProviders(): Promise<SkillResult> {
    const addresses: string[] = await this.registry.getAllProviders();
    const providers = [];
    for (const addr of addresses.slice(0, 20)) {
      const isActive = await this.registry.isActive(addr);
      if (!isActive) continue;
      const info = await this.registry.getProvider(addr);
      const resources = await this.rental.getProviderResources(addr);
      providers.push({
        address: addr, name: info.name, endpoint: info.endpoint, stake: formatEther(info.stake),
        resources: { cpuCores: Number(resources.resources.cpuCores), memoryGb: Number(resources.resources.memoryGb), gpuType: GPU_TYPES[Number(resources.resources.gpuType)], gpuCount: Number(resources.resources.gpuCount) },
        pricing: { pricePerHour: formatEther(resources.pricing.pricePerHour), minimumHours: Number(resources.pricing.minimumRentalHours) },
        available: resources.available, sshEnabled: resources.sshEnabled, dockerEnabled: resources.dockerEnabled,
      });
    }
    return { message: `Found ${providers.length} active compute providers`, data: { providers } };
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

  private async listModels(): Promise<SkillResult> {
    const providers: string[] = await this.registry.getAllProviders();
    const allServices = [];
    for (const addr of providers.slice(0, 10)) {
      const isActive = await this.registry.isActive(addr);
      if (!isActive) continue;
      const services = await this.inferenceContract.getServices(addr);
      for (const svc of services) {
        if (svc.active) allServices.push({ model: svc.model, provider: svc.provider, pricePerInputToken: formatEther(svc.pricePerInputToken), pricePerOutputToken: formatEther(svc.pricePerOutputToken) });
      }
    }
    return { message: `Found ${allServices.length} models`, data: { models: allServices } };
  }

  private async inferenceSkill(params: Record<string, unknown>, paymentHeader?: string): Promise<SkillResult> {
    const { model, prompt } = params as { model: string; prompt: string };
    if (!model || !prompt) return { message: 'Error: model and prompt required', data: { error: 'Missing params' } };
    const estimatedCost = parseEther('0.001');
    if (!paymentHeader) {
      return { message: 'Payment required', data: {}, requiresPayment: { x402Version: 1, error: 'Payment required', accepts: [{ scheme: 'exact', network: 'jeju', maxAmountRequired: estimatedCost.toString(), asset: '0x0000000000000000000000000000000000000000', payTo: this.config.ledgerAddress, resource: '/a2a/inference', description: `AI inference on ${model}` }] } };
    }
    return { message: 'Use OpenAI-compatible endpoint directly', data: { steps: ['1. Deposit to LedgerManager', '2. Acknowledge provider', '3. Call provider endpoint', '4. Provider settles via InferenceServing'] } };
  }

  getRouter(): Hono { return this.app; }
}

export function createComputeA2AServer(config: A2AConfig): ComputeA2AServer {
  return new ComputeA2AServer(config);
}

