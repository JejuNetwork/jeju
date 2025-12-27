/**
 * Session management routes
 *
 * SECURITY: Sessions use ephemeral keys that are:
 * - Short-lived (15 minute rotation)
 * - Invalidated on logout
 * - Unique per session
 */

import { Elysia, t } from 'elysia'
import type { AuthConfig, AuthSession } from '../../lib/types'
import { getEphemeralKey, invalidateEphemeralKey } from '../services/kms'
import { refreshTokenState, sessionState } from '../services/state'

const VerifyQuerySchema = t.Object({
  token: t.Optional(t.String()),
})

interface CookieValue {
  value?: string
}

/** Extract session ID from cookie or authorization header */
function getSessionId(
  cookie: { jeju_session?: CookieValue } | undefined,
  authHeader: string | null | undefined,
): string | undefined {
  const sessionCookie = cookie?.jeju_session?.value
  const authToken = extractBearerToken(authHeader)
  return sessionCookie ?? authToken ?? undefined
}

export function createSessionRouter(config: AuthConfig) {
  return new Elysia({ name: 'session', prefix: '/session' })
    .get('/', async ({ headers, set, cookie }) => {
      const sessionId = getSessionId(cookie, headers.authorization)

      if (!sessionId) {
        set.status = 401
        return { error: 'no_session', authenticated: false }
      }

      const session = await sessionState.get(sessionId)
      if (!session) {
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

        const session = await sessionState.get(query.token)
        if (!session) {
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
      const sessionId = getSessionId(cookie, headers.authorization)

      if (!sessionId) {
        set.status = 400
        return { error: 'no_session' }
      }

      // Revoke all refresh tokens for this session
      await refreshTokenState.revokeAllForSession(sessionId)

      // Invalidate ephemeral key for this session
      invalidateEphemeralKey(sessionId)

      // Delete session
      await sessionState.delete(sessionId)

      // Clear cookie
      if (cookie.jeju_session) {
        cookie.jeju_session.set({
          value: '',
          maxAge: 0,
          path: '/',
        })
      }

      return { success: true, message: 'Logged out' }
    })

    .post('/refresh', async ({ headers, set, cookie }) => {
      const sessionId = getSessionId(cookie, headers.authorization)

      if (!sessionId) {
        set.status = 401
        return { error: 'no_session' }
      }

      const session = await sessionState.get(sessionId)
      if (!session) {
        set.status = 401
        return { error: 'session_not_found' }
      }

      // Create new session with extended expiry and fresh ephemeral key
      const newSessionId = crypto.randomUUID()

      // Invalidate old ephemeral key
      invalidateEphemeralKey(sessionId)

      // Get new ephemeral key
      const newEphemeralKey = await getEphemeralKey(newSessionId)

      const newSession: AuthSession = {
        ...session,
        sessionId: newSessionId,
        createdAt: Date.now(),
        expiresAt: Date.now() + config.sessionDuration,
        ephemeralKeyId: newEphemeralKey.keyId,
      }

      // Delete old, add new
      await sessionState.delete(sessionId)
      await sessionState.save(newSession)

      // Update cookie
      if (cookie.jeju_session) {
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

    .get('/:sessionId', async ({ params, headers, set, cookie }) => {
      // Require authentication - user can only view their own sessions
      const currentSessionId = getSessionId(cookie, headers.authorization)
      if (!currentSessionId) {
        set.status = 401
        return { error: 'unauthorized' }
      }

      const currentSession = await sessionState.get(currentSessionId)
      if (!currentSession) {
        set.status = 401
        return { error: 'session_expired' }
      }

      const targetSession = await sessionState.get(params.sessionId)
      if (!targetSession) {
        set.status = 404
        return { error: 'session_not_found' }
      }

      // Only allow viewing sessions that belong to the same user
      if (targetSession.userId !== currentSession.userId) {
        set.status = 403
        return { error: 'not_authorized' }
      }

      return {
        sessionId: targetSession.sessionId,
        userId: targetSession.userId,
        provider: targetSession.provider,
        address: targetSession.address,
        fid: targetSession.fid,
        createdAt: targetSession.createdAt,
        expiresAt: targetSession.expiresAt,
      }
    })

    .delete('/:sessionId', async ({ params, headers, set, cookie }) => {
      // Require authentication - user can only delete their own sessions
      const currentSessionId = getSessionId(cookie, headers.authorization)
      if (!currentSessionId) {
        set.status = 401
        return { error: 'unauthorized' }
      }

      const currentSession = await sessionState.get(currentSessionId)
      if (!currentSession) {
        set.status = 401
        return { error: 'session_expired' }
      }

      const targetSession = await sessionState.get(params.sessionId)
      if (!targetSession) {
        set.status = 404
        return { error: 'session_not_found' }
      }

      // Only allow deleting sessions that belong to the same user
      if (targetSession.userId !== currentSession.userId) {
        set.status = 403
        return { error: 'not_authorized' }
      }

      await refreshTokenState.revokeAllForSession(params.sessionId)
      await sessionState.delete(params.sessionId)
      return { success: true }
    })

    .post('/:sessionId/refresh', async ({ params, headers, set, cookie }) => {
      // Require authentication - user can only refresh their own sessions
      const currentSessionId = getSessionId(cookie, headers.authorization)
      if (!currentSessionId) {
        set.status = 401
        return { error: 'unauthorized' }
      }

      const currentSession = await sessionState.get(currentSessionId)
      if (!currentSession) {
        set.status = 401
        return { error: 'session_expired' }
      }

      const targetSession = await sessionState.get(params.sessionId)
      if (!targetSession) {
        set.status = 404
        return { error: 'session_not_found' }
      }

      // Only allow refreshing sessions that belong to the same user
      if (targetSession.userId !== currentSession.userId) {
        set.status = 403
        return { error: 'not_authorized' }
      }

      // Extend session
      const newExpiry = Date.now() + config.sessionDuration
      await sessionState.updateExpiry(params.sessionId, newExpiry)

      return {
        sessionId: targetSession.sessionId,
        expiresAt: newExpiry,
      }
    })

    .get('/list', async ({ headers, set }) => {
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

      const currentSession = await sessionState.get(sessionId)
      if (!currentSession) {
        set.status = 401
        return { error: 'session_not_found' }
      }

      // Find all sessions for this user
      const userSessions = await sessionState.findByUserId(
        currentSession.userId,
      )
      const sessionList = userSessions.map((s) => ({
        sessionId: s.sessionId,
        provider: s.provider,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        isCurrent: s.sessionId === sessionId,
      }))

      return {
        userId: currentSession.userId,
        sessions: sessionList,
        count: sessionList.length,
      }
    })
}

function extractBearerToken(
  authHeader: string | null | undefined,
): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null
  return authHeader.slice(7)
}
