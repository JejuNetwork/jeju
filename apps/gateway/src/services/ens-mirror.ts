import { createPublicClient, createWalletClient, http, type Address, type Hex, parseAbi, namehash, keccak256, encodePacked, toBytes } from 'viem';
import { mainnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

interface ENSMirrorStatus {
  ensName: string;
  jnsName: string;
  lastSync: number;
  synced: boolean;
  ensContenthash?: string;
  jnsContenthash?: string;
  error?: string;
}

const ENS_REGISTRY_ADDRESS = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as const;

const ENS_REGISTRY_ABI = parseAbi([
  'function resolver(bytes32 node) view returns (address)',
  'function owner(bytes32 node) view returns (address)',
]);

const ENS_RESOLVER_ABI = parseAbi([
  'function contenthash(bytes32 node) view returns (bytes)',
  'function addr(bytes32 node) view returns (address)',
  'function text(bytes32 node, string key) view returns (string)',
]);

const ENS_MIRROR_ABI = parseAbi([
  'function registerMirror(bytes32 ensNode, bytes32 jnsNode, uint256 syncInterval, bool mirrorContenthash, bool mirrorAddress, string[] textKeys) returns (bytes32)',
  'function submitSyncReport((bytes32 ensNode, bytes contenthash, address ethAddress, string[] textKeys, string[] textValues, uint256 blockNumber, uint256 timestamp), (address oracle, bytes signature)[]) external',
  'function getMirrorsNeedingSync(uint256 maxResults) view returns (bytes32[])',
  'function getMirror(bytes32 mirrorId) view returns ((bytes32 ensNode, bytes32 jnsNode, address owner, uint256 syncInterval, uint256 lastSyncAt, bool mirrorContenthash, bool mirrorAddress, string[] textKeys, bool active, uint256 createdAt))',
]);

export interface ENSMirrorServiceConfig {
  ethRpcUrl: string;
  jejuRpcUrl: string;
  ensMirrorAddress: Address;
  oraclePrivateKey: Hex;
  syncIntervalMs: number;
}

interface SyncReport {
  ensNode: Hex;
  contenthash: Hex;
  ethAddress: Address;
  textKeys: string[];
  textValues: string[];
  blockNumber: bigint;
  timestamp: bigint;
}

export class ENSMirrorService {
  private ethClient;
  private jejuClient;
  private walletClient;
  private config: ENSMirrorServiceConfig;
  private running = false;
  private syncInterval?: Timer;
  private account;

  constructor(config: ENSMirrorServiceConfig) {
    this.config = config;
    this.ethClient = createPublicClient({
      chain: mainnet,
      transport: http(config.ethRpcUrl),
    });
    this.jejuClient = createPublicClient({
      transport: http(config.jejuRpcUrl),
    });

    if (config.oraclePrivateKey && config.oraclePrivateKey !== '0x0') {
      this.account = privateKeyToAccount(config.oraclePrivateKey);
      this.walletClient = createWalletClient({
        account: this.account,
        transport: http(config.jejuRpcUrl),
      });
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log('[ENS Mirror] Starting...');

    const initialResult = await this.syncAllMirrors();
    console.log(`[ENS Mirror] Initial: ${initialResult.synced} synced, ${initialResult.failed} failed`);

    this.syncInterval = setInterval(
      () => {
        this.syncAllMirrors().catch(error => {
          console.error('[ENS Mirror] Periodic sync failed:', error);
        });
      },
      this.config.syncIntervalMs
    );
  }

  stop(): void {
    this.running = false;
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
    console.log('[ENS Mirror] Service stopped');
  }

  async syncAllMirrors(): Promise<{ synced: number; failed: number; errors: string[] }> {
    const mirrorIds = await this.jejuClient.readContract({
      address: this.config.ensMirrorAddress,
      abi: ENS_MIRROR_ABI,
      functionName: 'getMirrorsNeedingSync',
      args: [50n],
    }) as Hex[];

    console.log(`[ENS Mirror] ${mirrorIds.length} mirrors need sync`);

    let synced = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const mirrorId of mirrorIds) {
      try {
        const result = await this.syncMirror(mirrorId);
        if (result.synced) {
          synced++;
        } else {
          failed++;
          if (result.error) {
            errors.push(`${mirrorId.slice(0, 10)}: ${result.error}`);
          }
        }
      } catch (error) {
        failed++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`${mirrorId.slice(0, 10)}: ${errorMsg}`);
        console.error(`[ENS Mirror] Failed to sync ${mirrorId}:`, error);
      }
    }

    console.log(`[ENS Mirror] Sync complete: ${synced} synced, ${failed} failed`);

    if (errors.length > 0) {
      console.error('[ENS Mirror] Errors:', errors.join('; '));
    }

    return { synced, failed, errors };
  }

  async syncMirror(mirrorId: Hex): Promise<ENSMirrorStatus> {
    const mirror = await this.jejuClient.readContract({
      address: this.config.ensMirrorAddress,
      abi: ENS_MIRROR_ABI,
      functionName: 'getMirror',
      args: [mirrorId],
    }) as {
      ensNode: Hex;
      jnsNode: Hex;
      owner: Address;
      syncInterval: bigint;
      lastSyncAt: bigint;
      mirrorContenthash: boolean;
      mirrorAddress: boolean;
      textKeys: string[];
      active: boolean;
      createdAt: bigint;
    };

    if (!mirror.active) {
      return {
        ensName: mirror.ensNode,
        jnsName: mirror.jnsNode,
        lastSync: Number(mirror.lastSyncAt),
        synced: false,
        error: 'Mirror not active',
      };
    }

    const report = await this.fetchENSState(
      mirror.ensNode,
      mirror.mirrorContenthash,
      mirror.mirrorAddress,
      mirror.textKeys
    );

    await this.submitReport(report);

    console.log(`[ENS Mirror] Synced ${mirrorId.slice(0, 10)}...`);

    return {
      ensName: mirror.ensNode,
      jnsName: mirror.jnsNode,
      lastSync: Date.now(),
      synced: true,
      ensContenthash: report.contenthash,
      jnsContenthash: report.contenthash,
    };
  }

  async fetchENSState(
    ensNode: Hex,
    fetchContenthash: boolean,
    fetchAddress: boolean,
    textKeys: string[]
  ): Promise<SyncReport> {
    const resolverAddr = await this.ethClient.readContract({
      address: ENS_REGISTRY_ADDRESS,
      abi: ENS_REGISTRY_ABI,
      functionName: 'resolver',
      args: [ensNode],
    }) as Address;

    let contenthash: Hex = '0x';
    let ethAddress: Address = '0x0000000000000000000000000000000000000000';
    const textValues: string[] = [];

    if (resolverAddr !== '0x0000000000000000000000000000000000000000') {
      if (fetchContenthash) {
        contenthash = await this.ethClient.readContract({
          address: resolverAddr,
          abi: ENS_RESOLVER_ABI,
          functionName: 'contenthash',
          args: [ensNode],
        }).catch(() => '0x' as Hex) as Hex;
      }

      if (fetchAddress) {
        ethAddress = await this.ethClient.readContract({
          address: resolverAddr,
          abi: ENS_RESOLVER_ABI,
          functionName: 'addr',
          args: [ensNode],
        }).catch(() => '0x0000000000000000000000000000000000000000' as Address) as Address;
      }

      for (const key of textKeys) {
        const value = await this.ethClient.readContract({
          address: resolverAddr,
          abi: ENS_RESOLVER_ABI,
          functionName: 'text',
          args: [ensNode, key],
        }).catch(() => '') as string;
        textValues.push(value);
      }
    }

    const blockNumber = await this.ethClient.getBlockNumber();

    return {
      ensNode,
      contenthash,
      ethAddress,
      textKeys,
      textValues,
      blockNumber,
      timestamp: BigInt(Date.now()),
    };
  }

  async submitReport(report: SyncReport): Promise<void> {
    if (!this.account || !this.walletClient) {
      throw new Error(
        'Cannot submit ENS mirror report: Oracle signing key not configured. ' +
        'Set ORACLE_PRIVATE_KEY environment variable.'
      );
    }

    const reportHash = keccak256(
      encodePacked(
        ['bytes32', 'bytes', 'address', 'uint256'],
        [report.ensNode, report.contenthash, report.ethAddress, report.blockNumber]
      )
    );

    const signature = await this.account.signMessage({
      message: { raw: toBytes(reportHash) },
    });

    console.log('[ENS Mirror] Report signed:', {
      ensNode: report.ensNode.slice(0, 10),
      signature: signature.slice(0, 20) + '...',
      blockNumber: report.blockNumber.toString(),
    });

    const { request } = await this.jejuClient.simulateContract({
      address: this.config.ensMirrorAddress,
      abi: ENS_MIRROR_ABI,
      functionName: 'submitSyncReport',
      args: [
        {
          ensNode: report.ensNode,
          contenthash: report.contenthash,
          ethAddress: report.ethAddress,
          textKeys: report.textKeys,
          textValues: report.textValues,
          blockNumber: report.blockNumber,
          timestamp: report.timestamp,
        },
        [
          {
            oracle: this.account.address,
            signature: signature,
          },
        ],
      ],
      account: this.account,
    });

    await this.walletClient.writeContract(request);
    console.log('[ENS Mirror] Report submitted on-chain');
  }

  async resolveENS(name: string): Promise<{
    address: Address | null;
    contenthash: Hex | null;
  }> {
    const node = namehash(name) as Hex;

    const resolverAddr = await this.ethClient.readContract({
      address: ENS_REGISTRY_ADDRESS,
      abi: ENS_REGISTRY_ABI,
      functionName: 'resolver',
      args: [node],
    }) as Address;

    if (resolverAddr === '0x0000000000000000000000000000000000000000') {
      return { address: null, contenthash: null };
    }

    const [address, contenthash] = await Promise.all([
      this.ethClient.readContract({
        address: resolverAddr,
        abi: ENS_RESOLVER_ABI,
        functionName: 'addr',
        args: [node],
      }).catch(() => null) as Promise<Address | null>,
      this.ethClient.readContract({
        address: resolverAddr,
        abi: ENS_RESOLVER_ABI,
        functionName: 'contenthash',
        args: [node],
      }).catch(() => null) as Promise<Hex | null>,
    ]);

    return { address, contenthash };
  }
}

export function createENSMirrorService(config: Partial<ENSMirrorServiceConfig>): ENSMirrorService {
  return new ENSMirrorService({
    ethRpcUrl: config.ethRpcUrl ?? process.env.ETH_RPC_URL ?? 'https://eth.llamarpc.com',
    jejuRpcUrl: config.jejuRpcUrl ?? process.env.JEJU_RPC_URL ?? 'http://127.0.0.1:9545',
    ensMirrorAddress: (config.ensMirrorAddress ?? process.env.ENS_MIRROR_ADDRESS ?? '0x0') as Address,
    oraclePrivateKey: (config.oraclePrivateKey ?? process.env.ORACLE_PRIVATE_KEY ?? '0x0') as Hex,
    syncIntervalMs: config.syncIntervalMs ?? 300000, // 5 minutes
  });
}
