/**
 * Proof-of-Cloud Monitor
 * 
 * Continuous monitoring service for TEE verification status.
 * Handles re-verification scheduling and revocation detection.
 */

import {
  createPublicClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type Chain,
} from 'viem';
import { base, baseSepolia } from 'viem/chains';
import {
  type PoCRevocation,
  type PoCVerificationEvent,
  type PoCEventListener,
  type AgentPoCStatus,
} from './types';
import { PoCVerifier } from './verifier';
import { PoCRegistryClient, createRegistryClient } from './registry-client';

// ============================================================================
// Monitor Configuration
// ============================================================================

interface PoCMonitorConfig {
  /** Chain configuration */
  chain: Chain;
  /** RPC URL */
  rpcUrl: string;
  /** ProofOfCloudValidator contract address */
  validatorAddress: Address;
  /** IdentityRegistry contract address */
  identityRegistryAddress: Address;
  /** Check interval in ms */
  checkInterval: number;
  /** Re-verification threshold in ms (before expiry) */
  reverificationThreshold: number;
  /** Enable revocation websocket subscription */
  enableRevocationWatch: boolean;
  /** Batch size for agent checks */
  batchSize: number;
}

// ============================================================================
// Contract ABIs
// ============================================================================

const POC_VALIDATOR_ABI = [
  {
    name: 'getAgentStatus',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [
      { name: 'verified', type: 'bool' },
      { name: 'level', type: 'uint8' },
      { name: 'hardwareIdHash', type: 'bytes32' },
      { name: 'expiresAt', type: 'uint256' },
    ],
  },
  {
    name: 'needsReverification',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'getHardwareRecord',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'hardwareIdHash', type: 'bytes32' }],
    outputs: [
      { name: 'hardwareIdHash', type: 'bytes32' },
      { name: 'level', type: 'uint8' },
      { name: 'agentId', type: 'uint256' },
      { name: 'verifiedAt', type: 'uint256' },
      { name: 'expiresAt', type: 'uint256' },
      { name: 'revoked', type: 'bool' },
      { name: 'cloudProvider', type: 'string' },
      { name: 'region', type: 'string' },
    ],
  },
] as const;

const IDENTITY_REGISTRY_ABI = [
  {
    name: 'totalAgents',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'agentExists',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'getAgentTags',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string[]' }],
  },
] as const;

// ============================================================================
// Monitor State
// ============================================================================

interface MonitoredAgent {
  agentId: bigint;
  hardwareIdHash: Hex | null;
  lastChecked: number;
  expiresAt: number;
  status: 'verified' | 'pending' | 'expired' | 'revoked' | 'unknown';
}

interface RevocationAlert {
  hardwareIdHash: Hex;
  agentId: bigint;
  reason: string;
  timestamp: number;
  handled: boolean;
}

// ============================================================================
// PoCMonitor Class
// ============================================================================

export class PoCMonitor {
  private readonly config: PoCMonitorConfig;
  private readonly publicClient: PublicClient;
  private readonly registryClient: PoCRegistryClient;
  private readonly verifier: PoCVerifier | null;

  private readonly monitoredAgents: Map<string, MonitoredAgent> = new Map();
  private readonly revocationAlerts: RevocationAlert[] = [];
  private readonly eventListeners: Set<PoCEventListener> = new Set();

  private checkIntervalId: ReturnType<typeof setInterval> | null = null;
  private revocationUnsubscribe: (() => void) | null = null;
  private isRunning: boolean = false;

  constructor(
    config: PoCMonitorConfig,
    verifier?: PoCVerifier,
  ) {
    this.config = config;
    this.verifier = verifier ?? null;

    this.publicClient = createPublicClient({
      chain: config.chain,
      transport: http(config.rpcUrl),
    });

    this.registryClient = createRegistryClient();
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Start the monitor
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[PoCMonitor] Already running');
      return;
    }

    console.log('[PoCMonitor] Starting...');
    this.isRunning = true;

    // Initial scan for TEE agents
    await this.scanTEEAgents();

    // Start periodic checks
    this.checkIntervalId = setInterval(
      () => this.runChecks(),
      this.config.checkInterval,
    );

    // Subscribe to revocations
    if (this.config.enableRevocationWatch) {
      this.startRevocationWatch();
    }

    console.log('[PoCMonitor] Started');
  }

  /**
   * Stop the monitor
   */
  stop(): void {
    if (!this.isRunning) return;

    console.log('[PoCMonitor] Stopping...');
    this.isRunning = false;

    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = null;
    }

    if (this.revocationUnsubscribe) {
      this.revocationUnsubscribe();
      this.revocationUnsubscribe = null;
    }

    console.log('[PoCMonitor] Stopped');
  }

  // ============================================================================
  // Agent Management
  // ============================================================================

  /**
   * Add an agent to monitoring
   */
  addAgent(agentId: bigint): void {
    const key = agentId.toString();
    if (!this.monitoredAgents.has(key)) {
      this.monitoredAgents.set(key, {
        agentId,
        hardwareIdHash: null,
        lastChecked: 0,
        expiresAt: 0,
        status: 'unknown',
      });
    }
  }

  /**
   * Remove an agent from monitoring
   */
  removeAgent(agentId: bigint): void {
    this.monitoredAgents.delete(agentId.toString());
  }

  /**
   * Get monitored agent status
   */
  getAgentMonitorStatus(agentId: bigint): MonitoredAgent | null {
    return this.monitoredAgents.get(agentId.toString()) ?? null;
  }

  /**
   * Get all monitored agents
   */
  getAllMonitoredAgents(): MonitoredAgent[] {
    return Array.from(this.monitoredAgents.values());
  }

  /**
   * Get agents needing attention (expired, revoked, etc.)
   */
  getAgentsNeedingAttention(): MonitoredAgent[] {
    const now = Date.now();
    return Array.from(this.monitoredAgents.values()).filter(agent => {
      if (agent.status === 'revoked') return true;
      if (agent.status === 'expired') return true;
      if (agent.status === 'verified' && 
          agent.expiresAt > 0 && 
          agent.expiresAt - now < this.config.reverificationThreshold) {
        return true;
      }
      return false;
    });
  }

  // ============================================================================
  // Verification Checks
  // ============================================================================

  /**
   * Scan for TEE-tagged agents in the registry
   */
  private async scanTEEAgents(): Promise<void> {
    const totalAgents = await this.publicClient.readContract({
      address: this.config.identityRegistryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'totalAgents',
    });

    console.log(`[PoCMonitor] Scanning ${totalAgents} agents for TEE tags...`);

    // Scan in batches
    for (let i = 1n; i <= totalAgents; i += BigInt(this.config.batchSize)) {
      const batch: bigint[] = [];
      for (let j = i; j < i + BigInt(this.config.batchSize) && j <= totalAgents; j++) {
        batch.push(j);
      }

      await Promise.all(batch.map(async (agentId) => {
        const exists = await this.publicClient.readContract({
          address: this.config.identityRegistryAddress,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'agentExists',
          args: [agentId],
        });

        if (!exists) return;

        // Check if agent has TEE-related tags
        const tags = await this.publicClient.readContract({
          address: this.config.identityRegistryAddress,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'getAgentTags',
          args: [agentId],
        });

        const hasTEETag = tags.some((tag: string) => 
          tag.toLowerCase().includes('tee') || 
          tag.toLowerCase().includes('tdx') ||
          tag.toLowerCase().includes('sgx') ||
          tag.toLowerCase().includes('sev'),
        );

        if (hasTEETag) {
          this.addAgent(agentId);
        }
      }));
    }

    console.log(`[PoCMonitor] Found ${this.monitoredAgents.size} TEE agents`);
  }

  /**
   * Run periodic verification checks
   */
  private async runChecks(): Promise<void> {
    if (!this.isRunning) return;

    const now = Date.now();
    const agents = Array.from(this.monitoredAgents.values());

    // Process in batches
    for (let i = 0; i < agents.length; i += this.config.batchSize) {
      const batch = agents.slice(i, i + this.config.batchSize);
      
      await Promise.all(batch.map(agent => this.checkAgent(agent)));
    }

    // Process any pending revocation alerts
    await this.processRevocationAlerts();
  }

  /**
   * Check a single agent's verification status
   */
  private async checkAgent(agent: MonitoredAgent): Promise<void> {
    const result = await this.publicClient.readContract({
      address: this.config.validatorAddress,
      abi: POC_VALIDATOR_ABI,
      functionName: 'getAgentStatus',
      args: [agent.agentId],
    });

    const [verified, level, hardwareIdHash, expiresAt] = result;

    agent.lastChecked = Date.now();
    agent.hardwareIdHash = hardwareIdHash as Hex;
    agent.expiresAt = Number(expiresAt) * 1000; // Convert to ms

    // Determine status
    if (!verified && hardwareIdHash === '0x0000000000000000000000000000000000000000000000000000000000000000') {
      agent.status = 'unknown';
    } else if (!verified) {
      // Check if revoked or expired
      const record = await this.publicClient.readContract({
        address: this.config.validatorAddress,
        abi: POC_VALIDATOR_ABI,
        functionName: 'getHardwareRecord',
        args: [hardwareIdHash as `0x${string}`],
      });

      const revoked = record[5]; // revoked field
      agent.status = revoked ? 'revoked' : 'expired';
    } else {
      agent.status = 'verified';

      // Check if approaching expiry
      const timeUntilExpiry = agent.expiresAt - Date.now();
      if (timeUntilExpiry < this.config.reverificationThreshold) {
        this.emitEvent({
          type: 'result',
          timestamp: Date.now(),
          agentId: agent.agentId,
          requestHash: null,
          status: 'verified',
          level: level as 1 | 2 | 3,
          error: null,
          metadata: { 
            warning: 'approaching_expiry',
            expiresIn: timeUntilExpiry,
          },
        });
      }
    }

    // Emit status update
    this.emitEvent({
      type: 'result',
      timestamp: Date.now(),
      agentId: agent.agentId,
      requestHash: null,
      status: agent.status === 'verified' ? 'verified' : 
              agent.status === 'revoked' ? 'revoked' : 
              agent.status === 'expired' ? 'rejected' : 'unknown',
      level: verified ? (level as 1 | 2 | 3) : null,
      error: null,
      metadata: { hardwareIdHash: agent.hardwareIdHash },
    });
  }

  // ============================================================================
  // Revocation Handling
  // ============================================================================

  /**
   * Start watching for revocations
   */
  private startRevocationWatch(): void {
    this.revocationUnsubscribe = this.registryClient.subscribeToRevocations(
      (revocation) => this.handleRevocation(revocation),
      (error) => console.error('[PoCMonitor] Revocation watch error:', error),
    );
  }

  /**
   * Handle incoming revocation
   */
  private handleRevocation(revocation: PoCRevocation): void {
    console.log(`[PoCMonitor] Revocation received: ${revocation.hardwareIdHash}`);

    // Find affected agents
    for (const agent of this.monitoredAgents.values()) {
      if (agent.hardwareIdHash === revocation.hardwareIdHash) {
        this.revocationAlerts.push({
          hardwareIdHash: revocation.hardwareIdHash,
          agentId: agent.agentId,
          reason: revocation.reason,
          timestamp: revocation.timestamp,
          handled: false,
        });

        // Update agent status immediately
        agent.status = 'revoked';

        this.emitEvent({
          type: 'revocation',
          timestamp: Date.now(),
          agentId: agent.agentId,
          requestHash: null,
          status: 'revoked',
          level: null,
          error: null,
          metadata: { 
            reason: revocation.reason,
            evidenceHash: revocation.evidenceHash,
          },
        });
      }
    }
  }

  /**
   * Process pending revocation alerts
   */
  private async processRevocationAlerts(): Promise<void> {
    const unhandled = this.revocationAlerts.filter(a => !a.handled);
    
    for (const alert of unhandled) {
      // If we have a verifier, trigger on-chain revocation
      if (this.verifier) {
        await this.verifier.revokeHardware(alert.hardwareIdHash, alert.reason);
      }
      
      alert.handled = true;
    }

    // Clean up old alerts
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
    const toRemove = this.revocationAlerts.filter(
      a => a.handled && a.timestamp < cutoff,
    );
    for (const alert of toRemove) {
      const idx = this.revocationAlerts.indexOf(alert);
      if (idx >= 0) {
        this.revocationAlerts.splice(idx, 1);
      }
    }
  }

  /**
   * Get pending revocation alerts
   */
  getRevocationAlerts(): RevocationAlert[] {
    return [...this.revocationAlerts];
  }

  // ============================================================================
  // Re-verification
  // ============================================================================

  /**
   * Trigger re-verification for an agent
   */
  async triggerReverification(agentId: bigint, quote: Hex): Promise<void> {
    if (!this.verifier) {
      throw new Error('Verifier not configured for re-verification');
    }

    console.log(`[PoCMonitor] Triggering re-verification for agent ${agentId}`);

    await this.verifier.verifyAttestation(agentId, quote);

    // Refresh agent status
    const agent = this.monitoredAgents.get(agentId.toString());
    if (agent) {
      await this.checkAgent(agent);
    }
  }

  /**
   * Get agents due for re-verification
   */
  getAgentsDueForReverification(): bigint[] {
    const threshold = Date.now() + this.config.reverificationThreshold;
    
    return Array.from(this.monitoredAgents.values())
      .filter(agent => 
        agent.status === 'verified' && 
        agent.expiresAt > 0 && 
        agent.expiresAt < threshold,
      )
      .map(agent => agent.agentId);
  }

  // ============================================================================
  // Event Subscription
  // ============================================================================

  /**
   * Subscribe to monitor events
   */
  addEventListener(listener: PoCEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private emitEvent(event: PoCVerificationEvent): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  // ============================================================================
  // Stats
  // ============================================================================

  /**
   * Get monitor statistics
   */
  getStats(): {
    totalMonitored: number;
    verified: number;
    expired: number;
    revoked: number;
    unknown: number;
    pendingAlerts: number;
  } {
    const agents = Array.from(this.monitoredAgents.values());
    
    return {
      totalMonitored: agents.length,
      verified: agents.filter(a => a.status === 'verified').length,
      expired: agents.filter(a => a.status === 'expired').length,
      revoked: agents.filter(a => a.status === 'revoked').length,
      unknown: agents.filter(a => a.status === 'unknown').length,
      pendingAlerts: this.revocationAlerts.filter(a => !a.handled).length,
    };
  }

  // ============================================================================
  // Static Factory
  // ============================================================================

  /**
   * Create monitor from environment variables
   */
  static fromEnv(verifier?: PoCVerifier): PoCMonitor {
    const network = process.env.NETWORK ?? 'testnet';
    const chain = network === 'mainnet' ? base : baseSepolia;
    const rpcUrl = process.env.RPC_URL ?? (network === 'mainnet' 
      ? 'https://mainnet.base.org'
      : 'https://sepolia.base.org');

    const validatorAddress = process.env.POC_VALIDATOR_ADDRESS;
    if (!validatorAddress) {
      throw new Error('POC_VALIDATOR_ADDRESS environment variable required');
    }

    const identityRegistryAddress = process.env.IDENTITY_REGISTRY_ADDRESS;
    if (!identityRegistryAddress) {
      throw new Error('IDENTITY_REGISTRY_ADDRESS environment variable required');
    }

    return new PoCMonitor({
      chain,
      rpcUrl,
      validatorAddress: validatorAddress as Address,
      identityRegistryAddress: identityRegistryAddress as Address,
      checkInterval: Number(process.env.POC_CHECK_INTERVAL) || 60 * 60 * 1000, // 1 hour
      reverificationThreshold: Number(process.env.POC_REVERIFY_THRESHOLD) || 24 * 60 * 60 * 1000, // 24 hours
      enableRevocationWatch: process.env.POC_REVOCATION_WATCH !== 'false',
      batchSize: Number(process.env.POC_BATCH_SIZE) || 10,
    }, verifier);
  }
}

