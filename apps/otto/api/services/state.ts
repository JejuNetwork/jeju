/**
 * Otto State Manager
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { expectValid } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import { z } from 'zod'
import {
  type LimitOrder,
  LimitOrderSchema,
  type OttoUser,
  OttoUserSchema,
  type PendingBridgeData,
  type PendingSwapData,
  type Platform,
  validateOrNull,
} from '../../lib'
import type { LaunchRequest } from './launch'

const DATA_DIR = process.env.OTTO_DATA_DIR ?? './data'

const MAX_CONVERSATIONS = 10000
const MAX_SESSIONS = 10000
const MAX_HISTORY_PER_CONVERSATION = 50
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000

export interface PendingSwap {
  type: 'swap'
  quote: PendingSwapData['quote']
  params: PendingSwapData['params']
  expiresAt: number
}

export interface PendingBridge {
  type: 'bridge'
  quote?: PendingBridgeData['quote']
  params: PendingBridgeData['params']
  expiresAt: number
}

export interface PendingLaunch {
  type: 'launch'
  params: LaunchRequest
  expiresAt: number
}

export type PendingAction = PendingSwap | PendingBridge | PendingLaunch

interface ConversationState {
  pendingAction?: PendingAction
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  lastUpdated: number
}

interface ChatSession {
  sessionId: string
  userId: string
  walletAddress?: Address
  createdAt: number
  lastActiveAt: number
}

interface PersistedState {
  users: Record<string, OttoUser>
  platformToUser: Record<string, string>
  limitOrders: Record<string, LimitOrder>
}

const PersistedStateSchema = z.object({
  users: z.record(z.string(), OttoUserSchema).optional().default({}),
  platformToUser: z.record(z.string(), z.string()).optional().default({}),
  limitOrders: z.record(z.string(), LimitOrderSchema).optional().default({}),
})

class StateManager {
  private users = new Map<string, OttoUser>()
  private platformToUser = new Map<string, string>()
  private conversations = new Map<string, ConversationState>()
  private sessions = new Map<string, ChatSession>()
  private limitOrders = new Map<string, LimitOrder>()
  private limitOrderCheckInterval: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.ensureDataDir()
    this.load()
    setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS)
  }

  private ensureDataDir(): void {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true })
    }
  }

  private getStatePath(): string {
    return `${DATA_DIR}/otto-state.json`
  }

  private load(): void {
    const path = this.getStatePath()
    if (!existsSync(path)) return

    const file = Bun.file(path)
    const text = file.size > 0 ? readFileSync(path, 'utf-8') : null
    if (!text) return

    const parsed: unknown = JSON.parse(text)

    const data = validateOrNull(PersistedStateSchema, parsed, 'persisted state')
    if (!data) {
      console.error('[State] Invalid state file format, starting fresh')
      return
    }

    for (const [id, user] of Object.entries(data.users)) {
      const validatedUser = expectValid(OttoUserSchema, user, `user ${id}`)
      this.users.set(id, validatedUser)
    }
    for (const [key, userId] of Object.entries(data.platformToUser)) {
      if (typeof userId === 'string' && userId.length > 0) {
        this.platformToUser.set(key, userId)
      }
    }
    for (const [id, order] of Object.entries(data.limitOrders)) {
      if (order.status === 'open') {
        const validatedOrder = expectValid(
          LimitOrderSchema,
          order,
          `limit order ${id}`,
        )
        this.limitOrders.set(id, validatedOrder)
      }
    }

    console.log(
      `[State] Loaded ${this.users.size} users, ${this.limitOrders.size} open orders`,
    )
  }

  private save(): void {
    const data: PersistedState = {
      users: Object.fromEntries(this.users),
      platformToUser: Object.fromEntries(this.platformToUser),
      limitOrders: Object.fromEntries(this.limitOrders),
    }

    Bun.write(this.getStatePath(), JSON.stringify(data, null, 2))
  }

  getUser(userId: string): OttoUser | null {
    return this.users.get(userId) ?? null
  }

  getUserByPlatform(platform: Platform, platformId: string): OttoUser | null {
    const key = `${platform}:${platformId}`
    const userId = this.platformToUser.get(key)
    if (!userId) return null
    return this.users.get(userId) ?? null
  }

  getUserByWallet(walletAddress: Address): OttoUser | null {
    const lowerAddress = walletAddress.toLowerCase()
    for (const user of this.users.values()) {
      if (
        user.primaryWallet.toLowerCase() === lowerAddress ||
        (user.smartAccountAddress &&
          user.smartAccountAddress.toLowerCase() === lowerAddress)
      ) {
        return user
      }
    }
    return null
  }

  setUser(user: OttoUser): void {
    const validatedUser = expectValid(OttoUserSchema, user, 'setUser')
    this.users.set(validatedUser.id, validatedUser)
    for (const link of validatedUser.platforms) {
      const key = `${link.platform}:${link.platformId}`
      this.platformToUser.set(key, validatedUser.id)
    }
    this.save()
  }

  private getConversationKey(platform: Platform, channelId: string): string {
    return `${platform}:${channelId}`
  }

  getConversation(platform: Platform, channelId: string): ConversationState {
    const key = this.getConversationKey(platform, channelId)
    let state = this.conversations.get(key)

    if (!state) {
      if (this.conversations.size >= MAX_CONVERSATIONS) {
        const entries = this.conversations.entries()
        const oldest = entries.next().value
        if (oldest) {
          this.conversations.delete(oldest[0])
        }
      }

      state = { history: [], lastUpdated: Date.now() }
      this.conversations.set(key, state)
    }

    if (state.pendingAction && state.pendingAction.expiresAt < Date.now()) {
      state.pendingAction = undefined
    }

    return state
  }

  setPendingAction(
    platform: Platform,
    channelId: string,
    action: PendingAction,
  ): void {
    const state = this.getConversation(platform, channelId)
    state.pendingAction = action
    state.lastUpdated = Date.now()
  }

  clearPendingAction(platform: Platform, channelId: string): void {
    const state = this.getConversation(platform, channelId)
    state.pendingAction = undefined
    state.lastUpdated = Date.now()
  }

  getPendingAction(
    platform: Platform,
    channelId: string,
  ): PendingAction | undefined {
    const state = this.getConversation(platform, channelId)
    if (state.pendingAction && state.pendingAction.expiresAt < Date.now()) {
      state.pendingAction = undefined
    }
    return state.pendingAction
  }

  addToHistory(
    platform: Platform,
    channelId: string,
    role: 'user' | 'assistant',
    content: string,
  ): void {
    const state = this.getConversation(platform, channelId)
    state.history.push({ role, content })
    if (state.history.length > MAX_HISTORY_PER_CONVERSATION) {
      state.history = state.history.slice(-MAX_HISTORY_PER_CONVERSATION)
    }
    state.lastUpdated = Date.now()
  }

  getHistory(
    platform: Platform,
    channelId: string,
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    return this.getConversation(platform, channelId).history
  }

  createSession(walletAddress?: Address): ChatSession {
    if (this.sessions.size >= MAX_SESSIONS) {
      const entries = this.sessions.entries()
      const oldest = entries.next().value
      if (oldest) {
        this.sessions.delete(oldest[0])
      }
    }

    const sessionId = crypto.randomUUID()
    const session: ChatSession = {
      sessionId,
      userId: walletAddress ?? sessionId,
      walletAddress,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    }
    this.sessions.set(sessionId, session)
    return session
  }

  getSession(sessionId: string): ChatSession | null {
    return this.sessions.get(sessionId) ?? null
  }

  updateSession(sessionId: string, update: Partial<ChatSession>): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      Object.assign(session, update, { lastActiveAt: Date.now() })
    }
  }

  addLimitOrder(order: LimitOrder): void {
    const validatedOrder = expectValid(LimitOrderSchema, order, 'addLimitOrder')
    this.limitOrders.set(validatedOrder.orderId, validatedOrder)
    this.save()
  }

  getLimitOrder(orderId: string): LimitOrder | null {
    return this.limitOrders.get(orderId) ?? null
  }

  getUserLimitOrders(userId: string): LimitOrder[] {
    return Array.from(this.limitOrders.values()).filter(
      (o) => o.userId === userId && o.status === 'open',
    )
  }

  updateLimitOrder(orderId: string, update: Partial<LimitOrder>): void {
    const order = this.limitOrders.get(orderId)
    if (order) {
      Object.assign(order, update)
      this.save()
    }
  }

  startLimitOrderMonitor(
    checkPriceFn: (token: string, chainId: number) => Promise<number | null>,
    executeFn: (
      order: LimitOrder,
    ) => Promise<{ success: boolean; txHash?: Hex }>,
  ): void {
    if (this.limitOrderCheckInterval) return

    console.log('[State] Starting limit order monitor')

    this.limitOrderCheckInterval = setInterval(async () => {
      for (const order of this.limitOrders.values()) {
        if (order.status !== 'open') continue

        if (order.expiresAt && order.expiresAt < Date.now()) {
          order.status = 'expired'
          this.save()
          console.log(`[State] Order ${order.orderId} expired`)
          continue
        }

        const price = await checkPriceFn(order.fromToken.symbol, order.chainId)
        if (price === null) continue

        const targetPrice = parseFloat(order.targetPrice)

        if (price >= targetPrice) {
          console.log(
            `[State] Order ${order.orderId} triggered at price ${price} (target: ${targetPrice})`,
          )

          const result = await executeFn(order)
          if (result.success) {
            order.status = 'filled'
            order.filledAt = Date.now()
            order.filledTxHash = result.txHash
            console.log(
              `[State] Order ${order.orderId} filled, tx: ${result.txHash}`,
            )
          }
          this.save()
        }
      }
    }, 30_000)
  }

  stopLimitOrderMonitor(): void {
    if (this.limitOrderCheckInterval) {
      clearInterval(this.limitOrderCheckInterval)
      this.limitOrderCheckInterval = null
    }
  }

  cleanup(): void {
    const now = Date.now()
    const maxAge = 24 * 60 * 60 * 1000 // 24 hours

    for (const [key, state] of this.conversations) {
      if (now - state.lastUpdated > maxAge) {
        this.conversations.delete(key)
      }
    }

    for (const [id, session] of this.sessions) {
      if (now - session.lastActiveAt > maxAge) {
        this.sessions.delete(id)
      }
    }
  }
}

let stateManager: StateManager | null = null

export function getStateManager(): StateManager {
  if (!stateManager) {
    stateManager = new StateManager()
  }
  return stateManager
}

export type { ConversationState, ChatSession }
