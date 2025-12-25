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

// Trajectory recorder
export {
  // Types
  type Action,
  type ActiveTrajectory,
  // Instances
  defaultStorage,
  type EndTrajectoryOptions,
  type EnvironmentState,
  // Classes
  InMemoryTrajectoryStorage,
  type LLMCall,
  type LLMCallLogRecord,
  type ProviderAccess,
  type StartTrajectoryOptions,
  type TrajectoryRecord,
  TrajectoryRecorder,
  type TrajectoryStep,
  type TrajectoryStorage,
  trajectoryRecorder,
} from './trajectory-recorder'
// Window utilities
export {
  generateWindowIds,
  getCurrentWindowId,
  getPreviousWindowId,
  getWindowIdForTimestamp,
  getWindowRange,
  isTimestampInWindow,
  isWindowComplete,
  type ParsedWindowId,
  parseWindowId,
  type WindowRange,
} from './window-utils'
