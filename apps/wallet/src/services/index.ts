/**
 * Jeju Wallet Services
 * Core services using Jeju infrastructure
 */

// Jeju infrastructure (indexer, bundler, graphql)
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

export { hardwareWalletService, HardwareWalletService } from './hardware';
export type { HardwareDevice, HardwareAccount as HWAccount, HardwareWalletType } from './hardware';

