/**
 * Zod Schemas for SDK Types
 *
 * Comprehensive validation schemas for all wallet SDK types.
 * These schemas enforce type safety and fail-fast validation.
 */

import {
  AddressSchema,
  BigIntSchema,
  ChainIdSchema,
  HexSchema,
  TimestampSchema,
} from '@jejunetwork/types'
import { z } from 'zod'

const AccountTypeSchema = z.enum(['eoa', 'smart-account', 'multi-sig'])

const SmartAccountImplementationSchema = z.enum([
  'safe',
  'kernel',
  'light',
  'jeju',
])

const SitePermissionSchema = z.enum([
  'eth_accounts',
  'eth_chainId',
  'eth_sendTransaction',
  'wallet_switchEthereumChain',
  'wallet_addEthereumChain',
  'personal_sign',
  'eth_signTypedData_v4',
])

// TransactionStatus, IntentStatus, VoucherStatus come from @jejunetwork/types
// We'll validate them as strings matching expected values
const TransactionStatusSchema = z.enum([
  'pending',
  'submitted',
  'confirmed',
  'failed',
])
const IntentStatusSchema = z.enum([
  'pending',
  'open',
  'filled',
  'settled',
  'cancelled',
  'expired',
])
const VoucherStatusSchema = z.enum([
  'pending',
  'issued',
  'fulfilled',
  'expired',
  'cancelled',
])

export const NativeCurrencySchema = z.object({
  name: z.string().min(1),
  symbol: z.string().min(1),
  decimals: z.number().int().min(0).max(255),
})

export const RpcUrlsSchema = z.object({
  default: z.object({
    http: z.array(z.string().url()).min(1),
    webSocket: z.array(z.string().url()).default([]),
  }),
  jeju: z
    .object({
      http: z.array(z.string().url()).min(1),
      webSocket: z.array(z.string().url()).default([]),
    })
    .optional(),
})

export const BlockExplorerSchema = z.object({
  default: z.object({
    name: z.string().min(1),
    url: z.string().url(),
  }),
})

export const ChainConfigSchema = z.object({
  id: ChainIdSchema,
  name: z.string().min(1),
  network: z.string().min(1),
  nativeCurrency: NativeCurrencySchema,
  rpcUrls: RpcUrlsSchema,
  blockExplorers: BlockExplorerSchema,
  testnet: z.boolean().optional(),
  eilSupported: z.boolean(),
  oifSupported: z.boolean(),
  paymasterAddress: AddressSchema.optional(),
  inputSettlerAddress: AddressSchema.optional(),
  outputSettlerAddress: AddressSchema.optional(),
  crossChainPaymasterAddress: AddressSchema.optional(),
})

export const SolanaConfigSchema = z.object({
  name: z.string().min(1),
  cluster: z.enum(['mainnet-beta', 'testnet', 'devnet']),
  rpcUrl: z.string().url(),
  wsUrl: z.string().url().optional(),
})

export const AccountSchema = z.object({
  address: AddressSchema,
  type: AccountTypeSchema,
  chainId: ChainIdSchema,
  label: z.string().optional(),
  isDefault: z.boolean().optional(),
})

export const SmartAccountSchema = AccountSchema.extend({
  type: z.literal('smart-account'),
  implementation: SmartAccountImplementationSchema,
  factoryAddress: AddressSchema,
  initCode: HexSchema.optional(),
  isDeployed: z.boolean(),
})

export const SolanaAccountSchema = z.object({
  publicKey: z.string().min(1),
  label: z.string().optional(),
  isDefault: z.boolean().optional(),
})

export const WalletAccountSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  evmAccounts: z.array(AccountSchema),
  solanaAccounts: z.array(SolanaAccountSchema),
  smartAccounts: z.array(SmartAccountSchema),
})

export const TokenSchema = z.object({
  address: AddressSchema,
  chainId: ChainIdSchema,
  symbol: z.string().min(1),
  name: z.string().min(1),
  decimals: z.number().int().min(0).max(255),
  logoUri: z.string().url().optional(),
  isNative: z.boolean().optional(),
  bridgeInfo: z
    .record(ChainIdSchema, z.object({ tokenAddress: AddressSchema }))
    .optional(),
})

export const TokenBalanceSchema = z.object({
  token: TokenSchema,
  balance: BigIntSchema,
  usdValue: z.number().nonnegative().optional(),
})

export const AggregatedBalanceSchema = z.object({
  symbol: z.string().min(1),
  totalBalance: BigIntSchema,
  totalUsdValue: z.number().nonnegative(),
  chains: z.array(
    z.object({
      chainId: ChainIdSchema,
      balance: BigIntSchema,
      usdValue: z.number().nonnegative(),
      token: TokenSchema,
    }),
  ),
})

export const TransactionSchema = z.object({
  id: z.string().min(1),
  hash: HexSchema.optional(),
  chainId: ChainIdSchema,
  from: AddressSchema,
  to: AddressSchema,
  value: BigIntSchema,
  data: HexSchema.optional(),
  status: TransactionStatusSchema,
  timestamp: TimestampSchema,
  gasUsed: BigIntSchema.optional(),
  gasFee: BigIntSchema.optional(),
  isCrossChain: z.boolean().optional(),
  sourceChainId: ChainIdSchema.optional(),
  destinationChainId: ChainIdSchema.optional(),
  intentId: HexSchema.optional(),
  voucherId: HexSchema.optional(),
})

export const IntentRouteSchema = z.object({
  chainId: ChainIdSchema,
  protocol: z.string().min(1),
  action: z.enum(['swap', 'bridge', 'transfer']),
  inputToken: AddressSchema,
  outputToken: AddressSchema,
  inputAmount: BigIntSchema,
  outputAmount: BigIntSchema,
})

export const IntentSchema = z.object({
  id: HexSchema,
  user: AddressSchema,
  inputToken: AddressSchema,
  inputAmount: BigIntSchema,
  outputToken: AddressSchema,
  outputAmount: BigIntSchema,
  sourceChainId: ChainIdSchema,
  destinationChainId: ChainIdSchema,
  recipient: AddressSchema,
  maxFee: BigIntSchema,
  openDeadline: TimestampSchema,
  fillDeadline: TimestampSchema,
  status: IntentStatusSchema,
  solver: AddressSchema.optional(),
  txHash: HexSchema.optional(),
  fillTxHash: HexSchema.optional(),
  createdAt: TimestampSchema,
})

export const IntentParamsSchema = z.object({
  inputToken: AddressSchema,
  inputAmount: BigIntSchema,
  outputToken: AddressSchema,
  minOutputAmount: BigIntSchema,
  destinationChainId: ChainIdSchema,
  recipient: AddressSchema.optional(),
  maxFee: BigIntSchema.optional(),
  deadline: TimestampSchema.optional(),
})

export const IntentQuoteSchema = z.object({
  inputToken: AddressSchema,
  inputAmount: BigIntSchema,
  outputToken: AddressSchema,
  outputAmount: BigIntSchema,
  fee: BigIntSchema,
  route: z.array(IntentRouteSchema),
  estimatedTime: z.number().int().nonnegative(),
  priceImpact: z.number().min(-100).max(100),
})

export const VoucherRequestSchema = z.object({
  id: HexSchema,
  requester: AddressSchema,
  token: AddressSchema,
  amount: BigIntSchema,
  destinationToken: AddressSchema,
  destinationChainId: ChainIdSchema,
  recipient: AddressSchema,
  gasOnDestination: BigIntSchema,
  maxFee: BigIntSchema,
  feeIncrement: BigIntSchema,
  deadline: TimestampSchema,
  status: VoucherStatusSchema,
})

export const VoucherSchema = z.object({
  id: HexSchema,
  requestId: HexSchema,
  xlp: AddressSchema,
  sourceChainId: ChainIdSchema,
  destinationChainId: ChainIdSchema,
  sourceToken: AddressSchema,
  destinationToken: AddressSchema,
  amount: BigIntSchema,
  fee: BigIntSchema,
  gasProvided: BigIntSchema,
  issuedBlock: z.number().int().nonnegative(),
  expiresBlock: z.number().int().nonnegative(),
  status: VoucherStatusSchema,
})

export const GasOptionSchema = z.object({
  token: TokenSchema,
  tokenAmount: BigIntSchema,
  ethEquivalent: BigIntSchema,
  usdValue: z.number().nonnegative(),
  isPreferred: z.boolean().optional(),
  reason: z.string().optional(),
})

export const GasEstimateSchema = z.object({
  gasLimit: BigIntSchema,
  maxFeePerGas: BigIntSchema,
  maxPriorityFeePerGas: BigIntSchema,
  totalCostEth: BigIntSchema,
  tokenOptions: z.array(GasOptionSchema),
})

export const UserOperationSchema = z.object({
  sender: AddressSchema,
  nonce: BigIntSchema,
  initCode: HexSchema,
  callData: HexSchema,
  callGasLimit: BigIntSchema,
  verificationGasLimit: BigIntSchema,
  preVerificationGas: BigIntSchema,
  maxFeePerGas: BigIntSchema,
  maxPriorityFeePerGas: BigIntSchema,
  paymasterAndData: HexSchema,
  signature: HexSchema,
})

export const ConnectedSiteSchema = z.object({
  origin: z.string().min(1),
  name: z.string().optional(),
  icon: z.string().url().optional(),
  permissions: z.array(SitePermissionSchema),
  connectedAt: TimestampSchema,
})

export const WalletStateSchema = z.object({
  isUnlocked: z.boolean(),
  accounts: z.array(WalletAccountSchema),
  activeAccountId: z.string().optional(),
  activeChainId: ChainIdSchema.optional(),
  connectedSites: z.array(ConnectedSiteSchema),
})

// Message payload schema for wallet events
const WalletMessagePayloadSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('subscriptionResult'),
    result: z.object({
      chainId: ChainIdSchema,
      address: AddressSchema,
    }),
  }),
  z.object({
    type: z.literal('error'),
    code: z.number().int(),
    message: z.string(),
  }),
])

export const WalletEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('accountsChanged'),
    accounts: z.array(AddressSchema),
  }),
  z.object({
    type: z.literal('chainChanged'),
    chainId: ChainIdSchema,
  }),
  z.object({
    type: z.literal('connect'),
    chainId: ChainIdSchema,
  }),
  z.object({
    type: z.literal('disconnect'),
  }),
  z.object({
    type: z.literal('message'),
    data: WalletMessagePayloadSchema,
  }),
  z.object({
    type: z.literal('intentCreated'),
    intent: IntentSchema,
  }),
  z.object({
    type: z.literal('intentFilled'),
    intent: IntentSchema,
  }),
  z.object({
    type: z.literal('voucherIssued'),
    voucher: VoucherSchema,
  }),
  z.object({
    type: z.literal('crossChainComplete'),
    transaction: TransactionSchema,
  }),
])
