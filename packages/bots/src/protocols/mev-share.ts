/**
 * MEV-Share Revenue Integration
 *
 * Participate in MEV-Share to receive kickbacks from searchers.
 * Implements SSE-based hint streaming and bundle submission.
 */

import { EventEmitter } from '@jejunetwork/shared'
import { type Hash, type Hex, keccak256, toBytes } from 'viem'
import {
  type PrivateKeyAccount,
  privateKeyToAccount,
  signMessage,
} from 'viem/accounts'
import { z } from 'zod'

// MEV-Share response schema
const MEVShareResponseSchema = z.object({
  result: z.object({ bundleHash: z.string() }).optional(),
  error: z.object({ message: z.string() }).optional(),
})

// MEV-Share hint schema
const MEVShareHintSchema = z.object({
  hash: z.string(),
  logs: z
    .array(
      z.object({
        address: z.string(),
        topics: z.array(z.string()),
        data: z.string(),
      }),
    )
    .optional(),
  txs: z
    .array(
      z.object({
        to: z.string().optional(),
        callData: z.string().optional(),
        functionSelector: z.string().optional(),
      }),
    )
    .optional(),
  mevGasPrice: z.string().optional(),
  gasUsed: z.string().optional(),
})
type MEVShareHint = z.infer<typeof MEVShareHintSchema>

export interface MEVShareConfig {
  chainId: number
  authKey: `0x${string}`
  minKickbackPercent: number
  onHint?: (hint: MEVShareHint) => void
}

interface MEVShareBundle {
  txs: Hex[]
  blockNumber: bigint
  maxBlockNumber?: bigint
  revertingTxHashes?: Hash[]
}

const MEVSHARE_BUNDLE = 'https://relay.flashbots.net'
const MEVSHARE_SSE = 'https://mev-share.flashbots.net'

export class MEVShareClient extends EventEmitter {
  private config: MEVShareConfig
  private account: PrivateKeyAccount
  private running = false
  private sseConnection: { close: () => void } | null = null
  private hintBuffer: MEVShareHint[] = []
  private stats = {
    hintsReceived: 0,
    bundlesSubmitted: 0,
    bundlesAccepted: 0,
  }

  constructor(config: MEVShareConfig) {
    super()
    this.config = config
    // Validate auth key format
    if (!config.authKey.match(/^0x[a-fA-F0-9]{64}$/)) {
      throw new Error(
        'Invalid authKey format: must be 0x-prefixed 64 hex characters',
      )
    }
    this.account = privateKeyToAccount(config.authKey)
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    console.log('🔗 MEV-Share: connecting to hint stream...')
    await this.subscribeToHints()
    console.log('🔗 MEV-Share: connected')
  }

  stop(): void {
    this.running = false
    if (this.sseConnection) {
      this.sseConnection.close()
      this.sseConnection = null
    }
    this.hintBuffer = []
  }

  private async subscribeToHints(): Promise<void> {
    // Mainnet only for MEV-Share SSE
    if (this.config.chainId !== 1) {
      console.log('MEV-Share hints only available on mainnet')
      return
    }

    // Use fetch with streaming for SSE
    const response = await fetch(MEVSHARE_SSE, {
      headers: { Accept: 'text/event-stream' },
    })

    if (!response.ok || !response.body) {
      throw new Error(`Failed to connect to MEV-Share SSE: ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    this.sseConnection = {
      close: () => {
        reader.cancel()
      },
    }

    const processStream = async () => {
      while (this.running) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6)
            const parsed = MEVShareHintSchema.safeParse(JSON.parse(jsonStr))
            if (parsed.success) {
              this.stats.hintsReceived++
              this.hintBuffer.push(parsed.data)
              // Keep buffer size manageable
              if (this.hintBuffer.length > 100) {
                this.hintBuffer.shift()
              }
              this.emit('hint', parsed.data)
              this.config.onHint?.(parsed.data)
            }
          }
        }
      }
    }

    // Start processing in background
    processStream().catch((error) => {
      if (this.running) {
        console.error('MEV-Share SSE error:', error)
        this.emit('error', error)
      }
    })
  }

  /**
   * Submit a bundle to MEV-Share relay
   */
  async submitBundle(
    bundle: MEVShareBundle,
    builderHints?: string[],
  ): Promise<string> {
    this.stats.bundlesSubmitted++

    const bundleParams = {
      version: 'v0.1',
      inclusion: {
        block: `0x${bundle.blockNumber.toString(16)}`,
        maxBlock: bundle.maxBlockNumber
          ? `0x${bundle.maxBlockNumber.toString(16)}`
          : undefined,
      },
      body: bundle.txs.map((tx) => ({ tx })),
      validity: {
        refund: [{ bodyIdx: 0, percent: this.config.minKickbackPercent }],
      },
      privacy: builderHints ? { builders: builderHints } : undefined,
    }

    const payload = JSON.stringify({
      jsonrpc: '2.0',
      method: 'mev_sendBundle',
      params: [bundleParams],
      id: Date.now(),
    })

    const signature = await this.signPayload(payload)

    const response = await fetch(MEVSHARE_BUNDLE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Flashbots-Signature': signature,
      },
      body: payload,
    })

    const rawResult: unknown = await response.json()
    const result = MEVShareResponseSchema.parse(rawResult)

    if (result.error) {
      throw new Error(`MEV-Share bundle rejected: ${result.error.message}`)
    }

    if (result.result?.bundleHash) {
      this.stats.bundlesAccepted++
    }

    return result.result?.bundleHash ?? ''
  }

  /**
   * Get recent transaction hints for backrun opportunities
   */
  getRecentHints(limit = 10): MEVShareHint[] {
    return this.hintBuffer.slice(-limit)
  }

  /**
   * Sign payload for Flashbots authentication
   * Format: address:signature where signature is keccak256(body) signed by authKey
   */
  private async signPayload(payload: string): Promise<string> {
    const hash = keccak256(toBytes(payload))
    const signature = await signMessage({
      message: { raw: hash },
      privateKey: this.config.authKey,
    })
    return `${this.account.address}:${signature}`
  }

  getStats(): {
    connected: boolean
    hintsReceived: number
    bundlesSubmitted: number
    bundlesAccepted: number
  } {
    return {
      connected: this.running,
      ...this.stats,
    }
  }
}
