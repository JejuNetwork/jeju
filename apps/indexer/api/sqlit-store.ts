/**
 * SQLit Store - Re-export from sqlit-database
 * 
 * This file provides backward compatibility exports
 */

export { SQLitDatabase, type SQLitStoreInterface } from './sqlit-database'

// Re-export for convenience
export type SQLitStore = import('./sqlit-database').SQLitStoreInterface
