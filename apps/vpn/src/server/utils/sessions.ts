/**
 * Session management utilities
 * 
 * Shared business logic for VPN session operations
 */

import type { VPNServiceContext, VPNSessionState } from '../types';
import type { Address } from 'viem';
import { expect, expectExists } from '../schemas';

/**
 * Generate a unique session ID
 */
export function generateSessionId(): string {
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a new VPN session
 */
export function createSession(
  ctx: VPNServiceContext,
  clientAddress: Address,
  nodeId: string,
  protocol: 'wireguard' | 'socks5' | 'http' = 'wireguard'
): VPNSessionState {
  const node = ctx.nodes.get(nodeId);
  expectExists(node, `Node not found: ${nodeId}`);
  
  const sessionId = generateSessionId();
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
  };
  
  ctx.sessions.set(sessionId, session);
  return session;
}

/**
 * Get session by ID
 */
export function getSession(
  ctx: VPNServiceContext,
  sessionId: string
): VPNSessionState {
  const session = ctx.sessions.get(sessionId);
  expectExists(session, `Session not found: ${sessionId}`);
  return session;
}

/**
 * Verify session ownership
 */
export function verifySessionOwnership(
  session: VPNSessionState,
  address: Address
): void {
  expect(
    session.clientAddress.toLowerCase() === address.toLowerCase(),
    'Not your session'
  );
}

/**
 * Delete session
 */
export function deleteSession(
  ctx: VPNServiceContext,
  sessionId: string
): void {
  const exists = ctx.sessions.has(sessionId);
  expect(exists, `Session not found: ${sessionId}`);
  ctx.sessions.delete(sessionId);
}

/**
 * Get all sessions for an address
 */
export function getSessionsForAddress(
  ctx: VPNServiceContext,
  address: Address
): VPNSessionState[] {
  return Array.from(ctx.sessions.values()).filter(
    s => s.clientAddress.toLowerCase() === address.toLowerCase()
  );
}

/**
 * Calculate session duration
 */
export function getSessionDuration(session: VPNSessionState): number {
  return Date.now() - session.startTime;
}

/**
 * Get total bytes transferred for a session
 */
export function getSessionBytesTransferred(session: VPNSessionState): bigint {
  return session.bytesUp + session.bytesDown;
}
