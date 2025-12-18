/**
 * Otto State Manager
 * Handles persistence for users, sessions, and pending actions
 */

import { existsSync, mkdirSync } from 'fs';
import type { Address, Hex } from 'viem';
import type {
  OttoUser,
  Platform,
  LimitOrder,
  SwapQuote,
  BridgeQuote,
} from '../types';

const DATA_DIR = process.env.OTTO_DATA_DIR ?? './data';

// Pending action types
interface PendingSwap {
  type: 'swap';
  quote: SwapQuote;
  params: {
    amount: string;
    from: string;
    to: string;
    chainId: number;
  };
  expiresAt: number;
}

interface PendingBridge {
  type: 'bridge';
  quote?: BridgeQuote;
  params: {
    amount: string;
    token: string;
    fromChain: string;
    toChain: string;
    sourceChainId: number;
    destChainId: number;
  };
  expiresAt: number;
}

type PendingAction = PendingSwap | PendingBridge;

interface ConversationState {
  pendingAction?: PendingAction;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  lastUpdated: number;
}

interface ChatSession {
  sessionId: string;
  userId: string;
  walletAddress?: Address;
  createdAt: number;
  lastActiveAt: number;
}

interface PersistedState {
  users: Record<string, OttoUser>;
  platformToUser: Record<string, string>;
  limitOrders: Record<string, LimitOrder>;
}

class StateManager {
  private users = new Map<string, OttoUser>();
  private platformToUser = new Map<string, string>();
  private conversations = new Map<string, ConversationState>();
  private sessions = new Map<string, ChatSession>();
  private limitOrders = new Map<string, LimitOrder>();
  private limitOrderCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.ensureDataDir();
    this.load();
  }

  private ensureDataDir(): void {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private getStatePath(): string {
    return `${DATA_DIR}/otto-state.json`;
  }

  private load(): void {
    const path = this.getStatePath();
    if (!existsSync(path)) return;

    const file = Bun.file(path);
    const text = file.size > 0 ? require('fs').readFileSync(path, 'utf-8') : null;
    if (!text) return;

    const data = JSON.parse(text) as PersistedState;

    for (const [id, user] of Object.entries(data.users)) {
      this.users.set(id, user);
    }
    for (const [key, userId] of Object.entries(data.platformToUser)) {
      this.platformToUser.set(key, userId);
    }
    for (const [id, order] of Object.entries(data.limitOrders)) {
      if (order.status === 'open') {
        this.limitOrders.set(id, order);
      }
    }

    console.log(`[State] Loaded ${this.users.size} users, ${this.limitOrders.size} open orders`);
  }

  private save(): void {
    const data: PersistedState = {
      users: Object.fromEntries(this.users),
      platformToUser: Object.fromEntries(this.platformToUser),
      limitOrders: Object.fromEntries(this.limitOrders),
    };

    Bun.write(this.getStatePath(), JSON.stringify(data, null, 2));
  }

  // ============================================================================
  // User Management
  // ============================================================================

  getUser(userId: string): OttoUser | null {
    return this.users.get(userId) ?? null;
  }

  getUserByPlatform(platform: Platform, platformId: string): OttoUser | null {
    const key = `${platform}:${platformId}`;
    const userId = this.platformToUser.get(key);
    if (!userId) return null;
    return this.users.get(userId) ?? null;
  }

  setUser(user: OttoUser): void {
    this.users.set(user.id, user);
    for (const link of user.platforms) {
      const key = `${link.platform}:${link.platformId}`;
      this.platformToUser.set(key, user.id);
    }
    this.save();
  }

  // ============================================================================
  // Conversation State
  // ============================================================================

  private getConversationKey(platform: Platform, channelId: string): string {
    return `${platform}:${channelId}`;
  }

  getConversation(platform: Platform, channelId: string): ConversationState {
    const key = this.getConversationKey(platform, channelId);
    let state = this.conversations.get(key);
    
    if (!state) {
      state = { history: [], lastUpdated: Date.now() };
      this.conversations.set(key, state);
    }

    // Check if pending action expired
    if (state.pendingAction && state.pendingAction.expiresAt < Date.now()) {
      state.pendingAction = undefined;
    }

    return state;
  }

  setPendingAction(platform: Platform, channelId: string, action: PendingAction): void {
    const state = this.getConversation(platform, channelId);
    state.pendingAction = action;
    state.lastUpdated = Date.now();
  }

  clearPendingAction(platform: Platform, channelId: string): void {
    const state = this.getConversation(platform, channelId);
    state.pendingAction = undefined;
    state.lastUpdated = Date.now();
  }

  getPendingAction(platform: Platform, channelId: string): PendingAction | undefined {
    const state = this.getConversation(platform, channelId);
    if (state.pendingAction && state.pendingAction.expiresAt < Date.now()) {
      state.pendingAction = undefined;
    }
    return state.pendingAction;
  }

  addToHistory(platform: Platform, channelId: string, role: 'user' | 'assistant', content: string): void {
    const state = this.getConversation(platform, channelId);
    state.history.push({ role, content });
    // Keep last 10 messages for context
    if (state.history.length > 10) {
      state.history = state.history.slice(-10);
    }
    state.lastUpdated = Date.now();
  }

  getHistory(platform: Platform, channelId: string): Array<{ role: 'user' | 'assistant'; content: string }> {
    return this.getConversation(platform, channelId).history;
  }

  // ============================================================================
  // Chat Sessions
  // ============================================================================

  createSession(walletAddress?: Address): ChatSession {
    const sessionId = crypto.randomUUID();
    const session: ChatSession = {
      sessionId,
      userId: walletAddress ?? sessionId,
      walletAddress,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  getSession(sessionId: string): ChatSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  updateSession(sessionId: string, update: Partial<ChatSession>): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      Object.assign(session, update, { lastActiveAt: Date.now() });
    }
  }

  // ============================================================================
  // Limit Orders
  // ============================================================================

  addLimitOrder(order: LimitOrder): void {
    this.limitOrders.set(order.orderId, order);
    this.save();
  }

  getLimitOrder(orderId: string): LimitOrder | null {
    return this.limitOrders.get(orderId) ?? null;
  }

  getUserLimitOrders(userId: string): LimitOrder[] {
    return Array.from(this.limitOrders.values())
      .filter(o => o.userId === userId && o.status === 'open');
  }

  updateLimitOrder(orderId: string, update: Partial<LimitOrder>): void {
    const order = this.limitOrders.get(orderId);
    if (order) {
      Object.assign(order, update);
      this.save();
    }
  }

  startLimitOrderMonitor(
    checkPriceFn: (token: string, chainId: number) => Promise<number | null>,
    executeFn: (order: LimitOrder) => Promise<{ success: boolean; txHash?: Hex }>
  ): void {
    if (this.limitOrderCheckInterval) return;

    console.log('[State] Starting limit order monitor');

    this.limitOrderCheckInterval = setInterval(async () => {
      for (const order of this.limitOrders.values()) {
        if (order.status !== 'open') continue;

        // Check expiry
        if (order.expiresAt && order.expiresAt < Date.now()) {
          order.status = 'expired';
          this.save();
          console.log(`[State] Order ${order.orderId} expired`);
          continue;
        }

        // Check price
        const price = await checkPriceFn(order.fromToken.symbol, order.chainId);
        if (price === null) continue;

        const targetPrice = parseFloat(order.targetPrice);
        
        // Execute if price is at or better than target
        if (price >= targetPrice) {
          console.log(`[State] Order ${order.orderId} triggered at price ${price} (target: ${targetPrice})`);
          
          const result = await executeFn(order);
          if (result.success) {
            order.status = 'filled';
            order.filledAt = Date.now();
            order.filledTxHash = result.txHash;
            console.log(`[State] Order ${order.orderId} filled, tx: ${result.txHash}`);
          }
          this.save();
        }
      }
    }, 30_000); // Check every 30 seconds
  }

  stopLimitOrderMonitor(): void {
    if (this.limitOrderCheckInterval) {
      clearInterval(this.limitOrderCheckInterval);
      this.limitOrderCheckInterval = null;
    }
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  cleanup(): void {
    // Clean expired conversations
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    for (const [key, state] of this.conversations) {
      if (now - state.lastUpdated > maxAge) {
        this.conversations.delete(key);
      }
    }

    // Clean expired sessions
    for (const [id, session] of this.sessions) {
      if (now - session.lastActiveAt > maxAge) {
        this.sessions.delete(id);
      }
    }
  }
}

// Singleton
let stateManager: StateManager | null = null;

export function getStateManager(): StateManager {
  if (!stateManager) {
    stateManager = new StateManager();
  }
  return stateManager;
}

export type { PendingAction, PendingSwap, PendingBridge, ConversationState, ChatSession };

