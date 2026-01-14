/**
 * OAuth3 React Provider
 *
 * Wraps your app to provide OAuth3 authentication context.
 */

import { TEEAttestationSchema } from '@jejunetwork/types'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { Address, Hex } from 'viem'
import { z } from 'zod'
import {
  createOAuth3Client,
  type LoginOptions,
  type OAuth3Client,
  type OAuth3Config,
  type OAuth3Event,
} from '../sdk/client.js'
import type {
  AuthProvider,
  OAuth3Session,
  VerifiableCredential,
} from '../types.js'
import { SessionCapability } from '../types.js'

// Hex string schema - validates 0x-prefixed hex strings
const HexSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]*$/, 'Invalid hex string') as z.ZodType<Hex>

// Address schema - validates Ethereum addresses (0x + 40 hex chars)
const AddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid address') as z.ZodType<Address>

// Session capability schema
const SessionCapabilitySchema = z.enum([
  SessionCapability.SIGN_TRANSACTION,
  SessionCapability.SIGN_MESSAGE,
  SessionCapability.MANAGE_IDENTITY,
  SessionCapability.DELEGATE,
])

// TEEAttestationSchema is imported from @jejunetwork/types

// Full OAuth3Session schema with proper validation
const OAuth3SessionSchema = z.object({
  sessionId: HexSchema,
  identityId: HexSchema,
  smartAccount: AddressSchema,
  expiresAt: z.number().int().positive(),
  capabilities: z.array(SessionCapabilitySchema),
  signingPublicKey: HexSchema,
  attestation: TEEAttestationSchema,
})

// Event data schema for extracting session with proper validation
const SessionEventDataSchema = z
  .object({
    session: OAuth3SessionSchema.optional(),
  })
  .optional()

/**
 * Validates and parses session data from events
 * @throws if session data is invalid
 */
function parseSessionFromEvent(event: OAuth3Event): OAuth3Session | undefined {
  const parsed = SessionEventDataSchema.safeParse(event.data)
  if (!parsed.success) {
    console.error('Invalid session data in event:', parsed.error.issues)
    return undefined
  }
  return parsed.data?.session
}

export interface OAuth3ProviderProps {
  children: ReactNode
  config: OAuth3Config
  autoConnect?: boolean
  onSessionChange?: (session: OAuth3Session | null) => void
}

export interface OAuth3ContextValue {
  // State
  client: OAuth3Client
  session: OAuth3Session | null
  isLoading: boolean
  isAuthenticated: boolean
  error: string | null

  // Auth methods
  login: (
    provider: AuthProvider,
    options?: Partial<LoginOptions>,
  ) => Promise<OAuth3Session>
  logout: () => Promise<void>
  linkProvider: (provider: AuthProvider) => Promise<void>
  unlinkProvider: (provider: AuthProvider) => Promise<void>

  // Session
  refreshSession: () => Promise<OAuth3Session>

  // Signing
  signMessage: (message: string | Uint8Array) => Promise<Hex>

  // Credentials
  getCredentials: () => Promise<VerifiableCredential[]>
  issueCredential: (
    provider: AuthProvider,
    providerId: string,
    providerHandle: string,
  ) => Promise<VerifiableCredential>

  // Helpers
  smartAccountAddress: Address | null
  identityId: Hex | null
}

const OAuth3Context = createContext<OAuth3ContextValue | null>(null)

export function OAuth3Provider({
  children,
  config,
  autoConnect = true,
  onSessionChange,
}: OAuth3ProviderProps) {
  const [client] = useState(() => createOAuth3Client(config))
  const [session, setSession] = useState<OAuth3Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Initialize client and load session
  useEffect(() => {
    const init = async () => {
      console.log('[OAuth3Provider] Initializing with config:', {
        appId: config.appId,
        redirectUri: config.redirectUri,
        teeAgentUrl: config.teeAgentUrl,
        chainId: config.chainId,
        decentralized: config.decentralized,
      })
      setIsLoading(true)
      setError(null)

      // Initialize decentralized discovery if enabled
      if (config.decentralized !== false) {
        await client.initialize().catch((err: Error) => {
          console.debug('[OAuth3Provider] Decentralized init failed (expected for localnet):', err.message)
        })
      }

      // Check for existing session
      const existingSession = client.getSession()
      if (existingSession && autoConnect) {
        console.log('[OAuth3Provider] Found existing session:', {
          sessionId: existingSession.sessionId.slice(0, 10) + '...',
          smartAccount: existingSession.smartAccount.slice(0, 10) + '...',
          expiresAt: new Date(existingSession.expiresAt).toISOString(),
          expired: existingSession.expiresAt < Date.now(),
        })
        setSession(existingSession)
        onSessionChange?.(existingSession)
      } else {
        console.log('[OAuth3Provider] No existing session found')
      }

      setIsLoading(false)
      console.log('[OAuth3Provider] Initialization complete')
    }

    init()
  }, [client, config.decentralized, autoConnect, onSessionChange])

  // Listen for client events
  useEffect(() => {
    const handleLogin = (event: OAuth3Event) => {
      const newSession = parseSessionFromEvent(event)
      if (newSession) {
        setSession(newSession)
        onSessionChange?.(newSession)
      }
    }

    const handleLogout = () => {
      setSession(null)
      onSessionChange?.(null)
    }

    const handleSessionRefresh = (event: OAuth3Event) => {
      const newSession = parseSessionFromEvent(event)
      if (newSession) {
        setSession(newSession)
        onSessionChange?.(newSession)
      }
    }

    const handleError = (event: OAuth3Event) => {
      const errorData = event.data as
        | { message?: string; error?: string }
        | undefined
      if (errorData) {
        setError(errorData.message ?? errorData.error ?? 'An error occurred')
      } else {
        setError('An error occurred')
      }
    }

    const unsubLogin = client.on('login', handleLogin)
    const unsubLogout = client.on('logout', handleLogout)
    const unsubRefresh = client.on('sessionRefresh', handleSessionRefresh)
    const unsubError = client.on('error', handleError)

    return () => {
      unsubLogin()
      unsubLogout()
      unsubRefresh()
      unsubError()
    }
  }, [client, onSessionChange])

  const login = useCallback(
    async (provider: AuthProvider, options: Partial<LoginOptions> = {}) => {
      console.log('[OAuth3Provider] login: Starting login with provider:', provider)
      setIsLoading(true)
      setError(null)

      try {
        const newSession = await client.login({ provider, ...options })
        console.log('[OAuth3Provider] login: Login successful, session created')
        setSession(newSession)
        setIsLoading(false)
        return newSession
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Login failed'
        console.error('[OAuth3Provider] login: Login failed:', message)
        setError(message)
        setIsLoading(false)
        throw err
      }
    },
    [client],
  )

  const logout = useCallback(async () => {
    setIsLoading(true)
    await client.logout()
    setSession(null)
    setIsLoading(false)
  }, [client])

  const linkProvider = useCallback(
    async (provider: AuthProvider) => {
      await client.linkProvider({ provider })
    },
    [client],
  )

  const unlinkProvider = useCallback(
    async (provider: AuthProvider) => {
      await client.unlinkProvider(provider)
    },
    [client],
  )

  const refreshSession = useCallback(async () => {
    const newSession = await client.refreshSession()
    setSession(newSession)
    return newSession
  }, [client])

  const signMessage = useCallback(
    async (message: string | Uint8Array) => {
      return client.signMessage({ message })
    },
    [client],
  )

  const getCredentials = useCallback(async () => {
    return client.listCredentials()
  }, [client])

  const issueCredential = useCallback(
    async (
      provider: AuthProvider,
      providerId: string,
      providerHandle: string,
    ) => {
      return client.issueCredential(provider, providerId, providerHandle)
    },
    [client],
  )

  const value = useMemo<OAuth3ContextValue>(
    () => ({
      client,
      session,
      isLoading,
      isAuthenticated: session !== null && session.expiresAt > Date.now(),
      error,
      login,
      logout,
      linkProvider,
      unlinkProvider,
      refreshSession,
      signMessage,
      getCredentials,
      issueCredential,
      smartAccountAddress: session?.smartAccount ?? null,
      identityId: session?.identityId ?? null,
    }),
    [
      client,
      session,
      isLoading,
      error,
      login,
      logout,
      linkProvider,
      unlinkProvider,
      refreshSession,
      signMessage,
      getCredentials,
      issueCredential,
    ],
  )

  return (
    <OAuth3Context.Provider value={value}>{children}</OAuth3Context.Provider>
  )
}

export function useOAuth3(): OAuth3ContextValue {
  const context = useContext(OAuth3Context)
  if (!context) {
    throw new Error('useOAuth3 must be used within an OAuth3Provider')
  }
  return context
}

export function useOAuth3Client(): OAuth3Client {
  const { client } = useOAuth3()
  return client
}
