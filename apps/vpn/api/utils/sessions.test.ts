import { describe, expect, test } from 'bun:test'
import {
  createSession,
  deleteSession,
  generateSessionId,
  getSession,
  getSessionBytesTransferred,
  getSessionDuration,
  getSessionsForAddress,
  verifySessionOwnership,
} from './sessions'
import {
  createTestContext,
  createTestNode,
  createTestSession,
  TEST_ADDRESSES,
  toAlternateCaseAddress,
} from './test-fixtures'

describe('generateSessionId', () => {
  test('generates unique session IDs', () => {
    const id1 = generateSessionId()
    const id2 = generateSessionId()
    expect(id1).not.toBe(id2)
  })

  test('starts with sess- prefix', () => {
    const id = generateSessionId()
    expect(id.startsWith('sess-')).toBe(true)
  })

  test('contains cryptographically secure UUID', () => {
    const id = generateSessionId()
    // Should be "sess-" followed by a UUID (36 chars including hyphens)
    // Total length: 5 + 36 = 41
    expect(id.length).toBe(41)

    // UUID format: 8-4-4-4-12 after the "sess-" prefix
    const uuid = id.slice(5)
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    expect(uuidRegex.test(uuid)).toBe(true)
  })
})

describe('createSession', () => {
  test('creates session with correct properties', () => {
    const node = createTestNode({ nodeId: 'test-node' })
    const ctx = createTestContext([node])

    const session = createSession(ctx, TEST_ADDRESSES.user2, 'test-node')

    expect(session.clientAddress).toBe(TEST_ADDRESSES.user2)
    expect(session.nodeId).toBe('test-node')
    expect(session.protocol).toBe('wireguard')
    expect(session.bytesUp).toBe(BigInt(0))
    expect(session.bytesDown).toBe(BigInt(0))
    expect(session.isPaid).toBe(false)
    expect(ctx.sessions.has(session.sessionId)).toBe(true)
  })

  test('creates session with specified protocol', () => {
    const node = createTestNode()
    const ctx = createTestContext([node])

    const session = createSession(ctx, TEST_ADDRESSES.user2, 'node-1', 'socks5')
    expect(session.protocol).toBe('socks5')
  })

  test('throws when node not found', () => {
    const ctx = createTestContext([])

    expect(() =>
      createSession(ctx, TEST_ADDRESSES.user2, 'missing-node'),
    ).toThrow('Node not found: missing-node')
  })
})

describe('getSession', () => {
  test('returns session by id', () => {
    const node = createTestNode()
    const ctx = createTestContext([node])
    const created = createSession(ctx, TEST_ADDRESSES.user2, 'node-1')

    const retrieved = getSession(ctx, created.sessionId)
    expect(retrieved.sessionId).toBe(created.sessionId)
  })

  test('throws when session not found', () => {
    const ctx = createTestContext([])
    expect(() => getSession(ctx, 'missing-session')).toThrow(
      'Session not found: missing-session',
    )
  })
})

describe('verifySessionOwnership', () => {
  test('passes when address matches', () => {
    const session = createTestSession({
      clientAddress: TEST_ADDRESSES.user1,
    })
    expect(() =>
      verifySessionOwnership(session, TEST_ADDRESSES.user1),
    ).not.toThrow()
  })

  test('handles case-insensitive address comparison', () => {
    const session = createTestSession({
      clientAddress: TEST_ADDRESSES.user1,
    })
    const altCaseAddress = toAlternateCaseAddress(TEST_ADDRESSES.user1)
    expect(() => verifySessionOwnership(session, altCaseAddress)).not.toThrow()
  })

  test('throws when address does not match', () => {
    const session = createTestSession({
      clientAddress: TEST_ADDRESSES.user1,
    })
    expect(() => verifySessionOwnership(session, TEST_ADDRESSES.user2)).toThrow(
      'Not your session',
    )
  })
})

describe('deleteSession', () => {
  test('removes session from context', () => {
    const node = createTestNode()
    const ctx = createTestContext([node])
    const session = createSession(ctx, TEST_ADDRESSES.user1, 'node-1')

    expect(ctx.sessions.has(session.sessionId)).toBe(true)
    deleteSession(ctx, session.sessionId)
    expect(ctx.sessions.has(session.sessionId)).toBe(false)
  })

  test('throws when session not found', () => {
    const ctx = createTestContext([])
    expect(() => deleteSession(ctx, 'missing-session')).toThrow(
      'Session not found: missing-session',
    )
  })
})

describe('getSessionsForAddress', () => {
  test('returns all sessions for address', () => {
    const node = createTestNode()
    const ctx = createTestContext([node])

    createSession(ctx, TEST_ADDRESSES.user1, 'node-1')
    createSession(ctx, TEST_ADDRESSES.user1, 'node-1')
    createSession(ctx, TEST_ADDRESSES.user2, 'node-1')

    const sessions = getSessionsForAddress(ctx, TEST_ADDRESSES.user1)
    expect(sessions.length).toBe(2)
    expect(
      sessions.every(
        (s) =>
          s.clientAddress.toLowerCase() === TEST_ADDRESSES.user1.toLowerCase(),
      ),
    ).toBe(true)
  })

  test('returns empty array when no sessions', () => {
    const ctx = createTestContext([])
    const sessions = getSessionsForAddress(ctx, TEST_ADDRESSES.user1)
    expect(sessions.length).toBe(0)
  })

  test('handles case-insensitive address matching', () => {
    const node = createTestNode()
    const ctx = createTestContext([node])

    createSession(ctx, TEST_ADDRESSES.user1, 'node-1')

    const altCaseAddress = toAlternateCaseAddress(TEST_ADDRESSES.user1)
    const sessions = getSessionsForAddress(ctx, altCaseAddress)
    expect(sessions.length).toBe(1)
  })
})

describe('getSessionDuration', () => {
  test('calculates duration correctly', () => {
    const startTime = Date.now() - 60000 // 1 minute ago
    const session = createTestSession({ startTime })

    const duration = getSessionDuration(session)
    expect(duration).toBeGreaterThanOrEqual(60000)
    expect(duration).toBeLessThanOrEqual(61000) // Allow 1 second tolerance
  })

  test('returns 0 for new session', () => {
    const session = createTestSession({ startTime: Date.now() })
    const duration = getSessionDuration(session)
    expect(duration).toBeLessThan(100) // Should be near 0
  })
})

describe('getSessionBytesTransferred', () => {
  test('returns sum of up and down bytes', () => {
    const session = createTestSession({
      bytesUp: BigInt(1000),
      bytesDown: BigInt(5000),
    })
    const total = getSessionBytesTransferred(session)
    expect(total).toBe(BigInt(6000))
  })

  test('handles zero bytes', () => {
    const session = createTestSession({
      bytesUp: BigInt(0),
      bytesDown: BigInt(0),
    })
    const total = getSessionBytesTransferred(session)
    expect(total).toBe(BigInt(0))
  })

  test('handles large byte values', () => {
    // 1 TB each way
    const oneTB = BigInt('1099511627776')
    const session = createTestSession({
      bytesUp: oneTB,
      bytesDown: oneTB,
    })
    const total = getSessionBytesTransferred(session)
    expect(total).toBe(BigInt('2199023255552'))
  })
})
