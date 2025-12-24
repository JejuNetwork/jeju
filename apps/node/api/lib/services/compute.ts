import type { Address } from 'viem'
import { z } from 'zod'
import type { HardwareInfo } from '../../../lib/types'
import { COMPUTE_STAKING_ABI, INFERENCE_SERVING_ABI } from '../abis'
import { getChain, type NodeClient } from '../contracts'
import {
  type ComputeCapabilities,
  type ComputeMode,
  type ComputeType,
  convertHardwareToCamelCase,
  convertHardwareToSnakeCase,
  getComputeCapabilities,
  type HardwareInfo as HardwareInfoCamel,
  NON_TEE_WARNING,
} from '../hardware'

export type { ComputeMode, ComputeType }

const ComputeModeSchema = z.enum(['tee', 'non-tee'])
const ComputeTypeSchema = z.enum(['cpu', 'gpu', 'both'])

const ComputeServiceConfigSchema = z.object({
  modelId: z.string().min(1),
  endpoint: z.string().url(),
  pricePerInputToken: z.bigint(),
  pricePerOutputToken: z.bigint(),
  stakeAmount: z.bigint(),
  computeType: ComputeTypeSchema,
  computeMode: ComputeModeSchema,
  cpuCores: z.number().int().positive().optional(),
  gpuIds: z.array(z.number().int().nonnegative()).optional(),
  dockerImage: z.string().min(1).optional(),
  acceptNonTeeRisk: z.boolean().optional(),
})

export interface ComputeServiceConfig {
  modelId: string
  endpoint: string
  pricePerInputToken: bigint
  pricePerOutputToken: bigint
  stakeAmount: bigint
  computeType: ComputeType
  computeMode: ComputeMode
  cpuCores?: number
  gpuIds?: number[]
  dockerImage?: string
  acceptNonTeeRisk?: boolean
}

const ComputeServiceStateSchema = z.object({
  isRegistered: z.boolean(),
  isStaked: z.boolean(),
  stakeAmount: z.bigint(),
  pendingBalance: z.bigint(),
  modelId: z.string().min(1),
  endpoint: z.string().url(),
})

export interface ComputeServiceState {
  isRegistered: boolean
  isStaked: boolean
  stakeAmount: bigint
  pendingBalance: bigint
  modelId: string
  endpoint: string
}

const AddressSchema = z.custom<Address>(
  (val): val is Address =>
    typeof val === 'string' && /^0x[a-fA-F0-9]{40}$/.test(val),
  'Invalid address',
)

const ComputeOfferSchema = z.object({
  provider: AddressSchema,
  computeType: ComputeTypeSchema,
  computeMode: ComputeModeSchema,
  cpuCores: z.number().int().positive(),
  cpuGflops: z.number().nonnegative(),
  memoryMb: z.number().int().positive(),
  gpuCount: z.number().int().nonnegative(),
  gpuModels: z.array(z.string().min(1)),
  gpuVramMb: z.number().int().nonnegative(),
  gpuTflops: z.number().nonnegative(),
  pricePerHourWei: z.bigint(),
  pricePerGpuHourWei: z.bigint(),
  isOnline: z.boolean(),
  jobsCompleted: z.number().int().nonnegative(),
  reputation: z.number().int().min(0).max(100),
  teeAvailable: z.boolean(),
  teeType: z.string().nullable(),
})

export interface ComputeOffer {
  provider: Address
  computeType: ComputeType
  computeMode: ComputeMode
  cpuCores: number
  cpuGflops: number
  memoryMb: number
  gpuCount: number
  gpuModels: string[]
  gpuVramMb: number
  gpuTflops: number
  pricePerHourWei: bigint
  pricePerGpuHourWei: bigint
  isOnline: boolean
  jobsCompleted: number
  reputation: number
  teeAvailable: boolean
  teeType: string | null
}

function validateComputeServiceConfig(data: unknown): ComputeServiceConfig {
  return ComputeServiceConfigSchema.parse(data)
}

function validateComputeServiceState(data: unknown): ComputeServiceState {
  return ComputeServiceStateSchema.parse(data)
}

function validateComputeOffer(data: unknown): ComputeOffer {
  return ComputeOfferSchema.parse(data)
}

export class ComputeService {
  private client: NodeClient
  private hardware: HardwareInfo | null = null
  private capabilities: ComputeCapabilities | null = null
  private nonTeeAcknowledged = false

  constructor(client: NodeClient) {
    this.client = client
  }

  setHardware(hardware: HardwareInfo | HardwareInfoCamel): void {
    // Convert to camelCase for getComputeCapabilities if needed
    // Use 'os_version' as discriminant between snake_case and camelCase
    const isSnakeCase = 'os_version' in hardware
    const hwCamel = isSnakeCase
      ? convertHardwareToCamelCase(hardware)
      : hardware
    this.hardware = isSnakeCase
      ? hardware
      : convertHardwareToSnakeCase(hardware)
    this.capabilities = getComputeCapabilities(hwCamel)
  }

  getCapabilities(): ComputeCapabilities | null {
    return this.capabilities
  }

  getWarnings(): string[] {
    return this.capabilities?.warnings || []
  }

  isNonTeeMode(computeType: ComputeType): boolean {
    if (!this.capabilities) return true

    if (computeType === 'cpu' || computeType === 'both') {
      if (!this.capabilities.cpuCompute.teeAvailable) return true
    }
    if (computeType === 'gpu' || computeType === 'both') {
      if (!this.capabilities.gpuCompute.teeAvailable) return true
    }
    return false
  }

  getNonTeeWarning(): string {
    return NON_TEE_WARNING
  }

  acknowledgeNonTeeRisk(): void {
    this.nonTeeAcknowledged = true
  }

  async getState(address: Address): Promise<ComputeServiceState> {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new Error(`Invalid address: ${address}`)
    }
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
    ])

    const rawState = {
      isRegistered: service[4], // isActive
      isStaked: stake[0] > 0n,
      stakeAmount: stake[0],
      pendingBalance,
      modelId: service[0],
      endpoint: service[1],
    }

    return validateComputeServiceState(rawState)
  }

  async stake(amount: bigint): Promise<string> {
    if (!this.client.walletClient?.account) {
      throw new Error('Wallet not connected')
    }

    const hash = await this.client.walletClient.writeContract({
      chain: getChain(this.client.chainId),
      account: this.client.walletClient.account,
      address: this.client.addresses.computeStaking,
      abi: COMPUTE_STAKING_ABI,
      functionName: 'stakeAsProvider',
      value: amount,
    })

    return hash
  }

  async registerService(config: ComputeServiceConfig): Promise<string> {
    const validatedConfig = validateComputeServiceConfig(config)

    if (!this.client.walletClient?.account) {
      throw new Error('Wallet not connected')
    }

    // Check if non-TEE mode requires acknowledgment
    if (
      this.isNonTeeMode(validatedConfig.computeType) &&
      !this.nonTeeAcknowledged &&
      !validatedConfig.acceptNonTeeRisk
    ) {
      throw new Error(
        'Non-TEE compute requires user acknowledgment of privacy risks. Call acknowledgeNonTeeRisk() first.',
      )
    }

    // Validate hardware capabilities
    if (!this.capabilities) {
      throw new Error('Hardware not profiled. Call setHardware() first.')
    }

    if (
      validatedConfig.computeType === 'gpu' ||
      validatedConfig.computeType === 'both'
    ) {
      if (!this.capabilities.gpuCompute.available) {
        throw new Error('GPU compute requested but no suitable GPU detected')
      }
    }

    if (
      validatedConfig.computeType === 'cpu' ||
      validatedConfig.computeType === 'both'
    ) {
      if (!this.capabilities.cpuCompute.available) {
        throw new Error(
          'CPU compute requested but system does not meet requirements',
        )
      }
    }

    // First stake if needed
    const address = this.client.walletClient.account.address
    const state = await this.getState(address)
    if (!state.isStaked) {
      await this.stake(validatedConfig.stakeAmount)
    }

    // Build endpoint with compute metadata
    const endpointUrl = new URL(validatedConfig.endpoint)
    endpointUrl.searchParams.set('compute_type', validatedConfig.computeType)
    endpointUrl.searchParams.set('compute_mode', validatedConfig.computeMode)
    if (validatedConfig.cpuCores) {
      endpointUrl.searchParams.set(
        'cpu_cores',
        validatedConfig.cpuCores.toString(),
      )
    }
    if (validatedConfig.gpuIds && validatedConfig.gpuIds.length > 0) {
      endpointUrl.searchParams.set('gpu_ids', validatedConfig.gpuIds.join(','))
    }

    // Then register service
    const hash = await this.client.walletClient.writeContract({
      chain: getChain(this.client.chainId),
      account: this.client.walletClient.account,
      address: this.client.addresses.inferenceServing,
      abi: INFERENCE_SERVING_ABI,
      functionName: 'registerService',
      args: [
        validatedConfig.modelId,
        endpointUrl.toString(),
        validatedConfig.pricePerInputToken,
        validatedConfig.pricePerOutputToken,
      ],
    })

    return hash
  }

  async withdraw(): Promise<string> {
    if (!this.client.walletClient?.account) {
      throw new Error('Wallet not connected')
    }

    const hash = await this.client.walletClient.writeContract({
      chain: getChain(this.client.chainId),
      account: this.client.walletClient.account,
      address: this.client.addresses.inferenceServing,
      abi: INFERENCE_SERVING_ABI,
      functionName: 'withdraw',
    })

    return hash
  }

  async unstake(): Promise<string> {
    if (!this.client.walletClient?.account) {
      throw new Error('Wallet not connected')
    }

    const hash = await this.client.walletClient.writeContract({
      chain: getChain(this.client.chainId),
      account: this.client.walletClient.account,
      address: this.client.addresses.computeStaking,
      abi: COMPUTE_STAKING_ABI,
      functionName: 'unstake',
    })

    return hash
  }

  // Create compute offer from detected hardware
  createOffer(
    pricePerHourWei: bigint,
    pricePerGpuHourWei: bigint,
    computeType: ComputeType = 'both',
  ): Omit<
    ComputeOffer,
    'provider' | 'isOnline' | 'jobsCompleted' | 'reputation'
  > | null {
    if (
      !this.hardware ||
      !this.capabilities ||
      !this.client.walletClient?.account
    ) {
      return null
    }

    const address = this.client.walletClient.account.address
    const teeType = this.hardware.tee.has_intel_tdx
      ? 'Intel TDX'
      : this.hardware.tee.has_intel_sgx
        ? 'Intel SGX'
        : this.hardware.tee.has_amd_sev
          ? 'AMD SEV'
          : this.hardware.tee.has_nvidia_cc
            ? 'NVIDIA CC'
            : null

    const rawOffer = {
      provider: address,
      computeType,
      computeMode: this.isNonTeeMode(computeType) ? 'non-tee' : 'tee',
      cpuCores: this.hardware.cpu.cores_physical,
      cpuGflops: 0, // Not available in snake_case format
      memoryMb: this.hardware.memory.total_mb,
      gpuCount: this.hardware.gpus.length,
      gpuModels: this.hardware.gpus.map((g) => g.name),
      gpuVramMb: this.capabilities.gpuCompute.totalVram,
      gpuTflops: this.capabilities.gpuCompute.estimatedTflops,
      pricePerHourWei,
      pricePerGpuHourWei,
      teeAvailable: this.hardware.tee.attestation_available,
      teeType,
    }

    return validateComputeOffer(rawOffer)
  }
}

export function createComputeService(client: NodeClient): ComputeService {
  return new ComputeService(client)
}
