/**
 * Transaction Simulation Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SimulationService } from './index';
import type { SupportedChainId } from '../rpc';

// Mock RPC service
vi.mock('../rpc', () => ({
  rpcService: {
    getClient: vi.fn().mockReturnValue({
      estimateGas: vi.fn().mockResolvedValue(21000n),
      getGasPrice: vi.fn().mockResolvedValue(1000000000n),
      estimateFeesPerGas: vi.fn().mockResolvedValue({
        maxFeePerGas: 1500000000n,
        maxPriorityFeePerGas: 100000000n,
      }),
      call: vi.fn().mockResolvedValue({}),
      readContract: vi.fn().mockResolvedValue('TOKEN'),
    }),
  },
  SUPPORTED_CHAINS: { 1: {}, 8453: {} },
}));

// Mock oracle service
vi.mock('../oracle', () => ({
  oracleService: {
    getNativeTokenPrice: vi.fn().mockResolvedValue(2000),
    getTokenPrice: vi.fn().mockResolvedValue(1),
  },
}));

describe('SimulationService', () => {
  let simulationService: SimulationService;

  beforeEach(() => {
    vi.clearAllMocks();
    simulationService = new SimulationService();
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

