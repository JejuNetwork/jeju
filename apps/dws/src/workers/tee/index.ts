/**
 * TEE Worker Module
 *
 * Regionalized TEE worker runners for secure serverless execution.
 */

export type { CoordinatorConfig } from './coordinator'
// Coordinator - routes workloads to regional nodes
export { createCoordinator, RegionalTEECoordinator } from './coordinator'
// Region configuration
export * from './regions'
export type { RunnerConfig } from './runner'

// Runner - executes workloads in TEE
export { createRunner, TEEWorkerRunner } from './runner'
export type { SecretManagerConfig, SecretVault, VaultSecret } from './secrets'

// Secret management
export { createSecretManager, TEESecretManager } from './secrets'
// Types
export * from './types'
