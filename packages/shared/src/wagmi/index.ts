/**
 * Wagmi Utilities for Type-Safe Contract Interactions
 *
 * These utilities provide properly typed wrappers around wagmi hooks
 * that handle viem 2.43+ EIP-7702 type strictness.
 *
 * @example
 * ```typescript
 * import { useTypedWriteContract } from '@jejunetwork/shared/wagmi'
 *
 * function MyComponent() {
 *   const { writeContract, isPending } = useTypedWriteContract()
 *
 *   const handleClick = () => {
 *     writeContract({
 *       address: contractAddress,
 *       abi: MY_ABI,
 *       functionName: 'transfer',
 *       args: [recipient, amount],
 *     })
 *   }
 * }
 * ```
 *
 * @module @jejunetwork/shared/wagmi
 */

import type { Abi, Address } from 'viem'
import type { UseWriteContractReturnType } from 'wagmi'

/**
 * Parameters for a typed contract write call.
 * Compatible with wagmi's useWriteContract hook.
 */
export interface TypedWriteContractParams<TAbi extends Abi = Abi> {
  address: Address
  abi: TAbi
  functionName: string
  args?: readonly unknown[]
  value?: bigint
}

/**
 * The internal parameter type that wagmi's writeContract accepts.
 * This matches the actual runtime shape wagmi expects.
 */
type WriteContractInternalParams = {
  address: Address
  abi: Abi
  functionName: string
  args?: readonly unknown[]
  value?: bigint
}

/**
 * Type for wagmi's writeContract function with relaxed input types.
 * This matches what wagmi actually accepts at runtime.
 */
type WriteContractFunction = (params: WriteContractInternalParams) => void

/**
 * Type for wagmi's writeContractAsync function with relaxed input types.
 */
type WriteContractAsyncFunction = (
  params: WriteContractInternalParams,
) => Promise<`0x${string}`>

/**
 * Type-safe wrapper for wagmi's writeContract function.
 *
 * This wrapper handles the viem 2.43+ type strictness without
 * requiring type assertions at every call site.
 *
 * @param writeContract - The writeContract function from useWriteContract
 * @param params - The contract write parameters
 */
export function typedWriteContract<TAbi extends Abi>(
  writeContract: WriteContractFunction,
  params: TypedWriteContractParams<TAbi>,
): void {
  writeContract(params)
}

/**
 * Type-safe wrapper for wagmi's writeContractAsync function.
 *
 * @param writeContractAsync - The writeContractAsync function from useWriteContract
 * @param params - The contract write parameters
 * @returns Promise resolving to the transaction hash
 */
export async function typedWriteContractAsync<TAbi extends Abi>(
  writeContractAsync: WriteContractAsyncFunction,
  params: TypedWriteContractParams<TAbi>,
): Promise<`0x${string}`> {
  return writeContractAsync(params)
}

/**
 * Create a typed write contract function from wagmi's useWriteContract.
 *
 * This factory creates a wrapper that accepts properly typed parameters
 * and forwards them to wagmi's writeContract function.
 *
 * @example
 * ```typescript
 * const { writeContract, writeContractAsync } = useWriteContract()
 * const typedWrite = createTypedWriteContract(writeContract)
 * const typedWriteAsync = createTypedWriteContractAsync(writeContractAsync)
 *
 * // Now use without type assertions
 * typedWrite({
 *   address: contractAddress,
 *   abi: MY_ABI,
 *   functionName: 'approve',
 *   args: [spender, amount],
 * })
 * ```
 */
export function createTypedWriteContract(
  writeContract: UseWriteContractReturnType['writeContract'],
): <TAbi extends Abi>(params: TypedWriteContractParams<TAbi>) => void {
  // Cast is necessary here because wagmi's writeContract type is overly strict
  // due to viem 2.43+ EIP-7702 changes. The actual runtime behavior accepts
  // our TypedWriteContractParams shape.
  const fn = writeContract as WriteContractFunction
  return (params) => fn(params)
}

/**
 * Create a typed async write contract function from wagmi's useWriteContract.
 */
export function createTypedWriteContractAsync(
  writeContractAsync: UseWriteContractReturnType['writeContractAsync'],
): <TAbi extends Abi>(
  params: TypedWriteContractParams<TAbi>,
) => Promise<`0x${string}`> {
  // Cast is necessary here because wagmi's writeContractAsync type is overly strict.
  const fn = writeContractAsync as WriteContractAsyncFunction
  return (params) => fn(params)
}

// Re-export common types that should be used with these helpers
export type { Abi, Address }
