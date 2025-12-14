/**
 * @fileoverview Core wallet functionality
 *
 * Provides the unified wallet interface that:
 * - Manages accounts across EVM and Solana
 * - Handles key generation and storage
 * - Coordinates cross-chain operations
 * - Exposes provider interface for dApps
 */

import type { Address, Hex, PublicClient, WalletClient } from 'viem';
import { createPublicClient, createWalletClient, http, custom } from 'viem';
import type {
  Account,
  SmartAccount,
  SolanaAccount,
  UnifiedAccount,
  Token,
  TokenBalance,
  Transaction,
  WalletState,
  WalletEvent,
} from './types';
import { chains, getJejuRpcUrl } from './chains';
import { EILClient, createEILClient } from './eil';
import { OIFClient, createOIFClient } from './oif';
import { AAClient, createAAClient } from './account-abstraction';
import { GasAbstractionService, createGasService } from './gas-abstraction';

// ============================================================================
// Types
// ============================================================================

export interface WalletCoreConfig {
  defaultChainId?: number;
  useJejuRpc?: boolean;
  bundlerUrl?: string;
  paymasterUrl?: string;
  oifApiUrl?: string;
}

type EventCallback = (event: WalletEvent) => void;

// ============================================================================
// Wallet Core
// ============================================================================

export class WalletCore {
  private config: WalletCoreConfig;
  private state: WalletState;
  private publicClients: Map<number, PublicClient> = new Map();
  private walletClient?: WalletClient;
  private eilClients: Map<number, EILClient> = new Map();
  private oifClients: Map<number, OIFClient> = new Map();
  private aaClients: Map<number, AAClient> = new Map();
  private gasService?: GasAbstractionService;
  private eventListeners: Map<string, EventCallback[]> = new Map();

  constructor(config: WalletCoreConfig = {}) {
    this.config = {
      defaultChainId: 1,
      useJejuRpc: true,
      ...config,
    };

    this.state = {
      isUnlocked: false,
      accounts: [],
      connectedSites: [],
    };

    this.initializeClients();
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  private initializeClients(): void {
    // Create public clients for all supported chains
    for (const [chainId, chainConfig] of Object.entries(chains)) {
      const id = Number(chainId);
      const rpcUrl = this.config.useJejuRpc
        ? getJejuRpcUrl(id) ?? chainConfig.rpcUrls.default.http[0]
        : chainConfig.rpcUrls.default.http[0];

      const publicClient = createPublicClient({
        chain: {
          id,
          name: chainConfig.name,
          nativeCurrency: chainConfig.nativeCurrency,
          rpcUrls: { default: { http: [rpcUrl] } },
        },
        transport: http(rpcUrl),
      });

      this.publicClients.set(id, publicClient);

      // Create EIL client
      this.eilClients.set(
        id,
        createEILClient({
          chainId: id,
          publicClient,
          walletClient: this.walletClient,
        })
      );

      // Create OIF client
      this.oifClients.set(
        id,
        createOIFClient({
          chainId: id,
          publicClient,
          walletClient: this.walletClient,
          quoteApiUrl: this.config.oifApiUrl,
        })
      );

      // Create AA client
      this.aaClients.set(
        id,
        createAAClient({
          chainId: id,
          publicClient,
          walletClient: this.walletClient,
          bundlerUrl: this.config.bundlerUrl,
          paymasterUrl: this.config.paymasterUrl,
        })
      );
    }

    // Create gas service
    this.gasService = createGasService({
      publicClients: this.publicClients,
      walletClient: this.walletClient,
      supportedChains: Array.from(this.publicClients.keys()),
    });
  }

  // ============================================================================
  // Account Management
  // ============================================================================

  async unlock(password: string): Promise<boolean> {
    // In a real implementation, this would decrypt the stored keys
    // For now, we simulate unlock
    this.state.isUnlocked = true;
    this.emit({ type: 'connect', chainId: this.config.defaultChainId ?? 1 });
    return true;
  }

  lock(): void {
    this.state.isUnlocked = false;
    this.walletClient = undefined;
    this.emit({ type: 'disconnect' });
  }

  isUnlocked(): boolean {
    return this.state.isUnlocked;
  }

  getAccounts(): UnifiedAccount[] {
    return this.state.accounts;
  }

  getActiveAccount(): UnifiedAccount | undefined {
    return this.state.accounts.find((a) => a.id === this.state.activeAccountId);
  }

  async addAccount(params: {
    type: 'eoa' | 'smart-account' | 'import';
    privateKey?: Hex;
    mnemonic?: string;
    label?: string;
  }): Promise<UnifiedAccount> {
    // Generate or import account
    // This is simplified - real implementation would handle key derivation
    const id = `account-${Date.now()}`;

    const newAccount: UnifiedAccount = {
      id,
      label: params.label ?? `Account ${this.state.accounts.length + 1}`,
      evmAccounts: [],
      solanaAccounts: [],
      smartAccounts: [],
    };

    this.state.accounts.push(newAccount);

    if (!this.state.activeAccountId) {
      this.state.activeAccountId = id;
    }

    return newAccount;
  }

  setActiveAccount(accountId: string): void {
    if (this.state.accounts.find((a) => a.id === accountId)) {
      this.state.activeAccountId = accountId;
      const account = this.getActiveAccount();
      if (account?.evmAccounts[0]) {
        this.emit({ type: 'accountsChanged', accounts: [account.evmAccounts[0].address] });
      }
    }
  }

  // ============================================================================
  // Chain Management
  // ============================================================================

  getActiveChainId(): number {
    return this.state.activeChainId ?? this.config.defaultChainId ?? 1;
  }

  async switchChain(chainId: number): Promise<void> {
    if (!chains[chainId]) {
      throw new Error(`Chain ${chainId} not supported`);
    }

    this.state.activeChainId = chainId;
    this.emit({ type: 'chainChanged', chainId });
  }

  getSupportedChains(): number[] {
    return Object.keys(chains).map(Number);
  }

  // ============================================================================
  // Balance & Token Management
  // ============================================================================

  async getBalance(address: Address, chainId?: number): Promise<bigint> {
    const cid = chainId ?? this.getActiveChainId();
    const client = this.publicClients.get(cid);
    if (!client) throw new Error(`Chain ${cid} not configured`);

    return client.getBalance({ address });
  }

  async getTokenBalance(
    address: Address,
    tokenAddress: Address,
    chainId?: number
  ): Promise<bigint> {
    const cid = chainId ?? this.getActiveChainId();
    const client = this.publicClients.get(cid);
    if (!client) throw new Error(`Chain ${cid} not configured`);

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
    });

    return balance;
  }

  async getAllBalances(address: Address): Promise<TokenBalance[]> {
    const balances: TokenBalance[] = [];

    // Get native balances for all chains
    for (const chainId of this.getSupportedChains()) {
      try {
        const balance = await this.getBalance(address, chainId);
        const chain = chains[chainId];

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
        });
      } catch {
        // Chain might be unavailable
      }
    }

    return balances;
  }

  // ============================================================================
  // Cross-Chain Operations
  // ============================================================================

  getEILClient(chainId?: number): EILClient {
    const cid = chainId ?? this.getActiveChainId();
    const client = this.eilClients.get(cid);
    if (!client) throw new Error(`EIL not configured for chain ${cid}`);
    return client;
  }

  getOIFClient(chainId?: number): OIFClient {
    const cid = chainId ?? this.getActiveChainId();
    const client = this.oifClients.get(cid);
    if (!client) throw new Error(`OIF not configured for chain ${cid}`);
    return client;
  }

  getAAClient(chainId?: number): AAClient {
    const cid = chainId ?? this.getActiveChainId();
    const client = this.aaClients.get(cid);
    if (!client) throw new Error(`AA not configured for chain ${cid}`);
    return client;
  }

  getGasService(): GasAbstractionService {
    if (!this.gasService) throw new Error('Gas service not initialized');
    return this.gasService;
  }

  // ============================================================================
  // Transaction Execution
  // ============================================================================

  async sendTransaction(params: {
    to: Address;
    value?: bigint;
    data?: Hex;
    chainId?: number;
    useSmartAccount?: boolean;
    gasToken?: Address;
  }): Promise<Hex> {
    const chainId = params.chainId ?? this.getActiveChainId();

    if (params.useSmartAccount) {
      // Use Account Abstraction
      const aaClient = this.getAAClient(chainId);
      const account = this.getActiveAccount();
      if (!account?.smartAccounts[0]) {
        throw new Error('No smart account available');
      }

      let paymasterAndData: Hex = '0x';
      if (params.gasToken) {
        const eilClient = this.getEILClient(chainId);
        paymasterAndData = eilClient.buildPaymasterData(0, params.gasToken);
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
      });

      return result.transactionHash ?? result.userOpHash;
    }

    // Use EOA
    if (!this.walletClient?.account) {
      throw new Error('Wallet not connected');
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
        rpcUrls: { default: { http: [getJejuRpcUrl(chainId) ?? ''] } },
      },
    });

    return hash;
  }

  async signMessage(message: string | Uint8Array): Promise<Hex> {
    if (!this.walletClient?.account) {
      throw new Error('Wallet not connected');
    }

    const signature = await this.walletClient.signMessage({
      account: this.walletClient.account,
      message: typeof message === 'string' ? message : { raw: message },
    });

    return signature;
  }

  async signTypedData(typedData: {
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<Hex> {
    if (!this.walletClient?.account) {
      throw new Error('Wallet not connected');
    }

    const signature = await this.walletClient.signTypedData({
      account: this.walletClient.account,
      domain: typedData.domain as {
        name?: string;
        version?: string;
        chainId?: number;
        verifyingContract?: Address;
      },
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });

    return signature;
  }

  // ============================================================================
  // Site Connections
  // ============================================================================

  async connect(origin: string): Promise<Address[]> {
    const account = this.getActiveAccount();
    if (!account?.evmAccounts[0]) {
      throw new Error('No account available');
    }

    // Add to connected sites
    const existingSite = this.state.connectedSites.find((s) => s.origin === origin);
    if (!existingSite) {
      this.state.connectedSites.push({
        origin,
        permissions: ['eth_accounts', 'eth_chainId'],
        connectedAt: Date.now(),
      });
    }

    return [account.evmAccounts[0].address];
  }

  disconnect(origin: string): void {
    this.state.connectedSites = this.state.connectedSites.filter((s) => s.origin !== origin);
  }

  isConnected(origin: string): boolean {
    return this.state.connectedSites.some((s) => s.origin === origin);
  }

  // ============================================================================
  // Event System
  // ============================================================================

  on(event: WalletEvent['type'], callback: EventCallback): () => void {
    const listeners = this.eventListeners.get(event) ?? [];
    listeners.push(callback);
    this.eventListeners.set(event, listeners);

    return () => {
      const idx = listeners.indexOf(callback);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }

  private emit(event: WalletEvent): void {
    const listeners = this.eventListeners.get(event.type) ?? [];
    for (const listener of listeners) {
      listener(event);
    }
  }

  // ============================================================================
  // Provider Interface (EIP-1193)
  // ============================================================================

  async request(args: { method: string; params?: unknown[] }): Promise<unknown> {
    const { method, params = [] } = args;

    switch (method) {
      case 'eth_accounts':
      case 'eth_requestAccounts': {
        const account = this.getActiveAccount();
        return account?.evmAccounts.map((a) => a.address) ?? [];
      }

      case 'eth_chainId':
        return `0x${this.getActiveChainId().toString(16)}`;

      case 'eth_sendTransaction': {
        const [txParams] = params as [{ to: Address; value?: string; data?: Hex }];
        return this.sendTransaction({
          to: txParams.to,
          value: txParams.value ? BigInt(txParams.value) : undefined,
          data: txParams.data,
        });
      }

      case 'personal_sign': {
        const [message] = params as [string];
        return this.signMessage(message);
      }

      case 'eth_signTypedData_v4': {
        const [, typedData] = params as [string, string];
        return this.signTypedData(JSON.parse(typedData));
      }

      case 'wallet_switchEthereumChain': {
        const [{ chainId }] = params as [{ chainId: string }];
        await this.switchChain(parseInt(chainId, 16));
        return null;
      }

      case 'wallet_addEthereumChain': {
        // Simplified - would validate and add chain
        return null;
      }

      default:
        throw new Error(`Method ${method} not supported`);
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createWalletCore(config?: WalletCoreConfig): WalletCore {
  return new WalletCore(config);
}

