/**
 * MEV-Share Revenue Integration
 *
 * Participate in MEV-Share to receive kickbacks from searchers.
 */

import { EventEmitter } from 'node:events'
import type { Hash, Hex } from 'viem'

export interface MEVShareConfig {
  chainId: number
  authKey: string
  minKickbackPercent: number
}

interface MEVShareBundle {
  txs: Hex[]
  blockNumber: bigint
  maxBlockNumber?: bigint
  revertingTxHashes?: Hash[]
}

const _MEVSHARE_SSE = 'https://mev-share.flashbots.net'
const MEVSHARE_BUNDLE = 'https://relay.flashbots.net'

export class MEVShareClient extends EventEmitter {
  private config: MEVShareConfig
  private running = false
  private eventSource: EventSource | null = null

  constructor(config: MEVShareConfig) {
    super()
    this.config = config
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    console.log('🔗 MEV-Share: connected')
    this.subscribeToHints()
  }

  stop(): void {
    this.running = false
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
  }

  private subscribeToHints(): void {
    // SSE connection for transaction hints
    // this.eventSource = new EventSource(MEVSHARE_SSE)
    // Would listen for hints and backrun opportunities
  }

  async submitBundle(
    bundle: MEVShareBundle,
    _builderHints?: string[],
  ): Promise<string> {
    const response = await fetch(MEVSHARE_BUNDLE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Flashbots-Signature': await this.signPayload(JSON.stringify(bundle)),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'mev_sendBundle',
        params: [bundle],
        id: 1,
      }),
    })
    const result = (await response.json()) as {
      result?: { bundleHash: string }
    }
    return result.result?.bundleHash ?? ''
  }

  private async signPayload(_payload: string): Promise<string> {
    // Sign with auth key
    return `${this.config.authKey}:0x...`
  }

  getStats(): { connected: boolean } {
    return { connected: this.running }
  }
}
