/**
 * Localnet Oracle Service
 * Provides price feeds, randomness, and external data WITHOUT external dependencies
 * Uses deterministic algorithms suitable for local testing
 */

import { Plugin, Service, Provider, type IAgentRuntime, type Memory, type State } from '@elizaos/core';
import { ethers } from 'ethers';

export interface PriceFeed {
  symbol: string;
  price: bigint; // Price in wei (18 decimals)
  timestamp: number;
  source: string;
}

/**
 * Oracle Service
 * Provides deterministic oracle data for localnet testing
 */
export class OracleService extends Service {
  public static serviceType = 'oracle_service';
  
  private priceFeeds: Map<string, PriceFeed> = new Map();
  private randomSeed: number;
  private updateInterval?: NodeJS.Timeout;
  
  async start(runtime: IAgentRuntime): Promise<OracleService> {
    // Initialize random seed from block timestamp
    this.randomSeed = Date.now();
    
    // Initialize default price feeds (deterministic but varying)
    this.initializeDefaultPrices();
    
    // Update prices every 30 seconds with deterministic changes
    this.updateInterval = setInterval(() => {
      this.updatePrices(runtime);
    }, 30000);
    
    runtime.logger.info('Oracle service started', {
      feeds: Array.from(this.priceFeeds.keys()),
      updateInterval: '30s'
    });
    
    return this;
  }
  
  /**
   * Initialize default price feeds for common tokens
   */
  private initializeDefaultPrices(): void {
    const timestamp = Date.now();
    
    // Base prices (in USD, 18 decimals)
    this.priceFeeds.set('ETH', {
      symbol: 'ETH',
      price: ethers.parseEther('2000'), // $2000
      timestamp,
      source: 'deterministic'
    });
    
    this.priceFeeds.set('USDC', {
      symbol: 'USDC',
      price: ethers.parseEther('1'), // $1 (stablecoin)
      timestamp,
      source: 'deterministic'
    });
    
    this.priceFeeds.set('elizaOS', {
      symbol: 'elizaOS',
      price: ethers.parseEther('0.5'), // $0.50
      timestamp,
      source: 'deterministic'
    });
    
    this.priceFeeds.set('JEJU', {
      symbol: 'JEJU',
      price: ethers.parseEther('1.5'), // $1.50
      timestamp,
      source: 'deterministic'
    });
  }
  
  /**
   * Update prices with deterministic but varying changes
   * Uses simple sine wave to simulate market movement
   */
  private updatePrices(runtime: IAgentRuntime): void {
    const timestamp = Date.now();
    const timeFactor = timestamp / 100000; // Slow sine wave
    
    for (const [symbol, feed] of this.priceFeeds.entries()) {
      if (symbol === 'USDC') continue; // Stablecoin stays at $1
      
      // Base price (different for each symbol)
      const basePrices: Record<string, string> = {
        'ETH': '2000',
        'elizaOS': '0.5',
        'JEJU': '1.5'
      };
      
      const basePrice = ethers.parseEther(basePrices[symbol] || '1');
      
      // Add sine wave variation (±5%)
      const variation = Math.sin(timeFactor + this.priceFeeds.size) * 0.05;
      const newPrice = basePrice + (basePrice * BigInt(Math.floor(variation * 100))) / BigInt(100);
      
      this.priceFeeds.set(symbol, {
        symbol,
        price: newPrice,
        timestamp,
        source: 'deterministic'
      });
    }
    
    runtime.logger.debug('Oracle prices updated', {
      ETH: ethers.formatEther(this.priceFeeds.get('ETH')!.price),
      elizaOS: ethers.formatEther(this.priceFeeds.get('elizaOS')!.price)
    });
  }
  
  /**
   * Get price feed for a token
   */
  getPrice(symbol: string): PriceFeed | null {
    return this.priceFeeds.get(symbol.toUpperCase()) || null;
  }
  
  /**
   * Get all price feeds
   */
  getAllPrices(): PriceFeed[] {
    return Array.from(this.priceFeeds.values());
  }
  
  /**
   * Generate deterministic random number
   * Uses block timestamp + seed for reproducible randomness in testing
   */
  async getRandomNumber(min: number, max: number, runtime: IAgentRuntime): Promise<number> {
    try {
      const rpcUrl = runtime.getSetting('JEJU_L2_RPC');
      if (!rpcUrl) {
        throw new Error('RPC URL required for block-based randomness');
      }
      
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const latestBlock = await provider.getBlock('latest');
      
      if (!latestBlock) {
        throw new Error('Could not fetch latest block');
      }
      
      // Combine block hash with seed for randomness
      const hashNumber = BigInt(latestBlock.hash || '0x0');
      const seedBigInt = BigInt(this.randomSeed);
      const combined = (hashNumber + seedBigInt) % BigInt(max - min + 1);
      
      return Number(combined) + min;
    } catch (error) {
      runtime.logger.error('Randomness generation failed, using Math.random fallback', error);
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }
  }
  
  /**
   * Generate random bytes (for TEE attestation simulation)
   */
  async getRandomBytes(length: number, runtime: IAgentRuntime): Promise<string> {
    const randomNum = await this.getRandomNumber(0, Number.MAX_SAFE_INTEGER, runtime);
    const hash = ethers.keccak256(ethers.toUtf8Bytes(randomNum.toString()));
    return hash.slice(0, 2 + length * 2); // 0x + length bytes
  }
  
  /**
   * Add or update a price feed
   */
  setPriceFeed(symbol: string, price: bigint, source: string = 'manual'): void {
    this.priceFeeds.set(symbol.toUpperCase(), {
      symbol: symbol.toUpperCase(),
      price,
      timestamp: Date.now(),
      source
    });
    
    this.runtime.logger.info(`Price feed updated: ${symbol} = ${ethers.formatEther(price)}`);
  }
  
  async stop(): Promise<void> {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    this.priceFeeds.clear();
    this.runtime.logger.info('Oracle service stopped');
  }
  
  public get capabilityDescription(): string {
    return 'Localnet oracle providing price feeds and randomness without external dependencies';
  }
}

/**
 * Price Feed Provider
 * Injects current price feeds into agent context
 */
export const priceFeedProvider: Provider = {
  name: 'PRICE_FEEDS',
  description: 'Current oracle price feeds for all tracked tokens',
  
  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const oracleService = runtime.getService<OracleService>('oracle_service');
    
    if (!oracleService) {
      return {text: ''};
    }
    
    const prices = oracleService.getAllPrices();
    
    const priceText = prices
      .map(p => `${p.symbol}: $${ethers.formatEther(p.price)}`)
      .join('\n');
    
    return {
      text: `[ORACLE PRICE FEEDS]\n${priceText}\n[/ORACLE PRICE FEEDS]`,
      data: {
        prices: prices.map(p => ({
          symbol: p.symbol,
          price: p.price.toString(),
          priceUsd: ethers.formatEther(p.price),
          timestamp: p.timestamp
        }))
      }
    };
  }
};

export const oraclePlugin: Plugin = {
  name: '@crucible/plugin-oracle',
  description: 'Localnet oracle service for deterministic price feeds and randomness',
  services: [OracleService],
  providers: [priceFeedProvider]
};

