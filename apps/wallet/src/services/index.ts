/**
 * Network Wallet Services
 * Core services using the network infrastructure
 */

// Network infrastructure (indexer, bundler, graphql)
export * as jeju from './jeju';

// Core services
export * from './rpc';
export * from './oracle';
export * from './security';
export * from './swap';
export * from './approval';
export * from './history';

// Re-export with explicit names to avoid conflicts
export { keyringService, KeyringService } from './keyring';
export type { Account, HDAccount, ImportedAccount, WatchAccount, HardwareAccount, SmartWalletAccount, AccountType } from './keyring';

export { aaService, AccountAbstractionService } from './account-abstraction';
export type { UserOperation, GasEstimate, PaymasterData, SmartAccount } from './account-abstraction';

export { nftService, NFTService } from './nft';
export type { NFT, NFTCollection } from './nft';

// Hardware Wallets (Ledger, Trezor)
export { hardwareWalletService, HardwareWalletService, ledgerKeyring, trezorKeyring } from './hardware';
export type { HardwareDevice, HardwareAccount as HWAccount, HardwareWalletType, LedgerAccount, TrezorAccount } from './hardware';

// Transaction Simulation
export { simulationService, SimulationService } from './simulation';
export type { SimulationResult, TokenChange, NFTChange, ContractInteraction, TransactionToSimulate } from './simulation';

// Wallet Lock & Security
export { lockService, LockService } from './lock';
export type { LockType } from './lock';

// Seed Phrase Backup
export { backupService, BackupService } from './backup';

// Contact Book
export { contactsService, ContactsService } from './contacts';
export type { Contact } from './contacts';

// Gnosis Safe / Multisig
export { safeService, SafeService } from './safe';
export type { SafeInfo, SafeTransaction, SafeTransactionData, SafeConfirmation } from './safe';

// Custom RPC Management
export { customRPCService, CustomRPCService } from './custom-rpc';
export type { CustomRPC, CustomChain } from './custom-rpc';

// JNS Name Service
export { jnsService, JNSService } from './jns';
export type { JNSName, JNSRegistrationParams, JNSPricing } from './jns';

// Bazaar NFT Marketplace
export { bazaarService, BazaarService, AssetType, ListingStatus } from './bazaar';
export type { Listing, CreateListingParams, CollectionInfo } from './bazaar';

// Liquidity Pools (XLP V2/V3)
export { poolsService, PoolsService } from './pools';
export type { V2Pool, V2Position, V3Position, AddLiquidityV2Params, RemoveLiquidityV2Params } from './pools';

// Perpetual Futures Trading
export { perpsService, PerpsService, PositionSide, MarginType, MARKET_IDS } from './perps';
export type { PerpMarket, PerpPosition, OpenPositionParams, ClosePositionParams } from './perps';

// Token Launchpad
export { launchpadService, LaunchpadService, LaunchType } from './launchpad';
export type { Launch, BondingCurveInfo, PresaleInfo, LaunchBondingCurveParams, LaunchICOParams } from './launchpad';

// Wallet Edge (micro edge node)
export { WalletEdgeService, getEdgeService, resetEdgeService } from './edge';
export type { EdgeConfig, EdgeStats, CachedAsset } from './edge';

// Auto-Updater
export { UpdateService, getUpdateService, resetUpdateService } from './updater';
export type { UpdateConfig, UpdateInfo, UpdateState, UpdateListener } from './updater';

