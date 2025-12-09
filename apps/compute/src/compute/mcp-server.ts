/**
 * MCP Server for Compute Marketplace
 * Model Context Protocol integration for AI agent access
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
];

const INFERENCE_ABI = [
  'function getServices(address provider) view returns (tuple(address provider, string model, string endpoint, uint256 pricePerInputToken, uint256 pricePerOutputToken, bool active)[])',
  'function totalSettlements() view returns (uint256)',
  'function totalFeesCollected() view returns (uint256)',
];

const GPU_TYPES = ['NONE', 'NVIDIA_RTX_4090', 'NVIDIA_A100_40GB', 'NVIDIA_A100_80GB', 'NVIDIA_H100', 'NVIDIA_H200', 'AMD_MI300X', 'APPLE_M1_MAX', 'APPLE_M2_ULTRA', 'APPLE_M3_MAX'];
const RENTAL_STATUS = ['PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'DISPUTED'];

const MCP_SERVER_INFO = {
  name: 'jeju-compute',
  version: '1.0.0',
  description: 'Jeju Compute Marketplace - Decentralized GPU/CPU rentals',
  capabilities: { resources: true, tools: true, prompts: false },
};

const MCP_RESOURCES = [
  { uri: 'compute://providers', name: 'Compute Providers', description: 'All active compute providers', mimeType: 'application/json' },
  { uri: 'compute://rentals/recent', name: 'Recent Rentals', description: 'Recent marketplace rentals', mimeType: 'application/json' },
  { uri: 'compute://models', name: 'AI Models', description: 'Available AI inference models', mimeType: 'application/json' },
  { uri: 'compute://stats', name: 'Marketplace Stats', description: 'Global statistics', mimeType: 'application/json' },
];

const MCP_TOOLS = [
  { name: 'list_providers', description: 'List compute providers', inputSchema: { type: 'object', properties: { gpuType: { type: 'string' }, minMemory: { type: 'number' } } } },
  { name: 'get_quote', description: 'Get rental cost', inputSchema: { type: 'object', properties: { provider: { type: 'string' }, durationHours: { type: 'number' } }, required: ['provider', 'durationHours'] } },
  { name: 'create_rental', description: 'Create rental (returns tx)', inputSchema: { type: 'object', properties: { provider: { type: 'string' }, durationHours: { type: 'number' }, sshPublicKey: { type: 'string' } }, required: ['provider', 'durationHours', 'sshPublicKey'] } },
  { name: 'get_rental', description: 'Get rental details', inputSchema: { type: 'object', properties: { rentalId: { type: 'string' } }, required: ['rentalId'] } },
  { name: 'list_models', description: 'List AI models', inputSchema: { type: 'object', properties: { provider: { type: 'string' } } } },
  { name: 'run_inference', description: 'Execute inference (returns endpoint)', inputSchema: { type: 'object', properties: { model: { type: 'string' }, prompt: { type: 'string' } }, required: ['model', 'prompt'] } },
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
  private config: MCPConfig;

  constructor(config: MCPConfig) {
    this.config = config;
    this.app = new Hono();
    this.ethProvider = new JsonRpcProvider(config.rpcUrl);
    this.registry = new Contract(config.registryAddress, REGISTRY_ABI, this.ethProvider);
    this.rental = new Contract(config.rentalAddress, RENTAL_ABI, this.ethProvider);
    this.inference = new Contract(config.inferenceAddress, INFERENCE_ABI, this.ethProvider);
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
            providers.push({
              address: addr, name: info.name, stake: formatEther(info.stake),
              resources: { cpuCores: Number(resources.resources.cpuCores), memoryGb: Number(resources.resources.memoryGb), gpuType: GPU_TYPES[Number(resources.resources.gpuType)], gpuCount: Number(resources.resources.gpuCount) },
              pricing: { pricePerHour: formatEther(resources.pricing.pricePerHour) },
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
            const services = await this.inference.getServices(addr);
            for (const svc of services) {
              if (svc.active) models.push({ model: svc.model, provider: svc.provider, endpoint: svc.endpoint });
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
          contents = { totalProviders: addresses.length, activeProviders: activeCount, totalInferenceSettlements: totalSettlements.toString(), totalFeesCollected: formatEther(totalFees) };
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
          const addresses: string[] = await this.registry.getAllProviders();
          const providers = [];
          for (const addr of addresses.slice(0, 30)) {
            const isActive = await this.registry.isActive(addr);
            if (!isActive) continue;
            const info = await this.registry.getProvider(addr);
            const resources = await this.rental.getProviderResources(addr);
            const gpuType = GPU_TYPES[Number(resources.resources.gpuType)];
            if (args?.gpuType && gpuType !== args.gpuType) continue;
            if (args?.minMemory && Number(resources.resources.gpuMemoryGb) < (args.minMemory as number)) continue;
            providers.push({ address: addr, name: info.name, gpuType, gpuCount: Number(resources.resources.gpuCount), pricePerHour: formatEther(resources.pricing.pricePerHour), available: resources.available });
          }
          result = { providers };
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
        case 'list_models': {
          const addresses: string[] = await this.registry.getAllProviders();
          const models = [];
          for (const addr of addresses.slice(0, 20)) {
            if (args?.provider && addr !== args.provider) continue;
            const isActive = await this.registry.isActive(addr);
            if (!isActive) continue;
            const services = await this.inference.getServices(addr);
            for (const svc of services) {
              if (svc.active) models.push({ model: svc.model, provider: svc.provider, endpoint: svc.endpoint });
            }
          }
          result = { models };
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
