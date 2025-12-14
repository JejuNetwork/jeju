/**
 * Transaction Simulation Service Tests
 * 
 * Tests transaction simulation using mocks.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SupportedChainId } from '../rpc';
import { SimulationService } from './index';
import * as rpcModule from '../rpc';
import * as oracleModule from '../oracle';

describe('SimulationService', () => {
  let simulationService: SimulationService;
  let originalGetClient: typeof rpcModule.rpcService.getClient;
  let originalGetNativeTokenPrice: typeof oracleModule.oracleService.getNativeTokenPrice;
  let originalGetTokenPrice: typeof oracleModule.oracleService.getTokenPrice;

  beforeEach(() => {
    // Save originals
    originalGetClient = rpcModule.rpcService.getClient;
    originalGetNativeTokenPrice = oracleModule.oracleService.getNativeTokenPrice;
    originalGetTokenPrice = oracleModule.oracleService.getTokenPrice;

    // Create mock client
    const mockClient = {
      estimateGas: vi.fn(() => Promise.resolve(21000n)),
      getGasPrice: vi.fn(() => Promise.resolve(1000000000n)),
      estimateFeesPerGas: vi.fn(() => Promise.resolve({
        maxFeePerGas: 1500000000n,
        maxPriorityFeePerGas: 100000000n,
      })),
      call: vi.fn(() => Promise.resolve({})),
      readContract: vi.fn(() => Promise.resolve('TOKEN')),
    };

    // Mock rpcService.getClient
    rpcModule.rpcService.getClient = vi.fn(() => mockClient as unknown as ReturnType<typeof rpcModule.rpcService.getClient>);
    
    // Mock oracle service
    oracleModule.oracleService.getNativeTokenPrice = vi.fn(() => Promise.resolve(2000));
    oracleModule.oracleService.getTokenPrice = vi.fn(() => Promise.resolve(1));
    
    simulationService = new SimulationService();
  });

  afterEach(() => {
    // Restore originals
    rpcModule.rpcService.getClient = originalGetClient;
    oracleModule.oracleService.getNativeTokenPrice = originalGetNativeTokenPrice;
    oracleModule.oracleService.getTokenPrice = originalGetTokenPrice;
  });

  describe('simulate', () => {
    it('should simulate a simple ETH transfer', async () => {
      const result = await simulationService.simulate({
        chainId: 1 as SupportedChainId,
        from: '0x1234567890abcdef1234567890abcdef12345678',
        to: '0xabcdef1234567890abcdef1234567890abcdef12',
        value: 1000000000000000000n, // 1 ETH
        data: '0x',
      });

      expect(result.success).toBe(true);
      expect(result.nativeChange).toBeDefined();
      expect(result.nativeChange?.type).toBe('send');
      expect(result.gas.gasLimit).toBeGreaterThan(0n);
    });

    it('should detect approve transactions', async () => {
      const approveData = '0x095ea7b3' + 
        '000000000000000000000000abcdef1234567890abcdef1234567890abcdef12' +
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

      const result = await simulationService.simulate({
        chainId: 1 as SupportedChainId,
        from: '0x1234567890abcdef1234567890abcdef12345678',
        to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        value: 0n,
        data: approveData as `0x${string}`,
      });

      expect(result.success).toBe(true);
      expect(result.approvalChanges).toHaveLength(1);
      expect(result.approvalChanges[0].amount).toBe('unlimited');
    });

    it('should set risk level for unlimited approvals', async () => {
      const approveData = '0x095ea7b3' + 
        '000000000000000000000000abcdef1234567890abcdef1234567890abcdef12' +
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

      const result = await simulationService.simulate({
        chainId: 1 as SupportedChainId,
        from: '0x1234567890abcdef1234567890abcdef12345678',
        to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        value: 0n,
        data: approveData as `0x${string}`,
      });

      expect(result.risk.level).not.toBe('safe');
      expect(result.risk.warnings.length).toBeGreaterThan(0);
    });

    it('should include gas estimate', async () => {
      const result = await simulationService.simulate({
        chainId: 1 as SupportedChainId,
        from: '0x1234567890abcdef1234567890abcdef12345678',
        to: '0xabcdef1234567890abcdef1234567890abcdef12',
        value: 1000000000000000000n,
        data: '0x',
      });

      expect(result.gas).toBeDefined();
      expect(result.gas.gasLimit).toBeGreaterThan(0n);
      expect(result.gas.totalCostUsd).toBeGreaterThanOrEqual(0);
    });
  });
});
