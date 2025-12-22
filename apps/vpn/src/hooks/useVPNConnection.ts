/**
 * Hook for VPN connection management
 * 
 * Handles connecting and disconnecting VPN
 */

import { useState } from 'react';
import { invoke } from '../api';
import type { VPNNode } from '../api/schemas';

export function useVPNConnection() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const connect = async (node: VPNNode | null) => {
    setIsLoading(true);
    setError(null);
    try {
      await invoke('connect', { nodeId: node?.node_id ?? null });
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to connect');
      setError(error);
      throw error; // Fail fast
    } finally {
      setIsLoading(false);
    }
  };

  const disconnect = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await invoke('disconnect', {});
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to disconnect');
      setError(error);
      throw error; // Fail fast
    } finally {
      setIsLoading(false);
    }
  };

  return { connect, disconnect, isLoading, error };
}
