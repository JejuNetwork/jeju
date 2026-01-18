/**
 * Security Engine Tests
 */

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import type { Address, Hex } from 'viem'
import { SecurityEngine, type TransactionToAnalyze } from './index'

// Mock the eden module
mock.module('../../../lib/eden', () => ({
  API_URLS: { gateway: 'https://mock-gateway.test' },
  fetchApi: mock(() =>
    Promise.resolve({
      addresses: ['0xscam1', '0xscam2'],
      lastUpdated: new Date().toISOString(),
    }),
  ),
}))

// Mock the RPC service
const mockCall = mock(() => Promise.resolve({ data: '0x' }))
const mockEstimateGas = mock(() => Promise.resolve(21000n))
const mockGetClient = mock(() => ({
  call: mockCall,
  estimateGas: mockEstimateGas,
}))

mock.module('../rpc', () => ({
  rpcService: { getClient: mockGetClient },
  SUPPORTED_CHAINS: { 1: { name: 'Ethereum' } },
}))

describe('SecurityEngine', () => {
  let engine: SecurityEngine

  beforeEach(() => {
    engine = new SecurityEngine()
    mockCall.mockClear()
    mockEstimateGas.mockClear()
  })

  afterAll(() => {
    // Ensure module mocks do not leak into other test files
    mock.restore()
  })

  describe('analyzeTransaction', () => {
    const baseTx: TransactionToAnalyze = {
      chainId: 1,
      from: '0x1234567890123456789012345678901234567890' as Address,
      to: '0xabcdef0123456789abcdef0123456789abcdef01' as Address,
      value: 0n,
      data: '0x' as Hex,
    }

    it('should return safe analysis for simple transfer', async () => {
      const analysis = await engine.analyzeTransaction(baseTx)

      expect(analysis.overallRisk).toBe('low') // Low because new recipient
      expect(analysis.approvedForExecution).toBe(true)
      expect(analysis.simulation?.success).toBe(true)
    })

    it('should detect unlimited approval', async () => {
      const approveData =
        '0x095ea7b3' + // approve selector
        '0000000000000000000000001234567890123456789012345678901234567890' + // spender
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' // max uint256

      const tx: TransactionToAnalyze = {
        ...baseTx,
        data: approveData as Hex,
      }

      const analysis = await engine.analyzeTransaction(tx)

      expect(analysis.overallRisk).toBe('high')
      const approvalRule = analysis.ruleResults.find(
        (r) => r.ruleId === 'unlimited_approval',
      )
      expect(approvalRule?.triggered).toBe(true)
    })

    it('should detect high value transfers', async () => {
      const tx: TransactionToAnalyze = {
        ...baseTx,
        value: 2000000000000000000n, // 2 ETH
      }

      const analysis = await engine.analyzeTransaction(tx)

      const highValueRule = analysis.ruleResults.find(
        (r) => r.ruleId === 'high_value_transfer',
      )
      expect(highValueRule?.triggered).toBe(true)
      expect(highValueRule?.level).toBe('medium')
    })

    it('should detect high gas costs', async () => {
      const tx: TransactionToAnalyze = {
        ...baseTx,
        gasLimit: 1000000n,
        gasPrice: 200000000000n, // 200 gwei
      }

      const analysis = await engine.analyzeTransaction(tx)

      const gasRule = analysis.ruleResults.find(
        (r) => r.ruleId === 'gas_too_high',
      )
      expect(gasRule?.triggered).toBe(true)
    })

    it('should handle simulation failures', async () => {
      // Create a new engine with failing RPC mock
      mockCall.mockImplementation(() => Promise.reject(new Error('Revert')))

      const analysis = await engine.analyzeTransaction(baseTx)

      // When simulation throws, it should return { success: false } or add simulation_failed rule
      const simRule = analysis.ruleResults.find(
        (r) => r.ruleId === 'simulation_failed',
      )
      // Either simulation.success is false, or simulation_failed rule is triggered
      const hasSimFailure =
        analysis.simulation?.success === false || simRule?.triggered === true
      expect(hasSimFailure).toBe(true)

      // Restore mock for other tests
      mockCall.mockImplementation(() => Promise.resolve({ data: '0x' }))
    })
  })

  describe('whitelist/blacklist', () => {
    const testAddress = '0x1234567890123456789012345678901234567890' as Address

    it('should add address to whitelist', () => {
      engine.addToWhitelist(testAddress, 'address')
      expect(engine.isWhitelisted(testAddress)).toBe(true)
    })

    it('should detect blacklisted address', async () => {
      const scamAddress =
        '0xbad0000000000000000000000000000000000bad' as Address
      engine.addToBlacklist(scamAddress, 'address')

      const tx: TransactionToAnalyze = {
        chainId: 1,
        from: '0x1111111111111111111111111111111111111111' as Address,
        to: scamAddress,
        value: 0n,
        data: '0x' as Hex,
      }

      const analysis = await engine.analyzeTransaction(tx)

      const scamRule = analysis.ruleResults.find(
        (r) => r.ruleId === 'known_scam_address',
      )
      expect(scamRule?.triggered).toBe(true)
      expect(scamRule?.level).toBe('critical')
    })
  })

  describe('utility methods', () => {
    it('should return correct risk level colors', () => {
      expect(engine.getRiskLevelColor('safe')).toBe('#22c55e')
      expect(engine.getRiskLevelColor('critical')).toBe('#ef4444')
    })

    it('should return correct risk level labels', () => {
      expect(engine.getRiskLevelLabel('safe')).toBe('Safe')
      expect(engine.getRiskLevelLabel('critical')).toBe(
        'Critical - Do Not Proceed',
      )
    })
  })
})
