/**
 * Flashbots Protect Integration
 *
 * Submit transactions via private mempool to avoid frontrunning.
 * Supports Flashbots Protect (mainnet) and MEV Blocker (L2s).
 */

import { EventEmitter } from 'node:events'
import {
  type Address,
  type Hash,
  type Hex,
  createWalletClient,
  http,
  type WalletClient,
  type TransactionRequest,
  encodeFunctionData,
  parseEther,
} from 'viem'
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { mainnet, base, arbitrum, optimism } from 'viem/chains'

// ============ Types ============

interface FlashbotsBundle {
  transactions: Hex[]
  blockNumber: bigint
  minTimestamp?: number
  maxTimestamp?: number
}

interface BundleResult {
  bundleHash: string
  success: boolean
  blockNumber: bigint
  txHashes: Hash[]
  gasUsed: bigint
  effectiveGasPrice: bigint
  error?: string
}

interface ProtectConfig {
  chainId: number
  privateKey: string
  flashbotsAuthKey?: string
  maxBlockWait: number
  simulateFirst: boolean
}

interface PendingBundle {
  bundleHash: string
  transactions: Hex[]
  targetBlock: bigint
  submittedAt: number
  status: 'pending' | 'included' | 'failed'
}

// ============ Constants ============

const FLASHBOTS_RPC = 'https://rpc.flashbots.net'
const FLASHBOTS_PROTECT = 'https://protect.flashbots.net'
const FLASHBOTS_RELAY = 'https://relay.flashbots.net'

// MEV protection endpoints by chain
const PROTECT_ENDPOINTS: Record<number, string> = {
  1: FLASHBOTS_PROTECT,
  8453: 'https://rpc.mevblocker.io/base', // MEV Blocker for Base
  42161: 'https://rpc.mevblocker.io/arbitrum', // MEV Blocker for Arbitrum
  10: 'https://rpc.mevblocker.io/optimism', // MEV Blocker for Optimism
}

const CHAINS = {
  1: mainnet,
  8453: base,
  42161: arbitrum,
  10: optimism,
} as const

// ============ Flashbots Protect ============

export class FlashbotsProtect extends EventEmitter {
  private config: ProtectConfig
  private account: PrivateKeyAccount
  private authSigner: PrivateKeyAccount
  private pendingBundles: Map<string, PendingBundle> = new Map()
  private walletClient: WalletClient

  constructor(config: ProtectConfig) {
    super()
    this.config = config
    this.account = privateKeyToAccount(config.privateKey as Hex)
    this.authSigner = config.flashbotsAuthKey
      ? privateKeyToAccount(config.flashbotsAuthKey as Hex)
      : this.account

    const chain = CHAINS[config.chainId as keyof typeof CHAINS]
    if (!chain) {
      throw new Error(`Unsupported chain: ${config.chainId}`)
    }

    const protectEndpoint = PROTECT_ENDPOINTS[config.chainId]
    if (!protectEndpoint) {
      throw new Error(`No Flashbots Protect endpoint for chain ${config.chainId}`)
    }

    this.walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(protectEndpoint),
    })
  }

  /**
   * Submit a single transaction via Flashbots Protect
   */
  async submitTransaction(tx: TransactionRequest): Promise<Hash> {
    const protectEndpoint = PROTECT_ENDPOINTS[this.config.chainId]

    if (this.config.chainId === 1) {
      // Mainnet uses Flashbots Protect RPC
      return this.submitToFlashbotsProtect(tx)
    } else {
      // L2s use MEV Blocker
      return this.submitToMEVBlocker(tx)
    }
  }

  /**
   * Submit transaction to Flashbots Protect (mainnet)
   */
  private async submitToFlashbotsProtect(tx: TransactionRequest): Promise<Hash> {
    try {
      // Sign transaction
      const signedTx = await this.walletClient.signTransaction({
        ...tx,
        account: this.account,
        chain: mainnet,
      })

      // Create auth header
      const authHeader = await this.createAuthHeader(signedTx)

      // Submit to Flashbots Protect
      const response = await fetch(FLASHBOTS_PROTECT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Flashbots-Signature': authHeader,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_sendRawTransaction',
          params: [signedTx],
        }),
      })

      const result = await response.json() as { result?: Hash; error?: { message: string } }

      if (result.error) {
        throw new Error(result.error.message)
      }

      console.log(`✓ TX submitted via Flashbots Protect: ${result.result}`)
      return result.result as Hash
    } catch (error) {
      console.error('Flashbots Protect submission failed:', error)
      throw error
    }
  }

  /**
   * Submit transaction to MEV Blocker (L2s)
   */
  private async submitToMEVBlocker(tx: TransactionRequest): Promise<Hash> {
    try {
      const hash = await this.walletClient.sendTransaction({
        ...tx,
        account: this.account,
        chain: CHAINS[this.config.chainId as keyof typeof CHAINS],
      })

      console.log(`✓ TX submitted via MEV Blocker: ${hash}`)
      return hash
    } catch (error) {
      console.error('MEV Blocker submission failed:', error)
      throw error
    }
  }

  /**
   * Submit a bundle of transactions (mainnet only)
   */
  async submitBundle(bundle: FlashbotsBundle): Promise<BundleResult> {
    if (this.config.chainId !== 1) {
      throw new Error('Bundles only supported on mainnet')
    }

    // Simulate first if configured
    if (this.config.simulateFirst) {
      const simResult = await this.simulateBundle(bundle)
      if (!simResult.success) {
        return {
          bundleHash: '',
          success: false,
          blockNumber: bundle.blockNumber,
          txHashes: [],
          gasUsed: 0n,
          effectiveGasPrice: 0n,
          error: simResult.error,
        }
      }
    }

    // Create auth header
    const bundleBody = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_sendBundle',
      params: [{
        txs: bundle.transactions,
        blockNumber: `0x${bundle.blockNumber.toString(16)}`,
        minTimestamp: bundle.minTimestamp,
        maxTimestamp: bundle.maxTimestamp,
      }],
    })

    const authHeader = await this.createAuthHeader(bundleBody)

    const response = await fetch(FLASHBOTS_RELAY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Flashbots-Signature': authHeader,
      },
      body: bundleBody,
    })

    const result = await response.json() as {
      result?: { bundleHash: string }
      error?: { message: string }
    }

    if (result.error) {
      return {
        bundleHash: '',
        success: false,
        blockNumber: bundle.blockNumber,
        txHashes: [],
        gasUsed: 0n,
        effectiveGasPrice: 0n,
        error: result.error.message,
      }
    }

    const bundleHash = result.result?.bundleHash ?? ''

    // Track pending bundle
    this.pendingBundles.set(bundleHash, {
      bundleHash,
      transactions: bundle.transactions,
      targetBlock: bundle.blockNumber,
      submittedAt: Date.now(),
      status: 'pending',
    })

    console.log(`✓ Bundle submitted: ${bundleHash}`)

    return {
      bundleHash,
      success: true,
      blockNumber: bundle.blockNumber,
      txHashes: [],
      gasUsed: 0n,
      effectiveGasPrice: 0n,
    }
  }

  /**
   * Simulate a bundle
   */
  async simulateBundle(bundle: FlashbotsBundle): Promise<{ success: boolean; error?: string; gasUsed?: bigint }> {
    const simBody = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_callBundle',
      params: [{
        txs: bundle.transactions,
        blockNumber: `0x${bundle.blockNumber.toString(16)}`,
        stateBlockNumber: 'latest',
      }],
    })

    const authHeader = await this.createAuthHeader(simBody)

    const response = await fetch(FLASHBOTS_RELAY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Flashbots-Signature': authHeader,
      },
      body: simBody,
    })

    const result = await response.json() as {
      result?: { results: Array<{ error?: string; gasUsed: string }> }
      error?: { message: string }
    }

    if (result.error) {
      return { success: false, error: result.error.message }
    }

    const simResults = result.result?.results ?? []
    const failed = simResults.find(r => r.error)

    if (failed) {
      return { success: false, error: failed.error }
    }

    const totalGas = simResults.reduce((sum, r) => sum + BigInt(r.gasUsed), 0n)

    return { success: true, gasUsed: totalGas }
  }

  /**
   * Check bundle status
   */
  async getBundleStatus(bundleHash: string): Promise<{ status: string; blockNumber?: bigint }> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'flashbots_getBundleStats',
      params: [{ bundleHash }],
    })

    const authHeader = await this.createAuthHeader(body)

    const response = await fetch(FLASHBOTS_RELAY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Flashbots-Signature': authHeader,
      },
      body,
    })

    const result = await response.json() as {
      result?: { isSimulated: boolean; isSentToMiners: boolean; isHighPriority: boolean }
    }

    return {
      status: result.result?.isSentToMiners ? 'sent' : 'pending',
    }
  }

  /**
   * Create Flashbots auth header
   */
  private async createAuthHeader(body: string | Hex): Promise<string> {
    const { keccak256, toBytes } = await import('viem')
    const { signMessage } = await import('viem/accounts')

    const bodyBytes = typeof body === 'string' ? toBytes(body) : toBytes(body)
    const hash = keccak256(bodyBytes)
    const signature = await signMessage({
      message: { raw: hash },
      privateKey: this.authSigner.source as Hex,
    })

    return `${this.authSigner.address}:${signature}`
  }

  /**
   * Get pending bundle count
   */
  getPendingCount(): number {
    return this.pendingBundles.size
  }

  /**
   * Clear old pending bundles
   */
  clearStale(maxAgeMs: number = 60000): void {
    const now = Date.now()
    for (const [hash, bundle] of this.pendingBundles) {
      if (now - bundle.submittedAt > maxAgeMs) {
        bundle.status = 'failed'
        this.pendingBundles.delete(hash)
      }
    }
  }
}

// ============ Factory ============

export function createFlashbotsProtect(config: Partial<ProtectConfig> & { privateKey: string }): FlashbotsProtect {
  return new FlashbotsProtect({
    chainId: config.chainId ?? 1,
    privateKey: config.privateKey,
    flashbotsAuthKey: config.flashbotsAuthKey,
    maxBlockWait: config.maxBlockWait ?? 25,
    simulateFirst: config.simulateFirst ?? true,
  })
}

export type { FlashbotsBundle, BundleResult, ProtectConfig }

