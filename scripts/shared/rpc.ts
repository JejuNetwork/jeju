import { createPublicClient, http, type PublicClient, type Chain, type TransactionReceipt } from 'viem';
import { mainnet } from 'viem/chains';

export class FailoverProvider {
  private clients: PublicClient[];
  private currentIndex: number = 0;
  private name: string;
  private onFailover?: () => void;
  private chain: Chain;
  
  constructor(urls: string[] | string, name: string = 'RPC', chain?: Chain, onFailover?: () => void) {
    const urlArray = typeof urls === 'string' ? urls.split(',').map(u => u.trim()) : urls;
    this.name = name;
    this.chain = chain || mainnet;
    this.clients = urlArray.map(url => createPublicClient({
      chain: this.chain,
      transport: http(url),
    }));
    this.onFailover = onFailover;
    
    if (this.clients.length === 0) {
      throw new Error('At least one RPC URL required');
    }
    
    if (this.clients.length > 1) {
      console.log(`✅ ${name} provider initialized with ${urlArray.length} RPC endpoint(s)`);
    }
  }
  
  async getProvider(): Promise<PublicClient> {
    try {
      await this.clients[this.currentIndex].getBlockNumber();
      return this.clients[this.currentIndex];
    } catch {
      console.warn(`⚠️  ${this.name} RPC ${this.currentIndex} failed, trying fallback...`);
      this.onFailover?.();
      
      for (let i = 0; i < this.clients.length; i++) {
        if (i === this.currentIndex) continue;
        try {
          await this.clients[i].getBlockNumber();
          this.currentIndex = i;
          console.log(`✅ ${this.name} switched to RPC ${i}`);
          return this.clients[i];
        } catch {
          console.warn(`⚠️  ${this.name} RPC ${i} also failed`);
        }
      }
      
      throw new Error(`All ${this.name} RPC endpoints failed`);
    }
  }
  
  async getProviderWithRetry(maxRetries = 3, delayMs = 1000): Promise<PublicClient> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.getProvider();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt === maxRetries) break;
        console.log(`Retry ${attempt}/${maxRetries} in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    throw lastError || new Error('Failed to get provider after retries');
  }
}

export async function checkRPC(rpcUrl: string, timeout = 5000): Promise<boolean> {
  try {
    const client = createPublicClient({
      transport: http(rpcUrl),
    });
    
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Timeout')), timeout);
    });
    
    await Promise.race([
      client.getBlockNumber(),
      timeoutPromise,
    ]);
    
    return true;
  } catch (error) {
    console.warn(`RPC check failed for ${rpcUrl}:`, error instanceof Error ? error.message : String(error));
    return false;
  }
}

export async function getNetworkInfo(client: PublicClient): Promise<{
  chainId: bigint;
  blockNumber: bigint;
  gasPrice: bigint;
}> {
  const [chainId, blockNumber, gasPrice] = await Promise.all([
    client.getChainId(),
    client.getBlockNumber(),
    client.getGasPrice(),
  ]);
  
  return {
    chainId: BigInt(chainId),
    blockNumber,
    gasPrice,
  };
}

export async function waitForTransaction(
  client: PublicClient,
  txHash: `0x${string}`,
  confirmations = 1,
  timeout = 300000
): Promise<TransactionReceipt> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Transaction timeout after ${timeout}ms: ${txHash}`)), timeout);
  });
  
  try {
    return await Promise.race([
      client.waitForTransactionReceipt({ hash: txHash, confirmations }),
      timeoutPromise,
    ]);
  } catch (error) {
    throw new Error(`Failed to wait for transaction ${txHash}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

