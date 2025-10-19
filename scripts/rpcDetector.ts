/**
 * Jeju RPC Detection
 * 
 * This utility automatically detects which Jeju network is available:
 * 1. Jeju Localnet (Kurtosis) - chain ID 1337
 * 2. Jeju Localnet (Standalone) - chain ID 420691
 * 3. Jeju Testnet - chain ID 420690
 * 4. Jeju Mainnet - chain ID 420691
 * 
 * All local testing runs on Jeju by default.
 */

interface ChainInfo {
  chainId: number;
  name: string;
  rpcUrl: string;
  isJeju: boolean;
  blockNumber: number;
}

export class RpcDetector {
  private static readonly JEJU_RPC = process.env.JEJU_RPC_URL || 'http://localhost:9545';
  
  // Jeju chain IDs (canonical)
  private static readonly JEJU_MAINNET_ID = 420691;
  private static readonly JEJU_TESTNET_ID = 420690;
  private static readonly JEJU_LOCALNET_KURTOSIS_ID = 1337; // Kurtosis localnet
  private static readonly JEJU_LOCALNET_STANDALONE_ID = 420691; // Standalone localnet
  
  /**
   * Detect which Jeju network is available and return RPC URL
   * All testing runs on Jeju by default
   */
  static async detectRpc(): Promise<ChainInfo> {
    console.log('🔍 Detecting Jeju network...');
    
    // Check if Jeju is available
    const jejuInfo = await this.checkChain(this.JEJU_RPC, 'Jeju');
    if (jejuInfo && jejuInfo.isJeju) {
      console.log(`✅ Using ${jejuInfo.name} at ${jejuInfo.rpcUrl}`);
      console.log(`   Chain ID: ${jejuInfo.chainId}`);
      console.log(`   Block: ${jejuInfo.blockNumber}`);
      return jejuInfo;
    }
    
    // Jeju not available
    throw new Error(
      '❌ Jeju network not available!\n' +
      '   Start Jeju localnet with: bun run dev\n' +
      '   Or use bootstrap: bun run scripts/bootstrap-localnet-complete.ts\n'
    );
  }
  
  /**
   * Check if a specific RPC endpoint is available
   */
  private static async checkChain(
    rpcUrl: string, 
    name: string
  ): Promise<ChainInfo | null> {
    try {
      // Try to connect with timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      
      // Get chain ID
      const chainIdResponse = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_chainId',
          params: [],
          id: 1
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeout);
      
      if (!chainIdResponse.ok) {
        return null;
      }
      
      const chainIdData = await chainIdResponse.json() as { result: string };
      const chainId = parseInt(chainIdData.result, 16);
      
      // Get block number to verify it's working
      const blockResponse = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_blockNumber',
          params: [],
          id: 2
        })
      });
      
      const blockData = await blockResponse.json() as { result: string };
      const blockNumber = parseInt(blockData.result, 16);
      
      // Determine if this is Jeju
      const isJeju = chainId === this.JEJU_MAINNET_ID ||
                    chainId === this.JEJU_TESTNET_ID ||
                    chainId === this.JEJU_LOCALNET_KURTOSIS_ID ||
                    chainId === this.JEJU_LOCALNET_STANDALONE_ID;
      
      const chainName = isJeju
        ? chainId === this.JEJU_LOCALNET_KURTOSIS_ID ? 'Jeju Localnet (Kurtosis)'
          : chainId === this.JEJU_LOCALNET_STANDALONE_ID ? 'Jeju Localnet'
          : chainId === this.JEJU_TESTNET_ID ? 'Jeju Testnet'
          : 'Jeju Mainnet'
        : name;
      
      return {
        chainId,
        name: chainName,
        rpcUrl,
        isJeju,
        blockNumber
      };
      
    } catch (error) {
      // Connection failed, RPC not available
      return null;
    }
  }
  
  /**
   * Get Jeju RPC URL
   * Use this in all blockchain configuration
   */
  static async getRpcUrl(): Promise<string> {
    const info = await this.detectRpc();
    return info.rpcUrl;
  }
  
  /**
   * Check if Jeju is available (without throwing)
   */
  static async isJejuAvailable(): Promise<boolean> {
    try {
      const info = await this.checkChain(this.JEJU_RPC, 'Jeju');
      return info?.isJeju ?? false;
    } catch {
      return false;
    }
  }
  
  /**
   * Get chain info with caching for performance
   */
  private static cachedInfo: ChainInfo | null = null;
  private static cacheTime: number = 0;
  private static CACHE_TTL = 30000; // 30 seconds
  
  static async getChainInfo(): Promise<ChainInfo> {
    const now = Date.now();
    if (this.cachedInfo && (now - this.cacheTime) < this.CACHE_TTL) {
      return this.cachedInfo;
    }
    
    this.cachedInfo = await this.detectRpc();
    this.cacheTime = now;
    return this.cachedInfo;
  }
  
  /**
   * Clear cache (useful for tests)
   */
  static clearCache() {
    this.cachedInfo = null;
    this.cacheTime = 0;
  }
}

// Export convenience functions
export async function getRpcUrl(): Promise<string> {
  return RpcDetector.getRpcUrl();
}

export async function getChainInfo(): Promise<ChainInfo> {
  return RpcDetector.getChainInfo();
}

export async function isJejuAvailable(): Promise<boolean> {
  return RpcDetector.isJejuAvailable();
}

