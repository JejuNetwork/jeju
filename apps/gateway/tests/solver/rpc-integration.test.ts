/**
 * Real RPC Integration Tests
 * Tests actual blockchain interactions with deployed OIF contracts
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { createPublicClient, http, type PublicClient, formatEther, parseEther } from 'viem';
import { mainnet, sepolia, baseSepolia, optimism, arbitrum } from 'viem/chains';
import { INPUT_SETTLERS, OUTPUT_SETTLERS, ORACLES, OUTPUT_SETTLER_ABI } from '../../src/solver/contracts';

// Chain configs for testing
const CHAIN_CONFIGS = {
  sepolia: { chain: sepolia, rpc: 'https://ethereum-sepolia-rpc.publicnode.com' },
  baseSepolia: { chain: baseSepolia, rpc: 'https://sepolia.base.org' },
};

describe('Real RPC Integration', () => {
  const clients: Record<string, PublicClient> = {};
  let hasConnectivity = false;

  beforeAll(async () => {
    // Create clients for each chain
    for (const [name, config] of Object.entries(CHAIN_CONFIGS)) {
      clients[name] = createPublicClient({
        chain: config.chain,
        transport: http(config.rpc),
      });
    }

    // Check connectivity
    try {
      await clients.sepolia.getBlockNumber();
      hasConnectivity = true;
    } catch {
      console.warn('No RPC connectivity, skipping real RPC tests');
    }
  });

  describe('Network Connectivity', () => {
    test('should connect to Sepolia', async () => {
      if (!hasConnectivity) return;
      
      const blockNumber = await clients.sepolia.getBlockNumber();
      expect(blockNumber).toBeGreaterThan(0n);
    });

    test('should connect to Base Sepolia', async () => {
      if (!hasConnectivity) return;
      
      const blockNumber = await clients.baseSepolia.getBlockNumber();
      expect(blockNumber).toBeGreaterThan(0n);
    });

    test('should get gas price', async () => {
      if (!hasConnectivity) return;
      
      const gasPrice = await clients.sepolia.getGasPrice();
      expect(gasPrice).toBeGreaterThan(0n);
      // Gas price should be reasonable (< 1000 gwei)
      expect(gasPrice).toBeLessThan(parseEther('0.001'));
    });
  });

  describe('Deployed Contract Verification', () => {
    test('should verify InputSettler has code on Sepolia', async () => {
      if (!hasConnectivity) return;
      
      const settler = INPUT_SETTLERS[11155111];
      if (!settler) {
        console.warn('No InputSettler deployed on Sepolia');
        return;
      }

      const code = await clients.sepolia.getCode({ address: settler });
      expect(code).toBeDefined();
      expect(code!.length).toBeGreaterThan(2); // More than just "0x"
    });

    test('should verify OutputSettler has code on Base Sepolia', async () => {
      if (!hasConnectivity) return;
      
      const settler = OUTPUT_SETTLERS[84532];
      if (!settler) {
        console.warn('No OutputSettler deployed on Base Sepolia');
        return;
      }

      const code = await clients.baseSepolia.getCode({ address: settler });
      expect(code).toBeDefined();
      expect(code!.length).toBeGreaterThan(2);
    });

    test('should verify Oracle has code on deployed chains', async () => {
      if (!hasConnectivity) return;
      
      for (const [chainIdStr, oracle] of Object.entries(ORACLES)) {
        const chainId = parseInt(chainIdStr);
        const clientName = chainId === 11155111 ? 'sepolia' : 
                          chainId === 84532 ? 'baseSepolia' : null;
        
        if (!clientName || !clients[clientName]) continue;
        
        const code = await clients[clientName].getCode({ address: oracle });
        expect(code).toBeDefined();
        expect(code!.length).toBeGreaterThan(2);
      }
    });
  });

  describe('Contract Read Operations', () => {
    test('should call isFilled on OutputSettler', async () => {
      if (!hasConnectivity) return;
      
      const settler = OUTPUT_SETTLERS[84532];
      if (!settler) return;

      // Test with a random order ID that likely doesn't exist
      const orderId = '0x' + '00'.repeat(32) as `0x${string}`;
      
      const isFilled = await clients.baseSepolia.readContract({
        address: settler,
        abi: OUTPUT_SETTLER_ABI,
        functionName: 'isFilled',
        args: [orderId],
      });

      // Random order should not be filled
      expect(typeof isFilled).toBe('boolean');
      expect(isFilled).toBe(false);
    });

    test('should handle non-existent contract gracefully', async () => {
      if (!hasConnectivity) return;
      
      const fakeAddress = '0x0000000000000000000000000000000000000001' as `0x${string}`;
      
      await expect(
        clients.sepolia.readContract({
          address: fakeAddress,
          abi: OUTPUT_SETTLER_ABI,
          functionName: 'isFilled',
          args: ['0x' + '00'.repeat(32) as `0x${string}`],
        })
      ).rejects.toThrow();
    });
  });

  describe('Parallel RPC Calls', () => {
    test('should handle multiple parallel calls', async () => {
      if (!hasConnectivity) return;
      
      const promises = [
        clients.sepolia.getBlockNumber(),
        clients.sepolia.getGasPrice(),
        clients.sepolia.getChainId(),
        clients.baseSepolia.getBlockNumber(),
        clients.baseSepolia.getGasPrice(),
      ];

      const results = await Promise.all(promises);
      
      expect(results.length).toBe(5);
      expect(results[0]).toBeGreaterThan(0n); // Sepolia block
      expect(results[1]).toBeGreaterThan(0n); // Sepolia gas
      expect(Number(results[2])).toBe(11155111); // Sepolia chain ID (convert to number for comparison)
      expect(results[3]).toBeGreaterThan(0n); // Base Sepolia block
      expect(results[4]).toBeGreaterThan(0n); // Base Sepolia gas
    });

    test('should handle mixed success/failure in parallel', async () => {
      if (!hasConnectivity) return;
      
      const fakeClient = createPublicClient({
        chain: sepolia,
        transport: http('http://localhost:99999'), // Non-existent
      });

      const results = await Promise.allSettled([
        clients.sepolia.getBlockNumber(),
        fakeClient.getBlockNumber(),
        clients.baseSepolia.getBlockNumber(),
      ]);

      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      expect(results[2].status).toBe('fulfilled');
    });
  });

  describe('Rate Limiting Behavior', () => {
    test('should handle rapid sequential calls', async () => {
      if (!hasConnectivity) return;
      
      const results: bigint[] = [];
      
      for (let i = 0; i < 5; i++) {
        const block = await clients.sepolia.getBlockNumber();
        results.push(block);
      }

      // All calls should succeed
      expect(results.length).toBe(5);
      // Block numbers should be non-decreasing
      for (let i = 1; i < results.length; i++) {
        expect(results[i]).toBeGreaterThanOrEqual(results[i - 1]);
      }
    });

    test('should handle burst of calls', async () => {
      if (!hasConnectivity) return;
      
      const burstSize = 10;
      const promises = Array(burstSize).fill(null).map(() => 
        clients.sepolia.getBlockNumber()
      );

      const results = await Promise.allSettled(promises);
      const successful = results.filter(r => r.status === 'fulfilled');
      
      // Most should succeed (public RPCs may rate limit)
      expect(successful.length).toBeGreaterThan(burstSize / 2);
    });
  });

  describe('Chain-Specific Behavior', () => {
    test('should get correct chain IDs', async () => {
      if (!hasConnectivity) return;
      
      const sepoliaChainId = await clients.sepolia.getChainId();
      const baseSepoliaChainId = await clients.baseSepolia.getChainId();
      
      expect(Number(sepoliaChainId)).toBe(11155111);
      expect(Number(baseSepoliaChainId)).toBe(84532);
    });

    test('should get different block times', async () => {
      if (!hasConnectivity) return;
      
      const [sepoliaBlock, baseBlock] = await Promise.all([
        clients.sepolia.getBlock(),
        clients.baseSepolia.getBlock(),
      ]);

      // Both should have valid timestamps
      expect(sepoliaBlock.timestamp).toBeGreaterThan(0n);
      expect(baseBlock.timestamp).toBeGreaterThan(0n);
      
      // L2 blocks are typically more recent
      const now = BigInt(Math.floor(Date.now() / 1000));
      expect(baseBlock.timestamp).toBeGreaterThan(now - 300n); // Within 5 min
    });
  });

  describe('Error Handling', () => {
    test('should handle timeout gracefully', async () => {
      if (!hasConnectivity) return;
      
      const slowClient = createPublicClient({
        chain: sepolia,
        transport: http('https://ethereum-sepolia-rpc.publicnode.com', {
          timeout: 1, // 1ms timeout - will fail
        }),
      });

      await expect(slowClient.getBlockNumber()).rejects.toThrow();
    });

    test('should handle invalid RPC URL', async () => {
      const badClient = createPublicClient({
        chain: sepolia,
        transport: http('https://invalid.example.com'),
      });

      await expect(badClient.getBlockNumber()).rejects.toThrow();
    });

    test('should handle malformed response', async () => {
      if (!hasConnectivity) return;
      
      // Try to decode a contract that doesn't implement the ABI
      const randomContract = '0x1111111111111111111111111111111111111111' as `0x${string}`;
      
      await expect(
        clients.sepolia.readContract({
          address: randomContract,
          abi: OUTPUT_SETTLER_ABI,
          functionName: 'isFilled',
          args: ['0x' + '00'.repeat(32) as `0x${string}`],
        })
      ).rejects.toThrow();
    });
  });
});

describe('Gas Estimation', () => {
  let client: PublicClient;
  let hasConnectivity = false;

  beforeAll(async () => {
    client = createPublicClient({
      chain: sepolia,
      transport: http('https://ethereum-sepolia-rpc.publicnode.com'),
    });

    try {
      await client.getBlockNumber();
      hasConnectivity = true;
    } catch {
      console.warn('No RPC connectivity for gas estimation tests');
    }
  });

  test('should get current gas price', async () => {
    if (!hasConnectivity) return;
    
    const gasPrice = await client.getGasPrice();
    
    // Gas price should be positive
    expect(gasPrice).toBeGreaterThan(0n);
    
    // Should be less than 1000 gwei (reasonable upper bound)
    expect(gasPrice).toBeLessThan(1000n * 10n ** 9n);
  });

  test('should get fee history', async () => {
    if (!hasConnectivity) return;
    
    const feeHistory = await client.getFeeHistory({
      blockCount: 5,
      rewardPercentiles: [25, 50, 75],
    });

    expect(feeHistory.baseFeePerGas.length).toBeGreaterThan(0);
    expect(feeHistory.gasUsedRatio.length).toBeGreaterThan(0);
  });

  test('should estimate transfer gas', async () => {
    if (!hasConnectivity) return;
    
    const gasEstimate = await client.estimateGas({
      to: '0x0000000000000000000000000000000000000001',
      value: 0n,
    });

    // Simple transfer should be around 21000 (may vary slightly)
    expect(gasEstimate).toBeGreaterThanOrEqual(21000n);
    expect(gasEstimate).toBeLessThan(30000n);
  });
});
