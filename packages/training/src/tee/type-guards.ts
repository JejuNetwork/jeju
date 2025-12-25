/**
 * Type Guards for TEE Module
 */

import type {
  JudgingScoreResponse,
  SimulationResultResponse,
  TEEInitResponse,
  TEEProvider,
  TrainingComputeResponse,
} from './types'

/**
 * Check if value is an object
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Check if value is a valid TEE provider
 */
export function isTEEProvider(value: unknown): value is TEEProvider {
  return (
    value === 'phala' ||
    value === 'intel-sgx' ||
    value === 'intel-tdx' ||
    value === 'amd-sev' ||
    value === 'simulated'
  )
}

/**
 * Check if value is a TEE init response
 */
export function isTEEInitResponse(value: unknown): value is TEEInitResponse {
  if (!isObject(value)) return false
  return typeof value.operatorAddress === 'string'
}

/**
 * Check if value is a judging score response
 */
export function isJudgingScoreResponse(
  value: unknown,
): value is JudgingScoreResponse {
  if (!isObject(value)) return false
  return (
    typeof value.trajectoryId === 'string' &&
    typeof value.score === 'number' &&
    isObject(value.breakdown)
  )
}

/**
 * Check if value is a training compute response
 */
export function isTrainingComputeResponse(
  value: unknown,
): value is TrainingComputeResponse {
  if (!isObject(value)) return false
  return isObject(value.trainedModel) && typeof value.finalLoss === 'number'
}

/**
 * Check if value is a simulation result response
 */
export function isSimulationResultResponse(
  value: unknown,
): value is SimulationResultResponse {
  if (!isObject(value)) return false
  return typeof value.pnl === 'number' && typeof value.trades === 'number'
}

/**
 * Check if value is an array of items matching a type guard
 */
export function isArrayOf<T>(
  value: unknown,
  guard: (item: unknown) => item is T,
): value is T[] {
  return Array.isArray(value) && value.every(guard)
}

/**
 * Check if value is a generic object
 */
export function isGenericObject(
  value: unknown,
): value is Record<string, unknown> {
  return isObject(value)
}

/**
 * Check if value is a CID response
 */
export function isCIDResponse(value: unknown): value is { cid: string } {
  return isObject(value) && typeof value.cid === 'string'
}

/**
 * Check if value is scored training data (array of judging responses)
 */
export function isScoredTrainingData(
  value: unknown,
): value is JudgingScoreResponse {
  return isJudgingScoreResponse(value)
}
