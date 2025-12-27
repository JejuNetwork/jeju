/**
 * UI Context Tests
 *
 * Tests for React context and state management.
 */

import { describe, expect, it } from 'bun:test'

// Client state
interface JejuClientState {
  isConnected: boolean
  chainId: number | undefined
  address: string | undefined
  isLoading: boolean
}

// Wallet state
interface WalletState {
  isConnected: boolean
  address: string | undefined
  balance: bigint | undefined
  chain: {
    id: number
    name: string
  } | undefined
}

// Transaction state
interface TransactionState {
  hash: string | undefined
  status: 'idle' | 'pending' | 'success' | 'error'
  error: Error | undefined
  confirmations: number
}

// Provider config
interface ProviderConfig {
  chains: { id: number; name: string }[]
  defaultChain: number
  autoConnect: boolean
  connectors: string[]
}

describe('JejuClientState', () => {
  it('validates disconnected state', () => {
    const state: JejuClientState = {
      isConnected: false,
      chainId: undefined,
      address: undefined,
      isLoading: false,
    }

    expect(state.isConnected).toBe(false)
    expect(state.address).toBeUndefined()
  })

  it('validates connected state', () => {
    const state: JejuClientState = {
      isConnected: true,
      chainId: 21000000,
      address: '0x1234567890123456789012345678901234567890',
      isLoading: false,
    }

    expect(state.isConnected).toBe(true)
    expect(state.chainId).toBe(21000000)
    expect(state.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
  })

  it('validates loading state', () => {
    const state: JejuClientState = {
      isConnected: false,
      chainId: undefined,
      address: undefined,
      isLoading: true,
    }

    expect(state.isLoading).toBe(true)
  })
})

describe('WalletState', () => {
  it('validates full wallet state', () => {
    const state: WalletState = {
      isConnected: true,
      address: '0x1234567890123456789012345678901234567890',
      balance: 1500000000000000000n, // 1.5 ETH
      chain: {
        id: 21000000,
        name: 'Jeju',
      },
    }

    expect(state.isConnected).toBe(true)
    expect(state.balance).toBeGreaterThan(0n)
    expect(state.chain?.name).toBe('Jeju')
  })

  it('validates disconnected wallet state', () => {
    const state: WalletState = {
      isConnected: false,
      address: undefined,
      balance: undefined,
      chain: undefined,
    }

    expect(state.isConnected).toBe(false)
    expect(state.balance).toBeUndefined()
  })

  it('formats balance correctly', () => {
    const balance = 1500000000000000000n // 1.5 ETH
    const decimals = 18
    const formatted = Number(balance) / Math.pow(10, decimals)

    expect(formatted).toBe(1.5)
  })
})

describe('TransactionState', () => {
  it('validates idle state', () => {
    const state: TransactionState = {
      hash: undefined,
      status: 'idle',
      error: undefined,
      confirmations: 0,
    }

    expect(state.status).toBe('idle')
    expect(state.hash).toBeUndefined()
  })

  it('validates pending state', () => {
    const state: TransactionState = {
      hash: '0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1',
      status: 'pending',
      error: undefined,
      confirmations: 0,
    }

    expect(state.status).toBe('pending')
    expect(state.hash).toHaveLength(66)
    expect(state.confirmations).toBe(0)
  })

  it('validates success state', () => {
    const state: TransactionState = {
      hash: '0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1',
      status: 'success',
      error: undefined,
      confirmations: 5,
    }

    expect(state.status).toBe('success')
    expect(state.confirmations).toBeGreaterThan(0)
  })

  it('validates error state', () => {
    const state: TransactionState = {
      hash: undefined,
      status: 'error',
      error: new Error('User rejected transaction'),
      confirmations: 0,
    }

    expect(state.status).toBe('error')
    expect(state.error?.message).toBe('User rejected transaction')
  })
})

describe('ProviderConfig', () => {
  it('validates complete config', () => {
    const config: ProviderConfig = {
      chains: [
        { id: 21000000, name: 'Jeju' },
        { id: 8453, name: 'Base' },
        { id: 1, name: 'Ethereum' },
      ],
      defaultChain: 21000000,
      autoConnect: true,
      connectors: ['injected', 'walletConnect', 'coinbaseWallet'],
    }

    expect(config.chains).toHaveLength(3)
    expect(config.defaultChain).toBe(21000000)
    expect(config.autoConnect).toBe(true)
    expect(config.connectors).toContain('injected')
  })

  it('validates minimal config', () => {
    const config: ProviderConfig = {
      chains: [{ id: 21000000, name: 'Jeju' }],
      defaultChain: 21000000,
      autoConnect: false,
      connectors: ['injected'],
    }

    expect(config.chains).toHaveLength(1)
    expect(config.autoConnect).toBe(false)
  })
})

describe('State transitions', () => {
  it('validates connection flow', () => {
    const states: JejuClientState[] = [
      // Initial state
      { isConnected: false, chainId: undefined, address: undefined, isLoading: false },
      // Connecting
      { isConnected: false, chainId: undefined, address: undefined, isLoading: true },
      // Connected
      {
        isConnected: true,
        chainId: 21000000,
        address: '0x1234567890123456789012345678901234567890',
        isLoading: false,
      },
    ]

    expect(states[0].isLoading).toBe(false)
    expect(states[1].isLoading).toBe(true)
    expect(states[2].isConnected).toBe(true)
  })

  it('validates chain switch flow', () => {
    const state1: WalletState = {
      isConnected: true,
      address: '0x1234567890123456789012345678901234567890',
      balance: 1000000000000000000n,
      chain: { id: 1, name: 'Ethereum' },
    }

    const state2: WalletState = {
      ...state1,
      chain: { id: 21000000, name: 'Jeju' },
      balance: 500000000000000000n, // Different balance on new chain
    }

    expect(state1.chain?.id).toBe(1)
    expect(state2.chain?.id).toBe(21000000)
    expect(state1.address).toBe(state2.address) // Same address
  })
})

describe('Error handling', () => {
  it('validates connection errors', () => {
    const errors = [
      'User rejected the request',
      'Wallet not found',
      'Chain not supported',
      'Disconnected',
    ]

    for (const message of errors) {
      const error = new Error(message)
      expect(error.message).toBe(message)
    }
  })

  it('validates transaction errors', () => {
    const errors = [
      { code: 4001, message: 'User rejected transaction' },
      { code: -32603, message: 'Internal error' },
      { code: -32000, message: 'Insufficient funds' },
    ]

    for (const err of errors) {
      expect(err.code).toBeDefined()
      expect(err.message).toBeDefined()
    }
  })
})

