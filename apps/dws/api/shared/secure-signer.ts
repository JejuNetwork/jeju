import {
  createKMSSigner,
  getKMSSigner,
  type KMSKeyInfo,
  KMSSigner,
  type KMSSignerConfig,
  type SigningMode,
  type SignResult,
  type TransactionSignResult,
  validateSecureSigning,
} from '@jejunetwork/kms'
import type { Address, Hex } from 'viem'

// Re-export canonical types
export {
  createKMSSigner,
  getKMSSigner,
  type KMSKeyInfo,
  KMSSigner,
  type KMSSignerConfig,
  type SigningMode,
  type SignResult,
  type TransactionSignResult,
  validateSecureSigning,
}

/**
 * SecureSigner interface for backward compatibility with DWS code
 *
 * Wraps KMSSigner with simplified method signatures that return raw Hex
 * instead of SignResult objects.
 */
export interface SecureSigner {
  /** Get the signer's Ethereum address */
  getAddress(): Address
  /** Sign a message (returns raw signature hex) */
  signMessage(message: string | Uint8Array): Promise<Hex>
  /** Sign a hash directly (returns raw signature hex) */
  signHash(hash: Hex): Promise<Hex>
  /** Check if signer is initialized */
  isInitialized(): boolean
}

/**
 * Create a SecureSigner that wraps KMSSigner
 *
 * @param ownerAddress - Owner address (used as service ID prefix)
 * @param keyId - KMS key ID or service identifier
 */
export async function createSecureSigner(
  ownerAddress: Address,
  keyId: string,
): Promise<SecureSigner> {
  // Create KMSSigner with service ID based on owner + keyId
  const serviceId = `dws-${ownerAddress.toLowerCase()}-${keyId}`
  const signer = createKMSSigner({ serviceId })

  // Initialize the underlying signer
  await signer.initialize()

  // Return wrapper with simplified interface
  return {
    getAddress(): Address {
      return signer.getAddress()
    },

    async signMessage(message: string | Uint8Array): Promise<Hex> {
      const result = await signer.signMessage(message)
      return result.signature
    },

    async signHash(hash: Hex): Promise<Hex> {
      const result = await signer.sign(hash)
      return result.signature
    },

    isInitialized(): boolean {
      return signer.getStatus().initialized
    },
  }
}
