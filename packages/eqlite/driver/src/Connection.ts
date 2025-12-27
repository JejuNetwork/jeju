import SqlString from "sql92-string"
import type { ConnectionConfig } from "./ConnectionConfig"

interface QueryResult {
  data?: {
    rows: Record<string, unknown>[] | null
  }
  status: string
  error?: string
}

interface ParsedResult {
  datarows: Record<string, unknown>[] | null
  status: string
}

type ConnectionState = "disconnected" | "connected" | "error"

/**
 * Connection class for EQLite
 *
 * Connects to EQLite using the native EQLite proxy API (/v1/query, /v1/exec)
 */
export class Connection {
  readonly config: ConnectionConfig
  private _connectCalled: boolean = false
  private _state: ConnectionState = "disconnected"
  private readonly _timeout: number
  private _lastError: Error | null = null

  constructor(config: ConnectionConfig) {
    this.config = config
    this._timeout = config.timeout ?? 30000
  }

  get state(): ConnectionState {
    return this._state
  }

  get isConnected(): boolean {
    return this._state === "connected"
  }

  get lastError(): Error | null {
    return this._lastError
  }

  /**
   * Establish connection to EQLite
   */
  async connect(): Promise<this> {
    if (this._connectCalled && this._state === "connected") {
      return this
    }

    if (this.config.debug) {
      console.log(`[EQLite] Connecting to ${this.config.endpoint}`)
    }

    // Verify connection
    const datarows = await this.query("SELECT 1")
    if (datarows !== null) {
      this._state = "connected"
      this._connectCalled = true
      this._lastError = null
    }

    return this
  }

  /**
   * Execute a SELECT query on EQLite
   */
  async query(
    sql: string,
    values?: unknown[]
  ): Promise<Record<string, unknown>[] | null> {
    const formattedSql = SqlString.format(sql, values ?? [])
    return this._fetch("query", formattedSql)
  }

  /**
   * Execute a write operation (INSERT, UPDATE, DELETE) on EQLite
   */
  async exec(
    sql: string,
    values?: unknown[]
  ): Promise<Record<string, unknown>[] | null> {
    const formattedSql = SqlString.format(sql, values ?? [])
    return this._fetch("exec", formattedSql)
  }

  /**
   * Check if the connection is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.endpoint}/v1/status`, {
        signal: AbortSignal.timeout(5000),
      })
      return response.ok
    } catch {
      return false
    }
  }

  /**
   * Close the connection
   */
  async close(): Promise<void> {
    this._state = "disconnected"
    this._connectCalled = false
  }

  /**
   * Internal fetch method for query and exec operations
   */
  private async _fetch(
    method: "query" | "exec",
    sql: string
  ): Promise<Record<string, unknown>[] | null> {
    const database = this.config.dbid
    const uri = `${this.config.endpoint}/v1/${method}`

    const response = await fetch(uri, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assoc: true, database, query: sql }),
      signal: AbortSignal.timeout(this._timeout),
    })

    if (!response.ok) {
      const error = new Error(`EQLite request failed: ${response.status} ${response.statusText}`)
      this._lastError = error
      this._state = "error"
      throw error
    }

    const result: QueryResult = await response.json()
    
    if (result.error) {
      const error = new Error(`EQLite query error: ${result.error}`)
      this._lastError = error
      throw error
    }
    
    const parsed = this._parseResult(result)
    return parsed.datarows
  }

  /**
   * Parse EQLite response
   */
  private _parseResult(result: QueryResult): ParsedResult {
    const datarows = result.data?.rows ?? null
    return { datarows, status: result.status }
  }

  /**
   * Reconnect after an error
   */
  async reconnect(): Promise<this> {
    this._state = "disconnected"
    this._connectCalled = false
    this._lastError = null
    return this.connect()
  }
}
