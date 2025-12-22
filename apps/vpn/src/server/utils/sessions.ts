/**
 * Session management utilities
 *
 * Shared business logic for VPN session operations
 */

import type { Address } from 'viem'
import { expect, expectExists } from '../schemas'
import type { VPNServiceContext, VPNSessionState } from '../types'

// SECURITY: Maximum sessions per address to prevent resource exhaustion
const MAX_SESSIONS_PER_ADDRESS = 5

// SECURITY: Lock mechanism to prevent race conditions in session creation
// Maps address to a pending promise that resolves when the operation completes
const sessionLocks = new Map<string, Promise<void>>()

/**
 * Generate a cryptographically secure session ID
 */
export function generateSessionId(): string {
  // Use crypto.randomUUID() for cryptographically secure random generation
  return `sess-${crypto.randomUUID()}`
}

/**
 * Acquire a lock for session operations on an address
 * This ensures only one session operation happens at a time per address
 */
async function acquireSessionLock(address: string): Promise<() => void> {
  const normalizedAddress = address.toLowerCase()

  // Wait for any existing operation to complete
  const existingLock = sessionLocks.get(normalizedAddress)
  if (existingLock) {
    await existingLock
  }

  // Create a new lock
  let releaseLock: () => void = () => {
    /* initialized below */
  }
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve
  })

  sessionLocks.set(normalizedAddress, lockPromise)

  // Return a function to release the lock
  return () => {
    if (sessionLocks.get(normalizedAddress) === lockPromise) {
      sessionLocks.delete(normalizedAddress)
    }
    releaseLock()
  }
}

/**
 * Create a new VPN session with race condition protection
 */
export async function createSessionAsync(
  ctx: VPNServiceContext,
  clientAddress: Address,
  nodeId: string,
  protocol: 'wireguard' | 'socks5' | 'http' = 'wireguard',
): Promise<VPNSessionState> {
  const releaseLock = await acquireSessionLock(clientAddress)

  try {
    // SECURITY: Check existing sessions for this address
    const existingSessions = getSessionsForAddress(ctx, clientAddress)
    if (existingSessions.length >= MAX_SESSIONS_PER_ADDRESS) {
      throw new Error(
        `Maximum sessions (${MAX_SESSIONS_PER_ADDRESS}) reached for this address`,
      )
    }

    const node = ctx.nodes.get(nodeId)
    expectExists(node, `Node not found: ${nodeId}`)

    const sessionId = generateSessionId()
    const session: VPNSessionState = {
      sessionId,
      clientAddress,
      nodeId,
      protocol,
      startTime: Date.now(),
      bytesUp: BigInt(0),
      bytesDown: BigInt(0),
      isPaid: false,
      paymentAmount: BigInt(0),
    }

    ctx.sessions.set(sessionId, session)
    return session
  } finally {
    releaseLock()
  }
}

/**
 * Create a new VPN session (synchronous version for backwards compatibility)
 * Note: Use createSessionAsync when possible for race condition protection
 */
export function createSession(
  ctx: VPNServiceContext,
  clientAddress: Address,
  nodeId: string,
  protocol: 'wireguard' | 'socks5' | 'http' = 'wireguard',
): VPNSessionState {
  // SECURITY: Check existing sessions for this address
  const existingSessions = getSessionsForAddress(ctx, clientAddress)
  if (existingSessions.length >= MAX_SESSIONS_PER_ADDRESS) {
    throw new Error(
      `Maximum sessions (${MAX_SESSIONS_PER_ADDRESS}) reached for this address`,
    )
  }

  const node = ctx.nodes.get(nodeId)
  expectExists(node, `Node not found: ${nodeId}`)

  const sessionId = generateSessionId()
  const session: VPNSessionState = {
    sessionId,
    clientAddress,
    nodeId,
    protocol,
    startTime: Date.now(),
    bytesUp: BigInt(0),
    bytesDown: BigInt(0),
    isPaid: false,
    paymentAmount: BigInt(0),
  }

  ctx.sessions.set(sessionId, session)
  return session
}

/**
 * Get session by ID
 */
export function getSession(
  ctx: VPNServiceContext,
  sessionId: string,
): VPNSessionState {
  const session = ctx.sessions.get(sessionId)
  expectExists(session, `Session not found: ${sessionId}`)
  return session
}

/**
 * Verify session ownership
 */
export function verifySessionOwnership(
  session: VPNSessionState,
  address: Address,
): void {
  expect(
    session.clientAddress.toLowerCase() === address.toLowerCase(),
    'Not your session',
  )
}

/**
 * Delete session
 */
export function deleteSession(ctx: VPNServiceContext, sessionId: string): void {
  const exists = ctx.sessions.has(sessionId)
  expect(exists, `Session not found: ${sessionId}`)
  ctx.sessions.delete(sessionId)
}

/**
 * Get all sessions for an address
 */
export function getSessionsForAddress(
  ctx: VPNServiceContext,
  address: Address,
): VPNSessionState[] {
  return Array.from(ctx.sessions.values()).filter(
    (s) => s.clientAddress.toLowerCase() === address.toLowerCase(),
  )
}

/**
 * Calculate session duration
 */
export function getSessionDuration(session: VPNSessionState): number {
  return Date.now() - session.startTime
}

/**
 * Get total bytes transferred for a session
 */
export function getSessionBytesTransferred(session: VPNSessionState): bigint {
  return session.bytesUp + session.bytesDown
}
