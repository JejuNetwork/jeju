/**
 * @fileoverview Main exports for @jejunetwork/contracts package
 * @module @jejunetwork/contracts
 *
 * This package provides:
 * 1. Typed ABIs from wagmi CLI (generated.ts) - with full type inference
 * 2. Legacy ABIs (abis/index.ts) - backward compatible, cast to Abi
 * 3. CAIP utilities for cross-chain addressing
 * 4. Deployment addresses by network
 *
 * Prefer importing typed ABIs (camelCase) over legacy ABIs (PascalCase):
 * ```typescript
 * // GOOD - Full type inference
 * import { identityRegistryAbi } from '@jejunetwork/contracts'
 *
 * // LEGACY - No type inference
 * import { IdentityRegistryAbi } from '@jejunetwork/contracts'
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
// ============================================================================
// LEGACY ABIs - Cast to Abi type (backward compatible, no type inference)
// ============================================================================
export {
  AppTokenPreferenceAbi,
  AppTokenPreferenceAbiJson,
  AutomationRegistryAbi,
  AutomationRegistryAbiJson,
  BanManagerAbi,
  BanManagerAbiJson,
  BazaarAbi,
  BazaarAbiJson,
  BondingCurveAbi,
  BondingCurveAbiJson,
  ChainlinkGovernanceAbi,
  ChainlinkGovernanceAbiJson,
  CreditManagerAbi,
  CreditManagerAbiJson,
  ERC20Abi,
  ERC20AbiJson,
  ERC20FactoryAbi,
  ERC20FactoryAbiJson,
  ERC20ReadAbi,
  ERC20WriteAbi,
  GameIntegrationAbi,
  GameIntegrationAbiJson,
  GoldAbi,
  GoldAbiJson,
  HyperlaneOracleAbi,
  HyperlaneOracleAbiJson,
  ICOPresaleAbi,
  ICOPresaleAbiJson,
  IdentityRegistryAbi,
  IdentityRegistryAbiJson,
  InputSettlerAbi,
  InputSettlerAbiJson,
  ItemsAbi,
  ItemsAbiJson,
  LaunchpadTokenAbi,
  LaunchpadTokenAbiJson,
  LiquidityVaultAbi,
  LiquidityVaultAbiJson,
  LPLockerAbi,
  LPLockerAbiJson,
  ModerationMarketplaceAbi,
  ModerationMarketplaceAbiJson,
  MultiTokenPaymasterAbi,
  MultiTokenPaymasterAbiJson,
  NetworkTokenAbi,
  NetworkTokenAbiJson,
  OracleRouterAbi,
  OracleRouterAbiJson,
  OutputSettlerAbi,
  OutputSettlerAbiJson,
  PaymasterFactoryAbi,
  PaymasterFactoryAbiJson,
  PlayerTradeEscrowAbi,
  PlayerTradeEscrowAbiJson,
  ReputationRegistryAbi,
  ReputationRegistryAbiJson,
  SimpleOracleAbi,
  SimpleOracleAbiJson,
  SolverRegistryAbi,
  SolverRegistryAbiJson,
  SponsoredPaymasterAbi,
  SponsoredPaymasterAbiJson,
  SuperchainOracleAbi,
  SuperchainOracleAbiJson,
  TokenLaunchpadAbi,
  TokenLaunchpadAbiJson,
  TokenRegistryAbi,
  TokenRegistryAbiJson,
  ValidationRegistryAbi,
  ValidationRegistryAbiJson,
  VRFCoordinatorV2_5Abi,
  VRFCoordinatorV2_5AbiJson,
} from './abis'
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
  gameSystemDeployments,
  getBazaarMarketplace,
  getContractAddresses,
  getContractAddressesByNetwork,
  getERC20Factory,
  getGameGold,
  getGameIntegration,
  getGameItems,
  getGameSystem,
  getIdentityRegistry,
  getLaunchpadDeployment,
  getPaymasterSystem,
  getSponsoredPaymaster,
  getTokenLaunchpad,
  getUniswapV4,
  getXLPDeployment,
  identitySystemDeployments,
  launchpadDeployments,
  paymasterDeployments,
  rawDeployments,
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
