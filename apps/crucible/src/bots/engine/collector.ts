import { createPublicClient, http, webSocket, type PublicClient, type Chain, parseAbiItem, type Log, decodeEventLog } from 'viem';
import { mainnet, arbitrum, optimism, base, bsc, sepolia } from 'viem/chains';
import { EventEmitter } from 'events';
import type { ChainConfig, ChainId, Pool, Token } from '../autocrat-types';
import { XLP_V2_PAIR_ABI, XLP_V2_FACTORY_ABI } from '../lib/contracts';

export interface PendingTransaction {
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
}

export interface SwapEvent {
  poolAddress: string;
  sender: string;
  recipient: string;
  amount0In: bigint;
  amount1In: bigint;
  amount0Out: bigint;
  amount1Out: bigint;
  blockNumber: bigint;
  transactionHash: string;
  chainId: ChainId;
}

export interface SyncEvent {
  poolAddress: string;
  reserve0: bigint;
  reserve1: bigint;
  blockNumber: bigint;
  chainId: ChainId;
}

export interface BlockEvent {
  number: bigint;
  hash: string;
  timestamp: bigint;
  baseFeePerGas?: bigint;
  gasLimit: bigint;
  gasUsed: bigint;
  chainId: ChainId;
}

const CHAIN_DEFS: Record<number, Chain> = {
  1: mainnet,
  42161: arbitrum,
  10: optimism,
  8453: base,
  56: bsc,
  11155111: sepolia,
};

// Custom chain for network
const jejuChain: Chain = {
  id: 420691,
  name: 'Network',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.jeju.network'] },
  },
};

const jejuTestnet: Chain = {
  id: 420690,
  name: 'Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet-rpc.jeju.network'] },
  },
};

const localnet: Chain = {
  id: 1337,
  name: 'Localnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['http://localhost:8545'] },
  },
};

// ============ Event Signatures ============

const SWAP_EVENT = parseAbiItem(
  'event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)'
);

const SYNC_EVENT = parseAbiItem('event Sync(uint112 reserve0, uint112 reserve1)');

// ============ Collector Class ============

export class EventCollector extends EventEmitter {
  private clients: Map<ChainId, PublicClient> = new Map();
  private wsClients: Map<ChainId, PublicClient> = new Map();
  private pools: Map<string, Pool> = new Map(); // address -> Pool
  private running = false;
  private unwatchers: Array<() => void> = [];

  constructor(private configs: ChainConfig[]) {
    super();
  }

  async initialize(): Promise<void> {
    console.log('📡 Initializing event collectors...');

    for (const config of this.configs) {
      const chainDef = this.getChainDef(config.chainId);

      // HTTP client for reads
      const httpClient = createPublicClient({
        chain: chainDef,
        transport: http(config.rpcUrl),
      });
      this.clients.set(config.chainId, httpClient);

      // WebSocket client for subscriptions (if available)
      if (config.wsUrl) {
        const wsClient = createPublicClient({
          chain: chainDef,
          transport: webSocket(config.wsUrl),
        });
        this.wsClients.set(config.chainId, wsClient);
      }

      console.log(`✓ Connected to ${config.name} (${config.chainId})`);
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log('👁️ Starting event collection...');

    for (const [chainId, client] of this.clients) {
      const unwatchBlocks = client.watchBlocks({
        onBlock: (block) => this.handleBlock(chainId, block),
        onError: (error) => console.error(`Block watch error on ${chainId}:`, error),
      });
      this.unwatchers.push(unwatchBlocks);

      this.watchPendingTxs(chainId, client);
    }

    await this.watchPoolEvents();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.unwatchers.forEach((unwatch) => unwatch());
    this.unwatchers = [];
    console.log('Event collection stopped');
  }

  /**
   * Register a pool to watch
   */
  registerPool(pool: Pool): void {
    this.pools.set(pool.address.toLowerCase(), pool);
  }

  /**
   * Get client for a chain
   */
  getClient(chainId: ChainId): PublicClient | undefined {
    return this.clients.get(chainId);
  }

  /**
   * Discover pools from factory - PARALLELIZED
   * 
   * Fetches pool data in batches for 10x faster discovery
   */
  async discoverPools(
    chainId: ChainId,
    factoryAddress: string,
    limit = 100
  ): Promise<Pool[]> {
    const client = this.clients.get(chainId);
    if (!client) return [];

    console.log(`   Discovering pools on chain ${chainId}...`);
    const startTime = Date.now();

    const pairsLength = await client.readContract({
      address: factoryAddress as `0x${string}`,
      abi: XLP_V2_FACTORY_ABI,
      functionName: 'allPairsLength',
    });

    const count = Math.min(Number(pairsLength), limit);
    const BATCH_SIZE = 20; // Process 20 pools in parallel

    const pools: Pool[] = [];

    // First, get all pair addresses in parallel batches
    const pairAddresses: string[] = [];
    for (let i = 0; i < count; i += BATCH_SIZE) {
      const batch = Array.from(
        { length: Math.min(BATCH_SIZE, count - i) },
        (_, j) => i + j
      );

      const addresses = await Promise.all(
        batch.map(idx =>
          client.readContract({
            address: factoryAddress as `0x${string}`,
            abi: XLP_V2_FACTORY_ABI,
            functionName: 'allPairs',
            args: [BigInt(idx)],
          })
        )
      );

      pairAddresses.push(...addresses);
    }

    // Then, get pool data in parallel batches
    for (let i = 0; i < pairAddresses.length; i += BATCH_SIZE) {
      const batch = pairAddresses.slice(i, i + BATCH_SIZE);

      const poolDataBatch = await Promise.all(
        batch.map(async (pairAddress) => {
          const [token0, token1, reserves] = await Promise.all([
            client.readContract({
              address: pairAddress as `0x${string}`,
              abi: XLP_V2_PAIR_ABI,
              functionName: 'token0',
            }),
            client.readContract({
              address: pairAddress as `0x${string}`,
              abi: XLP_V2_PAIR_ABI,
              functionName: 'token1',
            }),
            client.readContract({
              address: pairAddress as `0x${string}`,
              abi: XLP_V2_PAIR_ABI,
              functionName: 'getReserves',
            }),
          ]);

          return {
            address: pairAddress,
            token0,
            token1,
            reserves,
          };
        })
      );

      for (const data of poolDataBatch) {
        const pool: Pool = {
          address: data.address,
          type: 'XLP_V2',
          token0: { address: data.token0, symbol: '', decimals: 18, chainId },
          token1: { address: data.token1, symbol: '', decimals: 18, chainId },
          chainId,
          reserve0: data.reserves[0].toString(),
          reserve1: data.reserves[1].toString(),
          lastUpdate: Date.now(),
        };

        pools.push(pool);
        this.registerPool(pool);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`   Discovered ${pools.length} pools in ${duration}ms (${Math.round(pools.length / (duration / 1000))} pools/sec)`);
    return pools;
  }

  // ============ Private Methods ============

  private getChainDef(chainId: ChainId): Chain {
    if (chainId === 420691) return jejuChain;
    if (chainId === 420690) return jejuTestnet;
    if (chainId === 1337) return localnet;
    const chain = CHAIN_DEFS[chainId];
    if (!chain) throw new Error(`Unknown chain ID: ${chainId}`);
    return chain;
  }

  private handleBlock(chainId: ChainId, block: {
    number: bigint;
    hash: `0x${string}`;
    timestamp: bigint;
    baseFeePerGas?: bigint | null;
    gasLimit: bigint;
    gasUsed: bigint;
  }): void {
    const event: BlockEvent = {
      number: block.number,
      hash: block.hash,
      timestamp: block.timestamp,
      baseFeePerGas: block.baseFeePerGas ?? undefined,
      gasLimit: block.gasLimit,
      gasUsed: block.gasUsed,
      chainId,
    };

    this.emit('block', event);
  }

  private watchPendingTxs(chainId: ChainId, client: PublicClient): void {
    // Note: Not all RPC providers support pending tx subscriptions
    // This is best-effort
    const wsClient = this.wsClients.get(chainId);
    if (!wsClient) return;

    // Watch pending transactions via eth_subscribe
    // This requires WebSocket and node support
    wsClient.transport.subscribe({
      method: 'eth_subscribe',
      params: ['newPendingTransactions'],
      onData: async (txHash: string) => {
        const tx = await client.getTransaction({ hash: txHash as `0x${string}` });
        if (!tx) return;

        const pendingTx: PendingTransaction = {
          hash: tx.hash,
          from: tx.from,
          to: tx.to ?? '',
          value: tx.value,
          gasPrice: tx.gasPrice ?? 0n,
          maxFeePerGas: tx.maxFeePerGas,
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
          gas: tx.gas,
          input: tx.input,
          nonce: tx.nonce,
          chainId,
          receivedAt: Date.now(),
        };

        this.emit('pendingTx', pendingTx);
      },
      onError: () => {
        // Silently ignore - not all nodes support this
      },
    });
  }

  private async watchPoolEvents(): Promise<void> {
    for (const [chainId, client] of this.clients) {
      const chainPools = Array.from(this.pools.values())
        .filter((p) => p.chainId === chainId)
        .map((p) => p.address.toLowerCase() as `0x${string}`);

      if (chainPools.length === 0) continue;

      const unwatchSwaps = client.watchContractEvent({
        address: chainPools,
        abi: [SWAP_EVENT],
        eventName: 'Swap',
        onLogs: (logs) => this.handleSwapLogs(chainId, logs),
        onError: (error) => console.error(`Swap watch error on ${chainId}:`, error),
      });
      this.unwatchers.push(unwatchSwaps);

      const unwatchSyncs = client.watchContractEvent({
        address: chainPools,
        abi: [SYNC_EVENT],
        eventName: 'Sync',
        onLogs: (logs) => this.handleSyncLogs(chainId, logs),
        onError: (error) => console.error(`Sync watch error on ${chainId}:`, error),
      });
      this.unwatchers.push(unwatchSyncs);
    }
  }

  private handleSwapLogs(chainId: ChainId, logs: Log[]): void {
    for (const log of logs) {
      try {
        const decoded = decodeEventLog({
          abi: [SWAP_EVENT],
          data: log.data,
          topics: log.topics,
        });

        const event: SwapEvent = {
          poolAddress: log.address,
          sender: decoded.args.sender as string,
          recipient: decoded.args.to as string,
          amount0In: decoded.args.amount0In as bigint,
          amount1In: decoded.args.amount1In as bigint,
          amount0Out: decoded.args.amount0Out as bigint,
          amount1Out: decoded.args.amount1Out as bigint,
          blockNumber: log.blockNumber ?? 0n,
          transactionHash: log.transactionHash ?? '0x',
          chainId,
        };

        this.emit('swap', event);
      } catch (error) {
        console.warn('Failed to decode swap event', { error: String(error) });
      }
    }
  }

  private handleSyncLogs(chainId: ChainId, logs: Log[]): void {
    for (const log of logs) {
      try {
        const decoded = decodeEventLog({
          abi: [SYNC_EVENT],
          data: log.data,
          topics: log.topics,
        });

        const poolAddress = log.address.toLowerCase();
        const pool = this.pools.get(poolAddress);
        if (pool) {
          pool.reserve0 = (decoded.args.reserve0 as bigint).toString();
          pool.reserve1 = (decoded.args.reserve1 as bigint).toString();
          pool.lastUpdate = Date.now();
        }

        const event: SyncEvent = {
          poolAddress: log.address,
          reserve0: decoded.args.reserve0 as bigint,
          reserve1: decoded.args.reserve1 as bigint,
          blockNumber: log.blockNumber ?? 0n,
          chainId,
        };

        this.emit('sync', event);
      } catch (error) {
        console.warn('Failed to decode sync event', { error: String(error) });
      }
    }
  }
}
