/**
 * Validation utilities and schemas for bridge package
 *
 * Use these to validate external data at entry points instead of
 * hiding bugs with ?? or || fallbacks.
 */

import { z } from 'zod'
import type { Hash32 } from '../types/index.js'
import { toHash32 } from '../types/index.js'

/**
 * Get required environment variable or throw
 */
export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`)
  }
  return value
}

/**
 * Get HOME directory with validation
 */
export function getHomeDir(): string {
  const home = process.env.HOME
  if (!home) {
    throw new Error('HOME environment variable is not set')
  }
  return home
}

/**
 * Convert Hash32 to hex string
 */
export function hashToHex(hash: Hash32): string {
  return Array.from(hash)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Convert hex string to Hash32
 */
export function hexToHash32(hex: string): Hash32 {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex
  if (cleanHex.length !== 64) {
    throw new Error(
      `Invalid hex length for Hash32: expected 64, got ${cleanHex.length}`,
    )
  }
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16)
  }
  return toHash32(bytes)
}

/**
 * Compute Merkle root from leaf hashes using keccak256
 * Standard Merkle tree: duplicate last element for odd-length levels
 */
export function computeMerkleRoot(
  leaves: Hash32[],
  hashFn: (data: Uint8Array) => Uint8Array,
): Hash32 {
  if (leaves.length === 0) {
    return toHash32(new Uint8Array(32))
  }

  if (leaves.length === 1) {
    return leaves[0]
  }

  let currentLevel: Uint8Array[] = leaves.map((h) => new Uint8Array(h))

  while (currentLevel.length > 1) {
    const nextLevel: Uint8Array[] = []

    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i]
      // Standard Merkle tree behavior: duplicate last element if odd number of nodes
      const right = currentLevel[i + 1] ?? left

      const combined = new Uint8Array(64)
      combined.set(left, 0)
      combined.set(right, 32)

      nextLevel.push(hashFn(combined))
    }

    currentLevel = nextLevel
  }

  return toHash32(currentLevel[0])
}

export const ProofDataSchema = z.object({
  proof: z.string().min(1),
  public_inputs: z.string(),
  vkey_hash: z.string().length(64),
})

export const Groth16DataSchema = z.object({
  a: z.tuple([z.string(), z.string()]),
  b: z.tuple([
    z.tuple([z.string(), z.string()]),
    z.tuple([z.string(), z.string()]),
  ]),
  c: z.tuple([z.string(), z.string()]),
})

export const PhalaHealthResponseSchema = z.object({
  enclave_id: z.string(),
  public_key: z.string().optional(),
})

export const PhalaAttestationResponseSchema = z.object({
  quote: z.string(),
  mr_enclave: z.string(),
  report_data: z.string(),
  signature: z.string(),
  timestamp: z.number(),
  enclave_id: z.string(),
})

export const PhalaVerifyResponseSchema = z.object({
  valid: z.boolean(),
  error: z.string().optional(),
})

export const NitroDocumentSchema = z.object({
  moduleId: z.string(),
  timestamp: z.number(),
  digest: z.string(),
  pcrs: z.record(z.string(), z.string()),
  certificate: z.string().optional(),
  cabundle: z.array(z.string()).optional(),
  userData: z.string().optional(),
  nonce: z.string().optional(),
  publicKey: z.string().optional(),
})

export const GCPTokenResponseSchema = z.object({
  token: z.string(),
  claims: z.object({
    iss: z.string(),
    sub: z.string(),
    aud: z.string(),
    exp: z.number().optional(),
  }),
})

export const SP1ConfigSchema = z.object({
  programsDir: z.string().min(1),
  useMock: z.boolean().default(false),
  timeoutMs: z.number().positive().default(600000),
  useSuccinctNetwork: z.boolean().default(false),
  succinctApiKey: z.string().optional(),
  workers: z.number().positive().default(2),
})

export const PhalaConfigSchema = z.object({
  endpoint: z.string().url(),
  apiKey: z.string().optional(),
  timeoutMs: z.number().positive().default(30000),
  useMock: z.boolean().default(false),
})

export const AWSNitroConfigSchema = z.object({
  region: z.string().min(1),
  instanceType: z.string().default('c5.xlarge'),
  enclaveMemory: z.number().positive().default(512),
  enclaveCpus: z.number().positive().default(2),
})

export const GCPConfidentialConfigSchema = z.object({
  project: z.string().min(1),
  zone: z.string().default('us-central1-a'),
  instanceType: z.string().default('n2d-standard-4'),
})

export const EVMChainConfigSchema = z.object({
  chainId: z.number(),
  rpcUrl: z.string().url(),
  beaconUrl: z.string().url().optional(),
  bridgeAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  lightClientAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
})

export const SolanaConfigSchema = z.object({
  rpcUrl: z.string().url(),
  bridgeProgramId: z.string().min(32),
  evmLightClientProgramId: z.string().min(32),
})

export const OrchestratorConfigSchema = z.object({
  mode: z.enum(['local', 'testnet', 'mainnet']),
  chains: z.object({
    evm: z.array(EVMChainConfigSchema).min(1),
    solana: SolanaConfigSchema.optional(),
  }),
})

// Jupiter Quote response schema (simplified version for bridge use)
// Uses inline route plan schema since full JupiterRoutePlanSchema is defined later
export const JupiterQuoteResponseSchema = z.object({
  inputMint: z.string(),
  outputMint: z.string(),
  inAmount: z.string(),
  outAmount: z.string(),
  otherAmountThreshold: z.string(),
  swapMode: z.string(),
  slippageBps: z.number(),
  priceImpactPct: z.string(),
  routePlan: z.array(
    z.object({
      swapInfo: z.object({
        ammKey: z.string(),
        label: z.string(),
        inputMint: z.string(),
        outputMint: z.string(),
        inAmount: z.string(),
        outAmount: z.string(),
        feeAmount: z.string(),
        feeMint: z.string(),
      }),
      percent: z.number(),
    }),
  ),
  contextSlot: z.number(),
  timeTaken: z.number(),
})

// Jupiter Price API response schema
export const JupiterPriceDataSchema = z.object({
  price: z.number(),
})

export const JupiterPriceResponseSchema = z.object({
  data: z.record(z.string(), JupiterPriceDataSchema),
})

// Jupiter Quote response for arbitrage (simplified version)
export const JupiterArbQuoteResponseSchema = z.object({
  inAmount: z.string(),
  outAmount: z.string(),
  priceImpactPct: z.string(),
})

// 1inch quote response schema
export const OneInchQuoteResponseSchema = z.object({
  dstAmount: z.string(),
})

// Hyperliquid all mids response (maps symbol -> price string)
export const HyperliquidAllMidsResponseSchema = z.record(z.string(), z.string())

// Jito bundle response schema
export const JitoBundleResponseSchema = z.object({
  result: z.object({
    bundle_id: z.string(),
  }),
})

// Jito tip floor response schema
export const JitoTipFloorResponseSchema = z.object({
  tip_floor: z.string(),
})

// Finality checkpoints response
export const BeaconFinalityCheckpointsResponseSchema = z.object({
  data: z.object({
    finalized: z.object({
      epoch: z.string(),
      root: z.string(),
    }),
  }),
})

// Light client update response
export const BeaconHeaderSchema = z.object({
  slot: z.string(),
  proposer_index: z.string().optional(),
  parent_root: z.string(),
  state_root: z.string(),
  body_root: z.string(),
})

export const BeaconLightClientUpdateSchema = z.object({
  attested_header: z.object({ beacon: BeaconHeaderSchema }),
  finalized_header: z.object({ beacon: BeaconHeaderSchema }),
  finality_branch: z.array(z.string()),
  sync_aggregate: z.object({
    sync_committee_bits: z.string(),
    sync_committee_signature: z.string(),
  }),
  signature_slot: z.string(),
})

export const BeaconLightClientUpdatesResponseSchema = z.object({
  data: z.array(BeaconLightClientUpdateSchema),
})

// Sync committee response
export const BeaconSyncCommitteeResponseSchema = z.object({
  data: z.object({
    validators: z.array(z.string()),
  }),
})

// Block header response (for state root)
export const BeaconBlockHeaderResponseSchema = z.object({
  data: z.object({
    header: z.object({
      message: z.object({
        state_root: z.string(),
      }),
    }),
  }),
})

export const OrderbookLevelSchema = z.object({
  px: z.string(),
  sz: z.string(),
  n: z.number().optional(),
})

export const OrderbookResponseSchema = z.object({
  coin: z.string(),
  levels: z.tuple([
    z.array(OrderbookLevelSchema),
    z.array(OrderbookLevelSchema),
  ]),
})

export const RelayerEnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  RELAYER_PORT: z.string().regex(/^\d+$/).default('8081'),
  EVM_CHAIN_ID: z.string().regex(/^\d+$/).default('31337'),
  PRIVATE_KEY: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional(),
  SOLANA_KEYPAIR: z.string().optional(),
})

export const WormholeVAAResponseSchema = z.object({
  data: z
    .object({
      vaa: z.string().optional(),
    })
    .optional(),
})

export const HyperCoreMarketSchema = z.object({
  name: z.string(),
  szDecimals: z.number(),
  maxLeverage: z.number(),
  onlyIsolated: z.boolean(),
})

export const HyperCoreMarketsResponseSchema = z.object({
  universe: z.array(HyperCoreMarketSchema),
})

export const HyperCorePositionSchema = z.object({
  coin: z.string(),
  szi: z.string(),
  entryPx: z.string(),
  positionValue: z.string(),
  unrealizedPnl: z.string(),
  leverage: z.string(),
})

export const HyperCoreClearinghouseResponseSchema = z.object({
  assetPositions: z.array(
    z.object({
      position: HyperCorePositionSchema,
    }),
  ),
})

// HyperCore order response - the response field contains various API-specific data
// Using passthrough for the nested response since HyperCore returns different
// structures for different order types/scenarios
export const HyperCoreOrderResponseSchema = z.object({
  status: z.string(),
  response: z
    .record(
      z.string(),
      z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(z.union([z.string(), z.number()])),
      ]),
    )
    .optional(),
})

export const HyperCoreOrderbookLevelSchema = z.object({
  px: z.string(),
  sz: z.string(),
  n: z.number(),
})

export const HyperCoreL2BookResponseSchema = z.object({
  coin: z.string(),
  levels: z.array(z.array(HyperCoreOrderbookLevelSchema)),
})

export const EVMRPCResponseSchema = z.object({
  jsonrpc: z.string(),
  id: z.number(),
  result: z.string().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
    })
    .optional(),
})

export const SolanaHealthResponseSchema = z.object({
  jsonrpc: z.string(),
  id: z.number(),
  result: z.string().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
    })
    .optional(),
})

export const SuccinctProveResponseSchema = z.object({
  proof: z.string(),
  groth16: z.object({
    a: z.array(z.string()).length(2),
    b: z.array(z.array(z.string()).length(2)).length(2),
    c: z.array(z.string()).length(2),
  }),
})

export const ValidatorVoteSchema = z.object({
  validator: z.instanceof(Uint8Array).or(z.array(z.number())),
  voteAccount: z.instanceof(Uint8Array).or(z.array(z.number())),
  slot: z.bigint().or(z.string().transform((s) => BigInt(s))),
  hash: z.instanceof(Uint8Array).or(z.array(z.number())),
  signature: z.instanceof(Uint8Array).or(z.array(z.number())),
  timestamp: z.number(),
})

export const ConsensusSnapshotSchema = z.object({
  slot: z.bigint().or(z.string().transform((s) => BigInt(s))),
  bankHash: z.instanceof(Uint8Array).or(z.array(z.number())),
  parentHash: z.instanceof(Uint8Array).or(z.array(z.number())),
  blockTime: z.number(),
  votes: z.array(ValidatorVoteSchema),
  transactionsRoot: z.instanceof(Uint8Array).or(z.array(z.number())),
  epoch: z.bigint().or(z.string().transform((s) => BigInt(s))),
  epochStakesRoot: z.instanceof(Uint8Array).or(z.array(z.number())),
})

export const CrossChainTransferSchema = z.object({
  transferId: z.instanceof(Uint8Array).or(z.array(z.number())),
  sourceChain: z.number(),
  destChain: z.number(),
  token: z.instanceof(Uint8Array).or(z.array(z.number())),
  sender: z.instanceof(Uint8Array).or(z.array(z.number())),
  recipient: z.instanceof(Uint8Array).or(z.array(z.number())),
  amount: z.bigint().or(z.string().transform((s) => BigInt(s))),
  nonce: z.bigint().or(z.string().transform((s) => BigInt(s))),
  timestamp: z.bigint().or(z.string().transform((s) => BigInt(s))),
  payload: z.instanceof(Uint8Array).or(z.array(z.number())),
})

export const EthereumUpdateSchema = z.object({
  slot: z.bigint().or(z.string().transform((s) => BigInt(s))),
  blockRoot: z.instanceof(Uint8Array).or(z.array(z.number())),
  stateRoot: z.instanceof(Uint8Array).or(z.array(z.number())),
  executionStateRoot: z.instanceof(Uint8Array).or(z.array(z.number())),
  executionBlockNumber: z.bigint().or(z.string().transform((s) => BigInt(s))),
  executionBlockHash: z.instanceof(Uint8Array).or(z.array(z.number())),
})

export const TransferSubmissionSchema = CrossChainTransferSchema.extend({
  source: z.enum(['evm', 'solana']),
})

// SP1 proof response from prover service (JSON format)
export const SP1ProofResponseSchema = z.object({
  proof: z.array(z.number()).or(z.instanceof(Uint8Array)),
  publicInputs: z.array(z.number()).or(z.instanceof(Uint8Array)).optional(),
  vkeyHash: z.string().optional(),
})

// Batch proof response
export const BatchProofResponseSchema = z.object({
  proof: z.array(z.number()),
})

export const JupiterRoutePlanSchema = z.object({
  swapInfo: z.object({
    ammKey: z.string(),
    label: z.string(),
    inputMint: z.string(),
    outputMint: z.string(),
    inAmount: z.string(),
    outAmount: z.string(),
    feeAmount: z.string(),
    feeMint: z.string(),
  }),
  percent: z.number(),
})

export const JupiterQuoteFullSchema = z.object({
  inputMint: z.string(),
  outputMint: z.string(),
  inAmount: z.string(),
  outAmount: z.string(),
  otherAmountThreshold: z.string(),
  swapMode: z.enum(['ExactIn', 'ExactOut']),
  slippageBps: z.number(),
  priceImpactPct: z.number(),
  routePlan: z.array(JupiterRoutePlanSchema),
  contextSlot: z.number(),
  timeTaken: z.number(),
})

export const JupiterSwapResponseSchema = z.object({
  swapTransaction: z.string(),
  lastValidBlockHeight: z.number().optional(),
})

export const JupiterTokenListItemSchema = z.object({
  address: z.string(),
  symbol: z.string(),
  name: z.string(),
  decimals: z.number(),
})

export const JupiterTokenListSchema = z.array(JupiterTokenListItemSchema)

export type ProofData = z.infer<typeof ProofDataSchema>
export type Groth16Data = z.infer<typeof Groth16DataSchema>
export type PhalaHealthResponse = z.infer<typeof PhalaHealthResponseSchema>
export type PhalaAttestationResponse = z.infer<
  typeof PhalaAttestationResponseSchema
>
export type NitroDocument = z.infer<typeof NitroDocumentSchema>
export type SP1Config = z.infer<typeof SP1ConfigSchema>
export type PhalaConfig = z.infer<typeof PhalaConfigSchema>
export type AWSNitroConfig = z.infer<typeof AWSNitroConfigSchema>
export type GCPConfidentialConfig = z.infer<typeof GCPConfidentialConfigSchema>
export type WormholeVAAResponse = z.infer<typeof WormholeVAAResponseSchema>
export type HyperCoreMarket = z.infer<typeof HyperCoreMarketSchema>
export type HyperCorePosition = z.infer<typeof HyperCorePositionSchema>
export type EVMRPCResponse = z.infer<typeof EVMRPCResponseSchema>
export type SolanaHealthResponse = z.infer<typeof SolanaHealthResponseSchema>
export type SuccinctProveResponse = z.infer<typeof SuccinctProveResponseSchema>
export type SP1ProofResponse = z.infer<typeof SP1ProofResponseSchema>
export type BatchProofResponse = z.infer<typeof BatchProofResponseSchema>
export type JupiterQuoteFull = z.infer<typeof JupiterQuoteFullSchema>
export type JupiterSwapResponse = z.infer<typeof JupiterSwapResponseSchema>
export type JupiterTokenListItem = z.infer<typeof JupiterTokenListItemSchema>
