/**
 * Recording Module
 *
 * Provides trajectory recording infrastructure for agent training:
 * - Time window utilities for organizing training data
 * - Trajectory recording with pluggable storage backends
 * - In-memory storage for testing/development
 *
 * @packageDocumentation
 */

// Window utilities
export {
  generateWindowIds,
  getCurrentWindowId,
  getPreviousWindowId,
  getWindowIdForTimestamp,
  getWindowRange,
  isTimestampInWindow,
  isWindowComplete,
  parseWindowId,
  type ParsedWindowId,
  type WindowRange,
} from './window-utils'

// Trajectory recorder
export {
  // Types
  type Action,
  type ActiveTrajectory,
  type EndTrajectoryOptions,
  type EnvironmentState,
  type LLMCall,
  type LLMCallLogRecord,
  type ProviderAccess,
  type StartTrajectoryOptions,
  type TrajectoryRecord,
  type TrajectoryStep,
  type TrajectoryStorage,
  // Classes
  InMemoryTrajectoryStorage,
  TrajectoryRecorder,
  // Instances
  defaultStorage,
  trajectoryRecorder,
} from './trajectory-recorder'
