import { createPublicClient, http, type Address, parseEther, formatEther } from 'viem';
import { getRpcUrl, JEJU_CHAIN_ID } from '../config/networks.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
const MAX_POOLS_TO_FETCH = 100;

// Chainlink ETH/USD feeds (mainnet only - Jeju uses Ethereum price as proxy)
const CHAINLINK_ETH_USD_FEEDS: Record<number, Address> = {
  1: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419' as Address,
  42161: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612' as Address,
  10: '0x13e3Ee699D1909E989722E753853AE30b17e08c5' as Address,
};

const CHAINLINK_ABI = [
  {
    inputs: [],
    name: 'latestRoundData',
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const V2_FACTORY_ABI = [
  { inputs: [{ name: 'tokenA', type: 'address' }, { name: 'tokenB', type: 'address' }], name: 'getPair', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'allPairsLength', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'index', type: 'uint256' }], name: 'allPairs', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
] as const;

// V2 Pair ABI (minimal)
const V2_PAIR_ABI = [
  { inputs: [], name: 'getReserves', outputs: [{ name: 'reserve0', type: 'uint112' }, { name: 'reserve1', type: 'uint112' }, { name: 'blockTimestampLast', type: 'uint32' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'token0', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'token1', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'totalSupply', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const;

const V3_FACTORY_ABI = [
  { inputs: [{ name: 'tokenA', type: 'address' }, { name: 'tokenB', type: 'address' }, { name: 'fee', type: 'uint24' }], name: 'getPool', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'allPoolsLength', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const;

// V3 Pool ABI (minimal)
const V3_POOL_ABI = [
  { inputs: [], name: 'slot0', outputs: [{ name: 'sqrtPriceX96', type: 'uint160' }, { name: 'tick', type: 'int24' }, { name: 'observationIndex', type: 'uint16' }, { name: 'observationCardinality', type: 'uint16' }, { name: 'observationCardinalityNext', type: 'uint16' }, { name: 'feeProtocol', type: 'uint8' }, { name: 'unlocked', type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'liquidity', outputs: [{ name: '', type: 'uint128' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'token0', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'token1', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'fee', outputs: [{ name: '', type: 'uint24' }], stateMutability: 'view', type: 'function' },
] as const;

const PAYMASTER_AMM_ABI = [
  { inputs: [{ name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'amountIn', type: 'uint256' }], name: 'getSwapQuote', outputs: [{ name: 'amountOut', type: 'uint256' }, { name: 'priceImpact', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'token0', type: 'address' }, { name: 'token1', type: 'address' }], name: 'getReserves', outputs: [{ name: 'reserve0', type: 'uint256' }, { name: 'reserve1', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'totalETHLiquidity', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'token', type: 'address' }], name: 'totalTokenLiquidity', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'getAMMStats', outputs: [{ name: 'ethReserve', type: 'uint256' }, { name: 'swapVolume', type: 'uint256' }, { name: 'swapFees', type: 'uint256' }, { name: 'currentFeeBps', type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const;

const AGGREGATOR_ABI = [
  { inputs: [{ name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'amountIn', type: 'uint256' }], name: 'getBestQuote', outputs: [{ components: [{ name: 'poolType', type: 'uint8' }, { name: 'pool', type: 'address' }, { name: 'amountOut', type: 'uint256' }, { name: 'priceImpactBps', type: 'uint256' }, { name: 'fee', type: 'uint24' }], name: '', type: 'tuple' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'amountIn', type: 'uint256' }], name: 'getAllQuotes', outputs: [{ components: [{ name: 'poolType', type: 'uint8' }, { name: 'pool', type: 'address' }, { name: 'amountOut', type: 'uint256' }, { name: 'priceImpactBps', type: 'uint256' }, { name: 'fee', type: 'uint24' }], name: '', type: 'tuple[]' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'token0', type: 'address' }, { name: 'token1', type: 'address' }], name: 'getLiquidityInfo', outputs: [{ components: [{ name: 'poolType', type: 'uint8' }, { name: 'pool', type: 'address' }, { name: 'reserve0', type: 'uint256' }, { name: 'reserve1', type: 'uint256' }, { name: 'liquidity', type: 'uint256' }, { name: 'fee', type: 'uint24' }], name: '', type: 'tuple[]' }], stateMutability: 'view', type: 'function' },
] as const;

const POOL_TYPES = ['V2', 'V3', 'PAYMASTER'] as const;
type PoolType = typeof POOL_TYPES[number];
const V3_FEE_TIERS = [500, 3000, 10000] as const;
const V2_FEE = 3000;
const PAYMASTER_FEE = 30;
const ETH_PRICE_FALLBACK_USD = 3000n * 10n ** 18n;

function calculateEffectivePrice(amountIn: string, amountOut: bigint): string {
  const inNum = Number(amountIn);
  const outNum = Number(formatEther(amountOut));
  return inNum > 0 && !isNaN(inNum) && !isNaN(outNum) ? (outNum / inNum).toFixed(8) : '0';
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logContractError(operation: string, context: string, error: unknown): void {
  console.error(`[PoolService] Failed to ${operation}${context ? ` for ${context}` : ''}:`, formatError(error));
}

export interface V2Pool {
  address: Address;
  type: 'V2';
  token0: Address;
  token1: Address;
  reserve0: string;
  reserve1: string;
  totalSupply: string;
  fee: number;
}

export interface V3Pool {
  address: Address;
  type: 'V3';
  token0: Address;
  token1: Address;
  sqrtPriceX96: string;
  tick: number;
  liquidity: string;
  fee: number;
}

export interface PaymasterPool {
  address: Address;
  type: 'PAYMASTER';
  token0: Address;
  token1: Address;
  reserve0: string;
  reserve1: string;
  fee: number;
}

export type Pool = V2Pool | V3Pool | PaymasterPool;

export interface SwapQuote {
  poolType: PoolType;
  pool: Address;
  amountIn: string;
  amountOut: string;
  priceImpactBps: number;
  fee: number;
  effectivePrice: string;
}

export interface PoolStats {
  totalPools: number;
  v2Pools: number;
  v3Pools: number;
  paymasterEnabled: boolean;
  totalLiquidityUsd: string;
  volume24h: string;
}

const TOKENS: Record<string, { address: Address; symbol: string; decimals: number }> = {
  ETH: { address: ZERO_ADDRESS, symbol: 'ETH', decimals: 18 },
  WETH: { address: (process.env.WETH_ADDRESS || ZERO_ADDRESS) as Address, symbol: 'WETH', decimals: 18 },
  USDC: { address: (process.env.USDC_ADDRESS || '0x0000000000000000000000000000000000000001') as Address, symbol: 'USDC', decimals: 6 },
  elizaOS: { address: (process.env.ELIZAOS_ADDRESS || '0x0000000000000000000000000000000000000002') as Address, symbol: 'elizaOS', decimals: 18 },
};

class PoolService {
  private client = createPublicClient({
    transport: http(getRpcUrl(JEJU_CHAIN_ID)),
  });

  private contracts = {
    v2Factory: (process.env.XLP_V2_FACTORY || ZERO_ADDRESS) as Address,
    v3Factory: (process.env.XLP_V3_FACTORY || ZERO_ADDRESS) as Address,
    router: (process.env.XLP_ROUTER || ZERO_ADDRESS) as Address,
    aggregator: (process.env.XLP_AGGREGATOR || ZERO_ADDRESS) as Address,
    paymaster: (process.env.CROSS_CHAIN_PAYMASTER || ZERO_ADDRESS) as Address,
  };

  constructor() {
    this.validateConfiguration();
  }

  private validateConfiguration(): void {
    const required = [
      { name: 'XLP_V2_FACTORY', value: this.contracts.v2Factory },
      { name: 'XLP_V3_FACTORY', value: this.contracts.v3Factory },
      { name: 'XLP_ROUTER', value: this.contracts.router },
      { name: 'XLP_AGGREGATOR', value: this.contracts.aggregator },
      { name: 'CROSS_CHAIN_PAYMASTER', value: this.contracts.paymaster },
    ];

    const missing: string[] = [];
    for (const { name, value } of required) {
      if (value === ZERO_ADDRESS) {
        missing.push(name);
      }
    }

    if (missing.length > 0) {
      const message = `[PoolService] Missing required environment variables: ${missing.join(', ')}. Service will return empty results.`;
      console.warn(message);
      if (process.env.NODE_ENV === 'production') {
        console.error('[PoolService] CRITICAL: Required configuration missing in production!');
      }
    }
  }

  private ethPriceCache: { price: bigint; timestamp: number } | null = null;
  private readonly ETH_PRICE_CACHE_TTL = 5 * 60 * 1000;

  private async getETHPriceUSD(): Promise<bigint> {
    if (this.ethPriceCache && Date.now() - this.ethPriceCache.timestamp < this.ETH_PRICE_CACHE_TTL) {
      return this.ethPriceCache.price;
    }

    const ethMainnetFeed = CHAINLINK_ETH_USD_FEEDS[1];
    if (ethMainnetFeed) {
      try {
        const ethClient = createPublicClient({ transport: http(getRpcUrl(1)) });
        const data = await ethClient.readContract({
          address: ethMainnetFeed,
          abi: CHAINLINK_ABI,
          functionName: 'latestRoundData',
        });
        const price = BigInt(data[1]) / 10n ** 8n;
        this.ethPriceCache = { price, timestamp: Date.now() };
        return price;
      } catch (error) {
        console.error('[PoolService] Failed to fetch ETH price from Chainlink:', error);
        if (error instanceof Error) {
          console.error('[PoolService] Chainlink error details:', {
            message: error.message,
            stack: error.stack,
          });
        }
      }
    }

    const envPrice = process.env.ETH_PRICE_USD;
    if (envPrice) {
      const priceNum = Number(envPrice);
      if (isNaN(priceNum) || priceNum <= 0) {
        console.error(`[PoolService] Invalid ETH_PRICE_USD env var: "${envPrice}". Must be a positive number.`);
      } else {
        const price = BigInt(Math.floor(priceNum * 1e18));
        this.ethPriceCache = { price, timestamp: Date.now() };
        console.warn('[PoolService] Using ETH_PRICE_USD from environment variable');
        return price;
      }
    }

    console.error('[PoolService] CRITICAL: Using hardcoded fallback ETH price: $3000. Chainlink fetch failed and ETH_PRICE_USD not set. USD calculations will be incorrect!');
    if (process.env.NODE_ENV === 'production') {
      console.error('[PoolService] PRODUCTION ALERT: Price oracle failure - manual intervention required!');
    }
    return ETH_PRICE_FALLBACK_USD;
  }

  async listV2Pools(): Promise<V2Pool[]> {
    if (this.contracts.v2Factory === ZERO_ADDRESS) return [];

    const pairCount = await this.client.readContract({
      address: this.contracts.v2Factory,
      abi: V2_FACTORY_ABI,
      functionName: 'allPairsLength',
    }).catch((error) => {
      logContractError('get V2 pair count', '', error);
      return 0n;
    });

    const pools: V2Pool[] = [];
    const count = Number(pairCount);

    for (let i = 0; i < Math.min(count, MAX_POOLS_TO_FETCH); i++) {
      const pairAddress = await this.client.readContract({
        address: this.contracts.v2Factory,
        abi: V2_FACTORY_ABI,
        functionName: 'allPairs',
        args: [BigInt(i)],
      }).catch((error) => {
        logContractError('get pair address', `index ${i}`, error);
        return null;
      });

      if (pairAddress) {
        const pool = await this.getV2PoolData(pairAddress);
        if (pool) pools.push(pool);
      }
    }

    return pools;
  }

  async getV2PoolData(pairAddress: Address): Promise<V2Pool | null> {
    const [reserves, token0, token1, totalSupply] = await Promise.all([
      this.client.readContract({ address: pairAddress, abi: V2_PAIR_ABI, functionName: 'getReserves' }).catch((error) => {
        logContractError('get reserves', pairAddress, error);
        return null;
      }),
      this.client.readContract({ address: pairAddress, abi: V2_PAIR_ABI, functionName: 'token0' }).catch((error) => {
        logContractError('get token0', pairAddress, error);
        return null;
      }),
      this.client.readContract({ address: pairAddress, abi: V2_PAIR_ABI, functionName: 'token1' }).catch((error) => {
        logContractError('get token1', pairAddress, error);
        return null;
      }),
      this.client.readContract({ address: pairAddress, abi: V2_PAIR_ABI, functionName: 'totalSupply' }).catch((error) => {
        logContractError('get totalSupply', pairAddress, error);
        return 0n;
      }),
    ]);

    if (!reserves || !token0 || !token1) return null;

    return {
      address: pairAddress,
      type: 'V2',
      token0,
      token1,
      reserve0: formatEther(reserves[0]),
      reserve1: formatEther(reserves[1]),
      totalSupply: formatEther(totalSupply),
      fee: V2_FEE,
    };
  }

  async getV3Pool(token0: Address, token1: Address, fee: number): Promise<V3Pool | null> {
    if (this.contracts.v3Factory === ZERO_ADDRESS) return null;

    const [sortedToken0, sortedToken1] = token0.toLowerCase() < token1.toLowerCase() 
      ? [token0, token1] 
      : [token1, token0];

    const poolAddress = await this.client.readContract({
      address: this.contracts.v3Factory,
      abi: V3_FACTORY_ABI,
      functionName: 'getPool',
      args: [sortedToken0, sortedToken1, fee],
    }).catch((error) => {
      logContractError('get V3 pool', `${sortedToken0}/${sortedToken1} fee ${fee}`, error);
      return null;
    });

    if (!poolAddress || poolAddress === ZERO_ADDRESS) return null;

    return this.getV3PoolData(poolAddress);
  }

  async getV3PoolData(poolAddress: Address): Promise<V3Pool | null> {
    const [slot0, liquidity, token0, token1, fee] = await Promise.all([
      this.client.readContract({ address: poolAddress, abi: V3_POOL_ABI, functionName: 'slot0' }).catch((error) => {
        logContractError('get slot0', poolAddress, error);
        return null;
      }),
      this.client.readContract({ address: poolAddress, abi: V3_POOL_ABI, functionName: 'liquidity' }).catch((error) => {
        logContractError('get liquidity', poolAddress, error);
        return 0n;
      }),
      this.client.readContract({ address: poolAddress, abi: V3_POOL_ABI, functionName: 'token0' }).catch((error) => {
        logContractError('get token0', poolAddress, error);
        return null;
      }),
      this.client.readContract({ address: poolAddress, abi: V3_POOL_ABI, functionName: 'token1' }).catch((error) => {
        logContractError('get token1', poolAddress, error);
        return null;
      }),
      this.client.readContract({ address: poolAddress, abi: V3_POOL_ABI, functionName: 'fee' }).catch((error) => {
        logContractError('get fee', poolAddress, error);
        return V2_FEE;
      }),
    ]);

    if (!slot0 || !token0 || !token1) return null;

    return {
      address: poolAddress,
      type: 'V3',
      token0,
      token1,
      sqrtPriceX96: slot0[0].toString(),
      tick: slot0[1],
      liquidity: liquidity.toString(),
      fee,
    };
  }

  async listPoolsForPair(token0: Address, token1: Address): Promise<Pool[]> {
    const pools: Pool[] = [];

    if (this.contracts.v2Factory !== ZERO_ADDRESS) {
      const v2Pair = await this.client.readContract({
        address: this.contracts.v2Factory,
        abi: V2_FACTORY_ABI,
        functionName: 'getPair',
        args: [token0, token1],
      }).catch((error) => {
        logContractError('get V2 pair', `${token0}/${token1}`, error);
        return null;
      });

      if (v2Pair && v2Pair !== ZERO_ADDRESS) {
        const pool = await this.getV2PoolData(v2Pair);
        if (pool) pools.push(pool);
      }
    }

    for (const fee of V3_FEE_TIERS) {
      const v3Pool = await this.getV3Pool(token0, token1, fee);
      if (v3Pool) pools.push(v3Pool);
    }

    if (this.contracts.paymaster !== ZERO_ADDRESS) {
      const reserves = await this.client.readContract({
        address: this.contracts.paymaster,
        abi: PAYMASTER_AMM_ABI,
        functionName: 'getReserves',
        args: [token0, token1],
      }).catch((error) => {
        logContractError('get paymaster reserves', `${token0}/${token1}`, error);
        return null;
      });

      if (reserves && (reserves[0] > 0n || reserves[1] > 0n)) {
        pools.push({
          address: this.contracts.paymaster,
          type: 'PAYMASTER',
          token0,
          token1,
          reserve0: formatEther(reserves[0]),
          reserve1: formatEther(reserves[1]),
          fee: PAYMASTER_FEE,
        });
      }
    }

    return pools;
  }

  async getSwapQuote(tokenIn: Address, tokenOut: Address, amountIn: string): Promise<SwapQuote | null> {
    const amountInWei = parseEther(amountIn);

    if (this.contracts.aggregator !== ZERO_ADDRESS) {
      const quote = await this.client.readContract({
        address: this.contracts.aggregator,
        abi: AGGREGATOR_ABI,
        functionName: 'getBestQuote',
        args: [tokenIn, tokenOut, amountInWei],
      }).catch((error) => {
        logContractError('get best quote from aggregator', '', error);
        return null;
      });

      if (quote && quote.amountOut > 0n) {
        return {
          poolType: POOL_TYPES[quote.poolType] || 'V2',
          pool: quote.pool,
          amountIn,
          amountOut: formatEther(quote.amountOut),
          priceImpactBps: Number(quote.priceImpactBps),
          fee: quote.fee,
          effectivePrice: calculateEffectivePrice(amountIn, quote.amountOut),
        };
      }
    }

    const pools = await this.listPoolsForPair(tokenIn, tokenOut);
    const v2Pool = pools.find(p => p.type === 'V2');

    if (v2Pool) {
      const isToken0In = tokenIn.toLowerCase() === v2Pool.token0.toLowerCase();
      const reserveIn = parseEther(isToken0In ? v2Pool.reserve0 : v2Pool.reserve1);
      const reserveOut = parseEther(isToken0In ? v2Pool.reserve1 : v2Pool.reserve0);

      if (reserveIn > 0n && reserveOut > 0n) {
        const amountInWithFee = amountInWei * 997n;
        const amountOut = (amountInWithFee * reserveOut) / (reserveIn * 1000n + amountInWithFee);
        const priceImpact = Number((amountInWei * 10000n) / reserveIn);

        return {
          poolType: 'V2',
          pool: v2Pool.address,
          amountIn,
          amountOut: formatEther(amountOut),
          priceImpactBps: priceImpact,
          fee: V2_FEE,
          effectivePrice: calculateEffectivePrice(amountIn, amountOut),
        };
      }
    }

    return null;
  }

  async getAllSwapQuotes(tokenIn: Address, tokenOut: Address, amountIn: string): Promise<SwapQuote[]> {
    const amountInWei = parseEther(amountIn);
    const quotes: SwapQuote[] = [];

    if (this.contracts.aggregator !== ZERO_ADDRESS) {
      const allQuotes = await this.client.readContract({
        address: this.contracts.aggregator,
        abi: AGGREGATOR_ABI,
        functionName: 'getAllQuotes',
        args: [tokenIn, tokenOut, amountInWei],
      }).catch((error) => {
        logContractError('get all quotes from aggregator', '', error);
        return [];
      });

      for (const q of allQuotes) {
        if (q.amountOut > 0n) {
          quotes.push({
            poolType: POOL_TYPES[q.poolType] || 'V2',
            pool: q.pool,
            amountIn,
            amountOut: formatEther(q.amountOut),
            priceImpactBps: Number(q.priceImpactBps),
            fee: q.fee,
            effectivePrice: calculateEffectivePrice(amountIn, q.amountOut),
          });
        }
      }
    }

    if (quotes.length === 0) {
      const bestQuote = await this.getSwapQuote(tokenIn, tokenOut, amountIn);
      if (bestQuote) quotes.push(bestQuote);
    }

    return quotes.sort((a, b) => Number(b.amountOut) - Number(a.amountOut));
  }

  async getPoolStats(): Promise<PoolStats> {
    let v2Count = 0;
    let v3Count = 0;
    let paymasterEnabled = false;
    let totalLiquidity = 0n;
    let volume24h = 0n;

    if (this.contracts.v2Factory !== ZERO_ADDRESS) {
      const count = await this.client.readContract({
        address: this.contracts.v2Factory,
        abi: V2_FACTORY_ABI,
        functionName: 'allPairsLength',
      }).catch((error) => {
        logContractError('get V2 pool count', '', error);
        return 0n;
      });
      v2Count = Number(count);
    }

    if (this.contracts.v3Factory !== ZERO_ADDRESS) {
      const count = await this.client.readContract({
        address: this.contracts.v3Factory,
        abi: V3_FACTORY_ABI,
        functionName: 'allPoolsLength',
      }).catch((error) => {
        logContractError('get V3 pool count', '', error);
        return 0n;
      });
      v3Count = Number(count);
    }

    if (this.contracts.paymaster !== ZERO_ADDRESS) {
      const stats = await this.client.readContract({
        address: this.contracts.paymaster,
        abi: PAYMASTER_AMM_ABI,
        functionName: 'getAMMStats',
      }).catch((error) => {
        logContractError('get paymaster stats', '', error);
        return null;
      });

      if (stats) {
        paymasterEnabled = true;
        totalLiquidity += stats[0];
        volume24h = stats[1];
      }
    }

    const ethPriceUSD = await this.getETHPriceUSD();
    const totalLiquidityUsd = formatEther((totalLiquidity * ethPriceUSD) / 10n ** 18n);

    return {
      totalPools: v2Count + v3Count + (paymasterEnabled ? 1 : 0),
      v2Pools: v2Count,
      v3Pools: v3Count,
      paymasterEnabled,
      totalLiquidityUsd,
      volume24h: formatEther(volume24h),
    };
  }

  getTokens() {
    return TOKENS;
  }

  getContracts() {
    return this.contracts;
  }

  getHealthStatus() {
    const missingConfig = Object.entries(this.contracts)
      .filter(([_, addr]) => addr === ZERO_ADDRESS)
      .map(([key]) => key);
    
    return {
      configured: missingConfig.length === 0,
      missingConfig,
      ethPriceCacheAge: this.ethPriceCache 
        ? Date.now() - this.ethPriceCache.timestamp 
        : null,
      usingFallbackPrice: !this.ethPriceCache || this.ethPriceCache.price === ETH_PRICE_FALLBACK_USD,
    };
  }
}

export const poolService = new PoolService();
