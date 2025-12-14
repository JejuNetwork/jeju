/**
 * Network Shared Package
 * Common hooks, components, APIs, and utilities used across all network apps
 */

// Hooks
export { 
  useBanStatus, 
  getBanTypeLabel, 
  getBanTypeColor,
  BanType,
  type BanStatus,
  type BanCheckConfig 
} from './hooks/useBanStatus';

// Components
export { 
  BanBanner, 
  BanIndicator, 
  BanOverlay 
} from './components/BanBanner';

// Moderation API
export {
  ModerationAPI,
  createModerationAPI,
  BAN_TYPES,
  CASE_STATUS,
  REPUTATION_TIERS,
  REPORT_TYPES,
  SEVERITY_LEVELS,
  LABELS,
  type ModerationConfig,
  type BanStatus as ModerationBanStatus,
  type ModeratorProfile,
  type ModerationCase,
  type Report,
  type AgentLabels,
  type ModerationStats,
  type TransactionRequest,
} from './api/moderation';

// Health Check Middleware
export {
  healthMiddleware,
  healthChecks,
} from './health-middleware';

// Branding
export {
  getBrandingCssVars,
  applyBrandingToDocument,
} from './branding';

// Chains
export {
  getLocalnetChain,
  getTestnetChain,
  getMainnetChain,
  getNetworkChains,
  getChain,
  getProviderInfo,
  getServiceName,
  createAgentCard,
} from './chains';

// Federation
export {
  FederationClient,
  createFederationClient,
  FederationDiscovery,
  createFederationDiscovery,
  NETWORK_REGISTRY_ABI,
  FEDERATED_IDENTITY_ABI,
  FEDERATED_SOLVER_ABI,
  FEDERATED_LIQUIDITY_ABI,
  type FederationConfig,
  type DiscoveryConfig,
  type NetworkInfo,
  type NetworkContracts,
  type FederatedAgent,
  type FederatedSolver,
  type NetworkLiquidity,
  type TrustRelation,
  type RouteInfo,
  type IdentityVerification,
  type XLP,
  type LiquidityRequest,
  type CrossNetworkAttestation,
} from './federation';
