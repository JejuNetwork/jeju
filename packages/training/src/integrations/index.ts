/**
 * Training Integrations Module
 *
 * Provides integration clients for connecting training to:
 * - Crucible: Agent runtime and RLAIF training
 * - Autocrat: DAO governance for model deployments
 */

export {
  AutocratTrainingClient,
  createAutocratTrainingClient,
  type ModelDeploymentProposal,
  type TrainingProposal,
} from './autocrat'
export {
  type AgentTrajectory,
  CrucibleTrainingClient,
  createCrucibleTrainingClient,
  type CrucibleTrajectoryStep,
  type TrainingAgentConfig,
  type TrainingEnvironment,
  type TrainingMetrics as CrucibleTrainingMetrics,
  type TrainingRun,
  type TrajectoryMetadata,
} from './crucible'
