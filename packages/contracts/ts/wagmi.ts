/**
 * Wagmi Utilities for Type-Safe Contract Interactions
 *
 * These utilities provide properly typed wrappers around wagmi hooks
 * that handle viem 2.43+ EIP-7702 type strictness.
 *
 * @module @jejunetwork/contracts/wagmi
 */

import type { Abi, Address } from 'viem'

/**
 * Parameters for typed write contract operations.
 */
export interface TypedWriteContractParams<TAbi extends Abi> {
  address: Address
  abi: TAbi
  functionName: string
  args?: readonly unknown[]
  value?: bigint
}

/**
 * WriteContract function signature that accepts our typed params.
 * This is permissive to work with wagmi's writeContract function.
 */
// biome-ignore lint/suspicious/noExplicitAny: Required for wagmi compatibility
export type WriteContractFn = (params: any) => void

// biome-ignore lint/suspicious/noExplicitAny: Required for wagmi compatibility
export type WriteContractAsyncFn = (params: any) => Promise<`0x${string}`>

/**
 * Create a typed write contract function from wagmi's useWriteContract.
 *
 * @example
 * ```typescript
 * import { useWriteContract } from 'wagmi'
 * import { createTypedWriteContract } from '@jejunetwork/contracts'
 *
 * const { writeContract } = useWriteContract()
 * const typedWrite = createTypedWriteContract(writeContract)
 *
 * typedWrite({
 *   address: contractAddress,
 *   abi: MY_ABI,
 *   functionName: 'transfer',
 *   args: [recipient, amount],
 * })
 * ```
 */
export function createTypedWriteContract(
  writeContract: WriteContractFn,
): <TAbi extends Abi>(params: TypedWriteContractParams<TAbi>) => void {
  return <TAbi extends Abi>(params: TypedWriteContractParams<TAbi>) => {
    writeContract({
      address: params.address,
      abi: params.abi,
      functionName: params.functionName,
      args: params.args,
      value: params.value,
    })
  }
}

/**
 * Create a typed async write contract function from wagmi's useWriteContract.
 */
export function createTypedWriteContractAsync(
  writeContractAsync: WriteContractAsyncFn,
): <TAbi extends Abi>(
  params: TypedWriteContractParams<TAbi>,
) => Promise<`0x${string}`> {
  return <TAbi extends Abi>(params: TypedWriteContractParams<TAbi>) => {
    return writeContractAsync({
      address: params.address,
      abi: params.abi,
      functionName: params.functionName,
      args: params.args,
      value: params.value,
    })
  }
}

/**
 * Helper function for typed write contract operations.
 */
export function typedWriteContract<TAbi extends Abi>(
  writeContract: WriteContractFn,
  params: TypedWriteContractParams<TAbi>,
): void {
  writeContract({
    address: params.address,
    abi: params.abi,
    functionName: params.functionName,
    args: params.args,
    value: params.value,
  })
}

/**
 * Helper function for typed async write contract operations.
 */
export function typedWriteContractAsync<TAbi extends Abi>(
  writeContractAsync: WriteContractAsyncFn,
  params: TypedWriteContractParams<TAbi>,
): Promise<`0x${string}`> {
  return writeContractAsync({
    address: params.address,
    abi: params.abi,
    functionName: params.functionName,
    args: params.args,
    value: params.value,
  })
}
