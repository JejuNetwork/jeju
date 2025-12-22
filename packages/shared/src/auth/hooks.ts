/**
 * Auth Hooks
 *
 * Additional hooks for authentication functionality.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  isPlatformAuthenticatorAvailable,
  isWebAuthnSupported,
} from './passkeys'
import { parseStoredPasskeys, type StoredPasskeyCredential } from './schemas'
import type { AuthSession, PasskeyCredential } from './types'

/**
 * Hook to check if passkeys are available
 */
export function usePasskeyAvailability(): {
  isAvailable: boolean
  isPlatformAvailable: boolean
  isLoading: boolean
} {
  const [isAvailable, setIsAvailable] = useState(false)
  const [isPlatformAvailable, setIsPlatformAvailable] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function check(): Promise<void> {
      const webauthnSupported = isWebAuthnSupported()
      setIsAvailable(webauthnSupported)

      if (webauthnSupported) {
        const platformAvailable = await isPlatformAuthenticatorAvailable()
        setIsPlatformAvailable(platformAvailable)
      }

      setIsLoading(false)
    }
    void check()
  }, [])

  return { isAvailable, isPlatformAvailable, isLoading }
}

// Convert stored credential format to runtime format
function toRuntimeCredential(
  stored: StoredPasskeyCredential,
): PasskeyCredential {
  return {
    ...stored,
    publicKey: Uint8Array.from(atob(stored.publicKey), (c) => c.charCodeAt(0)),
    transports: stored.transports as AuthenticatorTransport[] | undefined,
  }
}

// Convert runtime credential to storage format
function toStoredCredential(
  credential: PasskeyCredential,
): StoredPasskeyCredential {
  return {
    ...credential,
    publicKey: btoa(String.fromCharCode(...credential.publicKey)),
    transports: credential.transports,
  }
}

/**
 * Hook to manage stored passkeys
 */
export function usePasskeys(): {
  credentials: PasskeyCredential[]
  isLoading: boolean
  addCredential: (credential: PasskeyCredential) => void
  removeCredential: (id: string) => void
  updateCredential: (id: string, updates: Partial<PasskeyCredential>) => void
} {
  const [credentials, setCredentials] = useState<PasskeyCredential[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const STORAGE_KEY = 'jeju_passkeys'

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = parseStoredPasskeys(stored)
      setCredentials(parsed.map(toRuntimeCredential))
    }
    setIsLoading(false)
  }, [])

  const addCredential = useCallback((credential: PasskeyCredential): void => {
    setCredentials((prev) => {
      const updated = [...prev, credential]
      const storedFormat = updated.map(toStoredCredential)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(storedFormat))
      return updated
    })
  }, [])

  const removeCredential = useCallback((id: string): void => {
    setCredentials((prev) => {
      const updated = prev.filter((c) => c.id !== id)
      const storedFormat = updated.map(toStoredCredential)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(storedFormat))
      return updated
    })
  }, [])

  const updateCredential = useCallback(
    (id: string, updates: Partial<PasskeyCredential>): void => {
      setCredentials((prev) => {
        const updated = prev.map((c) =>
          c.id === id ? { ...c, ...updates } : c,
        )
        const storedFormat = updated.map(toStoredCredential)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(storedFormat))
        return updated
      })
    },
    [],
  )

  return {
    credentials,
    isLoading,
    addCredential,
    removeCredential,
    updateCredential,
  }
}

/**
 * Hook to track session expiry
 */
export function useSessionExpiry(session: AuthSession | null): {
  isExpired: boolean
  expiresIn: number | null
} {
  const [isExpired, setIsExpired] = useState(false)
  const [expiresIn, setExpiresIn] = useState<number | null>(null)

  useEffect(() => {
    if (!session) {
      setIsExpired(false)
      setExpiresIn(null)
      return
    }

    const checkExpiry = (): void => {
      const remaining = session.expiresAt - Date.now()
      setExpiresIn(remaining)
      setIsExpired(remaining <= 0)
    }

    checkExpiry()
    const interval = setInterval(checkExpiry, 1000)

    return () => clearInterval(interval)
  }, [session])

  return { isExpired, expiresIn }
}

/**
 * Hook to detect wallet connection changes
 */
export function useWalletConnectionStatus(): {
  isMetaMaskInstalled: boolean
  hasConnectedBefore: boolean
  markConnected: () => void
} {
  const [isMetaMaskInstalled, setIsMetaMaskInstalled] = useState(false)
  const [hasConnectedBefore, setHasConnectedBefore] = useState(false)

  useEffect(() => {
    // Check MetaMask
    setIsMetaMaskInstalled(
      typeof window !== 'undefined' && !!window.ethereum?.isMetaMask,
    )

    // Check connection history
    const connected = localStorage.getItem('jeju_wallet_connected')
    setHasConnectedBefore(connected === 'true')
  }, [])

  const markConnected = useCallback((): void => {
    localStorage.setItem('jeju_wallet_connected', 'true')
    setHasConnectedBefore(true)
  }, [])

  return { isMetaMaskInstalled, hasConnectedBefore, markConnected }
}

// Ethereum provider types
interface EthereumRequestParams {
  method: string
  params?: Array<string | number | Record<string, string | number>>
}

// Add ethereum type for window
declare global {
  interface Window {
    ethereum?: {
      isMetaMask?: boolean
      request: (args: EthereumRequestParams) => Promise<string | string[]>
    }
  }
}
