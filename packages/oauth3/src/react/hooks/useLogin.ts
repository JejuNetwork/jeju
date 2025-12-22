/**
 * useLogin Hook
 *
 * Provides login functionality with provider-specific options.
 */

import { useCallback, useState } from 'react'
import type { AuthProvider, OAuth3Session } from '../../index.js'
import { extractError, getEndpointWithDevFallback } from '../../validation.js'
import { useOAuth3 } from '../provider.js'

export interface UseLoginOptions {
  onSuccess?: (session: OAuth3Session) => void
  onError?: (error: Error) => void
}

export interface UseLoginReturn {
  login: (provider: AuthProvider) => Promise<OAuth3Session | null>
  loginWithEmail: (email: string) => Promise<{ magicLinkSent: boolean }>
  loginWithPhone: (phone: string) => Promise<{ otpSent: boolean }>
  verifyEmailCode: (
    email: string,
    code: string,
  ) => Promise<OAuth3Session | null>
  verifyPhoneCode: (
    phone: string,
    code: string,
  ) => Promise<OAuth3Session | null>
  isLoading: boolean
  error: string | null
}

export function useLogin(options: UseLoginOptions = {}): UseLoginReturn {
  const { login: oauth3Login, client } = useOAuth3()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const login = useCallback(
    async (provider: AuthProvider): Promise<OAuth3Session | null> => {
      setIsLoading(true)
      setError(null)

      const session = await oauth3Login(provider)
      options.onSuccess?.(session)
      setIsLoading(false)
      return session
    },
    [oauth3Login, options],
  )

  const loginWithEmail = useCallback(
    async (email: string): Promise<{ magicLinkSent: boolean }> => {
      setIsLoading(true)
      setError(null)

      const node = client.getCurrentNode()
      const url = getEndpointWithDevFallback(node)
      const response = await fetch(`${url}/auth/email/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      setIsLoading(false)

      if (!response.ok) {
        const errorData = await response.json()
        setError(extractError(errorData))
        return { magicLinkSent: false }
      }

      return { magicLinkSent: true }
    },
    [client],
  )

  const loginWithPhone = useCallback(
    async (phone: string): Promise<{ otpSent: boolean }> => {
      setIsLoading(true)
      setError(null)

      const node = client.getCurrentNode()
      const url = getEndpointWithDevFallback(node)
      const response = await fetch(`${url}/auth/phone/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })

      setIsLoading(false)

      if (!response.ok) {
        const errorData = await response.json()
        setError(extractError(errorData))
        return { otpSent: false }
      }

      return { otpSent: true }
    },
    [client],
  )

  const verifyEmailCode = useCallback(
    async (email: string, code: string): Promise<OAuth3Session | null> => {
      setIsLoading(true)
      setError(null)

      const node = client.getCurrentNode()
      const url = getEndpointWithDevFallback(node)
      const response = await fetch(`${url}/auth/email/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      })

      setIsLoading(false)

      if (!response.ok) {
        const errorData = await response.json()
        const errorMessage = extractError(errorData)
        setError(errorMessage)
        options.onError?.(new Error(errorMessage))
        return null
      }

      const session = (await response.json()) as OAuth3Session
      options.onSuccess?.(session)
      return session
    },
    [client, options],
  )

  const verifyPhoneCode = useCallback(
    async (phone: string, code: string): Promise<OAuth3Session | null> => {
      setIsLoading(true)
      setError(null)

      const node = client.getCurrentNode()
      const url = getEndpointWithDevFallback(node)
      const response = await fetch(`${url}/auth/phone/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      })

      setIsLoading(false)

      if (!response.ok) {
        const errorData = await response.json()
        const errorMessage = extractError(errorData)
        setError(errorMessage)
        options.onError?.(new Error(errorMessage))
        return null
      }

      const session = (await response.json()) as OAuth3Session
      options.onSuccess?.(session)
      return session
    },
    [client, options],
  )

  return {
    login,
    loginWithEmail,
    loginWithPhone,
    verifyEmailCode,
    verifyPhoneCode,
    isLoading,
    error,
  }
}
