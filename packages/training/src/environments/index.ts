/**
 * Training Environments Module
 *
 * Provides training environments for RLAIF/RLHF training:
 * - Tic-Tac-Toe: Simple game environment for demonstration
 * - Fundamental Prediction: Financial metric prediction
 */

export {
  createTicTacToeEnv,
  TicTacToeEnv,
  trajectoryToTrainingFormat,
  type Board,
  type Cell,
  type GameState,
  type GameStep,
  type GameTrajectory,
  type Move,
  type Player,
} from './tic-tac-toe';

export {
  createFundamentalPredictionEnv,
  FundamentalPredictionEnv,
  type APIServerConfig,
  type Completion,
  type CompletionResult,
  type EnvConfig as FundamentalEnvConfig,
  type Message as FundamentalMessage,
  type ScoredDataGroup,
  type TrainingItem,
} from './fundamental-prediction';

