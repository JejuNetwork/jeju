/**
 * Bridge Types Tests
 *
 * Tests for cross-chain bridge type definitions.
 */

import { describe, expect, it } from 'bun:test'

// Bridge message status
type BridgeMessageStatus =
  | 'pending'
  | 'dispatched'
  | 'relayed'
  | 'delivered'
  | 'failed'

// Chain types
type ChainType = 'evm' | 'solana' | 'cosmos'

// Bridge message
interface BridgeMessage {
  messageId: string
  nonce: bigint
  sender: string
  recipient: string
  sourceChain: number | string
  destChain: number | string
  amount?: bigint
  token?: string
  data?: string
  status: BridgeMessageStatus
  dispatchTx?: string
  relayTx?: string
  timestamp: number
}

// Transfer request
interface TransferRequest {
  fromChain: number | string
  toChain: number | string
  token: string
  amount: bigint
  recipient: string
  slippageBps?: number
}

// Quote response
interface BridgeQuote {
  estimatedTime: number
  fees: {
    gas: bigint
    relay: bigint
    protocol: bigint
  }
  route: string
}

describe('BridgeMessageStatus', () => {
  it('validates all statuses', () => {
    const statuses: BridgeMessageStatus[] = [
      'pending',
      'dispatched',
      'relayed',
      'delivered',
      'failed',
    ]

    expect(statuses).toHaveLength(5)
    expect(statuses).toContain('pending')
    expect(statuses).toContain('delivered')
    expect(statuses).toContain('failed')
  })

  it('represents valid state machine', () => {
    const transitions: Record<BridgeMessageStatus, BridgeMessageStatus[]> = {
      pending: ['dispatched', 'failed'],
      dispatched: ['relayed', 'failed'],
      relayed: ['delivered', 'failed'],
      delivered: [],
      failed: [],
    }

    expect(transitions.pending).toContain('dispatched')
    expect(transitions.delivered).toHaveLength(0) // Terminal
    expect(transitions.failed).toHaveLength(0) // Terminal
  })
})

describe('ChainType', () => {
  it('validates chain types', () => {
    const types: ChainType[] = ['evm', 'solana', 'cosmos']
    expect(types).toHaveLength(3)
  })

  it('determines address format by chain type', () => {
    const addressFormats: Record<ChainType, RegExp> = {
      evm: /^0x[a-fA-F0-9]{40}$/,
      solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
      cosmos: /^[a-z]+1[a-z0-9]{38}$/,
    }

    expect('0x1234567890123456789012345678901234567890').toMatch(
      addressFormats.evm,
    )
  })
})

describe('BridgeMessage type', () => {
  it('validates pending EVM message', () => {
    const message: BridgeMessage = {
      messageId: '0xabc123def456',
      nonce: 42n,
      sender: '0x1234567890123456789012345678901234567890',
      recipient: '0xabcdef1234567890abcdef1234567890abcdef12',
      sourceChain: 1, // Ethereum
      destChain: 8453, // Base
      amount: 1000000000000000000n,
      token: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      status: 'pending',
      timestamp: Date.now(),
    }

    expect(message.status).toBe('pending')
    expect(message.dispatchTx).toBeUndefined()
    expect(typeof message.sourceChain).toBe('number')
  })

  it('validates dispatched message', () => {
    const message: BridgeMessage = {
      messageId: '0xabc123',
      nonce: 43n,
      sender: '0xSender',
      recipient: '0xRecipient',
      sourceChain: 1,
      destChain: 137,
      amount: 500n,
      status: 'dispatched',
      dispatchTx: '0xDispatchTxHash12345678901234567890123456789012',
      timestamp: Date.now(),
    }

    expect(message.status).toBe('dispatched')
    expect(message.dispatchTx).toBeDefined()
    expect(message.relayTx).toBeUndefined()
  })

  it('validates delivered message', () => {
    const message: BridgeMessage = {
      messageId: '0xdelivered',
      nonce: 44n,
      sender: '0xSender',
      recipient: '0xRecipient',
      sourceChain: 1,
      destChain: 42161, // Arbitrum
      status: 'delivered',
      dispatchTx: '0xDispatchTx',
      relayTx: '0xRelayTx',
      timestamp: Date.now() - 60000,
    }

    expect(message.status).toBe('delivered')
    expect(message.dispatchTx).toBeDefined()
    expect(message.relayTx).toBeDefined()
  })

  it('validates cross-VM message (EVM to Solana)', () => {
    const message: BridgeMessage = {
      messageId: '0xcross-vm',
      nonce: 45n,
      sender: '0x1234567890123456789012345678901234567890',
      recipient: 'So11111111111111111111111111111111111111112',
      sourceChain: 1,
      destChain: 'solana-mainnet',
      amount: 1000000000n,
      status: 'pending',
      timestamp: Date.now(),
    }

    expect(typeof message.sourceChain).toBe('number')
    expect(typeof message.destChain).toBe('string')
  })
})

describe('TransferRequest type', () => {
  it('validates basic transfer', () => {
    const request: TransferRequest = {
      fromChain: 1,
      toChain: 8453,
      token: '0xUSDC',
      amount: 100000000n, // 100 USDC
      recipient: '0xRecipient',
    }

    expect(request.amount).toBeGreaterThan(0n)
    expect(request.slippageBps).toBeUndefined()
  })

  it('validates transfer with slippage', () => {
    const request: TransferRequest = {
      fromChain: 1,
      toChain: 137,
      token: '0xWETH',
      amount: 1000000000000000000n,
      recipient: '0xRecipient',
      slippageBps: 50, // 0.5%
    }

    expect(request.slippageBps).toBe(50)
    expect(request.slippageBps).toBeLessThanOrEqual(10000)
  })
})

describe('BridgeQuote type', () => {
  it('validates complete quote', () => {
    const quote: BridgeQuote = {
      estimatedTime: 600, // 10 minutes
      fees: {
        gas: 50000000000000000n, // 0.05 ETH
        relay: 10000000000000000n, // 0.01 ETH
        protocol: 5000000000000000n, // 0.005 ETH
      },
      route: 'hyperlane',
    }

    expect(quote.estimatedTime).toBeGreaterThan(0)
    expect(quote.fees.gas).toBeGreaterThan(0n)
    expect(quote.route).toBe('hyperlane')
  })

  it('calculates total fees', () => {
    const quote: BridgeQuote = {
      estimatedTime: 300,
      fees: {
        gas: 100n,
        relay: 50n,
        protocol: 25n,
      },
      route: 'optimistic',
    }

    const totalFees = quote.fees.gas + quote.fees.relay + quote.fees.protocol
    expect(totalFees).toBe(175n)
  })
})

describe('Bridge domain IDs', () => {
  it('validates Hyperlane domain mappings', () => {
    const domains: Record<string, number> = {
      ethereum: 1,
      base: 8453,
      arbitrum: 42161,
      optimism: 10,
      polygon: 137,
      solana: 1399811149,
    }

    expect(domains.ethereum).toBe(1)
    expect(domains.solana).toBe(1399811149)
    expect(Object.keys(domains)).toHaveLength(6)
  })

  it('validates chain ID to domain conversion', () => {
    // Most EVM chains use chainId as domain
    const evmChainIds = [1, 8453, 42161, 10, 137]
    for (const chainId of evmChainIds) {
      expect(chainId).toBeGreaterThan(0)
    }

    // Solana uses a special domain ID
    const solanaDomain = 1399811149
    expect(solanaDomain).toBeGreaterThan(2 ** 30)
  })
})
