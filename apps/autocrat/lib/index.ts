/**
 * Autocrat - Shared Library
 *
 * Exports shared types, utilities, and constants used across api/, web/, and app/.
 */

// Re-export validation utilities from types package
export { expectValid } from '@jejunetwork/types'
export * from './schemas'
export * from './shared'
export * from './types'
