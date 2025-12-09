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
  // OIF (Open Intents Framework) ABIs
  InputSettlerAbi,
  OutputSettlerAbi,
  SolverRegistryAbi,
  SimpleOracleAbi,
  HyperlaneOracleAbi,
  SuperchainOracleAbi,
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
  // Helper functions
  getUniswapV4,
  getBazaarMarketplace,
  getERC20Factory,
  getIdentityRegistry,
  getContractAddresses,
  getContractAddressesByNetwork,
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

