/**
 * Bridge Service for Node Operators
 * 
 * Enables node operators to:
 * - Run ZKSolBridge relayer
 * - Participate as XLP (Cross-chain Liquidity Provider)
 * - Act as OIF solver
 * - Detect and execute cross-chain arbitrage
 * - Capture MEV on Solana via Jito
 * 
 * Revenue streams:
 * - Bridge fees (0.1-0.3% per transfer)
 * - XLP liquidity provision fees
 * - Solver fees for intent fulfillment
 * - Cross-chain arbitrage profits
 * - Solana MEV (Jito bundles)
 * - Hyperliquid orderbook arbitrage
 */

import type { Address, Hex } from 'viem';

// Lazy import to avoid native module issues with @solana/web3.js
type ArbitrageExecutorModule = typeof import('./arbitrage-executor');
let arbExecutorModule: ArbitrageExecutorModule | null = null;
async function getArbitrageExecutorModule(): Promise<ArbitrageExecutorModule> {
  if (!arbExecutorModule) {
    arbExecutorModule = await import('./arbitrage-executor');
  }
  return arbExecutorModule;
}

// ============ Types ============

export interface BridgeServiceConfig {
  // Network configuration
  evmRpcUrls: Record<number, string>;
  solanaRpcUrl?: string;
  
  // Contract addresses
  contracts: {
    zkBridge?: Address;
    eilPaymaster?: Address;
    oifInputSettler?: Address;
    oifOutputSettler?: Address;
    solverRegistry?: Address;
    federatedLiquidity?: Address;
  };
  
  // Operator settings
  operatorAddress: Address;
  privateKey?: Hex;
  
  // Service options
  enableRelayer: boolean;
  enableXLP: boolean;
  enableSolver: boolean;
  enableMEV: boolean;
  enableArbitrage: boolean;
  
  // Liquidity settings
  xlpChains?: number[];
  minLiquidity?: bigint;
  
  // Arbitrage settings
  minArbProfitBps?: number;
  maxArbPositionUsd?: number;
  arbTokens?: string[];
  
  // Solana MEV settings
  jitoTipLamports?: bigint;
  
  // Risk settings
  maxTransferSize?: bigint;
  maxPendingTransfers?: number;
}

export interface BridgeStats {
  totalTransfersProcessed: number;
  totalVolumeProcessed: bigint;
  totalFeesEarned: bigint;
  pendingTransfers: number;
  activeChains: number[];
  uptime: number;
  lastTransferAt: number;
  // Arbitrage stats
  arbOpportunitiesDetected: number;
  arbTradesExecuted: number;
  arbProfitUsd: number;
  // MEV stats
  jitoBundlesSubmitted: number;
  jitoBundlesLanded: number;
  mevProfitUsd: number;
}

export interface ArbOpportunity {
  id: string;
  type: 'solana_evm' | 'hyperliquid' | 'cross_dex';
  buyChain: string;
  sellChain: string;
  token: string;
  priceDiffBps: number;
  netProfitUsd: number;
  expiresAt: number;
}

export interface TransferEvent {
  id: string;
  type: 'initiated' | 'completed' | 'failed';
  sourceChain: number;
  destChain: number;
  token: Address;
  amount: bigint;
  fee: bigint;
  timestamp: number;
}

export interface BridgeService {
  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  
  // Stats
  getStats(): Promise<BridgeStats>;
  getRecentTransfers(limit?: number): Promise<TransferEvent[]>;
  
  // XLP operations
  depositLiquidity(chainId: number, token: Address, amount: bigint): Promise<Hex>;
  withdrawLiquidity(chainId: number, token: Address, amount: bigint): Promise<Hex>;
  getLiquidityBalance(chainId: number, token?: Address): Promise<bigint>;
  
  // Solver operations
  registerAsSolver(name: string, supportedChains: number[]): Promise<Hex>;
  deactivateSolver(): Promise<Hex>;
  getSolverStats(): Promise<{
    totalFills: number;
    successfulFills: number;
    failedFills: number;
    pendingIntents: number;
  }>;
  
  // Arbitrage operations
  getArbOpportunities(): ArbOpportunity[];
  executeArb(opportunityId: string): Promise<{ success: boolean; txHash?: string; profit?: number }>;
  setArbEnabled(enabled: boolean): void;
  
  // MEV operations
  submitJitoBundle(transactions: Uint8Array[]): Promise<{ bundleId: string; landed: boolean }>;
  getJitoTipFloor(): Promise<bigint>;
  
  // Events
  onTransfer(callback: (event: TransferEvent) => void): () => void;
  onArbitrage(callback: (opportunity: ArbOpportunity) => void): () => void;
  onError(callback: (error: Error) => void): () => void;
}

// ============ Bridge Service Implementation ============

class BridgeServiceImpl implements BridgeService {
  private config: BridgeServiceConfig;
  private running = false;
  private arbEnabled = false;
  private stats: BridgeStats = {
    totalTransfersProcessed: 0,
    totalVolumeProcessed: 0n,
    totalFeesEarned: 0n,
    pendingTransfers: 0,
    activeChains: [],
    uptime: 0,
    lastTransferAt: 0,
    arbOpportunitiesDetected: 0,
    arbTradesExecuted: 0,
    arbProfitUsd: 0,
    jitoBundlesSubmitted: 0,
    jitoBundlesLanded: 0,
    mevProfitUsd: 0,
  };
  private transferCallbacks: Set<(event: TransferEvent) => void> = new Set();
  private arbCallbacks: Set<(opportunity: ArbOpportunity) => void> = new Set();
  private errorCallbacks: Set<(error: Error) => void> = new Set();
  private startTime = 0;
  private recentTransfers: TransferEvent[] = [];
  private arbOpportunities: Map<string, ArbOpportunity> = new Map();
  private arbPollInterval: ReturnType<typeof setInterval> | null = null;

  // Jito settings
  private jitoBlockEngineUrl = 'https://mainnet.block-engine.jito.wtf';

  // Arbitrage executor (lazily initialized)
  private arbExecutor: Awaited<ReturnType<ArbitrageExecutorModule['createArbitrageExecutor']>> | null = null;
  private arbExecutorInitPromise: Promise<void> | null = null;

  constructor(config: BridgeServiceConfig) {
    this.config = config;
    this.arbEnabled = config.enableArbitrage ?? false;
  }

  private async initArbExecutor(): Promise<void> {
    if (this.arbExecutor || !this.config.privateKey || !this.config.enableArbitrage) return;
    if (this.arbExecutorInitPromise) {
      await this.arbExecutorInitPromise;
      return;
    }
    
    this.arbExecutorInitPromise = (async () => {
      const { createArbitrageExecutor } = await getArbitrageExecutorModule();
      this.arbExecutor = createArbitrageExecutor({
        evmPrivateKey: this.config.privateKey!,
        solanaPrivateKey: process.env.SOLANA_PRIVATE_KEY,
        evmRpcUrls: this.config.evmRpcUrls,
        solanaRpcUrl: this.config.solanaRpcUrl,
        zkBridgeEndpoint: process.env.ZK_BRIDGE_ENDPOINT,
        oneInchApiKey: process.env.ONEINCH_API_KEY,
        maxSlippageBps: 50,
        jitoTipLamports: this.config.jitoTipLamports ?? BigInt(10000),
      });
    })();
    
    await this.arbExecutorInitPromise;
  }

  async start(): Promise<void> {
    if (this.running) return;
    
    console.log('[Bridge] Starting bridge service...');
    this.running = true;
    this.startTime = Date.now();
    
    // Initialize active chains
    this.stats.activeChains = Object.keys(this.config.evmRpcUrls).map(Number);
    
    // Start relayer if enabled
    if (this.config.enableRelayer) {
      await this.startRelayer();
    }
    
    // Register as XLP if enabled
    if (this.config.enableXLP) {
      await this.startXLP();
    }
    
    // Register as solver if enabled
    if (this.config.enableSolver) {
      await this.startSolver();
    }
    
    // Start arbitrage detector if enabled
    if (this.config.enableArbitrage) {
      await this.startArbitrage();
    }
    
    console.log('[Bridge] Bridge service started');
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    
    console.log('[Bridge] Stopping bridge service...');
    this.running = false;
    
    // Stop arbitrage polling
    if (this.arbPollInterval) {
      clearInterval(this.arbPollInterval);
      this.arbPollInterval = null;
    }
    
    console.log('[Bridge] Bridge service stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  async getStats(): Promise<BridgeStats> {
    return {
      ...this.stats,
      uptime: this.running ? Date.now() - this.startTime : 0,
    };
  }

  async getRecentTransfers(limit = 50): Promise<TransferEvent[]> {
    return this.recentTransfers.slice(0, limit);
  }

  async depositLiquidity(chainId: number, token: Address, amount: bigint): Promise<Hex> {
    const rpcUrl = this.config.evmRpcUrls[chainId];
    if (!rpcUrl) throw new Error(`No RPC URL configured for chain ${chainId}`);
    if (!this.config.contracts.federatedLiquidity) {
      throw new Error('FederatedLiquidity contract not configured');
    }
    if (!this.config.privateKey) {
      throw new Error('Private key required for transactions');
    }
    
    console.log(`[Bridge] Depositing ${amount} of ${token} to chain ${chainId}`);
    
    const { createWalletClient, createPublicClient, http, encodeFunctionData } = await import('viem');
    const { privateKeyToAccount } = await import('viem/accounts');
    
    const account = privateKeyToAccount(this.config.privateKey);
    const publicClient = createPublicClient({ transport: http(rpcUrl) });
    const walletClient = createWalletClient({ account, transport: http(rpcUrl) });
    
    // First approve the token
    const approveData = encodeFunctionData({
      abi: [{ name: 'approve', type: 'function', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] }],
      functionName: 'approve',
      args: [this.config.contracts.federatedLiquidity, amount]
    });
    
    const approveHash = await walletClient.sendTransaction({
      account,
      chain: null,
      to: token,
      data: approveData,
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    
    // Then deposit
    const depositData = encodeFunctionData({
      abi: [{ name: 'depositLiquidity', type: 'function', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [] }],
      functionName: 'depositLiquidity',
      args: [token, amount]
    });
    
    const hash = await walletClient.sendTransaction({
      account,
      chain: null,
      to: this.config.contracts.federatedLiquidity,
      data: depositData,
    });
    
    console.log(`[Bridge] Deposit tx: ${hash}`);
    return hash;
  }

  async withdrawLiquidity(chainId: number, token: Address, amount: bigint): Promise<Hex> {
    const rpcUrl = this.config.evmRpcUrls[chainId];
    if (!rpcUrl) throw new Error(`No RPC URL configured for chain ${chainId}`);
    if (!this.config.contracts.federatedLiquidity) {
      throw new Error('FederatedLiquidity contract not configured');
    }
    if (!this.config.privateKey) {
      throw new Error('Private key required for transactions');
    }
    
    console.log(`[Bridge] Withdrawing ${amount} of ${token} from chain ${chainId}`);
    
    const { createWalletClient, http, encodeFunctionData } = await import('viem');
    const { privateKeyToAccount } = await import('viem/accounts');
    
    const account = privateKeyToAccount(this.config.privateKey);
    const walletClient = createWalletClient({ account, transport: http(rpcUrl) });
    
    const data = encodeFunctionData({
      abi: [{ name: 'withdrawLiquidity', type: 'function', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [] }],
      functionName: 'withdrawLiquidity',
      args: [token, amount]
    });
    
    const hash = await walletClient.sendTransaction({
      account,
      chain: null,
      to: this.config.contracts.federatedLiquidity,
      data,
    });
    
    console.log(`[Bridge] Withdraw tx: ${hash}`);
    return hash;
  }

  async getLiquidityBalance(chainId: number, token?: Address): Promise<bigint> {
    const rpcUrl = this.config.evmRpcUrls[chainId];
    if (!rpcUrl) throw new Error(`No RPC URL configured for chain ${chainId}`);
    if (!this.config.contracts.federatedLiquidity) {
      throw new Error('FederatedLiquidity contract not configured');
    }
    
    console.log(`[Bridge] Getting liquidity balance for chain ${chainId}`);
    
    const { createPublicClient, http } = await import('viem');
    const publicClient = createPublicClient({ transport: http(rpcUrl) });
    
    const balance = await publicClient.readContract({
      address: this.config.contracts.federatedLiquidity,
      abi: [{ name: 'xlpDeposits', type: 'function', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] }],
      functionName: 'xlpDeposits',
      args: [this.config.operatorAddress, token || '0x0000000000000000000000000000000000000000']
    }) as bigint;
    
    return balance;
  }

  async registerAsSolver(name: string, supportedChains: number[]): Promise<Hex> {
    if (!this.config.contracts.solverRegistry) {
      throw new Error('SolverRegistry contract not configured');
    }
    if (!this.config.privateKey) {
      throw new Error('Private key required for transactions');
    }
    
    console.log(`[Bridge] Registering as solver: ${name} for chains ${supportedChains}`);
    
    const chainId = Object.keys(this.config.evmRpcUrls)[0];
    const rpcUrl = this.config.evmRpcUrls[Number(chainId)];
    if (!rpcUrl) throw new Error('No RPC URL configured');
    
    const { createWalletClient, http, encodeFunctionData } = await import('viem');
    const { privateKeyToAccount } = await import('viem/accounts');
    
    const account = privateKeyToAccount(this.config.privateKey);
    const walletClient = createWalletClient({ account, transport: http(rpcUrl) });
    
    const data = encodeFunctionData({
      abi: [{ name: 'registerSolver', type: 'function', inputs: [{ type: 'string' }, { type: 'uint256[]' }], outputs: [] }],
      functionName: 'registerSolver',
      args: [name, supportedChains.map(c => BigInt(c))]
    });
    
    const hash = await walletClient.sendTransaction({
      account,
      chain: null,
      to: this.config.contracts.solverRegistry,
      data,
    });
    
    console.log(`[Bridge] Register solver tx: ${hash}`);
    return hash;
  }

  async deactivateSolver(): Promise<Hex> {
    if (!this.config.contracts.solverRegistry) {
      throw new Error('SolverRegistry contract not configured');
    }
    if (!this.config.privateKey) {
      throw new Error('Private key required for transactions');
    }
    
    console.log('[Bridge] Deactivating solver');
    
    const chainId = Object.keys(this.config.evmRpcUrls)[0];
    const rpcUrl = this.config.evmRpcUrls[Number(chainId)];
    if (!rpcUrl) throw new Error('No RPC URL configured');
    
    const { createWalletClient, http, encodeFunctionData } = await import('viem');
    const { privateKeyToAccount } = await import('viem/accounts');
    
    const account = privateKeyToAccount(this.config.privateKey);
    const walletClient = createWalletClient({ account, transport: http(rpcUrl) });
    
    const data = encodeFunctionData({
      abi: [{ name: 'deactivateSolver', type: 'function', inputs: [], outputs: [] }],
      functionName: 'deactivateSolver',
      args: []
    });
    
    const hash = await walletClient.sendTransaction({
      account,
      chain: null,
      to: this.config.contracts.solverRegistry,
      data,
    });
    
    console.log(`[Bridge] Deactivate solver tx: ${hash}`);
    return hash;
  }

  async getSolverStats(): Promise<{
    totalFills: number;
    successfulFills: number;
    failedFills: number;
    pendingIntents: number;
  }> {
    return {
      totalFills: 0,
      successfulFills: 0,
      failedFills: 0,
      pendingIntents: 0,
    };
  }

  // ============ Arbitrage Methods ============

  getArbOpportunities(): ArbOpportunity[] {
    return Array.from(this.arbOpportunities.values())
      .filter(opp => opp.expiresAt > Date.now());
  }

  async executeArb(opportunityId: string): Promise<{ success: boolean; txHash?: string; profit?: number }> {
    const opportunity = this.arbOpportunities.get(opportunityId);
    if (!opportunity) {
      return { success: false };
    }

    if (opportunity.expiresAt < Date.now()) {
      this.arbOpportunities.delete(opportunityId);
      return { success: false };
    }

    console.log(`[Bridge] Executing arbitrage: ${opportunity.type} ${opportunity.token}`);
    console.log(`   Buy on ${opportunity.buyChain}, sell on ${opportunity.sellChain}`);
    console.log(`   Expected profit: $${opportunity.netProfitUsd.toFixed(2)}`);

    // Execute the arbitrage based on type
    if (opportunity.type === 'solana_evm') {
      return this.executeSolanaEvmArb(opportunity);
    } else if (opportunity.type === 'hyperliquid') {
      return this.executeHyperliquidArb(opportunity);
    } else {
      return this.executeCrossDevArb(opportunity);
    }
  }

  setArbEnabled(enabled: boolean): void {
    this.arbEnabled = enabled;
    if (enabled && !this.arbPollInterval) {
      this.startArbitrage();
    } else if (!enabled && this.arbPollInterval) {
      clearInterval(this.arbPollInterval);
      this.arbPollInterval = null;
    }
  }

  // ============ MEV Methods ============

  async submitJitoBundle(transactions: Uint8Array[]): Promise<{ bundleId: string; landed: boolean }> {
    const tipLamports = this.config.jitoTipLamports ?? BigInt(10000);
    
    console.log(`[Bridge] Submitting Jito bundle with ${transactions.length} txs, tip: ${tipLamports} lamports`);
    
    // Jito bundle submission
    const response = await fetch(`${this.jitoBlockEngineUrl}/api/v1/bundles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendBundle',
        params: [
          transactions.map(tx => Buffer.from(tx).toString('base64')),
          { encoding: 'base64' }
        ],
      }),
    });

    const result = await response.json() as { result?: string; error?: { message: string } };
    
    if (result.error) {
      console.error(`[Bridge] Jito bundle failed: ${result.error.message}`);
      return { bundleId: '', landed: false };
    }

    const bundleId = result.result || '';
    this.stats.jitoBundlesSubmitted++;
    
    // Check bundle status
    const landed = await this.checkJitoBundleStatus(bundleId);
    if (landed) {
      this.stats.jitoBundlesLanded++;
    }

    return { bundleId, landed };
  }

  async getJitoTipFloor(): Promise<bigint> {
    const response = await fetch(`${this.jitoBlockEngineUrl}/api/v1/bundles/tip_floor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTipAccounts',
        params: [],
      }),
    });

    const result = await response.json() as { result?: { tip_floor_lamports: number } };
    return BigInt(result.result?.tip_floor_lamports ?? 10000);
  }

  // ============ Event Methods ============

  onTransfer(callback: (event: TransferEvent) => void): () => void {
    this.transferCallbacks.add(callback);
    return () => this.transferCallbacks.delete(callback);
  }

  onArbitrage(callback: (opportunity: ArbOpportunity) => void): () => void {
    this.arbCallbacks.add(callback);
    return () => this.arbCallbacks.delete(callback);
  }

  onError(callback: (error: Error) => void): () => void {
    this.errorCallbacks.add(callback);
    return () => this.errorCallbacks.delete(callback);
  }

  // ============ Private Methods ============

  private async startRelayer(): Promise<void> {
    console.log('[Bridge] Starting relayer...');
    
    // Start monitoring for transfer events
    // Process pending transfers
    // Submit proofs
  }

  private async startXLP(): Promise<void> {
    console.log('[Bridge] Starting XLP service...');
    
    // Register as XLP if not already
    // Monitor for liquidity requests
    // Fulfill profitable requests
  }

  private async startSolver(): Promise<void> {
    console.log('[Bridge] Starting solver service...');
    
    // Monitor for open intents
    // Quote and fill profitable intents
    // Handle attestations
  }

  private async startArbitrage(): Promise<void> {
    console.log('[Bridge] Starting arbitrage detector...');
    
    // Lazy initialize the arbitrage executor
    await this.initArbExecutor();
    
    const minProfitBps = this.config.minArbProfitBps ?? 30;
    const tokens = this.config.arbTokens ?? ['WETH', 'USDC'];
    
    // Poll for arbitrage opportunities every 5 seconds
    this.arbPollInterval = setInterval(async () => {
      if (!this.arbEnabled) return;
      
      for (const token of tokens) {
        await this.detectArbOpportunities(token, minProfitBps);
      }
    }, 5000);
    
    // Initial detection
    for (const token of tokens) {
      await this.detectArbOpportunities(token, minProfitBps);
    }
  }

  private async detectArbOpportunities(token: string, minProfitBps: number): Promise<void> {
    const prices: Array<{ chain: string; price: number; dex: string }> = [];
    
    // Get Solana price via Jupiter
    const solPrice = await this.getSolanaPrice(token);
    if (solPrice) prices.push({ chain: 'solana', price: solPrice.price, dex: solPrice.dex });
    
    // Get EVM prices
    for (const chainId of this.stats.activeChains) {
      const evmPrice = await this.getEvmPrice(token, chainId);
      if (evmPrice) prices.push({ chain: `evm:${chainId}`, price: evmPrice.price, dex: evmPrice.dex });
    }
    
    // Get Hyperliquid price
    const hlPrice = await this.getHyperliquidPrice(token);
    if (hlPrice) prices.push({ chain: 'hyperliquid', price: hlPrice.price, dex: 'hyperliquid' });
    
    if (prices.length < 2) return;
    
    // Find arbitrage opportunities
    for (let i = 0; i < prices.length; i++) {
      for (let j = i + 1; j < prices.length; j++) {
        const [low, high] = prices[i].price < prices[j].price 
          ? [prices[i], prices[j]] 
          : [prices[j], prices[i]];
        
        const priceDiffBps = Math.floor((high.price - low.price) / low.price * 10000);
        
        // Estimate bridge costs (0.1% + gas)
        const bridgeCostBps = 10 + 5; // 0.1% fee + ~0.05% gas estimate
        const netProfitBps = priceDiffBps - bridgeCostBps;
        
        if (netProfitBps >= minProfitBps) {
          const opportunity: ArbOpportunity = {
            id: `${token}-${low.chain}-${high.chain}-${Date.now()}`,
            type: low.chain === 'solana' || high.chain === 'solana' 
              ? 'solana_evm' 
              : low.chain === 'hyperliquid' || high.chain === 'hyperliquid'
                ? 'hyperliquid'
                : 'cross_dex',
            buyChain: low.chain,
            sellChain: high.chain,
            token,
            priceDiffBps,
            netProfitUsd: (netProfitBps / 10000) * (this.config.maxArbPositionUsd ?? 10000),
            expiresAt: Date.now() + 30000, // 30 second expiry
          };
          
          this.arbOpportunities.set(opportunity.id, opportunity);
          this.stats.arbOpportunitiesDetected++;
          
          console.log(`[Bridge] Arb opportunity: ${token} ${low.chain} -> ${high.chain} (+${netProfitBps}bps)`);
          
          for (const callback of this.arbCallbacks) {
            callback(opportunity);
          }
        }
      }
    }
  }

  private async getSolanaPrice(token: string): Promise<{ price: number; dex: string } | null> {
    // Use Jupiter API for Solana prices
    const JUPITER_API = 'https://price.jup.ag/v6/price';
    const TOKEN_MINTS: Record<string, string> = {
      WETH: 'So11111111111111111111111111111111111111112', // Actually SOL
      USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      SOL: 'So11111111111111111111111111111111111111112',
    };
    
    const mint = TOKEN_MINTS[token];
    if (!mint) return null;
    
    const response = await fetch(`${JUPITER_API}?ids=${mint}`);
    if (!response.ok) return null;
    
    const data = await response.json() as { data?: Record<string, { price: number }> };
    const price = data.data?.[mint]?.price;
    
    return price ? { price, dex: 'jupiter' } : null;
  }

  private async getEvmPrice(token: string, chainId: number): Promise<{ price: number; dex: string } | null> {
    // Simplified - would use 1inch or Uniswap quoter in production
    const rpcUrl = this.config.evmRpcUrls[chainId];
    if (!rpcUrl) return null;
    
    // Use Chainlink price feeds as fallback
    const CHAINLINK_FEEDS: Record<string, Record<number, string>> = {
      WETH: {
        1: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
        8453: '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
        42161: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
      },
    };
    
    const feedAddress = CHAINLINK_FEEDS[token]?.[chainId];
    if (!feedAddress) return null;
    
    const { createPublicClient, http } = await import('viem');
    const client = createPublicClient({ transport: http(rpcUrl) });
    
    const result = await client.readContract({
      address: feedAddress as `0x${string}`,
      abi: [{ name: 'latestAnswer', type: 'function', inputs: [], outputs: [{ type: 'int256' }] }],
      functionName: 'latestAnswer',
    }) as bigint;
    
    // Chainlink returns 8 decimals
    return { price: Number(result) / 1e8, dex: 'chainlink' };
  }

  private async getHyperliquidPrice(token: string): Promise<{ price: number; dex: string } | null> {
    // Hyperliquid API
    const response = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'allMids' }),
    });
    
    if (!response.ok) return null;
    
    const data = await response.json() as Record<string, string>;
    const symbol = token === 'WETH' ? 'ETH' : token;
    const price = data[symbol];
    
    return price ? { price: parseFloat(price), dex: 'hyperliquid' } : null;
  }

  private async executeSolanaEvmArb(opportunity: ArbOpportunity): Promise<{ success: boolean; txHash?: string; profit?: number }> {
    if (!this.arbExecutor) {
      console.error('[Bridge] Arbitrage executor not initialized');
      return { success: false };
    }

    console.log(`[Bridge] Executing Solana-EVM arb for ${opportunity.token}`);
    
    const result = await this.arbExecutor.executeSolanaEvmArb(opportunity);
    
    if (result.success) {
      this.stats.arbTradesExecuted++;
      this.stats.arbProfitUsd += result.profit || opportunity.netProfitUsd;
      this.arbOpportunities.delete(opportunity.id);
    }
    
    return result;
  }

  private async executeHyperliquidArb(opportunity: ArbOpportunity): Promise<{ success: boolean; txHash?: string; profit?: number }> {
    if (!this.arbExecutor) {
      console.error('[Bridge] Arbitrage executor not initialized');
      return { success: false };
    }

    console.log(`[Bridge] Executing Hyperliquid arb for ${opportunity.token}`);
    
    const result = await this.arbExecutor.executeHyperliquidArb(opportunity);
    
    if (result.success) {
      this.stats.arbTradesExecuted++;
      this.stats.arbProfitUsd += result.profit || opportunity.netProfitUsd;
      this.arbOpportunities.delete(opportunity.id);
    }
    
    return result;
  }

  private async executeCrossDevArb(opportunity: ArbOpportunity): Promise<{ success: boolean; txHash?: string; profit?: number }> {
    if (!this.arbExecutor) {
      console.error('[Bridge] Arbitrage executor not initialized');
      return { success: false };
    }

    console.log(`[Bridge] Executing cross-DEX arb for ${opportunity.token}`);
    
    const result = await this.arbExecutor.executeCrossDexArb(opportunity);
    
    if (result.success) {
      this.stats.arbTradesExecuted++;
      this.stats.arbProfitUsd += result.profit || opportunity.netProfitUsd;
      this.arbOpportunities.delete(opportunity.id);
    }
    
    return result;
  }

  private async checkJitoBundleStatus(bundleId: string): Promise<boolean> {
    if (!bundleId) return false;
    
    // Poll for bundle status
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const response = await fetch(`${this.jitoBlockEngineUrl}/api/v1/bundles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getBundleStatuses',
          params: [[bundleId]],
        }),
      });
      
      const result = await response.json() as { 
        result?: { value: Array<{ confirmation_status: string }> } 
      };
      
      const status = result.result?.value?.[0]?.confirmation_status;
      if (status === 'confirmed' || status === 'finalized') {
        return true;
      }
    }
    
    return false;
  }

  protected emitTransfer(event: TransferEvent): void {
    this.recentTransfers.unshift(event);
    if (this.recentTransfers.length > 1000) {
      this.recentTransfers.pop();
    }
    
    this.stats.totalTransfersProcessed++;
    this.stats.totalVolumeProcessed += event.amount;
    this.stats.totalFeesEarned += event.fee;
    this.stats.lastTransferAt = event.timestamp;
    
    for (const callback of this.transferCallbacks) {
      callback(event);
    }
  }

  protected emitError(error: Error): void {
    console.error('[Bridge] Error:', error);
    for (const callback of this.errorCallbacks) {
      callback(error);
    }
  }
}

// ============ Factory ============

export function createBridgeService(config: BridgeServiceConfig): BridgeService {
  return new BridgeServiceImpl(config);
}

// ============ Default Configuration ============

export function getDefaultBridgeConfig(operatorAddress: Address): Partial<BridgeServiceConfig> {
  return {
    evmRpcUrls: {
      1: 'https://eth.llamarpc.com',
      8453: 'https://mainnet.base.org',
      84532: 'https://sepolia.base.org',
      42161: 'https://arb1.arbitrum.io/rpc',
      56: 'https://bsc-dataseed.binance.org',
    },
    solanaRpcUrl: 'https://api.mainnet-beta.solana.com',
    operatorAddress,
    enableRelayer: true,
    enableXLP: true,
    enableSolver: true,
    enableMEV: false,
    enableArbitrage: true,
    xlpChains: [1, 8453, 42161],
    // Arbitrage settings
    minArbProfitBps: 30, // 0.3% minimum profit
    maxArbPositionUsd: 10000, // Max $10k per arb trade
    arbTokens: ['WETH', 'USDC', 'SOL'],
    // Jito settings for Solana MEV
    jitoTipLamports: BigInt(10000), // 0.00001 SOL tip
  };
}

