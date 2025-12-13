import { ethers } from 'ethers';
import { Store } from '@subsquid/typeorm-store';
import { ProcessorContext } from './processor';
import {
  Keepalive,
  KeepaliveResource,
  KeepaliveHealthCheck,
  KeepaliveAutoFund,
  KeepaliveStatus,
  KeepaliveResourceType,
  ENSMirror,
  ENSMirrorSync,
  KeepaliveStats,
} from './model';
import { createAccountFactory, BlockHeader, LogData } from './lib/entities';

const EVENTS = {
  KEEPALIVE_REGISTERED: ethers.id('KeepaliveRegistered(bytes32,address,bytes32,uint256)'),
  KEEPALIVE_UPDATED: ethers.id('KeepaliveUpdated(bytes32)'),
  RESOURCE_ADDED: ethers.id('ResourceAdded(bytes32,uint8,string)'),
  RESOURCE_REMOVED: ethers.id('ResourceRemoved(bytes32,uint256)'),
  HEALTH_CHECKED: ethers.id('HealthChecked(bytes32,uint8,uint256,uint8,uint8)'),
  AUTO_FUNDED: ethers.id('AutoFunded(bytes32,uint256,address)'),
  STATUS_CHANGED: ethers.id('StatusChanged(bytes32,uint8,uint8)'),
  MIRROR_REGISTERED: ethers.id('MirrorRegistered(bytes32,bytes32,bytes32,address)'),
  MIRROR_SYNCED: ethers.id('MirrorSynced(bytes32,bytes32,uint256)'),
  SYNC_FAILED: ethers.id('SyncFailed(bytes32,string)'),
} as const;

const KEEPALIVE_EVENT_SET = new Set(Object.values(EVENTS));

const ABI = {
  keepalive: new ethers.Interface([
    'event KeepaliveRegistered(bytes32 indexed keepaliveId, address indexed owner, bytes32 indexed jnsNode, uint256 agentId)',
    'event KeepaliveUpdated(bytes32 indexed keepaliveId)',
    'event ResourceAdded(bytes32 indexed keepaliveId, uint8 resourceType, string identifier)',
    'event ResourceRemoved(bytes32 indexed keepaliveId, uint256 index)',
    'event HealthChecked(bytes32 indexed keepaliveId, uint8 status, uint256 balance, uint8 healthyResources, uint8 totalResources)',
    'event AutoFunded(bytes32 indexed keepaliveId, uint256 amount, address vault)',
    'event StatusChanged(bytes32 indexed keepaliveId, uint8 oldStatus, uint8 newStatus)',
  ]),
  mirror: new ethers.Interface([
    'event MirrorRegistered(bytes32 indexed mirrorId, bytes32 indexed ensNode, bytes32 indexed jnsNode, address owner)',
    'event MirrorSynced(bytes32 indexed mirrorId, bytes32 indexed ensNode, uint256 blockNumber)',
    'event SyncFailed(bytes32 indexed mirrorId, string reason)',
  ]),
};

export function isKeepaliveEvent(topic0: string): boolean {
  return KEEPALIVE_EVENT_SET.has(topic0);
}

const STATUS_MAP: Record<number, KeepaliveStatus> = {
  0: KeepaliveStatus.UNKNOWN,
  1: KeepaliveStatus.HEALTHY,
  2: KeepaliveStatus.DEGRADED,
  3: KeepaliveStatus.UNHEALTHY,
  4: KeepaliveStatus.UNFUNDED,
};

const RESOURCE_TYPE_MAP: Record<number, KeepaliveResourceType> = {
  0: KeepaliveResourceType.IPFS_CONTENT,
  1: KeepaliveResourceType.COMPUTE_ENDPOINT,
  2: KeepaliveResourceType.TRIGGER,
  3: KeepaliveResourceType.STORAGE,
  4: KeepaliveResourceType.AGENT,
  5: KeepaliveResourceType.CUSTOM,
};

export async function processKeepaliveEvents(ctx: ProcessorContext<Store>): Promise<void> {
  const keepalives = new Map<string, Keepalive>();
  const resources = new Map<string, KeepaliveResource>();
  const healthChecks: KeepaliveHealthCheck[] = [];
  const autoFunds: KeepaliveAutoFund[] = [];
  const mirrors = new Map<string, ENSMirror>();
  const mirrorSyncs: ENSMirrorSync[] = [];
  const accountFactory = createAccountFactory();

  // Load existing keepalives
  const existingKeepalives = await ctx.store.find(Keepalive);
  for (const k of existingKeepalives) keepalives.set(k.id, k);

  // Load existing mirrors
  const existingMirrors = await ctx.store.find(ENSMirror);
  for (const m of existingMirrors) mirrors.set(m.id, m);

  for (const block of ctx.blocks) {
    const header = block.header as unknown as BlockHeader;
    const blockTimestamp = new Date(header.timestamp);

    for (const rawLog of block.logs) {
      const log = rawLog as unknown as LogData;
      const eventSig = log.topics[0];
      const txHash = log.transaction?.hash ?? '';

      if (!isKeepaliveEvent(eventSig)) continue;

      switch (eventSig) {
        case EVENTS.KEEPALIVE_REGISTERED: {
          const decoded = ABI.keepalive.parseLog({ topics: log.topics, data: log.data });
          if (!decoded) break;

          const keepaliveId = decoded.args[0] as string;
          const ownerAddr = decoded.args[1] as string;
          const jnsNode = decoded.args[2] as string;
          const agentId = decoded.args[3] as bigint;

          const owner = accountFactory.getOrCreate(ownerAddr, header.height, blockTimestamp);

          const keepalive = new Keepalive({
            id: keepaliveId,
            owner,
            jnsNode,
            agentId: agentId > 0n ? agentId : undefined,
            vaultAddress: ownerAddr, // Default to owner, will be updated
            globalMinBalance: 0n,
            checkInterval: 3600,
            autoFundAmount: 0n,
            autoFundEnabled: false,
            active: true,
            status: KeepaliveStatus.UNKNOWN,
            createdAt: blockTimestamp,
            totalAutoFunded: 0n,
            healthCheckCount: 0,
          });

          keepalives.set(keepaliveId, keepalive);
          ctx.log.info(`Keepalive registered: ${keepaliveId.slice(0, 10)}... by ${ownerAddr}`);
          break;
        }

        case EVENTS.RESOURCE_ADDED: {
          const decoded = ABI.keepalive.parseLog({ topics: log.topics, data: log.data });
          if (!decoded) break;

          const keepaliveId = decoded.args[0] as string;
          const resourceType = Number(decoded.args[1]);
          const identifier = decoded.args[2] as string;

          const keepalive = keepalives.get(keepaliveId);
          if (!keepalive) {
            ctx.log.warn(`Resource added to unknown keepalive: ${keepaliveId}`);
            break;
          }

          // Count existing resources for this keepalive
          let resourceIndex = 0;
          for (const r of resources.values()) {
            if (r.keepalive.id === keepaliveId) resourceIndex++;
          }

          const resource = new KeepaliveResource({
            id: `${keepaliveId}-${resourceIndex}`,
            keepalive,
            resourceType: RESOURCE_TYPE_MAP[resourceType] ?? KeepaliveResourceType.CUSTOM,
            identifier,
            minBalance: 0n,
            required: true,
            addedAt: blockTimestamp,
          });

          resources.set(resource.id, resource);
          ctx.log.info(`Resource added: ${keepaliveId.slice(0, 10)}... type=${resourceType}`);
          break;
        }

        case EVENTS.HEALTH_CHECKED: {
          const decoded = ABI.keepalive.parseLog({ topics: log.topics, data: log.data });
          if (!decoded) break;

          const keepaliveId = decoded.args[0] as string;
          const status = Number(decoded.args[1]);
          const balance = decoded.args[2] as bigint;
          const healthyResources = Number(decoded.args[3]);
          const totalResources = Number(decoded.args[4]);

          const keepalive = keepalives.get(keepaliveId);
          if (keepalive) {
            keepalive.status = STATUS_MAP[status] ?? KeepaliveStatus.UNKNOWN;
            keepalive.lastCheckAt = blockTimestamp;
            keepalive.healthCheckCount += 1;

            if (status === 1) { // HEALTHY
              keepalive.lastHealthy = blockTimestamp;
            }
          }

          const healthCheck = new KeepaliveHealthCheck({
            id: `${txHash}-${log.logIndex}`,
            keepalive: keepalive ?? new Keepalive({ id: keepaliveId }),
            status: STATUS_MAP[status] ?? KeepaliveStatus.UNKNOWN,
            balance,
            healthyResources,
            totalResources,
            failedResources: [],
            timestamp: blockTimestamp,
            blockNumber: header.height,
            txHash,
          });

          healthChecks.push(healthCheck);

          ctx.log.info(
            `Health check: ${keepaliveId.slice(0, 10)}... status=${status} ` +
            `balance=${ethers.formatEther(balance)} ETH resources=${healthyResources}/${totalResources}`
          );
          break;
        }

        case EVENTS.STATUS_CHANGED: {
          const decoded = ABI.keepalive.parseLog({ topics: log.topics, data: log.data });
          if (!decoded) break;

          const keepaliveId = decoded.args[0] as string;
          const newStatus = Number(decoded.args[2]);

          const keepalive = keepalives.get(keepaliveId);
          if (keepalive) {
            keepalive.status = STATUS_MAP[newStatus] ?? KeepaliveStatus.UNKNOWN;
          }
          break;
        }

        case EVENTS.AUTO_FUNDED: {
          const decoded = ABI.keepalive.parseLog({ topics: log.topics, data: log.data });
          if (!decoded) break;

          const keepaliveId = decoded.args[0] as string;
          const amount = decoded.args[1] as bigint;
          const vault = decoded.args[2] as string;

          const keepalive = keepalives.get(keepaliveId);
          if (keepalive && amount > 0n) {
            keepalive.totalAutoFunded += amount;
          }

          const autoFund = new KeepaliveAutoFund({
            id: `${txHash}-${log.logIndex}`,
            keepalive: keepalive ?? new Keepalive({ id: keepaliveId }),
            amount,
            vault,
            success: amount > 0n,
            timestamp: blockTimestamp,
            blockNumber: header.height,
            txHash,
          });

          autoFunds.push(autoFund);

          ctx.log.info(
            `Auto-funded: ${keepaliveId.slice(0, 10)}... amount=${ethers.formatEther(amount)} ETH`
          );
          break;
        }

        case EVENTS.MIRROR_REGISTERED: {
          const decoded = ABI.mirror.parseLog({ topics: log.topics, data: log.data });
          if (!decoded) break;

          const mirrorId = decoded.args[0] as string;
          const ensNode = decoded.args[1] as string;
          const jnsNode = decoded.args[2] as string;
          const ownerAddr = decoded.args[3] as string;

          const owner = accountFactory.getOrCreate(ownerAddr, header.height, blockTimestamp);

          const mirror = new ENSMirror({
            id: mirrorId,
            ensNode,
            jnsNode,
            owner,
            syncInterval: 300,
            mirrorContenthash: true,
            mirrorAddress: true,
            textKeys: [],
            active: true,
            createdAt: blockTimestamp,
            syncCount: 0,
          });

          mirrors.set(mirrorId, mirror);
          ctx.log.info(`ENS Mirror registered: ${mirrorId.slice(0, 10)}... ENS=${ensNode.slice(0, 10)}`);
          break;
        }

        case EVENTS.MIRROR_SYNCED: {
          const decoded = ABI.mirror.parseLog({ topics: log.topics, data: log.data });
          if (!decoded) break;

          const mirrorId = decoded.args[0] as string;
          const ethBlockNumber = decoded.args[2] as bigint;

          const mirror = mirrors.get(mirrorId);
          if (mirror) {
            mirror.lastSyncAt = blockTimestamp;
            mirror.syncCount += 1;
            mirror.lastEthBlock = ethBlockNumber;
          }

          const sync = new ENSMirrorSync({
            id: `${txHash}-${log.logIndex}`,
            mirror: mirror ?? new ENSMirror({ id: mirrorId }),
            ethBlockNumber,
            success: true,
            timestamp: blockTimestamp,
            blockNumber: header.height,
            txHash,
          });

          mirrorSyncs.push(sync);
          ctx.log.info(`ENS Mirror synced: ${mirrorId.slice(0, 10)}... ETH block ${ethBlockNumber}`);
          break;
        }

        case EVENTS.SYNC_FAILED: {
          const decoded = ABI.mirror.parseLog({ topics: log.topics, data: log.data });
          if (!decoded) break;

          const mirrorId = decoded.args[0] as string;
          const reason = decoded.args[1] as string;

          const mirror = mirrors.get(mirrorId);

          const sync = new ENSMirrorSync({
            id: `${txHash}-${log.logIndex}`,
            mirror: mirror ?? new ENSMirror({ id: mirrorId }),
            ethBlockNumber: 0n,
            success: false,
            errorReason: reason,
            timestamp: blockTimestamp,
            blockNumber: header.height,
            txHash,
          });

          mirrorSyncs.push(sync);
          ctx.log.warn(`ENS Mirror sync failed: ${mirrorId.slice(0, 10)}... reason=${reason}`);
          break;
        }
      }
    }
  }

  // Save all entities
  await ctx.store.save(accountFactory.getAll());
  await ctx.store.save([...keepalives.values()]);
  await ctx.store.save([...resources.values()]);
  await ctx.store.save(healthChecks);
  await ctx.store.save(autoFunds);
  await ctx.store.save([...mirrors.values()]);
  await ctx.store.save(mirrorSyncs);

  // Update stats
  await updateKeepaliveStats(ctx, [...keepalives.values()], [...mirrors.values()]);
}

async function updateKeepaliveStats(
  ctx: ProcessorContext<Store>,
  keepalives: Keepalive[],
  mirrors: ENSMirror[]
): Promise<void> {
  const stats = await ctx.store.get(KeepaliveStats, 'global') ?? new KeepaliveStats({
    id: 'global',
    totalKeepalives: 0,
    activeKeepalives: 0,
    healthyCount: 0,
    degradedCount: 0,
    unhealthyCount: 0,
    unfundedCount: 0,
    totalFundedValue: 0n,
    totalAutoFunded: 0n,
    totalHealthChecks: 0,
    mirrorCount: 0,
    syncedMirrors: 0,
    lastUpdated: new Date(),
  });

  let healthy = 0, degraded = 0, unhealthy = 0, unfunded = 0, active = 0;
  let totalAutoFunded = 0n;

  for (const k of keepalives) {
    if (k.active) active++;
    if (k.status === KeepaliveStatus.HEALTHY) healthy++;
    else if (k.status === KeepaliveStatus.DEGRADED) degraded++;
    else if (k.status === KeepaliveStatus.UNHEALTHY) unhealthy++;
    else if (k.status === KeepaliveStatus.UNFUNDED) unfunded++;
    totalAutoFunded += k.totalAutoFunded;
  }

  const syncedMirrors = mirrors.filter(m => m.lastSyncAt !== undefined).length;

  stats.totalKeepalives = keepalives.length;
  stats.activeKeepalives = active;
  stats.healthyCount = healthy;
  stats.degradedCount = degraded;
  stats.unhealthyCount = unhealthy;
  stats.unfundedCount = unfunded;
  stats.totalAutoFunded = totalAutoFunded;
  stats.mirrorCount = mirrors.length;
  stats.syncedMirrors = syncedMirrors;
  stats.lastUpdated = new Date();

  await ctx.store.save(stats);
}
