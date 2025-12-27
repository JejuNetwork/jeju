/**
 * RPC Service Tests
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import {
  getNetworkRpc,
  RPCService,
  SUPPORTED_CHAINS,
  type SupportedChainId,
} from './index'

describe('RPC Service', () => {
  describe('SUPPORTED_CHAINS', () => {
    it('should have correct chain IDs', () => {
      expect(SUPPORTED_CHAINS[1].name).toBe('Ethereum')
      expect(SUPPORTED_CHAINS[8453].name).toBe('Base')
      expect(SUPPORTED_CHAINS[42161].name).toBe('Arbitrum')
      expect(SUPPORTED_CHAINS[10].name).toBe('Optimism')
      expect(SUPPORTED_CHAINS[56].name).toBe('BSC')
    })

    it('should have native currency ETH', () => {
      expect(SUPPORTED_CHAINS[1].nativeCurrency.symbol).toBe('ETH')
      expect(SUPPORTED_CHAINS[8453].nativeCurrency.symbol).toBe('ETH')
    })
  })

  describe('getNetworkRpc', () => {
    it('should return correct RPC URLs', () => {
      expect(getNetworkRpc(1)).toContain('/eth')
      expect(getNetworkRpc(8453)).toContain('/base')
      expect(getNetworkRpc(42161)).toContain('/arbitrum')
      expect(getNetworkRpc(10)).toContain('/optimism')
      expect(getNetworkRpc(56)).toContain('/bsc')
    })
  })

  describe('RPCService', () => {
    let service: RPCService

    beforeEach(() => {
      service = new RPCService()
    })

    it('should create clients for supported chains', () => {
      const client = service.getClient(1)
      expect(client).toBeDefined()
      expect(client.chain.id).toBe(1)
    })

    it('should reuse clients for same chain', () => {
      const client1 = service.getClient(8453)
      const client2 = service.getClient(8453)
      expect(client1).toBe(client2)
    })

    it('should create different clients for different chains', () => {
      const ethClient = service.getClient(1)
      const baseClient = service.getClient(8453)
      expect(ethClient).not.toBe(baseClient)
      expect(ethClient.chain.id).toBe(1)
      expect(baseClient.chain.id).toBe(8453)
    })
  })

  describe('SupportedChainId type', () => {
    it('should only allow valid chain IDs', () => {
      const validChainIds: SupportedChainId[] = [1, 8453, 42161, 10, 56]
      expect(validChainIds).toHaveLength(5)
    })
  })
})
