/**
 * Auth initialization routes for programmatic auth flow initiation
 * This allows clients to initialize auth flows via API calls
 */

import {
  getCurrentNetwork,
  getLocalhostHost,
  getOAuth3Url,
  isProductionEnv,
} from '@jejunetwork/config'
import { Elysia, t } from 'elysia'
import type { AuthConfig } from '../../lib/types'
import { clientState } from '../services/state'

const InitBodySchema = t.Object({
  provider: t.String(),
  redirectUri: t.String(),
  appId: t.Optional(t.String()),
  state: t.Optional(t.String()),
})

/**
 * Validate redirect URI against client's registered patterns
 */
function validateRedirectUri(
  redirectUri: string,
  allowedPatterns: string[],
): boolean {
  for (const pattern of allowedPatterns) {
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
    const regex = new RegExp(`^${regexPattern}$`)
    if (regex.test(redirectUri)) {
      return true
    }
  }
  return false
}

export function createAuthInitRouter(_config: AuthConfig) {
  const network = getCurrentNetwork()
  const host = getLocalhostHost()
  const baseUrl = process.env.BASE_URL ?? 
    (network === 'localnet' ? `http://${host}:4200` : getOAuth3Url(network))

  return new Elysia({ name: 'auth-init', prefix: '/auth' })
    .post(
      '/init',
      async ({ body, set }) => {
        const { provider, redirectUri, appId = 'jeju-default', state } = body

        // Find or use default client
        let client = await clientState.get(appId)
        if (!client) {
          // Try default client
          client = await clientState.get('jeju-default')
        }

        // For development, create a permissive client if none exists
        if (!client) {
          // Auto-register the client for dev (in production this should fail)
          const isDev = !isProductionEnv()
          if (isDev) {
            console.log(
              `[OAuth3] Auto-registering development client: ${appId}`,
            )
            await clientState.save({
              id: appId,
              name: appId,
              redirectUris: [
                `http://localhost:*`,
                `http://${getLocalhostHost()}:*`,
                'https://*.jejunetwork.org/*',
              ],
              allowedScopes: ['openid', 'profile', 'email'],
              active: true,
              requireSecret: false,
              createdAt: Date.now(),
            })
            client = await clientState.get(appId)
          }
        }

        if (!client || !client.active) {
          set.status = 400
          return {
            error: 'invalid_client',
            message: 'Unknown or inactive client',
          }
        }

        // Validate redirect URI (relaxed for development)
        const isDev = !isProductionEnv()
        if (!isDev && !validateRedirectUri(redirectUri, client.redirectUris)) {
          set.status = 400
          return {
            error: 'invalid_redirect_uri',
            message: 'Redirect URI not allowed',
          }
        }

        const authState = state ?? crypto.randomUUID()
        const encodedRedirectUri = encodeURIComponent(redirectUri)

        // Build the appropriate auth URL based on provider
        let authUrl: string

        switch (provider.toLowerCase()) {
          case 'wallet':
            authUrl = `${baseUrl}/wallet/challenge?client_id=${appId}&redirect_uri=${encodedRedirectUri}&state=${authState}`
            break

          case 'farcaster':
            authUrl = `${baseUrl}/farcaster/init?client_id=${appId}&redirect_uri=${encodedRedirectUri}&state=${authState}`
            break

          case 'github':
          case 'google':
          case 'twitter':
          case 'discord':
            authUrl = `${baseUrl}/oauth/social/${provider.toLowerCase()}?client_id=${appId}&redirect_uri=${encodedRedirectUri}&state=${authState}`
            break

          case 'email':
            // Email provider - for now redirect to authorize page
            authUrl = `${baseUrl}/oauth/authorize?client_id=${appId}&redirect_uri=${encodedRedirectUri}&state=${authState}&provider=email`
            break

          default:
            set.status = 400
            return {
              error: 'unsupported_provider',
              message: `Provider "${provider}" is not supported. Use: wallet, farcaster, github, google, twitter, discord`,
            }
        }

        return {
          authUrl,
          state: authState,
          provider: provider.toLowerCase(),
        }
      },
      { body: InitBodySchema },
    )

    .get('/providers', () => {
      // Return available providers and their status
      return {
        providers: [
          { id: 'wallet', name: 'Wallet', enabled: true, icon: '🔐' },
          { id: 'farcaster', name: 'Farcaster', enabled: true, icon: '🟣' },
          {
            id: 'github',
            name: 'GitHub',
            enabled: Boolean(process.env.GITHUB_CLIENT_ID),
            icon: '🐙',
          },
          {
            id: 'google',
            name: 'Google',
            enabled: Boolean(process.env.GOOGLE_CLIENT_ID),
            icon: '🔵',
          },
          {
            id: 'twitter',
            name: 'Twitter',
            enabled: Boolean(process.env.TWITTER_CLIENT_ID),
            icon: '🐦',
          },
          {
            id: 'discord',
            name: 'Discord',
            enabled: Boolean(process.env.DISCORD_CLIENT_ID),
            icon: '💬',
          },
        ],
      }
    })
}
