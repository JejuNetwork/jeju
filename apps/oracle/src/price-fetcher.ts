import {
  createPublicClient,
  http,
  type Hex,
  type PublicClient,
  keccak256,
  encodePacked,
} from 'viem';
import { UNISWAP_V3_POOL_ABI, CHAINLINK_AGGREGATOR_ABI } from './abis';
import type { PriceSourceConfig } from './types';

export interface PriceData {
  price: bigint;
  confidence: bigint;
  timestamp: bigint;
  source: string;
}

const now = () => BigInt(Math.floor(Date.now() / 1000));

export class PriceFetcher {
  private client: PublicClient;
  private sources: PriceSourceConfig[];
  private priceCache = new Map<string, PriceData>();

  constructor(rpcUrl: string, sources: PriceSourceConfig[]) {
    this.client = createPublicClient({ transport: http(rpcUrl) });
    this.sources = sources;
  }

  async fetchPrice(feedId: Hex): Promise<PriceData> {
    const source = this.sources.find((s) => s.feedId === feedId);
    if (!source) {
      throw new Error(`No price source configured for feed ${feedId}`);
    }

    switch (source.type) {
      case 'uniswap_v3':
        return this.fetchUniswapV3Price(source);
      case 'chainlink':
        return this.fetchChainlinkPrice(source);
      case 'manual':
        return this.fetchManualPrice(source);
      default:
        throw new Error(`Unknown price source type: ${source.type}`);
    }
  }

  async fetchAllPrices(): Promise<Map<Hex, PriceData>> {
    const results = new Map<Hex, PriceData>();

    await Promise.all(
      this.sources.map(async (source) => {
        const price = await this.fetchPrice(source.feedId);
        results.set(source.feedId, price);
        this.priceCache.set(source.feedId, price);
      })
    );

    return results;
  }

  private async fetchUniswapV3Price(source: PriceSourceConfig): Promise<PriceData> {
    const [slot0, liquidity] = await Promise.all([
      this.client.readContract({
        address: source.address,
        abi: UNISWAP_V3_POOL_ABI,
        functionName: 'slot0',
      }),
      this.client.readContract({
        address: source.address,
        abi: UNISWAP_V3_POOL_ABI,
        functionName: 'liquidity',
      }),
    ]);

    // price = (sqrtPriceX96 / 2^96)^2, scaled to decimals
    const sqrtPriceX96 = BigInt(slot0[0]);
    const priceX192 = sqrtPriceX96 * sqrtPriceX96;
    const price = (priceX192 * 10n ** BigInt(source.decimals)) >> 192n;

    // Confidence based on liquidity: 50% min, 99% max
    const liq = BigInt(liquidity);
    const MIN_LIQ = 1_000_000_000_000n;
    const MAX_LIQ = 100_000_000_000_000_000n;
    const confidence = liq >= MAX_LIQ ? 9900n
      : liq >= MIN_LIQ ? 9000n + ((liq - MIN_LIQ) * 900n) / (MAX_LIQ - MIN_LIQ)
      : 5000n;

    return { price, confidence, timestamp: now(), source: `uniswap_v3:${source.address}` };
  }

  private async fetchChainlinkPrice(source: PriceSourceConfig): Promise<PriceData> {
    const [roundData, decimals] = await Promise.all([
      this.client.readContract({
        address: source.address,
        abi: CHAINLINK_AGGREGATOR_ABI,
        functionName: 'latestRoundData',
      }),
      this.client.readContract({
        address: source.address,
        abi: CHAINLINK_AGGREGATOR_ABI,
        functionName: 'decimals',
      }),
    ]);

    const [, answer, , updatedAt] = roundData;
    const price = BigInt(answer) * 10n ** BigInt(source.decimals - decimals);

    // Confidence based on staleness
    const age = now() - updatedAt;
    const confidence = age < 60n ? 9900n : age < 3600n ? 9500n : age < 7200n ? 9000n : 8000n;

    return { price, confidence, timestamp: updatedAt, source: `chainlink:${source.address}` };
  }

  private fetchManualPrice(source: PriceSourceConfig): PriceData {
    return this.priceCache.get(source.feedId) ?? { price: 0n, confidence: 0n, timestamp: now(), source: 'manual' };
  }

  setManualPrice(feedId: Hex, price: bigint, confidence: bigint): void {
    this.priceCache.set(feedId, { price, confidence, timestamp: now(), source: 'manual' });
  }

  computeSourcesHash(sources: string[]): Hex {
    return keccak256(encodePacked(['string[]'], [sources]));
  }
}

