/**
 * @jejunetwork/db browser stub
 * 
 * Database functionality is handled via API, not directly in browser.
 */

export const getSQLit = () => {
  throw new Error('getSQLit is not available in browser')
}

export const createTable = () => {
  throw new Error('createTable is not available in browser')
}

export type SQLitClient = Record<string, never>
