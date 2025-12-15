/**
 * Ethereum Beacon Chain Watcher
 *
 * Monitors the Ethereum beacon chain for:
 * - Finalized blocks
 * - Sync committee updates
 * - Light client updates
 *
 * Posts data to the relayer for ZK proof generation and
 * submission to the Solana EVM light client.
 */

import { createPublicClient, http, type PublicClient, type Hex } from 'viem';
import { mainnet } from 'viem/chains';

// =============================================================================
// TYPES
// =============================================================================

export interface BeaconConfig {
  /** Beacon node RPC URL */
  beaconRpcUrl: string;
  /** Execution layer RPC URL */
  executionRpcUrl: string;
  /** Relayer endpoint to post updates */
  relayerEndpoint: string;
  /** Polling interval in milliseconds */
  pollingIntervalMs: number;
  /** Number of confirmations before considering finalized */
  finalityConfirmations: number;
}

export interface BeaconBlockHeader {
  slot: bigint;
  proposerIndex: bigint;
  parentRoot: Hex;
  stateRoot: Hex;
  bodyRoot: Hex;
}

export interface SyncCommittee {
  pubkeys: Hex[];
  aggregatePubkey: Hex;
}

export interface SyncAggregate {
  syncCommitteeBits: Hex;
  syncCommitteeSignature: Hex;
}

export interface LightClientUpdate {
  attestedHeader: BeaconBlockHeader;
  finalizedHeader: BeaconBlockHeader;
  finalityBranch: Hex[];
  syncAggregate: SyncAggregate;
  signatureSlot: bigint;
}

export interface FinalityUpdate {
  slot: bigint;
  blockRoot: Hex;
  stateRoot: Hex;
  executionStateRoot: Hex;
  executionBlockNumber: bigint;
  executionBlockHash: Hex;
}

// =============================================================================
// BEACON CLIENT
// =============================================================================

export class BeaconChainWatcher {
  private config: BeaconConfig;
  private executionClient: PublicClient;
  private running = false;
  private lastProcessedSlot = BigInt(0);
  private currentSyncCommitteeRoot: Hex = '0x';

  constructor(config: BeaconConfig) {
    this.config = config;
    this.executionClient = createPublicClient({
      chain: mainnet,
      transport: http(config.executionRpcUrl),
    });
  }

  /**
   * Start watching the beacon chain
   */
  async start(): Promise<void> {
    console.log('[BeaconWatcher] Starting...');
    this.running = true;

    // Initialize with current finalized state
    await this.initializeState();

    // Start polling loop
    this.pollLoop();
  }

  /**
   * Stop watching
   */
  stop(): void {
    console.log('[BeaconWatcher] Stopping...');
    this.running = false;
  }

  /**
   * Initialize with current finalized state
   */
  private async initializeState(): Promise<void> {
    const finalized = await this.getFinalizedCheckpoint();
    this.lastProcessedSlot = finalized.slot;
    console.log(`[BeaconWatcher] Initialized at slot ${finalized.slot}`);
  }

  /**
   * Main polling loop
   */
  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.checkForUpdates();
      } catch (error) {
        console.error('[BeaconWatcher] Error in poll loop:', error);
      }

      await this.sleep(this.config.pollingIntervalMs);
    }
  }

  /**
   * Check for new finalized blocks and sync committee updates
   */
  private async checkForUpdates(): Promise<void> {
    // Get current finalized checkpoint
    const finalized = await this.getFinalizedCheckpoint();

    if (finalized.slot <= this.lastProcessedSlot) {
      return; // No new finalized blocks
    }

    console.log(
      `[BeaconWatcher] New finalized slot: ${finalized.slot} (was ${this.lastProcessedSlot})`
    );

    // Get light client update
    const update = await this.getLightClientUpdate(finalized.slot);

    if (update) {
      // Post to relayer
      await this.postToRelayer('/ethereum/update', update);

      // Check for sync committee rotation
      if (this.isSyncCommitteeRotation(finalized.slot)) {
        const newCommittee = await this.getNextSyncCommittee();
        if (newCommittee) {
          await this.postToRelayer('/ethereum/sync-committee', newCommittee);
        }
      }
    }

    // Get finality update for Solana light client
    const finalityUpdate = await this.buildFinalityUpdate(finalized);
    await this.postToRelayer('/ethereum/finality', finalityUpdate);

    this.lastProcessedSlot = finalized.slot;
  }

  /**
   * Get finalized checkpoint from beacon node
   */
  private async getFinalizedCheckpoint(): Promise<{ slot: bigint; root: Hex }> {
    const response = await fetch(
      `${this.config.beaconRpcUrl}/eth/v1/beacon/states/finalized/finality_checkpoints`
    );

    if (!response.ok) {
      throw new Error(`Failed to get finalized checkpoint: ${response.status}`);
    }

    const data = (await response.json()) as {
      data: {
        finalized: { epoch: string; root: string };
      };
    };

    const epoch = BigInt(data.data.finalized.epoch);
    const slot = epoch * BigInt(32); // 32 slots per epoch

    return {
      slot,
      root: data.data.finalized.root as Hex,
    };
  }

  /**
   * Get light client update for a slot
   */
  private async getLightClientUpdate(
    slot: bigint
  ): Promise<LightClientUpdate | null> {
    try {
      const period = slot / BigInt(8192); // Sync committee period
      const response = await fetch(
        `${this.config.beaconRpcUrl}/eth/v1/beacon/light_client/updates?start_period=${period}&count=1`
      );

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as {
        data: Array<{
          attested_header: { beacon: BeaconBlockHeader };
          finalized_header: { beacon: BeaconBlockHeader };
          finality_branch: string[];
          sync_aggregate: { sync_committee_bits: string; sync_committee_signature: string };
          signature_slot: string;
        }>;
      };

      if (data.data.length === 0) {
        return null;
      }

      const update = data.data[0];
      return {
        attestedHeader: update.attested_header.beacon,
        finalizedHeader: update.finalized_header.beacon,
        finalityBranch: update.finality_branch as Hex[],
        syncAggregate: {
          syncCommitteeBits: update.sync_aggregate.sync_committee_bits as Hex,
          syncCommitteeSignature: update.sync_aggregate
            .sync_committee_signature as Hex,
        },
        signatureSlot: BigInt(update.signature_slot),
      };
    } catch (error) {
      console.error('[BeaconWatcher] Failed to get light client update:', error);
      return null;
    }
  }

  /**
   * Get next sync committee
   */
  private async getNextSyncCommittee(): Promise<SyncCommittee | null> {
    try {
      const response = await fetch(
        `${this.config.beaconRpcUrl}/eth/v1/beacon/states/finalized/sync_committees`
      );

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as {
        data: {
          validators: string[];
        };
      };

      // In production, would aggregate pubkeys properly
      return {
        pubkeys: data.data.validators.slice(0, 512) as Hex[],
        aggregatePubkey: '0x' as Hex, // Would compute aggregate
      };
    } catch (error) {
      console.error('[BeaconWatcher] Failed to get sync committee:', error);
      return null;
    }
  }

  /**
   * Build finality update for Solana light client
   */
  private async buildFinalityUpdate(finalized: {
    slot: bigint;
    root: Hex;
  }): Promise<FinalityUpdate> {
    // Get execution payload for the finalized block
    const block = await this.executionClient.getBlock({
      blockTag: 'finalized',
    });

    // Get state root from beacon state
    const stateRoot = await this.getStateRoot(finalized.slot);

    return {
      slot: finalized.slot,
      blockRoot: finalized.root,
      stateRoot,
      executionStateRoot: block.stateRoot,
      executionBlockNumber: block.number,
      executionBlockHash: block.hash,
    };
  }

  /**
   * Get beacon state root for a slot
   */
  private async getStateRoot(slot: bigint): Promise<Hex> {
    try {
      const response = await fetch(
        `${this.config.beaconRpcUrl}/eth/v1/beacon/headers/${slot}`
      );

      if (!response.ok) {
        return '0x0000000000000000000000000000000000000000000000000000000000000000';
      }

      const data = (await response.json()) as {
        data: { header: { message: { state_root: string } } };
      };

      return data.data.header.message.state_root as Hex;
    } catch {
      return '0x0000000000000000000000000000000000000000000000000000000000000000';
    }
  }

  /**
   * Check if this slot is a sync committee rotation boundary
   */
  private isSyncCommitteeRotation(slot: bigint): boolean {
    // Sync committees rotate every 256 epochs (8192 slots)
    return slot % BigInt(8192) === BigInt(0);
  }

  /**
   * Post data to relayer
   */
  private async postToRelayer(path: string, data: unknown): Promise<void> {
    try {
      const response = await fetch(`${this.config.relayerEndpoint}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data, (_, v) =>
          typeof v === 'bigint' ? v.toString() : v
        ),
      });

      if (!response.ok) {
        console.error(
          `[BeaconWatcher] Failed to post to ${path}: ${response.status}`
        );
      } else {
        console.log(`[BeaconWatcher] Posted update to ${path}`);
      }
    } catch (error) {
      console.error(`[BeaconWatcher] Error posting to ${path}:`, error);
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// =============================================================================
// FACTORY
// =============================================================================

export function createBeaconWatcher(config: BeaconConfig): BeaconChainWatcher {
  return new BeaconChainWatcher(config);
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

if (import.meta.main) {
  const config: BeaconConfig = {
    beaconRpcUrl:
      process.env.BEACON_RPC_URL ?? 'http://localhost:5052',
    executionRpcUrl:
      process.env.EXECUTION_RPC_URL ?? 'http://localhost:8545',
    relayerEndpoint: process.env.RELAYER_ENDPOINT ?? 'http://localhost:8081',
    pollingIntervalMs: 12000, // 12 seconds (slot time)
    finalityConfirmations: 2,
  };

  const watcher = createBeaconWatcher(config);

  process.on('SIGINT', () => {
    watcher.stop();
    process.exit(0);
  });

  watcher.start().catch(console.error);
}
