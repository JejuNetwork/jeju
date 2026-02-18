/**
 * Memory Persistence Service
 *
 * Commits agent memory/state to L2/IPFS for decentralized persistence.
 * Implements two strategies:
 * 1. Periodic snapshots - Background task commits state every N seconds
 * 2. Event-based commits - Immediate commit on significant events
 */

import type { Address, PublicClient, WalletClient, Abi } from 'viem'
import { parseAbi } from 'viem'
import type { AgentState, MemoryEntry } from '../../lib/types'
import { createLogger, type Logger } from './logger'
import type { CrucibleStorage } from './storage'
import { getDatabase, type CrucibleDatabase } from './database'

const IDENTITY_REGISTRY_ABI = parseAbi([
  'function setAgentUri(uint256 agentId, string newTokenURI) external',
  'function tokenURI(uint256 agentId) external view returns (string)',
])

/**
 * Signer interface - can be KMS or regular wallet client
 */
export interface MemorySigner {
  isInitialized(): boolean
  signContractWrite(params: {
    address: Address
    abi: Abi
    functionName: string
    args?: readonly unknown[]
    value?: bigint
  }): Promise<`0x${string}`>
}

/**
 * Create a signer wrapper from a wallet client
 */
export function createWalletSigner(
  walletClient: WalletClient,
  publicClient: PublicClient,
): MemorySigner {
  return {
    isInitialized: () => true,
    signContractWrite: async (params) => {
      const { request } = await publicClient.simulateContract({
        address: params.address,
        abi: params.abi,
        functionName: params.functionName,
        args: params.args as readonly unknown[],
        value: params.value,
        account: walletClient.account!,
      })
      return walletClient.writeContract(request)
    },
  }
}

export interface MemoryPersistenceConfig {
  /** Agent ID (on-chain bigint) */
  agentId: bigint
  /** Character CID on IPFS */
  characterCid: string
  /** Current state CID on IPFS */
  stateCid: string
  /** Identity registry contract address */
  identityRegistry: Address
  /** Storage service for IPFS uploads */
  storage: CrucibleStorage
  /** Public client for reading chain state */
  publicClient: PublicClient
  /** Signer for writing to chain (KMS or wallet) */
  signer: MemorySigner
  /** Periodic snapshot interval in ms (default: 60000 = 1 minute) */
  snapshotIntervalMs?: number
  /** Minimum messages before periodic commit (default: 5) */
  minMessagesForSnapshot?: number
  /** Enable periodic snapshots (default: true) */
  enablePeriodicSnapshots?: boolean
  /** Enable event-based commits (default: true) */
  enableEventCommits?: boolean
  /** Logger instance */
  logger?: Logger
}

export type CommitTrigger =
  | 'periodic'           // Background timer
  | 'action_executed'    // Agent executed an on-chain action
  | 'session_end'        // User ended session
  | 'memory_threshold'   // Too many uncommitted memories
  | 'explicit'           // Manually triggered
  | 'shutdown'           // Service shutting down

export interface CommitResult {
  success: boolean
  trigger: CommitTrigger
  stateCid?: string
  txHash?: string
  messagesCommitted: number
  error?: string
}

interface PendingMemory {
  id: string
  roomId: string
  userId: string
  content: string
  role: 'user' | 'assistant'
  action?: string
  timestamp: number
}

export class MemoryPersistenceService {
  private config: MemoryPersistenceConfig
  private log: Logger
  private db: CrucibleDatabase

  // State tracking
  private currentStateCid: string
  private pendingMemories: PendingMemory[] = []
  private lastCommitTime: number = Date.now()
  private commitInProgress = false
  private snapshotTimer: ReturnType<typeof setInterval> | null = null
  private started = false

  // Stats
  private totalCommits = 0
  private totalMessagesCommitted = 0
  private lastCommitResult: CommitResult | null = null

  constructor(config: MemoryPersistenceConfig) {
    this.config = config
    this.currentStateCid = config.stateCid
    this.log = config.logger ?? createLogger(`MemoryPersistence:${config.agentId}`)
    this.db = getDatabase()
  }

  /**
   * Start the persistence service
   */
  async start(): Promise<void> {
    if (this.started) return

    this.log.info('Starting memory persistence service', {
      agentId: this.config.agentId.toString(),
      snapshotInterval: this.config.snapshotIntervalMs ?? 60000,
      enablePeriodic: this.config.enablePeriodicSnapshots !== false,
      enableEvents: this.config.enableEventCommits !== false,
    })

    // Start periodic snapshot timer
    if (this.config.enablePeriodicSnapshots !== false) {
      const interval = this.config.snapshotIntervalMs ?? 60000
      this.snapshotTimer = setInterval(() => {
        this.periodicCommit().catch(err => {
          this.log.error('Periodic commit failed', { error: String(err) })
        })
      }, interval)
    }

    this.started = true
  }

  /**
   * Stop the persistence service (commits any pending memories)
   */
  async stop(): Promise<CommitResult | null> {
    if (!this.started) return null

    this.log.info('Stopping memory persistence service')

    // Clear timer
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer)
      this.snapshotTimer = null
    }

    // Commit any pending memories
    let result: CommitResult | null = null
    if (this.pendingMemories.length > 0) {
      result = await this.commitState('shutdown')
    }

    this.started = false
    return result
  }

  /**
   * Record a new message (adds to pending queue)
   */
  recordMessage(params: {
    roomId: string
    userId: string
    content: string
    role: 'user' | 'assistant'
    action?: string
  }): void {
    const memory: PendingMemory = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      roomId: params.roomId,
      userId: params.userId,
      content: params.content,
      role: params.role,
      action: params.action,
      timestamp: Date.now(),
    }

    this.pendingMemories.push(memory)

    this.log.debug('Recorded message', {
      id: memory.id,
      role: memory.role,
      pendingCount: this.pendingMemories.length,
    })

    // Check if we should trigger a commit based on memory threshold
    const threshold = 50 // Commit if more than 50 pending messages
    if (this.pendingMemories.length >= threshold && this.config.enableEventCommits !== false) {
      this.commitState('memory_threshold').catch(err => {
        this.log.error('Memory threshold commit failed', { error: String(err) })
      })
    }
  }

  /**
   * Trigger event-based commit (e.g., after action execution)
   */
  async onActionExecuted(actionName: string, success: boolean): Promise<CommitResult | null> {
    if (this.config.enableEventCommits === false) return null

    this.log.info('Action executed, triggering commit', { actionName, success })
    return this.commitState('action_executed')
  }

  /**
   * Trigger commit on session end
   */
  async onSessionEnd(roomId: string): Promise<CommitResult | null> {
    if (this.config.enableEventCommits === false) return null

    this.log.info('Session ended, triggering commit', { roomId })
    return this.commitState('session_end')
  }

  /**
   * Explicit commit (can be called by external code)
   */
  async commit(): Promise<CommitResult> {
    return this.commitState('explicit')
  }

  /**
   * Periodic commit (called by timer)
   */
  private async periodicCommit(): Promise<CommitResult | null> {
    const minMessages = this.config.minMessagesForSnapshot ?? 5

    if (this.pendingMemories.length < minMessages) {
      this.log.debug('Skipping periodic commit, not enough messages', {
        pending: this.pendingMemories.length,
        minimum: minMessages,
      })
      return null
    }

    return this.commitState('periodic')
  }

  /**
   * Core commit logic - stores state to IPFS and updates L2 tokenURI
   */
  private async commitState(trigger: CommitTrigger): Promise<CommitResult> {
    // Prevent concurrent commits
    if (this.commitInProgress) {
      this.log.warn('Commit already in progress, skipping')
      return {
        success: false,
        trigger,
        messagesCommitted: 0,
        error: 'Commit already in progress',
      }
    }

    if (this.pendingMemories.length === 0) {
      return {
        success: true,
        trigger,
        messagesCommitted: 0,
        stateCid: this.currentStateCid,
      }
    }

    this.commitInProgress = true
    const startTime = Date.now()
    const memoriesToCommit = [...this.pendingMemories]

    try {
      this.log.info('Starting state commit', {
        trigger,
        pendingMessages: memoriesToCommit.length,
      })

      // 1. Load current state from IPFS
      const currentState = await this.loadCurrentState()

      // 2. Add pending memories to state
      const newMemories: MemoryEntry[] = memoriesToCommit.map(m => ({
        id: m.id,
        content: `[${m.role}] ${m.content}`,
        embedding: [], // Will be computed on retrieval if needed
        importance: m.action ? 0.8 : 0.5, // Actions are more important
        createdAt: m.timestamp,
        roomId: m.roomId,
        userId: m.userId,
      }))

      const updatedState: AgentState = {
        ...currentState,
        memories: [...currentState.memories, ...newMemories],
        version: currentState.version + 1,
        updatedAt: Date.now(),
      }

      // 3. Store updated state to IPFS
      const newStateCid = await this.config.storage.storeAgentState(updatedState)

      this.log.info('State stored to IPFS', {
        newStateCid,
        memoriesAdded: newMemories.length,
        totalMemories: updatedState.memories.length,
      })

      // 4. Update tokenURI on L2 (if KMS is available)
      let txHash: string | undefined
      if (this.config.signer.isInitialized()) {
        const newTokenUri = `ipfs://${this.config.characterCid}#state=${newStateCid}`

        txHash = await this.config.signer.signContractWrite({
          address: this.config.identityRegistry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'setAgentUri',
          args: [this.config.agentId, newTokenUri],
        })

        // Wait for confirmation
        await this.config.publicClient.waitForTransactionReceipt({
          hash: txHash,
          timeout: 60_000,
        })

        this.log.info('TokenURI updated on L2', { txHash, newTokenUri })
      } else {
        this.log.warn('KMS not initialized, skipping L2 update')
      }

      // 5. Clear committed memories from pending queue
      this.pendingMemories = this.pendingMemories.filter(
        m => !memoriesToCommit.find(c => c.id === m.id)
      )
      this.currentStateCid = newStateCid
      this.lastCommitTime = Date.now()
      this.totalCommits++
      this.totalMessagesCommitted += memoriesToCommit.length

      const result: CommitResult = {
        success: true,
        trigger,
        stateCid: newStateCid,
        txHash,
        messagesCommitted: memoriesToCommit.length,
      }

      this.lastCommitResult = result

      this.log.info('State commit completed', {
        trigger,
        duration: Date.now() - startTime,
        messagesCommitted: memoriesToCommit.length,
        newStateCid,
        txHash,
      })

      return result

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      this.log.error('State commit failed', {
        trigger,
        error: errorMsg,
        pendingMessages: memoriesToCommit.length,
      })

      const result: CommitResult = {
        success: false,
        trigger,
        messagesCommitted: 0,
        error: errorMsg,
      }

      this.lastCommitResult = result
      return result

    } finally {
      this.commitInProgress = false
    }
  }

  /**
   * Load current state from IPFS
   */
  private async loadCurrentState(): Promise<AgentState> {
    try {
      return await this.config.storage.loadAgentState(this.currentStateCid)
    } catch (error) {
      this.log.warn('Failed to load current state, creating fresh state', {
        cid: this.currentStateCid,
        error: String(error),
      })

      return this.config.storage.createInitialState(this.config.agentId.toString())
    }
  }

  /**
   * Get service stats
   */
  getStats(): {
    pendingMessages: number
    totalCommits: number
    totalMessagesCommitted: number
    lastCommitTime: number
    lastCommitResult: CommitResult | null
    currentStateCid: string
  } {
    return {
      pendingMessages: this.pendingMemories.length,
      totalCommits: this.totalCommits,
      totalMessagesCommitted: this.totalMessagesCommitted,
      lastCommitTime: this.lastCommitTime,
      lastCommitResult: this.lastCommitResult,
      currentStateCid: this.currentStateCid,
    }
  }

  /**
   * Sync memories from database (for recovery/catchup)
   */
  async syncFromDatabase(roomId: string, since?: number): Promise<number> {
    const messages = await this.db.getMessages(roomId, {
      since,
      limit: 1000,
    })

    let synced = 0
    for (const msg of messages) {
      // Skip if already in pending
      if (this.pendingMemories.find(p => p.id === String(msg.id))) {
        continue
      }

      this.pendingMemories.push({
        id: String(msg.id),
        roomId: msg.room_id,
        userId: msg.agent_id, // Using agent_id as user identifier
        content: msg.content,
        role: 'assistant', // Database messages are from agents
        action: msg.action ?? undefined,
        timestamp: msg.created_at * 1000,
      })
      synced++
    }

    this.log.info('Synced messages from database', {
      roomId,
      synced,
      totalPending: this.pendingMemories.length,
    })

    return synced
  }
}

/**
 * Create a memory persistence service for an agent
 */
export function createMemoryPersistence(config: MemoryPersistenceConfig): MemoryPersistenceService {
  return new MemoryPersistenceService(config)
}
