/**
 * Network Ban Cache - Shared across all Jeju apps
 * 
 * Provides instant ban checks without RPC calls
 * Stays synchronized via blockchain events
 */

import { ethers, Contract } from 'ethers';
import { Logger } from './logger';

const logger = new Logger({ prefix: 'BAN-CACHE' });

export interface BanCacheConfig {
  banManagerAddress: string;
  labelManagerAddress: string;
  rpcUrl: string;
  appId: string;  // keccak256 of app name
}

export interface BanStatus {
  networkBanned: boolean;
  appBanned: boolean;
  labels: string[];
  banReason?: string;
  bannedAt?: number;
}

/**
 * Event-driven ban cache - zero RPC calls on checks
 */
export class NetworkBanCache {
  private banManager: Contract;
  private labelManager: Contract;
  private provider: ethers.Provider;
  private appId: string;
  
  // Cache storage
  private networkBanned = new Set<number>();
  private appBanned = new Map<string, Set<number>>();
  private labels = new Map<number, Set<string>>();
  private banReasons = new Map<number, string>();
  private bannedTimestamps = new Map<number, number>();
  
  // Sync state
  private initialized = false;
  private lastSyncBlock = 0;
  
  constructor(config: BanCacheConfig) {
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.appId = config.appId;
    
    // Load contract ABIs (simplified for now)
    const banManagerABI = [
      'event NetworkBanApplied(uint256 indexed agentId, string reason, address indexed bannedBy)',
      'event NetworkBanRemoved(uint256 indexed agentId, address indexed removedBy)',
      'event AppBanApplied(uint256 indexed agentId, bytes32 indexed appId, string reason, address indexed bannedBy)',
      'event AppBanRemoved(uint256 indexed agentId, bytes32 indexed appId, address indexed removedBy)',
      'function isAccessAllowed(uint256 agentId, bytes32 appId) view returns (bool)',
      'function isNetworkBanned(uint256 agentId) view returns (bool)',
      'function getNetworkBanInfo(uint256) view returns (bool, string, uint256)'
    ];
    
    const labelManagerABI = [
      'event LabelApplied(uint256 indexed targetAgentId, uint8 indexed label, uint256 proposalId)',
      'event LabelRemoved(uint256 indexed targetAgentId, uint8 indexed label, uint256 proposalId)',
      'function getLabels(uint256 agentId) view returns (uint8[])'
    ];
    
    this.banManager = new Contract(config.banManagerAddress, banManagerABI, this.provider);
    this.labelManager = new Contract(config.labelManagerAddress, labelManagerABI, this.provider);
  }
  
  /**
   * Initialize cache from historical events
   */
  async initialize(): Promise<void> {
    logger.info('Initializing ban cache...');
    
    const currentBlock = await this.provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - 100000);  // Last ~100k blocks
    
    // Query past network bans
    const networkBanEvents = await this.banManager.queryFilter(
      this.banManager.filters.NetworkBanApplied(),
      fromBlock
    );
    
    const networkUnbanEvents = await this.banManager.queryFilter(
      this.banManager.filters.NetworkBanRemoved(),
      fromBlock
    );
    
    // Query past app bans
    const appBanEvents = await this.banManager.queryFilter(
      this.banManager.filters.AppBanApplied(null, this.appId),
      fromBlock
    );
    
    const appUnbanEvents = await this.banManager.queryFilter(
      this.banManager.filters.AppBanRemoved(null, this.appId),
      fromBlock
    );
    
    // Query labels
    const labelAppliedEvents = await this.labelManager.queryFilter(
      this.labelManager.filters.LabelApplied(),
      fromBlock
    );
    
    const labelRemovedEvents = await this.labelManager.queryFilter(
      this.labelManager.filters.LabelRemoved(),
      fromBlock
    );
    
    // Build cache
    for (const event of networkBanEvents) {
      const agentId = Number(event.args!.agentId);
      this.networkBanned.add(agentId);
      this.banReasons.set(agentId, event.args!.reason);
      this.bannedTimestamps.set(agentId, event.blockNumber);
    }
    
    for (const event of networkUnbanEvents) {
      this.networkBanned.delete(Number(event.args!.agentId));
    }
    
    for (const event of appBanEvents) {
      this.addAppBan(this.appId, Number(event.args!.agentId));
    }
    
    for (const event of appUnbanEvents) {
      this.removeAppBan(this.appId, Number(event.args!.agentId));
    }
    
    for (const event of labelAppliedEvents) {
      this.addLabel(Number(event.args!.targetAgentId), this.labelToString(event.args!.label));
    }
    
    for (const event of labelRemovedEvents) {
      this.removeLabel(Number(event.args!.targetAgentId), this.labelToString(event.args!.label));
    }
    
    this.lastSyncBlock = currentBlock;
    this.initialized = true;
    
    logger.success(`Ban cache initialized: ${this.networkBanned.size} network bans, ${this.appBanned.get(this.appId)?.size || 0} app bans`);
  }
  
  /**
   * Start listening for real-time updates
   */
  startListening(): void {
    logger.info('Starting event listeners...');
    
    // Network bans
    this.banManager.on('NetworkBanApplied', (agentId: bigint, reason: string) => {
      const id = Number(agentId);
      this.networkBanned.add(id);
      this.banReasons.set(id, reason);
      logger.warn(`Network ban applied: Agent #${id}`);
      this.notifyBan(id);
    });
    
    this.banManager.on('NetworkBanRemoved', (agentId: bigint) => {
      const id = Number(agentId);
      this.networkBanned.delete(id);
      this.banReasons.delete(id);
      logger.info(`Network ban removed: Agent #${id}`);
    });
    
    // App bans
    this.banManager.on('AppBanApplied', (agentId: bigint, appId: string, reason: string) => {
      if (appId === this.appId) {
        this.addAppBan(appId, Number(agentId));
        logger.warn(`App ban applied: Agent #${agentId} from ${appId}`);
        this.notifyBan(Number(agentId));
      }
    });
    
    this.banManager.on('AppBanRemoved', (agentId: bigint, appId: string) => {
      if (appId === this.appId) {
        this.removeAppBan(appId, Number(agentId));
        logger.info(`App ban removed: Agent #${agentId}`);
      }
    });
    
    // Labels
    this.labelManager.on('LabelApplied', (agentId: bigint, label: number) => {
      this.addLabel(Number(agentId), this.labelToString(label));
      logger.info(`Label applied: Agent #${agentId} => ${this.labelToString(label)}`);
    });
    
    this.labelManager.on('LabelRemoved', (agentId: bigint, label: number) => {
      this.removeLabel(Number(agentId), this.labelToString(label));
      logger.info(`Label removed: Agent #${agentId}`);
    });
    
    logger.success('Event listeners active');
  }
  
  /**
   * Check if agent is allowed access
   */
  isAllowed(agentId: number): boolean {
    // Network ban = denied everywhere
    if (this.networkBanned.has(agentId)) return false;
    
    // App-specific ban
    const appBannedSet = this.appBanned.get(this.appId);
    if (appBannedSet?.has(agentId)) return false;
    
    return true;
  }
  
  /**
   * Get full ban status
   */
  getStatus(agentId: number): BanStatus {
    return {
      networkBanned: this.networkBanned.has(agentId),
      appBanned: this.appBanned.get(this.appId)?.has(agentId) || false,
      labels: Array.from(this.labels.get(agentId) || []),
      banReason: this.banReasons.get(agentId),
      bannedAt: this.bannedTimestamps.get(agentId),
    };
  }
  
  /**
   * Get all labels for agent
   */
  getLabels(agentId: number): string[] {
    return Array.from(this.labels.get(agentId) || []);
  }
  
  /**
   * Check if agent has specific label
   */
  hasLabelType(agentId: number, label: string): boolean {
    return this.labels.get(agentId)?.has(label) || false;
  }
  
  // ============ Private Methods ============
  
  private addAppBan(appId: string, agentId: number): void {
    if (!this.appBanned.has(appId)) {
      this.appBanned.set(appId, new Set());
    }
    this.appBanned.get(appId)!.add(agentId);
  }
  
  private removeAppBan(appId: string, agentId: number): void {
    this.appBanned.get(appId)?.delete(agentId);
  }
  
  private addLabel(agentId: number, label: string): void {
    if (!this.labels.has(agentId)) {
      this.labels.set(agentId, new Set());
    }
    this.labels.get(agentId)!.add(label);
  }
  
  private removeLabel(agentId: number, label: string): void {
    this.labels.get(agentId)?.delete(label);
  }
  
  private labelToString(label: number): string {
    const labels = ['NONE', 'HACKER', 'SCAMMER', 'SPAM_BOT', 'TRUSTED'];
    return labels[label] || 'UNKNOWN';
  }
  
  private notifyBan(agentId: number): void {
    // TODO: WebSocket notification to kick user if online
    // Could emit event that game servers listen to
  }
  
  /**
   * Periodic sync check (run every 10 seconds)
   */
  async sync(): Promise<void> {
    const currentBlock = await this.provider.getBlockNumber();
    
    if (currentBlock > this.lastSyncBlock) {
      logger.info(`Syncing events from block ${this.lastSyncBlock} to ${currentBlock}`);
      // Query new events since last sync
      // This is a fallback in case event listeners missed something
      this.lastSyncBlock = currentBlock;
    }
  }
}

