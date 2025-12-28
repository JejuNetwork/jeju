/**
 * Secure Transaction Utilities
 *
 * Provides KMS-backed transaction signing for all services.
 * This module ensures no private keys are held in memory.
 *
 * SECURITY PROPERTIES:
 * - All signing delegated to KMS MPC
 * - No private keys in node memory
 * - TEE attestation required for production
 */

import type { Abi, Address, Hex, PublicClient } from 'viem'
import { encodeFunctionData } from 'viem'
import { createSecureSigner, type SecureSigner } from './secure-signer'

export interface SecureTransactionConfig {
  keyId: string
  chainId: number
  publicClient: PublicClient
}

/**
 * Create a secure transaction executor
 *
 * Use this instead of direct walletClient.writeContract calls
 */
export function createSecureTransactionExecutor(
  config: SecureTransactionConfig,
) {
  const signer = createSecureSigner(config.keyId)

  return {
    /**
     * Execute a contract call with KMS-backed signing
     */
    async writeContract(params: {
      address: Address
      abi: Abi
      functionName: string
      args?: readonly unknown[]
      value?: bigint
    }): Promise<Hex> {
      const data = encodeFunctionData({
        abi: params.abi,
        functionName: params.functionName,
        args: params.args ?? [],
      } as Parameters<typeof encodeFunctionData>[0]) as Hex

      const { signedTransaction, hash } = await signer.signTransaction({
        to: params.address,
        data,
        value: params.value,
        chainId: config.chainId,
      })

      await config.publicClient.sendRawTransaction({
        serializedTransaction: signedTransaction,
      })

      return hash
    },

    /**
     * Sign a message via KMS
     */
    async signMessage(message: string | Uint8Array): Promise<Hex> {
      return signer.signMessage({ message })
    },

    /**
     * Get the address for this signer (derived from KMS key)
     */
    async getAddress(): Promise<Address> {
      return signer.getAddress()
    },

    /**
     * Get the underlying signer for advanced use cases
     */
    getSigner(): SecureSigner {
      return signer
    },
  }
}

export type SecureTransactionExecutor = ReturnType<
  typeof createSecureTransactionExecutor
>
