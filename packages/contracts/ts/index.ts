/**
 * @fileoverview Main exports for @jejunetwork/contracts package
 * @module @jejunetwork/contracts
 *
 * This package provides:
 * - Contract ABIs for network smart contracts
 * - Typed deployment addresses
 * - Helper functions for getting addresses by chain/network
 *
 * @example
 * ```typescript
 * import {
 *   getContractAddresses,
 *   ERC20Abi,
 *   IdentityRegistryAbi,
 *   CHAIN_IDS
 * } from '@jejunetwork/contracts';
 *
 * // Get all addresses for localnet
 * const addresses = getContractAddresses(1337);
 * console.log(addresses.identityRegistry);
 *
 * // Use ABIs with viem
 * import { createPublicClient, http } from 'viem';
 * const client = createPublicClient({ transport: http() });
 * const balance = await client.readContract({
 *   address: tokenAddress,
 *   abi: ERC20Abi,
 *   functionName: 'balanceOf',
 *   args: [userAddress],
 * });
 * ```
 */

// ============================================================================
// Types & Schemas
// ============================================================================

export * from './schemas'
export * from './types'

// ============================================================================
// ABIs
// ============================================================================

export {
  AppTokenPreferenceAbi,
  AppTokenPreferenceAbiJson,
  AutomationRegistryAbi,
  AutomationRegistryAbiJson,
  // Babylon Diamond ABIs (EIP-2535 Prediction Markets)
  BabylonDiamondAbi,
  BabylonDiamondAbiJson,
  BabylonDiamondCutFacetAbi,
  BabylonDiamondCutFacetAbiJson,
  BabylonDiamondLoupeFacetAbi,
  BabylonDiamondLoupeFacetAbiJson,
  BabylonERC8004IdentityRegistryAbi,
  BabylonERC8004IdentityRegistryAbiJson,
  BabylonERC8004ReputationSystemAbi,
  BabylonERC8004ReputationSystemAbiJson,
  BabylonOracleFacetAbi,
  BabylonOracleFacetAbiJson,
  BabylonPredictionMarketFacetAbi,
  BabylonPredictionMarketFacetAbiJson,
  // Moderation ABIs
  BanManagerAbi,
  BanManagerAbiJson,
  BazaarAbi,
  BazaarAbiJson,
  BondingCurveAbi,
  BondingCurveAbiJson,
  ChainlinkGovernanceAbi,
  ChainlinkGovernanceAbiJson,
  // Service ABIs (with JEJU support)
  CreditManagerAbi,
  CreditManagerAbiJson,
  // Core ABIs
  ERC20Abi,
  // Full JSON exports
  ERC20AbiJson,
  ERC20FactoryAbi,
  ERC20FactoryAbiJson,
  ERC20ReadAbi,
  ERC20WriteAbi,
  GameIntegrationAbi,
  GameIntegrationAbiJson,
  // Game ABIs (Hyperscape / forkable game infrastructure)
  // Note: Games use standard network BanManager for moderation
  GoldAbi,
  GoldAbiJson,
  HyperlaneOracleAbi,
  HyperlaneOracleAbiJson,
  ICOPresaleAbi,
  ICOPresaleAbiJson,
  // ERC-8004 Registry ABIs
  IdentityRegistryAbi,
  IdentityRegistryAbiJson,
  // OIF (Open Intents Framework) ABIs
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
  // Native token ABI
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
  // Paymaster ABIs (ERC-4337 Account Abstraction)
  SponsoredPaymasterAbi,
  SponsoredPaymasterAbiJson,
  SuperchainOracleAbi,
  SuperchainOracleAbiJson,
  // Launchpad ABIs
  TokenLaunchpadAbi,
  TokenLaunchpadAbiJson,
  // Paymaster System ABIs
  TokenRegistryAbi,
  TokenRegistryAbiJson,
  ValidationRegistryAbi,
  ValidationRegistryAbiJson,
  // Chainlink ABIs (VRF, Automation, Oracle)
  VRFCoordinatorV2_5Abi,
  VRFCoordinatorV2_5AbiJson,
} from './abis'

// ============================================================================
// Deployments
// ============================================================================

export {
  bazaarMarketplaceDeployments,
  erc20FactoryDeployments,
  // Types
  type GameSystemDeployment,
  gameSystemDeployments,
  getBazaarMarketplace,
  getContractAddresses,
  getContractAddressesByNetwork,
  getERC20Factory,
  getGameGold,
  getGameIntegration,
  getGameItems,
  // Game system helpers
  getGameSystem,
  getIdentityRegistry,
  // Launchpad helpers
  getLaunchpadDeployment,
  // Paymaster / AA helpers
  getPaymasterSystem,
  getSponsoredPaymaster,
  getTokenLaunchpad,
  // Helper functions
  getUniswapV4,
  getXLPDeployment,
  identitySystemDeployments,
  launchpadDeployments,
  paymasterDeployments,
  // Raw deployments
  rawDeployments,
  // Typed deployment records
  uniswapV4Deployments,
  xlpDeployments,
} from './deployments'

// ============================================================================
// Constants
// ============================================================================

export { CHAIN_IDS, NETWORK_BY_CHAIN_ID, ZERO_ADDRESS } from './types'

// ============================================================================
// Utilities
// ============================================================================

export { isValidAddress } from './types'

// ============================================================================
// Account Abstraction (ERC-4337)
// ============================================================================

export {
  calculateRequiredDeposit,
  DEFAULT_GAS_LIMITS,
  // Constants
  ENTRYPOINT_V07_ADDRESS,
  EntryPointAbi as EntryPointMinimalAbi,
  getLiquidityPaymasterData,
  getMultiTokenPaymasterData,
  // Paymaster data builders
  getSponsoredPaymasterData,
  isSponsoredPaymaster,
  LiquidityPaymasterAbi as LiquidityPaymasterMinimalAbi,
  type LiquidityPaymasterConfig,
  type MultiTokenPaymasterConfig,
  // Types
  type PaymasterData,
  // Helpers
  parsePaymasterAddress,
  // Minimal ABIs (full ABIs are in ./abis)
  SponsoredPaymasterAbi as SponsoredPaymasterMinimalAbi,
  type SponsoredPaymasterConfig,
} from './aa'

// ============================================================================
// CAIP (Chain Agnostic Improvement Proposals)
// ============================================================================

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
  // Account identification (CAIP-10)
  parseAccountId,
  // Asset identification (CAIP-19)
  parseAssetType,
  // Chain identification (CAIP-2)
  parseChainId,
  // Unified utilities
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
