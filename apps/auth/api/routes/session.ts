/**
 * Session management routes
 */

import { Elysia, t } from 'elysia'
import type { AuthConfig, AuthSession } from '../../lib/types'
import { sessions } from './oauth'

const VerifyQuerySchema = t.Object({
  token: t.Optional(t.String()),
})

export function createSessionRouter(config: AuthConfig) {
  return new Elysia({ name: 'session', prefix: '/session' })
    .get('/', async ({ headers, set, cookie }) => {
      // Check for session cookie or Authorization header
      const sessionCookie = cookie?.jeju_session?.value
      const authToken = extractBearerToken(headers.authorization)
      const sessionId =
        typeof sessionCookie === 'string'
          ? sessionCookie
          : (authToken ?? undefined)

      if (!sessionId) {
        set.status = 401
        return { error: 'no_session', authenticated: false }
      }

      const session = sessions.get(sessionId)
      if (!session || session.expiresAt < Date.now()) {
        if (session) {
          sessions.delete(sessionId)
        }
        set.status = 401
        return { error: 'session_expired', authenticated: false }
      }

      return {
        authenticated: true,
        session: {
          sessionId: session.sessionId,
          userId: session.userId,
          provider: session.provider,
          address: session.address,
          fid: session.fid,
          email: session.email,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
        },
      }
    })

    .get(
      '/verify',
      async ({ query, set }) => {
        if (!query.token) {
          set.status = 400
          return { valid: false, error: 'missing_token' }
        }

        const session = sessions.get(query.token)
        if (!session || session.expiresAt < Date.now()) {
          return { valid: false, error: 'invalid_or_expired' }
        }

        return {
          valid: true,
          userId: session.userId,
          provider: session.provider,
          address: session.address,
          fid: session.fid,
          expiresAt: session.expiresAt,
        }
      },
      { query: VerifyQuerySchema },
    )

    .delete('/', async ({ headers, set, cookie }) => {
      const sessionCookie = cookie?.jeju_session?.value
      const authToken = extractBearerToken(headers.authorization)
      const sessionId =
        typeof sessionCookie === 'string'
          ? sessionCookie
          : (authToken ?? undefined)

      if (!sessionId) {
        set.status = 400
        return { error: 'no_session' }
      }

      sessions.delete(sessionId)

      // Clear cookie
      if (cookie?.jeju_session) {
        cookie.jeju_session.set({
          value: '',
          maxAge: 0,
          path: '/',
        })
      }

      return { success: true, message: 'Logged out' }
    })

    .post('/refresh', async ({ headers, set, cookie }) => {
      const sessionCookie = cookie?.jeju_session?.value
      const authToken = extractBearerToken(headers.authorization)
      const sessionId =
        typeof sessionCookie === 'string'
          ? sessionCookie
          : (authToken ?? undefined)

      if (!sessionId) {
        set.status = 401
        return { error: 'no_session' }
      }

      const session = sessions.get(sessionId)
      if (!session) {
        set.status = 401
        return { error: 'session_not_found' }
      }

      // Create new session with extended expiry
      const newSessionId = crypto.randomUUID()
      const newSession: AuthSession = {
        ...session,
        sessionId: newSessionId,
        createdAt: Date.now(),
        expiresAt: Date.now() + config.sessionDuration,
      }

      // Delete old, add new
      sessions.delete(sessionId)
      sessions.set(newSessionId, newSession)

      // Update cookie
      if (cookie?.jeju_session) {
        cookie.jeju_session.set({
          value: newSessionId,
          maxAge: config.sessionDuration / 1000,
          path: '/',
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
        })
      }

      return {
        success: true,
        session: {
          sessionId: newSession.sessionId,
          expiresAt: newSession.expiresAt,
        },
      }
    })

    .get('/:sessionId', ({ params, set }) => {
      const session = sessions.get(params.sessionId)
      if (!session) {
        set.status = 404
        return { error: 'session_not_found' }
      }

      if (session.expiresAt < Date.now()) {
        sessions.delete(params.sessionId)
        set.status = 401
        return { error: 'session_expired' }
      }

      return {
        sessionId: session.sessionId,
        userId: session.userId,
        provider: session.provider,
        address: session.address,
        fid: session.fid,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
      }
    })

    .delete('/:sessionId', ({ params, set }) => {
      const session = sessions.get(params.sessionId)
      if (!session) {
        set.status = 404
        return { error: 'session_not_found' }
      }

      sessions.delete(params.sessionId)
      return { success: true }
    })

    .post('/:sessionId/refresh', ({ params, set }) => {
      const session = sessions.get(params.sessionId)
      if (!session) {
        set.status = 404
        return { error: 'session_not_found' }
      }

      // Extend session by 24 hours
      session.expiresAt = Date.now() + config.sessionDuration
      sessions.set(params.sessionId, session)

      return {
        sessionId: session.sessionId,
        expiresAt: session.expiresAt,
      }
    })

    .get('/list', async ({ headers, set }) => {
      // Admin endpoint - list all sessions for a user
      const authHeader = headers.authorization
      if (!authHeader) {
        set.status = 401
        return { error: 'unauthorized' }
      }

      const sessionId = extractBearerToken(authHeader)
      if (!sessionId) {
        set.status = 401
        return { error: 'invalid_auth' }
      }

      const currentSession = sessions.get(sessionId)
      if (!currentSession) {
        set.status = 401
        return { error: 'session_not_found' }
      }

      // Find all sessions for this user
      const userSessions = Array.from(sessions.values())
        .filter((s) => s.userId === currentSession.userId)
        .map((s) => ({
          sessionId: s.sessionId,
          provider: s.provider,
          createdAt: s.createdAt,
          expiresAt: s.expiresAt,
          isCurrent: s.sessionId === sessionId,
        }))

      return {
        userId: currentSession.userId,
        sessions: userSessions,
        count: userSessions.length,
      }
    })
}

function extractBearerToken(
  authHeader: string | null | undefined,
): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null
  return authHeader.slice(7)
}
