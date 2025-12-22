/**
 * Training Environments Module
 *
 * Provides training environments for RLAIF/RLHF training:
 * - Tic-Tac-Toe: Simple game environment for demonstration
 * - Fundamental Prediction: Financial metric prediction
 */

export {
  type APIServerConfig,
  type Completion,
  type CompletionResult,
  createFundamentalPredictionEnv,
  type EnvConfig as FundamentalEnvConfig,
  FundamentalPredictionEnv,
  type Message as FundamentalMessage,
  type ScoredDataGroup,
  type TrainingItem,
} from './fundamental-prediction'
export {
  type Board,
  type Cell,
  createTicTacToeEnv,
  type GameState,
  type GameStep,
  type GameTrajectory,
  type Move,
  type Player,
  TicTacToeEnv,
  trajectoryToTrainingFormat,
} from './tic-tac-toe'
