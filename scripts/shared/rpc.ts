/**
 * @title Shared RPC Utilities
 * @notice RPC failover and helper functions
 */

import { ethers } from 'ethers';

/**
 * RPC Provider with automatic failover
 */
export class FailoverProvider {
  private providers: ethers.JsonRpcProvider[];
  private currentIndex: number = 0;
  private name: string;
  private onFailover?: () => void;
  
  constructor(urls: string[] | string, name: string = 'RPC', onFailover?: () => void) {
    const urlArray = typeof urls === 'string' ? urls.split(',').map(u => u.trim()) : urls;
    this.name = name;
    this.providers = urlArray.map(url => new ethers.JsonRpcProvider(url));
    this.onFailover = onFailover;
    
    if (this.providers.length === 0) {
      throw new Error('At least one RPC URL required');
    }
    
    if (this.providers.length > 1) {
      console.log(`✅ ${name} provider initialized with ${urls.length} RPC endpoint(s)`);
    }
  }
  
  async getProvider(): Promise<ethers.Provider> {
    // Try current provider first
    try {
      await this.providers[this.currentIndex].getBlockNumber();
      return this.providers[this.currentIndex];
    } catch (error) {
      console.warn(`⚠️  ${this.name} RPC ${this.currentIndex} failed, trying fallback...`);
      
      // Notify failover callback
      if (this.onFailover) {
        this.onFailover();
      }
      
      // Try other providers
      for (let i = 0; i < this.providers.length; i++) {
        if (i === this.currentIndex) continue;
        
        try {
          await this.providers[i].getBlockNumber();
          this.currentIndex = i;
          console.log(`✅ ${this.name} switched to RPC ${i}`);
          return this.providers[i];
        } catch (err) {
          console.warn(`⚠️  ${this.name} RPC ${i} also failed`);
        }
      }
      
      throw new Error(`All ${this.name} RPC endpoints failed`);
    }
  }
  
  /**
   * Get provider with retry logic
   */
  async getProviderWithRetry(maxRetries: number = 3, delayMs: number = 1000): Promise<ethers.Provider> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.getProvider();
      } catch (error) {
        if (attempt === maxRetries) throw error;
        console.log(`Retry ${attempt}/${maxRetries} in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    throw new Error('Unreachable');
  }
}

/**
 * Check if RPC is responding
 */
export async function checkRPC(rpcUrl: string, timeout: number = 5000): Promise<boolean> {
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Timeout')), timeout);
    });
    
    await Promise.race([
      provider.getBlockNumber(),
      timeoutPromise,
    ]);
    
    return true;
  } catch {
    return false;
  }
}

/**
 * Get network information
 */
export async function getNetworkInfo(provider: ethers.Provider): Promise<{
  chainId: bigint;
  blockNumber: number;
  gasPrice: bigint;
}> {
  const [network, blockNumber, feeData] = await Promise.all([
    provider.getNetwork(),
    provider.getBlockNumber(),
    provider.getFeeData(),
  ]);
  
  return {
    chainId: network.chainId,
    blockNumber,
    gasPrice: feeData.gasPrice || 0n,
  };
}

/**
 * Wait for transaction with timeout
 */
export async function waitForTransaction(
  provider: ethers.Provider,
  txHash: string,
  confirmations: number = 1,
  timeout: number = 300000 // 5 minutes
): Promise<ethers.TransactionReceipt | null> {
  const timeoutPromise = new Promise<null>((_, reject) => {
    setTimeout(() => reject(new Error('Transaction timeout')), timeout);
  });
  
  return Promise.race([
    provider.waitForTransaction(txHash, confirmations),
    timeoutPromise,
  ]);
}

