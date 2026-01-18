/**
 * SQLit Database Tests
 *
 * Tests the CrucibleDatabase class for agent, room, and message operations.
 * Requires SQLit adapter to be running on port 8546.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { CrucibleDatabase } from '../../api/sdk/database'

// Try embedded SQLit (port 8546) first, then standalone (port 4661)
const SQLIT_URL = process.env.SQLIT_URL ?? 'http://127.0.0.1:8546'

describe('CrucibleDatabase', () => {
  let db: CrucibleDatabase

  beforeAll(async () => {
    db = new CrucibleDatabase({
      endpoint: SQLIT_URL,
      database: 'crucible_test',
    })

    // Try to connect - skip tests if SQLit not available
    const connected = await db.connect()
    if (!connected) {
      console.warn('SQLit not available - skipping database tests')
    }
  })

  afterAll(async () => {
    // Clean up test data
    if (db.isConnected) {
      await db.exec('DELETE FROM messages WHERE room_id LIKE ?', ['test-%'])
      await db.exec('DELETE FROM rooms WHERE room_id LIKE ?', ['test-%'])
      await db.exec('DELETE FROM agents WHERE agent_id LIKE ?', ['test-%'])
    }
  })

  describe('Agent Operations', () => {
    test('should create an agent', async () => {
      if (!db.isConnected) return

      const agent = await db.createAgent({
        agentId: `test-agent-${Date.now()}`,
        name: 'Test Agent',
        owner: '0x1234567890abcdef1234567890abcdef12345678',
      })

      expect(agent).toBeTruthy()
      expect(agent?.name).toBe('Test Agent')
      expect(agent?.owner).toBe('0x1234567890abcdef1234567890abcdef12345678')
    })

    test('should get an agent by ID', async () => {
      if (!db.isConnected) return

      const agentId = `test-agent-get-${Date.now()}`
      await db.createAgent({
        agentId,
        name: 'Get Test Agent',
        owner: '0xtest',
      })

      const agent = await db.getAgent(agentId)
      expect(agent).toBeTruthy()
      expect(agent?.agent_id).toBe(agentId)
      expect(agent?.name).toBe('Get Test Agent')
    })

    test('should update an agent', async () => {
      if (!db.isConnected) return

      const agentId = `test-agent-update-${Date.now()}`
      await db.createAgent({
        agentId,
        name: 'Original Name',
        owner: '0xtest',
      })

      await db.updateAgent(agentId, { name: 'Updated Name' })

      const agent = await db.getAgent(agentId)
      expect(agent?.name).toBe('Updated Name')
    })

    test('should list agents', async () => {
      if (!db.isConnected) return

      const agents = await db.listAgents({ limit: 10 })
      expect(Array.isArray(agents)).toBe(true)
    })
  })

  describe('Room Operations', () => {
    test('should create a room', async () => {
      if (!db.isConnected) return

      const room = await db.createRoom({
        roomId: `test-room-${Date.now()}`,
        name: 'Test Room',
        roomType: 'chat',
      })

      expect(room).toBeTruthy()
      expect(room?.name).toBe('Test Room')
      expect(room?.room_type).toBe('chat')
    })

    test('should get a room by ID', async () => {
      if (!db.isConnected) return

      const roomId = `test-room-get-${Date.now()}`
      await db.createRoom({
        roomId,
        name: 'Get Test Room',
      })

      const room = await db.getRoom(roomId)
      expect(room).toBeTruthy()
      expect(room?.room_id).toBe(roomId)
    })

    test('should list rooms', async () => {
      if (!db.isConnected) return

      const rooms = await db.listRooms(10)
      expect(Array.isArray(rooms)).toBe(true)
    })
  })

  describe('Message Operations', () => {
    test('should create a message', async () => {
      if (!db.isConnected) return

      const roomId = `test-room-msg-${Date.now()}`
      await db.createRoom({ roomId, name: 'Message Test Room' })

      const message = await db.createMessage({
        roomId,
        agentId: 'test-agent',
        content: 'Hello, world!',
      })

      expect(message).toBeTruthy()
      expect(message?.content).toBe('Hello, world!')
      expect(message?.room_id).toBe(roomId)
    })

    test('should get messages for a room', async () => {
      if (!db.isConnected) return

      const roomId = `test-room-msgs-${Date.now()}`
      await db.createRoom({ roomId, name: 'Messages Test Room' })

      await db.createMessage({
        roomId,
        agentId: 'test-agent',
        content: 'Message 1',
      })
      await db.createMessage({
        roomId,
        agentId: 'test-agent',
        content: 'Message 2',
      })

      const messages = await db.getMessages(roomId, { limit: 10 })
      expect(messages.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Connection Handling', () => {
    test('should handle connection status', async () => {
      const newDb = new CrucibleDatabase({
        endpoint: SQLIT_URL,
        database: 'crucible_conn_test',
      })

      // Before connect, not connected
      expect(newDb.isConnected).toBe(false)

      // After connect, should be connected (if SQLit is running)
      const connected = await newDb.connect()
      if (connected) {
        expect(newDb.isConnected).toBe(true)
      }
    })

    test('should handle unavailable SQLit gracefully', async () => {
      const badDb = new CrucibleDatabase({
        endpoint: 'http://127.0.0.1:59999', // Non-existent port
        database: 'test',
        timeout: 1000,
      })

      const connected = await badDb.connect()
      expect(connected).toBe(false)
      expect(badDb.isConnected).toBe(false)
    })
  })
})
