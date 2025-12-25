/**
 * DWS Types
 */

import type { Address, Hash, Hex } from 'viem'
import { z } from 'zod'

// ============================================================================
// Common JSON Response Types
// ============================================================================

/** Basic CID response from storage upload */
export interface CidResponse {
  cid: string
}

export const CidResponseSchema = z.object({ cid: z.string() })

/** IPFS add response */
export interface IpfsAddResponse {
  Hash: string
  Name?: string
  Size?: string
}

export const IpfsAddResponseSchema = z.object({
  Hash: z.string(),
  Name: z.string().optional(),
  Size: z.string().optional(),
})

/** Generic JSON-RPC response */
export interface JsonRpcResponse<T> {
  jsonrpc?: string
  id?: number | string
  result?: T
  error?: {
    code: number
    message: string
    data?: string
  }
}

/** Flashbots/MEV-Share result types */
export interface ProtectedTxResult {
  hash?: Hash
  status?: string
}

export interface FlashbotsBundleResult {
  bundleHash?: Hash
}

export interface FlashbotsTxStatusResult {
  status: string
  includedBlock?: string
}

/** Docker API response types */
export interface DockerCreateResponse {
  Id: string
  Warnings?: string[]
}

export const DockerCreateResponseSchema = z.object({
  Id: z.string(),
  Warnings: z.array(z.string()).optional(),
})

export interface DockerExecCreateResponse {
  Id: string
}

export const DockerExecCreateResponseSchema = z.object({
  Id: z.string(),
})

export interface DockerExecInspect {
  ExitCode: number
  Running?: boolean
}

export const DockerExecInspectSchema = z.object({
  ExitCode: z.number(),
  Running: z.boolean().optional(),
})

export interface DockerInspectResponse {
  State: {
    Status: string
    Running: boolean
    ExitCode: number
    Pid: number
  }
  NetworkSettings?: {
    IPAddress?: string
    Ports?: Record<string, Array<{ HostIp: string; HostPort: string }>>
  }
}

/** Training/ML response types */
export interface TrainingJobResponse {
  jobId: string
  status?: string
}

export interface TrainingStatusResponse {
  status: string
  started?: boolean
  progress?: number
  error?: string
}

export interface ScoringResponse {
  scores: number[]
}

export interface BatchDataResponse {
  batch: Array<{
    prompt: string
    response: string
    score?: number
  }> | null
}

export interface EnvironmentResponse {
  env_id: number
}

/** Edge node response types */
export interface EdgeNodeResponse {
  nodeId: string
  status?: string
}

/** Compute response types */
export interface ComputeInferenceResult {
  id: string
  model: string
  choices?: Array<{
    message: { content: string }
  }>
  usage?: {
    total_tokens: number
    prompt_tokens?: number
    completion_tokens?: number
  }
  error?: string
}

/** TEE attestation response */
export interface AttestationQuoteResponse {
  quote: string
  event_log: string
}

/** Contract registry types */
export interface RegistryOwnerData {
  owner: Address
  registeredAt: bigint
  isBanned: boolean
}

/** KMS encryption/decryption response types */
export interface KmsEncryptResponse {
  ciphertext: string
  keyId: string
}

export const KmsEncryptResponseSchema = z.object({
  ciphertext: z.string(),
  keyId: z.string(),
})

export interface KmsDecryptResponse {
  plaintext: string
}

export const KmsDecryptResponseSchema = z.object({
  plaintext: z.string(),
})

/** CDN invalidation request response */
export interface InvalidationRequestResponse {
  requestId: string
  nodesTotal: number
}

// ============================================================================
// Flashbots/MEV Response Types
// ============================================================================

/** Generic Flashbots/MEV RPC response */
export interface FlashbotsRpcResponse<T> {
  jsonrpc?: string
  id?: number | string
  result?: T
  error?: {
    code?: number
    message: string
  }
}

/** Protect RPC hash response */
export type ProtectedTxRpcResponse = FlashbotsRpcResponse<Hash>

/** Cancel transaction response */
export type CancelTxRpcResponse = FlashbotsRpcResponse<boolean>

/** Protected transaction status response */
export interface ProtectedTxStatusResult {
  status: string
  includedBlock?: string
}

/** Bundle submission result */
export interface BundleSubmitResult {
  bundleHash: Hash
}

/** Bundle stats result */
export interface BundleStatsResult {
  isHighPriority: boolean
  isSentToMiners: boolean
  isSimulated: boolean
  simulatedAt?: string
  receivedAt?: string
  consideredByBuildersAt?: string[]
}

/** User stats result */
export interface UserStatsResult {
  isHighPriority: boolean
  allTimeMinerPayments: string
  allTimeGasSimulated: string
  last7dMinerPayments: string
  last7dGasSimulated: string
  last1dMinerPayments: string
  last1dGasSimulated: string
}

/** Bundle simulation result */
export interface BundleSimulationResult {
  bundleGasPrice: string
  bundleHash: Hash
  coinbaseDiff: string
  ethSentToCoinbase: string
  gasFees: string
  results: Array<{
    txHash: Hash
    gasUsed: number
    gasPrice: string
    gasFees: string
    fromAddress: Address
    toAddress: Address
    coinbaseDiff: string
    ethSentToCoinbase: string
    value: string
    error?: string
    revert?: string
  }>
  stateBlockNumber: number
  totalGasUsed: number
}

/** MEV-Share hint configuration */
export interface MevShareHintConfig {
  logs: boolean
  calldata: boolean
  contractAddress: boolean
  functionSelector: boolean
}

/** MEV-Share send result */
export interface MevShareSendResult {
  bundleHash: Hash
}

/** Suave confidential compute result */
export interface SuaveConfidentialResult {
  executionResult: string
  confidentialDataHash: Hex
}

/** Rollup boost bid result */
export interface RollupBoostBidResult {
  bidId: string
  accepted: boolean
}

/** Call bundle simulation result */
export interface CallBundleResult {
  results: Array<{
    txHash: string
    gasUsed: string
    value: string
    error?: string
  }>
  totalGasUsed: string
  coinbaseDiff: string
  ethSentToCoinbase: string
}

/** Rollup L2 block submission result */
export interface L2BlockSubmitResult {
  blockHash: Hash
}

/** SUAVE request result */
export interface SuaveRequestResult {
  requestId: Hash
}

/** Docker container inspect network settings */
export interface DockerNetworkSettings {
  NetworkSettings: { Ports: Record<string, Array<{ HostPort: string }>> }
}

export const DockerNetworkSettingsSchema = z.object({
  NetworkSettings: z.object({
    Ports: z.record(z.string(), z.array(z.object({ HostPort: z.string() }))),
  }),
})

/** Simple count response */
export interface CountResponse {
  count: number
}

export const CountResponseSchema = z.object({
  count: z.number(),
})

/** CQL query rows response schema factory */
export function createCqlRowsResponseSchema<T extends z.ZodTypeAny>(
  rowSchema: T,
) {
  return z.object({
    rows: z.array(rowSchema).optional(),
  })
}

/** CQL query rows response */
export interface CqlRowsResponse<T> {
  rows?: T[]
}

/** S3 list objects response */
export interface S3ListObjectsResponse {
  Name: string
  Prefix: string
  KeyCount: number
  MaxKeys: number
  IsTruncated: boolean
  Contents: Array<{
    Key: string
    LastModified: string
    ETag: string
    Size: number
    StorageClass: string
  }>
  CommonPrefixes: Array<{ Prefix: string }>
}

// ============================================================================
// External Solver API Response Types
// ============================================================================

/** CoW Protocol auction data response */
export interface CowAuctionResponse {
  auctionId: number
  orders: Array<{
    uid: string
    sellToken: string
    buyToken: string
    sellAmount: string
    buyAmount: string
    kind: string
    partiallyFillable: boolean
  }>
  solutions: Array<{
    solver: string
    score: string
    ranking: number
    orders: Array<{ id: string; executedAmount: string }>
  }>
}

export const CowAuctionResponseSchema = z.object({
  auctionId: z.number(),
  orders: z.array(
    z.object({
      uid: z.string(),
      sellToken: z.string(),
      buyToken: z.string(),
      sellAmount: z.string(),
      buyAmount: z.string(),
      kind: z.string(),
      partiallyFillable: z.boolean(),
    }),
  ),
  solutions: z.array(
    z.object({
      solver: z.string(),
      score: z.string(),
      ranking: z.number(),
      orders: z.array(z.object({ id: z.string(), executedAmount: z.string() })),
    }),
  ),
})

/** UniswapX orders response */
export interface UniswapXOrdersResponse {
  orders: Array<{
    orderHash: string
    chainId: number
    swapper: string
    reactor: string
    deadline: number
    input: { token: string; startAmount: string; endAmount: string }
    outputs: Array<{
      token: string
      startAmount: string
      endAmount: string
      recipient: string
    }>
    decayStartTime: number
    decayEndTime: number
    exclusiveFiller?: string
    exclusivityOverrideBps?: number
    nonce: string
    encodedOrder: string
    signature: string
    createdAt: number
    orderStatus: string
  }>
}

export const UniswapXOrdersResponseSchema = z.object({
  orders: z.array(
    z.object({
      orderHash: z.string(),
      chainId: z.number(),
      swapper: z.string(),
      reactor: z.string(),
      deadline: z.number(),
      input: z.object({
        token: z.string(),
        startAmount: z.string(),
        endAmount: z.string(),
      }),
      outputs: z.array(
        z.object({
          token: z.string(),
          startAmount: z.string(),
          endAmount: z.string(),
          recipient: z.string(),
        }),
      ),
      decayStartTime: z.number(),
      decayEndTime: z.number(),
      exclusiveFiller: z.string().optional(),
      exclusivityOverrideBps: z.number().optional(),
      nonce: z.string(),
      encodedOrder: z.string(),
      signature: z.string(),
      createdAt: z.number(),
      orderStatus: z.string(),
    }),
  ),
})

/** Workerd router response */
export interface WorkerdRouterResponse {
  response: {
    status: number
    headers: Record<string, string>
    body: string
  }
}

/** Git leaderboard data response */
export interface LeaderboardDataResponse {
  contributors: Array<{
    username: string
    wallet?: string
    totalScore: number
  }>
}

// ============================================================================
// TEE and Attestation Response Types
// ============================================================================

/** TEE GPU attestation response */
export interface TeeGpuAttestationResponse {
  quote: string
  mr_enclave: string
  mr_signer: string
  report_data: string
  timestamp: number
}

export const TeeGpuAttestationResponseSchema = z.object({
  quote: z.string(),
  mr_enclave: z.string(),
  mr_signer: z.string(),
  report_data: z.string(),
  timestamp: z.number(),
})

/** TEE quote response */
export interface TeeQuoteResponse {
  quote: string
  event_log: string
}

// ============================================================================
// Inference and Model Response Types
// ============================================================================

/** Anthropic API response */
export interface AnthropicResponse {
  content: Array<{ text: string }>
  usage: { input_tokens: number; output_tokens: number }
}

// ============================================================================
// Arweave Response Types
// ============================================================================

/** Arweave bundlr upload response */
export interface ArweaveUploadResponse {
  id: string
  price?: string
}

/** Arweave transaction status response */
export interface ArweaveStatusResponse {
  number_of_confirmations?: number
  block_height?: number
}

/** Arweave GraphQL transaction query response */
export interface ArweaveGraphqlResponse {
  data?: {
    transactions?: {
      edges?: Array<{
        node: {
          id: string
          tags?: Array<{ name: string; value: string }>
        }
      }>
    }
  }
}

/** Arweave USD rate response */
export interface ArweaveRateResponse {
  arweave?: { usd?: number }
}

export interface WorkerRegistrationData {
  workerId: Hex
  owner: Address
  workerType: number
  endpoint: string
  attestationHash: Hex
  registeredAt: bigint
  lastHeartbeat: bigint
  isActive: boolean
  totalJobs: bigint
  totalRewards: bigint
}

export interface DWSConfig {
  rpcUrl: string
  privateKey?: string
  contracts: {
    storageRegistry?: Address
    computeRegistry?: Address
    jnsRegistry?: Address
  }
}

export interface ServiceHealth {
  status: 'healthy' | 'degraded' | 'unhealthy'
  service: string
  version: string
  uptime: number
}

export interface AuthHeaders {
  'x-jeju-address': string
  'x-jeju-nonce': string
  'x-jeju-signature': string
  'x-jeju-timestamp': string
}

export type StorageTier = 0 | 1 | 2 | 3
export type BackendType = 'ipfs' | 'cloud' | 'arweave' | 'local'

export interface UploadResult {
  cid: string
  url: string
  size: number
  backend: string
  provider?: string
}

export interface InferenceRequest {
  model: string
  messages: Array<{ role: string; content: string }>
  max_tokens?: number
  temperature?: number
  stream?: boolean
}

export interface InferenceResponse {
  id: string
  model: string
  choices: Array<{
    index: number
    message: { role: string; content: string }
    finish_reason: string
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

