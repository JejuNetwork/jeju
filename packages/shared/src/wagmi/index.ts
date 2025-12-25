/**
 * Wagmi Utilities for Type-Safe Contract Interactions
 *
 * This module is intentionally minimal - see useTypedWriteContract hook
 * in apps/gateway/web/hooks/useTypedWriteContract.ts for the full solution.
 *
 * @module @jejunetwork/shared/wagmi
 */

import type { Abi, Address } from 'viem'

/**
 * Input parameters for contract write operations.
 */
export interface WriteParamsInput {
  address: Address
  abi: Abi | readonly unknown[]
  functionName: string
  args?: readonly unknown[]
  value?: bigint
}

/**
 * Wagmi write params type alias
 */
export type WagmiWriteParams = WriteParamsInput

/**
 * Create typed params for wagmi writeContract
 */
export function writeParams<TAbi extends Abi>(
  params: WriteParamsInput & { abi: TAbi },
): WriteParamsInput {
  return params
}

/**
 * Create typed params for wagmi writeContractAsync
 */
export function writeParamsAsync<TAbi extends Abi>(
  params: WriteParamsInput & { abi: TAbi },
): WriteParamsInput {
  return params
}

// Re-export viem types for convenience
export type { Abi, Address }
