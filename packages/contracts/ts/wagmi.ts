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

// Accept any function and cast internally to bypass wagmi's complex types
type AnyWriteContractFn = (...args: never[]) => void
type AnyWriteContractAsyncFn = (...args: never[]) => Promise<`0x${string}`>

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
export function createTypedWriteContract<TFn extends AnyWriteContractFn>(
  writeContract: TFn,
): <TAbi extends Abi>(params: TypedWriteContractParams<TAbi>) => void {
  const fn = writeContract as unknown as (params: unknown) => void
  return (params) => fn(params)
}

/**
 * Create a typed async write contract function from wagmi's useWriteContract.
 */
export function createTypedWriteContractAsync<
  TFn extends AnyWriteContractAsyncFn,
>(
  writeContractAsync: TFn,
): <TAbi extends Abi>(
  params: TypedWriteContractParams<TAbi>,
) => Promise<`0x${string}`> {
  const fn = writeContractAsync as unknown as (
    params: unknown,
  ) => Promise<`0x${string}`>
  return (params) => fn(params)
}

/**
 * Helper function for typed write contract operations.
 */
export function typedWriteContract<
  TFn extends AnyWriteContractFn,
  TAbi extends Abi,
>(writeContract: TFn, params: TypedWriteContractParams<TAbi>): void {
  const fn = writeContract as unknown as (params: unknown) => void
  fn(params)
}

/**
 * Helper function for typed async write contract operations.
 */
export function typedWriteContractAsync<
  TFn extends AnyWriteContractAsyncFn,
  TAbi extends Abi,
>(
  writeContractAsync: TFn,
  params: TypedWriteContractParams<TAbi>,
): Promise<`0x${string}`> {
  const fn = writeContractAsync as unknown as (
    params: unknown,
  ) => Promise<`0x${string}`>
  return fn(params)
}
