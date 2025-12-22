/**
 * Network Wallet Plugin Types
 */

import type { Address, Hex } from 'viem';

// ============================================================================
// Wallet Types
// ============================================================================

export interface WalletAccount {
  address: Address;
  type: 'hd' | 'private-key' | 'smart-account' | 'hardware' | 'watch';
  name: string;
  hdPath?: string;
  createdAt: number;
  isActive?: boolean;
}

export interface WalletState {
  isLocked: boolean;
  isInitialized: boolean;
  accounts: WalletAccount[];
  currentAccount?: WalletAccount;
  activeChainId: number;
  preferredChains: number[];
  autoLockTimeout: number;
  gasPreferences: GasPreferences;
  securitySettings: SecuritySettings;
  viewMode: 'simple' | 'advanced';
}

export interface GasPreferences {
  autoGasAbstraction: boolean;
  preferredGasToken?: Address;
  priorityFeeMultiplier: number;
}

export interface SecuritySettings {
  requireConfirmation: boolean;
  simulateBeforeSign: boolean;
  whitelistedAddresses: Address[];
  blockedAddresses: Address[];
}

// ============================================================================
// Token & Balance Types
// ============================================================================

export interface Token {
  chainId: number;
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  isNative?: boolean;
  logoUri?: string;
  priceUsd?: number;
}

export interface TokenBalance {
  token: Token;
  balance: bigint;
  balanceFormatted: string;
  valueUsd?: number;
}

export interface NFT {
  chainId: number;
  contractAddress: Address;
  tokenId: string;
  name: string;
  description?: string;
  imageUrl?: string;
  collectionName?: string;
  standard: 'ERC721' | 'ERC1155';
}

export interface PortfolioSummary {
  totalValueUsd: number;
  balancesByChain: Map<number, TokenBalance[]>;
  topTokens: TokenBalance[];
}

// ============================================================================
// Transaction Types
// ============================================================================

export interface Transaction {
  hash: Hex;
  chainId: number;
  from: Address;
  to: Address;
  value: bigint;
  data?: Hex;
  nonce: number;
  gasPrice?: bigint;
  gasLimit: bigint;
  status: 'pending' | 'confirmed' | 'failed';
  timestamp?: number;
  blockNumber?: number;
}

export interface SimulationResult {
  success: boolean;
  gasUsed: bigint;
  returnData?: Hex;
  error?: string;
  balanceChanges: Array<{
    token: Address;
    amount: bigint;
    direction: 'in' | 'out';
  }>;
  approvalChanges: Array<{
    token: Address;
    spender: Address;
    amount: bigint;
  }>;
  nftTransfers: Array<{
    contract: Address;
    tokenId: string;
    from: Address;
    to: Address;
  }>;
  logs: Array<{
    address: Address;
    topics: Hex[];
    data: Hex;
  }>;
}

// ============================================================================
// Account Abstraction Types
// ============================================================================

export interface UserOperation {
  sender: Address;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymasterAndData: Hex;
  signature: Hex;
}

export interface SmartAccountInfo {
  address: Address;
  owner: Address;
  isDeployed: boolean;
  implementation: Address;
  nonce: bigint;
  entryPoint: Address;
}

export interface SessionKey {
  publicKey: Address;
  validUntil: number;
  validAfter: number;
  permissions: Array<{
    target: Address;
    selector?: Hex;
    maxValue?: bigint;
  }>;
}

export interface AAServiceConfig {
  entryPointAddress: Address;
  accountFactoryAddress: Address;
  bundlerUrl: string;
  supportedChains: number[];
}

// ============================================================================
// EIL (Ethereum Interop Layer) Types
// ============================================================================

export interface VoucherRequest {
  id: Hex;
  user: Address;
  sourceChainId: number;
  destinationChainId: number;
  sourceToken: Address;
  destinationToken: Address;
  sourceAmount: bigint;
  minDestinationAmount: bigint;
  deadline: number;
  nonce: bigint;
  status: 'pending' | 'voucher-issued' | 'fulfilled' | 'expired' | 'cancelled';
}

export interface Voucher {
  id: Hex;
  requestId: Hex;
  xlp: Address;
  destinationAmount: bigint;
  issuedAt: number;
  expiresAt: number;
  fulfilled: boolean;
}

export interface EILServiceConfig {
  crossChainPaymasterAddress: Address;
  supportedChains: number[];
}

// ============================================================================
// OIF (Open Intent Framework) Types
// ============================================================================

export interface Intent {
  id: Hex;
  user: Address;
  sourceChainId: number;
  destinationChainId: number;
  inputToken: Address;
  inputAmount: bigint;
  outputToken: Address;
  minOutputAmount: bigint;
  resolver: Address;
  deadline: number;
  status: 'pending' | 'open' | 'filled' | 'settled' | 'cancelled' | 'expired';
  createdAt: number;
  filledAt?: number;
  settledAt?: number;
}

export interface IntentOrder {
  user: Address;
  nonce: bigint;
  sourceChainId: number;
  openDeadline: number;
  fillDeadline: number;
  orderDataType: Hex;
  orderData: Hex;
}

export interface OIFServiceConfig {
  inputSettlerAddress: Address;
  outputSettlerAddresses: Map<number, Address>;
  supportedChains: number[];
}

// ============================================================================
// Gas Types
// ============================================================================

export interface GasEstimate {
  gasPrice: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  baseFee: bigint;
  estimatedCost: {
    wei: bigint;
    eth: number;
  };
  speed: 'slow' | 'standard' | 'fast';
  chainId: number;
}

export interface GasOption {
  type: 'native' | 'token';
  token: Token;
  amount: bigint;
  amountFormatted: string;
  gasPrice: bigint;
  speed: 'slow' | 'standard' | 'fast';
  estimatedTime: number;
}

export interface GasServiceConfig {
  defaultGasMultiplier: number;
  maxGasPrice: bigint;
  supportedGasTokens: Array<{
    address: Address;
    symbol: string;
    decimals: number;
  }>;
}

// ============================================================================
// Security Types
// ============================================================================

export interface SecurityAnalysis {
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  risks: TransactionRisk[];
  simulation: {
    success: boolean;
    gasUsed?: bigint;
    error?: string;
    returnData?: Hex;
  };
  isKnownContract: boolean;
  summary: string;
}

export interface TransactionRisk {
  type: 'approval' | 'value' | 'simulation' | 'contract' | 'phishing';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  recommendation?: string;
}

export interface SignatureRiskDetails {
  spender?: Address;
  amount?: bigint;
  deadline?: number;
  permitType?: 'ERC20Permit' | 'Permit2' | 'DAIPermit';
  domain?: string;
  targetContract?: Address;
}

export interface SignatureRisk {
  type: 'permit' | 'unlimited' | 'suspicious' | 'phishing';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  details?: SignatureRiskDetails;
}

// ============================================================================
// Wallet Service Config
// ============================================================================

export interface WalletServiceConfig {
  defaultChainId: number;
  useNetworkInfrastructure: boolean;
  jejuRpcUrl?: string;
}
