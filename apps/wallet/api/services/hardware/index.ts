/**
 * Hardware Wallet Service
 * Unified interface for Ledger and Trezor hardware wallets
 *
 * Uses lazy loading to avoid loading Node.js-specific polyfills (Buffer)
 * until the hardware wallet features are actually used.
 */

import type { Address, Hex } from 'viem'
import type {
  LedgerAccount,
  LedgerHDPathType,
  LedgerKeyring,
  PartialLedgerSerializedState,
} from './ledger'
import type {
  PartialTrezorSerializedState,
  TrezorAccount,
  TrezorHDPathType,
  TrezorKeyring,
} from './trezor'

export type HardwareWalletType = 'ledger' | 'trezor'
export type HDPathType = LedgerHDPathType | TrezorHDPathType

export interface HardwareDevice {
  type: HardwareWalletType
  model: string
  connected: boolean
}

export interface HardwareAccount {
  address: Address
  path: string
  index: number
  deviceType: HardwareWalletType
  publicKey?: string
}

export interface TransactionParams {
  to: Address
  value: bigint
  data: Hex
  nonce: number
  gasLimit: bigint
  maxFeePerGas?: bigint
  maxPriorityFeePerGas?: bigint
  gasPrice?: bigint
  chainId: number
}

// Lazy-loaded keyring instances
let ledgerKeyringInstance: LedgerKeyring | null = null
let trezorKeyringInstance: TrezorKeyring | null = null

async function getLedgerKeyring(): Promise<LedgerKeyring> {
  if (!ledgerKeyringInstance) {
    const { ledgerKeyring } = await import('./ledger')
    ledgerKeyringInstance = ledgerKeyring
  }
  return ledgerKeyringInstance
}

async function getTrezorKeyring(): Promise<TrezorKeyring> {
  if (!trezorKeyringInstance) {
    const { trezorKeyring } = await import('./trezor')
    trezorKeyringInstance = trezorKeyring
  }
  return trezorKeyringInstance
}

class HardwareWalletService {
  private currentDevice: HardwareDevice | null = null
  private currentType: HardwareWalletType | null = null

  /**
   * Check if any hardware wallet is supported
   */
  isSupported(): boolean {
    return this.isLedgerSupported() || this.isTrezorSupported()
  }

  /**
   * Check if WebHID is supported (required for Ledger)
   */
  isLedgerSupported(): boolean {
    return typeof navigator !== 'undefined' && 'hid' in navigator
  }

  /**
   * Check if Trezor Connect is available
   */
  isTrezorSupported(): boolean {
    return true // Trezor Connect works in all browsers
  }

  /**
   * Get current connected device
   */
  getDevice(): HardwareDevice | null {
    return this.currentDevice
  }

  /**
   * Connect to Ledger device
   */
  async connectLedger(): Promise<HardwareDevice> {
    if (!this.isLedgerSupported()) {
      throw new Error(
        'WebHID is not supported in this browser. Try Chrome or Edge.',
      )
    }

    const ledger = await getLedgerKeyring()
    await ledger.connect()

    this.currentType = 'ledger'
    this.currentDevice = {
      type: 'ledger',
      model: 'Ledger',
      connected: true,
    }

    return this.currentDevice
  }

  /**
   * Connect to Trezor device
   */
  async connectTrezor(): Promise<HardwareDevice> {
    const trezor = await getTrezorKeyring()
    await trezor.connect()

    this.currentType = 'trezor'
    this.currentDevice = {
      type: 'trezor',
      model: trezor.getModel() || 'Trezor',
      connected: true,
    }

    return this.currentDevice
  }

  /**
   * Disconnect current device
   */
  async disconnect(): Promise<void> {
    if (this.currentType === 'ledger' && ledgerKeyringInstance) {
      await ledgerKeyringInstance.disconnect()
    } else if (this.currentType === 'trezor' && trezorKeyringInstance) {
      await trezorKeyringInstance.disconnect()
    }

    this.currentDevice = null
    this.currentType = null
  }

  /**
   * Set HD path type
   */
  async setHdPath(type: HDPathType): Promise<void> {
    if (this.currentType === 'ledger') {
      const ledger = await getLedgerKeyring()
      ledger.setHdPath(type as LedgerHDPathType)
    } else if (this.currentType === 'trezor') {
      const trezor = await getTrezorKeyring()
      trezor.setHdPath(type as TrezorHDPathType)
    }
  }

  /**
   * Get accounts from device
   */
  async getAccounts(startIndex = 0, count = 5): Promise<HardwareAccount[]> {
    if (!this.currentType) {
      throw new Error('No hardware wallet connected')
    }

    if (this.currentType === 'ledger') {
      const ledger = await getLedgerKeyring()
      const accounts = await ledger.getAccounts(startIndex, count)
      return accounts.map((acc: LedgerAccount) => ({
        ...acc,
        deviceType: 'ledger' as const,
      }))
    }

    if (this.currentType === 'trezor') {
      const trezor = await getTrezorKeyring()
      const accounts = await trezor.getAccounts(startIndex, count)
      return accounts.map((acc: TrezorAccount) => ({
        ...acc,
        deviceType: 'trezor' as const,
      }))
    }

    throw new Error('Unknown device type')
  }

  /**
   * Add accounts to keyring
   */
  async addAccounts(addresses: Address[]): Promise<void> {
    if (!this.currentType) {
      throw new Error('No hardware wallet connected')
    }

    if (this.currentType === 'ledger') {
      const ledger = await getLedgerKeyring()
      await ledger.addAccounts(addresses)
    } else if (this.currentType === 'trezor') {
      const trezor = await getTrezorKeyring()
      await trezor.addAccounts(addresses)
    }
  }

  /**
   * Get all added addresses
   */
  async getAddresses(): Promise<Address[]> {
    const addresses: Address[] = []
    if (ledgerKeyringInstance) {
      addresses.push(...ledgerKeyringInstance.getAddresses())
    }
    if (trezorKeyringInstance) {
      addresses.push(...trezorKeyringInstance.getAddresses())
    }
    return addresses
  }

  /**
   * Get device type for an address
   */
  async getDeviceTypeForAddress(
    address: Address,
  ): Promise<HardwareWalletType | null> {
    if (ledgerKeyringInstance?.getAddresses().includes(address)) {
      return 'ledger'
    }
    if (trezorKeyringInstance?.getAddresses().includes(address)) {
      return 'trezor'
    }
    return null
  }

  /**
   * Sign transaction
   */
  async signTransaction(address: Address, tx: TransactionParams): Promise<Hex> {
    const deviceType = await this.getDeviceTypeForAddress(address)

    if (!deviceType) {
      throw new Error('Address not found in any hardware wallet')
    }

    if (deviceType === 'ledger') {
      const ledger = await getLedgerKeyring()
      if (!ledger.isUnlocked()) await ledger.connect()
      return ledger.signTransaction(address, tx)
    }

    const trezor = await getTrezorKeyring()
    if (!trezor.isUnlocked()) await trezor.connect()
    return trezor.signTransaction(address, tx)
  }

  /**
   * Sign personal message
   */
  async signMessage(address: Address, message: string): Promise<Hex> {
    const deviceType = await this.getDeviceTypeForAddress(address)

    if (!deviceType) {
      throw new Error('Address not found in any hardware wallet')
    }

    if (deviceType === 'ledger') {
      const ledger = await getLedgerKeyring()
      if (!ledger.isUnlocked()) await ledger.connect()
      return ledger.signMessage(address, message)
    }

    const trezor = await getTrezorKeyring()
    if (!trezor.isUnlocked()) await trezor.connect()
    return trezor.signMessage(address, message)
  }

  /**
   * Sign typed data (EIP-712)
   */
  async signTypedData(
    address: Address,
    domain: Record<string, unknown>,
    types: Record<string, Array<{ name: string; type: string }>>,
    message: Record<string, unknown>,
    primaryType: string,
  ): Promise<Hex> {
    const deviceType = await this.getDeviceTypeForAddress(address)

    if (!deviceType) {
      throw new Error('Address not found in any hardware wallet')
    }

    if (deviceType === 'ledger') {
      const ledger = await getLedgerKeyring()
      if (!ledger.isUnlocked()) await ledger.connect()
      return ledger.signTypedData(address, domain, types, message, primaryType)
    }

    const trezor = await getTrezorKeyring()
    if (!trezor.isUnlocked()) await trezor.connect()
    return trezor.signTypedData(address, domain, types, message, primaryType)
  }

  /**
   * Serialize for persistence
   */
  serialize(): Record<string, unknown> {
    return {
      ledger: ledgerKeyringInstance?.serialize() ?? null,
      trezor: trezorKeyringInstance?.serialize() ?? null,
    }
  }

  /**
   * Deserialize from storage
   */
  async deserialize(data: {
    ledger?: PartialLedgerSerializedState
    trezor?: PartialTrezorSerializedState
  }): Promise<void> {
    if (data.ledger) {
      const ledger = await getLedgerKeyring()
      ledger.deserialize(data.ledger)
    }
    if (data.trezor) {
      const trezor = await getTrezorKeyring()
      trezor.deserialize(data.trezor)
    }
  }
}

export const hardwareWalletService = new HardwareWalletService()
export { HardwareWalletService }

// Import types directly from ./ledger or ./trezor for Ledger/Trezor-specific types
