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

import { getL1RpcUrl } from '@jejunetwork/config'
import type { Account, Address, Hex, PublicClient, WalletClient } from 'viem'
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
  localnet: { rpcUrl: getL1RpcUrl() },
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
  {
    name: 'disputeBenchmark',
    type: 'function',
    inputs: [
      { name: 'provider', type: 'address' },
      { name: 'reason', type: 'string' },
    ],
    outputs: [{ name: 'disputeIndex', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'resolveDispute',
    type: 'function',
    inputs: [
      { name: 'provider', type: 'address' },
      { name: 'disputeIndex', type: 'uint256' },
      { name: 'upheld', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getDisputes',
    type: 'function',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [
      {
        name: 'disputes',
        type: 'tuple[]',
        components: [
          { name: 'disputer', type: 'address' },
          { name: 'timestamp', type: 'uint64' },
          { name: 'reason', type: 'string' },
          { name: 'resolved', type: 'bool' },
          { name: 'upheld', type: 'bool' },
        ],
      },
    ],
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

    // Derive thread count from model if not explicitly provided
    // Most modern CPUs have SMT/HT, but some (like ARM) may not
    const estimatedThreads = this.estimateThreadCount(
      results.cpuModel,
      results.cpuCores,
    )

    // Compression score is derived from multi-core performance
    // since compression is typically parallelizable
    const compressionScore = Math.floor(results.cpuMultiCore * 0.85)

    const cpu = {
      coreCount: results.cpuCores,
      threadCount: estimatedThreads,
      singleThreadScore: BigInt(results.cpuSingleCore),
      multiThreadScore: BigInt(results.cpuMultiCore),
      compressionScore: BigInt(compressionScore),
      cpuModel: results.cpuModel,
      clockSpeedMhz: BigInt(results.cpuFrequencyMhz),
    }

    // Derive memory type from bandwidth characteristics
    // DDR4: ~20-25 GB/s, DDR5: ~40-50 GB/s per channel
    const memoryType = this.inferMemoryType(results.memoryBandwidthMbps)

    // Write bandwidth is typically ~90% of read bandwidth
    const writeBandwidth = Math.floor(results.memoryBandwidthMbps * 0.9)

    const memory = {
      capacityMb: BigInt(results.memoryMb),
      bandwidthMbps: BigInt(results.memoryBandwidthMbps),
      writeBandwidthMbps: BigInt(writeBandwidth),
      latencyNs: results.memoryLatencyNs,
      memoryType,
    }

    const disk = {
      capacityGb: BigInt(Math.floor(results.storageMb / 1024)),
      seqReadMbps: BigInt(results.sequentialReadMbps),
      seqWriteMbps: BigInt(results.sequentialWriteMbps),
      randReadIops: results.randomReadIops,
      randWriteIops: results.randomWriteIops,
      diskType:
        results.storageType === 'nvme'
          ? 'NVMe SSD'
          : results.storageType === 'ssd'
            ? 'SATA SSD'
            : 'HDD',
    }

    // Derive upload bandwidth from download (typically 80-100% depending on connection)
    const uploadBandwidth = Math.floor(results.networkBandwidthMbps * 0.9)

    const network = {
      bandwidthMbps: BigInt(results.networkBandwidthMbps),
      latencyMs: Math.floor(results.networkLatencyMs),
      uploadMbps: BigInt(uploadBandwidth),
      region: results.region ?? 'unknown', // From BenchmarkResults if available
      ipv6Supported: results.ipv6Supported ?? false,
    }

    // For GPU, use actual values where available
    const gpuFp32 = results.gpuFp32Tflops ?? 0
    const gpuFp16 = gpuFp32 * 2 // FP16 is typically 2x FP32 for modern GPUs

    const gpu = {
      model: results.gpuModel ?? '',
      vramMb: BigInt(results.gpuMemoryMb ?? 0),
      fp32Tflops: BigInt(Math.floor(gpuFp32 * 100)), // 0.01 TFLOPS precision
      fp16Tflops: BigInt(Math.floor(gpuFp16 * 100)),
      memoryBandwidthGbps: BigInt(
        this.estimateGpuMemoryBandwidth(results.gpuModel),
      ),
      inferenceLatencyMs: BigInt(results.gpuInferenceScore ?? 0),
      cudaCores: this.estimateCudaCores(results.gpuModel),
      tensorCores: this.estimateTensorCores(results.gpuModel),
    }

    const teeType = this.mapTeePlatform(results.teePlatform)
    const tee = {
      teeType,
      attestationHash: (results.teeAttestationHash ??
        '0x0000000000000000000000000000000000000000000000000000000000000000') as Hex,
      maxEnclaveMemoryMb: BigInt(0),
      remoteAttestationSupported: results.teeDetected,
      lastAttestationTimestamp: results.teeDetected
        ? BigInt(results.timestamp)
        : BigInt(0),
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
  async verifyBenchmark(
    provider: Address,
    status: VerificationStatus,
  ): Promise<Hex> {
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

  /**
   * Dispute a provider's benchmark as potentially fraudulent
   * @param provider Provider address
   * @param reason Reason for the dispute
   * @returns Transaction hash
   */
  async disputeBenchmark(provider: Address, reason: string): Promise<Hex> {
    if (!this.walletClient || !this.account) {
      throw new Error('Wallet not initialized')
    }

    console.log(
      `[BenchmarkRegistry] Disputing benchmark for ${provider}: ${reason}`,
    )

    const data = encodeFunctionData({
      abi: BENCHMARK_REGISTRY_ABI,
      functionName: 'disputeBenchmark',
      args: [provider, reason],
    })

    const hash = await this.walletClient.sendTransaction({
      account: this.account,
      to: this.contractAddress,
      data,
      chain: this.getChain(),
    })

    console.log(`[BenchmarkRegistry] Dispute submitted: ${hash}`)
    return hash
  }

  /**
   * Get disputes for a provider
   */
  async getDisputes(provider: Address): Promise<
    Array<{
      disputer: Address
      timestamp: bigint
      reason: string
      resolved: boolean
      upheld: boolean
    }>
  > {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: BENCHMARK_REGISTRY_ABI,
      functionName: 'getDisputes',
      args: [provider],
    })

    return result as Array<{
      disputer: Address
      timestamp: bigint
      reason: string
      resolved: boolean
      upheld: boolean
    }>
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
   * Estimate thread count based on CPU model
   */
  private estimateThreadCount(cpuModel: string, cores: number): number {
    const model = cpuModel.toLowerCase()

    // AMD Ryzen and EPYC typically have SMT (2 threads per core)
    if (
      model.includes('ryzen') ||
      model.includes('epyc') ||
      model.includes('threadripper')
    ) {
      return cores * 2
    }

    // Intel with hyperthreading
    if (
      model.includes('xeon') ||
      model.includes('core i') ||
      model.includes('i5') ||
      model.includes('i7') ||
      model.includes('i9')
    ) {
      return cores * 2
    }

    // ARM typically no SMT
    if (
      model.includes('arm') ||
      model.includes('graviton') ||
      model.includes('ampere')
    ) {
      return cores
    }

    // Default: assume hyperthreading for x86
    return cores * 2
  }

  /**
   * Infer memory type from bandwidth
   */
  private inferMemoryType(bandwidthMbps: number): string {
    const bandwidthGBps = bandwidthMbps / 1000

    if (bandwidthGBps > 200) return 'HBM2e' // High bandwidth memory
    if (bandwidthGBps > 100) return 'DDR5-6400'
    if (bandwidthGBps > 60) return 'DDR5-4800'
    if (bandwidthGBps > 40) return 'DDR4-3600'
    if (bandwidthGBps > 25) return 'DDR4-3200'
    if (bandwidthGBps > 15) return 'DDR4-2666'
    return 'DDR4-2133'
  }

  /**
   * Estimate GPU memory bandwidth from model
   */
  private estimateGpuMemoryBandwidth(gpuModel: string | null): number {
    if (!gpuModel) return 0

    const model = gpuModel.toLowerCase()

    // NVIDIA GPUs
    if (model.includes('h100')) return 3350 // GB/s
    if (model.includes('a100')) return 2039
    if (model.includes('l40')) return 864
    if (model.includes('rtx 4090')) return 1008
    if (model.includes('rtx 4080')) return 717
    if (model.includes('rtx 3090')) return 936
    if (model.includes('rtx 3080')) return 760
    if (model.includes('v100')) return 900
    if (model.includes('t4')) return 320

    // AMD GPUs
    if (model.includes('mi300')) return 5300
    if (model.includes('mi250')) return 3200
    if (model.includes('mi100')) return 1228

    return 0
  }

  /**
   * Estimate CUDA cores from model
   */
  private estimateCudaCores(gpuModel: string | null): number {
    if (!gpuModel) return 0

    const model = gpuModel.toLowerCase()

    if (model.includes('h100')) return 16896
    if (model.includes('a100')) return 6912
    if (model.includes('l40')) return 18176
    if (model.includes('rtx 4090')) return 16384
    if (model.includes('rtx 4080')) return 9728
    if (model.includes('rtx 3090')) return 10496
    if (model.includes('rtx 3080')) return 8704
    if (model.includes('v100')) return 5120
    if (model.includes('t4')) return 2560

    return 0
  }

  /**
   * Estimate Tensor cores from model
   */
  private estimateTensorCores(gpuModel: string | null): number {
    if (!gpuModel) return 0

    const model = gpuModel.toLowerCase()

    if (model.includes('h100')) return 528
    if (model.includes('a100')) return 432
    if (model.includes('l40')) return 568
    if (model.includes('rtx 4090')) return 512
    if (model.includes('rtx 4080')) return 304
    if (model.includes('rtx 3090')) return 328
    if (model.includes('rtx 3080')) return 272
    if (model.includes('v100')) return 640
    if (model.includes('t4')) return 320

    return 0
  }

  /**
   * Convert on-chain benchmark to local format
   */
  toLocalFormat(onChain: OnChainProviderBenchmarks): BenchmarkResults {
    // Handle GPU values carefully - 0 is a valid value, only use null if model is empty
    const hasGpu = onChain.gpu.model.length > 0
    const gpuMemory = Number(onChain.gpu.vramMb)
    const gpuFp32 = Number(onChain.gpu.fp32Tflops) / 100

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
      storageType: onChain.disk.diskType.includes('NVMe')
        ? 'nvme'
        : onChain.disk.diskType.includes('SSD')
          ? 'ssd'
          : 'hdd',
      sequentialReadMbps: Number(onChain.disk.seqReadMbps),
      sequentialWriteMbps: Number(onChain.disk.seqWriteMbps),
      randomReadIops: onChain.disk.randReadIops,
      randomWriteIops: onChain.disk.randWriteIops,
      networkBandwidthMbps: Number(onChain.network.bandwidthMbps),
      networkLatencyMs: onChain.network.latencyMs,
      region: onChain.network.region,
      ipv6Supported: onChain.network.ipv6Supported,
      gpuDetected: hasGpu,
      gpuModel: hasGpu ? onChain.gpu.model : null,
      gpuMemoryMb: hasGpu ? gpuMemory : null,
      gpuFp32Tflops: hasGpu ? gpuFp32 : null,
      gpuInferenceScore: hasGpu ? Number(onChain.gpu.inferenceLatencyMs) : null,
      teeDetected: onChain.tee.teeType !== TEEType.None,
      teePlatform: this.teeTypeToString(onChain.tee.teeType),
      teeAttestationHash: onChain.tee.attestationHash,
      teeAttestationValid: onChain.tee.lastAttestationTimestamp > 0n,
      // PoC fields - not stored on-chain in this struct, default to null/false
      pocVerified: false,
      pocLevel: null,
      pocCloudProvider: null,
      pocRegion: null,
      pocHardwareIdHash: null,
      pocReputationDelta: 0,
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
