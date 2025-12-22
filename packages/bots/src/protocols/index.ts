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

export { MorphoIntegration, type MorphoConfig } from './morpho'
export { IntentSolver, type IntentSolverConfig } from './intent-solver'
export { RateArbitrage, type RateArbConfig } from './rate-arbitrage'
export { MEVShareClient, type MEVShareConfig } from './mev-share'
export { BuilderClient, type BuilderConfig } from './builder-client'

