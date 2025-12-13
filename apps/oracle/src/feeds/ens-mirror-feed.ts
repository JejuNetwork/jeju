/**
 * ENS Mirror Oracle Feed
 * 
 * An oracle feed that reads ENS state from Ethereum mainnet and
 * reports it for the ENSMirror contract to sync to JNS.
 * 
 * This integrates with the Jeju Oracle Network to provide
 * decentralized ENS resolution.
 */

import { createPublicClient, http, type Address, type Hex, namehash, keccak256, encodePacked, toBytes } from 'viem';
import { mainnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as const;

const ENS_REGISTRY_ABI = [
  {
    name: 'resolver',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
  },
] as const;

const ENS_RESOLVER_ABI = [
  {
    name: 'contenthash',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'bytes' }],
  },
  {
    name: 'addr',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'text',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ type: 'string' }],
  },
] as const;

export interface ENSState {
  ensNode: Hex;
  contenthash: Hex;
  ethAddress: Address;
  textRecords: Record<string, string>;
  blockNumber: bigint;
  timestamp: number;
}

export interface SignedENSReport {
  state: ENSState;
  signature: Hex;
  oracle: Address;
}

export interface ENSMirrorFeedConfig {
  ethRpcUrl: string;
  oraclePrivateKey: Hex;
  pollIntervalMs: number;
  watchedNames: string[];
}

export class ENSMirrorFeed {
  private ethClient;
  private account;
  private config: ENSMirrorFeedConfig;
  private running = false;
  private pollInterval?: Timer;
  private lastStates: Map<string, ENSState> = new Map();

  constructor(config: ENSMirrorFeedConfig) {
    this.config = config;
    this.ethClient = createPublicClient({
      chain: mainnet,
      transport: http(config.ethRpcUrl),
    });
    this.account = privateKeyToAccount(config.oraclePrivateKey);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log(`[ENS Feed] Starting with ${this.config.watchedNames.length} names`);

    // Initial fetch
    await this.pollAllNames();

    // Schedule periodic polling
    this.pollInterval = setInterval(
      () => this.pollAllNames(),
      this.config.pollIntervalMs
    );
  }

  stop(): void {
    this.running = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    console.log('[ENS Feed] Stopped');
  }

  async pollAllNames(): Promise<SignedENSReport[]> {
    const reports: SignedENSReport[] = [];

    for (const name of this.config.watchedNames) {
      const report = await this.fetchAndSign(name);
      if (report) {
        reports.push(report);
      }
    }

    return reports;
  }

  async fetchAndSign(name: string): Promise<SignedENSReport | null> {
    const state = await this.fetchENSState(name);
    if (!state) return null;

    // Check if changed from last state
    const lastState = this.lastStates.get(name);
    if (lastState && this.statesEqual(lastState, state)) {
      return null; // No change
    }

    this.lastStates.set(name, state);

    // Sign the state
    const signature = await this.signState(state);

    console.log(`[ENS Feed] New state for ${name}: contenthash=${state.contenthash !== '0x'}`);

    return {
      state,
      signature,
      oracle: this.account.address,
    };
  }

  async fetchENSState(name: string): Promise<ENSState | null> {
    const node = namehash(name) as Hex;

    // Get resolver
    const resolverAddr = await this.ethClient.readContract({
      address: ENS_REGISTRY,
      abi: ENS_REGISTRY_ABI,
      functionName: 'resolver',
      args: [node],
    });

    if (resolverAddr === '0x0000000000000000000000000000000000000000') {
      return null;
    }

    // Fetch records in parallel
    const [contenthash, ethAddress, blockNumber] = await Promise.all([
      this.ethClient.readContract({
        address: resolverAddr,
        abi: ENS_RESOLVER_ABI,
        functionName: 'contenthash',
        args: [node],
      }).catch(() => '0x' as Hex),
      this.ethClient.readContract({
        address: resolverAddr,
        abi: ENS_RESOLVER_ABI,
        functionName: 'addr',
        args: [node],
      }).catch(() => '0x0000000000000000000000000000000000000000' as Address),
      this.ethClient.getBlockNumber(),
    ]);

    // Fetch common text records
    const textKeys = ['avatar', 'url', 'description', 'com.twitter', 'com.github'];
    const textRecords: Record<string, string> = {};

    for (const key of textKeys) {
      const value = await this.ethClient.readContract({
        address: resolverAddr,
        abi: ENS_RESOLVER_ABI,
        functionName: 'text',
        args: [node, key],
      }).catch(() => '');

      if (value) {
        textRecords[key] = value;
      }
    }

    return {
      ensNode: node,
      contenthash: contenthash as Hex,
      ethAddress: ethAddress as Address,
      textRecords,
      blockNumber,
      timestamp: Date.now(),
    };
  }

  async signState(state: ENSState): Promise<Hex> {
    // Create deterministic hash of state
    const stateHash = keccak256(
      encodePacked(
        ['bytes32', 'bytes', 'address', 'uint256'],
        [state.ensNode, state.contenthash, state.ethAddress, state.blockNumber]
      )
    );

    // Sign with oracle key
    return await this.account.signMessage({
      message: { raw: toBytes(stateHash) },
    });
  }

  private statesEqual(a: ENSState, b: ENSState): boolean {
    return (
      a.contenthash === b.contenthash &&
      a.ethAddress === b.ethAddress &&
      JSON.stringify(a.textRecords) === JSON.stringify(b.textRecords)
    );
  }

  /**
   * Add a name to watch
   */
  addName(name: string): void {
    if (!this.config.watchedNames.includes(name)) {
      this.config.watchedNames.push(name);
      console.log(`[ENS Feed] Added ${name} to watch list`);
    }
  }

  /**
   * Remove a name from watch
   */
  removeName(name: string): void {
    const idx = this.config.watchedNames.indexOf(name);
    if (idx !== -1) {
      this.config.watchedNames.splice(idx, 1);
      this.lastStates.delete(name);
      console.log(`[ENS Feed] Removed ${name} from watch list`);
    }
  }

  /**
   * Get current watched names
   */
  getWatchedNames(): string[] {
    return [...this.config.watchedNames];
  }

  /**
   * Get oracle address
   */
  getOracleAddress(): Address {
    return this.account.address;
  }
}

/**
 * Create ENS mirror feed from environment
 */
export function createENSMirrorFeed(config?: Partial<ENSMirrorFeedConfig>): ENSMirrorFeed {
  const watchedNamesEnv = process.env.ENS_WATCH_NAMES;
  const watchedNames = watchedNamesEnv ? watchedNamesEnv.split(',').map(s => s.trim()) : [];

  return new ENSMirrorFeed({
    ethRpcUrl: config?.ethRpcUrl ?? process.env.ETH_RPC_URL ?? 'https://eth.llamarpc.com',
    oraclePrivateKey: (config?.oraclePrivateKey ?? process.env.ORACLE_PRIVATE_KEY ?? '0x0') as Hex,
    pollIntervalMs: config?.pollIntervalMs ?? 300000, // 5 minutes
    watchedNames: config?.watchedNames ?? watchedNames,
  });
}

// CLI entry point - run with: bun apps/oracle/src/feeds/ens-mirror-feed.ts
export async function main(): Promise<void> {
  const feed = createENSMirrorFeed({
    watchedNames: ['vitalik.eth', 'nick.eth', 'brantly.eth'],
  });

  process.on('SIGINT', () => {
    feed.stop();
    process.exit(0);
  });

  await feed.start();
}
