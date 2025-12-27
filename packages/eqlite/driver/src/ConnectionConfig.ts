/**
 * ConnectionConfig for EQLite connection
 *
 * Supports multiple connection modes:
 * 1. Direct endpoint (legacy EQLite proxy)
 * 2. Block producer endpoint (for database creation/management)
 * 3. Miner endpoint (for direct SQL queries)
 * 4. Auto-discovery via DWS node registry
 */
export interface ConnectionConfig {
  /**
   * Connection endpoint URL (e.g. http://localhost:11105)
   * This is the primary endpoint for queries
   */
  readonly endpoint: string

  /**
   * Database ID for the connection
   */
  readonly dbid: string

  /**
   * Optional block producer endpoint for management operations
   * If not provided, uses `endpoint` for all operations
   */
  readonly blockProducerEndpoint?: string

  /**
   * Optional miner endpoint for direct SQL queries
   * If not provided, uses `endpoint` for queries
   */
  readonly minerEndpoint?: string

  /**
   * Request timeout in milliseconds (default: 30000)
   */
  readonly timeout?: number

  /**
   * Enable debug logging
   */
  readonly debug?: boolean

  /**
   * Auto-discovery configuration
   * When set, the driver will discover endpoints from DWS node registry
   */
  readonly discovery?: {
    /**
     * DWS RPC endpoint for node discovery
     */
    rpcUrl: string

    /**
     * EQLite Registry contract address
     */
    registryAddress: string

    /**
     * Preferred region for node selection
     */
    preferredRegion?: string

    /**
     * Refresh interval for discovered endpoints (ms, default: 60000)
     */
    refreshInterval?: number
  }
}
