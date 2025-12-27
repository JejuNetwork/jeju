/**
 * useJejuWallet - Convenience wrapper for wallet operations
 *
 * Provides wallet-focused API for signing and transactions.
 */

import { useCallback } from 'react'
import type { Address, Hex } from 'viem'
import type { SignTypedDataOptions } from '../../sdk/client.js'
import { useOAuth3 } from '../provider.js'

/**
 * EIP-712 typed data structure
 */
export interface TypedDataParams {
  domain: {
    name?: string
    version?: string
    chainId?: number
    verifyingContract?: Address
    salt?: Hex
  }
  types: Record<string, Array<{ name: string; type: string }>>
  primaryType: string
  message: Record<string, unknown>
}

/**
 * Wallet hook return type
 */
export interface UseJejuWalletReturn {
  /** Smart wallet address */
  address: Address | null
  /** Whether the wallet is ready for transactions */
  ready: boolean
  /** Sign a message */
  signMessage: (message: string | Uint8Array) => Promise<Hex>
  /** Sign EIP-712 typed data */
  signTypedData: (typedData: TypedDataParams) => Promise<Hex>
  /** Send a transaction via the smart account */
  sendTransaction: (tx: {
    to: Address
    data?: Hex
    value?: bigint
    gasLimit?: bigint
  }) => Promise<Hex>
}

/**
 * useJejuWallet hook
 *
 * Returns the connected smart wallet address and signing methods.
 *
 * @example
 * ```tsx
 * import { useJejuWallet } from '@jejunetwork/auth';
 *
 * function MyComponent() {
 *   const { address, ready, signMessage } = useJejuWallet();
 *
 *   const handleSign = async () => {
 *     const sig = await signMessage('Hello');
 *     console.log('Signature:', sig);
 *   };
 *
 *   return ready ? <button onClick={handleSign}>Sign</button> : null;
 * }
 * ```
 */
export function useJejuWallet(): UseJejuWalletReturn {
  const oauth3 = useOAuth3()

  const signMessage = useCallback(
    async (message: string | Uint8Array): Promise<Hex> => {
      return oauth3.signMessage(message)
    },
    [oauth3.signMessage],
  )

  const signTypedData = useCallback(
    async (typedData: TypedDataParams): Promise<Hex> => {
      const options: SignTypedDataOptions = {
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      }
      return oauth3.client.signTypedData(options)
    },
    [oauth3.client],
  )

  const sendTransaction = useCallback(
    async (tx: {
      to: Address
      data?: Hex
      value?: bigint
      gasLimit?: bigint
    }): Promise<Hex> => {
      return oauth3.client.sendTransaction(tx)
    },
    [oauth3.client],
  )

  return {
    address: oauth3.smartAccountAddress,
    ready: oauth3.isAuthenticated && oauth3.smartAccountAddress !== null,
    signMessage,
    signTypedData,
    sendTransaction,
  }
}
