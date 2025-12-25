/**
 * OAuth3 Client SDK
 *
 * TypeScript SDK for integrating OAuth3 authentication into web applications.
 * Supports all authentication providers and credential management.
 *
 * Now with full decentralized infrastructure:
 * - JNS for app discovery
 * - Decentralized TEE node selection
 * - IPFS storage for credentials
 */

import { type Address, type Hex, toHex } from 'viem'
import { z } from 'zod'

// OAuth callback data schema
const OAuthCallbackSchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
})

import { CHAIN_IDS, DEFAULT_RPC } from '../infrastructure/config.js'
import {
  createDecentralizedDiscovery,
  type DiscoveredApp,
  type DiscoveredNode,
  type OAuth3DecentralizedDiscovery,
} from '../infrastructure/discovery.js'
import {
  createOAuth3JNSService,
  type OAuth3JNSService,
} from '../infrastructure/jns-integration.js'
import {
  createOAuth3StorageService,
  type OAuth3StorageService,
} from '../infrastructure/storage-integration.js'
import { FarcasterProvider } from '../providers/farcaster.js'
import {
  AuthProvider,
  type JsonRecord,
  type LinkedProvider,
  type OAuth3Identity,
  type OAuth3Session,
  type TEEAttestation,
  type VerifiableCredential,
} from '../types.js'
import {
  CredentialVerifyResponseSchema,
  OAuth3SessionSchema,
  OAuthInitResponseSchema,
  SignResponseSchema,
  TEEAttestationSchema,
  VerifiableCredentialSchema,
  validateResponse,
} from '../validation.js'

export interface OAuth3Config {
  /** App ID (hex) or JNS name (e.g., 'myapp.oauth3.jeju') */
  appId: Hex | string
  redirectUri: string
  /** TEE agent URL - if not provided, will use decentralized discovery */
  teeAgentUrl?: string
  rpcUrl?: string
  chainId?: number
  identityRegistryAddress?: Address
  appRegistryAddress?: Address
  accountFactoryAddress?: Address
  /** JNS gateway endpoint */
  jnsGateway?: string
  /** Storage API endpoint */
  storageEndpoint?: string
  /** Enable fully decentralized mode */
  decentralized?: boolean
}

export interface LoginOptions {
  provider: AuthProvider
  scope?: string[]
  nonce?: string
  state?: JsonRecord
}

export interface LinkOptions {
  provider: AuthProvider
  scope?: string[]
}

export interface SignMessageOptions {
  message: string | Uint8Array
  useSessionKey?: boolean
}

export interface TransactionOptions {
  to: Address
  value?: bigint
  data?: Hex
  gasLimit?: bigint
}

export type OAuth3EventType =
  | 'login'
  | 'logout'
  | 'sessionRefresh'
  | 'providerLinked'
  | 'providerUnlinked'
  | 'error'

// Event data types for each event type
export interface LoginEventData {
  provider: AuthProvider | string
  status?: 'started'
  session?: OAuth3Session
}

export type LogoutEventData = Record<string, never>

export interface SessionRefreshEventData {
  session: OAuth3Session
}

export interface ProviderLinkedEventData {
  provider: AuthProvider
}

export interface ProviderUnlinkedEventData {
  provider: AuthProvider
}

export interface ErrorEventData {
  type: string
  previousNode?: string
  newNode?: string
  message?: string
}

// Map event types to their data types
export interface OAuth3EventDataMap {
  login: LoginEventData
  logout: LogoutEventData
  sessionRefresh: SessionRefreshEventData
  providerLinked: ProviderLinkedEventData
  providerUnlinked: ProviderUnlinkedEventData
  error: ErrorEventData
}

export interface OAuth3Event<T extends OAuth3EventType = OAuth3EventType> {
  type: T
  data: OAuth3EventDataMap[T]
  timestamp: number
}

export type OAuth3EventHandler<T extends OAuth3EventType = OAuth3EventType> = (
  event: OAuth3Event<T>,
) => void

export class OAuth3Client {
  private config: OAuth3Config
  private session: OAuth3Session | null = null
  private identity: OAuth3Identity | null = null
  private farcasterProvider: FarcasterProvider
  private eventHandlers: Map<
    OAuth3EventType,
    Set<OAuth3EventHandler<OAuth3EventType>>
  > = new Map()

  // Decentralized infrastructure
  private discovery: OAuth3DecentralizedDiscovery | null = null
  private storage: OAuth3StorageService | null = null
  private jns: OAuth3JNSService | null = null
  private discoveredApp: DiscoveredApp | null = null
  private currentNode: DiscoveredNode | null = null

  /**
   * Timing-safe comparison of two strings
   * SECURITY: Prevents timing attacks by always comparing all characters
   */
  private timingSafeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false

    let result = 0
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i)
    }
    return result === 0
  }

  constructor(config: OAuth3Config) {
    // Validate required fields
    if (!config.appId) {
      throw new Error('OAuth3Config.appId is required')
    }
    if (!config.redirectUri) {
      throw new Error('OAuth3Config.redirectUri is required')
    }

    this.config = config

    // Use explicit defaults from config module
    const rpcUrl = config.rpcUrl ?? DEFAULT_RPC
    const chainId = config.chainId ?? CHAIN_IDS.localnet

    this.farcasterProvider = new FarcasterProvider()

    // Initialize decentralized services if enabled
    if (config.decentralized !== false) {
      this.discovery = createDecentralizedDiscovery({
        rpcUrl,
        chainId,
        ipfsApiEndpoint: config.storageEndpoint,
      })
      this.storage = createOAuth3StorageService({
        ipfsApiEndpoint: config.storageEndpoint,
      })
      this.jns = createOAuth3JNSService({
        rpcUrl,
        chainId,
      })
    }

    this.loadSession()
  }

  /**
   * Initialize the client with decentralized discovery
   * Call this before login to discover the app and TEE nodes
   */
  async initialize(): Promise<{ app: DiscoveredApp; nodes: DiscoveredNode[] }> {
    if (!this.discovery) {
      throw new Error('Decentralized mode not enabled')
    }

    // Discover the app
    const appId = this.config.appId as string
    this.discoveredApp = await this.discovery.discoverApp(appId)

    if (!this.discoveredApp) {
      throw new Error(`App not found: ${appId}`)
    }

    // Get available TEE nodes
    const nodes = await this.discovery.discoverNodes()

    // Select the best node
    this.currentNode = await this.discovery.getBestNode()

    return {
      app: this.discoveredApp,
      nodes,
    }
  }

  /**
   * Get the current TEE agent URL (from config or discovered node)
   */
  private getTeeAgentUrl(): string {
    if (this.config.teeAgentUrl) {
      return this.config.teeAgentUrl
    }
    if (this.currentNode) {
      return this.currentNode.endpoint
    }
    throw new Error(
      'No TEE agent URL configured. Call initialize() first or provide teeAgentUrl in config.',
    )
  }

  /**
   * Failover to next available TEE node
   */
  private async failoverToNextNode(): Promise<void> {
    if (!this.discovery) return

    const nodes = await this.discovery.discoverNodes()
    const currentEndpoint = this.currentNode?.endpoint

    // Find a healthy node that isn't the current one
    const nextNode = nodes.find(
      (n) => n.healthy && n.endpoint !== currentEndpoint,
    )

    if (nextNode) {
      this.currentNode = nextNode
      this.emit('error', {
        type: 'failover',
        previousNode: currentEndpoint,
        newNode: nextNode.endpoint,
      })
    } else {
      throw new Error('No healthy TEE nodes available')
    }
  }

  async login(options: LoginOptions): Promise<OAuth3Session> {
    this.emit('login', { provider: options.provider, status: 'started' })

    // If decentralized mode and not initialized, do auto-initialization
    if (this.discovery && !this.currentNode) {
      await this.initialize()
    }

    let session: OAuth3Session

    switch (options.provider) {
      case AuthProvider.WALLET:
        session = await this.loginWithWallet()
        break
      case AuthProvider.FARCASTER:
        session = await this.loginWithFarcaster()
        break
      default:
        session = await this.loginWithOAuth(options)
    }

    // Store session in decentralized storage
    if (this.storage) {
      await this.storage.storeSession(session)
    }

    return session
  }

  private async loginWithWallet(): Promise<OAuth3Session> {
    if (typeof window === 'undefined' || !window.ethereum) {
      throw new Error('No Ethereum provider found')
    }

    const accounts = (await window.ethereum.request({
      method: 'eth_requestAccounts',
    })) as string[]

    const address = accounts[0] as Address
    const nonce = crypto.randomUUID()

    const message = this.createSignInMessage(address, nonce)

    const signature = (await window.ethereum.request({
      method: 'personal_sign',
      params: [message, address],
    })) as Hex

    const teeAgentUrl = this.getTeeAgentUrl()
    const appId = this.discoveredApp?.appId ?? this.config.appId

    const response = await fetch(`${teeAgentUrl}/auth/wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address,
        signature,
        message,
        appId,
      }),
    })

    if (!response.ok) {
      throw new Error(`Wallet login failed: ${response.status}`)
    }

    const session = validateResponse(
      OAuth3SessionSchema,
      await response.json(),
      'wallet login session',
    )
    this.setSession(session)
    this.emit('login', { provider: 'wallet', session })

    return session
  }

  private async loginWithFarcaster(): Promise<OAuth3Session> {
    const nonce = crypto.randomUUID()
    const domain = new URL(this.config.redirectUri).hostname

    const message = this.farcasterProvider.generateSignInMessage({
      domain,
      address: '0x0000000000000000000000000000000000000000' as Address,
      fid: 0,
      custody: '0x0000000000000000000000000000000000000000' as Address,
      nonce,
    })

    const signatureRequest = {
      type: 'farcaster_sign_in',
      message,
      nonce,
      domain,
    }

    const result = await this.requestFarcasterSignature(signatureRequest)

    const teeAgentUrl = this.getTeeAgentUrl()
    const appId = this.discoveredApp?.appId ?? this.config.appId

    const response = await fetch(`${teeAgentUrl}/auth/farcaster`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fid: result.fid,
        custodyAddress: result.custodyAddress,
        signature: result.signature,
        message: result.message,
        appId,
      }),
    })

    if (!response.ok) {
      throw new Error(`Farcaster login failed: ${response.status}`)
    }

    const session = validateResponse(
      OAuth3SessionSchema,
      await response.json(),
      'farcaster login session',
    )
    this.setSession(session)
    this.emit('login', { provider: 'farcaster', session })

    return session
  }

  private async loginWithOAuth(options: LoginOptions): Promise<OAuth3Session> {
    const teeAgentUrl = this.getTeeAgentUrl()
    const appId = this.discoveredApp?.appId ?? this.config.appId

    const initResponse = await fetch(`${teeAgentUrl}/auth/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: options.provider,
        appId,
        redirectUri: this.config.redirectUri,
      }),
    })

    if (!initResponse.ok) {
      throw new Error(`Failed to initialize OAuth: ${initResponse.status}`)
    }

    const { authUrl, state, sessionId } = validateResponse(
      OAuthInitResponseSchema,
      await initResponse.json(),
      'OAuth init response',
    )

    sessionStorage.setItem('oauth3_state', state)
    sessionStorage.setItem('oauth3_session_id', sessionId)

    const popup = this.openPopup(authUrl)

    return new Promise((resolve, reject) => {
      const handleMessage = async (event: MessageEvent) => {
        if (event.origin !== new URL(this.config.redirectUri).origin) return

        const callbackResult = OAuthCallbackSchema.safeParse(event.data)
        if (!callbackResult.success) return
        const { code, state: returnedState, error } = callbackResult.data

        if (error) {
          window.removeEventListener('message', handleMessage)
          popup?.close()
          reject(new Error(error))
          return
        }

        // SECURITY: Use timing-safe comparison for state parameter to prevent CSRF timing attacks
        if (
          !code ||
          !returnedState ||
          !this.timingSafeCompare(returnedState, state)
        ) {
          return
        }

        window.removeEventListener('message', handleMessage)
        popup?.close()

        const callbackResponse = await fetch(`${teeAgentUrl}/auth/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state, code }),
        })

        if (!callbackResponse.ok) {
          reject(new Error(`OAuth callback failed: ${callbackResponse.status}`))
          return
        }

        const session = validateResponse(
          OAuth3SessionSchema,
          await callbackResponse.json(),
          'OAuth callback session',
        )
        this.setSession(session)
        this.emit('login', { provider: options.provider, session })
        resolve(session)
      }

      window.addEventListener('message', handleMessage)

      const checkClosed = setInterval(() => {
        if (popup?.closed) {
          clearInterval(checkClosed)
          window.removeEventListener('message', handleMessage)
          reject(new Error('Login cancelled'))
        }
      }, 1000)
    })
  }

  async logout(): Promise<void> {
    if (!this.session) return

    const teeAgentUrl = this.getTeeAgentUrl()

    await fetch(`${teeAgentUrl}/session/${this.session.sessionId}`, {
      method: 'DELETE',
    })

    // Remove from decentralized storage
    if (this.storage) {
      await this.storage.deleteSession(this.session.sessionId)
    }

    this.clearSession()
    this.emit('logout', {})
  }

  async linkProvider(options: LinkOptions): Promise<LinkedProvider> {
    if (!this.session) {
      throw new Error('Not logged in')
    }

    const linkSession = await this.login(options as LoginOptions)

    const linkedProvider: LinkedProvider = {
      provider: options.provider,
      providerId: linkSession.identityId,
      providerHandle: '',
      linkedAt: Date.now(),
      verified: true,
    }

    this.emit('providerLinked', { provider: options.provider })
    return linkedProvider
  }

  async unlinkProvider(provider: AuthProvider): Promise<void> {
    if (!this.session) {
      throw new Error('Not logged in')
    }

    this.emit('providerUnlinked', { provider })
  }

  async signMessage(options: SignMessageOptions): Promise<Hex> {
    if (!this.session) {
      throw new Error('Not logged in')
    }

    const messageHex =
      typeof options.message === 'string'
        ? toHex(new TextEncoder().encode(options.message))
        : toHex(options.message)

    const teeAgentUrl = this.getTeeAgentUrl()

    const response = await fetch(`${teeAgentUrl}/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this.session.sessionId,
        message: messageHex,
      }),
    })

    if (!response.ok) {
      // Try failover
      if (this.discovery) {
        await this.failoverToNextNode()
        return this.signMessage(options)
      }
      throw new Error(`Signing failed: ${response.status}`)
    }

    const { signature } = validateResponse(
      SignResponseSchema,
      await response.json(),
      'sign response',
    )
    return signature
  }

  async issueCredential(
    provider: AuthProvider,
    providerId: string,
    providerHandle: string,
  ): Promise<VerifiableCredential> {
    if (!this.session) {
      throw new Error('Not logged in')
    }

    const teeAgentUrl = this.getTeeAgentUrl()

    const response = await fetch(`${teeAgentUrl}/credential/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this.session.sessionId,
        provider,
        providerId,
        providerHandle,
        walletAddress: this.session.smartAccount,
      }),
    })

    if (!response.ok) {
      throw new Error(`Credential issuance failed: ${response.status}`)
    }

    const credential = validateResponse(
      VerifiableCredentialSchema,
      await response.json(),
      'credential issuance response',
    )

    // Store credential in decentralized storage
    if (this.storage) {
      await this.storage.storeCredential(credential)
    }

    return credential
  }

  async verifyCredential(credential: VerifiableCredential): Promise<boolean> {
    const teeAgentUrl = this.getTeeAgentUrl()

    const response = await fetch(`${teeAgentUrl}/credential/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
    })

    if (!response.ok) {
      return false
    }

    const { valid } = validateResponse(
      CredentialVerifyResponseSchema,
      await response.json(),
      'credential verify response',
    )
    return valid
  }

  /**
   * Retrieve a credential from decentralized storage
   */
  async retrieveCredential(
    credentialId: string,
  ): Promise<VerifiableCredential | null> {
    if (!this.storage) {
      throw new Error('Decentralized storage not enabled')
    }
    return this.storage.retrieveCredential(credentialId)
  }

  /**
   * List all credentials for the current identity
   */
  async listCredentials(): Promise<VerifiableCredential[]> {
    if (!this.session || !this.storage) {
      return []
    }

    const chainId = this.config.chainId ?? CHAIN_IDS.localnet
    const subjectDid = `did:ethr:${chainId}:${this.session.smartAccount}`
    const storedCredentials =
      await this.storage.listCredentialsForSubject(subjectDid)

    const credentials: VerifiableCredential[] = []
    for (const stored of storedCredentials) {
      const credential = await this.storage.retrieveCredential(
        stored.credentialId,
      )
      if (credential) {
        credentials.push(credential)
      }
    }

    return credentials
  }

  async getAttestation(): Promise<TEEAttestation> {
    const teeAgentUrl = this.getTeeAgentUrl()

    const response = await fetch(`${teeAgentUrl}/attestation`)

    if (!response.ok) {
      throw new Error(`Failed to get attestation: ${response.status}`)
    }

    return validateResponse(
      TEEAttestationSchema,
      await response.json(),
      'TEE attestation',
    )
  }

  async refreshSession(): Promise<OAuth3Session> {
    if (!this.session) {
      throw new Error('No session to refresh')
    }

    const teeAgentUrl = this.getTeeAgentUrl()

    const response = await fetch(
      `${teeAgentUrl}/session/${this.session.sessionId}/refresh`,
      { method: 'POST' },
    )

    if (!response.ok) {
      throw new Error(`Session refresh failed: ${response.status}`)
    }

    const newSession = validateResponse(
      OAuth3SessionSchema,
      await response.json(),
      'session refresh response',
    )
    this.setSession(newSession)

    // Update in decentralized storage
    if (this.storage) {
      await this.storage.storeSession(newSession)
    }

    this.emit('sessionRefresh', { session: newSession })

    return newSession
  }

  /**
   * Get the discovered app details
   */
  getDiscoveredApp(): DiscoveredApp | null {
    return this.discoveredApp
  }

  /**
   * Get the current TEE node
   */
  getCurrentNode(): DiscoveredNode | null {
    return this.currentNode
  }

  /**
   * Get the JNS service for name resolution
   */
  getJNS(): OAuth3JNSService | null {
    return this.jns
  }

  /**
   * Get the storage service for credential management
   */
  getStorage(): OAuth3StorageService | null {
    return this.storage
  }

  /**
   * Get the discovery service
   */
  getDiscovery(): OAuth3DecentralizedDiscovery | null {
    return this.discovery
  }

  /**
   * Check infrastructure health
   */
  async checkInfrastructureHealth(): Promise<{
    jns: boolean
    storage: boolean
    teeNode: boolean
  }> {
    return {
      jns: this.jns
        ? (await this.jns.isAvailable('health.jeju').catch(() => false)) !==
          false
        : false,
      storage: this.storage ? await this.storage.isHealthy() : false,
      teeNode: this.currentNode ? this.currentNode.healthy : false,
    }
  }

  getSession(): OAuth3Session | null {
    return this.session
  }

  getIdentity(): OAuth3Identity | null {
    return this.identity
  }

  isLoggedIn(): boolean {
    return this.session !== null && this.session.expiresAt > Date.now()
  }

  on<T extends OAuth3EventType>(
    event: T,
    handler: OAuth3EventHandler<T>,
  ): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
    }
    // Cast is safe because we're adding to the correct event type's set
    ;(this.eventHandlers.get(event) as Set<OAuth3EventHandler<T>>).add(handler)

    return () => {
      this.eventHandlers
        .get(event)
        ?.delete(handler as OAuth3EventHandler<OAuth3EventType>)
    }
  }

  private emit<T extends OAuth3EventType>(
    type: T,
    data: OAuth3EventDataMap[T],
  ): void {
    const event: OAuth3Event<T> = { type, data, timestamp: Date.now() }
    this.eventHandlers.get(type)?.forEach((handler) => {
      handler(event as OAuth3Event<OAuth3EventType>)
    })
  }

  private setSession(session: OAuth3Session): void {
    this.session = session

    // SECURITY: Only store non-sensitive session data in localStorage
    // The session from the server should already be a public session without signing keys
    if (
      typeof window !== 'undefined' &&
      typeof localStorage !== 'undefined' &&
      typeof localStorage.setItem === 'function'
    ) {
      // Store only the session metadata needed to identify the session
      const publicSessionData = {
        sessionId: session.sessionId,
        identityId: session.identityId,
        smartAccount: session.smartAccount,
        expiresAt: session.expiresAt,
        capabilities: session.capabilities,
        signingPublicKey: session.signingPublicKey,
      }
      localStorage.setItem('oauth3_session', JSON.stringify(publicSessionData))
    }
  }

  private clearSession(): void {
    this.session = null
    this.identity = null

    if (
      typeof window !== 'undefined' &&
      typeof localStorage !== 'undefined' &&
      typeof localStorage.removeItem === 'function'
    ) {
      localStorage.removeItem('oauth3_session')
    }
  }

  private loadSession(): void {
    if (
      typeof window === 'undefined' ||
      typeof localStorage === 'undefined' ||
      typeof localStorage.getItem !== 'function'
    )
      return

    const stored = localStorage.getItem('oauth3_session')
    if (!stored) return

    // SECURITY: Validate session data with Zod schema to prevent prototype pollution
    // and insecure deserialization attacks
    let parsed: unknown
    try {
      parsed = JSON.parse(stored)
    } catch {
      // Invalid JSON - clear corrupted data
      localStorage.removeItem('oauth3_session')
      return
    }

    const result = OAuth3SessionSchema.safeParse(parsed)
    if (!result.success) {
      // Invalid session structure - clear corrupted data
      localStorage.removeItem('oauth3_session')
      return
    }

    const session = result.data as OAuth3Session

    if (session.expiresAt > Date.now()) {
      this.session = session
    } else {
      localStorage.removeItem('oauth3_session')
    }
  }

  private createSignInMessage(address: Address, nonce: string): string {
    const domain = new URL(this.config.redirectUri).hostname
    return `${domain} wants you to sign in with your Ethereum account:
${address}

Sign in to OAuth3

URI: ${this.config.redirectUri}
Version: 1
Chain ID: ${this.config.chainId}
Nonce: ${nonce}
Issued At: ${new Date().toISOString()}`
  }

  private openPopup(url: string): Window | null {
    const width = 500
    const height = 700
    const left = window.screenX + (window.outerWidth - width) / 2
    const top = window.screenY + (window.outerHeight - height) / 2

    return window.open(
      url,
      'oauth3_popup',
      `width=${width},height=${height},left=${left},top=${top},popup=1`,
    )
  }

  private async requestFarcasterSignature(_request: {
    type: string
    message: string
    nonce: string
    domain: string
  }): Promise<{
    fid: number
    custodyAddress: Address
    signature: Hex
    message: string
  }> {
    throw new Error(
      'Farcaster signature request must be handled by frame or wallet',
    )
  }
}

export function createOAuth3Client(config: OAuth3Config): OAuth3Client {
  return new OAuth3Client(config)
}

// EIP-1193 Provider Types
export interface EIP1193RequestArguments {
  method: string
  params?: readonly unknown[] | object
}

export interface EIP1193ProviderRpcError extends Error {
  code: number
  data?: unknown
}

export interface EIP1193ConnectInfo {
  chainId: string
}

export interface EIP1193ProviderMessage {
  type: string
  data: unknown
}

export type EIP1193EventCallback = {
  accountsChanged: (accounts: string[]) => void
  chainChanged: (chainId: string) => void
  connect: (connectInfo: EIP1193ConnectInfo) => void
  disconnect: (error: EIP1193ProviderRpcError) => void
  message: (message: EIP1193ProviderMessage) => void
}

export interface EIP1193Provider {
  request<T = unknown>(args: EIP1193RequestArguments): Promise<T>
  on<K extends keyof EIP1193EventCallback>(
    event: K,
    callback: EIP1193EventCallback[K],
  ): void
  removeListener<K extends keyof EIP1193EventCallback>(
    event: K,
    callback: EIP1193EventCallback[K],
  ): void
}

declare global {
  interface Window {
    ethereum?: EIP1193Provider
  }
}
