/**
 * Training Integrations Module
 *
 * Provides integration clients for connecting training to:
 * - Crucible: Agent runtime and RLAIF training
 * - Autocrat: DAO governance for model deployments
 */

export {
  createCrucibleTrainingClient,
  CrucibleTrainingClient,
  type AgentTrajectory,
  type TrainingAgentConfig,
  type TrainingEnvironment,
  type TrainingMetrics as CrucibleTrainingMetrics,
  type TrainingRun,
  type TrajectoryStep,
} from './crucible';

export {
  createAutocratTrainingClient,
  AutocratTrainingClient,
  type ModelDeploymentProposal,
  type TrainingProposal,
} from './autocrat';

