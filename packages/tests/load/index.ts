/**
 * Load Testing Infrastructure
 *
 * Comprehensive load testing for all Jeju Network apps and services.
 *
 * Usage:
 *   # Single app test
 *   bun packages/tests/load/runner.ts --app=gateway-rpc --scenario=normal
 *
 *   # All apps test
 *   bun packages/tests/load/runner.ts --all --scenario=light
 *
 *   # Continuous improvement loop
 *   bun packages/tests/load/continuous.ts --iterations=10 --interval=60
 *
 *   # Watch mode for CI/CD
 *   bun packages/tests/load/continuous.ts --watch --json
 */

export * from './analyzer'
export * from './configs'
export { runContinuousLoop } from './continuous'
export { runTests } from './runner'
export * from './simulator'
export * from './types'
