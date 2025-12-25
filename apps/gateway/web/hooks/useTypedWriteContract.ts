/**
 * Typed Write Contract Hook
 *
 * This hook wraps wagmi's useWriteContract to provide type-safe contract
 * interactions that are compatible with viem 2.43+ EIP-7702 types and
 * wagmi's multi-chain configuration.
 *
 * The issue: wagmi's types require `chain` and `account` when the config
 * has multiple chains. This hook automatically provides these from the
 * connected wallet context.
 */

import { useCallback } from 'react'
import type { Abi, Account, Address } from 'viem'
import {
  useAccount,
  useChainId,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'

/**
 * Parameters for typed contract write operations.
 */
export interface TypedWriteParams {
  address: Address
  abi: Abi | readonly unknown[]
  functionName: string
  args?: readonly unknown[]
  value?: bigint
  account?: Address | Account
}

/**
 * Hook that provides typed contract write functionality.
 *
 * @example
 * ```typescript
 * function MyComponent() {
 *   const { write, writeAsync, hash, isPending, isConfirming, isSuccess } = useTypedWriteContract()
 *
 *   const handleApprove = () => {
 *     write({
 *       address: tokenAddress,
 *       abi: ERC20_ABI,
 *       functionName: 'approve',
 *       args: [spender, amount],
 *     })
 *   }
 *
 *   return <button onClick={handleApprove}>Approve</button>
 * }
 * ```
 */
export function useTypedWriteContract() {
  const { address: accountAddress, chain } = useAccount()
  const chainId = useChainId()
  const {
    writeContract: _writeContract,
    writeContractAsync: _writeContractAsync,
    data: hash,
    isPending,
    error,
    reset,
    status,
  } = useWriteContract()

  const {
    isLoading: isConfirming,
    isSuccess,
    data: receipt,
  } = useWaitForTransactionReceipt({ hash })

  // Get the type of the first parameter of _writeContract
  type WriteContractParams = Parameters<typeof _writeContract>[0]

  /**
   * Synchronous write - triggers the transaction but doesn't wait.
   */
  const write = useCallback(
    (params: TypedWriteParams) => {
      if (!chain || !accountAddress) {
        throw new Error('Wallet not connected')
      }

      // Create params object with chain and account, cast to wagmi's expected type
      const fullParams = {
        ...params,
        chain,
        account: accountAddress,
      } as WriteContractParams

      _writeContract(fullParams)
    },
    [_writeContract, chain, accountAddress],
  )

  /**
   * Async write - returns promise with transaction hash.
   */
  const writeAsync = useCallback(
    async (params: TypedWriteParams): Promise<`0x${string}`> => {
      if (!chain || !accountAddress) {
        throw new Error('Wallet not connected')
      }

      const fullParams = {
        ...params,
        chain,
        account: accountAddress,
      } as WriteContractParams

      return _writeContractAsync(fullParams)
    },
    [_writeContractAsync, chain, accountAddress],
  )

  return {
    write,
    writeAsync,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
    reset,
    status,
    receipt,
    chainId,
    isConnected: !!accountAddress && !!chain,
  }
}
