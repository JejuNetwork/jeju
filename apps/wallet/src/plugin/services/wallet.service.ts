/**
 * Wallet Service
 * 
 * Core service for wallet management, based on Rabby's WalletController.
 * Manages accounts, keyring, transactions, and integrates with Jeju infrastructure.
 */

import type { IAgentRuntime } from '@elizaos/core';
import { 
  createPublicClient, 
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
  type Address,
  type Hex,
  type Chain,
  formatEther,
  formatUnits,
} from 'viem';
import { mainnet, base, arbitrum, optimism, polygon } from 'viem/chains';
import { privateKeyToAccount, mnemonicToAccount } from 'viem/accounts';
import type {
  WalletState,
  WalletAccount,
  WalletServiceConfig,
  TokenBalance,
  SimulationResult,
  PortfolioSummary,
} from '../types';

// Supported chains with Jeju RPC integration
const SUPPORTED_CHAINS: Record<number, Chain> = {
  1: mainnet,
  8453: base,
  42161: arbitrum,
  10: optimism,
  137: polygon,
};

export class WalletService {
  static readonly serviceType = 'jeju-wallet';
  
  private runtime: IAgentRuntime | null = null;
  private _state: WalletState;
  private _publicClients: Map<number, PublicClient> = new Map();
  private _walletClients: Map<number, WalletClient> = new Map();
  private _config: WalletServiceConfig;
  
  // Cache for balances/tokens
  private _balanceCache: Map<string, { balance: TokenBalance[]; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 30000; // 30 seconds
  
  constructor() {
    this._config = {
      defaultChainId: 8453, // Base
      useJejuInfrastructure: true,
    };
    
    this._state = {
      isLocked: true,
      isInitialized: false,
      accounts: [],
      activeChainId: this._config.defaultChainId,
      preferredChains: [8453, 1, 42161, 10, 137],
      autoLockTimeout: 15 * 60 * 1000, // 15 minutes
      gasPreferences: {
        autoGasAbstraction: true,
        priorityFeeMultiplier: 1.1,
      },
      securitySettings: {
        requireConfirmation: true,
        simulateBeforeSign: true,
        whitelistedAddresses: [],
        blockedAddresses: [],
      },
      viewMode: 'simple',
    };
  }
  
  get serviceType(): string {
    return WalletService.serviceType;
  }
  
  // Static methods required by ElizaOS
  static async start(): Promise<WalletService> {
    return new WalletService();
  }
  
  static async stop(): Promise<void> {
    // Cleanup
  }
  
  async initialize(runtime: IAgentRuntime): Promise<void> {
    this.runtime = runtime;
    
    // Initialize public clients for all supported chains
    for (const [chainId, chain] of Object.entries(SUPPORTED_CHAINS)) {
      const rpcUrl = this.getJejuRpcUrl(Number(chainId)) || chain.rpcUrls.default.http[0];
      
      const publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl),
      });
      
      this._publicClients.set(Number(chainId), publicClient);
    }
    
    runtime.logger.info('[WalletService] Initialized with Jeju infrastructure');
  }
  
  async stop(): Promise<void> {
    // Lock wallet on stop
    this._state.isLocked = true;
    this.runtime?.logger.info('[WalletService] Stopped');
  }
  
  // ============================================================================
  // RPC Management - Jeju Integration
  // ============================================================================
  
  private getJejuRpcUrl(chainId: number): string | null {
    if (!this._config.useJejuInfrastructure) return null;
    
    // Use Jeju Gateway RPC
    const baseUrl = this._config.jejuRpcUrl || 'http://localhost:4010';
    return `${baseUrl}/rpc/${chainId}`;
  }
  
  getPublicClient(chainId: number): PublicClient {
    const client = this._publicClients.get(chainId);
    if (!client) {
      throw new Error(`Chain ${chainId} not supported`);
    }
    return client;
  }
  
  getWalletClient(chainId: number): WalletClient | null {
    return this._walletClients.get(chainId) || null;
  }
  
  // ============================================================================
  // Account Management
  // ============================================================================
  
  getState(): WalletState {
    return { ...this._state };
  }
  
  isLocked(): boolean {
    return this._state.isLocked;
  }
  
  getCurrentAccount(): WalletAccount | undefined {
    return this._state.currentAccount;
  }
  
  async createWallet(options: {
    type: 'hd' | 'smart-account';
    name?: string;
    password?: string;
  }): Promise<WalletAccount> {
    this.runtime?.logger.info(`[WalletService] Creating ${options.type} wallet`);
    
    if (options.type === 'hd') {
      // Generate new mnemonic
      const bip39 = await import('@scure/bip39');
      const { wordlist } = await import('@scure/bip39/wordlists/english');
      const mnemonic = bip39.generateMnemonic(wordlist);
      
      // Create account from mnemonic
      const account = mnemonicToAccount(mnemonic);
      
      const walletAccount: WalletAccount = {
        address: account.address,
        type: 'hd',
        name: options.name || 'Main Account',
        hdPath: "m/44'/60'/0'/0/0",
        createdAt: Date.now(),
      };
      
      this._state.accounts.push(walletAccount);
      this._state.currentAccount = walletAccount;
      this._state.isInitialized = true;
      this._state.isLocked = false;
      
      // Initialize wallet clients
      await this.initializeWalletClients(account.address, mnemonic);
      
      return walletAccount;
    }
    
    throw new Error(`Wallet type ${options.type} not yet implemented`);
  }
  
  async importWallet(options: {
    type: 'mnemonic' | 'private-key';
    secret: string;
    name?: string;
  }): Promise<WalletAccount> {
    this.runtime?.logger.info(`[WalletService] Importing ${options.type} wallet`);
    
    if (options.type === 'mnemonic') {
      const account = mnemonicToAccount(options.secret);
      
      const walletAccount: WalletAccount = {
        address: account.address,
        type: 'hd',
        name: options.name || 'Imported Account',
        hdPath: "m/44'/60'/0'/0/0",
        createdAt: Date.now(),
      };
      
      this._state.accounts.push(walletAccount);
      this._state.currentAccount = walletAccount;
      this._state.isInitialized = true;
      this._state.isLocked = false;
      
      await this.initializeWalletClients(account.address, options.secret);
      
      return walletAccount;
    }
    
    if (options.type === 'private-key') {
      const account = privateKeyToAccount(options.secret as Hex);
      
      const walletAccount: WalletAccount = {
        address: account.address,
        type: 'private-key',
        name: options.name || 'Imported Account',
        createdAt: Date.now(),
      };
      
      this._state.accounts.push(walletAccount);
      this._state.currentAccount = walletAccount;
      this._state.isInitialized = true;
      this._state.isLocked = false;
      
      await this.initializeWalletClientsFromPrivateKey(options.secret as Hex);
      
      return walletAccount;
    }
    
    throw new Error(`Import type ${options.type} not supported`);
  }
  
  private async initializeWalletClients(_address: Address, mnemonic: string): Promise<void> {
    const account = mnemonicToAccount(mnemonic);
    
    for (const [chainId, chain] of Object.entries(SUPPORTED_CHAINS)) {
      const rpcUrl = this.getJejuRpcUrl(Number(chainId)) || chain.rpcUrls.default.http[0];
      
      const walletClient = createWalletClient({
        account,
        chain,
        transport: http(rpcUrl),
      });
      
      this._walletClients.set(Number(chainId), walletClient);
    }
  }
  
  private async initializeWalletClientsFromPrivateKey(privateKey: Hex): Promise<void> {
    const account = privateKeyToAccount(privateKey);
    
    for (const [chainId, chain] of Object.entries(SUPPORTED_CHAINS)) {
      const rpcUrl = this.getJejuRpcUrl(Number(chainId)) || chain.rpcUrls.default.http[0];
      
      const walletClient = createWalletClient({
        account,
        chain,
        transport: http(rpcUrl),
      });
      
      this._walletClients.set(Number(chainId), walletClient);
    }
  }
  
  async lock(): Promise<void> {
    this._state.isLocked = true;
    this._walletClients.clear();
    this.runtime?.logger.info('[WalletService] Wallet locked');
  }
  
  async unlock(_password: string): Promise<boolean> {
    // In production, verify password and decrypt keyring
    this._state.isLocked = false;
    this.runtime?.logger.info('[WalletService] Wallet unlocked');
    return true;
  }
  
  // ============================================================================
  // Balance & Token Management
  // ============================================================================
  
  async getBalances(chainId?: number): Promise<TokenBalance[]> {
    const account = this._state.currentAccount;
    if (!account) {
      throw new Error('No account selected');
    }
    
    const chains = chainId ? [chainId] : this._state.preferredChains;
    const balances: TokenBalance[] = [];
    
    for (const cid of chains) {
      const cacheKey = `${account.address}-${cid}`;
      const cached = this._balanceCache.get(cacheKey);
      
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        balances.push(...cached.balance);
        continue;
      }
      
      const chainBalances = await this.fetchChainBalances(account.address, cid);
      balances.push(...chainBalances);
      
      this._balanceCache.set(cacheKey, {
        balance: chainBalances,
        timestamp: Date.now(),
      });
    }
    
    return balances;
  }
  
  private async fetchChainBalances(address: Address, chainId: number): Promise<TokenBalance[]> {
    const publicClient = this.getPublicClient(chainId);
    const chain = SUPPORTED_CHAINS[chainId];
    
    const balances: TokenBalance[] = [];
    
    // Fetch native balance
    const nativeBalance = await publicClient.getBalance({ address });
    
    balances.push({
      token: {
        chainId,
        address: '0x0000000000000000000000000000000000000000' as Address,
        symbol: chain.nativeCurrency.symbol,
        name: chain.nativeCurrency.name,
        decimals: chain.nativeCurrency.decimals,
        isNative: true,
      },
      balance: nativeBalance,
      balanceFormatted: formatEther(nativeBalance),
    });
    
    return balances;
  }
  
  async getPortfolio(): Promise<PortfolioSummary> {
    const balances = await this.getBalances();
    
    const balancesByChain = new Map<number, TokenBalance[]>();
    let totalValueUsd = 0;
    
    for (const balance of balances) {
      const chainId = balance.token.chainId;
      if (!balancesByChain.has(chainId)) {
        balancesByChain.set(chainId, []);
      }
      balancesByChain.get(chainId)?.push(balance);
      
      if (balance.valueUsd) {
        totalValueUsd += balance.valueUsd;
      }
    }
    
    const topTokens = balances
      .filter(b => b.valueUsd)
      .sort((a, b) => (b.valueUsd || 0) - (a.valueUsd || 0))
      .slice(0, 10);
    
    return {
      totalValueUsd,
      balancesByChain,
      topTokens,
    };
  }
  
  // ============================================================================
  // Transaction Management
  // ============================================================================
  
  async sendTransaction(options: {
    chainId: number;
    to: Address;
    value?: bigint;
    data?: Hex;
    gasLimit?: bigint;
  }): Promise<Hex> {
    const walletClient = this.getWalletClient(options.chainId);
    if (!walletClient) {
      throw new Error('Wallet not unlocked');
    }
    
    this.runtime?.logger.info(`[WalletService] Sending transaction on chain ${options.chainId}`);
    
    const chain = SUPPORTED_CHAINS[options.chainId];
    
    const hash = await walletClient.sendTransaction({
      account: walletClient.account!,
      chain,
      to: options.to,
      value: options.value || BigInt(0),
      data: options.data,
      gas: options.gasLimit,
    });
    
    this.runtime?.logger.info(`[WalletService] Transaction sent: ${hash}`);
    
    return hash;
  }
  
  async signMessage(message: string): Promise<Hex> {
    const walletClient = this.getWalletClient(this._state.activeChainId);
    if (!walletClient) {
      throw new Error('Wallet not unlocked');
    }
    
    if (!this._state.currentAccount) {
      throw new Error('No account selected');
    }
    
    this.runtime?.logger.info(`[WalletService] Signing message`);
    
    const signature = await walletClient.signMessage({
      account: walletClient.account!,
      message,
    });
    
    return signature;
  }
  
  async signTypedData(typedData: {
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<Hex> {
    const walletClient = this.getWalletClient(this._state.activeChainId);
    if (!walletClient) {
      throw new Error('Wallet not unlocked');
    }
    
    this.runtime?.logger.info(`[WalletService] Signing typed data`);
    
    const signature = await walletClient.signTypedData({
      account: walletClient.account!,
      domain: typedData.domain as Parameters<typeof walletClient.signTypedData>[0]['domain'],
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });
    
    return signature;
  }
  
  // ============================================================================
  // Transaction Simulation
  // ============================================================================
  
  async simulateTransaction(options: {
    chainId: number;
    to: Address;
    value?: bigint;
    data?: Hex;
    from?: Address;
  }): Promise<SimulationResult> {
    const publicClient = this.getPublicClient(options.chainId);
    const account = this._state.currentAccount;
    
    const from = options.from || account?.address;
    if (!from) {
      throw new Error('No account for simulation');
    }
    
    this.runtime?.logger.info(`[WalletService] Simulating transaction`);
    
    // Use eth_call for simulation
    await publicClient.call({
      account: from,
      to: options.to,
      value: options.value,
      data: options.data,
    });
    
    return {
      success: true,
      gasUsed: BigInt(0),
      balanceChanges: [],
      approvalChanges: [],
      nftTransfers: [],
      logs: [],
    };
  }
  
  // ============================================================================
  // View Mode Management
  // ============================================================================
  
  setViewMode(mode: 'simple' | 'advanced'): void {
    this._state.viewMode = mode;
    this.runtime?.logger.info(`[WalletService] View mode changed to: ${mode}`);
  }
  
  getViewMode(): 'simple' | 'advanced' {
    return this._state.viewMode;
  }
}

export default WalletService;
