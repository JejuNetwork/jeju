/**
 * ComputeBenchmarkRegistry Client
 *
 * TypeScript client for interacting with the on-chain ComputeBenchmarkRegistry contract.
 * Handles:
 * - Submitting benchmark results
 * - Querying benchmarks and rankings
 * - Verifying TEE attestations
 * - Cost-per-performance queries
 */

import type { Address, Hex, PublicClient, WalletClient, Account, Chain } from 'viem'
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia, foundry } from 'viem/chains'

import type { BenchmarkResults } from './benchmark-orchestrator'

export type NetworkEnvironment = 'mainnet' | 'testnet' | 'localnet'

const NETWORK_CONFIG = {
  mainnet: { rpcUrl: 'https://mainnet.base.org' },
  testnet: { rpcUrl: 'https://sepolia.base.org' },
  localnet: { rpcUrl: 'http://127.0.0.1:8545' },
} as const

// ============ Contract ABI ============

const BENCHMARK_REGISTRY_ABI = [
  // Structs are encoded/decoded automatically by viem
  {
    name: 'submitBenchmark',
    type: 'function',
    inputs: [
      {
        name: 'cpu',
        type: 'tuple',
        components: [
          { name: 'coreCount', type: 'uint32' },
          { name: 'threadCount', type: 'uint32' },
          { name: 'singleThreadScore', type: 'uint64' },
          { name: 'multiThreadScore', type: 'uint64' },
          { name: 'compressionScore', type: 'uint64' },
          { name: 'cpuModel', type: 'string' },
          { name: 'clockSpeedMhz', type: 'uint64' },
        ],
      },
      {
        name: 'memory_',
        type: 'tuple',
        components: [
          { name: 'capacityMb', type: 'uint64' },
          { name: 'bandwidthMbps', type: 'uint64' },
          { name: 'writeBandwidthMbps', type: 'uint64' },
          { name: 'latencyNs', type: 'uint32' },
          { name: 'memoryType', type: 'string' },
        ],
      },
      {
        name: 'disk',
        type: 'tuple',
        components: [
          { name: 'capacityGb', type: 'uint64' },
          { name: 'seqReadMbps', type: 'uint64' },
          { name: 'seqWriteMbps', type: 'uint64' },
          { name: 'randReadIops', type: 'uint32' },
          { name: 'randWriteIops', type: 'uint32' },
          { name: 'diskType', type: 'string' },
        ],
      },
      {
        name: 'network',
        type: 'tuple',
        components: [
          { name: 'bandwidthMbps', type: 'uint64' },
          { name: 'latencyMs', type: 'uint32' },
          { name: 'uploadMbps', type: 'uint64' },
          { name: 'region', type: 'string' },
          { name: 'ipv6Supported', type: 'bool' },
        ],
      },
      {
        name: 'gpu',
        type: 'tuple',
        components: [
          { name: 'model', type: 'string' },
          { name: 'vramMb', type: 'uint64' },
          { name: 'fp32Tflops', type: 'uint64' },
          { name: 'fp16Tflops', type: 'uint64' },
          { name: 'memoryBandwidthGbps', type: 'uint64' },
          { name: 'inferenceLatencyMs', type: 'uint64' },
          { name: 'cudaCores', type: 'uint32' },
          { name: 'tensorCores', type: 'uint32' },
        ],
      },
      {
        name: 'tee',
        type: 'tuple',
        components: [
          { name: 'teeType', type: 'uint8' },
          { name: 'attestationHash', type: 'bytes32' },
          { name: 'maxEnclaveMemoryMb', type: 'uint64' },
          { name: 'remoteAttestationSupported', type: 'bool' },
          { name: 'lastAttestationTimestamp', type: 'uint64' },
          { name: 'attestationQuote', type: 'bytes' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'verifyBenchmark',
    type: 'function',
    inputs: [
      { name: 'provider', type: 'address' },
      { name: 'status', type: 'uint8' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'verifyTEEAttestation',
    type: 'function',
    inputs: [
      { name: 'provider', type: 'address' },
      { name: 'attestationQuote', type: 'bytes' },
      { name: 'expectedHash', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getBenchmark',
    type: 'function',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          {
            name: 'cpu',
            type: 'tuple',
            components: [
              { name: 'coreCount', type: 'uint32' },
              { name: 'threadCount', type: 'uint32' },
              { name: 'singleThreadScore', type: 'uint64' },
              { name: 'multiThreadScore', type: 'uint64' },
              { name: 'compressionScore', type: 'uint64' },
              { name: 'cpuModel', type: 'string' },
              { name: 'clockSpeedMhz', type: 'uint64' },
            ],
          },
          {
            name: 'memory_',
            type: 'tuple',
            components: [
              { name: 'capacityMb', type: 'uint64' },
              { name: 'bandwidthMbps', type: 'uint64' },
              { name: 'writeBandwidthMbps', type: 'uint64' },
              { name: 'latencyNs', type: 'uint32' },
              { name: 'memoryType', type: 'string' },
            ],
          },
          {
            name: 'disk',
            type: 'tuple',
            components: [
              { name: 'capacityGb', type: 'uint64' },
              { name: 'seqReadMbps', type: 'uint64' },
              { name: 'seqWriteMbps', type: 'uint64' },
              { name: 'randReadIops', type: 'uint32' },
              { name: 'randWriteIops', type: 'uint32' },
              { name: 'diskType', type: 'string' },
            ],
          },
          {
            name: 'network',
            type: 'tuple',
            components: [
              { name: 'bandwidthMbps', type: 'uint64' },
              { name: 'latencyMs', type: 'uint32' },
              { name: 'uploadMbps', type: 'uint64' },
              { name: 'region', type: 'string' },
              { name: 'ipv6Supported', type: 'bool' },
            ],
          },
          {
            name: 'gpu',
            type: 'tuple',
            components: [
              { name: 'model', type: 'string' },
              { name: 'vramMb', type: 'uint64' },
              { name: 'fp32Tflops', type: 'uint64' },
              { name: 'fp16Tflops', type: 'uint64' },
              { name: 'memoryBandwidthGbps', type: 'uint64' },
              { name: 'inferenceLatencyMs', type: 'uint64' },
              { name: 'cudaCores', type: 'uint32' },
              { name: 'tensorCores', type: 'uint32' },
            ],
          },
          {
            name: 'tee',
            type: 'tuple',
            components: [
              { name: 'teeType', type: 'uint8' },
              { name: 'attestationHash', type: 'bytes32' },
              { name: 'maxEnclaveMemoryMb', type: 'uint64' },
              { name: 'remoteAttestationSupported', type: 'bool' },
              { name: 'lastAttestationTimestamp', type: 'uint64' },
              { name: 'attestationQuote', type: 'bytes' },
            ],
          },
          {
            name: 'result',
            type: 'tuple',
            components: [
              { name: 'provider', type: 'address' },
              { name: 'timestamp', type: 'uint64' },
              { name: 'status', type: 'uint8' },
              { name: 'verifier', type: 'address' },
              { name: 'benchmarkHash', type: 'bytes32' },
              { name: 'overallScore', type: 'uint64' },
              { name: 'costPerScore', type: 'uint64' },
            ],
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getScore',
    type: 'function',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [{ name: '', type: 'uint64' }],
    stateMutability: 'view',
  },
  {
    name: 'isBenchmarkValid',
    type: 'function',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    name: 'getRankedProviders',
    type: 'function',
    inputs: [
      { name: 'minScore', type: 'uint64' },
      { name: 'maxCount', type: 'uint16' },
      { name: 'requireVerified', type: 'bool' },
      { name: 'requireTEE', type: 'bool' },
      { name: 'requireGPU', type: 'bool' },
    ],
    outputs: [
      { name: 'providers', type: 'address[]' },
      { name: 'scores', type: 'uint64[]' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getCostEfficientProviders',
    type: 'function',
    inputs: [
      { name: 'minScore', type: 'uint64' },
      { name: 'maxCount', type: 'uint16' },
    ],
    outputs: [
      { name: 'providers', type: 'address[]' },
      { name: 'costPerScores', type: 'uint64[]' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getBenchmarkedProviderCount',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'authorizedVerifiers',
    type: 'function',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    name: 'benchmarkValidityPeriod',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint64' }],
    stateMutability: 'view',
  },
] as const

// ============ Types ============

export enum VerificationStatus {
  Pending = 0,
  SelfReported = 1,
  Verified = 2,
  Disputed = 3,
  Rejected = 4,
}

export enum TEEType {
  None = 0,
  IntelSGX = 1,
  AMDSEV = 2,
  ArmTrustZone = 3,
  NitroEnclave = 4,
  IntelTDX = 5,
}

export interface OnChainCPUBenchmark {
  coreCount: number
  threadCount: number
  singleThreadScore: bigint
  multiThreadScore: bigint
  compressionScore: bigint
  cpuModel: string
  clockSpeedMhz: bigint
}

export interface OnChainMemoryBenchmark {
  capacityMb: bigint
  bandwidthMbps: bigint
  writeBandwidthMbps: bigint
  latencyNs: number
  memoryType: string
}

export interface OnChainDiskBenchmark {
  capacityGb: bigint
  seqReadMbps: bigint
  seqWriteMbps: bigint
  randReadIops: number
  randWriteIops: number
  diskType: string
}

export interface OnChainNetworkBenchmark {
  bandwidthMbps: bigint
  latencyMs: number
  uploadMbps: bigint
  region: string
  ipv6Supported: boolean
}

export interface OnChainGPUBenchmark {
  model: string
  vramMb: bigint
  fp32Tflops: bigint
  fp16Tflops: bigint
  memoryBandwidthGbps: bigint
  inferenceLatencyMs: bigint
  cudaCores: number
  tensorCores: number
}

export interface OnChainTEEBenchmark {
  teeType: TEEType
  attestationHash: Hex
  maxEnclaveMemoryMb: bigint
  remoteAttestationSupported: boolean
  lastAttestationTimestamp: bigint
  attestationQuote: Hex
}

export interface OnChainBenchmarkResult {
  provider: Address
  timestamp: bigint
  status: VerificationStatus
  verifier: Address
  benchmarkHash: Hex
  overallScore: bigint
  costPerScore: bigint
}

export interface OnChainProviderBenchmarks {
  cpu: OnChainCPUBenchmark
  memory_: OnChainMemoryBenchmark
  disk: OnChainDiskBenchmark
  network: OnChainNetworkBenchmark
  gpu: OnChainGPUBenchmark
  tee: OnChainTEEBenchmark
  result: OnChainBenchmarkResult
}

// ============ Client ============

export class BenchmarkRegistryClient {
  private publicClient: PublicClient
  private walletClient: WalletClient | null = null
  private contractAddress: Address
  private network: NetworkEnvironment

  constructor(network: NetworkEnvironment, contractAddress: Address) {
    this.network = network
    this.contractAddress = contractAddress

    const chain = this.getChain()
    const config = NETWORK_CONFIG[network]

    this.publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    }) as PublicClient
  }

  private account: Account | null = null

  /**
   * Initialize with a wallet for write operations
   */
  initializeWallet(privateKey: Hex): void {
    this.account = privateKeyToAccount(privateKey)
    const chain = this.getChain()
    const config = NETWORK_CONFIG[this.network]

    this.walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(config.rpcUrl),
    })
  }

  private getChain() {
    switch (this.network) {
      case 'mainnet':
        return base
      case 'testnet':
        return baseSepolia
      case 'localnet':
        return foundry
      default:
        return baseSepolia
    }
  }

  // ============ Read Functions ============

  /**
   * Get benchmark for a provider
   */
  async getBenchmark(provider: Address): Promise<OnChainProviderBenchmarks> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: BENCHMARK_REGISTRY_ABI,
      functionName: 'getBenchmark',
      args: [provider],
    })

    return result as OnChainProviderBenchmarks
  }

  /**
   * Get overall score for a provider
   */
  async getScore(provider: Address): Promise<bigint> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: BENCHMARK_REGISTRY_ABI,
      functionName: 'getScore',
      args: [provider],
    })

    return result as bigint
  }

  /**
   * Check if benchmark is still valid
   */
  async isBenchmarkValid(provider: Address): Promise<boolean> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: BENCHMARK_REGISTRY_ABI,
      functionName: 'isBenchmarkValid',
      args: [provider],
    })

    return result as boolean
  }

  /**
   * Get providers ranked by score
   */
  async getRankedProviders(params: {
    minScore?: bigint
    maxCount?: number
    requireVerified?: boolean
    requireTEE?: boolean
    requireGPU?: boolean
  }): Promise<{ providers: Address[]; scores: bigint[] }> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: BENCHMARK_REGISTRY_ABI,
      functionName: 'getRankedProviders',
      args: [
        params.minScore ?? 0n,
        params.maxCount ?? 100,
        params.requireVerified ?? false,
        params.requireTEE ?? false,
        params.requireGPU ?? false,
      ],
    })

    const [providers, scores] = result as [Address[], bigint[]]
    return { providers, scores }
  }

  /**
   * Get providers ranked by cost efficiency
   */
  async getCostEfficientProviders(params: {
    minScore?: bigint
    maxCount?: number
  }): Promise<{ providers: Address[]; costPerScores: bigint[] }> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: BENCHMARK_REGISTRY_ABI,
      functionName: 'getCostEfficientProviders',
      args: [params.minScore ?? 0n, params.maxCount ?? 100],
    })

    const [providers, costPerScores] = result as [Address[], bigint[]]
    return { providers, costPerScores }
  }

  /**
   * Get total benchmarked provider count
   */
  async getBenchmarkedProviderCount(): Promise<bigint> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: BENCHMARK_REGISTRY_ABI,
      functionName: 'getBenchmarkedProviderCount',
    })

    return result as bigint
  }

  /**
   * Check if address is authorized verifier
   */
  async isAuthorizedVerifier(address: Address): Promise<boolean> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: BENCHMARK_REGISTRY_ABI,
      functionName: 'authorizedVerifiers',
      args: [address],
    })

    return result as boolean
  }

  /**
   * Get benchmark validity period
   */
  async getBenchmarkValidityPeriod(): Promise<bigint> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: BENCHMARK_REGISTRY_ABI,
      functionName: 'benchmarkValidityPeriod',
    })

    return result as bigint
  }

  // ============ Write Functions ============

  /**
   * Submit benchmark results on-chain
   */
  async submitBenchmark(results: BenchmarkResults): Promise<Hex> {
    if (!this.walletClient) {
      throw new Error('Wallet not initialized - call initializeWallet first')
    }

    const cpu = {
      coreCount: results.cpuCores,
      threadCount: results.cpuCores * 2, // Assume hyperthreading
      singleThreadScore: BigInt(results.cpuSingleCore),
      multiThreadScore: BigInt(results.cpuMultiCore),
      compressionScore: BigInt(results.sequentialReadMbps), // Proxy for compression
      cpuModel: results.cpuModel,
      clockSpeedMhz: BigInt(results.cpuFrequencyMhz),
    }

    const memory = {
      capacityMb: BigInt(results.memoryMb),
      bandwidthMbps: BigInt(results.memoryBandwidthMbps),
      writeBandwidthMbps: BigInt(results.memoryBandwidthMbps), // Same for now
      latencyNs: results.memoryLatencyNs,
      memoryType: 'DDR4', // Default
    }

    const disk = {
      capacityGb: BigInt(Math.floor(results.storageMb / 1024)),
      seqReadMbps: BigInt(results.sequentialReadMbps),
      seqWriteMbps: BigInt(results.sequentialWriteMbps),
      randReadIops: results.randomReadIops,
      randWriteIops: results.randomWriteIops,
      diskType: results.storageType === 'nvme' ? 'NVMe SSD' : results.storageType === 'ssd' ? 'SATA SSD' : 'HDD',
    }

    const network = {
      bandwidthMbps: BigInt(results.networkBandwidthMbps),
      latencyMs: Math.floor(results.networkLatencyMs),
      uploadMbps: BigInt(results.networkBandwidthMbps), // Same for now
      region: 'unknown',
      ipv6Supported: true,
    }

    const gpu = {
      model: results.gpuModel ?? '',
      vramMb: BigInt(results.gpuMemoryMb ?? 0),
      fp32Tflops: BigInt(Math.floor((results.gpuFp32Tflops ?? 0) * 100)), // 0.01 TFLOPS precision
      fp16Tflops: BigInt(Math.floor((results.gpuFp32Tflops ?? 0) * 200)), // Assume 2x for FP16
      memoryBandwidthGbps: BigInt(0),
      inferenceLatencyMs: BigInt(0),
      cudaCores: 0,
      tensorCores: 0,
    }

    const teeType = this.mapTeePlatform(results.teePlatform)
    const tee = {
      teeType,
      attestationHash: (results.teeAttestationHash ?? '0x0000000000000000000000000000000000000000000000000000000000000000') as Hex,
      maxEnclaveMemoryMb: BigInt(0),
      remoteAttestationSupported: results.teeDetected,
      lastAttestationTimestamp: results.teeDetected ? BigInt(results.timestamp) : BigInt(0),
      attestationQuote: '0x' as Hex,
    }

    const data = encodeFunctionData({
      abi: BENCHMARK_REGISTRY_ABI,
      functionName: 'submitBenchmark',
      args: [cpu, memory, disk, network, gpu, tee],
    })

    if (!this.account) {
      throw new Error('Account not initialized')
    }

    const hash = await this.walletClient.sendTransaction({
      account: this.account,
      to: this.contractAddress,
      data,
      chain: this.getChain(),
    })

    return hash
  }

  /**
   * Verify a provider's benchmark (verifier only)
   */
  async verifyBenchmark(provider: Address, status: VerificationStatus): Promise<Hex> {
    if (!this.walletClient || !this.account) {
      throw new Error('Wallet not initialized')
    }

    const data = encodeFunctionData({
      abi: BENCHMARK_REGISTRY_ABI,
      functionName: 'verifyBenchmark',
      args: [provider, status],
    })

    const hash = await this.walletClient.sendTransaction({
      account: this.account,
      to: this.contractAddress,
      data,
      chain: this.getChain(),
    })

    return hash
  }

  /**
   * Verify TEE attestation
   */
  async verifyTEEAttestation(
    provider: Address,
    attestationQuote: Hex,
    expectedHash: Hex,
  ): Promise<Hex> {
    if (!this.walletClient || !this.account) {
      throw new Error('Wallet not initialized')
    }

    const data = encodeFunctionData({
      abi: BENCHMARK_REGISTRY_ABI,
      functionName: 'verifyTEEAttestation',
      args: [provider, attestationQuote, expectedHash],
    })

    const hash = await this.walletClient.sendTransaction({
      account: this.account,
      to: this.contractAddress,
      data,
      chain: this.getChain(),
    })

    return hash
  }

  // ============ Helpers ============

  private mapTeePlatform(platform: string | null): TEEType {
    if (!platform) return TEEType.None

    switch (platform.toLowerCase()) {
      case 'intel_sgx':
      case 'intel-sgx':
        return TEEType.IntelSGX
      case 'intel_tdx':
      case 'intel-tdx':
        return TEEType.IntelTDX
      case 'amd_sev':
      case 'amd-sev':
        return TEEType.AMDSEV
      case 'arm_trustzone':
        return TEEType.ArmTrustZone
      case 'nitro':
        return TEEType.NitroEnclave
      default:
        return TEEType.None
    }
  }

  /**
   * Convert on-chain benchmark to local format
   */
  toLocalFormat(onChain: OnChainProviderBenchmarks): BenchmarkResults {
    return {
      cpuSingleCore: Number(onChain.cpu.singleThreadScore),
      cpuMultiCore: Number(onChain.cpu.multiThreadScore),
      cpuCores: onChain.cpu.coreCount,
      cpuModel: onChain.cpu.cpuModel,
      cpuFrequencyMhz: Number(onChain.cpu.clockSpeedMhz),
      memoryMb: Number(onChain.memory_.capacityMb),
      memoryBandwidthMbps: Number(onChain.memory_.bandwidthMbps),
      memoryLatencyNs: onChain.memory_.latencyNs,
      storageMb: Number(onChain.disk.capacityGb) * 1024,
      storageType: onChain.disk.diskType.includes('NVMe') ? 'nvme' : onChain.disk.diskType.includes('SSD') ? 'ssd' : 'hdd',
      sequentialReadMbps: Number(onChain.disk.seqReadMbps),
      sequentialWriteMbps: Number(onChain.disk.seqWriteMbps),
      randomReadIops: onChain.disk.randReadIops,
      randomWriteIops: onChain.disk.randWriteIops,
      networkBandwidthMbps: Number(onChain.network.bandwidthMbps),
      networkLatencyMs: onChain.network.latencyMs,
      gpuDetected: onChain.gpu.model.length > 0,
      gpuModel: onChain.gpu.model || null,
      gpuMemoryMb: Number(onChain.gpu.vramMb) || null,
      gpuFp32Tflops: Number(onChain.gpu.fp32Tflops) / 100 || null,
      gpuInferenceScore: null,
      teeDetected: onChain.tee.teeType !== TEEType.None,
      teePlatform: this.teeTypeToString(onChain.tee.teeType),
      teeAttestationHash: onChain.tee.attestationHash,
      teeAttestationValid: onChain.tee.lastAttestationTimestamp > 0n,
      overallScore: Number(onChain.result.overallScore),
      attestationHash: onChain.result.benchmarkHash,
      timestamp: Number(onChain.result.timestamp) * 1000,
    }
  }

  private teeTypeToString(teeType: TEEType): string | null {
    switch (teeType) {
      case TEEType.IntelSGX:
        return 'intel_sgx'
      case TEEType.IntelTDX:
        return 'intel_tdx'
      case TEEType.AMDSEV:
        return 'amd_sev'
      case TEEType.ArmTrustZone:
        return 'arm_trustzone'
      case TEEType.NitroEnclave:
        return 'nitro'
      default:
        return null
    }
  }
}

// ============ Factory ============

let registryClient: BenchmarkRegistryClient | null = null

export function getBenchmarkRegistryClient(
  network: NetworkEnvironment,
  contractAddress: Address,
): BenchmarkRegistryClient {
  if (!registryClient) {
    registryClient = new BenchmarkRegistryClient(network, contractAddress)
  }
  return registryClient
}

export function initializeBenchmarkRegistryClient(
  network: NetworkEnvironment,
  contractAddress: Address,
  privateKey?: Hex,
): BenchmarkRegistryClient {
  registryClient = new BenchmarkRegistryClient(network, contractAddress)
  if (privateKey) {
    registryClient.initializeWallet(privateKey)
  }
  return registryClient
}
