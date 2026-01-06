/**
 * Wagmi Utilities for Type-Safe Contract Interactions
 *
 * These utilities provide properly typed wrappers around wagmi hooks
 * that handle viem 2.43+ EIP-7702 type strictness.
 *
 * @module @jejunetwork/contracts/wagmi
 */

import type {
  Abi,
  Address,
  ContractFunctionArgs,
  ContractFunctionName,
} from 'viem'

/**
 * Parameters for typed write contract operations.
 * Note: args uses readonly unknown[] for wagmi compatibility, but when used
 * with a specific ABI and functionName, TypeScript will infer the correct types.
 */
export interface TypedWriteContractParams<
  TAbi extends Abi,
  TFunctionName extends ContractFunctionName<
    TAbi,
    'nonpayable' | 'payable'
  > = ContractFunctionName<TAbi, 'nonpayable' | 'payable'>,
  TArgs extends ContractFunctionArgs<
    TAbi,
    'nonpayable' | 'payable',
    TFunctionName
  > = ContractFunctionArgs<TAbi, 'nonpayable' | 'payable', TFunctionName>,
> {
  address: Address
  abi: TAbi
  functionName: TFunctionName
  args?: TArgs
  value?: bigint
}

/**
 * WriteContract function signature that accepts our typed params.
 * Uses readonly unknown[] for args to match wagmi's interface requirements.
 */
export type WriteContractFn = (params: {
  address: Address
  abi: Abi
  functionName: string
  args?: readonly unknown[]
  value?: bigint
}) => void

export type WriteContractAsyncFn = (params: {
  address: Address
  abi: Abi
  functionName: string
  args?: readonly unknown[]
  value?: bigint
}) => Promise<`0x${string}`>

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
): <
  TAbi extends Abi,
  TFunctionName extends ContractFunctionName<
    TAbi,
    'nonpayable' | 'payable'
  > = ContractFunctionName<TAbi, 'nonpayable' | 'payable'>,
  TArgs extends ContractFunctionArgs<
    TAbi,
    'nonpayable' | 'payable',
    TFunctionName
  > = ContractFunctionArgs<TAbi, 'nonpayable' | 'payable', TFunctionName>,
>(
  params: TypedWriteContractParams<TAbi, TFunctionName, TArgs>,
) => void {
  return <
    TAbi extends Abi,
    TFunctionName extends ContractFunctionName<
      TAbi,
      'nonpayable' | 'payable'
    > = ContractFunctionName<TAbi, 'nonpayable' | 'payable'>,
    TArgs extends ContractFunctionArgs<
      TAbi,
      'nonpayable' | 'payable',
      TFunctionName
    > = ContractFunctionArgs<TAbi, 'nonpayable' | 'payable', TFunctionName>,
  >(
    params: TypedWriteContractParams<TAbi, TFunctionName, TArgs>,
  ) => {
    writeContract({
      address: params.address,
      abi: params.abi,
      functionName: params.functionName,
      args: params.args as readonly unknown[] | undefined,
      value: params.value,
    })
  }
}

/**
 * Create a typed async write contract function from wagmi's useWriteContract.
 */
export function createTypedWriteContractAsync(
  writeContractAsync: WriteContractAsyncFn,
): <
  TAbi extends Abi,
  TFunctionName extends ContractFunctionName<
    TAbi,
    'nonpayable' | 'payable'
  > = ContractFunctionName<TAbi, 'nonpayable' | 'payable'>,
  TArgs extends ContractFunctionArgs<
    TAbi,
    'nonpayable' | 'payable',
    TFunctionName
  > = ContractFunctionArgs<TAbi, 'nonpayable' | 'payable', TFunctionName>,
>(
  params: TypedWriteContractParams<TAbi, TFunctionName, TArgs>,
) => Promise<`0x${string}`> {
  return <
    TAbi extends Abi,
    TFunctionName extends ContractFunctionName<
      TAbi,
      'nonpayable' | 'payable'
    > = ContractFunctionName<TAbi, 'nonpayable' | 'payable'>,
    TArgs extends ContractFunctionArgs<
      TAbi,
      'nonpayable' | 'payable',
      TFunctionName
    > = ContractFunctionArgs<TAbi, 'nonpayable' | 'payable', TFunctionName>,
  >(
    params: TypedWriteContractParams<TAbi, TFunctionName, TArgs>,
  ) => {
    return writeContractAsync({
      address: params.address,
      abi: params.abi,
      functionName: params.functionName,
      args: params.args as readonly unknown[] | undefined,
      value: params.value,
    })
  }
}

/**
 * Helper function for typed write contract operations.
 */
export function typedWriteContract<
  TAbi extends Abi,
  TFunctionName extends ContractFunctionName<
    TAbi,
    'nonpayable' | 'payable'
  > = ContractFunctionName<TAbi, 'nonpayable' | 'payable'>,
  TArgs extends ContractFunctionArgs<
    TAbi,
    'nonpayable' | 'payable',
    TFunctionName
  > = ContractFunctionArgs<TAbi, 'nonpayable' | 'payable', TFunctionName>,
>(
  writeContract: WriteContractFn,
  params: TypedWriteContractParams<TAbi, TFunctionName, TArgs>,
): void {
  writeContract({
    address: params.address,
    abi: params.abi,
    functionName: params.functionName,
    args: params.args as readonly unknown[] | undefined,
    value: params.value,
  })
}

/**
 * Helper function for typed async write contract operations.
 */
export function typedWriteContractAsync<
  TAbi extends Abi,
  TFunctionName extends ContractFunctionName<
    TAbi,
    'nonpayable' | 'payable'
  > = ContractFunctionName<TAbi, 'nonpayable' | 'payable'>,
  TArgs extends ContractFunctionArgs<
    TAbi,
    'nonpayable' | 'payable',
    TFunctionName
  > = ContractFunctionArgs<TAbi, 'nonpayable' | 'payable', TFunctionName>,
>(
  writeContractAsync: WriteContractAsyncFn,
  params: TypedWriteContractParams<TAbi, TFunctionName, TArgs>,
): Promise<`0x${string}`> {
  return writeContractAsync({
    address: params.address,
    abi: params.abi,
    functionName: params.functionName,
    args: params.args as readonly unknown[] | undefined,
    value: params.value,
  })
}
