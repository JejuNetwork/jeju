/**
 * Contract Integrations for LP Bot
 * 
 * Deep integration with Jeju's cross-chain infrastructure:
 * - EIL (Ethereum Interop Layer) for trustless cross-chain transfers
 * - XLP (Cross-chain Liquidity Provider) operations
 * - OIF (Open Intents Framework) for intent-based operations
 */

export {
  XLPManager,
  EILXLPManager,
  FEDERATED_LIQUIDITY_ABI,
  LIQUIDITY_AGGREGATOR_ABI,
  INPUT_SETTLER_ABI as EIL_INPUT_SETTLER_ABI,
  OUTPUT_SETTLER_ABI as EIL_OUTPUT_SETTLER_ABI,
  type XLPProfile,
  type LiquidityRequest,
  type NetworkLiquidity,
  type XLPConfig,
} from './eil-xlp';

export {
  OIFSolver,
  SOLVER_REGISTRY_ABI,
  INPUT_SETTLER_ABI,
  OUTPUT_SETTLER_ABI,
  HYPERLANE_ORACLE_ABI,
  IntentStatus,
  type SolverProfile,
  type OpenIntent,
  type OIFSolverConfig,
} from './oif-solver';


