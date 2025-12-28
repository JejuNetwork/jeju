/**
 * Network Keyring Service
 * Secure key management for wallet accounts
 * Supports: HD wallets, private key import, watch-only, hardware wallets, KMS-backed
 *
 * SECURITY PRIORITY:
 * 1. KMS-backed accounts (keys never leave KMS)
 * 2. Hardware accounts (keys on secure element)
 * 3. HD/Imported accounts (local encrypted storage)
 *
 * For high-security operations, use createKMSAccount() which ensures
 * private keys never exist on this device.
 */

import { expectJson } from '@jejunetwork/types'
import { HDKey } from '@scure/bip32'
import {
  generateMnemonic as generateBip39Mnemonic,
  mnemonicToSeedSync,
  validateMnemonic,
} from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { type Address, type Hex, isHex, keccak256, toBytes } from 'viem'
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'
import { bytesToHex } from '../../../lib/buffer'
import { getKMSSigner, type KMSSigner } from '../kms-signer'

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

type KeySourceType = 'hd' | 'imported' | 'watch' | 'hardware' | 'smart' | 'kms'

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

/**
 * KMS-backed account - private key NEVER exists on this device.
 * This is the most secure account type for high-value operations.
 */
interface KMSAccount extends Account {
  type: 'kms'
  /** Key ID in the KMS system */
  keyId: string
  /** Public key (for verification) */
  publicKey: Hex
  /** Whether MPC signing is used */
  useMPC: boolean
}

// HD Paths
const HD_PATHS = {
  ethereum: "m/44'/60'/0'/0", // Standard BIP44
  ledgerLive: "m/44'/60'", // Ledger Live per-account derivation
  mew: "m/44'/60'/0'", // MyEtherWallet style
} as const

class KeyringService {
  private accounts: Map<Address, Account> = new Map()
  private encryptedMnemonics: Map<string, string> = new Map() // walletId -> encrypted mnemonic
  private hdAccountToWallet: Map<Address, string> = new Map() // address -> walletId for HD accounts
  private encryptedPrivateKeys: Map<Address, string> = new Map()
  private kmsAccounts: Map<Address, KMSAccount> = new Map() // KMS-backed accounts
  private kmsSigner: KMSSigner | null = null // Lazy-loaded KMS signer
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
      name: name ?? 'Watch Account',
      createdAt: Date.now(),
    }

    this.accounts.set(address, watchAccount)
    this.saveAccounts()
  }

  /**
   * Create a KMS-backed account.
   *
   * SECURITY: This is the most secure account type. The private key is
   * generated and stored in the KMS (using TEE or MPC) and NEVER exists
   * on this device. All signing operations are performed remotely.
   *
   * Use this for:
   * - High-value accounts
   * - Treasury operations
   * - DAO governance
   * - Any operation requiring side-channel resistance
   */
  async createKMSAccount(
    name?: string,
    options?: { useMPC?: boolean },
  ): Promise<KMSAccount> {
    const signer = this.getOrCreateKMSSigner()
    await signer.initialize()

    // Register a new key in KMS
    const ownerAddress = '0x0000000000000000000000000000000000000000' as Address
    const result = await signer.registerKey(ownerAddress, {
      name: name ?? 'KMS Account',
      useMPC: options?.useMPC ?? true, // Default to MPC for maximum security
    })

    const kmsAccount: KMSAccount = {
      address: result.address,
      type: 'kms',
      name: name ?? 'KMS Account',
      keyId: result.keyId,
      publicKey: result.publicKey,
      useMPC: options?.useMPC ?? true,
      createdAt: Date.now(),
    }

    this.accounts.set(result.address, kmsAccount)
    this.kmsAccounts.set(result.address, kmsAccount)
    await this.saveAccounts()

    return kmsAccount
  }

  /**
   * Link an existing KMS key to this wallet.
   */
  async linkKMSAccount(keyId: string, name?: string): Promise<KMSAccount> {
    const signer = this.getOrCreateKMSSigner()
    await signer.initialize()

    const keyInfo = await signer.getKey(keyId)

    if (this.accounts.has(keyInfo.address as Address)) {
      throw new Error('Account already exists')
    }

    const kmsAccount: KMSAccount = {
      address: keyInfo.address as Address,
      type: 'kms',
      name: name ?? 'KMS Account',
      keyId: keyInfo.keyId,
      publicKey: keyInfo.publicKey as Hex,
      useMPC: !!keyInfo.mpc,
      createdAt: Date.now(),
    }

    this.accounts.set(keyInfo.address as Address, kmsAccount)
    this.kmsAccounts.set(keyInfo.address as Address, kmsAccount)
    await this.saveAccounts()

    return kmsAccount
  }

  private getOrCreateKMSSigner(): KMSSigner {
    if (!this.kmsSigner) {
      this.kmsSigner = getKMSSigner({ useMPC: true })
    }
    return this.kmsSigner
  }

  /**
   * Check if an account is KMS-backed.
   */
  isKMSAccount(address: Address): boolean {
    return this.kmsAccounts.has(address)
  }

  // Get all accounts
  getAccounts(): Account[] {
    return Array.from(this.accounts.values())
  }

  // Get specific account
  getAccount(address: Address): Account | undefined {
    return this.accounts.get(address)
  }

  /**
   * Sign a transaction.
   *
   * For KMS accounts, signing happens remotely (key never on device).
   * For local accounts, the key is decrypted temporarily for signing.
   */
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

    // KMS accounts: sign remotely (private key never on device)
    if (account.type === 'kms') {
      const kmsAccount = this.kmsAccounts.get(address)
      if (!kmsAccount) throw new Error('KMS account data not found')

      // Serialize transaction for hashing
      const txData = JSON.stringify({
        to: tx.to,
        value: tx.value?.toString(),
        data: tx.data,
        nonce: tx.nonce,
        gas: tx.gas?.toString(),
        gasPrice: tx.gasPrice?.toString(),
        maxFeePerGas: tx.maxFeePerGas?.toString(),
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas?.toString(),
        chainId: tx.chainId,
      })
      const txHash = keccak256(toBytes(txData))

      const signer = this.getOrCreateKMSSigner()
      const result = await signer.signTransactionHash(
        kmsAccount.keyId,
        txHash,
        address,
      )
      return result.signature
    }

    // Local accounts: decrypt and sign
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

  /**
   * Sign a message.
   *
   * For KMS accounts, signing happens remotely (key never on device).
   */
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

    // KMS accounts: sign remotely
    if (account.type === 'kms') {
      const kmsAccount = this.kmsAccounts.get(address)
      if (!kmsAccount) throw new Error('KMS account data not found')

      const signer = this.getOrCreateKMSSigner()
      const result = await signer.signPersonalMessage(
        kmsAccount.keyId,
        message,
        address,
      )
      return result.signature
    }

    // Local accounts: decrypt and sign
    const signer = await this.getSigner(address, password)
    return signer.signMessage({ message })
  }

  /**
   * Sign typed data (EIP-712).
   *
   * For KMS accounts, signing happens remotely (key never on device).
   */
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

    // KMS accounts: sign remotely
    if (account.type === 'kms') {
      const kmsAccount = this.kmsAccounts.get(address)
      if (!kmsAccount) throw new Error('KMS account data not found')

      const signer = this.getOrCreateKMSSigner()
      const result = await signer.signTypedData({
        keyId: kmsAccount.keyId,
        domain: typedData.domain as {
          name?: string
          version?: string
          chainId?: number
          verifyingContract?: Address
          salt?: Hex
        },
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
        requester: address,
      })
      return result.signature
    }

    // Local accounts: decrypt and sign
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
        type: z.enum(['hd', 'imported', 'watch', 'hardware', 'smart', 'kms']),
        name: z.string(),
        hdPath: z.string().optional(),
        index: z.number().optional(),
        isDefault: z.boolean().optional(),
        createdAt: z.number(),
        // KMS-specific fields
        keyId: z.string().optional(),
        publicKey: z.string().optional(),
        useMPC: z.boolean().optional(),
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

        // Also populate KMS accounts map
        if (a.type === 'kms' && a.keyId && a.publicKey !== undefined) {
          const kmsAccount: KMSAccount = {
            ...account,
            type: 'kms',
            keyId: a.keyId,
            publicKey: a.publicKey as Hex,
            useMPC: a.useMPC ?? true,
          }
          this.kmsAccounts.set(account.address, kmsAccount)
        }
      }
    }
  }

  private async saveAccounts(): Promise<void> {
    const accounts = Array.from(this.accounts.values()).map((account) => {
      // Include KMS-specific fields when saving
      if (account.type === 'kms') {
        const kmsAccount = this.kmsAccounts.get(account.address)
        if (kmsAccount) {
          return {
            ...account,
            keyId: kmsAccount.keyId,
            publicKey: kmsAccount.publicKey,
            useMPC: kmsAccount.useMPC,
          }
        }
      }
      return account
    })
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
  KMSAccount,
  KeySourceType,
}
