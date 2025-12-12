/**
 * MCP Server for Compute Marketplace
 * Model Context Protocol integration for AI agent access
 * 
 * Supports ALL compute types:
 * - GPU/CPU Rentals (hourly, SSH/Docker)
 * - Inference (LLM, Image, Video, Audio, Embedding, Multimodal)
 * - Triggers (Cron, Webhook, Event - serverless workers)
 * - Reputation & Moderation via ERC-8004
 */

import { Hono } from 'hono';
import { Contract, JsonRpcProvider, formatEther } from 'ethers';

// ============================================================================
// Types
// ============================================================================

interface MCPConfig {
  rpcUrl: string;
  registryAddress: string;
  rentalAddress: string;
  inferenceAddress: string;
  triggerRegistryAddress?: string;
  banManagerAddress?: string;
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
  'function getRental(bytes32 rentalId) view returns (tuple(bytes32 rentalId, address user, address provider, uint8 status, uint256 startTime, uint256 endTime, uint256 totalCost, uint256 paidAmount, uint256 refundedAmount, string sshPublicKey, string containerImage, string startupScript, string sshHost, uint16 sshPort))',
  'function getProviderRentals(address provider) view returns (bytes32[])',
  'function getUserRentals(address user) view returns (bytes32[])',
  'function getProviderRecord(address) view returns (tuple(uint256 totalRentals, uint256 totalRatingScore, uint256 ratingCount, uint256 disputesLost, bool banned))',
];

const INFERENCE_ABI = [
  'function getServices(address provider) view returns (tuple(address provider, string model, string endpoint, uint256 pricePerInputToken, uint256 pricePerOutputToken, bool active)[])',
  'function totalSettlements() view returns (uint256)',
  'function totalFeesCollected() view returns (uint256)',
];

const TRIGGER_REGISTRY_ABI = [
  'function getTrigger(bytes32 triggerId) view returns (address owner, uint8 triggerType, string name, string endpoint, bool active, uint256 executionCount, uint256 lastExecutedAt, uint256 agentId)',
  'function getActiveTriggers(uint8 triggerType) view returns (bytes32[])',
  'function getOwnerTriggers(address owner) view returns (bytes32[])',
  'function prepaidBalances(address) view returns (uint256)',
  'function getTriggerCount() view returns (uint256)',
];

const BAN_MANAGER_ABI = [
  'function isNetworkBanned(uint256 agentId) view returns (bool)',
  'function getNetworkBan(uint256 agentId) view returns (tuple(bool isBanned, uint256 bannedAt, string reason, bytes32 proposalId))',
];

const GPU_TYPES = ['NONE', 'NVIDIA_RTX_4090', 'NVIDIA_A100_40GB', 'NVIDIA_A100_80GB', 'NVIDIA_H100', 'NVIDIA_H200', 'AMD_MI300X', 'APPLE_M1_MAX', 'APPLE_M2_ULTRA', 'APPLE_M3_MAX'];
const RENTAL_STATUS = ['PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'DISPUTED'];
const TRIGGER_TYPES = ['cron', 'webhook', 'event'];

const MCP_SERVER_INFO = {
  name: 'jeju-compute',
  version: '1.0.0',
  description: 'Jeju Compute Marketplace - Decentralized GPU/CPU rentals, AI inference, serverless triggers',
  capabilities: { resources: true, tools: true, prompts: false },
};

const MCP_RESOURCES = [
  { uri: 'compute://providers', name: 'Compute Providers', description: 'All active compute providers with reputation', mimeType: 'application/json' },
  { uri: 'compute://rentals/recent', name: 'Recent Rentals', description: 'Recent marketplace rentals', mimeType: 'application/json' },
  { uri: 'compute://models', name: 'AI Models', description: 'Available AI inference models', mimeType: 'application/json' },
  { uri: 'compute://stats', name: 'Marketplace Stats', description: 'Global statistics', mimeType: 'application/json' },
  { uri: 'compute://triggers', name: 'Active Triggers', description: 'Cron, webhook, and event triggers', mimeType: 'application/json' },
  { uri: 'compute://active-services', name: 'Active Services', description: 'Currently running rentals and services', mimeType: 'application/json' },
];

const MCP_TOOLS = [
  // Provider Discovery (with sorting)
  { name: 'list_providers', description: 'List compute providers with sorting/filtering', inputSchema: { type: 'object', properties: { gpuType: { type: 'string' }, minMemory: { type: 'number' }, sortBy: { type: 'string', enum: ['price', 'rating', 'stake'] }, minRating: { type: 'number' }, hideUnrated: { type: 'boolean' } } } },
  { name: 'get_provider_reputation', description: 'Get provider reputation', inputSchema: { type: 'object', properties: { address: { type: 'string' } }, required: ['address'] } },
  
  // Rentals
  { name: 'get_quote', description: 'Get rental cost', inputSchema: { type: 'object', properties: { provider: { type: 'string' }, durationHours: { type: 'number' } }, required: ['provider', 'durationHours'] } },
  { name: 'create_rental', description: 'Create rental (returns tx)', inputSchema: { type: 'object', properties: { provider: { type: 'string' }, durationHours: { type: 'number' }, sshPublicKey: { type: 'string' } }, required: ['provider', 'durationHours', 'sshPublicKey'] } },
  { name: 'get_rental', description: 'Get rental details', inputSchema: { type: 'object', properties: { rentalId: { type: 'string' } }, required: ['rentalId'] } },
  { name: 'list_active_services', description: 'List currently running services for user', inputSchema: { type: 'object', properties: { address: { type: 'string' } }, required: ['address'] } },
  
  // AI Models (with sorting)
  { name: 'list_models', description: 'List AI models with sorting', inputSchema: { type: 'object', properties: { provider: { type: 'string' }, type: { type: 'string', enum: ['llm', 'image', 'video', 'audio', 'embedding'] }, sortBy: { type: 'string', enum: ['price', 'rating'] } } } },
  { name: 'run_inference', description: 'Execute inference (returns endpoint)', inputSchema: { type: 'object', properties: { model: { type: 'string' }, prompt: { type: 'string' } }, required: ['model', 'prompt'] } },
  
  // Triggers (Serverless Workers)
  { name: 'list_triggers', description: 'List cron/webhook/event triggers', inputSchema: { type: 'object', properties: { type: { type: 'string', enum: ['cron', 'webhook', 'event'] }, owner: { type: 'string' } } } },
  { name: 'get_trigger', description: 'Get trigger details', inputSchema: { type: 'object', properties: { triggerId: { type: 'string' } }, required: ['triggerId'] } },
  { name: 'create_trigger', description: 'Create a trigger (returns tx)', inputSchema: { type: 'object', properties: { type: { type: 'string', enum: ['cron', 'webhook', 'event'] }, name: { type: 'string' }, endpoint: { type: 'string' }, cronExpression: { type: 'string' } }, required: ['type', 'name', 'endpoint'] } },
  { name: 'get_prepaid_balance', description: 'Get prepaid trigger balance', inputSchema: { type: 'object', properties: { address: { type: 'string' } }, required: ['address'] } },
  
  // Moderation
  { name: 'check_banned', description: 'Check if agent is banned', inputSchema: { type: 'object', properties: { agentId: { type: 'number' } }, required: ['agentId'] } },
];

// ============================================================================
// MCP Server
// ============================================================================

export class ComputeMCPServer {
  private app: Hono;
  private ethProvider: JsonRpcProvider;
  private registry: Contract;
  private rental: Contract;
  private inference: Contract;
  private triggerRegistry: Contract | null;
  private banManager: Contract | null;
  private config: MCPConfig;

  constructor(config: MCPConfig) {
    this.config = config;
    this.app = new Hono();
    this.ethProvider = new JsonRpcProvider(config.rpcUrl);
    this.registry = new Contract(config.registryAddress, REGISTRY_ABI, this.ethProvider);
    this.rental = new Contract(config.rentalAddress, RENTAL_ABI, this.ethProvider);
    this.inference = new Contract(config.inferenceAddress, INFERENCE_ABI, this.ethProvider);
    this.triggerRegistry = config.triggerRegistryAddress 
      ? new Contract(config.triggerRegistryAddress, TRIGGER_REGISTRY_ABI, this.ethProvider)
      : null;
    this.banManager = config.banManagerAddress
      ? new Contract(config.banManagerAddress, BAN_MANAGER_ABI, this.ethProvider)
      : null;
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Initialize
    this.app.post('/initialize', (c) => c.json({ protocolVersion: '2024-11-05', serverInfo: MCP_SERVER_INFO, capabilities: MCP_SERVER_INFO.capabilities }));

    // List resources
    this.app.post('/resources/list', (c) => c.json({ resources: MCP_RESOURCES }));

    // Read resource
    this.app.post('/resources/read', async (c) => {
      const { uri } = await c.req.json<{ uri: string }>();
      let contents: unknown;

      switch (uri) {
        case 'compute://providers': {
          const addresses: string[] = await this.registry.getAllProviders();
          const providers = [];
          for (const addr of addresses.slice(0, 50)) {
            const isActive = await this.registry.isActive(addr);
            if (!isActive) continue;
            const info = await this.registry.getProvider(addr);
            const resources = await this.rental.getProviderResources(addr);
            const record = await this.rental.getProviderRecord(addr);
            if (record.banned) continue;
            const avgRating = record.ratingCount > 0 ? Number(record.totalRatingScore) / Number(record.ratingCount) : 0;
            providers.push({
              address: addr, name: info.name, stake: formatEther(info.stake), agentId: info.agentId?.toString() || '0',
              resources: { cpuCores: Number(resources.resources.cpuCores), memoryGb: Number(resources.resources.memoryGb), gpuType: GPU_TYPES[Number(resources.resources.gpuType)], gpuCount: Number(resources.resources.gpuCount) },
              pricing: { pricePerHour: formatEther(resources.pricing.pricePerHour) },
              reputation: { avgRating: avgRating.toFixed(2), ratingCount: Number(record.ratingCount) },
              available: resources.available,
            });
          }
          contents = { totalProviders: addresses.length, providers };
          break;
        }
        case 'compute://rentals/recent': {
          const addresses: string[] = await this.registry.getAllProviders();
          const allRentals = [];
          for (const addr of addresses.slice(0, 10)) {
            const rentalIds: string[] = await this.rental.getProviderRentals(addr);
            for (const id of rentalIds.slice(-5)) {
              const r = await this.rental.getRental(id);
              allRentals.push({ rentalId: id, provider: r.provider, status: RENTAL_STATUS[Number(r.status)], cost: formatEther(r.totalCost) });
            }
          }
          contents = { rentals: allRentals.slice(-50) };
          break;
        }
        case 'compute://models': {
          const addresses: string[] = await this.registry.getAllProviders();
          const models = [];
          for (const addr of addresses.slice(0, 20)) {
            const isActive = await this.registry.isActive(addr);
            if (!isActive) continue;
            const record = await this.rental.getProviderRecord(addr);
            if (record.banned) continue;
            const avgRating = record.ratingCount > 0 ? Number(record.totalRatingScore) / Number(record.ratingCount) : 0;
            const services = await this.inference.getServices(addr);
            for (const svc of services) {
              if (svc.active) models.push({ model: svc.model, provider: svc.provider, endpoint: svc.endpoint, providerRating: avgRating.toFixed(2) });
            }
          }
          contents = { totalModels: models.length, models };
          break;
        }
        case 'compute://stats': {
          const addresses: string[] = await this.registry.getAllProviders();
          let activeCount = 0;
          for (const addr of addresses) {
            if (await this.registry.isActive(addr)) activeCount++;
          }
          const totalSettlements = await this.inference.totalSettlements();
          const totalFees = await this.inference.totalFeesCollected();
          let triggerCount = 0;
          if (this.triggerRegistry) {
            triggerCount = Number(await this.triggerRegistry.getTriggerCount());
          }
          contents = { 
            totalProviders: addresses.length, 
            activeProviders: activeCount, 
            totalInferenceSettlements: totalSettlements.toString(), 
            totalFeesCollected: formatEther(totalFees),
            totalTriggers: triggerCount,
          };
          break;
        }
        case 'compute://triggers': {
          if (!this.triggerRegistry) {
            contents = { triggers: [], note: 'Trigger registry not configured' };
            break;
          }
          const triggers = [];
          for (const type of [0, 1, 2]) {
            const ids: string[] = await this.triggerRegistry.getActiveTriggers(type);
            for (const id of ids.slice(0, 20)) {
              const t = await this.triggerRegistry.getTrigger(id);
              triggers.push({
                id, type: TRIGGER_TYPES[type], name: t.name, endpoint: t.endpoint,
                active: t.active, executionCount: Number(t.executionCount),
                lastExecutedAt: t.lastExecutedAt > 0 ? new Date(Number(t.lastExecutedAt) * 1000).toISOString() : null,
              });
            }
          }
          contents = { totalTriggers: triggers.length, triggers };
          break;
        }
        case 'compute://active-services': {
          contents = { note: 'Query with list_active_services tool providing user address', services: [] };
          break;
        }
        default:
          return c.json({ error: 'Resource not found' }, 404);
      }

      return c.json({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(contents, null, 2) }] });
    });

    // List tools
    this.app.post('/tools/list', (c) => c.json({ tools: MCP_TOOLS }));

    // Call tool
    this.app.post('/tools/call', async (c) => {
      const { name, arguments: args } = await c.req.json<{ name: string; arguments: Record<string, unknown> }>();
      let result: unknown;
      let isError = false;

      switch (name) {
        case 'list_providers': {
          const sortBy = args?.sortBy as 'price' | 'rating' | 'stake' | undefined;
          const minRating = args?.minRating as number | undefined;
          const hideUnrated = args?.hideUnrated as boolean | undefined;
          
          const addresses: string[] = await this.registry.getAllProviders();
          const providers: Array<{
            address: string; name: string; gpuType: string; gpuCount: number;
            pricePerHour: string; priceWei: bigint; available: boolean;
            avgRating: number; ratingCount: number; stake: string;
          }> = [];
          
          for (const addr of addresses.slice(0, 50)) {
            const isActive = await this.registry.isActive(addr);
            if (!isActive) continue;
            const record = await this.rental.getProviderRecord(addr);
            if (record.banned) continue;
            
            const info = await this.registry.getProvider(addr);
            const resources = await this.rental.getProviderResources(addr);
            const gpuType = GPU_TYPES[Number(resources.resources.gpuType)];
            
            if (args?.gpuType && gpuType !== args.gpuType) continue;
            if (args?.minMemory && Number(resources.resources.gpuMemoryGb) < (args.minMemory as number)) continue;
            
            const avgRating = record.ratingCount > 0 ? Number(record.totalRatingScore) / Number(record.ratingCount) : 0;
            if (minRating && avgRating < minRating) continue;
            if (hideUnrated && record.ratingCount === 0n) continue;
            
            providers.push({ 
              address: addr, name: info.name, gpuType, gpuCount: Number(resources.resources.gpuCount), 
              pricePerHour: formatEther(resources.pricing.pricePerHour), 
              priceWei: resources.pricing.pricePerHour,
              available: resources.available,
              avgRating, ratingCount: Number(record.ratingCount),
              stake: formatEther(info.stake),
            });
          }
          
          // Sort providers
          if (sortBy === 'price') {
            providers.sort((a, b) => Number(a.priceWei - b.priceWei));
          } else if (sortBy === 'rating') {
            providers.sort((a, b) => b.avgRating - a.avgRating);
          } else if (sortBy === 'stake') {
            providers.sort((a, b) => parseFloat(b.stake) - parseFloat(a.stake));
          }
          
          result = { providers: providers.map(p => ({ ...p, priceWei: undefined, avgRating: p.avgRating.toFixed(2) })) };
          break;
        }
        case 'get_provider_reputation': {
          const addr = args.address as string;
          const record = await this.rental.getProviderRecord(addr);
          const avgRating = record.ratingCount > 0 ? Number(record.totalRatingScore) / Number(record.ratingCount) : 0;
          result = { 
            address: addr, 
            avgRating: avgRating.toFixed(2), 
            ratingCount: Number(record.ratingCount),
            totalRentals: Number(record.totalRentals),
            disputesLost: Number(record.disputesLost),
            banned: record.banned,
          };
          break;
        }
        case 'get_quote': {
          const cost = await this.rental.calculateRentalCost(args.provider as string, args.durationHours as number);
          result = { provider: args.provider, durationHours: args.durationHours, cost: formatEther(cost), costWei: cost.toString() };
          break;
        }
        case 'create_rental': {
          const cost = await this.rental.calculateRentalCost(args.provider as string, args.durationHours as number);
          result = { transaction: { to: this.config.rentalAddress, value: cost.toString(), method: 'createRental' }, cost: formatEther(cost), note: 'Sign and submit this transaction' };
          break;
        }
        case 'get_rental': {
          const r = await this.rental.getRental(args.rentalId as string);
          if (r.rentalId === '0x0000000000000000000000000000000000000000000000000000000000000000') {
            result = { error: 'Rental not found' };
            isError = true;
          } else {
            result = { rentalId: r.rentalId, provider: r.provider, status: RENTAL_STATUS[Number(r.status)], cost: formatEther(r.totalCost), sshHost: r.sshHost, sshPort: Number(r.sshPort) };
          }
          break;
        }
        case 'list_active_services': {
          const addr = args.address as string;
          const rentalIds: string[] = await this.rental.getUserRentals(addr);
          const services = [];
          for (const id of rentalIds) {
            const r = await this.rental.getRental(id);
            if (RENTAL_STATUS[Number(r.status)] !== 'ACTIVE') continue;
            const endTime = Number(r.endTime);
            const remaining = Math.max(0, endTime - Math.floor(Date.now() / 1000));
            services.push({ 
              type: 'rental', id, provider: r.provider, status: 'ACTIVE',
              expiresAt: new Date(endTime * 1000).toISOString(),
              remainingTime: `${Math.floor(remaining / 3600)}h ${Math.floor((remaining % 3600) / 60)}m`,
            });
          }
          result = { services };
          break;
        }
        case 'list_models': {
          const modelType = args?.type as 'llm' | 'image' | 'video' | 'audio' | 'embedding' | undefined;
          const sortBy = args?.sortBy as 'price' | 'rating' | undefined;
          
          const addresses: string[] = await this.registry.getAllProviders();
          const models: Array<{
            model: string; provider: string; endpoint: string;
            pricePerInputToken: string; totalPriceWei: bigint; providerRating: number;
          }> = [];
          
          for (const addr of addresses.slice(0, 20)) {
            if (args?.provider && addr !== args.provider) continue;
            const isActive = await this.registry.isActive(addr);
            if (!isActive) continue;
            const record = await this.rental.getProviderRecord(addr);
            if (record.banned) continue;
            const avgRating = record.ratingCount > 0 ? Number(record.totalRatingScore) / Number(record.ratingCount) : 0;
            
            const services = await this.inference.getServices(addr);
            for (const svc of services) {
              if (!svc.active) continue;
              
              // Filter by model type
              if (modelType) {
                const modelLower = svc.model.toLowerCase();
                const typeMatches: Record<string, RegExp> = {
                  llm: /gpt|llama|claude|mistral|gemma|phi|qwen|deepseek|vicuna|solar/i,
                  image: /dalle|sdxl|stable-diffusion|flux|midjourney|imagen/i,
                  video: /sora|runway|pika|gen-2|cogvideo/i,
                  audio: /whisper|tts|bark|eleven|xtts/i,
                  embedding: /embed|ada|bge|e5|gte/i,
                };
                if (!typeMatches[modelType].test(modelLower)) continue;
              }
              
              models.push({ 
                model: svc.model, provider: svc.provider, endpoint: svc.endpoint,
                pricePerInputToken: formatEther(svc.pricePerInputToken),
                totalPriceWei: svc.pricePerInputToken + svc.pricePerOutputToken,
                providerRating: avgRating,
              });
            }
          }
          
          // Sort models
          if (sortBy === 'price') {
            models.sort((a, b) => Number(a.totalPriceWei - b.totalPriceWei));
          } else if (sortBy === 'rating') {
            models.sort((a, b) => b.providerRating - a.providerRating);
          }
          
          result = { models: models.map(m => ({ model: m.model, provider: m.provider, endpoint: m.endpoint, pricePerInputToken: m.pricePerInputToken, providerRating: m.providerRating.toFixed(2) })) };
          break;
        }
        case 'run_inference': {
          const addresses: string[] = await this.registry.getAllProviders();
          let selectedProvider = args?.provider as string | undefined;
          let selectedEndpoint = '';
          for (const addr of addresses) {
            if (selectedProvider && addr !== selectedProvider) continue;
            const isActive = await this.registry.isActive(addr);
            if (!isActive) continue;
            const services = await this.inference.getServices(addr);
            for (const svc of services) {
              if (svc.active && svc.model === args.model) {
                selectedProvider = svc.provider;
                selectedEndpoint = svc.endpoint;
                break;
              }
            }
            if (selectedEndpoint) break;
          }
          if (!selectedEndpoint) {
            result = { error: `Model ${args.model} not found` };
            isError = true;
          } else {
            result = { provider: selectedProvider, endpoint: selectedEndpoint, usage: { steps: ['Deposit to LedgerManager', 'Acknowledge provider', 'Call endpoint with x-jeju-address header'] } };
          }
          break;
        }
        case 'list_triggers': {
          if (!this.triggerRegistry) {
            result = { triggers: [], note: 'Trigger registry not configured' };
            break;
          }
          const triggerType = args?.type as 'cron' | 'webhook' | 'event' | undefined;
          const owner = args?.owner as string | undefined;
          
          let triggerIds: string[] = [];
          if (owner) {
            triggerIds = await this.triggerRegistry.getOwnerTriggers(owner);
          } else if (triggerType) {
            const typeMap: Record<string, number> = { cron: 0, webhook: 1, event: 2 };
            triggerIds = await this.triggerRegistry.getActiveTriggers(typeMap[triggerType]);
          }
          
          const triggers = [];
          for (const id of triggerIds.slice(0, 20)) {
            const t = await this.triggerRegistry.getTrigger(id);
            triggers.push({
              id, type: TRIGGER_TYPES[Number(t.triggerType)], name: t.name, endpoint: t.endpoint,
              active: t.active, executionCount: Number(t.executionCount),
            });
          }
          result = { triggers };
          break;
        }
        case 'get_trigger': {
          if (!this.triggerRegistry) {
            result = { error: 'Trigger registry not configured' };
            isError = true;
            break;
          }
          const t = await this.triggerRegistry.getTrigger(args.triggerId as string);
          result = {
            id: args.triggerId, type: TRIGGER_TYPES[Number(t.triggerType)], name: t.name,
            endpoint: t.endpoint, active: t.active, owner: t.owner,
            executionCount: Number(t.executionCount),
            lastExecutedAt: t.lastExecutedAt > 0 ? new Date(Number(t.lastExecutedAt) * 1000).toISOString() : null,
          };
          break;
        }
        case 'create_trigger': {
          const typeMap: Record<string, number> = { cron: 0, webhook: 1, event: 2 };
          result = { 
            transaction: { 
              to: this.config.triggerRegistryAddress, 
              method: 'registerTrigger',
              params: { triggerType: typeMap[args.type as string], name: args.name, endpoint: args.endpoint, cronExpression: args.cronExpression || '' },
            }, 
            note: 'Sign and submit this transaction' 
          };
          break;
        }
        case 'get_prepaid_balance': {
          if (!this.triggerRegistry) {
            result = { error: 'Trigger registry not configured' };
            isError = true;
            break;
          }
          const balance = await this.triggerRegistry.prepaidBalances(args.address as string);
          result = { address: args.address, balance: formatEther(balance), balanceWei: balance.toString() };
          break;
        }
        case 'check_banned': {
          if (!this.banManager) {
            result = { error: 'Ban manager not configured' };
            isError = true;
            break;
          }
          const agentId = args.agentId as number;
          const isBanned = await this.banManager.isNetworkBanned(agentId);
          if (!isBanned) {
            result = { agentId, banned: false };
          } else {
            const ban = await this.banManager.getNetworkBan(agentId);
            result = { agentId, banned: true, bannedAt: new Date(Number(ban.bannedAt) * 1000).toISOString(), reason: ban.reason };
          }
          break;
        }
        default:
          result = { error: 'Tool not found' };
          isError = true;
      }

      return c.json({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError });
    });

    // Discovery
    this.app.get('/', (c) => c.json({ server: MCP_SERVER_INFO.name, version: MCP_SERVER_INFO.version, description: MCP_SERVER_INFO.description, resources: MCP_RESOURCES, tools: MCP_TOOLS, capabilities: MCP_SERVER_INFO.capabilities }));

    // Health
    this.app.get('/health', (c) => c.json({ status: 'ok', server: MCP_SERVER_INFO }));
  }

  getRouter(): Hono {
    return this.app;
  }
}

export function createMCPRouter(config: MCPConfig): Hono {
  return new ComputeMCPServer(config).getRouter();
}
