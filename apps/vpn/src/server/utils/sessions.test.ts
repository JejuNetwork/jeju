/**
 * Unit tests for session management utilities
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import type { Address } from 'viem';
import type { VPNSessionState, VPNNodeState, VPNServiceContext } from '../types';
import {
  generateSessionId,
  createSession,
  getSession,
  verifySessionOwnership,
  deleteSession,
  getSessionsForAddress,
  getSessionDuration,
  getSessionBytesTransferred,
} from './sessions';

// Helper to create test node
function createTestNode(overrides: Partial<VPNNodeState> = {}): VPNNodeState {
  return {
    nodeId: 'node-1',
    operator: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address,
    countryCode: 'US',
    region: 'us-east-1',
    endpoint: 'vpn1.jeju.network:51820',
    wireguardPubKey: 'abc123pubkey',
    status: 'online',
    activeConnections: 5,
    maxConnections: 100,
    latencyMs: 25,
    ...overrides,
  };
}

// Helper to create test context
function createTestContext(nodes: VPNNodeState[] = []): VPNServiceContext {
  const ctx: VPNServiceContext = {
    config: {
      publicUrl: 'https://vpn.jeju.network',
      port: 3000,
      chainId: 84532,
      rpcUrl: 'https://sepolia.base.org',
      coordinatorUrl: 'https://coordinator.jeju.network',
      contracts: {
        vpnRegistry: '0x1234567890123456789012345678901234567890' as Address,
        vpnBilling: '0x2234567890123456789012345678901234567890' as Address,
        x402Facilitator: '0x3234567890123456789012345678901234567890' as Address,
      },
      paymentRecipient: '0x4234567890123456789012345678901234567890' as Address,
      pricing: {
        pricePerGB: '1000000000000000',
        pricePerHour: '100000000000000',
        pricePerRequest: '10000000000000',
        supportedTokens: ['0x5234567890123456789012345678901234567890' as Address],
      },
    },
    nodes: new Map(),
    sessions: new Map(),
    contributions: new Map(),
  };
  for (const node of nodes) {
    ctx.nodes.set(node.nodeId, node);
  }
  return ctx;
}

// Helper to create test session
function createTestSession(overrides: Partial<VPNSessionState> = {}): VPNSessionState {
  return {
    sessionId: 'sess-test-123',
    clientAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address,
    nodeId: 'node-1',
    protocol: 'wireguard',
    startTime: Date.now(),
    bytesUp: BigInt(0),
    bytesDown: BigInt(0),
    isPaid: false,
    paymentAmount: BigInt(0),
    ...overrides,
  };
}

describe('generateSessionId', () => {
  test('generates unique session IDs', () => {
    const id1 = generateSessionId();
    const id2 = generateSessionId();
    expect(id1).not.toBe(id2);
  });

  test('starts with sess- prefix', () => {
    const id = generateSessionId();
    expect(id.startsWith('sess-')).toBe(true);
  });

  test('contains timestamp', () => {
    const before = Date.now();
    const id = generateSessionId();
    const after = Date.now();
    const parts = id.split('-');
    const timestamp = parseInt(parts[1], 10);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });
});

describe('createSession', () => {
  test('creates session with correct properties', () => {
    const node = createTestNode({ nodeId: 'test-node' });
    const ctx = createTestContext([node]);
    const clientAddress = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;

    const session = createSession(ctx, clientAddress, 'test-node');

    expect(session.clientAddress).toBe(clientAddress);
    expect(session.nodeId).toBe('test-node');
    expect(session.protocol).toBe('wireguard');
    expect(session.bytesUp).toBe(BigInt(0));
    expect(session.bytesDown).toBe(BigInt(0));
    expect(session.isPaid).toBe(false);
    expect(ctx.sessions.has(session.sessionId)).toBe(true);
  });

  test('creates session with specified protocol', () => {
    const node = createTestNode();
    const ctx = createTestContext([node]);
    const clientAddress = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;

    const session = createSession(ctx, clientAddress, 'node-1', 'socks5');
    expect(session.protocol).toBe('socks5');
  });

  test('throws when node not found', () => {
    const ctx = createTestContext([]);
    const clientAddress = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;

    expect(() => createSession(ctx, clientAddress, 'missing-node')).toThrow('Node not found: missing-node');
  });
});

describe('getSession', () => {
  test('returns session by id', () => {
    const node = createTestNode();
    const ctx = createTestContext([node]);
    const clientAddress = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;
    const created = createSession(ctx, clientAddress, 'node-1');

    const retrieved = getSession(ctx, created.sessionId);
    expect(retrieved.sessionId).toBe(created.sessionId);
  });

  test('throws when session not found', () => {
    const ctx = createTestContext([]);
    expect(() => getSession(ctx, 'missing-session')).toThrow('Session not found: missing-session');
  });
});

describe('verifySessionOwnership', () => {
  test('passes when address matches', () => {
    const session = createTestSession({
      clientAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address,
    });
    expect(() => verifySessionOwnership(session, '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address)).not.toThrow();
  });

  test('handles case-insensitive address comparison', () => {
    const session = createTestSession({
      clientAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address,
    });
    expect(() =>
      verifySessionOwnership(session, '0xF39FD6E51AAD88F6F4CE6AB8827279CFFFB92266' as Address)
    ).not.toThrow();
  });

  test('throws when address does not match', () => {
    const session = createTestSession({
      clientAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address,
    });
    expect(() => verifySessionOwnership(session, '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address)).toThrow(
      'Not your session'
    );
  });
});

describe('deleteSession', () => {
  test('removes session from context', () => {
    const node = createTestNode();
    const ctx = createTestContext([node]);
    const session = createSession(ctx, '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address, 'node-1');

    expect(ctx.sessions.has(session.sessionId)).toBe(true);
    deleteSession(ctx, session.sessionId);
    expect(ctx.sessions.has(session.sessionId)).toBe(false);
  });

  test('throws when session not found', () => {
    const ctx = createTestContext([]);
    expect(() => deleteSession(ctx, 'missing-session')).toThrow('Session not found: missing-session');
  });
});

describe('getSessionsForAddress', () => {
  test('returns all sessions for address', () => {
    const node = createTestNode();
    const ctx = createTestContext([node]);
    const address1 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address;
    const address2 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;

    createSession(ctx, address1, 'node-1');
    createSession(ctx, address1, 'node-1');
    createSession(ctx, address2, 'node-1');

    const sessions = getSessionsForAddress(ctx, address1);
    expect(sessions.length).toBe(2);
    expect(sessions.every((s) => s.clientAddress.toLowerCase() === address1.toLowerCase())).toBe(true);
  });

  test('returns empty array when no sessions', () => {
    const ctx = createTestContext([]);
    const sessions = getSessionsForAddress(ctx, '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address);
    expect(sessions.length).toBe(0);
  });

  test('handles case-insensitive address matching', () => {
    const node = createTestNode();
    const ctx = createTestContext([node]);
    const address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address;

    createSession(ctx, address, 'node-1');

    const sessions = getSessionsForAddress(ctx, '0xF39FD6E51AAD88F6F4CE6AB8827279CFFFB92266' as Address);
    expect(sessions.length).toBe(1);
  });
});

describe('getSessionDuration', () => {
  test('calculates duration correctly', () => {
    const startTime = Date.now() - 60000; // 1 minute ago
    const session = createTestSession({ startTime });

    const duration = getSessionDuration(session);
    expect(duration).toBeGreaterThanOrEqual(60000);
    expect(duration).toBeLessThanOrEqual(61000); // Allow 1 second tolerance
  });

  test('returns 0 for new session', () => {
    const session = createTestSession({ startTime: Date.now() });
    const duration = getSessionDuration(session);
    expect(duration).toBeLessThan(100); // Should be near 0
  });
});

describe('getSessionBytesTransferred', () => {
  test('returns sum of up and down bytes', () => {
    const session = createTestSession({
      bytesUp: BigInt(1000),
      bytesDown: BigInt(5000),
    });
    const total = getSessionBytesTransferred(session);
    expect(total).toBe(BigInt(6000));
  });

  test('handles zero bytes', () => {
    const session = createTestSession({
      bytesUp: BigInt(0),
      bytesDown: BigInt(0),
    });
    const total = getSessionBytesTransferred(session);
    expect(total).toBe(BigInt(0));
  });

  test('handles large byte values', () => {
    // 1 TB each way
    const oneTB = BigInt('1099511627776');
    const session = createTestSession({
      bytesUp: oneTB,
      bytesDown: oneTB,
    });
    const total = getSessionBytesTransferred(session);
    expect(total).toBe(BigInt('2199023255552'));
  });
});
