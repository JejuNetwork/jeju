/**
 * Compute Training Types
 */

export type TrainingJobStatus =
  | 'pending'
  | 'queued'
  | 'allocating'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface TrainingJobRequest {
  batchId: string
  baseModel: string
  datasetCID: string
  trainingSteps: number
  batchSize: number
  learningRate: number
  archetype?: string
  rubricHash?: string
  callbackUrl?: string
}

export interface TrainingJobResult {
  jobId: string
  status: TrainingJobStatus
  modelCID?: string
  checkpointCID?: string
  metrics?: {
    finalLoss: number
    trainingSteps: number
    epochsCompleted: number
  }
  error?: string
  durationSeconds: number
}
