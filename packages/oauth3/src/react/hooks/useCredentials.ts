/**
 * useCredentials Hook
 *
 * Manages verifiable credentials for the authenticated user.
 */

import { useCallback, useEffect, useState } from 'react'
import type { AuthProvider, VerifiableCredential } from '../../index.js'
import {
  CredentialVerifyResponseSchema,
  expectEndpoint,
  validateResponse,
} from '../../validation.js'
import { useOAuth3 } from '../provider.js'

export interface UseCredentialsReturn {
  credentials: VerifiableCredential[]
  isLoading: boolean
  error: string | null

  // Actions
  issueCredential: (
    provider: AuthProvider,
    providerId: string,
    providerHandle: string,
  ) => Promise<VerifiableCredential | null>
  verifyCredential: (credential: VerifiableCredential) => Promise<boolean>
  refreshCredentials: () => Promise<void>
}

export function useCredentials(): UseCredentialsReturn {
  const {
    client,
    session,
    getCredentials,
    issueCredential: oauth3IssueCredential,
  } = useOAuth3()
  const [credentials, setCredentials] = useState<VerifiableCredential[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshCredentials = useCallback(async () => {
    if (!session) {
      setCredentials([])
      return
    }

    setIsLoading(true)
    setError(null)

    const creds = await getCredentials()
    setCredentials(creds)
    setIsLoading(false)
  }, [session, getCredentials])

  // Load credentials on mount and session change
  useEffect(() => {
    if (session) {
      refreshCredentials()
    } else {
      setCredentials([])
    }
  }, [session?.sessionId, refreshCredentials, session])

  const issueCredential = useCallback(
    async (
      provider: AuthProvider,
      providerId: string,
      providerHandle: string,
    ): Promise<VerifiableCredential | null> => {
      if (!session) return null

      setIsLoading(true)
      setError(null)

      const credential = await oauth3IssueCredential(
        provider,
        providerId,
        providerHandle,
      )

      // Add to local state
      setCredentials((prev) => [...prev, credential])
      setIsLoading(false)

      return credential
    },
    [session, oauth3IssueCredential],
  )

  const verifyCredential = useCallback(
    async (credential: VerifiableCredential): Promise<boolean> => {
      const node = client.getCurrentNode()
      const url = expectEndpoint(node)

      const response = await fetch(`${url}/credential/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }),
      })

      if (!response.ok) {
        return false
      }

      const result = validateResponse(
        CredentialVerifyResponseSchema,
        await response.json(),
        'credential verify response',
      )
      return result.valid
    },
    [client],
  )

  return {
    credentials,
    isLoading,
    error,
    issueCredential,
    verifyCredential,
    refreshCredentials,
  }
}
