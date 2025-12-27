/**
 * Transaction support for EQLite
 *
 * Provides ACID transaction semantics for EQLite databases.
 * Note: EQLite has limited atomicity - transactions work best on leader nodes.
 */

import type { Connection } from './Connection'

export interface TransactionOptions {
  /**
   * Transaction isolation level
   * EQLite supports: READ_UNCOMMITTED, READ_COMMITTED, REPEATABLE_READ, SERIALIZABLE
   */
  isolationLevel?:
    | 'READ_UNCOMMITTED'
    | 'READ_COMMITTED'
    | 'REPEATABLE_READ'
    | 'SERIALIZABLE'

  /**
   * Transaction timeout in milliseconds
   */
  timeout?: number
}

export class Transaction {
  private connection: Connection
  private options: TransactionOptions
  private started = false
  private completed = false
  readonly id: string

  constructor(connection: Connection, options: TransactionOptions = {}) {
    this.connection = connection
    this.options = options
    this.id = `tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  /**
   * Begin the transaction
   */
  async begin(): Promise<void> {
    if (this.started) {
      throw new Error('Transaction already started')
    }
    if (this.completed) {
      throw new Error('Transaction already completed')
    }

    let sql = 'BEGIN'

    if (this.options.isolationLevel) {
      sql = `BEGIN TRANSACTION ISOLATION LEVEL ${this.options.isolationLevel}`
    }

    await this.connection.exec(sql)
    this.started = true
  }

  /**
   * Execute a query within the transaction
   */
  async query(
    sql: string,
    values?: unknown[],
  ): Promise<Record<string, unknown>[] | null> {
    this.ensureActive()
    return this.connection.query(sql, values)
  }

  /**
   * Execute a write operation within the transaction
   */
  async exec(
    sql: string,
    values?: unknown[],
  ): Promise<Record<string, unknown>[] | null> {
    this.ensureActive()
    return this.connection.exec(sql, values)
  }

  /**
   * Commit the transaction
   */
  async commit(): Promise<void> {
    this.ensureActive()
    await this.connection.exec('COMMIT')
    this.completed = true
  }

  /**
   * Rollback the transaction
   */
  async rollback(): Promise<void> {
    if (!this.started || this.completed) {
      return // Nothing to rollback
    }

    try {
      await this.connection.exec('ROLLBACK')
    } finally {
      this.completed = true
    }
  }

  /**
   * Create a savepoint within the transaction
   */
  async savepoint(name: string): Promise<void> {
    this.ensureActive()
    await this.connection.exec(`SAVEPOINT ${name}`)
  }

  /**
   * Rollback to a savepoint
   */
  async rollbackToSavepoint(name: string): Promise<void> {
    this.ensureActive()
    await this.connection.exec(`ROLLBACK TO SAVEPOINT ${name}`)
  }

  /**
   * Release a savepoint
   */
  async releaseSavepoint(name: string): Promise<void> {
    this.ensureActive()
    await this.connection.exec(`RELEASE SAVEPOINT ${name}`)
  }

  /**
   * Check if transaction is active
   */
  get isActive(): boolean {
    return this.started && !this.completed
  }

  private ensureActive(): void {
    if (!this.started) {
      throw new Error('Transaction not started')
    }
    if (this.completed) {
      throw new Error('Transaction already completed')
    }
  }
}

/**
 * Execute a function within a transaction, automatically committing or rolling back
 */
export async function withTransaction<T>(
  connection: Connection,
  fn: (tx: Transaction) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const tx = new Transaction(connection, options)

  try {
    await tx.begin()
    const result = await fn(tx)
    await tx.commit()
    return result
  } catch (error) {
    await tx.rollback()
    throw error
  }
}
