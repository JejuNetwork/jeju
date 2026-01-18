/**
 * Wallet Core
 * EIP-1193 compatible wallet implementation with account abstraction support
 */

import type { Address } from 'viem'
import { createPublicClient, http } from 'viem'
import { arbitrum, base, mainnet, optimism, sepolia } from 'viem/chains'
import { type AAClient, createAAClient } from './account-abstraction'
import { createEILClient, type EILClient } from './eil'
import { createGasService, type GasAbstractionService } from './gas-abstraction'

// Supported chains - using unknown cast due to viem chain type variance
const SUPPORTED_CHAINS = new Map<number, typeof mainnet>([
  [1, mainnet],
  [8453, base as unknown as typeof mainnet],
  [42161, arbitrum as unknown as typeof mainnet],
  [10, optimism as unknown as typeof mainnet],
  [11155111, sepolia as unknown as typeof mainnet],
])

export interface WalletCoreConfig {
  defaultChainId?: number
  bundlerUrl?: string
  useNetworkRpc?: boolean
}

export interface EVMAccount {
  address: Address
  chainId: number
}

export interface Account {
  id: string
  label: string
  evmAccounts?: EVMAccount[]
}

export interface AddAccountOptions {
  type: 'eoa' | 'smart'
  label?: string
}

export type WalletEventType =
  | 'connect'
  | 'disconnect'
  | 'chainChanged'
  | 'accountsChanged'

export interface WalletEvent {
  type: WalletEventType
  chainId?: number
  accounts?: Address[]
}

export interface EIP1193Request {
  method: string
  params?: unknown[]
}

/**
 * Wallet Core - Main wallet implementation
 */
export class WalletCore {
  private activeChainId: number
  private bundlerUrl?: string
  private unlocked = false
  private accounts: Account[] = []
  private activeAccountId?: string
  private connectedSites: Set<string> = new Set()
  private eventListeners: Map<
    WalletEventType,
    Set<(event: WalletEvent) => void>
  > = new Map()

  // Cross-chain clients
  private aaClients: Map<number, AAClient> = new Map()
  private eilClients: Map<number, EILClient> = new Map()
  private gasService?: GasAbstractionService

  constructor(config?: WalletCoreConfig) {
    this.activeChainId = config?.defaultChainId ?? 1
    this.bundlerUrl = config?.bundlerUrl
    this.initializeClients()
  }

  private initializeClients(): void {
    const publicClients = new Map()

    for (const [chainId, chain] of SUPPORTED_CHAINS) {
      const publicClient = createPublicClient({
        chain,
        transport: http(),
      })
      publicClients.set(chainId, publicClient)

      // Create AA client
      this.aaClients.set(
        chainId,
        createAAClient({
          chainId,
          publicClient,
          bundlerUrl: this.bundlerUrl,
        }),
      )

      // Create EIL client
      this.eilClients.set(
        chainId,
        createEILClient({
          chainId,
          publicClient,
        }),
      )
    }

    // Create gas service
    this.gasService = createGasService({
      publicClients,
      supportedChains: Array.from(SUPPORTED_CHAINS.keys()),
    })
  }

  // Lock state management

  isUnlocked(): boolean {
    return this.unlocked
  }

  async unlock(password: string): Promise<boolean> {
    if (!password) {
      throw new Error('Password is required')
    }
    this.unlocked = true
    this.emit('connect', { type: 'connect', chainId: this.activeChainId })
    return true
  }

  lock(): void {
    this.unlocked = false
    this.emit('disconnect', { type: 'disconnect' })
  }

  // Account management

  getAccounts(): Account[] {
    return this.accounts
  }

  getActiveAccount(): Account | undefined {
    if (!this.activeAccountId) return undefined
    return this.accounts.find((a) => a.id === this.activeAccountId)
  }

  async addAccount(options: AddAccountOptions): Promise<Account> {
    const id = `account-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const label = options.label ?? `Account ${this.accounts.length + 1}`

    const account: Account = {
      id,
      label,
      evmAccounts: [],
    }

    this.accounts.push(account)

    // Set as active if first account
    if (!this.activeAccountId) {
      this.activeAccountId = id
    }

    return account
  }

  setActiveAccount(accountId: string): void {
    const account = this.accounts.find((a) => a.id === accountId)
    if (account) {
      this.activeAccountId = accountId
    }
  }

  // Chain management

  getActiveChainId(): number {
    return this.activeChainId
  }

  async switchChain(chainId: number): Promise<void> {
    if (!SUPPORTED_CHAINS.has(chainId)) {
      throw new Error(`Chain ${chainId} not supported`)
    }
    this.activeChainId = chainId
    this.emit('chainChanged', { type: 'chainChanged', chainId })
  }

  getSupportedChains(): number[] {
    return Array.from(SUPPORTED_CHAINS.keys())
  }

  // Cross-chain clients

  getAAClient(chainId?: number): AAClient {
    const targetChainId = chainId ?? this.activeChainId
    const client = this.aaClients.get(targetChainId)
    if (!client) {
      throw new Error(`AA not configured for chain ${targetChainId}`)
    }
    return client
  }

  getEILClient(chainId?: number): EILClient {
    const targetChainId = chainId ?? this.activeChainId
    const client = this.eilClients.get(targetChainId)
    if (!client) {
      throw new Error(`EIL not configured for chain ${targetChainId}`)
    }
    return client
  }

  getOIFClient(chainId?: number): EILClient {
    const targetChainId = chainId ?? this.activeChainId
    const client = this.eilClients.get(targetChainId)
    if (!client) {
      throw new Error(`OIF not configured for chain ${targetChainId}`)
    }
    return client
  }

  getGasService(): GasAbstractionService {
    if (!this.gasService) {
      throw new Error('Gas service not initialized')
    }
    return this.gasService
  }

  // Site connections

  isConnected(origin: string): boolean {
    return this.connectedSites.has(origin)
  }

  async connect(origin: string): Promise<Address[]> {
    const account = this.getActiveAccount()
    if (!account) {
      throw new Error('No account available')
    }

    this.connectedSites.add(origin)

    const addresses = account.evmAccounts?.map((a) => a.address) ?? []
    return addresses
  }

  disconnect(origin: string): void {
    this.connectedSites.delete(origin)
  }

  // EIP-1193 Provider interface

  async request(request: EIP1193Request): Promise<unknown> {
    const { method, params } = request

    switch (method) {
      case 'eth_accounts': {
        const account = this.getActiveAccount()
        return account?.evmAccounts?.map((a) => a.address) ?? []
      }

      case 'eth_chainId':
        return `0x${this.activeChainId.toString(16)}`

      case 'wallet_switchEthereumChain': {
        const chainIdHex = (params as [{ chainId: string }])?.[0]?.chainId
        if (chainIdHex) {
          const chainId = parseInt(chainIdHex, 16)
          await this.switchChain(chainId)
        }
        return null
      }

      case 'wallet_addEthereumChain':
        // Simplified - just return null (chain addition not implemented)
        return null

      default:
        throw new Error(`Method ${method} not supported`)
    }
  }

  // Event system

  on(
    event: WalletEventType,
    callback: (event: WalletEvent) => void,
  ): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set())
    }
    this.eventListeners.get(event)?.add(callback)

    // Return unsubscribe function
    return () => {
      this.eventListeners.get(event)?.delete(callback)
    }
  }

  private emit(event: WalletEventType, data: WalletEvent): void {
    const listeners = this.eventListeners.get(event)
    if (listeners) {
      for (const callback of listeners) {
        callback(data)
      }
    }
  }
}

/**
 * Create a wallet core instance
 */
export function createWalletCore(config?: WalletCoreConfig): WalletCore {
  return new WalletCore(config)
}
