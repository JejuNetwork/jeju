/**
 * Integration Module
 *
 * Provides deep integration with:
 * - Jeju Network (ERC-8004, TokenRegistry, OIF, EIL)
 * - Solana (SPL tokens, Hyperlane warp routes)
 * - Cross-chain infrastructure
 */

// Token Deployer
export {
  deployToken,
  type EVMDeployment,
  TokenDeployer,
  type TokenDeploymentConfig,
  type TokenDeploymentResult,
  // Legacy aliases
  UnifiedTokenDeployer,
  type UnifiedTokenDeploymentConfig,
  type UnifiedTokenDeploymentResult,
} from './deployer'
// Jeju Registry Integration
export {
  type CrossChainConfig,
  createJejuRegistryIntegration,
  type JejuContractAddresses,
  JejuRegistryIntegration,
  type TokenRegistrationParams,
} from './jeju-registry'
// Solana Infrastructure
export {
  createSolanaInfra,
  createSolanaWarpRouteManager,
  generateSolanaTerraformConfig,
  type HyperlaneWarpConfig,
  type SolanaDeploymentResult,
  SolanaInfraManager,
  type SolanaNodeConfig,
  type SolanaTerraformConfig,
  type SolanaTokenDeployConfig,
  SolanaWarpRouteManager,
} from './solana-infra'
