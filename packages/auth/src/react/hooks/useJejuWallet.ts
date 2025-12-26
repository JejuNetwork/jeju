/**
 * useJejuWallet - Convenience wrapper for wallet operations
 *
 * Provides wallet-focused API for signing and transactions.
 */

import { useCallback } from 'react'
import type { Address, Hex } from 'viem'
import { useOAuth3 } from '../provider.js'

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
  /** Sign typed data */
  signTypedData: (typedData: Record<string, unknown>) => Promise<Hex>
  /** Send a transaction */
  sendTransaction: (tx: {
    to: Address
    data?: Hex
    value?: bigint
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
    async (_typedData: Record<string, unknown>): Promise<Hex> => {
      // TODO: Implement typed data signing when available in OAuth3
      throw new Error('signTypedData not yet implemented')
    },
    [],
  )

  const sendTransaction = useCallback(
    async (_tx: { to: Address; data?: Hex; value?: bigint }): Promise<Hex> => {
      // TODO: Implement transaction sending via smart account
      throw new Error('sendTransaction not yet implemented')
    },
    [],
  )

  return {
    address: oauth3.smartAccountAddress,
    ready: oauth3.isAuthenticated && oauth3.smartAccountAddress !== null,
    signMessage,
    signTypedData,
    sendTransaction,
  }
}
