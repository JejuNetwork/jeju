/**
 * Mempool Streaming - Real-time pending transaction monitoring
 * 
 * Supports multiple providers for redundancy and coverage:
 * - Alchemy pending transactions API
 * - Direct node WebSocket subscriptions
 * - Bloxroute (when API key provided)
 */

import { EventEmitter } from 'events';
import type { ChainId } from '../autocrat-types';

export interface MempoolTransaction {
  hash: string;
  from: string;
  to: string;
  value: bigint;
  gasPrice: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  gas: bigint;
  input: string;
  nonce: number;
  chainId: ChainId;
  receivedAt: number;
  source: 'alchemy' | 'bloxroute' | 'websocket' | 'direct';
}

export interface MempoolConfig {
  chainId: ChainId;
  alchemyApiKey?: string;
  bloxrouteApiKey?: string;
  wsUrl?: string;
  httpUrl?: string;
}

// Known DEX router addresses to filter for
const DEX_ROUTERS: Record<number, string[]> = {
  1: [ // Ethereum Mainnet
    '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Uniswap V2 Router
    '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Uniswap V3 Router
    '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', // Uniswap V3 Router 02
    '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD', // Universal Router
    '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F', // SushiSwap Router
    '0xDef1C0ded9bec7F1a1670819833240f027b25EfF', // 0x Exchange Proxy
  ],
  42161: [ // Arbitrum
    '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', // SushiSwap
    '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Uniswap V3
    '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', // Uniswap V3 Router 02
    '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24', // Uniswap Universal Router
    '0xc873fEcbd354f5A56E00E710B90EF4201db2448d', // Camelot Router
  ],
  10: [ // Optimism
    '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Uniswap V3
    '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', // Uniswap V3 Router 02
    '0xb555edF5dcF85f42cEeF1f3630a52A108E55A654', // Velodrome Router
  ],
  8453: [ // Base
    '0x2626664c2603336E57B271c5C0b26F421741e481', // Uniswap V3 Router 02
    '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD', // Universal Router
    '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43', // Aerodrome Router
  ],
  1337: [ // Localnet
    '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Test router
  ],
};

// Swap function selectors to identify swap transactions
const SWAP_SELECTORS = new Set([
  // Uniswap V2
  '0x38ed1739', // swapExactTokensForTokens
  '0x8803dbee', // swapTokensForExactTokens  
  '0x7ff36ab5', // swapExactETHForTokens
  '0x4a25d94a', // swapTokensForExactETH
  '0x18cbafe5', // swapExactTokensForETH
  '0xfb3bdb41', // swapETHForExactTokens
  // Uniswap V3
  '0x414bf389', // exactInputSingle
  '0xc04b8d59', // exactInput
  '0xdb3e2198', // exactOutputSingle
  '0xf28c0498', // exactOutput
  // Universal Router
  '0x3593564c', // execute
  '0x24856bc3', // execute (alternate)
  // 0x
  '0xd9627aa4', // sellToUniswap
  '0x415565b0', // transformERC20
]);

export class MempoolStreamer extends EventEmitter {
  private configs: Map<ChainId, MempoolConfig> = new Map();
  private wsConnections: Map<ChainId, WebSocket> = new Map();
  private alchemyConnections: Map<ChainId, WebSocket> = new Map();
  private seenTxs: Set<string> = new Set();
  private running = false;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  // Stats
  private stats = {
    totalReceived: 0,
    swapTxsDetected: 0,
    duplicatesFiltered: 0,
    lastTxTime: 0,
  };

  constructor() {
    super();
  }

  /**
   * Add a chain to monitor
   */
  addChain(config: MempoolConfig): void {
    this.configs.set(config.chainId, config);
  }

  /**
   * Start streaming mempool transactions
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log('🔮 Starting mempool streaming...');

    for (const [chainId, config] of this.configs) {
      await this.startChainStream(chainId, config);
    }

    // Cleanup seen txs periodically to prevent memory leak
    this.cleanupInterval = setInterval(() => {
      if (this.seenTxs.size > 100000) {
        const toKeep = Array.from(this.seenTxs).slice(-50000);
        this.seenTxs = new Set(toKeep);
      }
    }, 60000);

    console.log(`   Streaming from ${this.configs.size} chains`);
  }

  /**
   * Stop streaming
   */
  stop(): void {
    this.running = false;

    for (const ws of this.wsConnections.values()) {
      ws.close();
    }
    this.wsConnections.clear();

    for (const ws of this.alchemyConnections.values()) {
      ws.close();
    }
    this.alchemyConnections.clear();

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get streaming statistics
   */
  getStats(): typeof this.stats {
    return { ...this.stats };
  }

  // ============ Private Methods ============

  private async startChainStream(chainId: ChainId, config: MempoolConfig): Promise<void> {
    // Try Alchemy first (best coverage)
    if (config.alchemyApiKey) {
      await this.startAlchemyStream(chainId, config.alchemyApiKey);
    }

    // Also connect to direct WebSocket if available
    if (config.wsUrl) {
      await this.startWebSocketStream(chainId, config.wsUrl);
    }
  }

  private async startAlchemyStream(chainId: ChainId, apiKey: string): Promise<void> {
    const networkMap: Partial<Record<ChainId, string>> = {
      1: 'eth-mainnet',
      42161: 'arb-mainnet',
      10: 'opt-mainnet',
      8453: 'base-mainnet',
      11155111: 'eth-sepolia',
    };

    const network = networkMap[chainId];
    if (!network) {
      console.log(`   Alchemy not available for chain ${chainId}`);
      return;
    }

    const wsUrl = `wss://${network}.g.alchemy.com/v2/${apiKey}`;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log(`   ✓ Alchemy connected (chain ${chainId})`);

      // Subscribe to pending transactions
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_subscribe',
        params: ['alchemy_pendingTransactions', {
          toAddress: DEX_ROUTERS[chainId] || [],
          hashesOnly: false,
        }],
      }));
    };

    ws.onmessage = (event) => {
      this.handleAlchemyMessage(chainId, event.data as string);
    };

    ws.onerror = (error) => {
      console.error(`   Alchemy error (chain ${chainId}):`, error);
    };

    ws.onclose = () => {
      console.log(`   Alchemy disconnected (chain ${chainId})`);
      // Reconnect after delay
      if (this.running) {
        setTimeout(() => this.startAlchemyStream(chainId, apiKey), 5000);
      }
    };

    this.alchemyConnections.set(chainId, ws);
  }

  private async startWebSocketStream(chainId: ChainId, wsUrl: string): Promise<void> {
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log(`   ✓ WebSocket connected (chain ${chainId})`);

      // Subscribe to pending transactions
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_subscribe',
        params: ['newPendingTransactions'],
      }));
    };

    ws.onmessage = async (event) => {
      await this.handleWebSocketMessage(chainId, wsUrl, event.data as string);
    };

    ws.onerror = (error) => {
      console.error(`   WebSocket error (chain ${chainId}):`, error);
    };

    ws.onclose = () => {
      console.log(`   WebSocket disconnected (chain ${chainId})`);
      if (this.running) {
        setTimeout(() => this.startWebSocketStream(chainId, wsUrl), 5000);
      }
    };

    this.wsConnections.set(chainId, ws);
  }

  private handleAlchemyMessage(chainId: ChainId, data: string): void {
    try {
      const message = JSON.parse(data) as {
        method?: string;
        params?: {
          result?: {
            hash: string;
            from: string;
            to: string;
            value: string;
            gasPrice?: string;
            maxFeePerGas?: string;
            maxPriorityFeePerGas?: string;
            gas: string;
            input: string;
            nonce: string;
          };
        };
      };

      if (message.method !== 'eth_subscription' || !message.params?.result) return;

      const tx = message.params.result;
      this.processPendingTx(chainId, tx, 'alchemy');
    } catch {
      // Ignore parse errors
    }
  }

  private async handleWebSocketMessage(chainId: ChainId, wsUrl: string, data: string): Promise<void> {
    try {
      const message = JSON.parse(data) as {
        method?: string;
        params?: {
          result?: string;
        };
      };

      if (message.method !== 'eth_subscription' || !message.params?.result) return;

      const txHash = message.params.result;

      // Need to fetch full transaction - this adds latency but WebSocket only gives hash
      const txData = await this.fetchTransaction(wsUrl.replace('wss://', 'https://').replace('ws://', 'http://'), txHash);
      if (txData) {
        this.processPendingTx(chainId, txData, 'websocket');
      }
    } catch {
      // Ignore errors
    }
  }

  private async fetchTransaction(
    httpUrl: string,
    txHash: string
  ): Promise<{
    hash: string;
    from: string;
    to: string;
    value: string;
    gasPrice?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    gas: string;
    input: string;
    nonce: string;
  } | null> {
    try {
      const response = await fetch(httpUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getTransactionByHash',
          params: [txHash],
        }),
      });

      const result = await response.json() as {
        result?: {
          hash: string;
          from: string;
          to: string;
          value: string;
          gasPrice?: string;
          maxFeePerGas?: string;
          maxPriorityFeePerGas?: string;
          gas: string;
          input: string;
          nonce: string;
        };
      };

      return result.result || null;
    } catch {
      return null;
    }
  }

  private processPendingTx(
    chainId: ChainId,
    tx: {
      hash: string;
      from: string;
      to: string;
      value: string;
      gasPrice?: string;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
      gas: string;
      input: string;
      nonce: string;
    },
    source: 'alchemy' | 'bloxroute' | 'websocket' | 'direct'
  ): void {
    this.stats.totalReceived++;

    // Deduplicate
    if (this.seenTxs.has(tx.hash)) {
      this.stats.duplicatesFiltered++;
      return;
    }
    this.seenTxs.add(tx.hash);

    // Filter for swap transactions
    if (!tx.to || !tx.input || tx.input.length < 10) return;

    const selector = tx.input.slice(0, 10);
    if (!SWAP_SELECTORS.has(selector)) return;

    // Check if to address is a known router
    const routers = DEX_ROUTERS[chainId] || [];
    const isKnownRouter = routers.some(r => r.toLowerCase() === tx.to.toLowerCase());
    if (!isKnownRouter && routers.length > 0) return;

    this.stats.swapTxsDetected++;
    this.stats.lastTxTime = Date.now();

    const mempoolTx: MempoolTransaction = {
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: BigInt(tx.value || '0'),
      gasPrice: BigInt(tx.gasPrice || tx.maxFeePerGas || '0'),
      maxFeePerGas: tx.maxFeePerGas ? BigInt(tx.maxFeePerGas) : undefined,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? BigInt(tx.maxPriorityFeePerGas) : undefined,
      gas: BigInt(tx.gas || '0'),
      input: tx.input,
      nonce: parseInt(tx.nonce, 16),
      chainId,
      receivedAt: Date.now(),
      source,
    };

    this.emit('pendingSwap', mempoolTx);
  }
}

/**
 * Create a mempool streamer with common configurations
 */
export function createMempoolStreamer(
  chainConfigs: Array<{ chainId: ChainId; wsUrl?: string }>,
  alchemyApiKey?: string
): MempoolStreamer {
  const streamer = new MempoolStreamer();

  for (const config of chainConfigs) {
    streamer.addChain({
      chainId: config.chainId,
      wsUrl: config.wsUrl,
      alchemyApiKey,
    });
  }

  return streamer;
}
