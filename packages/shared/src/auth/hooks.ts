/**
 * Auth Hooks
 * 
 * Additional hooks for authentication functionality.
 */

import { useState, useEffect, useCallback } from 'react';
import type { AuthSession, PasskeyCredential } from './types';
import { isPlatformAuthenticatorAvailable, isWebAuthnSupported } from './passkeys';

/**
 * Hook to check if passkeys are available
 */
export function usePasskeyAvailability() {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isPlatformAvailable, setIsPlatformAvailable] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function check() {
      const webauthnSupported = isWebAuthnSupported();
      setIsAvailable(webauthnSupported);
      
      if (webauthnSupported) {
        const platformAvailable = await isPlatformAuthenticatorAvailable();
        setIsPlatformAvailable(platformAvailable);
      }
      
      setIsLoading(false);
    }
    check();
  }, []);

  return { isAvailable, isPlatformAvailable, isLoading };
}

/**
 * Hook to manage stored passkeys
 */
export function usePasskeys() {
  const [credentials, setCredentials] = useState<PasskeyCredential[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const STORAGE_KEY = 'jeju_passkeys';

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setCredentials(JSON.parse(stored));
    }
    setIsLoading(false);
  }, []);

  const addCredential = useCallback((credential: PasskeyCredential) => {
    setCredentials(prev => {
      const updated = [...prev, credential];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const removeCredential = useCallback((id: string) => {
    setCredentials(prev => {
      const updated = prev.filter(c => c.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const updateCredential = useCallback((id: string, updates: Partial<PasskeyCredential>) => {
    setCredentials(prev => {
      const updated = prev.map(c => c.id === id ? { ...c, ...updates } : c);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  return {
    credentials,
    isLoading,
    addCredential,
    removeCredential,
    updateCredential,
  };
}

/**
 * Hook to track session expiry
 */
export function useSessionExpiry(session: AuthSession | null) {
  const [isExpired, setIsExpired] = useState(false);
  const [expiresIn, setExpiresIn] = useState<number | null>(null);

  useEffect(() => {
    if (!session) {
      setIsExpired(false);
      setExpiresIn(null);
      return;
    }

    const checkExpiry = () => {
      const remaining = session.expiresAt - Date.now();
      setExpiresIn(remaining);
      setIsExpired(remaining <= 0);
    };

    checkExpiry();
    const interval = setInterval(checkExpiry, 1000);

    return () => clearInterval(interval);
  }, [session]);

  return { isExpired, expiresIn };
}

/**
 * Hook to detect wallet connection changes
 */
export function useWalletConnectionStatus() {
  const [isMetaMaskInstalled, setIsMetaMaskInstalled] = useState(false);
  const [hasConnectedBefore, setHasConnectedBefore] = useState(false);

  useEffect(() => {
    // Check MetaMask
    setIsMetaMaskInstalled(typeof window !== 'undefined' && !!window.ethereum?.isMetaMask);
    
    // Check connection history
    const connected = localStorage.getItem('jeju_wallet_connected');
    setHasConnectedBefore(connected === 'true');
  }, []);

  const markConnected = useCallback(() => {
    localStorage.setItem('jeju_wallet_connected', 'true');
    setHasConnectedBefore(true);
  }, []);

  return { isMetaMaskInstalled, hasConnectedBefore, markConnected };
}

// Add ethereum type for window
declare global {
  interface Window {
    ethereum?: {
      isMetaMask?: boolean;
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}
