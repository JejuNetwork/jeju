import type { Address, Hex } from 'viem'

// Raw Viem Types (match ABI output exactly)

/**
 * Raw contracts tuple as returned by viem from the ABI.
 * All uint256 fields are bigint.
 */
export interface RawNetworkContracts {
  identityRegistry: Address
  solverRegistry: Address
  inputSettler: Address
  outputSettler: Address
  liquidityVault: Address
  governance: Address
  oracle: Address
}

/**
 * Raw NetworkInfo as returned by viem from getNetwork().
 * uint256 fields are bigint, not number.
 */
export interface RawNetworkInfo {
  chainId: bigint
  name: string
  rpcUrl: string
  explorerUrl: string
  wsUrl: string
  operator: Address
  contracts: RawNetworkContracts
  genesisHash: Hex
  registeredAt: bigint
  stake: bigint
  isActive: boolean
  isVerified: boolean
}

/**
 * Raw attestation as returned by viem from getAttestations().
 */
export interface RawAttestation {
  targetChainId: bigint
  attestedAt: bigint
  attester: Address
  attestationHash: Hex
}

// Application Types (JS-friendly)

export interface NetworkContracts {
  identityRegistry: Address
  solverRegistry: Address
  inputSettler: Address
  outputSettler: Address
  liquidityVault: Address
  governance: Address
  oracle: Address
}

export interface NetworkInfo {
  chainId: number
  name: string
  rpcUrl: string
  explorerUrl: string
  wsUrl: string
  operator: Address
  contracts: NetworkContracts
  genesisHash: Hex
  registeredAt: number
  stake: bigint
  isActive: boolean
  isVerified: boolean
}

export interface TrustRelation {
  isTrusted: boolean
  establishedAt: number
  attestedBy: Address
}

export interface FederatedAgent {
  originChainId: number
  originAgentId: number
  originOwner: Address
  originRegistryHash: Hex
  federatedAt: number
  isActive: boolean
  reputationScore: number
}

export interface CrossNetworkAttestation {
  targetChainId: number
  attestedAt: number
  attester: Address
  attestationHash: Hex
}

export interface FederatedSolver {
  solverAddress: Address
  homeChainId: number
  supportedChains: number[]
  totalStake: bigint
  totalFills: number
  successfulFills: number
  federatedAt: number
  isActive: boolean
}

export interface NetworkLiquidity {
  chainId: number
  vault: Address
  ethLiquidity: bigint
  tokenLiquidity: bigint
  utilizationBps: number
  lastUpdated: number
}

export interface LiquidityRequest {
  requestId: Hex
  requester: Address
  token: Address
  amount: bigint
  sourceChainId: number
  targetChainId: number
  createdAt: number
  deadline: number
  fulfilled: boolean
  fulfiller: Address
}

export interface XLP {
  provider: Address
  supportedChains: number[]
  totalProvided: bigint
  totalEarned: bigint
  registeredAt: number
  isActive: boolean
}

export interface FederationConfig {
  hubChainId: number
  hubRpcUrl: string
  networkRegistryAddress: Address
  localChainId: number
  localRpcUrl: string
  federatedIdentityAddress?: Address
  federatedSolverAddress?: Address
  federatedLiquidityAddress?: Address
}

export interface RouteInfo {
  sourceChainId: number
  destChainId: number
  solvers: FederatedSolver[]
  avgFillTime: number
  avgFee: bigint
}

export interface IdentityVerification {
  isValid: boolean
  federatedId: Hex
  reputation: number
  attestedNetworks: number[]
}

export interface DiscoveryConfig {
  hubRpcUrl: string
  networkRegistryAddress: Address
  cacheEnabled?: boolean
  cacheTtlMs?: number
}

// Type Converters (Raw viem -> Application types)

/**
 * Convert raw viem NetworkInfo to application NetworkInfo.
 * Converts bigint chainId and registeredAt to number.
 */
export function toNetworkInfo(raw: RawNetworkInfo): NetworkInfo {
  return {
    chainId: Number(raw.chainId),
    name: raw.name,
    rpcUrl: raw.rpcUrl,
    explorerUrl: raw.explorerUrl,
    wsUrl: raw.wsUrl,
    operator: raw.operator,
    contracts: raw.contracts,
    genesisHash: raw.genesisHash,
    registeredAt: Number(raw.registeredAt),
    stake: raw.stake,
    isActive: raw.isActive,
    isVerified: raw.isVerified,
  }
} /**
 * Convert raw viem attestation to application CrossNetworkAttestation.
 */
export function toAttestation(raw: RawAttestation): CrossNetworkAttestation {
  return {
    targetChainId: Number(raw.targetChainId),
    attestedAt: Number(raw.attestedAt),
    attester: raw.attester,
    attestationHash: raw.attestationHash,
  }
}
