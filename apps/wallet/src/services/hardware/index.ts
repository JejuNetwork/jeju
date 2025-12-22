/**
 * Hardware Wallet Service
 * Unified interface for Ledger and Trezor hardware wallets
 */

import type { Address, Hex } from 'viem'
import {
  type LedgerAccount,
  type LedgerHDPathType,
  LedgerKeyring,
  ledgerKeyring,
  type PartialLedgerSerializedState,
} from './ledger'
import {
  type PartialTrezorSerializedState,
  type TrezorAccount,
  type TrezorHDPathType,
  TrezorKeyring,
  trezorKeyring,
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

    await ledgerKeyring.connect()

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
    await trezorKeyring.connect()

    this.currentType = 'trezor'
    this.currentDevice = {
      type: 'trezor',
      model: trezorKeyring.getModel() || 'Trezor',
      connected: true,
    }

    return this.currentDevice
  }

  /**
   * Disconnect current device
   */
  async disconnect(): Promise<void> {
    if (this.currentType === 'ledger') {
      await ledgerKeyring.disconnect()
    } else if (this.currentType === 'trezor') {
      await trezorKeyring.disconnect()
    }

    this.currentDevice = null
    this.currentType = null
  }

  /**
   * Set HD path type
   */
  setHdPath(type: HDPathType): void {
    if (this.currentType === 'ledger') {
      ledgerKeyring.setHdPath(type as LedgerHDPathType)
    } else if (this.currentType === 'trezor') {
      trezorKeyring.setHdPath(type as TrezorHDPathType)
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
      const accounts = await ledgerKeyring.getAccounts(startIndex, count)
      return accounts.map((acc) => ({
        ...acc,
        deviceType: 'ledger' as const,
      }))
    }

    if (this.currentType === 'trezor') {
      const accounts = await trezorKeyring.getAccounts(startIndex, count)
      return accounts.map((acc) => ({
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
      await ledgerKeyring.addAccounts(addresses)
    } else if (this.currentType === 'trezor') {
      await trezorKeyring.addAccounts(addresses)
    }
  }

  /**
   * Get all added addresses
   */
  getAddresses(): Address[] {
    const ledgerAddresses = ledgerKeyring.getAddresses()
    const trezorAddresses = trezorKeyring.getAddresses()
    return [...ledgerAddresses, ...trezorAddresses]
  }

  /**
   * Get device type for an address
   */
  getDeviceTypeForAddress(address: Address): HardwareWalletType | null {
    if (ledgerKeyring.getAddresses().includes(address)) {
      return 'ledger'
    }
    if (trezorKeyring.getAddresses().includes(address)) {
      return 'trezor'
    }
    return null
  }

  /**
   * Sign transaction
   */
  async signTransaction(address: Address, tx: TransactionParams): Promise<Hex> {
    const deviceType = this.getDeviceTypeForAddress(address)

    if (!deviceType) {
      throw new Error('Address not found in any hardware wallet')
    }

    // Ensure device is connected
    if (deviceType === 'ledger' && !ledgerKeyring.isUnlocked()) {
      await ledgerKeyring.connect()
    } else if (deviceType === 'trezor' && !trezorKeyring.isUnlocked()) {
      await trezorKeyring.connect()
    }

    if (deviceType === 'ledger') {
      return ledgerKeyring.signTransaction(address, tx)
    }

    return trezorKeyring.signTransaction(address, tx)
  }

  /**
   * Sign personal message
   */
  async signMessage(address: Address, message: string): Promise<Hex> {
    const deviceType = this.getDeviceTypeForAddress(address)

    if (!deviceType) {
      throw new Error('Address not found in any hardware wallet')
    }

    if (deviceType === 'ledger') {
      if (!ledgerKeyring.isUnlocked()) await ledgerKeyring.connect()
      return ledgerKeyring.signMessage(address, message)
    }

    if (!trezorKeyring.isUnlocked()) await trezorKeyring.connect()
    return trezorKeyring.signMessage(address, message)
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
    const deviceType = this.getDeviceTypeForAddress(address)

    if (!deviceType) {
      throw new Error('Address not found in any hardware wallet')
    }

    if (deviceType === 'ledger') {
      if (!ledgerKeyring.isUnlocked()) await ledgerKeyring.connect()
      return ledgerKeyring.signTypedData(
        address,
        domain,
        types,
        message,
        primaryType,
      )
    }

    if (!trezorKeyring.isUnlocked()) await trezorKeyring.connect()
    return trezorKeyring.signTypedData(
      address,
      domain,
      types,
      message,
      primaryType,
    )
  }

  /**
   * Serialize for persistence
   */
  serialize(): Record<string, unknown> {
    return {
      ledger: ledgerKeyring.serialize(),
      trezor: trezorKeyring.serialize(),
    }
  }

  /**
   * Deserialize from storage
   */
  deserialize(data: {
    ledger?: PartialLedgerSerializedState
    trezor?: PartialTrezorSerializedState
  }): void {
    if (data.ledger) {
      ledgerKeyring.deserialize(data.ledger)
    }
    if (data.trezor) {
      trezorKeyring.deserialize(data.trezor)
    }
  }
}

export const hardwareWalletService = new HardwareWalletService()
export {
  HardwareWalletService,
  LedgerKeyring,
  TrezorKeyring,
  ledgerKeyring,
  trezorKeyring,
}
export type { LedgerAccount, TrezorAccount, LedgerHDPathType, TrezorHDPathType }

