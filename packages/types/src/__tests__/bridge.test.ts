/**
 * @fileoverview Comprehensive tests for bridge.ts
 *
 * Tests cover:
 * - BridgeTransferStatusSchema: Transfer status validation
 * - BridgeTransferSchema: Full transfer record validation
 * - BridgeConfigSchema: Bridge configuration validation
 * - BridgeEstimateSchema: Gas/cost estimate validation
 * - BridgeEventTypeSchema: Event type validation
 * - BridgeEventLogSchema: Event log validation
 */

import { describe, expect, test } from 'bun:test'
import {
  type BridgeConfig,
  BridgeConfigSchema,
  type BridgeEstimate,
  BridgeEstimateSchema,
  type BridgeEventLog,
  BridgeEventLogSchema,
  BridgeEventTypeSchema,
  type BridgeTransfer,
  BridgeTransferSchema,
  type BridgeTransferStatus,
  BridgeTransferStatusSchema,
} from '../bridge'

const TEST_ADDRESS = '0x1234567890123456789012345678901234567890'
const TEST_ADDRESS_2 = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

describe('BridgeTransferStatusSchema', () => {
  const validStatuses: BridgeTransferStatus[] = [
    'pending',
    'submitted',
    'relaying',
    'completed',
    'failed',
  ]

  const invalidStatuses = ['active', 'cancelled', 'processing', '']

  test.each(validStatuses)('accepts valid status: %s', (status) => {
    const result = BridgeTransferStatusSchema.safeParse(status)
    expect(result.success).toBe(true)
  })

  test.each(invalidStatuses)('rejects invalid status: %s', (status) => {
    const result = BridgeTransferStatusSchema.safeParse(status)
    expect(result.success).toBe(false)
  })
})

describe('BridgeTransferSchema', () => {
  const validTransfer: BridgeTransfer = {
    id: 'transfer-123',
    token: TEST_ADDRESS,
    tokenSymbol: 'ETH',
    amount: '1000000000000000000',
    from: TEST_ADDRESS,
    to: TEST_ADDRESS_2,
    sourceChain: 'ethereum',
    destinationChain: 'jeju',
    status: 'pending',
    submittedAt: Date.now(),
    estimatedCompletionTime: Date.now() + 3600000,
    bridgeContract: TEST_ADDRESS,
    messengerContract: TEST_ADDRESS_2,
  }

  test('accepts valid transfer', () => {
    const result = BridgeTransferSchema.safeParse(validTransfer)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe('transfer-123')
      expect(result.data.status).toBe('pending')
    }
  })

  test('accepts transfer with optional tx hashes', () => {
    const transfer = {
      ...validTransfer,
      sourceTxHash: `0x${'a'.repeat(64)}`,
      destinationTxHash: `0x${'b'.repeat(64)}`,
      completedAt: Date.now() + 1800000,
    }

    const result = BridgeTransferSchema.safeParse(transfer)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sourceTxHash).toBe(`0x${'a'.repeat(64)}`)
    }
  })

  test('rejects invalid status', () => {
    const transfer = {
      ...validTransfer,
      status: 'invalid',
    }
    expect(BridgeTransferSchema.safeParse(transfer).success).toBe(false)
  })

  test('rejects invalid address', () => {
    const transfer = {
      ...validTransfer,
      from: '0xinvalid',
    }
    expect(BridgeTransferSchema.safeParse(transfer).success).toBe(false)
  })

  test('rejects missing required fields', () => {
    const { id, ...withoutId } = validTransfer
    expect(BridgeTransferSchema.safeParse(withoutId).success).toBe(false)
  })
})

describe('BridgeConfigSchema', () => {
  const validConfig: BridgeConfig = {
    standardBridge: TEST_ADDRESS,
    crossDomainMessenger: TEST_ADDRESS_2,
    minGasLimit: 100000,
    estimatedConfirmationTime: 900,
    supportedTokens: [TEST_ADDRESS, TEST_ADDRESS_2],
  }

  test('accepts valid config', () => {
    const result = BridgeConfigSchema.safeParse(validConfig)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.minGasLimit).toBe(100000)
      expect(result.data.supportedTokens).toHaveLength(2)
    }
  })

  test('accepts empty supportedTokens array', () => {
    const config = {
      ...validConfig,
      supportedTokens: [],
    }

    const result = BridgeConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.supportedTokens).toHaveLength(0)
    }
  })

  test('rejects invalid address in supportedTokens', () => {
    const config = {
      ...validConfig,
      supportedTokens: [TEST_ADDRESS, 'invalid'],
    }
    expect(BridgeConfigSchema.safeParse(config).success).toBe(false)
  })

  test('rejects missing required fields', () => {
    const { standardBridge, ...withoutBridge } = validConfig
    expect(BridgeConfigSchema.safeParse(withoutBridge).success).toBe(false)
  })
})

describe('BridgeEstimateSchema', () => {
  const validEstimate: BridgeEstimate = {
    token: TEST_ADDRESS,
    amount: '1000000000000000000',
    estimatedGas: '21000',
    estimatedCost: '0.001',
    estimatedTime: 900,
    route: ['ethereum', 'jeju'],
  }

  test('accepts valid estimate', () => {
    const result = BridgeEstimateSchema.safeParse(validEstimate)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.estimatedTime).toBe(900)
      expect(result.data.route).toEqual(['ethereum', 'jeju'])
    }
  })

  test('accepts complex route', () => {
    const estimate = {
      ...validEstimate,
      route: ['ethereum', 'optimism', 'jeju'],
    }

    const result = BridgeEstimateSchema.safeParse(estimate)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.route).toHaveLength(3)
    }
  })

  test('rejects missing required fields', () => {
    const { token, ...withoutToken } = validEstimate
    expect(BridgeEstimateSchema.safeParse(withoutToken).success).toBe(false)
  })
})

describe('BridgeEventTypeSchema', () => {
  const validEventTypes = [
    'ERC20BridgeInitiated',
    'ERC20BridgeFinalized',
    'ETHBridgeInitiated',
    'ETHBridgeFinalized',
  ]

  const invalidEventTypes = [
    'BridgeStarted',
    'TransferComplete',
    'erc20bridgeinitiated', // lowercase
    '',
  ]

  test.each(validEventTypes)('accepts valid event type: %s', (eventType) => {
    expect(BridgeEventTypeSchema.safeParse(eventType).success).toBe(true)
  })

  test.each(
    invalidEventTypes,
  )('rejects invalid event type: %s', (eventType) => {
    expect(BridgeEventTypeSchema.safeParse(eventType).success).toBe(false)
  })
})

describe('BridgeEventLogSchema', () => {
  const validEventLog: BridgeEventLog = {
    event: 'ERC20BridgeInitiated',
    from: TEST_ADDRESS,
    to: TEST_ADDRESS_2,
    amount: '1000000000000000000',
    localToken: TEST_ADDRESS,
    remoteToken: TEST_ADDRESS_2,
    extraData: '0x',
    transactionHash: `0x${'a'.repeat(64)}`,
    blockNumber: 12345678,
    timestamp: Date.now(),
  }

  test('accepts valid event log', () => {
    const result = BridgeEventLogSchema.safeParse(validEventLog)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.event).toBe('ERC20BridgeInitiated')
      expect(result.data.blockNumber).toBe(12345678)
    }
  })

  test('accepts zero block number', () => {
    const eventLog = {
      ...validEventLog,
      blockNumber: 0,
    }

    const result = BridgeEventLogSchema.safeParse(eventLog)
    expect(result.success).toBe(true)
  })

  test('rejects negative block number', () => {
    const eventLog = {
      ...validEventLog,
      blockNumber: -1,
    }
    expect(BridgeEventLogSchema.safeParse(eventLog).success).toBe(false)
  })

  test('rejects non-integer block number', () => {
    const eventLog = {
      ...validEventLog,
      blockNumber: 123.5,
    }
    expect(BridgeEventLogSchema.safeParse(eventLog).success).toBe(false)
  })

  test('rejects invalid event type', () => {
    const eventLog = {
      ...validEventLog,
      event: 'InvalidEvent',
    }
    expect(BridgeEventLogSchema.safeParse(eventLog).success).toBe(false)
  })

  test('rejects invalid address', () => {
    const eventLog = {
      ...validEventLog,
      from: '0xinvalid',
    }
    expect(BridgeEventLogSchema.safeParse(eventLog).success).toBe(false)
  })
})
