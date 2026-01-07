/**
 * useBundler Hook
 *
 * React hook for ERC-4337 bundler integration.
 * Sends UserOperations through the bundler for Account Abstraction.
 */

import { useCallback, useState } from 'react'
import type { Address, Hex } from 'viem'
import { useNetworkContext } from '../context'
import { requireClient } from './utils'

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** UserOperation struct for ERC-4337 */
export interface UserOperation {
  sender: Address
  nonce: bigint
  initCode: Hex
  callData: Hex
  callGasLimit: bigint
  verificationGasLimit: bigint
  preVerificationGas: bigint
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  paymasterAndData: Hex
  signature: Hex
}

/** Partial UserOp for easier construction */
export interface PartialUserOperation {
  sender: Address
  callData: Hex
  nonce?: bigint
  paymasterAndData?: Hex
  signature?: Hex
}

/** Bundler state */
export interface UseBundlerResult {
  /** Send a UserOperation */
  sendUserOp: (userOp: PartialUserOperation) => Promise<Hex>
  /** Transaction hash after confirmation */
  hash: Hex | null
  /** Loading state */
  isLoading: boolean
  /** Error message */
  error: string | null
  /** Whether bundler is available */
  isAvailable: boolean
  /** Reset state */
  reset: () => void
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

// ERC-4337 EntryPoint v0.6.0 address (canonical)
const ENTRY_POINT_ADDRESS = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789' as Address

// ═══════════════════════════════════════════════════════════════════════════
// Hook Implementation
// ═══════════════════════════════════════════════════════════════════════════

export function useBundler(): UseBundlerResult {
  const { client } = useNetworkContext()

  // State
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hash, setHash] = useState<Hex | null>(null)

  // Check if bundler is available via SDK
  const isAvailable = Boolean(client && 'bundler' in client)

  // Send UserOperation
  const sendUserOp = useCallback(
    async (partial: PartialUserOperation): Promise<Hex> => {
      const c = requireClient(client)

      if (!('bundler' in c)) {
        throw new Error('Bundler not available')
      }

      setIsLoading(true)
      setError(null)

      try {
        // Use SDK's bundler module
        const bundler = c.bundler as { sendUserOp?: (op: PartialUserOperation) => Promise<Hex> }
        if (!bundler.sendUserOp) {
          throw new Error('Bundler sendUserOp not available')
        }

        const userOpHash = await bundler.sendUserOp(partial)
        setHash(userOpHash)
        return userOpHash
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to send UserOperation'
        setError(message)
        throw err
      } finally {
        setIsLoading(false)
      }
    },
    [client],
  )

  // Reset state
  const reset = useCallback(() => {
    setHash(null)
    setError(null)
    setIsLoading(false)
  }, [])

  return {
    sendUserOp,
    hash,
    isLoading,
    error,
    isAvailable,
    reset,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Utility: Get EntryPoint address
// ═══════════════════════════════════════════════════════════════════════════

export function getEntryPointAddress(): Address {
  return ENTRY_POINT_ADDRESS
}
