/** Session management utilities */

import type { Address } from 'viem'
import type { VPNSessionState } from '../schemas'
import { expect, expectExists } from '../schemas'
import type { VPNServiceContext } from '../types'

const MAX_SESSIONS_PER_ADDRESS = 5
const sessionLocks = new Map<string, Promise<void>>()

export function generateSessionId(): string {
  return `sess-${crypto.randomUUID()}`
}

async function acquireSessionLock(address: string): Promise<() => void> {
  const normalizedAddress = address.toLowerCase()

  const existingLock = sessionLocks.get(normalizedAddress)
  if (existingLock) {
    await existingLock
  }

  let releaseLock: () => void = () => {}
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve
  })

  sessionLocks.set(normalizedAddress, lockPromise)

  return () => {
    if (sessionLocks.get(normalizedAddress) === lockPromise) {
      sessionLocks.delete(normalizedAddress)
    }
    releaseLock()
  }
}

export async function createSessionAsync(
  ctx: VPNServiceContext,
  clientAddress: Address,
  nodeId: string,
  protocol: 'wireguard' | 'socks5' | 'http' = 'wireguard',
): Promise<VPNSessionState> {
  const releaseLock = await acquireSessionLock(clientAddress)

  try {
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

export function createSession(
  ctx: VPNServiceContext,
  clientAddress: Address,
  nodeId: string,
  protocol: 'wireguard' | 'socks5' | 'http' = 'wireguard',
): VPNSessionState {
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

export function getSession(
  ctx: VPNServiceContext,
  sessionId: string,
): VPNSessionState {
  const session = ctx.sessions.get(sessionId)
  expectExists(session, `Session not found: ${sessionId}`)
  return session
}

export function verifySessionOwnership(
  session: VPNSessionState,
  address: Address,
): void {
  expect(
    session.clientAddress.toLowerCase() === address.toLowerCase(),
    'Not your session',
  )
}

export function deleteSession(ctx: VPNServiceContext, sessionId: string): void {
  const exists = ctx.sessions.has(sessionId)
  expect(exists, `Session not found: ${sessionId}`)
  ctx.sessions.delete(sessionId)
}

export function getSessionsForAddress(
  ctx: VPNServiceContext,
  address: Address,
): VPNSessionState[] {
  return Array.from(ctx.sessions.values()).filter(
    (s) => s.clientAddress.toLowerCase() === address.toLowerCase(),
  )
}

export function getSessionDuration(session: VPNSessionState): number {
  return Date.now() - session.startTime
}

export function getSessionBytesTransferred(session: VPNSessionState): bigint {
  return session.bytesUp + session.bytesDown
}
