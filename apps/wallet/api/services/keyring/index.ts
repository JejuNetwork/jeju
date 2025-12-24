/**
 * Network Keyring Service
 * Secure key management for wallet accounts
 * Supports: HD wallets, private key import, watch-only, hardware wallets
 */

import { expectJson } from '@jejunetwork/types'
import { HDKey } from '@scure/bip32'
import {
  generateMnemonic as generateBip39Mnemonic,
  mnemonicToSeedSync,
  validateMnemonic,
} from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { type Address, type Hex, isHex } from 'viem'
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'
import { bytesToHex } from '../../../lib/buffer'

// Convert bytes to Hex type with proper typing
function toHexString(bytes: Uint8Array): Hex {
  const hex = `0x${bytesToHex(bytes)}`
  if (!isHex(hex)) {
    throw new Error('Invalid hex string generated')
  }
  return hex
}

// Validate a string is Hex, throwing on failure
function requireHex(value: string, context: string): Hex {
  if (!isHex(value)) {
    throw new Error(`${context}: expected hex string, got ${typeof value}`)
  }
  return value
}

import { secureStorage } from '../../../web/platform/secure-storage'

type KeySourceType = 'hd' | 'imported' | 'watch' | 'hardware' | 'smart'

interface Account {
  address: Address
  type: KeySourceType
  name: string
  hdPath?: string
  index?: number
  isDefault?: boolean
  createdAt: number
}

interface HDAccount extends Account {
  type: 'hd'
  hdPath: `m/44'/60'/${string}`
  index: number
}

interface ImportedAccount extends Account {
  type: 'imported'
}

interface WatchAccount extends Account {
  type: 'watch'
}

interface HardwareAccount extends Account {
  type: 'hardware'
  deviceType: 'ledger' | 'trezor' | 'keystone'
  hdPath: string
}

interface SmartWalletAccount extends Account {
  type: 'smart'
  implementation: 'safe' | 'kernel' | 'jeju'
  ownerAddress: Address
}

// HD Paths
const HD_PATHS = {
  ethereum: "m/44'/60'/0'/0",
  ledgerLive: "m/44'/60'",
  ledgerLegacy: "m/44'/60'/0'",
} as const

class KeyringService {
  private accounts: Map<Address, Account> = new Map()
  private encryptedMnemonics: Map<string, string> = new Map() // walletId -> encrypted mnemonic
  private hdAccountToWallet: Map<Address, string> = new Map() // address -> walletId for HD accounts
  private encryptedPrivateKeys: Map<Address, string> = new Map()
  private isLocked = true
  private sessionKey: CryptoKey | null = null
  private walletSalt: Uint8Array | null = null // Per-wallet random salt for key derivation
  private unlockInProgress: Promise<boolean> | null = null // Prevent concurrent unlock calls
  private static readonly SALT_KEY = 'jeju_keyring_salt'

  // Initialize keyring - must be called with password
  async unlock(password: string): Promise<boolean> {
    if (!password || password.length === 0) {
      throw new Error('Password is required')
    }

    // Prevent concurrent unlock operations - return existing promise if in progress
    if (this.unlockInProgress) {
      return this.unlockInProgress
    }

    this.unlockInProgress = this.doUnlock(password)
    try {
      return await this.unlockInProgress
    } finally {
      this.unlockInProgress = null
    }
  }

  private async doUnlock(password: string): Promise<boolean> {
    // Load or generate per-wallet salt
    await this.ensureSalt()

    // Derive encryption key from password using wallet-specific salt
    this.sessionKey = await this.deriveKey(password)
    this.isLocked = false

    // Load accounts from storage
    await this.loadAccounts()
    return true
  }

  // Ensure we have a per-wallet salt (generate if missing)
  private async ensureSalt(): Promise<void> {
    const storedSalt = await secureStorage.get(KeyringService.SALT_KEY)
    if (storedSalt) {
      this.walletSalt = new Uint8Array(
        atob(storedSalt)
          .split('')
          .map((c) => c.charCodeAt(0)),
      )
    } else {
      // Generate new random salt for this wallet (32 bytes)
      this.walletSalt = crypto.getRandomValues(new Uint8Array(32))
      await secureStorage.set(
        KeyringService.SALT_KEY,
        btoa(String.fromCharCode(...this.walletSalt)),
      )
    }
  }

  lock() {
    this.sessionKey = null
    this.isLocked = true
    // Clear sensitive data from memory
    this.encryptedPrivateKeys.clear()
  }

  isUnlocked(): boolean {
    return !this.isLocked && this.sessionKey !== null
  }

  // Create new HD wallet
  async createHDWallet(
    password: string,
  ): Promise<{ mnemonic: string; address: Address }> {
    const mnemonic = generateBip39Mnemonic(wordlist, 128) // 12 words
    const account = mnemonicToAccount(mnemonic, {
      path: `${HD_PATHS.ethereum}/0`,
    })

    // Ensure we have a wallet salt for encryption
    await this.ensureSalt()

    // Encrypt and store mnemonic
    const walletId = crypto.randomUUID()
    const encrypted = await this.encrypt(mnemonic, password)
    this.encryptedMnemonics.set(walletId, encrypted)
    this.hdAccountToWallet.set(account.address, walletId)

    const hdAccount: HDAccount = {
      address: account.address,
      type: 'hd',
      name: 'Account 1',
      hdPath: HD_PATHS.ethereum,
      index: 0,
      isDefault: true,
      createdAt: Date.now(),
    }

    this.accounts.set(account.address, hdAccount)
    await this.saveAccounts()

    return { mnemonic, address: account.address }
  }

  // Import wallet from mnemonic
  async importMnemonic(mnemonic: string, password: string): Promise<Address> {
    if (!validateMnemonic(mnemonic, wordlist)) {
      throw new Error('Invalid mnemonic phrase')
    }

    const account = mnemonicToAccount(mnemonic, {
      path: `${HD_PATHS.ethereum}/0`,
    })

    // Check if already exists
    if (this.accounts.has(account.address)) {
      throw new Error('Account already exists')
    }

    // Ensure we have a wallet salt for encryption
    await this.ensureSalt()

    const walletId = crypto.randomUUID()
    const encrypted = await this.encrypt(mnemonic, password)
    this.encryptedMnemonics.set(walletId, encrypted)
    this.hdAccountToWallet.set(account.address, walletId)

    const hdAccount: HDAccount = {
      address: account.address,
      type: 'hd',
      name: `Imported Account`,
      hdPath: HD_PATHS.ethereum,
      index: 0,
      createdAt: Date.now(),
    }

    this.accounts.set(account.address, hdAccount)
    await this.saveAccounts()

    return account.address
  }

  // Import private key
  async importPrivateKey(privateKey: Hex, password: string): Promise<Address> {
    const account = privateKeyToAccount(privateKey)

    if (this.accounts.has(account.address)) {
      throw new Error('Account already exists')
    }

    // Ensure we have a wallet salt for encryption
    await this.ensureSalt()

    const encrypted = await this.encrypt(privateKey, password)
    this.encryptedPrivateKeys.set(account.address, encrypted)

    const importedAccount: ImportedAccount = {
      address: account.address,
      type: 'imported',
      name: 'Imported Account',
      createdAt: Date.now(),
    }

    this.accounts.set(account.address, importedAccount)
    await this.saveAccounts()

    return account.address
  }

  // Add watch-only address
  addWatchAddress(address: Address, name?: string): void {
    if (this.accounts.has(address)) {
      throw new Error('Address already exists')
    }

    const watchAccount: WatchAccount = {
      address,
      type: 'watch',
      name: name || 'Watch Account',
      createdAt: Date.now(),
    }

    this.accounts.set(address, watchAccount)
    this.saveAccounts()
  }

  // Get all accounts
  getAccounts(): Account[] {
    return Array.from(this.accounts.values())
  }

  // Get specific account
  getAccount(address: Address): Account | undefined {
    return this.accounts.get(address)
  }

  // Sign transaction
  async signTransaction(
    address: Address,
    tx: {
      to: Address
      value?: bigint
      data?: Hex
      nonce?: number
      gas?: bigint
      gasPrice?: bigint
      maxFeePerGas?: bigint
      maxPriorityFeePerGas?: bigint
      chainId: number
    },
    password: string,
  ): Promise<Hex> {
    const account = this.accounts.get(address)
    if (!account) throw new Error('Account not found')

    if (account.type === 'watch') {
      throw new Error('Cannot sign with watch-only account')
    }

    const signer = await this.getSigner(address, password)

    // Build EIP-1559 or legacy transaction
    if (tx.maxFeePerGas) {
      return signer.signTransaction({
        to: tx.to,
        value: tx.value,
        data: tx.data,
        nonce: tx.nonce,
        gas: tx.gas,
        maxFeePerGas: tx.maxFeePerGas,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
        chainId: tx.chainId,
        type: 'eip1559',
      })
    }

    return signer.signTransaction({
      to: tx.to,
      value: tx.value,
      data: tx.data,
      nonce: tx.nonce,
      gas: tx.gas,
      gasPrice: tx.gasPrice,
      chainId: tx.chainId,
      type: 'legacy',
    })
  }

  // Sign message
  async signMessage(
    address: Address,
    message: string,
    password: string,
  ): Promise<Hex> {
    const account = this.accounts.get(address)
    if (!account) throw new Error('Account not found')

    if (account.type === 'watch') {
      throw new Error('Cannot sign with watch-only account')
    }

    const signer = await this.getSigner(address, password)
    return signer.signMessage({ message })
  }

  // Sign typed data (EIP-712)
  async signTypedData(
    address: Address,
    typedData: {
      domain: Record<string, unknown>
      types: Record<string, Array<{ name: string; type: string }>>
      primaryType: string
      message: Record<string, unknown>
    },
    password: string,
  ): Promise<Hex> {
    const account = this.accounts.get(address)
    if (!account) throw new Error('Account not found')

    if (account.type === 'watch') {
      throw new Error('Cannot sign with watch-only account')
    }

    const signer = await this.getSigner(address, password)
    return signer.signTypedData(
      typedData as Parameters<typeof signer.signTypedData>[0],
    )
  }

  // Remove account
  removeAccount(address: Address): void {
    this.accounts.delete(address)
    this.encryptedPrivateKeys.delete(address)
    this.saveAccounts()
  }

  // Rename account
  renameAccount(address: Address, name: string): void {
    const account = this.accounts.get(address)
    if (account) {
      account.name = name
      this.saveAccounts()
    }
  }

  // Export private key (requires password)
  async exportPrivateKey(address: Address, password: string): Promise<Hex> {
    const account = this.accounts.get(address)
    if (!account) throw new Error('Account not found')

    if (account.type === 'watch' || account.type === 'hardware') {
      throw new Error('Cannot export key for this account type')
    }

    if (account.type === 'imported') {
      const encrypted = this.encryptedPrivateKeys.get(address)
      if (!encrypted) throw new Error('Private key not found')
      return this.decrypt(encrypted, password) as Promise<Hex>
    }

    // For HD accounts, derive private key from mnemonic
    if (account.type === 'hd') {
      const hdAccount = account as HDAccount
      const walletId = this.hdAccountToWallet.get(address)
      if (!walletId) throw new Error('HD wallet not found for this account')

      const encryptedMnemonic = this.encryptedMnemonics.get(walletId)
      if (!encryptedMnemonic) throw new Error('Mnemonic not found')

      const mnemonic = await this.decrypt(encryptedMnemonic, password)

      // The account has a privateKey getter that returns the derived key
      // We need to use the HDAccount's method to get the private key
      // Since viem's HDAccount doesn't expose privateKey directly,
      // we derive it from the seed
      const seed = mnemonicToSeedSync(mnemonic)
      const hdKey = HDKey.fromMasterSeed(seed)
      const derivedKey = hdKey.derive(`${hdAccount.hdPath}/${hdAccount.index}`)
      if (!derivedKey.privateKey)
        throw new Error('Failed to derive private key')

      return toHexString(derivedKey.privateKey)
    }

    throw new Error('Cannot export key for this account type')
  }

  private async getSigner(address: Address, password: string) {
    const account = this.accounts.get(address)
    if (!account) throw new Error('Account not found')

    if (account.type === 'imported') {
      const encrypted = this.encryptedPrivateKeys.get(address)
      if (!encrypted) throw new Error('Private key not found')
      const privateKey = requireHex(
        await this.decrypt(encrypted, password),
        'private key',
      )
      return privateKeyToAccount(privateKey)
    }

    if (account.type === 'hd') {
      const hdAccount = account as HDAccount
      const walletId = this.hdAccountToWallet.get(address)
      if (!walletId) throw new Error('HD wallet not found for this account')

      const encryptedMnemonic = this.encryptedMnemonics.get(walletId)
      if (!encryptedMnemonic) throw new Error('Mnemonic not found')

      const mnemonic = await this.decrypt(encryptedMnemonic, password)
      return mnemonicToAccount(mnemonic, {
        path: `${hdAccount.hdPath}/${hdAccount.index}`,
      })
    }

    throw new Error(`Cannot get signer for account type: ${account.type}`)
  }

  private async deriveKey(password: string): Promise<CryptoKey> {
    if (!this.walletSalt) {
      throw new Error('Wallet salt not initialized - call ensureSalt first')
    }

    const encoder = new TextEncoder()
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveKey'],
    )

    // Create a new ArrayBuffer copy for TypeScript compatibility
    const saltBuffer = new Uint8Array(this.walletSalt).buffer as ArrayBuffer

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: new Uint8Array(saltBuffer),
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
  }

  private async encrypt(data: string, password: string): Promise<string> {
    const key = await this.deriveKey(password)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encoder = new TextEncoder()

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(data),
    )

    const combined = new Uint8Array(iv.length + encrypted.byteLength)
    combined.set(iv)
    combined.set(new Uint8Array(encrypted), iv.length)

    return btoa(String.fromCharCode(...combined))
  }

  private async decrypt(encrypted: string, password: string): Promise<string> {
    const key = await this.deriveKey(password)
    const combined = new Uint8Array(
      atob(encrypted)
        .split('')
        .map((c) => c.charCodeAt(0)),
    )

    const iv = combined.slice(0, 12)
    const data = combined.slice(12)

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      data,
    )

    return new TextDecoder().decode(decrypted)
  }

  private async loadAccounts(): Promise<void> {
    const stored = await secureStorage.get('jeju-accounts')
    if (stored) {
      // Schema that transforms string address to Address type
      const AccountSchema = z.object({
        address: z.string().transform((addr) => addr as Address),
        type: z.enum(['hd', 'imported', 'watch', 'hardware', 'smart']),
        name: z.string(),
        hdPath: z.string().optional(),
        index: z.number().optional(),
        isDefault: z.boolean().optional(),
        createdAt: z.number(),
      })

      const accounts = expectJson(stored, z.array(AccountSchema), 'accounts')
      // The transformed schema produces Account-compatible objects
      for (const a of accounts) {
        const account: Account = {
          address: a.address,
          type: a.type,
          name: a.name,
          hdPath: a.hdPath,
          index: a.index,
          isDefault: a.isDefault,
          createdAt: a.createdAt,
        }
        this.accounts.set(account.address, account)
      }
    }
  }

  private async saveAccounts(): Promise<void> {
    const accounts = Array.from(this.accounts.values())
    await secureStorage.set('jeju-accounts', JSON.stringify(accounts))
  }
}

export const keyringService = new KeyringService()
export { KeyringService }
export type {
  Account,
  HDAccount,
  ImportedAccount,
  WatchAccount,
  HardwareAccount,
  SmartWalletAccount,
  KeySourceType,
}
