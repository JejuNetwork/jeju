/**
 * Compute service - Real contract integration
 * Supports both TEE (confidential) and non-TEE modes
 */

import { type Address } from 'viem';
import { type NodeClient, getChain } from '../contracts';
import { COMPUTE_STAKING_ABI, INFERENCE_SERVING_ABI } from '../abis';
import { 
  type HardwareInfo, 
  type ComputeCapabilities,
  getComputeCapabilities,
  NON_TEE_WARNING 
} from '../hardware';

export type ComputeMode = 'tee' | 'non-tee';
export type ComputeType = 'cpu' | 'gpu' | 'both';

export interface ComputeServiceConfig {
  modelId: string;
  endpoint: string;
  pricePerInputToken: bigint;
  pricePerOutputToken: bigint;
  stakeAmount: bigint;
  // New fields for CPU/GPU compute
  computeType: ComputeType;
  computeMode: ComputeMode;
  cpuCores?: number; // Cores to allocate
  gpuIds?: number[]; // GPU indices to use
  dockerImage?: string; // For containerized compute
  acceptNonTeeRisk?: boolean; // User acknowledged non-TEE warning
}

export interface ComputeServiceState {
  isRegistered: boolean;
  isStaked: boolean;
  stakeAmount: bigint;
  pendingBalance: bigint;
  modelId: string;
  endpoint: string;
}

export interface ComputeOffer {
  provider: Address;
  computeType: ComputeType;
  computeMode: ComputeMode;
  // CPU specs
  cpuCores: number;
  cpuGflops: number;
  memoryMb: number;
  // GPU specs (if applicable)
  gpuCount: number;
  gpuModels: string[];
  gpuVramMb: number;
  gpuTflops: number;
  // Pricing
  pricePerHourWei: bigint;
  pricePerGpuHourWei: bigint;
  // Status
  isOnline: boolean;
  jobsCompleted: number;
  reputation: number;
  // TEE status
  teeAvailable: boolean;
  teeType: string | null;
}

export class ComputeService {
  private client: NodeClient;
  private hardware: HardwareInfo | null = null;
  private capabilities: ComputeCapabilities | null = null;
  private nonTeeAcknowledged = false;

  constructor(client: NodeClient) {
    this.client = client;
  }

  setHardware(hardware: HardwareInfo): void {
    this.hardware = hardware;
    this.capabilities = getComputeCapabilities(hardware);
  }

  getCapabilities(): ComputeCapabilities | null {
    return this.capabilities;
  }

  getWarnings(): string[] {
    return this.capabilities?.warnings || [];
  }

  isNonTeeMode(computeType: ComputeType): boolean {
    if (!this.capabilities) return true;
    
    if (computeType === 'cpu' || computeType === 'both') {
      if (!this.capabilities.cpuCompute.teeAvailable) return true;
    }
    if (computeType === 'gpu' || computeType === 'both') {
      if (!this.capabilities.gpuCompute.teeAvailable) return true;
    }
    return false;
  }

  getNonTeeWarning(): string {
    return NON_TEE_WARNING;
  }

  acknowledgeNonTeeRisk(): void {
    this.nonTeeAcknowledged = true;
  }

  async getState(address: Address): Promise<ComputeServiceState> {
    const [stake, service, pendingBalance] = await Promise.all([
      this.client.publicClient.readContract({
        address: this.client.addresses.computeStaking,
        abi: COMPUTE_STAKING_ABI,
        functionName: 'getStake',
        args: [address],
      }),
      this.client.publicClient.readContract({
        address: this.client.addresses.inferenceServing,
        abi: INFERENCE_SERVING_ABI,
        functionName: 'getService',
        args: [address],
      }),
      this.client.publicClient.readContract({
        address: this.client.addresses.inferenceServing,
        abi: INFERENCE_SERVING_ABI,
        functionName: 'pendingBalance',
        args: [address],
      }),
    ]);

    return {
      isRegistered: service[4], // isActive
      isStaked: stake[0] > 0n,
      stakeAmount: stake[0],
      pendingBalance,
      modelId: service[0],
      endpoint: service[1],
    };
  }

  async stake(amount: bigint): Promise<string> {
    if (!this.client.walletClient?.account) {
      throw new Error('Wallet not connected');
    }

    const hash = await this.client.walletClient.writeContract({
      chain: getChain(this.client.chainId),
      account: this.client.walletClient.account,
      address: this.client.addresses.computeStaking,
      abi: COMPUTE_STAKING_ABI,
      functionName: 'stakeAsProvider',
      value: amount,
    });

    return hash;
  }

  async registerService(config: ComputeServiceConfig): Promise<string> {
    if (!this.client.walletClient?.account) {
      throw new Error('Wallet not connected');
    }

    // Check if non-TEE mode requires acknowledgment
    if (this.isNonTeeMode(config.computeType) && !this.nonTeeAcknowledged && !config.acceptNonTeeRisk) {
      throw new Error('Non-TEE compute requires user acknowledgment of privacy risks. Call acknowledgeNonTeeRisk() first.');
    }

    // Validate hardware capabilities
    if (!this.capabilities) {
      throw new Error('Hardware not profiled. Call setHardware() first.');
    }

    if (config.computeType === 'gpu' || config.computeType === 'both') {
      if (!this.capabilities.gpuCompute.available) {
        throw new Error('GPU compute requested but no suitable GPU detected');
      }
    }

    if (config.computeType === 'cpu' || config.computeType === 'both') {
      if (!this.capabilities.cpuCompute.available) {
        throw new Error('CPU compute requested but system does not meet requirements');
      }
    }

    // First stake if needed
    const address = this.client.walletClient.account.address;
    const state = await this.getState(address);
    if (!state.isStaked) {
      await this.stake(config.stakeAmount);
    }

    // Build endpoint with compute metadata
    const endpointUrl = new URL(config.endpoint);
    endpointUrl.searchParams.set('compute_type', config.computeType);
    endpointUrl.searchParams.set('compute_mode', config.computeMode);
    if (config.cpuCores) {
      endpointUrl.searchParams.set('cpu_cores', config.cpuCores.toString());
    }
    if (config.gpuIds && config.gpuIds.length > 0) {
      endpointUrl.searchParams.set('gpu_ids', config.gpuIds.join(','));
    }

    // Then register service
    const hash = await this.client.walletClient.writeContract({
      chain: getChain(this.client.chainId),
      account: this.client.walletClient.account,
      address: this.client.addresses.inferenceServing,
      abi: INFERENCE_SERVING_ABI,
      functionName: 'registerService',
      args: [
        config.modelId,
        endpointUrl.toString(),
        config.pricePerInputToken,
        config.pricePerOutputToken,
      ],
    });

    return hash;
  }

  async withdraw(): Promise<string> {
    if (!this.client.walletClient?.account) {
      throw new Error('Wallet not connected');
    }

    const hash = await this.client.walletClient.writeContract({
      chain: getChain(this.client.chainId),
      account: this.client.walletClient.account,
      address: this.client.addresses.inferenceServing,
      abi: INFERENCE_SERVING_ABI,
      functionName: 'withdraw',
    });

    return hash;
  }

  async unstake(): Promise<string> {
    if (!this.client.walletClient?.account) {
      throw new Error('Wallet not connected');
    }

    const hash = await this.client.walletClient.writeContract({
      chain: getChain(this.client.chainId),
      account: this.client.walletClient.account,
      address: this.client.addresses.computeStaking,
      abi: COMPUTE_STAKING_ABI,
      functionName: 'unstake',
    });

    return hash;
  }

  // Create compute offer from detected hardware
  createOffer(
    pricePerHourWei: bigint,
    pricePerGpuHourWei: bigint,
    computeType: ComputeType = 'both'
  ): Omit<ComputeOffer, 'provider' | 'isOnline' | 'jobsCompleted' | 'reputation'> | null {
    if (!this.hardware || !this.capabilities) {
      return null;
    }

    const teeType = this.hardware.tee.hasIntelTdx ? 'Intel TDX' :
                    this.hardware.tee.hasIntelSgx ? 'Intel SGX' :
                    this.hardware.tee.hasAmdSev ? 'AMD SEV' :
                    this.hardware.tee.hasNvidiaCc ? 'NVIDIA CC' : null;

    return {
      computeType,
      computeMode: this.isNonTeeMode(computeType) ? 'non-tee' : 'tee',
      cpuCores: this.hardware.cpu.coresPhysical,
      cpuGflops: this.hardware.cpu.estimatedFlops,
      memoryMb: this.hardware.memory.totalMb,
      gpuCount: this.hardware.gpus.length,
      gpuModels: this.hardware.gpus.map(g => g.name),
      gpuVramMb: this.capabilities.gpuCompute.totalVram,
      gpuTflops: this.capabilities.gpuCompute.estimatedTflops,
      pricePerHourWei,
      pricePerGpuHourWei,
      teeAvailable: this.hardware.tee.attestationAvailable,
      teeType,
    };
  }
}

export function createComputeService(client: NodeClient): ComputeService {
  return new ComputeService(client);
}
