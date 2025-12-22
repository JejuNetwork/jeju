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

export * from './types';
export * from './schemas';

// ============================================================================
// ABIs
// ============================================================================

export {
  // Core ABIs
  ERC20Abi,
  ERC20FactoryAbi,
  BazaarAbi,
  // ERC-8004 Registry ABIs
  IdentityRegistryAbi,
  ReputationRegistryAbi,
  ValidationRegistryAbi,
  ERC20ReadAbi,
  ERC20WriteAbi,
  // Native token ABI
  NetworkTokenAbi,
  NetworkTokenAbiJson,
  // Moderation ABIs
  BanManagerAbi,
  BanManagerAbiJson,
  ModerationMarketplaceAbi,
  ModerationMarketplaceAbiJson,
  // Service ABIs (with JEJU support)
  CreditManagerAbi,
  CreditManagerAbiJson,
  MultiTokenPaymasterAbi,
  MultiTokenPaymasterAbiJson,
  // Paymaster System ABIs
  TokenRegistryAbi,
  TokenRegistryAbiJson,
  PaymasterFactoryAbi,
  PaymasterFactoryAbiJson,
  LiquidityVaultAbi,
  LiquidityVaultAbiJson,
  AppTokenPreferenceAbi,
  AppTokenPreferenceAbiJson,
  // OIF (Open Intents Framework) ABIs
  InputSettlerAbi,
  OutputSettlerAbi,
  SolverRegistryAbi,
  SimpleOracleAbi,
  HyperlaneOracleAbi,
  SuperchainOracleAbi,
  // Game ABIs (Hyperscape / forkable game infrastructure)
  // Note: Games use standard network BanManager for moderation
  GoldAbi,
  ItemsAbi,
  GameIntegrationAbi,
  PlayerTradeEscrowAbi,
  // Paymaster ABIs (ERC-4337 Account Abstraction)
  SponsoredPaymasterAbi,
  // Launchpad ABIs
  TokenLaunchpadAbi,
  BondingCurveAbi,
  ICOPresaleAbi,
  LPLockerAbi,
  LaunchpadTokenAbi,
  // Chainlink ABIs (VRF, Automation, Oracle)
  VRFCoordinatorV2_5Abi,
  AutomationRegistryAbi,
  OracleRouterAbi,
  ChainlinkGovernanceAbi,
  // Full JSON exports
  ERC20AbiJson,
  ERC20FactoryAbiJson,
  BazaarAbiJson,
  IdentityRegistryAbiJson,
  ReputationRegistryAbiJson,
  ValidationRegistryAbiJson,
  InputSettlerAbiJson,
  OutputSettlerAbiJson,
  SolverRegistryAbiJson,
  SimpleOracleAbiJson,
  HyperlaneOracleAbiJson,
  SuperchainOracleAbiJson,
  GoldAbiJson,
  ItemsAbiJson,
  GameIntegrationAbiJson,
  PlayerTradeEscrowAbiJson,
  SponsoredPaymasterAbiJson,
  TokenLaunchpadAbiJson,
  BondingCurveAbiJson,
  ICOPresaleAbiJson,
  LPLockerAbiJson,
  LaunchpadTokenAbiJson,
  VRFCoordinatorV2_5AbiJson,
  AutomationRegistryAbiJson,
  OracleRouterAbiJson,
  ChainlinkGovernanceAbiJson,
} from './abis';

// ============================================================================
// Deployments
// ============================================================================

export {
  // Typed deployment records
  uniswapV4Deployments,
  bazaarMarketplaceDeployments,
  erc20FactoryDeployments,
  identitySystemDeployments,
  paymasterDeployments,
  xlpDeployments,
  gameSystemDeployments,
  launchpadDeployments,
  // Helper functions
  getUniswapV4,
  getBazaarMarketplace,
  getERC20Factory,
  getIdentityRegistry,
  getXLPDeployment,
  getContractAddresses,
  getContractAddressesByNetwork,
  // Game system helpers
  getGameSystem,
  getGameGold,
  getGameItems,
  getGameIntegration,
  // Paymaster / AA helpers
  getPaymasterSystem,
  getSponsoredPaymaster,
  // Launchpad helpers
  getLaunchpadDeployment,
  getTokenLaunchpad,
  // Raw deployments
  rawDeployments,
  // Types
  type GameSystemDeployment,
} from './deployments';

// ============================================================================
// Constants
// ============================================================================

export { CHAIN_IDS, NETWORK_BY_CHAIN_ID, ZERO_ADDRESS } from './types';

// ============================================================================
// Utilities
// ============================================================================

export { isValidAddress } from './types';

// ============================================================================
// Account Abstraction (ERC-4337)
// ============================================================================

export {
  // Constants
  ENTRYPOINT_V07_ADDRESS,
  DEFAULT_GAS_LIMITS,
  // Types
  type PaymasterData,
  type SponsoredPaymasterConfig,
  type LiquidityPaymasterConfig,
  type MultiTokenPaymasterConfig,
  // Paymaster data builders
  getSponsoredPaymasterData,
  getLiquidityPaymasterData,
  getMultiTokenPaymasterData,
  // Helpers
  parsePaymasterAddress,
  isSponsoredPaymaster,
  calculateRequiredDeposit,
  // Minimal ABIs (full ABIs are in ./abis)
  SponsoredPaymasterAbi as SponsoredPaymasterMinimalAbi,
  LiquidityPaymasterAbi as LiquidityPaymasterMinimalAbi,
  EntryPointAbi as EntryPointMinimalAbi,
} from './aa';

// ============================================================================
// CAIP (Chain Agnostic Improvement Proposals)
// ============================================================================

export {
  // Chain identification (CAIP-2)
  parseChainId,
  formatChainId,
  getChainInfo,
  evmChainIdToCAIP2,
  caip2ToEvmChainId,
  isEvmChain,
  isSolanaChain,
  getSolanaCluster,
  solanaClusterToCAIP2,
  getAllChains,
  getMainnetChains,
  getTestnetChains,
  CHAINS,
  SOLANA_MAINNET_GENESIS,
  SOLANA_DEVNET_GENESIS,
  SOLANA_TESTNET_GENESIS,
  type ChainNamespace,
  type ChainId as CAIPChainId,
  type ChainInfo,
  // Account identification (CAIP-10)
  parseAccountId,
  formatAccountId,
  createUniversalAddress,
  isValidAccountId,
  isValidSolanaAddress,
  isValidEvmAddress,
  evmAddressToCAIP10,
  solanaAddressToCAIP10,
  caip10ToEvmAddress,
  caip10ToSolanaPublicKey,
  createMultiChainAddress,
  bytes32ToAddress,
  areAddressesEqual,
  shortenAddress,
  type AccountId,
  type UniversalAddress,
  type MultiChainAddress,
  // Asset identification (CAIP-19)
  parseAssetType,
  formatAssetType,
  getAssetInfo,
  isValidAssetType,
  nativeCurrencyToCAIP19,
  erc20ToCAIP19,
  splTokenToCAIP19,
  erc721ToCAIP19,
  caip19ToErc20Address,
  caip19ToSplMint,
  findEquivalentAsset,
  getAssetChainMap,
  SLIP44,
  KNOWN_ASSETS,
  CROSS_CHAIN_ASSETS,
  type AssetNamespace,
  type AssetType,
  type AssetInfo,
  type CrossChainAsset,
  // Unified utilities
  parseUniversalId,
  isValidCAIP,
  getCAIPType,
  caip,
  CAIPBuilder,
  type UniversalId,
} from './caip';

