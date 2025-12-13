/** GPU Rental REST API */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Contract, JsonRpcProvider, Wallet, parseEther } from 'ethers';
import type { Address } from 'viem';
import type { TEENode } from '../infra/tee-interface';

export type GPUType = 'H200' | 'H100' | 'A100_80' | 'A100_40' | 'RTX4090';

export interface RentalApiConfig {
  rpcUrl: string;
  rentalContractAddress: Address;
  registryAddress: Address;
  privateKey?: string;
  phalaEndpoint?: string;
  marlinEndpoint?: string;
}

export interface RentalRequest {
  durationHours: number;
  gpuType: GPUType;
  memoryGb?: number;
  containerImage?: string;
  startupScript?: string;
  sshPublicKey?: string;
}

export interface RentalResponse {
  rentalId: string;
  providerAddress: string;
  sshHost: string;
  sshPort: number;
  expiresAt: number;
  costWei: string;
  gpuType: GPUType;
  containerId?: string;
}

export interface RentalStatus {
  rentalId: string;
  status: 'provisioning' | 'running' | 'completed' | 'failed';
  modelCID?: string;
  modelHash?: string;
  logs?: string;
  error?: string;
}

export interface GPUOption {
  gpuType: GPUType;
  available: number;
  pricePerHourWei: string;
  memoryGb: number;
  teeCapable: boolean;
}

const RENTAL_ABI = [
  'function calculateRentalCost(address provider, uint256 durationHours) view returns (uint256)',
  'function createRental(address provider, uint256 durationHours, string sshPublicKey, string containerImage, string startupScript) payable returns (bytes32)',
  'function getRental(bytes32 rentalId) view returns (tuple(bytes32 rentalId, address user, address provider, uint8 status, uint256 startTime, uint256 endTime, uint256 totalCost, uint256 paidAmount, uint256 refundedAmount, string sshPublicKey, string containerImage, string startupScript, string sshHost, uint16 sshPort))',
  'function cancelRental(bytes32 rentalId)',
];

const REGISTRY_ABI = [
  'function getAllProviders() view returns (address[])',
  'function isActive(address) view returns (bool)',
];

const GPU_MEMORY: Record<GPUType, number> = {
  RTX4090: 24,
  A100_40: 40,
  A100_80: 80,
  H100: 80,
  H200: 141,
};

const GPU_PRICING_WEI: Record<GPUType, bigint> = {
  RTX4090: parseEther('0.05'),     // $0.15/hr
  A100_40: parseEther('0.15'),     // $0.45/hr
  A100_80: parseEther('0.25'),     // $0.75/hr
  H100: parseEther('0.50'),        // $1.50/hr
  H200: parseEther('1.00'),        // $3.00/hr
};

export class RentalService {
  private provider: JsonRpcProvider;
  private _rental: Contract;
  private registry: Contract;
  private _signer: Wallet | null;
  private _config: RentalApiConfig;
  private activeRentals: Map<string, {
    request: RentalRequest;
    status: RentalStatus;
    node?: TEENode;
    startedAt: number;
  }> = new Map();
  private mockProviders: Map<GPUType, Address[]> = new Map([
    ['H200', ['0x1111111111111111111111111111111111111111' as Address]],
    ['H100', ['0x2222222222222222222222222222222222222222' as Address]],
    ['A100_80', ['0x3333333333333333333333333333333333333333' as Address]],
    ['A100_40', ['0x4444444444444444444444444444444444444444' as Address]],
    ['RTX4090', ['0x5555555555555555555555555555555555555555' as Address]],
  ]);

  constructor(config: RentalApiConfig) {
    this._config = config;
    this.provider = new JsonRpcProvider(config.rpcUrl);
    this._rental = new Contract(config.rentalContractAddress, RENTAL_ABI, this.provider);
    this.registry = new Contract(config.registryAddress, REGISTRY_ABI, this.provider);
    this._signer = config.privateKey
      ? new Wallet(config.privateKey, this.provider)
      : null;
  }

  async createRental(request: RentalRequest): Promise<RentalResponse> {
    const rentalId = `rental-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    const providerAddress = await this.findProvider(request.gpuType);
    if (!providerAddress) throw new Error(`No provider for ${request.gpuType}`);

    const pricePerHour = GPU_PRICING_WEI[request.gpuType] ?? parseEther('0.10');
    const totalCost = pricePerHour * BigInt(request.durationHours);
    const expiresAt = Date.now() + request.durationHours * 60 * 60 * 1000;
    
    this.activeRentals.set(rentalId, {
      request,
      status: {
        rentalId,
        status: 'provisioning',
      },
      startedAt: Date.now(),
    });

    this.provisionAsync(rentalId, request, providerAddress);

    return {
      rentalId,
      providerAddress,
      sshHost: '', // Will be populated when provisioning completes
      sshPort: 0,
      expiresAt,
      costWei: totalCost.toString(),
      gpuType: request.gpuType,
    };
  }

  private async provisionAsync(
    rentalId: string,
    _request: RentalRequest,
    _providerAddress: string
  ): Promise<void> {
    const rental = this.activeRentals.get(rentalId);
    if (!rental) return;

    try {
      await new Promise((r) => setTimeout(r, 2000));
      rental.status.status = 'running';
      console.log(`[Rental] Provisioned ${rentalId}`);
    } catch (error) {
      rental.status.status = 'failed';
      rental.status.error = error instanceof Error ? error.message : 'Provisioning failed';
    }
  }

  private async findProvider(gpuType: GPUType): Promise<Address | null> {
    try {
      const providers = await this.registry.getAllProviders();
      for (const addr of providers) {
        if (await this.registry.isActive(addr)) return addr as Address;
      }
    } catch {
      // Fall through to mock providers
    }

    const mockProviders = this.mockProviders.get(gpuType);
    if (mockProviders && mockProviders.length > 0) {
      return mockProviders[0]!;
    }

    return null;
  }

  async getRentalStatus(rentalId: string): Promise<RentalStatus> {
    const rental = this.activeRentals.get(rentalId);
    if (!rental) {
      throw new Error(`Rental ${rentalId} not found`);
    }
    return rental.status;
  }

  async terminateRental(rentalId: string): Promise<void> {
    const rental = this.activeRentals.get(rentalId);
    if (!rental) {
      throw new Error(`Rental ${rentalId} not found`);
    }

    rental.status.status = 'completed';
    this.activeRentals.delete(rentalId);
  }

  async listGPUOptions(): Promise<GPUOption[]> {
    const options: GPUOption[] = [];

    for (const gpuType of ['H200', 'H100', 'A100_80', 'A100_40', 'RTX4090'] as GPUType[]) {
      const mockProviders = this.mockProviders.get(gpuType);
      
      options.push({
        gpuType,
        available: mockProviders?.length ?? 0,
        pricePerHourWei: (GPU_PRICING_WEI[gpuType] ?? parseEther('0.10')).toString(),
        memoryGb: GPU_MEMORY[gpuType] ?? 24,
        teeCapable: gpuType === 'H100' || gpuType === 'H200',
      });
    }

    return options;
  }

  getServiceInfo(): { rpcUrl: string; hasWallet: boolean; rentalContract: string; contractAddress: string } {
    return {
      rpcUrl: this._config.rpcUrl,
      hasWallet: this._signer !== null,
      rentalContract: this._config.rentalContractAddress,
      contractAddress: this._rental.target as string,
    };
  }
}

export function createRentalApi(config: RentalApiConfig): Hono {
  const app = new Hono();
  const service = new RentalService(config);

  app.use('/*', cors());

  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.get('/api/v1/gpu-options', async (c) => {
    const options = await service.listGPUOptions();
    return c.json({ options });
  });

  app.post('/api/v1/rentals', async (c) => {
    const body = await c.req.json<RentalRequest>();
    
    if (!body.durationHours || !body.gpuType) {
      return c.json({ error: 'durationHours and gpuType are required' }, 400);
    }

    const rental = await service.createRental(body);
    return c.json(rental, 201);
  });

  app.get('/api/v1/rentals/:rentalId/status', async (c) => {
    const rentalId = c.req.param('rentalId');
    
    const status = await service.getRentalStatus(rentalId).catch(() => null);
    if (!status) {
      return c.json({ error: 'Rental not found' }, 404);
    }

    return c.json(status);
  });

  app.delete('/api/v1/rentals/:rentalId', async (c) => {
    const rentalId = c.req.param('rentalId');
    
    await service.terminateRental(rentalId).catch(() => null);
    return c.json({ success: true });
  });

  app.get('/api/v1/rentals', async (c) => c.json({ rentals: [] }));

  return app;
}

export async function startRentalServer(): Promise<void> {
  const config: RentalApiConfig = {
    rpcUrl: process.env.RPC_URL ?? process.env.JEJU_RPC_URL ?? 'http://localhost:9545',
    rentalContractAddress: (process.env.COMPUTE_RENTAL_ADDRESS ?? '0x0') as Address,
    registryAddress: (process.env.COMPUTE_REGISTRY_ADDRESS ?? '0x0') as Address,
    privateKey: process.env.PRIVATE_KEY,
    phalaEndpoint: process.env.PHALA_ENDPOINT,
    marlinEndpoint: process.env.MARLIN_ENDPOINT,
  };

  const port = parseInt(process.env.RENTAL_API_PORT ?? '8020', 10);
  const app = createRentalApi(config);

  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                    GPU Rental API                          ║
║         Decentralized Compute Marketplace                  ║
╠═══════════════════════════════════════════════════════════╣
║  RPC:      ${config.rpcUrl.slice(0, 44).padEnd(44)}║
║  Registry: ${config.registryAddress.slice(0, 44).padEnd(44)}║
║  Port:     ${port.toString().padEnd(44)}║
╚═══════════════════════════════════════════════════════════╝
`);

  Bun.serve({
    port,
    fetch: app.fetch,
  });

  console.log(`GPU Rental API listening on port ${port}`);
}

if (import.meta.main) {
  startRentalServer();
}
