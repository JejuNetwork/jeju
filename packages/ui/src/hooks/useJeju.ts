import type { JejuClient } from '@jejunetwork/sdk'
import type { NetworkType } from '@jejunetwork/types'
import type { Address } from 'viem'
import { useNetworkContext } from '../context'

export interface JejuState {
  client: JejuClient | null
  isLoading: boolean
  error: Error | null
  isConnected: boolean
  address: Address | null
  network: NetworkType | null
  chainId: number | null
  isSmartAccount: boolean
}

export function useJeju(): JejuState {
  const { client, isLoading, error } = useNetworkContext()

  if (!client) {
    return {
      client: null,
      isLoading,
      error,
      isConnected: false,
      address: null,
      network: null,
      chainId: null,
      isSmartAccount: false,
    }
  }

  return {
    client,
    isLoading,
    error,
    isConnected: true,
    address: client.address,
    network: client.network,
    chainId: client.chainId,
    isSmartAccount: client.isSmartAccount,
  }
}
