/**
 * Network Wallet Services
 * Core services using the network infrastructure
 */

export type {
  PaymasterData,
  SmartAccount,
  UserOperation,
  UserOpGasLimits,
} from './account-abstraction'
export { AccountAbstractionService, aaService } from './account-abstraction'
export * from './approval'
// Seed Phrase Backup
export { BackupService, backupService } from './backup'
export type { CollectionInfo, CreateListingParams, Listing } from './bazaar'
// Bazaar NFT Marketplace
export {
  AssetType,
  BazaarService,
  bazaarService,
  ListingStatus,
} from './bazaar'
export type { Contact } from './contacts'
// Contact Book
export { ContactsService, contactsService } from './contacts'
export type { CustomChain, CustomRPC } from './custom-rpc'
// Custom RPC Management
export { CustomRPCService, customRPCService } from './custom-rpc'
export type { CachedAsset, EdgeConfig, EdgeStats } from './edge'
// Wallet Edge (micro edge node)
export { getEdgeService, resetEdgeService, WalletEdgeService } from './edge'
export type {
  HardwareAccount as HWAccount,
  HardwareDevice,
  HardwareWalletType,
} from './hardware'
// Hardware Wallets (Ledger, Trezor) - keyrings are lazy-loaded
export { HardwareWalletService, hardwareWalletService } from './hardware'
// For Ledger/Trezor-specific types, import from ./hardware/ledger or ./hardware/trezor
export type { LedgerAccount, LedgerKeyring } from './hardware/ledger'
export type { TrezorAccount, TrezorKeyring } from './hardware/trezor'
export * from './history'
// Network infrastructure (indexer, bundler, graphql)
export * as jeju from './jeju'
export type { JNSName, JNSPricing, JNSRegistrationParams } from './jns'
// JNS Name Service
export { JNSService, jnsService } from './jns'
export type {
  Account,
  HardwareAccount,
  HDAccount,
  ImportedAccount,
  KeySourceType,
  SmartWalletAccount,
  WatchAccount,
} from './keyring'
// Keyring Service (explicit names to avoid conflicts with Account type above)
export { KeyringService, keyringService } from './keyring'
export type {
  BondingCurveInfo,
  Launch,
  LaunchBondingCurveParams,
  LaunchICOParams,
  PresaleInfo,
} from './launchpad'
// Token Launchpad
export { LaunchpadService, LaunchType, launchpadService } from './launchpad'
export type { LockType } from './lock'
// Wallet Lock & Security
export { LockService, lockService } from './lock'
export type { NFT, NFTCollection } from './nft'
export { NFTService, nftService } from './nft'
export * from './oracle'
export type {
  ClosePositionParams,
  OpenPositionParams,
  PerpMarket,
  PerpPosition,
} from './perps'
// Perpetual Futures Trading
export {
  MARKET_IDS,
  MarginType,
  PerpsService,
  PositionSide,
  perpsService,
} from './perps'
export type {
  AddLiquidityV2Params,
  RemoveLiquidityV2Params,
  V2Pool,
  V2Position,
  V3Position,
} from './pools'

// Liquidity Pools (XLP V2/V3)
export { PoolsService, poolsService } from './pools'
// Core services
export * from './rpc'
export type {
  SafeConfirmation,
  SafeInfo,
  SafeTransaction,
  SafeTransactionData,
} from './safe'
// Gnosis Safe / Multisig
export { SafeService, safeService } from './safe'
export * from './security'
export type {
  ContractInteraction,
  NFTChange,
  SimulationResult,
  TokenChange,
  TransactionToSimulate,
} from './simulation'
// Transaction Simulation
export { SimulationService, simulationService } from './simulation'
export * from './swap'
export type {
  UpdateConfig,
  UpdateInfo,
  UpdateListener,
  UpdateState,
} from './updater'
// Auto-Updater
export { getUpdateService, resetUpdateService, UpdateService } from './updater'
