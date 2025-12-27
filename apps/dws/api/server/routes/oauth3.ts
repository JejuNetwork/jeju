/**
 * OAuth3 Proxy Route
 *
 * Proxies requests to the OAuth3 TEE agent for authentication.
 * This allows DWS to serve as a unified API gateway.
 */

import { createAppConfig } from '@jejunetwork/config'
import { Elysia, t } from 'elysia'

interface OAuth3RouterConfig {
  agentUrl?: string
  [key: string]: string | undefined
}

const { config: oauth3Config, configure: configureOAuth3Router } =
  createAppConfig<OAuth3RouterConfig>({
    agentUrl: 'http://localhost:4200',
  })

export function configureOAuth3RouterConfig(
  config: Partial<OAuth3RouterConfig>,
): void {
  configureOAuth3Router(config)
}

const OAUTH3_AGENT_URL = oauth3Config.agentUrl ?? 'http://localhost:4200'

export function createOAuth3Router() {
  return (
    new Elysia({ name: 'oauth3', prefix: '/oauth3' })
      // Health check
      .get('/health', async ({ set }) => {
        const response = await fetch(`${OAUTH3_AGENT_URL}/health`).catch(
          (err: Error) => {
            console.warn(`[OAuth3] Health check failed: ${err.message}`)
            return null
          },
        )
        if (!response?.ok) {
          set.status = 503
          return { status: 'unhealthy', agent: OAUTH3_AGENT_URL }
        }
        const data = await response.json()
        return { status: 'healthy', agent: OAUTH3_AGENT_URL, ...data }
      })

      // Get TEE attestation
      .get('/attestation', async ({ set }) => {
        const response = await fetch(`${OAUTH3_AGENT_URL}/attestation`)
        if (!response.ok) {
          set.status = response.status as
            | 400
            | 401
            | 403
            | 404
            | 500
            | 502
            | 503
          return { error: 'Failed to get attestation' }
        }
        return response.json()
      })

      // Initialize OAuth flow
      .post(
        '/auth/init',
        async ({ body, set }) => {
          const response = await fetch(`${OAUTH3_AGENT_URL}/auth/init`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          const data = await response.json()
          if (!response.ok) {
            set.status = response.status as
              | 400
              | 401
              | 403
              | 404
              | 500
              | 502
              | 503
          }
          return data
        },
        {
          body: t.Record(t.String(), t.Unknown()),
        },
      )

      // OAuth callback
      .post(
        '/auth/callback',
        async ({ body, set }) => {
          const response = await fetch(`${OAUTH3_AGENT_URL}/auth/callback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          const data = await response.json()
          if (!response.ok) {
            set.status = response.status as
              | 400
              | 401
              | 403
              | 404
              | 500
              | 502
              | 503
          }
          return data
        },
        {
          body: t.Record(t.String(), t.Unknown()),
        },
      )

      // Wallet auth
      .post(
        '/auth/wallet',
        async ({ body, set }) => {
          const response = await fetch(`${OAUTH3_AGENT_URL}/auth/wallet`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          const data = await response.json()
          if (!response.ok) {
            set.status = response.status as
              | 400
              | 401
              | 403
              | 404
              | 500
              | 502
              | 503
          }
          return data
        },
        {
          body: t.Record(t.String(), t.Unknown()),
        },
      )

      // Farcaster auth
      .post(
        '/auth/farcaster',
        async ({ body, set }) => {
          const response = await fetch(`${OAUTH3_AGENT_URL}/auth/farcaster`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          const data = await response.json()
          if (!response.ok) {
            set.status = response.status as
              | 400
              | 401
              | 403
              | 404
              | 500
              | 502
              | 503
          }
          return data
        },
        {
          body: t.Record(t.String(), t.Unknown()),
        },
      )

      // Get session
      .get(
        '/session/:sessionId',
        async ({ params, set }) => {
          const response = await fetch(
            `${OAUTH3_AGENT_URL}/session/${params.sessionId}`,
          )
          const data = await response.json()
          if (!response.ok) {
            set.status = response.status as
              | 400
              | 401
              | 403
              | 404
              | 500
              | 502
              | 503
          }
          return data
        },
        {
          params: t.Object({
            sessionId: t.String({ format: 'uuid' }),
          }),
        },
      )

      // Refresh session
      .post(
        '/session/:sessionId/refresh',
        async ({ params, set }) => {
          const response = await fetch(
            `${OAUTH3_AGENT_URL}/session/${params.sessionId}/refresh`,
            {
              method: 'POST',
            },
          )
          const data = await response.json()
          if (!response.ok) {
            set.status = response.status as
              | 400
              | 401
              | 403
              | 404
              | 500
              | 502
              | 503
          }
          return data
        },
        {
          params: t.Object({
            sessionId: t.String({ format: 'uuid' }),
          }),
        },
      )

      // Delete session (logout)
      .delete(
        '/session/:sessionId',
        async ({ params, set }) => {
          const response = await fetch(
            `${OAUTH3_AGENT_URL}/session/${params.sessionId}`,
            {
              method: 'DELETE',
            },
          )
          const data = await response.json()
          if (!response.ok) {
            set.status = response.status as
              | 400
              | 401
              | 403
              | 404
              | 500
              | 502
              | 503
          }
          return data
        },
        {
          params: t.Object({
            sessionId: t.String({ format: 'uuid' }),
          }),
        },
      )

      // Sign message
      .post(
        '/sign',
        async ({ body, set }) => {
          const response = await fetch(`${OAUTH3_AGENT_URL}/sign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          const data = await response.json()
          if (!response.ok) {
            set.status = response.status as
              | 400
              | 401
              | 403
              | 404
              | 500
              | 502
              | 503
          }
          return data
        },
        {
          body: t.Record(t.String(), t.Unknown()),
        },
      )

      // Issue credential
      .post(
        '/credential/issue',
        async ({ body, set }) => {
          const response = await fetch(`${OAUTH3_AGENT_URL}/credential/issue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          const data = await response.json()
          if (!response.ok) {
            set.status = response.status as
              | 400
              | 401
              | 403
              | 404
              | 500
              | 502
              | 503
          }
          return data
        },
        {
          body: t.Record(t.String(), t.Unknown()),
        },
      )

      // Verify credential
      .post(
        '/credential/verify',
        async ({ body, set }) => {
          const response = await fetch(
            `${OAUTH3_AGENT_URL}/credential/verify`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            },
          )
          const data = await response.json()
          if (!response.ok) {
            set.status = response.status as
              | 400
              | 401
              | 403
              | 404
              | 500
              | 502
              | 503
          }
          return data
        },
        {
          body: t.Record(t.String(), t.Unknown()),
        },
      )

      // Infrastructure health
      .get('/infrastructure/health', async () => {
        const response = await fetch(
          `${OAUTH3_AGENT_URL}/infrastructure/health`,
        )
        if (!response.ok) {
          throw new Error('OAuth3 agent unavailable')
        }
        return response.json()
      })
  )
}

export type OAuth3Routes = ReturnType<typeof createOAuth3Router>
