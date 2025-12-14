/**
 * Core network hook
 */

import { useNetworkContext } from '../context';

export function useJeju() {
  const { client, isLoading, error } = useNetworkContext();

  return {
    client,
    isLoading,
    error,
    isConnected: !!client,
    address: client?.address ?? null,
    network: client?.network ?? null,
    chainId: client?.chainId ?? null,
    isSmartAccount: client?.isSmartAccount ?? false,
  };
}

