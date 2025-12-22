/**
 * @fileoverview Core wallet functionality
 *
 * Provides the unified wallet interface that:
 * - Manages accounts across EVM and Solana
 * - Handles key generation and storage
 * - Coordinates cross-chain operations
 * - Exposes provider interface for dApps
 */

import {
  expectAddress,
  expectBigInt,
  expectChainId,
  expectDefined,
  expectHex,
  expectJson,
} from '@jejunetwork/types'
import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import { createPublicClient, http } from 'viem'
import { z } from 'zod'
import { expectNonEmpty, expectSchema } from '../lib/validation'
import { type AAClient, createAAClient } from './account-abstraction'
import { chains, getNetworkRpcUrl } from './chains'
import { createEILClient, type EILClient } from './eil'
import { createGasService, type GasAbstractionService } from './gas-abstraction'
import { createOIFClient, type OIFClient } from './oif'
import { UnifiedAccountSchema } from './schemas'
import type {
  TokenBalance,
  UnifiedAccount,
  WalletEvent,
  WalletState,
} from './types'

// EIP-712 typed data value types (primitives that can appear in typed data)
type TypedDataValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | TypedDataValue[]
  | { [key: string]: TypedDataValue }

// EIP-712 domain types
type TypedDataDomain = {
  name?: string
  version?: string
  chainId?: number
  verifyingContract?: Address
  salt?: Hex
}

// Schema for EIP-712 typed data
const TypedDataSchema = z.object({
  domain: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
  types: z.record(
    z.string(),
    z.array(z.object({ name: z.string(), type: z.string() })),
  ),
  primaryType: z.string(),
  message: z.record(
    z.string(),
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(z.string()),
      z.record(z.string(), z.string()),
    ]),
  ),
})

// EIP-1193 request return types based on method
type EIP1193RequestResult =
  | Address[] // eth_accounts, eth_requestAccounts
  | string // eth_chainId, personal_sign, eth_signTypedData_v4
  | Hex // eth_sendTransaction
  | null // wallet_switchEthereumChain, wallet_addEthereumChain

// EIP-1193 transaction request params
interface EIP1193TransactionParams {
  to: Address
  value?: string
  data?: Hex
  from?: Address
  gas?: string
  gasPrice?: string
  maxFeePerGas?: string
  maxPriorityFeePerGas?: string
}

// ============================================================================
// Types
// ============================================================================

export interface WalletCoreConfig {
  defaultChainId?: number
  useNetworkRpc?: boolean
  bundlerUrl?: string
  paymasterUrl?: string
  oifApiUrl?: string
}

type EventCallback = (event: WalletEvent) => void

// ============================================================================
// Wallet Core
// ============================================================================

export class WalletCore {
  private config: WalletCoreConfig
  private state: WalletState
  private publicClients: Map<number, PublicClient> = new Map()
  private walletClient?: WalletClient
  private eilClients: Map<number, EILClient> = new Map()
  private oifClients: Map<number, OIFClient> = new Map()
  private aaClients: Map<number, AAClient> = new Map()
  private gasService?: GasAbstractionService
  private eventListeners: Map<string, EventCallback[]> = new Map()

  constructor(config: WalletCoreConfig = {}) {
    this.config = {
      defaultChainId: 1,
      useNetworkRpc: true,
      ...config,
    }

    this.state = {
      isUnlocked: false,
      accounts: [],
      connectedSites: [],
    }

    this.initializeClients()
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  private initializeClients(): void {
    // Create public clients for all supported chains
    for (const [chainId, chainConfig] of Object.entries(chains)) {
      const id = Number(chainId)
      const rpcUrl = this.config.useNetworkRpc
        ? (getNetworkRpcUrl(id) ?? chainConfig.rpcUrls.default.http[0])
        : chainConfig.rpcUrls.default.http[0]

      const publicClient = createPublicClient({
        chain: {
          id,
          name: chainConfig.name,
          nativeCurrency: chainConfig.nativeCurrency,
          rpcUrls: { default: { http: [rpcUrl] } },
        },
        transport: http(rpcUrl),
      })

      this.publicClients.set(id, publicClient)

      // Create EIL client
      this.eilClients.set(
        id,
        createEILClient({
          chainId: id,
          publicClient,
          walletClient: this.walletClient,
        }),
      )

      // Create OIF client
      this.oifClients.set(
        id,
        createOIFClient({
          chainId: id,
          publicClient,
          walletClient: this.walletClient,
          quoteApiUrl: this.config.oifApiUrl,
        }),
      )

      // Create AA client
      this.aaClients.set(
        id,
        createAAClient({
          chainId: id,
          publicClient,
          walletClient: this.walletClient,
          bundlerUrl: this.config.bundlerUrl,
          paymasterUrl: this.config.paymasterUrl,
        }),
      )
    }

    // Create gas service
    this.gasService = createGasService({
      publicClients: this.publicClients,
      walletClient: this.walletClient,
      supportedChains: Array.from(this.publicClients.keys()),
    })
  }

  // ============================================================================
  // Account Management
  // ============================================================================

  async unlock(password: string): Promise<boolean> {
    expectNonEmpty(password, 'password')
    // In a real implementation, this would decrypt the stored keys
    // For now, we simulate unlock
    this.state.isUnlocked = true
    this.emit({ type: 'connect', chainId: this.config.defaultChainId ?? 1 })
    return true
  }

  lock(): void {
    this.state.isUnlocked = false
    this.walletClient = undefined
    this.emit({ type: 'disconnect' })
  }

  isUnlocked(): boolean {
    return this.state.isUnlocked
  }

  getAccounts(): UnifiedAccount[] {
    return this.state.accounts
  }

  getActiveAccount(): UnifiedAccount | undefined {
    return this.state.accounts.find((a) => a.id === this.state.activeAccountId)
  }

  async addAccount(params: {
    type: 'eoa' | 'smart-account' | 'import'
    privateKey?: Hex
    mnemonic?: string
    label?: string
  }): Promise<UnifiedAccount> {
    if (params.privateKey) expectHex(params.privateKey, 'privateKey')
    if (params.mnemonic) expectNonEmpty(params.mnemonic, 'mnemonic')

    // Generate or import account
    // This is simplified - real implementation would handle key derivation
    const id = `account-${Date.now()}`

    const newAccount: UnifiedAccount = {
      id,
      label: params.label ?? `Account ${this.state.accounts.length + 1}`,
      evmAccounts: [],
      solanaAccounts: [],
      smartAccounts: [],
    }

    expectSchema(newAccount, UnifiedAccountSchema, 'new account')

    this.state.accounts.push(newAccount)

    if (!this.state.activeAccountId) {
      this.state.activeAccountId = id
    }

    return newAccount
  }

  setActiveAccount(accountId: string): void {
    expectNonEmpty(accountId, 'accountId')
    if (this.state.accounts.find((a) => a.id === accountId)) {
      this.state.activeAccountId = accountId
      const account = this.getActiveAccount()
      if (account?.evmAccounts[0]) {
        this.emit({
          type: 'accountsChanged',
          accounts: [account.evmAccounts[0].address],
        })
      }
    }
  }

  // ============================================================================
  // Chain Management
  // ============================================================================

  getActiveChainId(): number {
    return this.state.activeChainId ?? this.config.defaultChainId ?? 1
  }

  async switchChain(chainId: number): Promise<void> {
    expectChainId(chainId, 'chainId')
    if (!chains[chainId]) {
      throw new Error(`Chain ${chainId} not supported`)
    }

    this.state.activeChainId = chainId
    this.emit({ type: 'chainChanged', chainId })
  }

  getSupportedChains(): number[] {
    return Object.keys(chains).map(Number)
  }

  // ============================================================================
  // Balance & Token Management
  // ============================================================================

  async getBalance(address: Address, chainId?: number): Promise<bigint> {
    expectAddress(address, 'address')
    if (chainId) expectChainId(chainId, 'chainId')

    const cid = chainId ?? this.getActiveChainId()
    const client = this.publicClients.get(cid)
    if (!client) throw new Error(`Chain ${cid} not configured`)

    return client.getBalance({ address })
  }

  async getTokenBalance(
    address: Address,
    tokenAddress: Address,
    chainId?: number,
  ): Promise<bigint> {
    expectAddress(address, 'address')
    expectAddress(tokenAddress, 'tokenAddress')
    if (chainId) expectChainId(chainId, 'chainId')

    const cid = chainId ?? this.getActiveChainId()
    const client = this.publicClients.get(cid)
    if (!client) throw new Error(`Chain ${cid} not configured`)

    const balance = await client.readContract({
      address: tokenAddress,
      abi: [
        {
          name: 'balanceOf',
          type: 'function',
          inputs: [{ name: 'account', type: 'address' }],
          outputs: [{ type: 'uint256' }],
          stateMutability: 'view',
        },
      ],
      functionName: 'balanceOf',
      args: [address],
    })

    return balance as bigint
  }

  async getAllBalances(address: Address): Promise<TokenBalance[]> {
    expectAddress(address, 'address')
    const balances: TokenBalance[] = []

    // Get native balances for all chains
    for (const chainId of this.getSupportedChains()) {
      const balance = await this.getBalance(address, chainId)
      const chain = chains[chainId]

      balances.push({
        token: {
          address: '0x0000000000000000000000000000000000000000' as Address,
          chainId,
          symbol: chain.nativeCurrency.symbol,
          name: chain.nativeCurrency.name,
          decimals: chain.nativeCurrency.decimals,
          isNative: true,
        },
        balance,
      })
    }

    return balances
  }

  // ============================================================================
  // Cross-Chain Operations
  // ============================================================================

  getEILClient(chainId?: number): EILClient {
    if (chainId) expectChainId(chainId, 'chainId')
    const cid = chainId ?? this.getActiveChainId()
    const client = this.eilClients.get(cid)
    if (!client) throw new Error(`EIL not configured for chain ${cid}`)
    return client
  }

  getOIFClient(chainId?: number): OIFClient {
    if (chainId) expectChainId(chainId, 'chainId')
    const cid = chainId ?? this.getActiveChainId()
    const client = this.oifClients.get(cid)
    if (!client) throw new Error(`OIF not configured for chain ${cid}`)
    return client
  }

  getAAClient(chainId?: number): AAClient {
    if (chainId) expectChainId(chainId, 'chainId')
    const cid = chainId ?? this.getActiveChainId()
    const client = this.aaClients.get(cid)
    if (!client) throw new Error(`AA not configured for chain ${cid}`)
    return client
  }

  getGasService(): GasAbstractionService {
    if (!this.gasService) throw new Error('Gas service not initialized')
    return this.gasService
  }

  // ============================================================================
  // Transaction Execution
  // ============================================================================

  async sendTransaction(params: {
    to: Address
    value?: bigint
    data?: Hex
    chainId?: number
    useSmartAccount?: boolean
    gasToken?: Address
  }): Promise<Hex> {
    expectAddress(params.to, 'params.to')
    if (params.value) expectBigInt(params.value, 'params.value')
    if (params.data) expectHex(params.data, 'params.data')
    if (params.chainId) expectChainId(params.chainId, 'params.chainId')
    if (params.gasToken) expectAddress(params.gasToken, 'params.gasToken')

    const chainId = params.chainId ?? this.getActiveChainId()

    if (params.useSmartAccount) {
      // Use Account Abstraction
      const aaClient = this.getAAClient(chainId)
      const account = this.getActiveAccount()
      if (!account?.smartAccounts[0]) {
        throw new Error('No smart account available')
      }

      let paymasterAndData: Hex = '0x'
      if (params.gasToken) {
        const eilClient = this.getEILClient(chainId)
        paymasterAndData = await eilClient.buildPaymasterData(
          0,
          params.gasToken,
        )
      }

      const result = await aaClient.execute({
        sender: account.smartAccounts[0].address,
        calls: {
          to: params.to,
          value: params.value,
          data: params.data,
        },
        paymasterAndData,
        waitForReceipt: true,
      })

      return result.transactionHash ?? result.userOpHash
    }

    // Use EOA
    if (!this.walletClient?.account) {
      throw new Error('Wallet not connected')
    }

    const hash = await this.walletClient.sendTransaction({
      account: this.walletClient.account,
      to: params.to,
      value: params.value ?? 0n,
      data: params.data,
      chain: {
        id: chainId,
        name: chains[chainId].name,
        nativeCurrency: chains[chainId].nativeCurrency,
        rpcUrls: { default: { http: [getNetworkRpcUrl(chainId) ?? ''] } },
      },
    })

    return expectHex(hash, 'transaction hash')
  }

  async signMessage(message: string | Uint8Array): Promise<Hex> {
    if (!message) throw new Error('Message is required')
    if (!this.walletClient?.account) {
      throw new Error('Wallet not connected')
    }

    const signature = await this.walletClient.signMessage({
      account: this.walletClient.account,
      message: typeof message === 'string' ? message : { raw: message },
    })

    return expectHex(signature, 'signature')
  }

  async signTypedData(typedData: {
    domain: TypedDataDomain
    types: Record<string, Array<{ name: string; type: string }>>
    primaryType: string
    message: Record<string, TypedDataValue>
  }): Promise<Hex> {
    expectDefined(typedData, 'typedData')
    expectDefined(typedData.domain, 'typedData.domain')
    expectDefined(typedData.types, 'typedData.types')
    expectDefined(typedData.primaryType, 'typedData.primaryType')
    expectDefined(typedData.message, 'typedData.message')

    if (!this.walletClient?.account) {
      throw new Error('Wallet not connected')
    }

    const signature = await this.walletClient.signTypedData({
      account: this.walletClient.account,
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    })

    return expectHex(signature, 'signature')
  }

  // ============================================================================
  // Site Connections
  // ============================================================================

  async connect(origin: string): Promise<Address[]> {
    expectNonEmpty(origin, 'origin')
    const account = this.getActiveAccount()
    if (!account?.evmAccounts[0]) {
      throw new Error('No account available')
    }

    // Add to connected sites
    const existingSite = this.state.connectedSites.find(
      (s) => s.origin === origin,
    )
    if (!existingSite) {
      this.state.connectedSites.push({
        origin,
        permissions: ['eth_accounts', 'eth_chainId'],
        connectedAt: Date.now(),
      })
    }

    return [account.evmAccounts[0].address]
  }

  disconnect(origin: string): void {
    expectNonEmpty(origin, 'origin')
    this.state.connectedSites = this.state.connectedSites.filter(
      (s) => s.origin !== origin,
    )
  }

  isConnected(origin: string): boolean {
    expectNonEmpty(origin, 'origin')
    return this.state.connectedSites.some((s) => s.origin === origin)
  }

  // ============================================================================
  // Event System
  // ============================================================================

  on(event: WalletEvent['type'], callback: EventCallback): () => void {
    const listeners = this.eventListeners.get(event) ?? []
    listeners.push(callback)
    this.eventListeners.set(event, listeners)

    return () => {
      const idx = listeners.indexOf(callback)
      if (idx >= 0) listeners.splice(idx, 1)
    }
  }

  private emit(event: WalletEvent): void {
    const listeners = this.eventListeners.get(event.type) ?? []
    for (const listener of listeners) {
      listener(event)
    }
  }

  // ============================================================================
  // Provider Interface (EIP-1193)
  // ============================================================================

  async request(args: {
    method: string
    params?: ReadonlyArray<
      string | EIP1193TransactionParams | { chainId: string }
    >
  }): Promise<EIP1193RequestResult> {
    expectDefined(args, 'args')
    expectNonEmpty(args.method, 'args.method')
    const { method, params = [] } = args

    switch (method) {
      case 'eth_accounts':
      case 'eth_requestAccounts': {
        const account = this.getActiveAccount()
        return account?.evmAccounts.map((a) => a.address) ?? []
      }

      case 'eth_chainId':
        return `0x${this.getActiveChainId().toString(16)}`

      case 'eth_sendTransaction': {
        const txParams = params[0] as EIP1193TransactionParams
        expectDefined(txParams, 'txParams')
        return this.sendTransaction({
          to: txParams.to,
          value: txParams.value ? BigInt(txParams.value) : undefined,
          data: txParams.data,
        })
      }

      case 'personal_sign': {
        const message = params[0] as string
        expectNonEmpty(message, 'message')
        return this.signMessage(message)
      }

      case 'eth_signTypedData_v4': {
        const typedData = params[1] as string
        expectNonEmpty(typedData, 'typedData')
        return this.signTypedData(
          expectJson(typedData, TypedDataSchema, 'typedData'),
        )
      }

      case 'wallet_switchEthereumChain': {
        const switchParams = params[0] as { chainId: string }
        expectDefined(switchParams, 'switchParams')
        expectNonEmpty(switchParams.chainId, 'chainId')
        await this.switchChain(parseInt(switchParams.chainId, 16))
        return null
      }

      case 'wallet_addEthereumChain': {
        // Simplified - would validate and add chain
        return null
      }

      default:
        throw new Error(`Method ${method} not supported`)
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createWalletCore(config?: WalletCoreConfig): WalletCore {
  return new WalletCore(config)
}
