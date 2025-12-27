/**
 * Core Types for EVM↔Solana ZK Light Client Bridge
 */

export type Hash32 = Uint8Array & { readonly __brand: 'Hash32' }

/** 64-byte signature (Ed25519) */
export type Ed25519Signature = Uint8Array & {
  readonly __brand: 'Ed25519Signature'
}

/** BLS signature for Ethereum beacon chain */
export type BLSSignature = Uint8Array & { readonly __brand: 'BLSSignature' }

/** Groth16 proof components */
export interface Groth16Proof {
  a: [bigint, bigint]
  b: [[bigint, bigint], [bigint, bigint]]
  c: [bigint, bigint]
}

/** SP1 proof wrapper */
export interface SP1Proof {
  /** Compressed proof bytes */
  proof: Uint8Array
  /** Public inputs */
  publicInputs: Uint8Array
  /** Verification key hash */
  vkeyHash: Hash32
}

export type Slot = bigint

/** Solana epoch number */
export type Epoch = bigint

/** Solana validator identity (pubkey) */
export interface SolanaValidator {
  pubkey: Hash32
  stake: bigint
  voteAccount: Hash32
}

/** Solana validator vote */
export interface ValidatorVote {
  validator: Hash32
  slot: Slot
  hash: Hash32
  signature: Ed25519Signature
  timestamp: bigint
}

/** Solana bank hash - commitment to ledger state */
export interface BankHash {
  slot: Slot
  hash: Hash32
  parentHash: Hash32
  transactionsHash: Hash32
  accountsHash: Hash32
}

/** Snapshot of validator stakes at epoch boundary */
export interface EpochStakes {
  epoch: Epoch
  totalStake: bigint
  validators: SolanaValidator[]
  /** Merkle root of validator stakes for efficient proof */
  stakesRoot: Hash32
}

/** Supermajority consensus proof inputs */
export interface SupermajorityProofInputs {
  slot: Slot
  bankHash: Hash32
  /** Aggregated votes (batched for ZK efficiency) */
  votes: ValidatorVote[]
  /** Current epoch stakes */
  epochStakes: EpochStakes
  /** Threshold: 2/3 of total stake */
  requiredStake: bigint
}

/** Verified Solana state commitment */
export interface SolanaStateCommitment {
  slot: Slot
  bankHash: Hash32
  epochStakes: Hash32
  /** ZK proof of supermajority consensus (null until generated) */
  proof: SP1Proof | null
  /** Timestamp of proof generation */
  provenAt: bigint
}

// ETHEREUM CONSENSUS TYPES (for EVM→Solana direction)

/** Ethereum beacon block root */
export interface BeaconBlockRoot {
  slot: bigint
  root: Hash32
  stateRoot: Hash32
  bodyRoot: Hash32
}

/** Sync committee for light client protocol */
export interface SyncCommittee {
  pubkeys: Hash32[] // 512 validators
  aggregatePubkey: Hash32
}

/** Sync committee signature (aggregated BLS) */
export interface SyncCommitteeSignature {
  slot: bigint
  beaconBlockRoot: Hash32
  signature: BLSSignature
  participantBits: Uint8Array // 512 bits
}

/** Ethereum light client update */
export interface EthereumLightClientUpdate {
  attestedHeader: BeaconBlockRoot
  nextSyncCommittee: SyncCommittee
  nextSyncCommitteeBranch: Hash32[]
  finalizedHeader: BeaconBlockRoot
  finalityBranch: Hash32[]
  syncAggregate: SyncCommitteeSignature
}

/** Verified Ethereum state commitment (for Solana side) */
export interface EthereumStateCommitment {
  slot: bigint
  beaconBlockRoot: Hash32
  executionStateRoot: Hash32
  /** ZK proof of sync committee consensus (null until generated) */
  proof: SP1Proof | null
  provenAt: bigint
}

// CROSS-CHAIN TOKEN TYPES

/** Supported chains */
export const ChainId = {
  // EVM Chains
  ETHEREUM_MAINNET: 1,
  ETHEREUM_SEPOLIA: 11155111,
  BASE_MAINNET: 8453,
  BASE_SEPOLIA: 84532,
  ARBITRUM_ONE: 42161,
  ARBITRUM_SEPOLIA: 421614,
  OPTIMISM: 10,
  OPTIMISM_SEPOLIA: 11155420,
  BSC_MAINNET: 56,
  BSC_TESTNET: 97,
  // Solana
  SOLANA_MAINNET: 101,
  SOLANA_DEVNET: 102,
  SOLANA_LOCALNET: 103,
  // Local development
  LOCAL_EVM: 31337,
  LOCAL_SOLANA: 104,
} as const
export type ChainId = (typeof ChainId)[keyof typeof ChainId]

/** Token standard */
export const TokenStandard = {
  ERC20: 'ERC20',
  SPL: 'SPL',
  /** Cross-chain native token (like CCIP tokens) */
  CROSS_CHAIN_NATIVE: 'CROSS_CHAIN_NATIVE',
} as const
export type TokenStandard = (typeof TokenStandard)[keyof typeof TokenStandard]

/** Cross-chain token metadata */
export interface CrossChainToken {
  /** Unique identifier across all chains */
  tokenId: Hash32
  name: string
  symbol: string
  decimals: number
  /** Total supply (canonical, not sum of all chains) */
  totalSupply: bigint
  /** Home chain where token was originally created */
  homeChain: ChainId
  /** Token standard on home chain */
  homeStandard: TokenStandard
  /** Addresses/accounts on each supported chain */
  deployments: TokenDeployment[]
  /** Whether this is a native cross-chain token or wrapped */
  isNative: boolean
}

/** Token deployment on a specific chain */
export interface TokenDeployment {
  chainId: ChainId
  /** Address (EVM) or mint account (Solana) */
  address: Uint8Array
  standard: TokenStandard
  /** Bridge contract/program that controls this deployment */
  bridgeAddress: Uint8Array
  /** Current supply on this chain */
  chainSupply: bigint
}

/** Cross-chain transfer request */
export interface CrossChainTransfer {
  /** Unique transfer ID */
  transferId: Hash32
  /** Source chain */
  sourceChain: ChainId
  /** Destination chain */
  destChain: ChainId
  /** Token being transferred */
  token: Hash32
  /** Sender on source chain */
  sender: Uint8Array
  /** Recipient on destination chain */
  recipient: Uint8Array
  /** Amount to transfer */
  amount: bigint
  /** Nonce for replay protection */
  nonce: bigint
  /** Timestamp of transfer initiation */
  timestamp: bigint
  /** Optional: arbitrary data for cross-chain contract calls */
  payload: Uint8Array
}

/** Transfer status */
export const TransferStatus = {
  PENDING: 'PENDING',
  SOURCE_CONFIRMED: 'SOURCE_CONFIRMED',
  PROVING: 'PROVING',
  PROOF_GENERATED: 'PROOF_GENERATED',
  DEST_SUBMITTED: 'DEST_SUBMITTED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const

export type TransferStatusType =
  (typeof TransferStatus)[keyof typeof TransferStatus]

/** Full transfer record with proof */
export interface TransferRecord {
  transfer: CrossChainTransfer
  status: TransferStatusType
  /** Proof of source chain inclusion */
  sourceProof: SP1Proof | null
  /** Source chain state commitment at time of transfer */
  sourceCommitment: SolanaStateCommitment | EthereumStateCommitment | null
  /** Destination chain transaction hash */
  destTxHash: Uint8Array | null
  /** Error message if failed */
  error: string | null
  /** Timestamps for each stage */
  timestamps: {
    initiated: bigint
    sourceConfirmed: bigint | null
    proofGenerated: bigint | null
    destSubmitted: bigint | null
    completed: bigint | null
  }
}

// CROSS-CHAIN EXECUTION TYPES

/** Types of cross-chain operations beyond token transfers */
export const CrossChainOperationType = {
  /** Simple token transfer */
  TOKEN_TRANSFER: 'TOKEN_TRANSFER',
  /** Token transfer with contract call on destination */
  TOKEN_TRANSFER_WITH_CALL: 'TOKEN_TRANSFER_WITH_CALL',
  /** Arbitrary message passing */
  MESSAGE: 'MESSAGE',
  /** Cross-chain contract call (execute function on dest chain) */
  CONTRACT_CALL: 'CONTRACT_CALL',
  /** Cross-chain account/state query */
  STATE_QUERY: 'STATE_QUERY',
  /** Cross-chain NFT transfer */
  NFT_TRANSFER: 'NFT_TRANSFER',
} as const
export type CrossChainOperationType =
  (typeof CrossChainOperationType)[keyof typeof CrossChainOperationType]

/** Cross-chain message envelope */
export interface CrossChainMessage {
  messageId: Hash32
  sourceChain: ChainId
  destChain: ChainId
  operationType: CrossChainOperationType
  sender: Uint8Array
  receiver: Uint8Array
  /** Encoded operation data */
  data: Uint8Array
  /** Gas/compute budget for execution on dest chain */
  gasLimit: bigint
  /** Fee paid for cross-chain execution */
  fee: bigint
  nonce: bigint
  timestamp: bigint
}

/** Cross-chain contract call specification */
export interface CrossChainContractCall {
  /** Target contract/program on dest chain */
  target: Uint8Array
  /** Function selector (EVM) or instruction discriminator (Solana) */
  selector: Uint8Array
  /** Encoded function arguments */
  args: Uint8Array
  /** Value to send (for payable calls) */
  value: bigint
}

/** Account/balance proof for cross-chain verification */
export interface AccountProof {
  chainId: ChainId
  account: Uint8Array
  /** Storage slot (EVM) or account data offset (Solana) */
  slot: Uint8Array
  /** Proven value */
  value: Uint8Array
  /** Merkle proof of inclusion */
  proof: Uint8Array[]
  /** State root this proof is against */
  stateRoot: Hash32
  /** Block/slot number */
  blockNumber: bigint
}

// TEE BATCHING TYPES

/**
 * TEE attestation for proof batching (optimized for bridge operations)
 * Uses Uint8Array/bigint for performance in proof generation.
 * For standard TEE attestation, use TEEAttestation from @jejunetwork/types
 */
export interface TEEBatchAttestation {
  /** TEE enclave measurement */
  measurement: Hash32
  /** Attestation quote */
  quote: Uint8Array
  /** Public key derived in TEE */
  publicKey: Uint8Array
  /** Timestamp of attestation */
  timestamp: bigint
}

/** Proof batch for efficient verification */
export interface ProofBatch {
  batchId: Hash32
  /** Individual transfers/messages in this batch */
  items: CrossChainTransfer[]
  /** Single aggregated proof for the batch */
  aggregatedProof: SP1Proof
  /** TEE attestation (optional, for pre-verification caching) */
  teeAttestation: TEEBatchAttestation | null
  /** Total fees collected for this batch */
  totalFees: bigint
  /** Proof generation cost */
  proofCost: bigint
  /** Batch creation timestamp */
  createdAt: bigint
  /** When batch was proven */
  provenAt: bigint | null
}

/** TEE cache entry for pending transfers */
export interface TEECacheEntry {
  transfer: CrossChainTransfer
  /** Pre-computed partial proof state (for batching) */
  partialState: Uint8Array
  /** Estimated proof cost contribution */
  estimatedCost: bigint
  /** Priority score for batching */
  priority: number
  /** When this entry expires from cache */
  expiresAt: bigint
}

/** TEE batching configuration */
export interface TEEBatchingConfig {
  /** Maximum items per batch */
  maxBatchSize: number
  /** Maximum wait time before forcing batch (ms) */
  maxBatchWaitMs: number
  /** Minimum items before batch can be proven */
  minBatchSize: number
  /** Target proof cost per item (in wei/lamports) */
  targetCostPerItem: bigint
  /** TEE enclave endpoint */
  teeEndpoint: string
}

// LIGHT CLIENT STATE TYPES

/** Solana light client state on EVM */
export interface SolanaLightClientState {
  /** Latest verified slot */
  latestSlot: Slot
  /** Latest verified bank hash */
  latestBankHash: Hash32
  /** Current epoch */
  currentEpoch: Epoch
  /** Current epoch stakes root */
  epochStakesRoot: Hash32
  /** Number of state updates */
  updateCount: bigint
  /** Contract address on EVM */
  contractAddress: Uint8Array
}

/** Ethereum light client state on Solana */
export interface EthereumLightClientState {
  /** Latest verified beacon slot */
  latestSlot: bigint
  /** Latest verified beacon block root */
  latestBeaconRoot: Hash32
  /** Latest verified execution state root */
  latestExecutionStateRoot: Hash32
  /** Current sync committee */
  currentSyncCommittee: Hash32
  /** Next sync committee (if known) */
  nextSyncCommittee: Hash32 | null
  /** Number of state updates */
  updateCount: bigint
  /** Program ID on Solana */
  programId: Uint8Array
}

// CONFIGURATION TYPES

/** Chain RPC configuration */
export interface ChainRPCConfig {
  chainId: ChainId
  rpcUrl: string
  wsUrl: string | null
  /** For Solana: commitment level */
  commitment: 'processed' | 'confirmed' | 'finalized'
  /** For EVM: block confirmations */
  confirmations: number
}

/** Bridge deployment configuration */
export interface BridgeConfig {
  /** Supported chains */
  chains: ChainRPCConfig[]
  /** Light client contract addresses */
  lightClients: Map<ChainId, Uint8Array>
  /** Bridge contract addresses */
  bridges: Map<ChainId, Uint8Array>
  /** TEE batching config */
  teeBatching: TEEBatchingConfig
  /** Prover configuration */
  prover: ProverConfig
}

/** Prover service configuration */
export interface ProverConfig {
  /** Self-hosted or Succinct network */
  mode: 'self-hosted' | 'succinct-network'
  /** Number of parallel proving workers */
  workers: number
  /** Maximum memory per worker (MB) */
  maxMemoryMb: number
  /** Proof timeout (ms) */
  timeoutMs: number
  /** SP1 program paths */
  programPaths: {
    ed25519Aggregation: string
    solanaConsensus: string
    ethereumConsensus: string
    tokenTransfer: string
  }
}

// HELPER FUNCTIONS

/** Create a Hash32 from bytes */
export function toHash32(bytes: Uint8Array | null | undefined): Hash32 {
  if (!bytes) {
    throw new Error('Expected Uint8Array, got null or undefined')
  }
  if (bytes.length !== 32) {
    throw new Error(`Expected 32 bytes, got ${bytes.length}`)
  }
  return bytes as Hash32
}

/** Create an Ed25519 signature from bytes */
export function toEd25519Signature(bytes: Uint8Array): Ed25519Signature {
  if (bytes.length !== 64) {
    throw new Error(`Expected 64 bytes, got ${bytes.length}`)
  }
  return bytes as Ed25519Signature
}

/** Check if chain is EVM-based */
export function isEVMChain(chainId: ChainId): boolean {
  return (
    chainId !== ChainId.SOLANA_MAINNET &&
    chainId !== ChainId.SOLANA_DEVNET &&
    chainId !== ChainId.SOLANA_LOCALNET &&
    chainId !== ChainId.LOCAL_SOLANA
  )
}

/** Check if chain is Solana-based */
export function isSolanaChain(chainId: ChainId): boolean {
  return (
    chainId === ChainId.SOLANA_MAINNET ||
    chainId === ChainId.SOLANA_DEVNET ||
    chainId === ChainId.SOLANA_LOCALNET ||
    chainId === ChainId.LOCAL_SOLANA
  )
}

/** Get chain name for display */
export function getChainName(chainId: ChainId): string {
  const names: Record<ChainId, string> = {
    [ChainId.ETHEREUM_MAINNET]: 'Ethereum Mainnet',
    [ChainId.ETHEREUM_SEPOLIA]: 'Ethereum Sepolia',
    [ChainId.BASE_MAINNET]: 'Base',
    [ChainId.BASE_SEPOLIA]: 'Base Sepolia',
    [ChainId.ARBITRUM_ONE]: 'Arbitrum One',
    [ChainId.ARBITRUM_SEPOLIA]: 'Arbitrum Sepolia',
    [ChainId.OPTIMISM]: 'Optimism',
    [ChainId.OPTIMISM_SEPOLIA]: 'Optimism Sepolia',
    [ChainId.BSC_MAINNET]: 'BNB Chain',
    [ChainId.BSC_TESTNET]: 'BNB Testnet',
    [ChainId.SOLANA_MAINNET]: 'Solana Mainnet',
    [ChainId.SOLANA_DEVNET]: 'Solana Devnet',
    [ChainId.SOLANA_LOCALNET]: 'Solana Localnet',
    [ChainId.LOCAL_EVM]: 'Local EVM',
    [ChainId.LOCAL_SOLANA]: 'Local Solana',
  }
  // Display format for unknown chains - this is for display only, not a bug
  return names[chainId] ?? `Unknown (${chainId})`
}
