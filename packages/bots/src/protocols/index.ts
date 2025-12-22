/**
 * Protocol Integrations
 *
 * Connectors to various DeFi protocols for:
 * - Morpho lending optimization
 * - Intent solvers (Cowswap, UniswapX)
 * - Rate arbitrage (Spark, MakerDAO)
 * - MEV-Share revenue
 * - Builder partnerships
 */

export {
  BuilderClient,
  type BuilderConfig,
  createBuilderClient,
} from './builder-client'
export { IntentSolver, type IntentSolverConfig } from './intent-solver'
export { MEVShareClient, type MEVShareConfig } from './mev-share'
export { type MorphoConfig, MorphoIntegration } from './morpho'
export { type RateArbConfig, RateArbitrage } from './rate-arbitrage'
