import type {
  AuthProvider,
  SealedOAuthProvider,
  SealedSecret,
} from '../../lib/types'
import { sealSecret, unsealSecret } from './kms'

// Cache for decrypted secrets (very short-lived)
interface DecryptedCache {
  secret: string
  decryptedAt: number
}

const secretCache = new Map<string, DecryptedCache>()
const CACHE_TTL = 30 * 1000 // 30 seconds max

// Sealed providers loaded from environment
let sealedProviders: Map<AuthProvider, SealedOAuthProvider> | null = null

/**
 * Load sealed OAuth provider configs from environment.
 * Secrets should be pre-sealed using the CLI tool.
 */
export async function loadSealedProviders(): Promise<void> {
  sealedProviders = new Map()

  const providers: Array<{
    name: AuthProvider
    envPrefix: string
  }> = [
    { name: 'github' as AuthProvider, envPrefix: 'GITHUB' },
    { name: 'google' as AuthProvider, envPrefix: 'GOOGLE' },
    { name: 'twitter' as AuthProvider, envPrefix: 'TWITTER' },
    { name: 'discord' as AuthProvider, envPrefix: 'DISCORD' },
  ]

  for (const { name, envPrefix } of providers) {
    const clientId = process.env[`${envPrefix}_CLIENT_ID`]
    const sealedSecretJson = process.env[`${envPrefix}_SEALED_SECRET`]

    if (clientId && sealedSecretJson) {
      try {
        const sealedSecret = JSON.parse(sealedSecretJson) as SealedSecret
        sealedProviders.set(name, {
          clientId,
          sealedSecret,
          redirectUri: '', // Set dynamically per request
          scopes: getDefaultScopes(name),
        })
        console.log(`[SealedOAuth] Loaded sealed config for ${name}`)
      } catch (err) {
        console.error(
          `[SealedOAuth] Failed to parse sealed secret for ${name}:`,
          err,
        )
      }
    } else if (clientId && process.env[`${envPrefix}_CLIENT_SECRET`]) {
      // Legacy plaintext secret - warn but allow for migration
      console.warn(
        `[SealedOAuth] WARNING: ${name} is using plaintext secret. ` +
          `Run 'jeju oauth seal-secrets' to migrate to sealed secrets.`,
      )
    }
  }
}

/**
 * Get OAuth config for a provider with decrypted secret.
 * Secret is cached briefly then cleared.
 */
export async function getOAuthConfig(
  provider: AuthProvider,
  baseRedirectUri: string,
): Promise<{
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes: string[]
} | null> {
  // Check for sealed provider
  if (sealedProviders?.has(provider)) {
    const sealed = sealedProviders.get(provider)
    if (!sealed) return null

    // Check cache first
    const cacheKey = `${provider}:secret`
    const cached = secretCache.get(cacheKey)

    if (cached && Date.now() - cached.decryptedAt < CACHE_TTL) {
      return {
        clientId: sealed.clientId,
        clientSecret: cached.secret,
        redirectUri: `${baseRedirectUri}/oauth/callback/${provider}`,
        scopes: sealed.scopes,
      }
    }

    // Decrypt sealed secret
    try {
      const clientSecret = await unsealSecret(sealed.sealedSecret)

      // Cache briefly
      secretCache.set(cacheKey, {
        secret: clientSecret,
        decryptedAt: Date.now(),
      })

      // Schedule cleanup
      setTimeout(() => {
        secretCache.delete(cacheKey)
      }, CACHE_TTL)

      return {
        clientId: sealed.clientId,
        clientSecret,
        redirectUri: `${baseRedirectUri}/oauth/callback/${provider}`,
        scopes: sealed.scopes,
      }
    } catch (err) {
      console.error(
        `[SealedOAuth] Failed to unseal secret for ${provider}:`,
        err,
      )
      return null
    }
  }

  // Fallback to legacy plaintext (for migration)
  const envPrefix = provider.toUpperCase()
  const clientId = process.env[`${envPrefix}_CLIENT_ID`]
  const clientSecret = process.env[`${envPrefix}_CLIENT_SECRET`]

  if (!clientId || !clientSecret) {
    return null
  }

  console.warn(
    `[SealedOAuth] Using plaintext secret for ${provider}. ` +
      `This is insecure - migrate to sealed secrets.`,
  )

  return {
    clientId,
    clientSecret,
    redirectUri: `${baseRedirectUri}/oauth/callback/${provider}`,
    scopes: getDefaultScopes(provider),
  }
}

/**
 * Check if a provider is configured (sealed or legacy).
 */
export function isProviderConfigured(provider: AuthProvider): boolean {
  if (sealedProviders?.has(provider)) {
    return true
  }

  const envPrefix = provider.toUpperCase()
  return Boolean(
    process.env[`${envPrefix}_CLIENT_ID`] &&
      process.env[`${envPrefix}_CLIENT_SECRET`],
  )
}

/**
 * Seal an OAuth provider secret for secure storage.
 * Use this to migrate from plaintext to sealed secrets.
 */
export async function sealProviderSecret(
  _provider: AuthProvider,
  clientSecret: string,
): Promise<SealedSecret> {
  return sealSecret(clientSecret)
}

/**
 * Get provider metadata (without secrets).
 */
export function getProviderInfo(provider: AuthProvider): {
  configured: boolean
  sealed: boolean
  scopes: string[]
} {
  const sealed = sealedProviders?.has(provider) ?? false
  const configured = isProviderConfigured(provider)

  return {
    configured,
    sealed,
    scopes: getDefaultScopes(provider),
  }
}

function getDefaultScopes(provider: AuthProvider): string[] {
  const scopeMap: Record<string, string[]> = {
    github: ['read:user', 'user:email'],
    google: ['openid', 'email', 'profile'],
    twitter: ['users.read', 'tweet.read'],
    discord: ['identify', 'email'],
  }
  return scopeMap[provider] ?? []
}

/**
 * Clear all cached secrets (call on shutdown).
 */
export function clearSecretCache(): void {
  secretCache.clear()
}

// Cleanup interval
setInterval(() => {
  const now = Date.now()
  for (const [key, cached] of secretCache) {
    if (now - cached.decryptedAt > CACHE_TTL) {
      secretCache.delete(key)
    }
  }
}, CACHE_TTL)
