/**
 * Hook for VPN status management
 * 
 * Handles fetching and updating VPN connection status
 */

import { useState, useEffect } from 'react';
import { invoke } from '../api';
import { VPNStatusSchema, type VPNStatus } from '../api/schemas';

export function useVPNStatus() {
  const [status, setStatus] = useState<VPNStatus>({ status: 'Disconnected', connection: null });
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const vpnStatus = await invoke('get_status', {}, VPNStatusSchema);
        setStatus(vpnStatus);
        setError(null);
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to fetch VPN status');
        setError(error);
        // Fail-fast: set error status
        setStatus({ status: 'Error', connection: null });
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  return { status, error };
}
