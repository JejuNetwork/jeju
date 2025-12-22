/**
 * Ledger Hardware Wallet Tests
 * Comprehensive tests for HD path derivation, RLP encoding, and transaction serialization
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import type { Address, Hex } from 'viem'
import { type LedgerHDPathType, LedgerKeyring } from './ledger'

// Mock functions for LedgerEth
const mockGetAddress = mock(() =>
  Promise.resolve({
    address: '0x1234567890abcdef1234567890abcdef12345678',
    publicKey:
      '04abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  }),
)

const mockSignTransaction = mock(() =>
  Promise.resolve({
    v: '1b',
    r: '0000000000000000000000000000000000000000000000000000000000000001',
    s: '0000000000000000000000000000000000000000000000000000000000000002',
  }),
)

const mockSignPersonalMessage = mock(() =>
  Promise.resolve({
    v: 27,
    r: '0000000000000000000000000000000000000000000000000000000000000001',
    s: '0000000000000000000000000000000000000000000000000000000000000002',
  }),
)

const mockSignEIP712Message = mock(() =>
  Promise.resolve({
    v: 27,
    r: '0000000000000000000000000000000000000000000000000000000000000001',
    s: '0000000000000000000000000000000000000000000000000000000000000002',
  }),
)

const mockSignEIP712HashedMessage = mock(() =>
  Promise.resolve({
    v: 27,
    r: '0000000000000000000000000000000000000000000000000000000000000001',
    s: '0000000000000000000000000000000000000000000000000000000000000002',
  }),
)

const mockClose = mock(() => Promise.resolve())

// Mock TransportWebHID
mock.module('@ledgerhq/hw-transport-webhid', () => ({
  default: {
    isSupported: mock(() => Promise.resolve(true)),
    create: mock(() =>
      Promise.resolve({
        close: mockClose,
      }),
    ),
  },
}))

// Mock LedgerEth
mock.module('@ledgerhq/hw-app-eth', () => ({
  default: mock(() => ({
    getAddress: mockGetAddress,
    signTransaction: mockSignTransaction,
    signPersonalMessage: mockSignPersonalMessage,
    signEIP712Message: mockSignEIP712Message,
    signEIP712HashedMessage: mockSignEIP712HashedMessage,
  })),
}))

describe('LedgerKeyring', () => {
  let keyring: LedgerKeyring

  beforeEach(() => {
    keyring = new LedgerKeyring()

    // Reset mocks with default implementations
    mockGetAddress.mockReset()
    mockSignTransaction.mockReset()
    mockSignPersonalMessage.mockReset()
    mockSignEIP712Message.mockReset()
    mockSignEIP712HashedMessage.mockReset()

    mockGetAddress.mockImplementation(() =>
      Promise.resolve({
        address: '0x1234567890abcdef1234567890abcdef12345678',
        publicKey:
          '04abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      }),
    )

    mockSignTransaction.mockImplementation(() =>
      Promise.resolve({
        v: '1b',
        r: '0000000000000000000000000000000000000000000000000000000000000001',
        s: '0000000000000000000000000000000000000000000000000000000000000002',
      }),
    )

    mockSignPersonalMessage.mockImplementation(() =>
      Promise.resolve({
        v: 27,
        r: '0000000000000000000000000000000000000000000000000000000000000001',
        s: '0000000000000000000000000000000000000000000000000000000000000002',
      }),
    )
  })

  afterEach(() => {
    mockGetAddress.mockReset()
    mockSignTransaction.mockReset()
    mockSignPersonalMessage.mockReset()
    mockSignEIP712Message.mockReset()
    mockSignEIP712HashedMessage.mockReset()
    mockClose.mockReset()
  })

  describe('WebHID Support', () => {
    it('should check WebHID support', async () => {
      const supported = await keyring.isSupported()
      expect(typeof supported).toBe('boolean')
    })
  })

  describe('Connection State', () => {
    it('should return false when not connected', () => {
      expect(keyring.isUnlocked()).toBe(false)
    })

    it('should connect and set unlocked state', async () => {
      await keyring.connect()
      expect(keyring.isUnlocked()).toBe(true)
    })

    it('should disconnect and clear state', async () => {
      await keyring.connect()
      expect(keyring.isUnlocked()).toBe(true)

      await keyring.disconnect()
      expect(keyring.isUnlocked()).toBe(false)
    })
  })

  describe('HD Path Derivation', () => {
    const pathTests: Array<{
      type: LedgerHDPathType
      expectedPaths: string[]
    }> = [
      {
        type: 'LedgerLive',
        expectedPaths: [
          "m/44'/60'/0'/0/0",
          "m/44'/60'/1'/0/0",
          "m/44'/60'/2'/0/0",
        ],
      },
      {
        type: 'BIP44',
        expectedPaths: [
          "m/44'/60'/0'/0/0",
          "m/44'/60'/0'/0/1",
          "m/44'/60'/0'/0/2",
        ],
      },
      {
        type: 'Legacy',
        expectedPaths: ["m/44'/60'/0'/0", "m/44'/60'/0'/1", "m/44'/60'/0'/2"],
      },
    ]

    pathTests.forEach(({ type, expectedPaths }) => {
      it(`should derive correct paths for ${type} derivation`, async () => {
        await keyring.connect()
        keyring.setHdPath(type)

        // Get 3 accounts starting at index 0
        await keyring.getAccounts(0, 3)

        // Verify getAddress was called with correct paths
        expect(mockGetAddress).toHaveBeenCalledTimes(3)
        expectedPaths.forEach((expectedPath, index) => {
          expect(mockGetAddress).toHaveBeenNthCalledWith(
            index + 1,
            expectedPath,
            false,
            true,
          )
        })
      })
    })

    it('should throw when getting accounts without connection', async () => {
      await expect(keyring.getAccounts()).rejects.toThrow(
        'Ledger not connected',
      )
    })

    it('should paginate account derivation correctly', async () => {
      await keyring.connect()
      keyring.setHdPath('BIP44')

      // Get accounts starting at index 5
      await keyring.getAccounts(5, 3)

      expect(mockGetAddress).toHaveBeenCalledWith(
        "m/44'/60'/0'/0/5",
        false,
        true,
      )
      expect(mockGetAddress).toHaveBeenCalledWith(
        "m/44'/60'/0'/0/6",
        false,
        true,
      )
      expect(mockGetAddress).toHaveBeenCalledWith(
        "m/44'/60'/0'/0/7",
        false,
        true,
      )
    })
  })

  describe('Account Management', () => {
    it('should add accounts to internal list', async () => {
      // Mock different addresses for each call
      let callCount = 0
      mockGetAddress.mockImplementation(() => {
        callCount++
        return Promise.resolve({
          address: `0x000000000000000000000000000000000000000${callCount}`,
          publicKey: `04pubkey${callCount}`,
        })
      })

      await keyring.connect()
      const accounts = await keyring.getAccounts(0, 2)

      await keyring.addAccounts(accounts.map((a) => a.address))

      const addresses = keyring.getAddresses()
      expect(addresses).toHaveLength(2)
    })

    it('should not duplicate accounts when adding', async () => {
      const address = '0x1234567890abcdef1234567890abcdef12345678' as Address

      await keyring.addAccounts([address])
      await keyring.addAccounts([address])

      expect(keyring.getAddresses()).toHaveLength(1)
    })
  })

  describe('Transaction Signing', () => {
    const testAddress = '0x1234567890abcdef1234567890abcdef12345678' as Address

    beforeEach(async () => {
      await keyring.connect()
      await keyring.getAccounts(0, 1)
      await keyring.addAccounts([testAddress])
    })

    it('should sign EIP-1559 transaction', async () => {
      const tx = {
        to: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as Address,
        value: 1000000000000000000n,
        data: '0x' as Hex,
        nonce: 0,
        gasLimit: 21000n,
        maxFeePerGas: 20000000000n,
        maxPriorityFeePerGas: 1000000000n,
        chainId: 1,
      }

      const signedTx = await keyring.signTransaction(testAddress, tx)

      expect(signedTx).toMatch(/^0x/)
      expect(mockSignTransaction).toHaveBeenCalled()

      // Verify the raw transaction passed to Ledger doesn't have 0x prefix
      const rawTxArg = mockSignTransaction.mock.calls[0][1]
      expect(rawTxArg.startsWith('0x')).toBe(false)
    })

    it('should sign legacy transaction', async () => {
      const tx = {
        to: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as Address,
        value: 1000000000000000000n,
        data: '0x' as Hex,
        nonce: 5,
        gasLimit: 21000n,
        gasPrice: 20000000000n,
        chainId: 1,
      }

      const signedTx = await keyring.signTransaction(testAddress, tx)

      expect(signedTx).toMatch(/^0x/)
      expect(mockSignTransaction).toHaveBeenCalled()
    })

    it('should throw for unknown address', async () => {
      const unknownAddress =
        '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as Address
      const tx = {
        to: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as Address,
        value: 1n,
        data: '0x' as Hex,
        nonce: 0,
        gasLimit: 21000n,
        gasPrice: 1n,
        chainId: 1,
      }

      await expect(keyring.signTransaction(unknownAddress, tx)).rejects.toThrow(
        'Address not found in Ledger accounts',
      )
    })
  })

  describe('Message Signing', () => {
    const testAddress = '0x1234567890abcdef1234567890abcdef12345678' as Address

    beforeEach(async () => {
      await keyring.connect()
      await keyring.getAccounts(0, 1)
      await keyring.addAccounts([testAddress])
    })

    it('should sign personal message', async () => {
      const message = 'Hello, Ledger!'

      const signature = await keyring.signMessage(testAddress, message)

      // Signature should be 65 bytes (r: 32, s: 32, v: 1)
      expect(signature).toMatch(/^0x[a-fA-F0-9]{130}$/)
      expect(mockSignPersonalMessage).toHaveBeenCalled()

      // Verify message was hex encoded
      const msgHexArg = mockSignPersonalMessage.mock.calls[0][1]
      expect(msgHexArg).toBe(Buffer.from(message).toString('hex'))
    })

    it('should handle v value less than 27', async () => {
      mockSignPersonalMessage.mockImplementation(() =>
        Promise.resolve({
          v: 0, // Some Ledger versions return 0 or 1
          r: '0000000000000000000000000000000000000000000000000000000000000001',
          s: '0000000000000000000000000000000000000000000000000000000000000002',
        }),
      )

      const signature = await keyring.signMessage(testAddress, 'test')

      // v should be normalized to 27+
      const vHex = signature.slice(-2)
      const vNum = parseInt(vHex, 16)
      expect(vNum).toBeGreaterThanOrEqual(27)
    })

    it('should handle v as hex string', async () => {
      mockSignPersonalMessage.mockImplementation(() =>
        Promise.resolve({
          v: '1b', // Hex string (27)
          r: '0000000000000000000000000000000000000000000000000000000000000001',
          s: '0000000000000000000000000000000000000000000000000000000000000002',
        }),
      )

      const signature = await keyring.signMessage(testAddress, 'test')
      expect(signature).toMatch(/^0x[a-fA-F0-9]{130}$/)
    })
  })

  describe('EIP-712 Typed Data Signing', () => {
    const testAddress = '0x1234567890abcdef1234567890abcdef12345678' as Address
    const domain = {
      name: 'Test App',
      version: '1',
      chainId: 1,
      verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
    }
    const types = {
      Person: [
        { name: 'name', type: 'string' },
        { name: 'wallet', type: 'address' },
      ],
    }
    const message = {
      name: 'Alice',
      wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
    }

    beforeEach(async () => {
      await keyring.connect()
      await keyring.getAccounts(0, 1)
      await keyring.addAccounts([testAddress])
    })

    it('should try native EIP-712 signing first', async () => {
      mockSignEIP712Message.mockImplementation(() =>
        Promise.resolve({
          v: 27,
          r: '0000000000000000000000000000000000000000000000000000000000000001',
          s: '0000000000000000000000000000000000000000000000000000000000000002',
        }),
      )

      const signature = await keyring.signTypedData(
        testAddress,
        domain,
        types,
        message,
        'Person',
      )

      expect(signature).toMatch(/^0x[a-fA-F0-9]{130}$/)
      expect(mockSignEIP712Message).toHaveBeenCalled()
      expect(mockSignEIP712HashedMessage).not.toHaveBeenCalled()
    })

    it('should fallback to hashed signing for older firmware', async () => {
      const notSupportedError = new Error('INS_NOT_SUPPORTED')
      ;(notSupportedError as Error & { statusText: string }).statusText =
        'INS_NOT_SUPPORTED'

      mockSignEIP712Message.mockImplementation(() =>
        Promise.reject(notSupportedError),
      )
      mockSignEIP712HashedMessage.mockImplementation(() =>
        Promise.resolve({
          v: 27,
          r: '0000000000000000000000000000000000000000000000000000000000000001',
          s: '0000000000000000000000000000000000000000000000000000000000000002',
        }),
      )

      const signature = await keyring.signTypedData(
        testAddress,
        domain,
        types,
        message,
        'Person',
      )

      expect(signature).toMatch(/^0x[a-fA-F0-9]{130}$/)
      expect(mockSignEIP712HashedMessage).toHaveBeenCalled()
    })
  })

  describe('Serialization', () => {
    it('should serialize complete state', () => {
      const serialized = keyring.serialize()

      expect(serialized).toHaveProperty('accounts')
      expect(serialized).toHaveProperty('accountDetails')
      expect(serialized).toHaveProperty('hdPath')
      expect(serialized).toHaveProperty('hdPathType')
      expect(Array.isArray(serialized.accounts)).toBe(true)
    })

    it('should deserialize and restore accounts', () => {
      const testAddress =
        '0x1234567890abcdef1234567890abcdef12345678' as Address
      const data = {
        accounts: [testAddress],
        accountDetails: {
          [testAddress.toLowerCase()]: {
            hdPath: "m/44'/60'/0'/0/0",
            hdPathType: 'BIP44' as LedgerHDPathType,
            publicKey: '04abcdef',
          },
        },
        hdPath: "m/44'/60'/0'/0",
        hdPathType: 'BIP44' as LedgerHDPathType,
      }

      keyring.deserialize(data)

      const addresses = keyring.getAddresses()
      expect(addresses).toHaveLength(1)
      expect(addresses[0]).toBe(testAddress)
    })

    it('should handle partial deserialization', () => {
      keyring.deserialize({ hdPathType: 'LedgerLive' })

      const serialized = keyring.serialize()
      expect(serialized.hdPathType).toBe('LedgerLive')
    })

    it('should preserve state through serialize/deserialize cycle', async () => {
      await keyring.connect()
      keyring.setHdPath('LedgerLive')
      await keyring.getAccounts(0, 2)

      const testAddresses = [
        '0x1234567890abcdef1234567890abcdef12345678' as Address,
        '0x1234567890abcdef1234567890abcdef12345679' as Address,
      ]
      await keyring.addAccounts(testAddresses)

      const serialized = keyring.serialize()

      const newKeyring = new LedgerKeyring()
      newKeyring.deserialize(serialized)

      expect(newKeyring.getAddresses()).toEqual(testAddresses)
      expect(newKeyring.serialize().hdPathType).toBe('LedgerLive')
    })
  })

  describe('Type Property', () => {
    it('should have correct static type', () => {
      expect(LedgerKeyring.type).toBe('Ledger Hardware')
    })

    it('should have correct instance type', () => {
      expect(keyring.type).toBe('Ledger Hardware')
    })
  })
})
