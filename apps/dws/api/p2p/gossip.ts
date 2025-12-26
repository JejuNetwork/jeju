/**
 * GossipSub Protocol
 *
 * Implements pub/sub messaging for state propagation across the network.
 * Used for:
 * - Node status updates
 * - Cache invalidation
 * - Block/blob announcements
 * - Service discovery updates
 */

import { keccak256, toBytes } from 'viem'

// ============================================================================
// Types
// ============================================================================

export interface GossipConfig {
  peerId: string
  topics: string[]
  maxMessageSize: number
  heartbeatInterval: number
  fanout: number
  gossipFactor: number
  seenTtl: number
}

export interface GossipMessage {
  id: string
  topic: string
  from: string
  data: Uint8Array
  timestamp: number
  seqno: number
  signature?: string
}

interface TopicState {
  peers: Set<string>
  mesh: Set<string>
  fanout: Set<string>
  lastPublish: number
}

interface PeerScore {
  peerId: string
  score: number
  topicScores: Map<string, number>
  deliveryRate: number
  duplicateRate: number
  invalidRate: number
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: GossipConfig = {
  peerId: '',
  topics: [],
  maxMessageSize: 1024 * 1024, // 1MB
  heartbeatInterval: 1000,
  fanout: 6,
  gossipFactor: 0.25,
  seenTtl: 120000, // 2 minutes
}

const D = 6 // Target mesh degree
const D_LOW = 4 // Low watermark
const D_HIGH = 12 // High watermark
const D_LAZY = 6 // Lazy (gossip) degree

// ============================================================================
// GossipSub Implementation
// ============================================================================

export class GossipProtocol {
  private config: GossipConfig
  private topics: Map<string, TopicState> = new Map()
  private seenMessages: Map<string, number> = new Map()
  private messageQueue: GossipMessage[] = []
  private peerScores: Map<string, PeerScore> = new Map()
  private seqCounter = 0
  private running = false
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private cleanupInterval: ReturnType<typeof setInterval> | null = null
  private messageHandlers: Map<string, Array<(msg: GossipMessage) => void>> =
    new Map()
  private sendMessage:
    | ((peerId: string, msg: GossipMessage) => Promise<void>)
    | null = null

  constructor(config: Partial<GossipConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Set the message sender function
   */
  setSender(
    sender: (peerId: string, msg: GossipMessage) => Promise<void>,
  ): void {
    this.sendMessage = sender
  }

  /**
   * Start the gossip protocol
   */
  async start(): Promise<void> {
    if (this.running) return

    console.log(`[Gossip] Starting protocol...`)
    this.running = true

    // Initialize topics
    for (const topic of this.config.topics) {
      this.topics.set(topic, {
        peers: new Set(),
        mesh: new Set(),
        fanout: new Set(),
        lastPublish: 0,
      })
    }

    // Start heartbeat
    this.heartbeatInterval = setInterval(() => {
      this.heartbeat()
    }, this.config.heartbeatInterval)

    // Start cleanup
    this.cleanupInterval = setInterval(() => {
      this.cleanupSeenCache()
    }, this.config.seenTtl / 2)

    console.log(
      `[Gossip] Protocol started with ${this.config.topics.length} topics`,
    )
  }

  /**
   * Stop the gossip protocol
   */
  async stop(): Promise<void> {
    if (!this.running) return

    console.log(`[Gossip] Stopping protocol...`)
    this.running = false

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }

    // Leave all topics
    for (const topic of this.topics.keys()) {
      await this.leave(topic)
    }

    console.log(`[Gossip] Protocol stopped`)
  }

  /**
   * Subscribe to a topic
   */
  async join(topic: string): Promise<void> {
    if (!this.topics.has(topic)) {
      this.topics.set(topic, {
        peers: new Set(),
        mesh: new Set(),
        fanout: new Set(),
        lastPublish: 0,
      })
    }

    console.log(`[Gossip] Joined topic: ${topic}`)

    // Build initial mesh from fanout if available
    const state = this.topics.get(topic)
    if (state && state.fanout.size > 0) {
      for (const peer of state.fanout) {
        if (state.mesh.size < D) {
          state.mesh.add(peer)
          await this.graft(peer, topic)
        }
      }
      state.fanout.clear()
    }
  }

  /**
   * Unsubscribe from a topic
   */
  async leave(topic: string): Promise<void> {
    const state = this.topics.get(topic)
    if (!state) return

    // Prune all mesh peers
    for (const peer of state.mesh) {
      await this.prune(peer, topic)
    }

    state.mesh.clear()
    console.log(`[Gossip] Left topic: ${topic}`)
  }

  /**
   * Publish a message to a topic
   */
  async publish(topic: string, data: Uint8Array | string): Promise<string> {
    const state = this.topics.get(topic)
    if (!state) {
      throw new Error(`Not subscribed to topic: ${topic}`)
    }

    const dataBytes =
      typeof data === 'string' ? new TextEncoder().encode(data) : data

    if (dataBytes.length > this.config.maxMessageSize) {
      throw new Error(
        `Message too large: ${dataBytes.length} > ${this.config.maxMessageSize}`,
      )
    }

    const seqno = this.seqCounter++
    const msgId = this.computeMessageId(this.config.peerId, seqno)

    const message: GossipMessage = {
      id: msgId,
      topic,
      from: this.config.peerId,
      data: dataBytes,
      timestamp: Date.now(),
      seqno,
    }

    // Mark as seen
    this.seenMessages.set(msgId, Date.now())

    // Send to mesh peers
    const meshPeers = Array.from(state.mesh)
    await Promise.allSettled(
      meshPeers.map((peer) => this.forwardMessage(peer, message)),
    )

    // If not enough mesh peers, use fanout
    if (meshPeers.length < D) {
      const fanoutPeers = this.selectFanoutPeers(topic, D - meshPeers.length)
      for (const peer of fanoutPeers) {
        state.fanout.add(peer)
      }
      await Promise.allSettled(
        fanoutPeers.map((peer) => this.forwardMessage(peer, message)),
      )
    }

    state.lastPublish = Date.now()
    console.log(`[Gossip] Published to ${topic}: ${msgId.slice(0, 12)}...`)

    return msgId
  }

  /**
   * Handle incoming message
   */
  async handleMessage(message: GossipMessage): Promise<void> {
    // Check if already seen
    if (this.seenMessages.has(message.id)) {
      this.updatePeerScore(message.from, 'duplicate')
      return
    }

    // Validate message
    if (!this.validateMessage(message)) {
      this.updatePeerScore(message.from, 'invalid')
      return
    }

    // Mark as seen
    this.seenMessages.set(message.id, Date.now())

    // Update peer score
    this.updatePeerScore(message.from, 'delivered')

    // Notify handlers
    const handlers = this.messageHandlers.get(message.topic) ?? []
    for (const handler of handlers) {
      handler(message)
    }

    // Forward to mesh peers (excluding sender)
    const state = this.topics.get(message.topic)
    if (state) {
      const forwardPeers = Array.from(state.mesh).filter(
        (p) => p !== message.from,
      )
      await Promise.allSettled(
        forwardPeers.map((peer) => this.forwardMessage(peer, message)),
      )
    }
  }

  /**
   * Handle GRAFT control message (peer wants to join mesh)
   */
  async handleGraft(peerId: string, topic: string): Promise<boolean> {
    const state = this.topics.get(topic)
    if (!state) return false

    // Check if we have capacity
    if (state.mesh.size >= D_HIGH) {
      // Send PRUNE
      await this.prune(peerId, topic)
      return false
    }

    // Check peer score
    const score = this.peerScores.get(peerId)
    if (score && score.score < 0) {
      await this.prune(peerId, topic)
      return false
    }

    state.mesh.add(peerId)
    state.peers.add(peerId)
    return true
  }

  /**
   * Handle PRUNE control message (peer leaving mesh)
   */
  async handlePrune(peerId: string, topic: string): Promise<void> {
    const state = this.topics.get(topic)
    if (!state) return

    state.mesh.delete(peerId)
  }

  /**
   * Handle IHAVE control message (peer has messages we might want)
   */
  async handleIHave(
    _peerId: string,
    _topic: string,
    messageIds: string[],
  ): Promise<string[]> {
    const wanted: string[] = []

    for (const msgId of messageIds) {
      if (!this.seenMessages.has(msgId)) {
        wanted.push(msgId)
      }
    }

    return wanted
  }

  /**
   * Handle IWANT control message (peer wants messages)
   */
  async handleIWant(_messageIds: string[]): Promise<GossipMessage[]> {
    // Return messages from queue that peer wants
    return this.messageQueue.filter((msg) => _messageIds.includes(msg.id))
  }

  /**
   * Add peer to topic
   */
  addPeer(peerId: string, topic: string): void {
    const state = this.topics.get(topic)
    if (state) {
      state.peers.add(peerId)
    }
  }

  /**
   * Remove peer from topic
   */
  removePeer(peerId: string, topic: string): void {
    const state = this.topics.get(topic)
    if (state) {
      state.peers.delete(peerId)
      state.mesh.delete(peerId)
      state.fanout.delete(peerId)
    }
    this.peerScores.delete(peerId)
  }

  /**
   * Subscribe to messages on a topic
   */
  subscribe(topic: string, handler: (msg: GossipMessage) => void): void {
    const handlers = this.messageHandlers.get(topic) ?? []
    handlers.push(handler)
    this.messageHandlers.set(topic, handlers)
  }

  /**
   * Unsubscribe from messages
   */
  unsubscribe(topic: string, handler: (msg: GossipMessage) => void): void {
    const handlers = this.messageHandlers.get(topic) ?? []
    const index = handlers.indexOf(handler)
    if (index >= 0) {
      handlers.splice(index, 1)
      this.messageHandlers.set(topic, handlers)
    }
  }

  // ============================================================================
  // Internal Methods
  // ============================================================================

  /**
   * Periodic heartbeat
   */
  private heartbeat(): void {
    for (const [topic, state] of this.topics) {
      // Maintain mesh
      if (state.mesh.size < D_LOW) {
        // Need more peers
        const candidates = Array.from(state.peers)
          .filter((p) => !state.mesh.has(p))
          .slice(0, D - state.mesh.size)

        for (const peer of candidates) {
          state.mesh.add(peer)
          this.graft(peer, topic).catch((e) => console.warn(`[Gossip] graft ${peer} failed: ${e.message}`))
        }
      } else if (state.mesh.size > D_HIGH) {
        // Too many peers, prune some
        const toRemove = Array.from(state.mesh)
          .sort((a, b) => {
            const scoreA = this.peerScores.get(a)?.score ?? 0
            const scoreB = this.peerScores.get(b)?.score ?? 0
            return scoreA - scoreB
          })
          .slice(0, state.mesh.size - D)

        for (const peer of toRemove) {
          state.mesh.delete(peer)
          this.prune(peer, topic).catch((e) => console.warn(`[Gossip] prune ${peer} failed: ${e.message}`))
        }
      }

      // Gossip IHAVE to random peers
      const lazyPeers = this.selectGossipPeers(topic)
      const recentMsgs = this.messageQueue
        .filter((m) => m.topic === topic && Date.now() - m.timestamp < 5000)
        .map((m) => m.id)

      if (recentMsgs.length > 0 && lazyPeers.length > 0) {
        for (const peer of lazyPeers) {
          this.sendIHave(peer, topic, recentMsgs).catch((e) => console.warn(`[Gossip] IHAVE ${peer} failed: ${e.message}`))
        }
      }

      // Clean up fanout
      if (state.fanout.size > 0 && Date.now() - state.lastPublish > 60000) {
        state.fanout.clear()
      }
    }
  }

  /**
   * Send GRAFT to peer
   */
  private async graft(peerId: string, topic: string): Promise<void> {
    if (!this.sendMessage) return

    const msg: GossipMessage = {
      id: this.computeMessageId(this.config.peerId, this.seqCounter++),
      topic: '__control__',
      from: this.config.peerId,
      data: new TextEncoder().encode(JSON.stringify({ type: 'GRAFT', topic })),
      timestamp: Date.now(),
      seqno: this.seqCounter,
    }

    await this.sendMessage(peerId, msg)
  }

  /**
   * Send PRUNE to peer
   */
  private async prune(peerId: string, topic: string): Promise<void> {
    if (!this.sendMessage) return

    const msg: GossipMessage = {
      id: this.computeMessageId(this.config.peerId, this.seqCounter++),
      topic: '__control__',
      from: this.config.peerId,
      data: new TextEncoder().encode(JSON.stringify({ type: 'PRUNE', topic })),
      timestamp: Date.now(),
      seqno: this.seqCounter,
    }

    await this.sendMessage(peerId, msg)
  }

  /**
   * Send IHAVE to peer
   */
  private async sendIHave(
    peerId: string,
    topic: string,
    messageIds: string[],
  ): Promise<void> {
    if (!this.sendMessage) return

    const msg: GossipMessage = {
      id: this.computeMessageId(this.config.peerId, this.seqCounter++),
      topic: '__control__',
      from: this.config.peerId,
      data: new TextEncoder().encode(
        JSON.stringify({ type: 'IHAVE', topic, messageIds }),
      ),
      timestamp: Date.now(),
      seqno: this.seqCounter,
    }

    await this.sendMessage(peerId, msg)
  }

  /**
   * Forward message to peer
   */
  private async forwardMessage(
    peerId: string,
    message: GossipMessage,
  ): Promise<void> {
    if (!this.sendMessage) return
    await this.sendMessage(peerId, message)
  }

  /**
   * Select fanout peers for a topic
   */
  private selectFanoutPeers(topic: string, count: number): string[] {
    const state = this.topics.get(topic)
    if (!state) return []

    const candidates = Array.from(state.peers).filter(
      (p) => !state.mesh.has(p) && !state.fanout.has(p),
    )

    // Shuffle and take first N
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[candidates[i], candidates[j]] = [candidates[j], candidates[i]]
    }

    return candidates.slice(0, count)
  }

  /**
   * Select peers for lazy gossip
   */
  private selectGossipPeers(topic: string): string[] {
    const state = this.topics.get(topic)
    if (!state) return []

    const count = Math.ceil(state.peers.size * this.config.gossipFactor)
    const candidates = Array.from(state.peers).filter((p) => !state.mesh.has(p))

    // Shuffle and take first N
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[candidates[i], candidates[j]] = [candidates[j], candidates[i]]
    }

    return candidates.slice(0, Math.min(count, D_LAZY))
  }

  /**
   * Compute message ID
   */
  private computeMessageId(from: string, seqno: number): string {
    return keccak256(toBytes(`${from}:${seqno}:${Date.now()}`))
  }

  /**
   * Validate message
   */
  private validateMessage(message: GossipMessage): boolean {
    if (!message.id || !message.topic || !message.from) {
      return false
    }

    if (message.data.length > this.config.maxMessageSize) {
      return false
    }

    // Verify message ID
    const expectedId = this.computeMessageId(message.from, message.seqno)
    if (message.id !== expectedId) {
      // Allow for timing differences
      const tolerance = 1000 // 1 second
      if (Math.abs(message.timestamp - Date.now()) > tolerance * 60) {
        return false
      }
    }

    return true
  }

  /**
   * Update peer score
   */
  private updatePeerScore(
    peerId: string,
    event: 'delivered' | 'duplicate' | 'invalid',
  ): void {
    let score = this.peerScores.get(peerId)
    if (!score) {
      score = {
        peerId,
        score: 100,
        topicScores: new Map(),
        deliveryRate: 1,
        duplicateRate: 0,
        invalidRate: 0,
      }
      this.peerScores.set(peerId, score)
    }

    switch (event) {
      case 'delivered':
        score.deliveryRate = score.deliveryRate * 0.9 + 0.1
        score.score = Math.min(150, score.score + 1)
        break
      case 'duplicate':
        score.duplicateRate = score.duplicateRate * 0.9 + 0.1
        score.score = Math.max(-100, score.score - 0.5)
        break
      case 'invalid':
        score.invalidRate = score.invalidRate * 0.9 + 0.1
        score.score = Math.max(-100, score.score - 10)
        break
    }
  }

  /**
   * Clean up seen message cache
   */
  private cleanupSeenCache(): void {
    const now = Date.now()
    const expired: string[] = []

    for (const [id, timestamp] of this.seenMessages) {
      if (now - timestamp > this.config.seenTtl) {
        expired.push(id)
      }
    }

    for (const id of expired) {
      this.seenMessages.delete(id)
    }

    // Also trim message queue
    this.messageQueue = this.messageQueue.filter(
      (m) => now - m.timestamp < this.config.seenTtl,
    )
  }

  // ============================================================================
  // Stats
  // ============================================================================

  getTopicStats(
    topic: string,
  ): { peers: number; mesh: number; fanout: number } | null {
    const state = this.topics.get(topic)
    if (!state) return null

    return {
      peers: state.peers.size,
      mesh: state.mesh.size,
      fanout: state.fanout.size,
    }
  }

  getPeerScore(peerId: string): number {
    return this.peerScores.get(peerId)?.score ?? 0
  }

  getSeenMessageCount(): number {
    return this.seenMessages.size
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createGossipProtocol(
  config: Partial<GossipConfig>,
): GossipProtocol {
  return new GossipProtocol(config)
}
