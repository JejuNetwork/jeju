/**
 * Wallet Core Tests
 * Tests for EIP-1193 provider interface, account management, and chain operations
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import type { Address } from 'viem'
import { createWalletCore, WalletCore } from './wallet-core'

// Test addresses
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address

describe('WalletCore', () => {
  let wallet: WalletCore

  beforeEach(() => {
    wallet = createWalletCore({
      defaultChainId: 1,
      useNetworkRpc: true,
    })
  })

  afterEach(() => {
    wallet.lock()
  })

  describe('Lock State Management', () => {
    it('should start locked', () => {
      expect(wallet.isUnlocked()).toBe(false)
    })

    it('should unlock with password', async () => {
      const result = await wallet.unlock('testpassword')

      expect(result).toBe(true)
      expect(wallet.isUnlocked()).toBe(true)
    })

    it('should throw on empty password', async () => {
      await expect(wallet.unlock('')).rejects.toThrow()
    })

    it('should lock and clear state', async () => {
      await wallet.unlock('password')
      expect(wallet.isUnlocked()).toBe(true)

      wallet.lock()
      expect(wallet.isUnlocked()).toBe(false)
    })
  })

  describe('Account Management', () => {
    it('should start with empty accounts', () => {
      const accounts = wallet.getAccounts()
      expect(accounts).toEqual([])
    })

    it('should add EOA account', async () => {
      const account = await wallet.addAccount({
        type: 'eoa',
        label: 'My Account',
      })

      expect(account).toBeDefined()
      expect(account.label).toBe('My Account')
      expect(account.evmAccounts).toBeDefined()
    })

    it('should auto-generate label when not provided', async () => {
      const account = await wallet.addAccount({ type: 'eoa' })

      expect(account.label).toBe('Account 1')
    })

    it('should return undefined for non-existent active account', () => {
      const activeAccount = wallet.getActiveAccount()
      expect(activeAccount).toBeUndefined()
    })

    it('should set first account as active', async () => {
      const account = await wallet.addAccount({ type: 'eoa' })

      const activeAccount = wallet.getActiveAccount()
      expect(activeAccount?.id).toBe(account.id)
    })

    it('should switch active account', async () => {
      const account1 = await wallet.addAccount({
        type: 'eoa',
        label: 'Account 1',
      })
      const account2 = await wallet.addAccount({
        type: 'eoa',
        label: 'Account 2',
      })

      expect(wallet.getActiveAccount()?.id).toBe(account1.id)

      wallet.setActiveAccount(account2.id)
      expect(wallet.getActiveAccount()?.id).toBe(account2.id)
    })

    it('should ignore invalid account id for setActiveAccount', async () => {
      const account = await wallet.addAccount({ type: 'eoa' })

      wallet.setActiveAccount('non-existent-id')

      // Should still be the first account
      expect(wallet.getActiveAccount()?.id).toBe(account.id)
    })
  })

  describe('Chain Management', () => {
    it('should return default chain id', () => {
      const chainId = wallet.getActiveChainId()
      expect(chainId).toBe(1)
    })

    it('should switch to valid chain', async () => {
      await wallet.switchChain(8453)

      expect(wallet.getActiveChainId()).toBe(8453)
    })

    it('should throw for unsupported chain', async () => {
      await expect(wallet.switchChain(999999)).rejects.toThrow(
        'Chain 999999 not supported',
      )
    })

    it('should list supported chains', () => {
      const chains = wallet.getSupportedChains()

      expect(chains).toContain(1) // Ethereum
      expect(chains).toContain(8453) // Base
      expect(chains).toContain(42161) // Arbitrum
    })
  })

  describe('EIP-1193 Provider Interface', () => {
    describe('eth_accounts', () => {
      it('should return empty array when no accounts', async () => {
        const result = await wallet.request({ method: 'eth_accounts' })

        expect(result).toEqual([])
      })
    })

    describe('eth_chainId', () => {
      it('should return chain id as hex', async () => {
        const result = await wallet.request({ method: 'eth_chainId' })

        expect(result).toBe('0x1') // Mainnet
      })

      it('should return updated chain id after switch', async () => {
        await wallet.switchChain(8453)

        const result = await wallet.request({ method: 'eth_chainId' })

        expect(result).toBe('0x2105') // Base = 8453 = 0x2105
      })
    })

    describe('wallet_switchEthereumChain', () => {
      it('should switch chain via EIP-1193', async () => {
        const result = await wallet.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x2105' }], // Base
        })

        expect(result).toBeNull()
        expect(wallet.getActiveChainId()).toBe(8453)
      })
    })

    describe('wallet_addEthereumChain', () => {
      it('should return null (simplified implementation)', async () => {
        const result = await wallet.request({
          method: 'wallet_addEthereumChain',
          params: [{ chainId: '0x89' }], // Polygon
        })

        expect(result).toBeNull()
      })
    })

    describe('unsupported methods', () => {
      it('should throw for unsupported method', async () => {
        await expect(
          wallet.request({ method: 'eth_unsupportedMethod' }),
        ).rejects.toThrow('Method eth_unsupportedMethod not supported')
      })
    })
  })

  describe('Cross-Chain Clients', () => {
    describe('getEILClient', () => {
      it('should return EIL client for active chain', () => {
        const eilClient = wallet.getEILClient()
        expect(eilClient).toBeDefined()
      })

      it('should return EIL client for specific chain', () => {
        const eilClient = wallet.getEILClient(8453)
        expect(eilClient).toBeDefined()
      })

      it('should throw for unconfigured chain', () => {
        expect(() => wallet.getEILClient(999999)).toThrow(
          'EIL not configured for chain 999999',
        )
      })
    })

    describe('getOIFClient', () => {
      it('should return OIF client for active chain', () => {
        const oifClient = wallet.getOIFClient()
        expect(oifClient).toBeDefined()
      })

      it('should return OIF client for specific chain', () => {
        const oifClient = wallet.getOIFClient(8453)
        expect(oifClient).toBeDefined()
      })

      it('should throw for unconfigured chain', () => {
        expect(() => wallet.getOIFClient(999999)).toThrow(
          'OIF not configured for chain 999999',
        )
      })
    })

    describe('getAAClient', () => {
      it('should return AA client for active chain', () => {
        const aaClient = wallet.getAAClient()
        expect(aaClient).toBeDefined()
      })

      it('should return AA client for specific chain', () => {
        const aaClient = wallet.getAAClient(8453)
        expect(aaClient).toBeDefined()
      })

      it('should throw for unconfigured chain', () => {
        expect(() => wallet.getAAClient(999999)).toThrow(
          'AA not configured for chain 999999',
        )
      })
    })

    describe('getGasService', () => {
      it('should return gas service', () => {
        const gasService = wallet.getGasService()
        expect(gasService).toBeDefined()
      })
    })
  })

  describe('Site Connections', () => {
    it('should not be connected initially', () => {
      const isConnected = wallet.isConnected('https://example.com')
      expect(isConnected).toBe(false)
    })

    it('should connect and store site', async () => {
      await wallet.addAccount({
        type: 'eoa',
        label: 'Test',
      })

      // Manually set up an EVM account for connection test
      const account = wallet.getActiveAccount()
      if (account) {
        account.evmAccounts = [{ address: TEST_ADDRESS, chainId: 1 }]
      }

      const addresses = await wallet.connect('https://example.com')

      expect(addresses).toHaveLength(1)
      expect(wallet.isConnected('https://example.com')).toBe(true)
    })

    it('should disconnect site', async () => {
      await wallet.addAccount({ type: 'eoa' })
      const account = wallet.getActiveAccount()
      if (account) {
        account.evmAccounts = [{ address: TEST_ADDRESS, chainId: 1 }]
      }

      await wallet.connect('https://example.com')
      expect(wallet.isConnected('https://example.com')).toBe(true)

      wallet.disconnect('https://example.com')
      expect(wallet.isConnected('https://example.com')).toBe(false)
    })

    it('should throw on connect without account', async () => {
      await expect(wallet.connect('https://example.com')).rejects.toThrow(
        'No account available',
      )
    })
  })

  describe('Event System', () => {
    it('should emit connect event on unlock', async () => {
      const callback = mock(() => {})
      const unsubscribe = wallet.on('connect', callback)

      await wallet.unlock('password')

      expect(callback).toHaveBeenCalledWith({
        type: 'connect',
        chainId: 1,
      })

      unsubscribe()
    })

    it('should emit disconnect event on lock', async () => {
      await wallet.unlock('password')

      const callback = mock(() => {})
      const unsubscribe = wallet.on('disconnect', callback)

      wallet.lock()

      expect(callback).toHaveBeenCalledWith({ type: 'disconnect' })

      unsubscribe()
    })

    it('should emit chainChanged on chain switch', async () => {
      const callback = mock(() => {})
      const unsubscribe = wallet.on('chainChanged', callback)

      await wallet.switchChain(8453)

      expect(callback).toHaveBeenCalledWith({
        type: 'chainChanged',
        chainId: 8453,
      })

      unsubscribe()
    })

    it('should unsubscribe correctly', async () => {
      const callback = mock(() => {})
      const unsubscribe = wallet.on('chainChanged', callback)

      unsubscribe()

      await wallet.switchChain(8453)

      expect(callback).not.toHaveBeenCalled()
    })
  })

  describe('Factory Function', () => {
    it('should create WalletCore with default config', () => {
      const walletCore = createWalletCore()

      expect(walletCore).toBeInstanceOf(WalletCore)
      expect(walletCore.getActiveChainId()).toBe(1) // Default
    })

    it('should create WalletCore with custom config', () => {
      const walletCore = createWalletCore({
        defaultChainId: 8453,
        bundlerUrl: 'https://custom.bundler.com',
      })

      expect(walletCore).toBeInstanceOf(WalletCore)
      expect(walletCore.getActiveChainId()).toBe(8453)
    })
  })
})
