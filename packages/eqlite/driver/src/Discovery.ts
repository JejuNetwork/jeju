/**
 * EQLite Node Discovery
 *
 * Discovers EQLite nodes from the on-chain EQLiteRegistry contract.
 * Supports automatic endpoint refresh and health-based node selection.
 */

export interface DiscoveryConfig {
  /**
   * RPC URL for reading from EQLite Registry contract
   */
  rpcUrl: string

  /**
   * EQLite Registry contract address
   */
  registryAddress: string

  /**
   * Preferred region for node selection (optional)
   */
  preferredRegion?: string

  /**
   * Refresh interval in milliseconds (default: 60000)
   */
  refreshInterval?: number

  /**
   * Enable debug logging
   */
  debug?: boolean
}

export interface EQLiteNode {
  nodeId: string
  operator: string
  role: "block_producer" | "miner"
  status: "pending" | "active" | "suspended" | "slashed" | "exiting"
  endpoint: string
  stakedAmount: bigint
  databaseCount: number
  totalQueries: number
  lastHeartbeat: number
}

// ABI for reading EQLite Registry (kept for documentation/future use)
const _EQLITE_REGISTRY_ABI = [
  {
    name: "getActiveBlockProducers",
    type: "function",
    inputs: [],
    outputs: [{ name: "", type: "bytes32[]" }],
    stateMutability: "view",
  },
  {
    name: "getActiveMiners",
    type: "function",
    inputs: [],
    outputs: [{ name: "", type: "bytes32[]" }],
    stateMutability: "view",
  },
  {
    name: "getNode",
    type: "function",
    inputs: [{ name: "nodeId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "operator", type: "address" },
          { name: "nodeId", type: "bytes32" },
          { name: "role", type: "uint8" },
          { name: "status", type: "uint8" },
          { name: "stakedAmount", type: "uint256" },
          { name: "registeredAt", type: "uint256" },
          { name: "lastHeartbeat", type: "uint256" },
          { name: "endpoint", type: "string" },
          { name: "teeAttestation", type: "bytes" },
          { name: "mrEnclave", type: "bytes32" },
          { name: "databaseCount", type: "uint256" },
          { name: "totalQueries", type: "uint256" },
          { name: "slashedAmount", type: "uint256" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const

// Export the ABI for external use
export { _EQLITE_REGISTRY_ABI as EQLITE_REGISTRY_ABI }

// Function selectors for EQLite Registry contract
// These are pre-computed keccak256 hashes of function signatures
const FUNCTION_SELECTORS: Record<string, string> = {
  "getActiveBlockProducers()": "0x4e69d560",
  "getActiveMiners()": "0x5b5e139f",
  "getNode(bytes32)": "0x4f558e79",
}

// ABI encoder for view functions
function encodeCall(functionSignature: string, args: unknown[] = []): string {
  const selector = FUNCTION_SELECTORS[functionSignature]
  if (!selector) {
    throw new Error(`Unknown function: ${functionSignature}`)
  }

  if (args.length === 0) {
    return selector
  }

  // Encode bytes32 arguments
  const encodedArgs = args
    .map((arg) => {
      const hex = String(arg).startsWith("0x") ? String(arg).slice(2) : String(arg)
      return hex.padStart(64, "0")
    })
    .join("")

  return selector + encodedArgs
}

export class EQLiteDiscovery {
  private config: DiscoveryConfig
  private blockProducers: EQLiteNode[] = []
  private miners: EQLiteNode[] = []
  private refreshTimer?: ReturnType<typeof setInterval>
  private lastRefresh = 0

  constructor(config: DiscoveryConfig) {
    this.config = {
      refreshInterval: 60000,
      ...config,
    }
  }

  /**
   * Start discovery and refresh loop
   */
  async start(): Promise<void> {
    await this.refresh()

    const interval = this.config.refreshInterval ?? 60000
    this.refreshTimer = setInterval(() => {
      this.refresh().catch((err) => {
        console.error("[EQLite Discovery] Refresh failed:", err)
      })
    }, interval)

    if (this.config.debug) {
      console.log("[EQLite Discovery] Started")
    }
  }

  /**
   * Stop the discovery refresh loop
   */
  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = undefined
    }

    if (this.config.debug) {
      console.log("[EQLite Discovery] Stopped")
    }
  }

  /**
   * Refresh the list of nodes from on-chain
   */
  async refresh(): Promise<void> {
    try {
      // Get active block producers
      const bpNodeIds = await this.callContract("getActiveBlockProducers", [])
      this.blockProducers = await Promise.all(
        bpNodeIds.map((id: string) => this.getNodeDetails(id))
      )

      // Get active miners
      const minerNodeIds = await this.callContract("getActiveMiners", [])
      this.miners = await Promise.all(
        minerNodeIds.map((id: string) => this.getNodeDetails(id))
      )

      this.lastRefresh = Date.now()

      if (this.config.debug) {
        console.log(
          `[EQLite Discovery] Refreshed: ${this.blockProducers.length} BPs, ${this.miners.length} miners`
        )
      }
    } catch (err) {
      console.error("[EQLite Discovery] Refresh error:", err)
      throw err
    }
  }

  /**
   * Get all active block producers
   */
  getBlockProducers(): EQLiteNode[] {
    return [...this.blockProducers]
  }

  /**
   * Get all active miners
   */
  getMiners(): EQLiteNode[] {
    return [...this.miners]
  }

  /**
   * Get the best block producer endpoint
   * Selection based on: health, stake, recent activity
   */
  getBestBlockProducerEndpoint(): string | null {
    if (this.blockProducers.length === 0) return null

    // Sort by stake and recent heartbeat
    const sorted = [...this.blockProducers].sort((a, b) => {
      // Prefer nodes with more recent heartbeats
      const heartbeatDiff = b.lastHeartbeat - a.lastHeartbeat
      if (Math.abs(heartbeatDiff) > 300000) {
        // 5 min threshold
        return heartbeatDiff
      }
      // Then by stake
      return Number(b.stakedAmount - a.stakedAmount)
    })

    const best = sorted[0]
    return best ? best.endpoint : null
  }

  /**
   * Get the best miner endpoint
   * Selection based on: health, capacity, query count
   */
  getBestMinerEndpoint(): string | null {
    if (this.miners.length === 0) return null

    // Sort by recent activity and capacity
    const sorted = [...this.miners].sort((a, b) => {
      // Prefer nodes with fewer databases (more capacity)
      const capacityDiff = a.databaseCount - b.databaseCount
      if (capacityDiff !== 0) return capacityDiff
      // Then by query count (proven reliability)
      return b.totalQueries - a.totalQueries
    })

    const best = sorted[0]
    return best ? best.endpoint : null
  }

  /**
   * Get a random miner endpoint for load balancing
   */
  getRandomMinerEndpoint(): string | null {
    if (this.miners.length === 0) return null
    const idx = Math.floor(Math.random() * this.miners.length)
    const miner = this.miners[idx]
    return miner ? miner.endpoint : null
  }

  /**
   * Check if discovery data is stale
   */
  isStale(): boolean {
    const refreshInterval = this.config.refreshInterval ?? 60000
    return Date.now() - this.lastRefresh > refreshInterval * 2
  }

  private async callContract(method: string, args: unknown[]): Promise<string[]> {
    const signature = args.length > 0 ? `${method}(bytes32)` : `${method}()`
    const data = encodeCall(signature, args)

    const response = await fetch(this.config.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [
          {
            to: this.config.registryAddress,
            data,
          },
          "latest",
        ],
      }),
    })

    const result = (await response.json()) as { result?: string; error?: { message: string } }

    if (result.error) {
      throw new Error(`Contract call failed: ${result.error.message}`)
    }

    // Decode bytes32[] result
    return this.decodeBytes32Array(result.result ?? "0x")
  }

  private decodeBytes32Array(hex: string): string[] {
    if (hex === "0x" || hex.length < 66) return []

    // Skip function selector and offset
    const data = hex.slice(2)
    const offset = parseInt(data.slice(0, 64), 16) * 2
    const length = parseInt(data.slice(offset, offset + 64), 16)

    const items: string[] = []
    for (let i = 0; i < length; i++) {
      const start = offset + 64 + i * 64
      items.push("0x" + data.slice(start, start + 64))
    }

    return items
  }

  private async getNodeDetails(nodeId: string): Promise<EQLiteNode> {
    const data = encodeCall("getNode(bytes32)", [nodeId])

    const response = await fetch(this.config.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [
          {
            to: this.config.registryAddress,
            data,
          },
          "latest",
        ],
      }),
    })

    const result = (await response.json()) as { result?: string; error?: { message: string } }

    if (result.error) {
      throw new Error(`Get node failed: ${result.error.message}`)
    }

    return this.decodeNodeTuple(nodeId, result.result ?? "0x")
  }

  private decodeNodeTuple(nodeId: string, hex: string): EQLiteNode {
    if (hex === "0x" || hex.length < 66) {
      throw new Error(`Invalid node data for ${nodeId}`)
    }

    const data = hex.slice(2)

    // Decode tuple fields (each field is 32 bytes = 64 hex chars)
    const operator = "0x" + data.slice(24, 64) // address is 20 bytes, right-padded
    const role = parseInt(data.slice(128, 192), 16)
    const status = parseInt(data.slice(192, 256), 16)
    const stakedAmount = BigInt("0x" + data.slice(256, 320))
    const lastHeartbeat = parseInt(data.slice(384, 448), 16)

    // Endpoint is a dynamic string - decode offset and read
    const endpointOffset = parseInt(data.slice(448, 512), 16) * 2
    const endpointLength = parseInt(data.slice(endpointOffset, endpointOffset + 64), 16)
    const endpointHex = data.slice(endpointOffset + 64, endpointOffset + 64 + endpointLength * 2)
    const endpoint = Buffer.from(endpointHex, "hex").toString("utf8")

    const databaseCount = parseInt(data.slice(640, 704), 16)
    const totalQueries = parseInt(data.slice(704, 768), 16)

    const statusMap = ["pending", "active", "suspended", "slashed", "exiting"] as const
    const roleMap = ["block_producer", "miner"] as const

    return {
      nodeId,
      operator,
      role: roleMap[role] ?? "miner",
      status: statusMap[status] ?? "pending",
      endpoint,
      stakedAmount,
      databaseCount,
      totalQueries,
      lastHeartbeat,
    }
  }
}

/**
 * Create and start a EQLite discovery client
 */
export async function createDiscovery(config: DiscoveryConfig): Promise<EQLiteDiscovery> {
  const discovery = new EQLiteDiscovery(config)
  await discovery.start()
  return discovery
}

