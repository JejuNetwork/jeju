/**
 * Contract Integrations for LP Bot
 *
 * Deep integration with Jeju's cross-chain infrastructure:
 * - EIL (Ethereum Interop Layer) for trustless cross-chain transfers
 * - XLP (Cross-chain Liquidity Provider) operations
 * - OIF (Open Intents Framework) for intent-based operations
 */

export {
  EILXLPManager,
  FEDERATED_LIQUIDITY_ABI,
  INPUT_SETTLER_ABI as EIL_INPUT_SETTLER_ABI,
  LIQUIDITY_AGGREGATOR_ABI,
  type LiquidityRequest,
  type NetworkLiquidity,
  OUTPUT_SETTLER_ABI as EIL_OUTPUT_SETTLER_ABI,
  type XLPConfig,
  XLPManager,
  type XLPProfile,
} from './eil-xlp'

export {
  HYPERLANE_ORACLE_ABI,
  INPUT_SETTLER_ABI,
  IntentStatus,
  OIFSolver,
  type OIFSolverConfig,
  type OpenIntent,
  OUTPUT_SETTLER_ABI,
  SOLVER_REGISTRY_ABI,
  type SolverProfile,
} from './oif-solver'
