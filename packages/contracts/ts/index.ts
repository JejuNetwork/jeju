/**
 * @fileoverview Main exports for @jejunetwork/contracts package
 * @module @jejunetwork/contracts
 *
 * This package provides:
 * 1. Typed ABIs from wagmi CLI (generated.ts) - with full type inference
 * 2. CAIP utilities for cross-chain addressing
 * 3. Deployment addresses by network
 *
 * Always use typed ABIs (camelCase) for full type inference:
 * ```typescript
 * import { identityRegistryAbi } from '@jejunetwork/contracts'
 * ```
 */

// ============================================================================
// Account Abstraction utilities
// ============================================================================
export {
  calculateRequiredDeposit,
  DEFAULT_GAS_LIMITS,
  ENTRYPOINT_V07_ADDRESS,
  EntryPointAbi as EntryPointMinimalAbi,
  getLiquidityPaymasterData,
  getMultiTokenPaymasterData,
  getSponsoredPaymasterData,
  isSponsoredPaymaster,
  LiquidityPaymasterAbi as LiquidityPaymasterMinimalAbi,
  type LiquidityPaymasterConfig,
  type MultiTokenPaymasterConfig,
  type PaymasterData,
  parsePaymasterAddress,
  SponsoredPaymasterAbi as SponsoredPaymasterMinimalAbi,
  type SponsoredPaymasterConfig,
} from './aa'
// ERC20 typed ABI fragments (for common operations)
// PascalCase ABI aliases for backward compatibility
export {
  ERC20ReadAbi,
  ERC20WriteAbi,
} from './abis'

// Import directly from './generated':
// import { banManagerAbi as BanManagerAbi, identityRegistryAbi as IdentityRegistryAbi, moderationMarketplaceAbi as ModerationMarketplaceAbi, reputationRegistryAbi as ReputationRegistryAbi } from './generated'
export {
  type AccountId,
  type AssetInfo,
  type AssetNamespace,
  type AssetType,
  areAddressesEqual,
  bytes32ToAddress,
  CAIPBuilder,
  CHAINS,
  type ChainId as CAIPChainId,
  type ChainInfo,
  type ChainNamespace,
  CROSS_CHAIN_ASSETS,
  type CrossChainAsset,
  caip,
  caip2ToEvmChainId,
  caip10ToEvmAddress,
  caip10ToSolanaPublicKey,
  caip19ToErc20Address,
  caip19ToSplMint,
  createMultiChainAddress,
  createUniversalAddress,
  erc20ToCAIP19,
  erc721ToCAIP19,
  evmAddressToCAIP10,
  evmChainIdToCAIP2,
  findEquivalentAsset,
  formatAccountId,
  formatAssetType,
  formatChainId,
  getAllChains,
  getAssetChainMap,
  getAssetInfo,
  getCAIPType,
  getChainInfo,
  getMainnetChains,
  getSolanaCluster,
  getTestnetChains,
  isEvmChain,
  isSolanaChain,
  isValidAccountId,
  isValidAssetType,
  isValidCAIP,
  isValidEvmAddress,
  isValidSolanaAddress,
  KNOWN_ASSETS,
  type MultiChainAddress,
  nativeCurrencyToCAIP19,
  parseAccountId,
  parseAssetType,
  parseChainId,
  parseUniversalId,
  SLIP44,
  SOLANA_DEVNET_GENESIS,
  SOLANA_MAINNET_GENESIS,
  SOLANA_TESTNET_GENESIS,
  shortenAddress,
  solanaAddressToCAIP10,
  solanaClusterToCAIP2,
  splTokenToCAIP19,
  type UniversalAddress,
  type UniversalId,
} from './caip'
export {
  bazaarMarketplaceDeployments,
  erc20FactoryDeployments,
  getBazaarMarketplace,
  getContractAddresses,
  getContractAddressesByNetwork,
  getERC20Factory,
  getIdentityRegistry,
  getLaunchpadDeployment,
  getPaymasterSystem,
  getSimpleCollectible,
  getSponsoredPaymaster,
  getTokenLaunchpad,
  getUniswapV4,
  getXLPDeployment,
  identitySystemDeployments,
  launchpadDeployments,
  paymasterDeployments,
  rawDeployments,
  simpleCollectibleDeployments,
  uniswapV4Deployments,
  xlpDeployments,
} from './deployments'
// ============================================================================
// TYPED ABIs - Generated with full type inference (PREFERRED)
// ============================================================================
export * from './eip7702'
export * from './generated'
export * from './schemas'
export * from './types'
export * from './viem'
export * from './wagmi'
