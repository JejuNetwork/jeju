/**
 * @fileoverview Main exports for @jejunetwork/contracts package
 * @module @jejunetwork/contracts
 * 
 * This package provides:
 * - Contract ABIs for Jeju smart contracts
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
// Types
// ============================================================================

export * from './types';

// ============================================================================
// ABIs
// ============================================================================

export {
  // Core ABIs
  ERC20Abi,
  ERC20FactoryAbi,
  BazaarAbi,
  IdentityRegistryAbi,
  ERC20ReadAbi,
  ERC20WriteAbi,
  // Native token ABI
  JejuTokenAbi,
  JejuTokenAbiJson,
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
  // Note: Games use standard Jeju BanManager for moderation
  GoldAbi,
  ItemsAbi,
  GameIntegrationAbi,
  PlayerTradeEscrowAbi,
  // Paymaster ABIs (ERC-4337 Account Abstraction)
  SponsoredPaymasterAbi,
  // Full JSON exports
  ERC20AbiJson,
  ERC20FactoryAbiJson,
  BazaarAbiJson,
  IdentityRegistryAbiJson,
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
  // Raw deployments
  rawDeployments,
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

