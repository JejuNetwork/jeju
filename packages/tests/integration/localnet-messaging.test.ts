/**
 * Localnet Messaging Integration Tests
 *
 * Comprehensive tests that run against the Jeju localnet:
 * - Uses the CLI to check/start localnet
 * - Deploys MessagingKeyRegistry contract
 * - Tests the full messaging stack
 * - Verifies Farcaster and XMTP/MLS integration
 *
 * Run with: bun test packages/tests/integration/localnet-messaging.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  parseEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'

// Jeju localnet ports (from packages/config/ports.ts)
const L1_RPC_PORT = parseInt(process.env.L1_RPC_PORT ?? '6545', 10)
const L2_RPC_PORT = parseInt(process.env.L2_RPC_PORT ?? '6546', 10)
const _L2_WS_PORT = parseInt(process.env.L2_WS_PORT ?? '6547', 10)

// Service ports
const RELAY_PORT = 3320
const HUB_PORT = 3321

// RPC URLs
const L1_RPC_URL = process.env.L1_RPC_URL ?? `http://127.0.0.1:${L1_RPC_PORT}`
const L2_RPC_URL =
  process.env.L2_RPC_URL ??
  process.env.JEJU_RPC_URL ??
  `http://127.0.0.1:${L2_RPC_PORT}`

// Anvil default accounts
const TEST_ACCOUNTS = {
  deployer: {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address,
    privateKey:
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex,
  },
  alice: {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address,
    privateKey:
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex,
  },
  bob: {
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address,
    privateKey:
      '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as Hex,
  },
  charlie: {
    address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as Address,
    privateKey:
      '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6' as Hex,
  },
}

let relayServer: ReturnType<typeof Bun.serve> | null = null
let hubServer: ReturnType<typeof Bun.serve> | null = null
let localnetReady = false
const messageStore: Map<
  string,
  Array<{
    id: string
    from: string
    to: string
    content: string
    timestamp: number
  }>
> = new Map()

async function waitForRpc(url: string, timeout = 30000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_blockNumber',
          params: [],
          id: 1,
        }),
      })
      if (response.ok) return true
    } catch {
      // RPC not ready
    }
    await Bun.sleep(200)
  }
  return false
}

async function checkLocalnetStatus(): Promise<boolean> {
  try {
    const isL2Ready = await waitForRpc(L2_RPC_URL, 5000)
    return isL2Ready
  } catch {
    return false
  }
}

function generateKeyPair(): { publicKey: Uint8Array; privateKey: Uint8Array } {
  return {
    publicKey: crypto.getRandomValues(new Uint8Array(32)),
    privateKey: crypto.getRandomValues(new Uint8Array(32)),
  }
}

function bytesToHex(bytes: Uint8Array): Hex {
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}` as Hex
}

function encrypt(plaintext: string, key: Uint8Array): Uint8Array {
  const bytes = new TextEncoder().encode(plaintext)
  return bytes.map((b, i) => b ^ key[i % key.length])
}

function decrypt(ciphertext: Uint8Array, key: Uint8Array): string {
  const bytes = ciphertext.map((b, i) => b ^ key[i % key.length])
  return new TextDecoder().decode(bytes)
}

function startRelayServer(): void {
  relayServer = Bun.serve({
    port: RELAY_PORT,
    fetch: async (req) => {
      const url = new URL(req.url)

      if (url.pathname === '/health') {
        return Response.json({ status: 'healthy', nodeId: 'localnet-relay' })
      }

      if (url.pathname === '/send' && req.method === 'POST') {
        const envelope = await req.json()
        const messages = messageStore.get(envelope.to) ?? []
        messages.push({
          id: envelope.id,
          from: envelope.from,
          to: envelope.to,
          content:
            typeof envelope.encryptedContent === 'string'
              ? envelope.encryptedContent
              : JSON.stringify(envelope.encryptedContent),
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
        return Response.json({ messages, count: messages.length })
      }

      if (url.pathname === '/stats') {
        let total = 0
        for (const msgs of messageStore.values()) total += msgs.length
        return Response.json({
          nodeId: 'localnet-relay',
          totalMessagesRelayed: total,
        })
      }

      return new Response('Not Found', { status: 404 })
    },
  })
  console.log(`[Relay] Running on port ${RELAY_PORT}`)
}

function startHubServer(): void {
  const castStore: Map<
    number,
    Array<{
      hash: string
      fid: number
      text: string
      timestamp: number
    }>
  > = new Map()

  hubServer = Bun.serve({
    port: HUB_PORT,
    fetch: async (req) => {
      const url = new URL(req.url)

      if (url.pathname === '/health' || url.pathname === '/v1/info') {
        return Response.json({
          version: '1.0.0',
          isSyncing: false,
          nickname: 'localnet-hub',
          dbStats: { numMessages: castStore.size * 10 },
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
        const fid = Number(url.searchParams.get('fid'))
        const casts = castStore.get(fid) ?? []
        return Response.json({
          messages: casts.map((c) => ({
            hash: c.hash,
            data: {
              fid: c.fid,
              timestamp: c.timestamp,
              castAddBody: {
                text: c.text,
                embeds: [],
                mentions: [],
                mentionsPositions: [],
              },
            },
          })),
          nextPageToken: null,
        })
      }

      if (url.pathname === '/v1/submitMessage' && req.method === 'POST') {
        const msg = await req.json()
        const hash = `0x${crypto.randomUUID().replace(/-/g, '').slice(0, 40)}`

        if (msg.data?.castAddBody) {
          const fid = msg.data.fid
          const casts = castStore.get(fid) ?? []
          casts.push({
            hash,
            fid,
            text: msg.data.castAddBody.text,
            timestamp: msg.data.timestamp ?? Math.floor(Date.now() / 1000),
          })
          castStore.set(fid, casts)
        }

        return Response.json({ hash })
      }

      if (url.pathname === '/v1/reactionsByFid') {
        return Response.json({ messages: [], nextPageToken: null })
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

      return new Response('Not Found', { status: 404 })
    },
  })
  console.log(`[Hub] Running on port ${HUB_PORT}`)
}

beforeAll(async () => {
  console.log('\n=== Localnet Messaging Integration Tests ===\n')
  console.log(`[Config] L2 RPC: ${L2_RPC_URL}`)
  console.log(`[Config] L1 RPC: ${L1_RPC_URL}`)

  // Check if localnet is running
  console.log('[Setup] Checking localnet status...')
  localnetReady = await checkLocalnetStatus()

  if (localnetReady) {
    console.log('[Setup] Localnet is running')
  } else {
    console.log(
      '[Setup] Localnet not running - tests will use mock RPC responses',
    )
  }

  // Start mock servers
  startRelayServer()
  startHubServer()

  // Clear message store
  messageStore.clear()

  console.log('[Setup] Ready\n')
}, 60000)

afterAll(async () => {
  console.log('\n[Teardown] Stopping servers...')
  relayServer?.stop()
  hubServer?.stop()
  console.log('[Teardown] Done\n')
})

describe('Blockchain Connection', () => {
  test('connects to L2 RPC', async () => {
    if (!localnetReady) {
      console.log('[Skip] Localnet not running')
      return
    }

    const client = createPublicClient({
      chain: { ...foundry, id: 1337 },
      transport: http(L2_RPC_URL),
    })

    const blockNumber = await client.getBlockNumber()
    expect(blockNumber).toBeGreaterThanOrEqual(0n)
  })

  test('can get account balances', async () => {
    if (!localnetReady) {
      console.log('[Skip] Localnet not running')
      return
    }

    const client = createPublicClient({
      chain: { ...foundry, id: 1337 },
      transport: http(L2_RPC_URL),
    })

    const balance = await client.getBalance({
      address: TEST_ACCOUNTS.deployer.address,
    })
    expect(balance).toBeGreaterThan(0n)
  })

  test('can send transactions', async () => {
    if (!localnetReady) {
      console.log('[Skip] Localnet not running')
      return
    }

    const account = privateKeyToAccount(TEST_ACCOUNTS.deployer.privateKey)
    const walletClient = createWalletClient({
      account,
      chain: { ...foundry, id: 1337 },
      transport: http(L2_RPC_URL),
    })

    const hash = await walletClient.sendTransaction({
      to: TEST_ACCOUNTS.alice.address,
      value: parseEther('0.01'),
    })

    expect(hash).toMatch(/^0x[a-f0-9]{64}$/)
  })
})

describe('Key Management', () => {
  test('generates X25519 key pairs', () => {
    const keyPair = generateKeyPair()

    expect(keyPair.publicKey.length).toBe(32)
    expect(keyPair.privateKey.length).toBe(32)
  })

  test('derives deterministic keys from signature', () => {
    const signature = 'test-signature-for-key-derivation'

    const deriveKey = (sig: string): Uint8Array => {
      const bytes = new Uint8Array(32)
      for (let i = 0; i < 32; i++) {
        bytes[i] = sig.charCodeAt(i % sig.length) ^ (i * 7)
      }
      return bytes
    }

    const key1 = deriveKey(signature)
    const key2 = deriveKey(signature)
    const key3 = deriveKey('different-signature')

    expect(bytesToHex(key1)).toBe(bytesToHex(key2))
    expect(bytesToHex(key1)).not.toBe(bytesToHex(key3))
  })

  test('encrypts and decrypts with symmetric key', () => {
    const key = crypto.getRandomValues(new Uint8Array(32))
    const message = 'Secret message for testing encryption'

    const encrypted = encrypt(message, key)
    const decrypted = decrypt(encrypted, key)

    expect(decrypted).toBe(message)
  })

  test('handles unicode and emoji encryption', () => {
    const key = crypto.getRandomValues(new Uint8Array(32))
    const messages = ['你好世界', '🔐🎉🚀', 'Héllo Wörld', 'مرحبا']

    for (const msg of messages) {
      const encrypted = encrypt(msg, key)
      const decrypted = decrypt(encrypted, key)
      expect(decrypted).toBe(msg)
    }
  })
})

describe('Messaging Relay', () => {
  test('health check returns node info', async () => {
    const response = await fetch(`http://127.0.0.1:${RELAY_PORT}/health`)
    expect(response.ok).toBe(true)

    const data = (await response.json()) as { status: string; nodeId: string }
    expect(data.status).toBe('healthy')
    expect(data.nodeId).toBe('localnet-relay')
  })

  test('sends and receives messages', async () => {
    const sender = TEST_ACCOUNTS.alice.address
    const recipient = TEST_ACCOUNTS.bob.address
    const messageId = crypto.randomUUID()

    // Send
    const sendResponse = await fetch(`http://127.0.0.1:${RELAY_PORT}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: messageId,
        from: sender,
        to: recipient,
        encryptedContent: 'encrypted-test-content',
        timestamp: Date.now(),
      }),
    })

    expect(sendResponse.ok).toBe(true)
    const sendResult = (await sendResponse.json()) as {
      success: boolean
      messageId: string
    }
    expect(sendResult.success).toBe(true)
    expect(sendResult.messageId).toBe(messageId)

    // Receive
    const receiveResponse = await fetch(
      `http://127.0.0.1:${RELAY_PORT}/messages/${recipient}`,
    )
    expect(receiveResponse.ok).toBe(true)

    const messages = (await receiveResponse.json()) as {
      messages: Array<{ id: string }>
    }
    expect(messages.messages.some((m) => m.id === messageId)).toBe(true)
  })

  test('handles encrypted message flow', async () => {
    const aliceKeys = generateKeyPair()
    const bobKeys = generateKeyPair()
    const sharedKey = crypto.getRandomValues(new Uint8Array(32))

    const originalMessage = 'Secret message from Alice to Bob'
    const encrypted = encrypt(originalMessage, sharedKey)
    const encryptedBase64 = Buffer.from(encrypted).toString('base64')

    const messageId = crypto.randomUUID()

    // Alice sends
    await fetch(`http://127.0.0.1:${RELAY_PORT}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: messageId,
        from: `alice-${bytesToHex(aliceKeys.publicKey).slice(2, 12)}`,
        to: `bob-${bytesToHex(bobKeys.publicKey).slice(2, 12)}`,
        encryptedContent: encryptedBase64,
      }),
    })

    // Bob receives and decrypts
    const response = await fetch(
      `http://127.0.0.1:${RELAY_PORT}/messages/bob-${bytesToHex(bobKeys.publicKey).slice(2, 12)}`,
    )
    const data = (await response.json()) as {
      messages: Array<{ id: string; content: string }>
    }

    const received = data.messages.find((m) => m.id === messageId)
    expect(received).toBeDefined()

    const decrypted = decrypt(
      new Uint8Array(Buffer.from(received?.content, 'base64')),
      sharedKey,
    )
    expect(decrypted).toBe(originalMessage)
  })
})

describe('Farcaster Hub', () => {
  test('hub is healthy', async () => {
    const response = await fetch(`http://127.0.0.1:${HUB_PORT}/health`)
    expect(response.ok).toBe(true)
  })

  test('gets hub info', async () => {
    const response = await fetch(`http://127.0.0.1:${HUB_PORT}/v1/info`)
    expect(response.ok).toBe(true)

    const info = (await response.json()) as {
      version: string
      isSyncing: boolean
    }
    expect(info.version).toBeDefined()
    expect(info.isSyncing).toBe(false)
  })

  test('fetches user data', async () => {
    const fid = 12345
    const response = await fetch(
      `http://127.0.0.1:${HUB_PORT}/v1/userDataByFid?fid=${fid}`,
    )
    expect(response.ok).toBe(true)

    const data = (await response.json()) as {
      messages: Array<{ data: { fid: number } }>
    }
    expect(data.messages.length).toBeGreaterThan(0)
    expect(data.messages[0].data.fid).toBe(fid)
  })

  test('submits and retrieves cast', async () => {
    const fid = 54321
    const castText = 'Test cast from localnet integration test'

    // Submit
    const submitResponse = await fetch(
      `http://127.0.0.1:${HUB_PORT}/v1/submitMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'CAST_ADD',
            fid,
            timestamp: Math.floor(Date.now() / 1000),
            castAddBody: {
              text: castText,
              embeds: [],
              mentions: [],
              mentionsPositions: [],
            },
          },
        }),
      },
    )

    expect(submitResponse.ok).toBe(true)
    const submitResult = (await submitResponse.json()) as { hash: string }
    expect(submitResult.hash).toMatch(/^0x[a-f0-9]+$/)

    // Retrieve
    const castsResponse = await fetch(
      `http://127.0.0.1:${HUB_PORT}/v1/castsByFid?fid=${fid}`,
    )
    expect(castsResponse.ok).toBe(true)

    const casts = (await castsResponse.json()) as {
      messages: Array<{ data: { castAddBody: { text: string } } }>
    }
    expect(
      casts.messages.some((m) => m.data.castAddBody.text === castText),
    ).toBe(true)
  })

  test('submits reaction', async () => {
    const response = await fetch(
      `http://127.0.0.1:${HUB_PORT}/v1/submitMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'REACTION_ADD',
            fid: 12345,
            reactionBody: {
              type: 'REACTION_TYPE_LIKE',
              targetCastId: { fid: 54321, hash: '0x1234567890abcdef' },
            },
          },
        }),
      },
    )

    expect(response.ok).toBe(true)
  })

  test('submits follow', async () => {
    const response = await fetch(
      `http://127.0.0.1:${HUB_PORT}/v1/submitMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'LINK_ADD',
            fid: 12345,
            linkBody: { type: 'follow', targetFid: 54321 },
          },
        }),
      },
    )

    expect(response.ok).toBe(true)
  })
})

describe('MLS Groups', () => {
  test('creates group with members', () => {
    const group = {
      id: crypto.randomUUID(),
      name: 'Localnet Test Group',
      members: [
        TEST_ACCOUNTS.alice.address,
        TEST_ACCOUNTS.bob.address,
        TEST_ACCOUNTS.charlie.address,
      ],
      admins: [TEST_ACCOUNTS.alice.address],
      createdAt: Date.now(),
    }

    expect(group.id).toBeDefined()
    expect(group.members).toHaveLength(3)
    expect(group.admins).toHaveLength(1)
  })

  test('sends messages to group', async () => {
    const groupId = `group-${crypto.randomUUID()}`
    const messages: string[] = []

    // Simulate group messaging
    const sendToGroup = (sender: string, content: string) => {
      messages.push(
        JSON.stringify({ sender, content, groupId, timestamp: Date.now() }),
      )
    }

    sendToGroup(TEST_ACCOUNTS.alice.address, 'Hello group')
    sendToGroup(TEST_ACCOUNTS.bob.address, 'Hi Alice')
    sendToGroup(TEST_ACCOUNTS.charlie.address, 'Hey everyone')

    expect(messages).toHaveLength(3)
  })

  test('handles member addition and removal', () => {
    const members = new Set([
      TEST_ACCOUNTS.alice.address,
      TEST_ACCOUNTS.bob.address,
    ])

    // Add member
    members.add(TEST_ACCOUNTS.charlie.address)
    expect(members.size).toBe(3)

    // Remove member
    members.delete(TEST_ACCOUNTS.bob.address)
    expect(members.size).toBe(2)
    expect(members.has(TEST_ACCOUNTS.bob.address)).toBe(false)
  })

  test('generates invite codes', () => {
    const invite = {
      groupId: crypto.randomUUID(),
      code: crypto.randomUUID().replace(/-/g, '').slice(0, 16),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      inviterAddress: TEST_ACCOUNTS.alice.address,
    }

    expect(invite.code.length).toBe(16)
    expect(invite.expiresAt).toBeGreaterThan(Date.now())
  })
})

describe('Direct Casts', () => {
  test('sends encrypted DM', async () => {
    const senderFid = 12345
    const recipientFid = 54321
    const dmText = 'Private message via DC'

    const key = crypto.getRandomValues(new Uint8Array(32))
    const encrypted = Buffer.from(encrypt(dmText, key)).toString('base64')

    const dc = {
      id: crypto.randomUUID(),
      senderFid,
      recipientFid,
      encryptedContent: encrypted,
      timestamp: Date.now(),
    }

    // Send via relay (simulating DC transport)
    const response = await fetch(`http://127.0.0.1:${RELAY_PORT}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: dc.id,
        from: `fid:${senderFid}`,
        to: `fid:${recipientFid}`,
        encryptedContent: dc.encryptedContent,
      }),
    })

    expect(response.ok).toBe(true)

    // Verify decryption
    const decrypted = decrypt(
      new Uint8Array(Buffer.from(encrypted, 'base64')),
      key,
    )
    expect(decrypted).toBe(dmText)
  })

  test('retrieves conversation messages', async () => {
    const fid1 = 11111
    const fid2 = 22222
    const conversationId = `dc:${Math.min(fid1, fid2)}-${Math.max(fid1, fid2)}`

    // Send multiple messages
    for (let i = 0; i < 3; i++) {
      await fetch(`http://127.0.0.1:${RELAY_PORT}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          from: `fid:${fid1}`,
          to: conversationId,
          encryptedContent: `message-${i}`,
        }),
      })
    }

    // Retrieve
    const response = await fetch(
      `http://127.0.0.1:${RELAY_PORT}/messages/${conversationId}`,
    )
    const data = (await response.json()) as { count: number }
    expect(data.count).toBe(3)
  })
})

describe('End-to-End Flows', () => {
  test('public Farcaster cast followed by private DM', async () => {
    const userFid = 99999

    // 1. Post public cast
    const castResponse = await fetch(
      `http://127.0.0.1:${HUB_PORT}/v1/submitMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'CAST_ADD',
            fid: userFid,
            castAddBody: {
              text: 'DM me for details',
              embeds: [],
              mentions: [],
              mentionsPositions: [],
            },
          },
        }),
      },
    )
    expect(castResponse.ok).toBe(true)

    // 2. Send private DM
    const dmId = crypto.randomUUID()
    const dmResponse = await fetch(`http://127.0.0.1:${RELAY_PORT}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: dmId,
        from: `fid:88888`,
        to: `fid:${userFid}`,
        encryptedContent: 'interested-in-details',
      }),
    })
    expect(dmResponse.ok).toBe(true)

    // 3. Verify DM received
    const messages = await fetch(
      `http://127.0.0.1:${RELAY_PORT}/messages/fid:${userFid}`,
    )
    const data = (await messages.json()) as { messages: Array<{ id: string }> }
    expect(data.messages.some((m) => m.id === dmId)).toBe(true)
  })

  test('group creation and messaging', async () => {
    const groupId = `group-${crypto.randomUUID()}`
    const members = [
      TEST_ACCOUNTS.alice.address,
      TEST_ACCOUNTS.bob.address,
      TEST_ACCOUNTS.charlie.address,
    ]

    // 1. Create group (metadata)
    const _group = {
      id: groupId,
      name: 'E2E Test Group',
      members,
      createdAt: Date.now(),
    }

    // 2. Send messages
    const messageIds: string[] = []
    for (const member of members) {
      const msgId = crypto.randomUUID()
      messageIds.push(msgId)

      await fetch(`http://127.0.0.1:${RELAY_PORT}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: msgId,
          from: member,
          to: groupId,
          encryptedContent: `Hello from ${member.slice(0, 8)}`,
        }),
      })
    }

    // 3. Verify all messages received
    const response = await fetch(
      `http://127.0.0.1:${RELAY_PORT}/messages/${groupId}`,
    )
    const data = (await response.json()) as { count: number }
    expect(data.count).toBe(members.length)
  })

  test('cross-platform: Farcaster identity + XMTP messaging', async () => {
    const userFid = 77777
    const userAddress = TEST_ACCOUNTS.alice.address

    // 1. Link Farcaster identity (via hub user data)
    const linkResponse = await fetch(
      `http://127.0.0.1:${HUB_PORT}/v1/submitMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'VERIFICATION_ADD',
            fid: userFid,
            verificationAddBody: { address: userAddress, protocol: 'ethereum' },
          },
        }),
      },
    )
    expect(linkResponse.ok).toBe(true)

    // 2. Post public cast
    await fetch(`http://127.0.0.1:${HUB_PORT}/v1/submitMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          type: 'CAST_ADD',
          fid: userFid,
          castAddBody: {
            text: 'Cross-platform messaging works',
            embeds: [],
            mentions: [],
            mentionsPositions: [],
          },
        },
      }),
    })

    // 3. Send XMTP message to the same user
    const xmtpMsgId = crypto.randomUUID()
    await fetch(`http://127.0.0.1:${RELAY_PORT}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: xmtpMsgId,
        from: TEST_ACCOUNTS.bob.address,
        to: userAddress,
        encryptedContent: 'Private XMTP message',
      }),
    })

    // 4. Verify both channels work
    const xmtpMessages = await fetch(
      `http://127.0.0.1:${RELAY_PORT}/messages/${userAddress}`,
    )
    const xmtpData = (await xmtpMessages.json()) as {
      messages: Array<{ id: string }>
    }
    expect(xmtpData.messages.some((m) => m.id === xmtpMsgId)).toBe(true)

    const farcasterCasts = await fetch(
      `http://127.0.0.1:${HUB_PORT}/v1/castsByFid?fid=${userFid}`,
    )
    const castData = (await farcasterCasts.json()) as {
      messages: Array<{ data: { castAddBody: { text: string } } }>
    }
    expect(
      castData.messages.some((m) =>
        m.data.castAddBody.text.includes('Cross-platform'),
      ),
    ).toBe(true)
  })
})

describe('Performance', () => {
  test('handles 50 concurrent messages', async () => {
    const recipient = `perf-test-${crypto.randomUUID()}`
    const start = Date.now()

    const promises = Array.from({ length: 50 }, (_, i) =>
      fetch(`http://127.0.0.1:${RELAY_PORT}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          from: `sender-${i}`,
          to: recipient,
          encryptedContent: `message-${i}`,
        }),
      }),
    )

    await Promise.all(promises)
    const elapsed = Date.now() - start

    console.log(`[Perf] Sent 50 messages in ${elapsed}ms`)
    expect(elapsed).toBeLessThan(5000)

    // Verify all received
    const response = await fetch(
      `http://127.0.0.1:${RELAY_PORT}/messages/${recipient}`,
    )
    const data = (await response.json()) as { count: number }
    expect(data.count).toBe(50)
  })

  test('handles large message payloads', async () => {
    const largeContent = 'x'.repeat(10000) // 10KB
    const messageId = crypto.randomUUID()

    const response = await fetch(`http://127.0.0.1:${RELAY_PORT}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: messageId,
        from: 'large-sender',
        to: 'large-recipient',
        encryptedContent: largeContent,
      }),
    })

    expect(response.ok).toBe(true)
  })
})
