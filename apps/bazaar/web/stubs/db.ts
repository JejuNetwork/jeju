// Browser stub for @jejunetwork/db
// Database operations are server-side only

export function createDatabase(_config: unknown): never {
  throw new Error('Database is not available in browser')
}

export function getDatabase(): never {
  throw new Error('Database is not available in browser')
}

export type Database = never
