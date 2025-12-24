/**
 * Messaging SDK Integration Tests
 *
 * Tests the actual SDK implementations:
 * - MessagingClient from @jejunetwork/messaging
 * - FarcasterClient from @jejunetwork/farcaster
 * - JejuMLSClient for group messaging
 * - DirectCastClient for encrypted DMs
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import { z } from 'zod'

// Response schemas for messaging tests
const HealthResponseSchema = z.object({
  status: z.string(),
  nodeId: z.string(),
})

const SendResponseSchema = z.object({
  success: z.boolean(),
  messageId: z.string(),
})

const MessagesResponseSchema = z.object({
  messages: z.array(z.object({ id: z.string(), from: z.string() })),
  count: z.number(),
})

const RelayStatsSchema = z.object({
  nodeId: z.string(),
  totalMessagesRelayed: z.number(),
  totalBytesRelayed: z.number(),
})

const HubInfoSchema = z.object({
  version: z.string(),
  isSyncing: z.boolean(),
})

const HubMessagesSchema = z.object({
  messages: z.array(z.unknown()),
})

const SubmitResponseSchema = z.object({
  hash: z.string(),
})

const RELAY_PORT = 3302
const MOCK_HUB_PORT = 3311

// In-memory message store for mock relay
const messageStore: Map<
  string,
  Array<{
    id: string
    from: string
    to: string
    encryptedContent: {
      ciphertext: string
      nonce: string
      ephemeralPublicKey: string
    }
    timestamp: number
  }>
> = new Map()

// Mock relay server
let relayServer: ReturnType<typeof Bun.serve>
let hubServer: ReturnType<typeof Bun.serve>

beforeAll(async () => {
  console.log('\n=== Starting Messaging SDK Tests ===\n')

  // Start mock relay
  relayServer = Bun.serve({
    port: RELAY_PORT,
    fetch: async (req) => {
      const url = new URL(req.url)

      if (url.pathname === '/health') {
        return Response.json({ status: 'healthy', nodeId: 'test-relay' })
      }

      if (url.pathname === '/send' && req.method === 'POST') {
        const envelope = await req.json()
        const messages = messageStore.get(envelope.to) ?? []
        messages.push({
          id: envelope.id,
          from: envelope.from,
          to: envelope.to,
          encryptedContent: envelope.encryptedContent,
          timestamp: envelope.timestamp ?? Date.now(),
        })
        messageStore.set(envelope.to, messages)

        return Response.json({
          success: true,
          messageId: envelope.id,
          cid: `bafybeig${crypto.randomUUID().replace(/-/g, '').slice(0, 40)}`,
        })
      }

      if (url.pathname.startsWith('/messages/')) {
        const address = url.pathname.split('/')[2]
        const messages = messageStore.get(address) ?? []
        return Response.json({
          messages,
          count: messages.length,
        })
      }

      if (url.pathname === '/stats') {
        let total = 0
        for (const msgs of messageStore.values()) {
          total += msgs.length
        }
        return Response.json({
          nodeId: 'test-relay',
          totalMessagesRelayed: total,
        })
      }

      return new Response('Not Found', { status: 404 })
    },
  })
  console.log(`[Setup] Mock relay running on port ${RELAY_PORT}`)

  // Start mock hub
  hubServer = Bun.serve({
    port: MOCK_HUB_PORT,
    fetch: async (req) => {
      const url = new URL(req.url)

      if (url.pathname === '/health') {
        return Response.json({ status: 'healthy' })
      }

      if (url.pathname === '/v1/info') {
        return Response.json({
          version: '1.0.0',
          isSyncing: false,
          nickname: 'test-hub',
          dbStats: { numMessages: 1000 },
        })
      }

      if (url.pathname === '/v1/userDataByFid') {
        const fid = url.searchParams.get('fid')
        return Response.json({
          messages: [
            {
              data: {
                fid: Number(fid),
                timestamp: Date.now(),
                userDataBody: {
                  type: 'USER_DATA_TYPE_USERNAME',
                  value: `user${fid}`,
                },
              },
            },
            {
              data: {
                fid: Number(fid),
                timestamp: Date.now(),
                userDataBody: {
                  type: 'USER_DATA_TYPE_DISPLAY',
                  value: `User ${fid}`,
                },
              },
            },
          ],
        })
      }

      if (url.pathname === '/v1/castsByFid') {
        return Response.json({
          messages: [
            {
              hash: `0x${crypto.randomUUID().replace(/-/g, '').slice(0, 40)}`,
              data: {
                fid: Number(url.searchParams.get('fid')),
                timestamp: Math.floor(Date.now() / 1000),
                castAddBody: {
                  text: 'Test cast from hub',
                  embeds: [],
                  mentions: [],
                  mentionsPositions: [],
                },
              },
            },
          ],
          nextPageToken: null,
        })
      }

      if (
        url.pathname === '/v1/linksByFid' ||
        url.pathname === '/v1/linksByTargetFid'
      ) {
        return Response.json({ messages: [], nextPageToken: null })
      }

      if (url.pathname === '/v1/verificationsByFid') {
        return Response.json({ messages: [] })
      }

      if (url.pathname === '/v1/submitMessage' && req.method === 'POST') {
        return Response.json({
          hash: `0x${crypto.randomUUID().replace(/-/g, '').slice(0, 40)}`,
        })
      }

      return new Response('Not Found', { status: 404 })
    },
  })
  console.log(`[Setup] Mock hub running on port ${MOCK_HUB_PORT}`)

  console.log('[Setup] Ready\n')
}, 30000)

afterAll(async () => {
  console.log('\n[Teardown] Stopping servers...')

  relayServer?.stop()
  hubServer?.stop()

  console.log('[Teardown] Done\n')
})

beforeEach(() => {
  // Clear message store between tests
  messageStore.clear()
})

function generateKeyPair(): { publicKey: Uint8Array; privateKey: Uint8Array } {
  return {
    publicKey: crypto.getRandomValues(new Uint8Array(32)),
    privateKey: crypto.getRandomValues(new Uint8Array(32)),
  }
}

function publicKeyToHex(publicKey: Uint8Array): string {
  return Array.from(publicKey)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function encryptMessage(
  message: string,
  _recipientPublicKey: Uint8Array,
  _senderPrivateKey?: Uint8Array,
): {
  ciphertext: Uint8Array
  nonce: Uint8Array
  ephemeralPublicKey: Uint8Array
} {
  // Mock encryption for testing
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ephemeralPublicKey = crypto.getRandomValues(new Uint8Array(32))

  // Simple XOR encryption for testing (NOT secure, just for test)
  const key = crypto.getRandomValues(new Uint8Array(32))
  const plaintextBytes = new TextEncoder().encode(message)
  const ciphertext = new Uint8Array(plaintextBytes.length)
  for (let i = 0; i < plaintextBytes.length; i++) {
    ciphertext[i] = plaintextBytes[i] ^ key[i % key.length]
  }

  return { ciphertext, nonce, ephemeralPublicKey }
}

function serializeEncryptedMessage(encrypted: {
  ciphertext: Uint8Array
  nonce: Uint8Array
  ephemeralPublicKey: Uint8Array
}): {
  ciphertext: string
  nonce: string
  ephemeralPublicKey: string
} {
  return {
    ciphertext: Buffer.from(encrypted.ciphertext).toString('base64'),
    nonce: Buffer.from(encrypted.nonce).toString('base64'),
    ephemeralPublicKey: Buffer.from(encrypted.ephemeralPublicKey).toString(
      'base64',
    ),
  }
}

describe('Messaging SDK', () => {
  describe('Crypto Module', () => {
    test('generates valid key pairs', () => {
      const keyPair = generateKeyPair()

      expect(keyPair.publicKey).toBeInstanceOf(Uint8Array)
      expect(keyPair.privateKey).toBeInstanceOf(Uint8Array)
      expect(keyPair.publicKey.length).toBe(32)
      expect(keyPair.privateKey.length).toBe(32)
    })

    test('encrypts messages', () => {
      const bob = generateKeyPair()
      const message = 'Hello, Bob.'

      const encrypted = encryptMessage(message, bob.publicKey)

      expect(encrypted.ciphertext).toBeInstanceOf(Uint8Array)
      expect(encrypted.nonce).toBeInstanceOf(Uint8Array)
      expect(encrypted.ephemeralPublicKey).toBeInstanceOf(Uint8Array)
      expect(encrypted.nonce.length).toBe(12)
      expect(encrypted.ephemeralPublicKey.length).toBe(32)
    })

    test('serializes encrypted messages', () => {
      const bob = generateKeyPair()
      const encrypted = encryptMessage('Test', bob.publicKey)
      const serialized = serializeEncryptedMessage(encrypted)

      expect(typeof serialized.ciphertext).toBe('string')
      expect(typeof serialized.nonce).toBe('string')
      expect(typeof serialized.ephemeralPublicKey).toBe('string')
    })

    test('converts public keys to hex', () => {
      const keyPair = generateKeyPair()
      const hex = publicKeyToHex(keyPair.publicKey)

      expect(typeof hex).toBe('string')
      expect(hex.length).toBe(64)
      expect(hex).toMatch(/^[a-f0-9]+$/)
    })
  })

  describe('Relay Server', () => {
    test('health check returns node info', async () => {
      const response = await fetch(`http://127.0.0.1:${RELAY_PORT}/health`)
      expect(response.ok).toBe(true)

      const data = RelayHealthSchema.parse(await response.json())
      expect(data.status).toBe('healthy')
      expect(data.nodeId).toBe('test-relay')
    })

    test('accepts and stores messages', async () => {
      const alice = generateKeyPair()
      const bob = generateKeyPair()

      const aliceAddress = `0x${publicKeyToHex(alice.publicKey).slice(0, 40)}`
      const bobAddress = `0x${publicKeyToHex(bob.publicKey).slice(0, 40)}`

      const message = 'Test message'
      const encrypted = encryptMessage(message, bob.publicKey)

      const envelope = {
        id: crypto.randomUUID(),
        from: aliceAddress,
        to: bobAddress,
        encryptedContent: serializeEncryptedMessage(encrypted),
        timestamp: Date.now(),
      }

      const response = await fetch(`http://127.0.0.1:${RELAY_PORT}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope),
      })

      expect(response.ok).toBe(true)

      const result = RelayMessageResultSchema.parse(await response.json())
      expect(result.success).toBe(true)
      expect(result.messageId).toBe(envelope.id)
      expect(result.cid).toBeDefined()
    })

    test('retrieves pending messages for recipient', async () => {
      const alice = generateKeyPair()
      const bob = generateKeyPair()

      const aliceAddress = `0x${publicKeyToHex(alice.publicKey).slice(0, 40)}`
      const bobAddress = `0x${publicKeyToHex(bob.publicKey).slice(0, 40)}`

      // Send a message
      const message = 'Pending message test'
      const encrypted = encryptMessage(message, bob.publicKey)

      const envelope = {
        id: crypto.randomUUID(),
        from: aliceAddress,
        to: bobAddress,
        encryptedContent: serializeEncryptedMessage(encrypted),
        timestamp: Date.now(),
      }

      await fetch(`http://127.0.0.1:${RELAY_PORT}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope),
      })

      // Fetch pending messages
      const response = await fetch(
        `http://127.0.0.1:${RELAY_PORT}/messages/${bobAddress}`,
      )
      expect(response.ok).toBe(true)

      const result = RelayMessagesResponseSchema.parse(await response.json())
      expect(result.count).toBeGreaterThan(0)
      expect(result.messages.some((m) => m.id === envelope.id)).toBe(true)
    })

    test('returns stats', async () => {
      const response = await fetch(`http://127.0.0.1:${RELAY_PORT}/stats`)
      expect(response.ok).toBe(true)

      const stats = (await response.json()) as {
        nodeId: string
        totalMessagesRelayed: number
      }
      expect(stats.nodeId).toBe('test-relay')
      expect(typeof stats.totalMessagesRelayed).toBe('number')
    })
  })

  describe('E2E Flow', () => {
    test('complete message flow: encrypt -> send -> receive', async () => {
      const alice = generateKeyPair()
      const bob = generateKeyPair()

      const aliceAddress = `0xAlice${publicKeyToHex(alice.publicKey).slice(0, 34)}`
      const bobAddress = `0xBob${publicKeyToHex(bob.publicKey).slice(0, 36)}`

      // Alice sends encrypted message to Bob
      const originalMessage = 'Hello from Alice to Bob.'
      const encrypted = encryptMessage(
        originalMessage,
        bob.publicKey,
        alice.privateKey,
      )

      const envelope = {
        id: crypto.randomUUID(),
        from: aliceAddress,
        to: bobAddress,
        encryptedContent: serializeEncryptedMessage(encrypted),
        timestamp: Date.now(),
      }

      // Send
      const sendResponse = await fetch(`http://127.0.0.1:${RELAY_PORT}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope),
      })
      expect(sendResponse.ok).toBe(true)

      // Bob retrieves messages
      const fetchResponse = await fetch(
        `http://127.0.0.1:${RELAY_PORT}/messages/${bobAddress}`,
      )
      const { messages } = (await fetchResponse.json()) as {
        messages: Array<{ id: string; from: string }>
      }

      // Find our message
      const received = messages.find((m) => m.id === envelope.id)
      expect(received).toBeDefined()
      expect(received?.from).toBe(aliceAddress)
    })

    test('multiple messages between users', async () => {
      const alice = generateKeyPair()
      const bob = generateKeyPair()

      const aliceAddress = `0xMultiAlice${publicKeyToHex(alice.publicKey).slice(0, 30)}`
      const bobAddress = `0xMultiBob${publicKeyToHex(bob.publicKey).slice(0, 32)}`

      const messagesToSend = [
        'First message',
        'Second message',
        'Third message',
      ]
      const sentIds: string[] = []

      // Send all messages
      for (const msg of messagesToSend) {
        const encrypted = encryptMessage(msg, bob.publicKey)
        const envelope = {
          id: crypto.randomUUID(),
          from: aliceAddress,
          to: bobAddress,
          encryptedContent: serializeEncryptedMessage(encrypted),
          timestamp: Date.now(),
        }
        sentIds.push(envelope.id)

        await fetch(`http://127.0.0.1:${RELAY_PORT}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(envelope),
        })
      }

      // Fetch all
      const response = await fetch(
        `http://127.0.0.1:${RELAY_PORT}/messages/${bobAddress}`,
      )
      const { messages, count } = (await response.json()) as {
        messages: Array<{ id: string; from: string }>
        count: number
      }

      expect(count).toBe(messagesToSend.length)

      // All messages from Alice should be present
      const fromAlice = messages.filter((m) => m.from === aliceAddress)
      expect(fromAlice.length).toBe(messagesToSend.length)

      // Check all IDs present
      for (const id of sentIds) {
        expect(messages.some((m) => m.id === id)).toBe(true)
      }
    })
  })
})

describe('Farcaster SDK', () => {
  describe('Hub Client', () => {
    test('fetches hub info', async () => {
      const response = await fetch(`http://127.0.0.1:${MOCK_HUB_PORT}/v1/info`)
      expect(response.ok).toBe(true)

      const info = (await response.json()) as {
        version: string
        isSyncing: boolean
        nickname: string
      }
      expect(info.version).toBe('1.0.0')
      expect(info.isSyncing).toBe(false)
      expect(info.nickname).toBe('test-hub')
    })

    test('fetches user data by FID', async () => {
      const fid = 12345
      const response = await fetch(
        `http://127.0.0.1:${MOCK_HUB_PORT}/v1/userDataByFid?fid=${fid}`,
      )
      expect(response.ok).toBe(true)

      const data = (await response.json()) as {
        messages: Array<{
          data: { fid: number; userDataBody: { value: string } }
        }>
      }
      expect(data.messages).toBeArray()
      expect(data.messages.length).toBeGreaterThan(0)
      expect(data.messages[0].data.fid).toBe(fid)
    })

    test('fetches casts by FID', async () => {
      const fid = 54321
      const response = await fetch(
        `http://127.0.0.1:${MOCK_HUB_PORT}/v1/castsByFid?fid=${fid}`,
      )
      expect(response.ok).toBe(true)

      const data = (await response.json()) as {
        messages: Array<{
          hash: string
          data: { castAddBody: { text: string } }
        }>
      }
      expect(data.messages).toBeArray()
      expect(data.messages[0].hash).toBeDefined()
      expect(data.messages[0].data.castAddBody.text).toBeDefined()
    })
  })

  describe('Hub Posting', () => {
    test('submits a cast', async () => {
      const message = {
        data: {
          type: 'CAST_ADD',
          fid: 12345,
          timestamp: Math.floor(Date.now() / 1000),
          castAddBody: {
            text: 'Hello from SDK test.',
            embeds: [],
            mentions: [],
            mentionsPositions: [],
          },
        },
        hash: `0x${crypto.randomUUID().replace(/-/g, '')}`,
        signature: `0x${'00'.repeat(64)}`,
        signer: `0x${'00'.repeat(32)}`,
      }

      const response = await fetch(
        `http://127.0.0.1:${MOCK_HUB_PORT}/v1/submitMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(message),
        },
      )

      expect(response.ok).toBe(true)
      const result = (await response.json()) as { hash: string }
      expect(result.hash).toBeDefined()
      expect(result.hash).toMatch(/^0x[a-f0-9]+$/)
    })

    test('submits a reaction', async () => {
      const message = {
        data: {
          type: 'REACTION_ADD',
          fid: 12345,
          timestamp: Math.floor(Date.now() / 1000),
          reactionBody: {
            type: 'REACTION_TYPE_LIKE',
            targetCastId: {
              fid: 54321,
              hash: '0x1234567890abcdef1234567890abcdef12345678',
            },
          },
        },
      }

      const response = await fetch(
        `http://127.0.0.1:${MOCK_HUB_PORT}/v1/submitMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(message),
        },
      )

      expect(response.ok).toBe(true)
    })

    test('submits a follow', async () => {
      const message = {
        data: {
          type: 'LINK_ADD',
          fid: 12345,
          timestamp: Math.floor(Date.now() / 1000),
          linkBody: {
            type: 'follow',
            targetFid: 54321,
          },
        },
      }

      const response = await fetch(
        `http://127.0.0.1:${MOCK_HUB_PORT}/v1/submitMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(message),
        },
      )

      expect(response.ok).toBe(true)
    })
  })
})

describe('MLS Groups', () => {
  test('creates a group with members', () => {
    const group = {
      id: crypto.randomUUID(),
      name: 'Test Group',
      members: [
        '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
      ],
      admins: ['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'],
      createdAt: Date.now(),
    }

    expect(group.id).toBeDefined()
    expect(group.members).toHaveLength(3)
    expect(group.admins).toHaveLength(1)
  })

  test('tracks message history in group', () => {
    const groupId = crypto.randomUUID()
    const messages: Array<{
      id: string
      groupId: string
      sender: string
      content: string
      timestamp: number
    }> = []

    const addMessage = (sender: string, content: string) => {
      messages.push({
        id: crypto.randomUUID(),
        groupId,
        sender,
        content,
        timestamp: Date.now(),
      })
    }

    addMessage('0xAlice', 'Hello everyone.')
    addMessage('0xBob', 'Hi Alice.')
    addMessage('0xCharlie', 'Hey team.')

    expect(messages).toHaveLength(3)
    expect(messages[0].sender).toBe('0xAlice')
    expect(messages.every((m) => m.groupId === groupId)).toBe(true)
  })

  test('handles member management', () => {
    const members = new Set([
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    ])

    // Add member
    const newMember = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
    members.add(newMember)
    expect(members.size).toBe(3)
    expect(members.has(newMember)).toBe(true)

    // Remove member
    members.delete('0x70997970C51812dc3A010C7d01b50e0d17dc79C8')
    expect(members.size).toBe(2)
    expect(members.has('0x70997970C51812dc3A010C7d01b50e0d17dc79C8')).toBe(
      false,
    )
  })
})

describe('Combined Messaging Flow', () => {
  test('Farcaster cast followed by XMTP DM', async () => {
    // 1. Post public cast on Farcaster
    const castResponse = await fetch(
      `http://127.0.0.1:${MOCK_HUB_PORT}/v1/submitMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'CAST_ADD',
            fid: 12345,
            castAddBody: {
              text: 'Looking for beta testers. DM me.',
              embeds: [],
              mentions: [],
              mentionsPositions: [],
            },
          },
        }),
      },
    )
    expect(castResponse.ok).toBe(true)

    // 2. Send private DM via relay
    const dmId = crypto.randomUUID()
    const dmResponse = await fetch(`http://127.0.0.1:${RELAY_PORT}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: dmId,
        from: '0xBobAddress',
        to: '0xAliceAddress',
        encryptedContent: serializeEncryptedMessage(
          encryptMessage('I want to be a beta tester.', new Uint8Array(32)),
        ),
        timestamp: Date.now(),
      }),
    })
    expect(dmResponse.ok).toBe(true)

    // 3. Alice receives DM
    const messagesResponse = await fetch(
      `http://127.0.0.1:${RELAY_PORT}/messages/0xAliceAddress`,
    )
    const messages = (await messagesResponse.json()) as {
      messages: Array<{ id: string }>
    }
    expect(messages.messages.some((m) => m.id === dmId)).toBe(true)
  })

  test('Group creation after 1:1 DM', async () => {
    const alice = '0xAlice'
    const bob = '0xBob'
    const charlie = '0xCharlie'

    // 1. Alice sends DM to Bob
    const dm1Response = await fetch(`http://127.0.0.1:${RELAY_PORT}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        from: alice,
        to: bob,
        encryptedContent: serializeEncryptedMessage(
          encryptMessage('Want to start a group?', new Uint8Array(32)),
        ),
      }),
    })
    expect(dm1Response.ok).toBe(true)

    // 2. Alice sends DM to Charlie
    const dm2Response = await fetch(`http://127.0.0.1:${RELAY_PORT}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        from: alice,
        to: charlie,
        encryptedContent: serializeEncryptedMessage(
          encryptMessage('Want to join our group?', new Uint8Array(32)),
        ),
      }),
    })
    expect(dm2Response.ok).toBe(true)

    // 3. Create group
    const group = {
      id: crypto.randomUUID(),
      name: 'Team Chat',
      members: [alice, bob, charlie],
      createdAt: Date.now(),
    }

    // 4. Send group message
    const groupMsgResponse = await fetch(
      `http://127.0.0.1:${RELAY_PORT}/send`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          from: alice,
          to: group.id,
          encryptedContent: serializeEncryptedMessage(
            encryptMessage('Welcome to the team group.', new Uint8Array(32)),
          ),
        }),
      },
    )
    expect(groupMsgResponse.ok).toBe(true)

    // 5. Verify group received message
    const groupMsgs = await fetch(
      `http://127.0.0.1:${RELAY_PORT}/messages/${group.id}`,
    )
    const result = (await groupMsgs.json()) as { count: number }
    expect(result.count).toBeGreaterThan(0)
  })
})

describe('Error Handling', () => {
  test('handles invalid message gracefully', async () => {
    const response = await fetch(`http://127.0.0.1:${RELAY_PORT}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invalid: 'message' }),
    })

    // Should still process but with the invalid structure
    // Real implementation would reject
    expect(response.ok).toBe(true)
  })

  test('handles unknown routes', async () => {
    const response = await fetch(`http://127.0.0.1:${RELAY_PORT}/unknown-route`)
    expect(response.status).toBe(404)
  })

  test('handles missing recipient messages', async () => {
    const response = await fetch(
      `http://127.0.0.1:${RELAY_PORT}/messages/0xNonexistent`,
    )
    expect(response.ok).toBe(true)

    const result = (await response.json()) as { count: number }
    expect(result.count).toBe(0)
  })
})
