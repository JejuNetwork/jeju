/**
 * XMTP Sync Service
 * 
 * Handles synchronization of XMTP messages across Jeju relay nodes.
 * Ensures message consistency and handles offline message queuing.
 */

import type {
  XMTPEnvelope,
  SyncState,
  SyncOptions,
  XMTPConversation,
  XMTPMessage,
} from './types';
import type { Address } from 'viem';

// ============ Types ============

export interface SyncEvent {
  type: 'message' | 'conversation' | 'identity' | 'group';
  id: string;
  timestamp: number;
  data: XMTPEnvelope | XMTPConversation | XMTPMessage;
}

export interface SyncPeer {
  nodeId: string;
  url: string;
  lastSyncedAt: number;
  cursor: string;
}

export interface SyncServiceConfig {
  /** Sync interval in ms */
  syncIntervalMs: number;
  /** Max events per batch */
  batchSize: number;
  /** Persistence path */
  persistencePath?: string;
  /** IPFS URL for backup */
  ipfsUrl?: string;
}

// ============ Sync Service Class ============

/**
 * Manages sync state across XMTP nodes
 */
export class XMTPSyncService {
  private config: SyncServiceConfig;
  private state: SyncState;
  private peers: Map<string, SyncPeer> = new Map();
  private eventBuffer: SyncEvent[] = [];
  private syncInterval: NodeJS.Timeout | null = null;
  private isSyncing: boolean = false;
  
  constructor(config?: Partial<SyncServiceConfig>) {
    this.config = {
      syncIntervalMs: config?.syncIntervalMs ?? 5000,
      batchSize: config?.batchSize ?? 100,
      persistencePath: config?.persistencePath,
      ipfsUrl: config?.ipfsUrl,
    };
    
    this.state = {
      lastSyncedBlock: 0,
      lastSyncedAt: 0,
      pendingMessages: 0,
      isSyncing: false,
    };
  }
  
  // ============ Lifecycle ============
  
  /**
   * Start the sync service
   */
  async start(): Promise<void> {
    console.log('[XMTP Sync] Starting sync service...');
    
    // Load persisted state
    await this.loadState();
    
    // Start sync loop
    this.syncInterval = setInterval(async () => {
      await this.runSyncCycle();
    }, this.config.syncIntervalMs);
    
    // Run initial sync
    await this.runSyncCycle();
    
    console.log('[XMTP Sync] Sync service started');
  }
  
  /**
   * Stop the sync service
   */
  async stop(): Promise<void> {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
    
    // Wait for current sync to complete
    while (this.isSyncing) {
      await this.delay(100);
    }
    
    // Persist state
    await this.saveState();
    
    console.log('[XMTP Sync] Sync service stopped');
  }
  
  // ============ Sync Operations ============
  
  /**
   * Run a sync cycle
   */
  private async runSyncCycle(): Promise<void> {
    if (this.isSyncing) return;
    
    this.isSyncing = true;
    this.state.isSyncing = true;
    
    try {
      // Sync with each peer
      for (const [, peer] of this.peers) {
        await this.syncWithPeer(peer);
      }
      
      // Process buffered events
      await this.processEventBuffer();
      
      // Update state
      this.state.lastSyncedAt = Date.now();
    } finally {
      this.isSyncing = false;
      this.state.isSyncing = false;
    }
  }
  
  /**
   * Sync with a specific peer
   */
  private async syncWithPeer(peer: SyncPeer): Promise<void> {
    try {
      const events = await this.fetchEventsFromPeer(peer);
      
      for (const event of events) {
        this.eventBuffer.push(event);
      }
      
      if (events.length > 0) {
        peer.lastSyncedAt = Date.now();
        peer.cursor = events[events.length - 1]!.id;
      }
    } catch (error) {
      console.error(`[XMTP Sync] Failed to sync with peer ${peer.nodeId}:`, error);
    }
  }
  
  /**
   * Fetch events from peer
   */
  private async fetchEventsFromPeer(peer: SyncPeer): Promise<SyncEvent[]> {
    const response = await fetch(`${peer.url}/api/sync/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cursor: peer.cursor,
        limit: this.config.batchSize,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Peer sync failed: ${response.status}`);
    }
    
    return response.json() as Promise<SyncEvent[]>;
  }
  
  /**
   * Process buffered events
   */
  private async processEventBuffer(): Promise<void> {
    if (this.eventBuffer.length === 0) return;
    
    // Sort by timestamp
    this.eventBuffer.sort((a, b) => a.timestamp - b.timestamp);
    
    // Process in batches
    while (this.eventBuffer.length > 0) {
      const batch = this.eventBuffer.splice(0, this.config.batchSize);
      await this.processBatch(batch);
    }
  }
  
  /**
   * Process a batch of events
   */
  private async processBatch(events: SyncEvent[]): Promise<void> {
    for (const event of events) {
      await this.processEvent(event);
    }
    
    // Persist after batch
    if (this.config.persistencePath) {
      await this.saveState();
    }
  }
  
  /**
   * Process a single event
   */
  private async processEvent(event: SyncEvent): Promise<void> {
    switch (event.type) {
      case 'message':
        // Store message
        break;
      case 'conversation':
        // Update conversation
        break;
      case 'identity':
        // Update identity
        break;
      case 'group':
        // Update group
        break;
    }
    
    // Update sync state
    if (event.timestamp > this.state.lastSyncedAt) {
      this.state.lastSyncedAt = event.timestamp;
    }
  }
  
  // ============ Peer Management ============
  
  /**
   * Add a sync peer
   */
  addPeer(nodeId: string, url: string): void {
    this.peers.set(nodeId, {
      nodeId,
      url,
      lastSyncedAt: 0,
      cursor: '',
    });
  }
  
  /**
   * Remove a sync peer
   */
  removePeer(nodeId: string): void {
    this.peers.delete(nodeId);
  }
  
  /**
   * Get all peers
   */
  getPeers(): SyncPeer[] {
    return Array.from(this.peers.values());
  }
  
  // ============ Event Submission ============
  
  /**
   * Submit an event to be synced
   */
  async submitEvent(event: Omit<SyncEvent, 'timestamp'>): Promise<void> {
    const fullEvent: SyncEvent = {
      ...event,
      timestamp: Date.now(),
    };
    
    this.eventBuffer.push(fullEvent);
    
    // Broadcast to peers
    await this.broadcastEvent(fullEvent);
  }
  
  /**
   * Broadcast event to all peers
   */
  private async broadcastEvent(event: SyncEvent): Promise<void> {
    const broadcasts = Array.from(this.peers.values()).map(async peer => {
      try {
        await fetch(`${peer.url}/api/sync/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
        });
      } catch {
        // Peer unavailable, will sync later
      }
    });
    
    await Promise.allSettled(broadcasts);
  }
  
  // ============ State Persistence ============
  
  /**
   * Load persisted state
   */
  private async loadState(): Promise<void> {
    if (!this.config.persistencePath) return;
    
    try {
      const file = Bun.file(this.config.persistencePath);
      if (await file.exists()) {
        const data = await file.json();
        this.state = data.state;
        
        for (const peer of data.peers) {
          this.peers.set(peer.nodeId, peer);
        }
      }
    } catch {
      console.log('[XMTP Sync] No previous state found');
    }
  }
  
  /**
   * Save state to disk
   */
  private async saveState(): Promise<void> {
    if (!this.config.persistencePath) return;
    
    await Bun.write(this.config.persistencePath, JSON.stringify({
      state: this.state,
      peers: Array.from(this.peers.values()),
    }, null, 2));
  }
  
  // ============ IPFS Backup ============
  
  /**
   * Backup state to IPFS
   */
  async backupToIPFS(): Promise<string | null> {
    if (!this.config.ipfsUrl) return null;
    
    const data = JSON.stringify({
      state: this.state,
      peers: Array.from(this.peers.values()),
      timestamp: Date.now(),
    });
    
    const response = await fetch(`${this.config.ipfsUrl}/api/v0/add`, {
      method: 'POST',
      body: data,
    });
    
    if (!response.ok) return null;
    
    const result = await response.json() as { Hash: string };
    return result.Hash;
  }
  
  /**
   * Restore from IPFS
   */
  async restoreFromIPFS(hash: string): Promise<void> {
    if (!this.config.ipfsUrl) return;
    
    const response = await fetch(`${this.config.ipfsUrl}/ipfs/${hash}`);
    if (!response.ok) return;
    
    const data = await response.json() as { state: SyncState; peers: SyncPeer[] };
    
    this.state = data.state;
    for (const peer of data.peers) {
      this.peers.set(peer.nodeId, peer);
    }
  }
  
  // ============ Stats ============
  
  /**
   * Get sync state
   */
  getState(): SyncState {
    return { ...this.state };
  }
  
  /**
   * Get pending message count
   */
  getPendingCount(): number {
    return this.eventBuffer.length;
  }
  
  // ============ Utility ============
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============ Factory Function ============

/**
 * Create and start a sync service
 */
export async function createSyncService(
  config?: Partial<SyncServiceConfig>,
): Promise<XMTPSyncService> {
  const service = new XMTPSyncService(config);
  await service.start();
  return service;
}

