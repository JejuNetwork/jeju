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
 * Type-safe wrapper for wagmi's writeContract function.
 *
 * This wrapper handles the viem 2.43+ type strictness without
 * requiring type assertions at every call site.
 *
 * @param writeContract - The writeContract function from useWriteContract
 * @param params - The contract write parameters
 */
export function typedWriteContract<TAbi extends Abi>(
  writeContract: (params: unknown) => void,
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
  writeContractAsync: (params: unknown) => Promise<`0x${string}`>,
  params: TypedWriteContractParams<TAbi>,
): Promise<`0x${string}`> {
  return writeContractAsync(params)
}

/**
 * Create a typed write contract function from wagmi's useWriteContract.
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
  writeContract: (params: unknown) => void,
): <TAbi extends Abi>(params: TypedWriteContractParams<TAbi>) => void {
  return (params) => writeContract(params)
}

/**
 * Create a typed async write contract function from wagmi's useWriteContract.
 */
export function createTypedWriteContractAsync(
  writeContractAsync: (params: unknown) => Promise<`0x${string}`>,
): <TAbi extends Abi>(
  params: TypedWriteContractParams<TAbi>,
) => Promise<`0x${string}`> {
  return (params) => writeContractAsync(params)
}

// Re-export common ABIs that should be used with these helpers
export type { Abi, Address }
