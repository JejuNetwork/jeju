/**
 * Key Registry Sync
 *
 * Syncs TEE-managed keys with on-chain KeyRegistry contract.
 */

import {
  type Address,
  createPublicClient,
  encodeFunctionData,
  type Hex,
  http,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { base, baseSepolia } from 'viem/chains'
import type { TEEXMTPKeyManager } from './key-manager'
import type {
  KeyRegistration,
  RegistrationResult,
  TEEAttestation,
} from './types'

// ============ Contract ABI ============

const KEY_REGISTRY_ABI = [
  {
    name: 'registerKeyBundle',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'identityKey', type: 'bytes' },
      { name: 'preKey', type: 'bytes' },
      { name: 'preKeySignature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'registerKeyBundleWithAttestation',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'identityKey', type: 'bytes' },
      { name: 'preKey', type: 'bytes' },
      { name: 'preKeySignature', type: 'bytes' },
      { name: 'attestationProof', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'getKeyBundle',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [
      { name: 'identityKey', type: 'bytes' },
      { name: 'preKey', type: 'bytes' },
      { name: 'preKeySignature', type: 'bytes' },
      { name: 'registeredAt', type: 'uint256' },
    ],
  },
  {
    name: 'rotatePreKey',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'newPreKey', type: 'bytes' },
      { name: 'newPreKeySignature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'revokeKey',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'hasRegisteredKey',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
] as const

// ============ Types ============

export interface KeyRegistrySyncConfig {
  /** Key registry contract address */
  registryAddress: Address
  /** RPC URL */
  rpcUrl: string
  /** Network */
  network: 'mainnet' | 'testnet'
}

// ============ Key Registry Sync Class ============

/**
 * Syncs TEE-managed keys with on-chain KeyRegistry
 */
export class KeyRegistrySync {
  private keyManager: TEEXMTPKeyManager
  private registryAddress: Address
  private publicClient: PublicClient
  private walletClient: WalletClient | null = null
  private chain: typeof base | typeof baseSepolia

  constructor(keyManager: TEEXMTPKeyManager, config: KeyRegistrySyncConfig) {
    this.keyManager = keyManager
    this.registryAddress = config.registryAddress
    this.chain = config.network === 'mainnet' ? base : baseSepolia

    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(config.rpcUrl),
    }) as PublicClient
  }

  /**
   * Set wallet client for write operations
   */
  setWalletClient(walletClient: WalletClient): void {
    this.walletClient = walletClient
  }

  // ============ Registration ============

  /**
   * Register TEE key in on-chain registry
   */
  async registerOnChain(keyId: string): Promise<RegistrationResult> {
    if (!this.walletClient) {
      throw new Error('Wallet client not set')
    }
    if (!this.walletClient.account) {
      throw new Error('Wallet client must have an account')
    }

    const key = await this.keyManager.getKey(keyId)
    if (!key) {
      throw new Error(`Key not found: ${keyId}`)
    }

    // Get pre-key
    const preKeys = await this.keyManager.getPreKeys(keyId)
    const preKey = preKeys[0]
    if (!preKey) {
      throw new Error(`No pre-keys for identity: ${keyId}`)
    }

    // Get attestation
    const attestation = await this.keyManager.getAttestation(keyId)
    const attestationProof = this.encodeAttestation(attestation)

    // Build transaction
    const data = encodeFunctionData({
      abi: KEY_REGISTRY_ABI,
      functionName: 'registerKeyBundleWithAttestation',
      args: [
        key.publicKey,
        preKey.publicKey,
        preKey.signature,
        attestationProof,
      ],
    })

    // Send transaction
    const txHash = await this.walletClient.sendTransaction({
      account: this.walletClient.account,
      chain: this.chain,
      to: this.registryAddress,
      data,
    })

    console.log(`[KeyRegistrySync] Registered key ${keyId}, tx: ${txHash}`)

    // Wait for confirmation
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
    })

    return {
      txHash,
      confirmed: receipt.status === 'success',
      blockNumber: Number(receipt.blockNumber),
    }
  }

  /**
   * Register without attestation (fallback)
   */
  async registerOnChainSimple(keyId: string): Promise<RegistrationResult> {
    if (!this.walletClient) {
      throw new Error('Wallet client not set')
    }
    if (!this.walletClient.account) {
      throw new Error('Wallet client must have an account')
    }

    const key = await this.keyManager.getKey(keyId)
    if (!key) {
      throw new Error(`Key not found: ${keyId}`)
    }

    // Get pre-key
    const preKeys = await this.keyManager.getPreKeys(keyId)
    const preKey = preKeys[0]
    if (!preKey) {
      throw new Error(`No pre-keys for identity: ${keyId}`)
    }

    // Build transaction
    const data = encodeFunctionData({
      abi: KEY_REGISTRY_ABI,
      functionName: 'registerKeyBundle',
      args: [key.publicKey, preKey.publicKey, preKey.signature],
    })

    // Send transaction
    const txHash = await this.walletClient.sendTransaction({
      account: this.walletClient.account,
      chain: this.chain,
      to: this.registryAddress,
      data,
    })

    // Wait for confirmation
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
    })

    return {
      txHash,
      confirmed: receipt.status === 'success',
      blockNumber: Number(receipt.blockNumber),
    }
  }

  // ============ Pre-Key Rotation ============

  /**
   * Rotate pre-key on-chain
   */
  async rotatePreKeyOnChain(keyId: string): Promise<RegistrationResult> {
    if (!this.walletClient) {
      throw new Error('Wallet client not set')
    }
    if (!this.walletClient.account) {
      throw new Error('Wallet client must have an account')
    }

    // Generate new pre-key
    const newPreKey = await this.keyManager.generatePreKey(keyId)

    // Build transaction
    const data = encodeFunctionData({
      abi: KEY_REGISTRY_ABI,
      functionName: 'rotatePreKey',
      args: [newPreKey.publicKey, newPreKey.signature],
    })

    // Send transaction
    const txHash = await this.walletClient.sendTransaction({
      account: this.walletClient.account,
      chain: this.chain,
      to: this.registryAddress,
      data,
    })

    // Log truncated identifiers
    console.log(
      `[KeyRegistrySync] Rotated pre-key for ${keyId.slice(0, 20)}..., tx: ${txHash.slice(0, 18)}...`,
    )

    // Wait for confirmation
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
    })

    return {
      txHash,
      confirmed: receipt.status === 'success',
      blockNumber: Number(receipt.blockNumber),
    }
  }

  // ============ Verification ============

  /**
   * Verify on-chain key matches TEE key
   */
  async verifyRegistration(address: Address): Promise<boolean> {
    const [onChainKey, teeKey] = await Promise.all([
      this.getOnChainKey(address),
      this.keyManager.getIdentityKey(address),
    ])

    if (!onChainKey || !teeKey) return false

    return (
      onChainKey.identityKey.toLowerCase() === teeKey.publicKey.toLowerCase()
    )
  }

  /**
   * Check if address has registered key
   */
  async hasRegisteredKey(address: Address): Promise<boolean> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: KEY_REGISTRY_ABI,
      functionName: 'hasRegisteredKey',
      args: [address],
    })

    return result
  }

  /**
   * Get key bundle from chain
   * Returns null if no key is registered for the address
   */
  async getOnChainKey(address: Address): Promise<KeyRegistration | null> {
    const result = await this.publicClient
      .readContract({
        address: this.registryAddress,
        abi: KEY_REGISTRY_ABI,
        functionName: 'getKeyBundle',
        args: [address],
      })
      .catch(() => null)

    if (!result) {
      return null
    }

    const [identityKey, preKey, preKeySignature, registeredAt] = result

    if (!identityKey || identityKey === '0x') {
      return null
    }

    return {
      address,
      identityKey: identityKey as Hex,
      preKey: preKey as Hex,
      preKeySignature: preKeySignature as Hex,
      registeredAt: Number(registeredAt),
    }
  }

  // ============ Revocation ============

  /**
   * Revoke key on-chain
   */
  async revokeOnChain(): Promise<RegistrationResult> {
    if (!this.walletClient) {
      throw new Error('Wallet client not set')
    }
    if (!this.walletClient.account) {
      throw new Error('Wallet client must have an account')
    }

    const data = encodeFunctionData({
      abi: KEY_REGISTRY_ABI,
      functionName: 'revokeKey',
      args: [],
    })

    const txHash = await this.walletClient.sendTransaction({
      account: this.walletClient.account,
      chain: this.chain,
      to: this.registryAddress,
      data,
    })

    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
    })

    return {
      txHash,
      confirmed: receipt.status === 'success',
      blockNumber: Number(receipt.blockNumber),
    }
  }

  // ============ Lookup ============

  /**
   * Lookup multiple addresses
   */
  async lookupKeys(
    addresses: Address[],
  ): Promise<Map<Address, KeyRegistration>> {
    const results = new Map<Address, KeyRegistration>()

    // Batch lookup
    const lookups = addresses.map(async (address) => {
      const key = await this.getOnChainKey(address)
      if (key) {
        results.set(address, key)
      }
    })

    await Promise.all(lookups)

    return results
  }

  // ============ Utility ============

  /**
   * Encode attestation for on-chain storage
   */
  private encodeAttestation(attestation: TEEAttestation): Hex {
    // ABI encode attestation struct
    // In production, use proper ABI encoding
    const encoded = JSON.stringify({
      version: attestation.version,
      enclaveId: attestation.enclaveId,
      measurement: attestation.measurement,
      nonce: attestation.nonce,
      timestamp: attestation.timestamp,
      signature: attestation.signature,
    })

    return `0x${Buffer.from(encoded).toString('hex')}` as Hex
  }
}

// ============ Factory Function ============

/**
 * Create key registry sync instance
 */
export function createKeyRegistrySync(
  keyManager: TEEXMTPKeyManager,
  config: KeyRegistrySyncConfig,
): KeyRegistrySync {
  return new KeyRegistrySync(keyManager, config)
}
