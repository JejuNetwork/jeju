import type {
  IntentStatus,
  TransactionStatus,
  VoucherStatus,
} from '@jejunetwork/types'
import type { Address, Hex } from 'viem'

export type { IntentStatus, TransactionStatus, VoucherStatus }

export interface ChainConfig {
  id: number
  name: string
  network: string
  nativeCurrency: { name: string; symbol: string; decimals: number }
  rpcUrls: {
    default: { http: string[]; webSocket?: string[] }
    jeju?: { http: string[]; webSocket?: string[] }
  }
  blockExplorers: { default: { name: string; url: string } }
  testnet?: boolean
  eilSupported: boolean
  oifSupported: boolean
  paymasterAddress?: Address
  inputSettlerAddress?: Address
  outputSettlerAddress?: Address
  crossChainPaymasterAddress?: Address
}

export interface SolanaConfig {
  name: string
  cluster: 'mainnet-beta' | 'testnet' | 'devnet'
  rpcUrl: string
  wsUrl?: string
}

export type AccountType = 'eoa' | 'smart-account' | 'multi-sig'

export interface Account {
  address: Address
  type: AccountType
  chainId: number
  label?: string
  isDefault?: boolean
}

export interface SmartAccount extends Account {
  type: 'smart-account'
  implementation: 'safe' | 'kernel' | 'light' | 'jeju'
  factoryAddress: Address
  initCode?: Hex
  isDeployed: boolean
}

export interface SolanaAccount {
  publicKey: string
  label?: string
  isDefault?: boolean
}

export interface WalletAccount {
  id: string
  label: string
  evmAccounts: Account[]
  solanaAccounts: SolanaAccount[]
  smartAccounts: SmartAccount[]
}

export interface Token {
  address: Address
  chainId: number
  symbol: string
  name: string
  decimals: number
  logoUri?: string
  isNative?: boolean
  bridgeInfo?: { [chainId: number]: { tokenAddress: Address } }
}

export interface TokenBalance {
  token: Token
  balance: bigint
  usdValue?: number
}

export interface AggregatedBalance {
  symbol: string
  totalBalance: bigint
  totalUsdValue: number
  chains: { chainId: number; balance: bigint; usdValue: number; token: Token }[]
}

export interface Transaction {
  id: string
  hash?: Hex
  chainId: number
  from: Address
  to: Address
  value: bigint
  data?: Hex
  status: TransactionStatus
  timestamp: number
  gasUsed?: bigint
  gasFee?: bigint
  isCrossChain?: boolean
  sourceChainId?: number
  destinationChainId?: number
  intentId?: Hex
  voucherId?: Hex
}

export interface Intent {
  id: Hex
  user: Address
  inputToken: Address
  inputAmount: bigint
  outputToken: Address
  outputAmount: bigint
  sourceChainId: number
  destinationChainId: number
  recipient: Address
  maxFee: bigint
  openDeadline: number
  fillDeadline: number
  status: IntentStatus
  solver?: Address
  txHash?: Hex
  fillTxHash?: Hex
  createdAt: number
}

export interface IntentParams {
  inputToken: Address
  inputAmount: bigint
  outputToken: Address
  minOutputAmount: bigint
  destinationChainId: number
  recipient?: Address
  maxFee?: bigint
  deadline?: number
}

export interface IntentQuote {
  inputToken: Address
  inputAmount: bigint
  outputToken: Address
  outputAmount: bigint
  fee: bigint
  route: IntentRoute[]
  estimatedTime: number
  priceImpact: number
}

export interface IntentRoute {
  chainId: number
  protocol: string
  action: 'swap' | 'bridge' | 'transfer'
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  outputAmount: bigint
}

export interface VoucherRequest {
  id: Hex
  requester: Address
  token: Address
  amount: bigint
  destinationToken: Address
  destinationChainId: number
  recipient: Address
  gasOnDestination: bigint
  maxFee: bigint
  feeIncrement: bigint
  deadline: number
  status: VoucherStatus
}

export interface Voucher {
  id: Hex
  requestId: Hex
  xlp: Address
  sourceChainId: number
  destinationChainId: number
  sourceToken: Address
  destinationToken: Address
  amount: bigint
  fee: bigint
  gasProvided: bigint
  issuedBlock: number
  expiresBlock: number
  status: VoucherStatus
}

export interface GasOption {
  token: Token
  tokenAmount: bigint
  ethEquivalent: bigint
  usdValue: number
  isPreferred?: boolean
  reason?: string
}

export interface UserOperation {
  sender: Address
  nonce: bigint
  initCode: Hex
  callData: Hex
  callGasLimit: bigint
  verificationGasLimit: bigint
  preVerificationGas: bigint
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  paymasterAndData: Hex
  signature: Hex
}

export interface GasEstimate {
  gasLimit: bigint
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  totalCostEth: bigint
  tokenOptions: GasOption[]
}

export interface WalletState {
  isUnlocked: boolean
  accounts: WalletAccount[]
  activeAccountId?: string
  activeChainId?: number
  connectedSites: ConnectedSite[]
}

export interface ConnectedSite {
  origin: string
  name?: string
  icon?: string
  permissions: SitePermission[]
  connectedAt: number
}

export type SitePermission =
  | 'eth_accounts'
  | 'eth_chainId'
  | 'eth_sendTransaction'
  | 'wallet_switchEthereumChain'
  | 'wallet_addEthereumChain'
  | 'personal_sign'
  | 'eth_signTypedData_v4'

// Message payload types for wallet events
export type WalletMessagePayload =
  | {
      type: 'subscriptionResult'
      result: { chainId: number; address: Address }
    }
  | { type: 'error'; code: number; message: string }

export type WalletEvent =
  | { type: 'accountsChanged'; accounts: Address[] }
  | { type: 'chainChanged'; chainId: number }
  | { type: 'connect'; chainId: number }
  | { type: 'disconnect' }
  | { type: 'message'; data: WalletMessagePayload }
  | { type: 'intentCreated'; intent: Intent }
  | { type: 'intentFilled'; intent: Intent }
  | { type: 'voucherIssued'; voucher: Voucher }
  | { type: 'crossChainComplete'; transaction: Transaction }
