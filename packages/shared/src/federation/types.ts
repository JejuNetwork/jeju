import type { Address, Hex } from 'viem';

export interface NetworkContracts {
  identityRegistry: Address;
  solverRegistry: Address;
  inputSettler: Address;
  outputSettler: Address;
  liquidityVault: Address;
  governance: Address;
  oracle: Address;
}

export interface NetworkInfo {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  wsUrl: string;
  operator: Address;
  contracts: NetworkContracts;
  genesisHash: Hex;
  registeredAt: number;
  stake: bigint;
  isActive: boolean;
  isVerified: boolean;
}

export interface TrustRelation {
  isTrusted: boolean;
  establishedAt: number;
  attestedBy: Address;
}

export interface FederatedAgent {
  originChainId: number;
  originAgentId: number;
  originOwner: Address;
  originRegistryHash: Hex;
  federatedAt: number;
  isActive: boolean;
  reputationScore: number;
}

export interface CrossNetworkAttestation {
  targetChainId: number;
  attestedAt: number;
  attester: Address;
  attestationHash: Hex;
}

export interface FederatedSolver {
  solverAddress: Address;
  homeChainId: number;
  supportedChains: number[];
  totalStake: bigint;
  totalFills: number;
  successfulFills: number;
  federatedAt: number;
  isActive: boolean;
}

export interface NetworkLiquidity {
  chainId: number;
  vault: Address;
  ethLiquidity: bigint;
  tokenLiquidity: bigint;
  utilizationBps: number;
  lastUpdated: number;
}

export interface LiquidityRequest {
  requestId: Hex;
  requester: Address;
  token: Address;
  amount: bigint;
  sourceChainId: number;
  targetChainId: number;
  createdAt: number;
  deadline: number;
  fulfilled: boolean;
  fulfiller: Address;
}

export interface XLP {
  provider: Address;
  supportedChains: number[];
  totalProvided: bigint;
  totalEarned: bigint;
  registeredAt: number;
  isActive: boolean;
}

export interface FederationConfig {
  hubChainId: number;
  hubRpcUrl: string;
  networkRegistryAddress: Address;
  localChainId: number;
  localRpcUrl: string;
  federatedIdentityAddress?: Address;
  federatedSolverAddress?: Address;
  federatedLiquidityAddress?: Address;
}

export interface RouteInfo {
  sourceChainId: number;
  destChainId: number;
  solvers: FederatedSolver[];
  avgFillTime: number;
  avgFee: bigint;
}

export interface IdentityVerification {
  isValid: boolean;
  federatedId: Hex;
  reputation: number;
  attestedNetworks: number[];
}

export interface DiscoveryConfig {
  hubRpcUrl: string;
  networkRegistryAddress: Address;
  cacheEnabled?: boolean;
  cacheTtlMs?: number;
}

