/**
 * Storage Provider Registry Processor
 * 
 * Indexes storage provider registrations, deals, and marketplace events.
 * Integrates with ERC-8004 for agent-linked providers.
 */

import { Store } from '@subsquid/typeorm-store';
import { ethers } from 'ethers';
import { 
  StorageProvider,
  StorageDeal, 
  StorageLedgerBalance,
  StorageMarketStats,
  Account,
  StorageProviderType,
  StorageTier,
  StorageDealStatus,
} from './model';
import { ProcessorContext } from './processor';

// Event signatures for storage contracts
const EVENT_SIGNATURES = {
  // StorageProviderRegistry events
  ProviderRegistered: ethers.id('ProviderRegistered(address,string,string,uint8,uint256)'),
  ProviderUpdated: ethers.id('ProviderUpdated(address)'),
  ProviderDeactivated: ethers.id('ProviderDeactivated(address)'),
  ProviderReactivated: ethers.id('ProviderReactivated(address)'),
  StakeAdded: ethers.id('StakeAdded(address,uint256)'),
  StakeWithdrawn: ethers.id('StakeWithdrawn(address,uint256)'),
  AgentLinked: ethers.id('AgentLinked(address,uint256)'),
  
  // StorageMarket events
  DealCreated: ethers.id('DealCreated(bytes32,address,address,string,uint256)'),
  DealConfirmed: ethers.id('DealConfirmed(bytes32)'),
  DealCompleted: ethers.id('DealCompleted(bytes32)'),
  DealTerminated: ethers.id('DealTerminated(bytes32,uint256)'),
  DealFailed: ethers.id('DealFailed(bytes32,string)'),
  DealExtended: ethers.id('DealExtended(bytes32,uint256,uint256)'),
  DealRated: ethers.id('DealRated(bytes32,uint8)'),
  
  // StorageLedgerManager events  
  LedgerCreated: ethers.id('LedgerCreated(address)'),
  DepositMade: ethers.id('DepositMade(address,uint256)'),
  TransferToProvider: ethers.id('TransferToProvider(address,address,uint256)'),
};

const STORAGE_TOPIC_SET = new Set(Object.values(EVENT_SIGNATURES));

const PROVIDER_TYPES_MAP: StorageProviderType[] = [
  StorageProviderType.IPFS_NODE,
  StorageProviderType.FILECOIN,
  StorageProviderType.ARWEAVE,
  StorageProviderType.CLOUD_S3,
  StorageProviderType.CLOUD_VERCEL,
  StorageProviderType.CLOUD_R2,
  StorageProviderType.HYBRID,
];
const STORAGE_TIERS_MAP: StorageTier[] = [
  StorageTier.HOT,
  StorageTier.WARM,
  StorageTier.COLD,
  StorageTier.PERMANENT,
];
const DEAL_STATUS_MAP: StorageDealStatus[] = [
  StorageDealStatus.PENDING,
  StorageDealStatus.ACTIVE,
  StorageDealStatus.EXPIRED,
  StorageDealStatus.TERMINATED,
  StorageDealStatus.FAILED,
  StorageDealStatus.DISPUTED,
];

export function isStorageEvent(topic0: string): boolean {
  return STORAGE_TOPIC_SET.has(topic0);
}

export async function processStorageEvents(ctx: ProcessorContext<Store>): Promise<void> {
  const providers = new Map<string, StorageProvider>();
  const deals = new Map<string, StorageDeal>();
  const balances = new Map<string, StorageLedgerBalance>();
  const accounts = new Map<string, Account>();
  
  // Load existing providers
  const existingProviders = await ctx.store.find(StorageProvider);
  for (const p of existingProviders) {
    providers.set(p.id, p);
  }
  
  function getOrCreateAccount(address: string, blockNumber: number, timestamp: Date): Account {
    const id = address.toLowerCase();
    let account = accounts.get(id);
    if (!account) {
      account = new Account({
        id,
        address: id,
        isContract: false,
        firstSeenBlock: blockNumber,
        lastSeenBlock: blockNumber,
        transactionCount: 0,
        totalValueSent: 0n,
        totalValueReceived: 0n,
        labels: [],
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
      });
      accounts.set(id, account);
    }
    return account;
  }
  
  async function getOrCreateProvider(address: string, timestamp: Date): Promise<StorageProvider> {
    const id = address.toLowerCase();
    let provider = providers.get(id);
    if (!provider) {
      provider = await ctx.store.get(StorageProvider, id);
    }
    if (!provider) {
      provider = new StorageProvider({
        id,
        address: id,
        name: '',
        endpoint: '',
        providerType: StorageProviderType.IPFS_NODE,
        stakeAmount: 0n,
        isActive: false,
        isVerified: false,
        registeredAt: timestamp,
        lastUpdated: timestamp,
        totalCapacityGB: 0n,
        usedCapacityGB: 0n,
        availableCapacityGB: 0n,
        pricePerGBMonth: 0n,
        uploadPricePerGB: 0n,
        retrievalPricePerGB: 0n,
        minStoragePeriodDays: 1,
        maxStoragePeriodDays: 365,
        healthScore: 100,
        avgLatencyMs: 0,
        replicationFactor: 1,
        supportedTiers: [StorageTier.WARM],
        totalDeals: 0,
        activeDeals: 0,
        completedDeals: 0,
        failedDeals: 0,
        totalStoredGB: 0n,
        totalEarnings: 0n,
        avgRating: 0,
        ratingCount: 0,
        uptimePercent: 100,
      });
    }
    providers.set(id, provider);
    return provider;
  }
  
  for (const block of ctx.blocks) {
    const header = block.header as { height: number; timestamp: number };
    const timestamp = new Date(header.timestamp);
    
    for (const log of block.logs) {
      const topics = log.topics;
      if (!topics || topics.length === 0) continue;
      
      const topic0 = topics[0];
      if (!isStorageEvent(topic0)) continue;
      
      // ============ Provider Registry Events ============
      
      if (topic0 === EVENT_SIGNATURES.ProviderRegistered) {
        const providerAddr = '0x' + topics[1].slice(26);
        const provider = await getOrCreateProvider(providerAddr, timestamp);
        
        // Decode data: (string name, string endpoint, uint8 providerType, uint256 agentId)
        const iface = new ethers.Interface([
          'event ProviderRegistered(address indexed provider, string name, string endpoint, uint8 providerType, uint256 agentId)'
        ]);
        const decoded = iface.parseLog({ topics: topics, data: log.data });
        
        if (decoded) {
          provider.name = decoded.args.name;
          provider.endpoint = decoded.args.endpoint;
          provider.providerType = PROVIDER_TYPES_MAP[Number(decoded.args.providerType)] ?? StorageProviderType.IPFS_NODE;
          provider.agentId = Number(decoded.args.agentId) || undefined;
          provider.isActive = true;
          provider.registeredAt = timestamp;
          provider.lastUpdated = timestamp;
        }
        
        ctx.log.info(`Storage provider registered: ${providerAddr}`);
      }
      
      if (topic0 === EVENT_SIGNATURES.ProviderDeactivated) {
        const providerAddr = '0x' + topics[1].slice(26);
        const provider = await getOrCreateProvider(providerAddr, timestamp);
        provider.isActive = false;
        provider.lastUpdated = timestamp;
      }
      
      if (topic0 === EVENT_SIGNATURES.ProviderReactivated) {
        const providerAddr = '0x' + topics[1].slice(26);
        const provider = await getOrCreateProvider(providerAddr, timestamp);
        provider.isActive = true;
        provider.lastUpdated = timestamp;
      }
      
      if (topic0 === EVENT_SIGNATURES.StakeAdded) {
        const providerAddr = '0x' + topics[1].slice(26);
        const provider = await getOrCreateProvider(providerAddr, timestamp);
        const amount = BigInt('0x' + log.data.slice(2, 66));
        provider.stakeAmount = (provider.stakeAmount || 0n) + amount;
        provider.lastUpdated = timestamp;
      }
      
      if (topic0 === EVENT_SIGNATURES.StakeWithdrawn) {
        const providerAddr = '0x' + topics[1].slice(26);
        const provider = await getOrCreateProvider(providerAddr, timestamp);
        const amount = BigInt('0x' + log.data.slice(2, 66));
        provider.stakeAmount = (provider.stakeAmount || 0n) - amount;
        provider.lastUpdated = timestamp;
      }
      
      if (topic0 === EVENT_SIGNATURES.AgentLinked) {
        const providerAddr = '0x' + topics[1].slice(26);
        const agentId = Number(BigInt(topics[2]));
        const provider = await getOrCreateProvider(providerAddr, timestamp);
        provider.agentId = agentId;
        provider.isVerified = true;
        provider.lastUpdated = timestamp;
        
        ctx.log.info(`Storage provider ${providerAddr} linked to agent ${agentId}`);
      }
      
      // ============ Storage Market Events ============
      
      if (topic0 === EVENT_SIGNATURES.DealCreated) {
        const dealId = topics[1];
        const userAddr = '0x' + topics[2].slice(26);
        const providerAddr = '0x' + topics[3].slice(26);
        
        const iface = new ethers.Interface([
          'event DealCreated(bytes32 indexed dealId, address indexed user, address indexed provider, string cid, uint256 cost)'
        ]);
        const decoded = iface.parseLog({ topics: topics, data: log.data });
        
        const user = getOrCreateAccount(userAddr, header.height, timestamp);
        const provider = await getOrCreateProvider(providerAddr, timestamp);
        
        const deal = new StorageDeal({
          id: dealId,
          dealId: dealId,
          user,
          provider,
          status: StorageDealStatus.PENDING,
          cid: decoded?.args.cid || '',
          sizeBytes: 0n,
          tier: StorageTier.WARM,
          totalCost: decoded?.args.cost ? BigInt(decoded.args.cost) : 0n,
          paidAmount: decoded?.args.cost ? BigInt(decoded.args.cost) : 0n,
          refundedAmount: 0n,
          replicationFactor: 1,
          retrievalCount: 0,
          createdAt: timestamp,
          txHash: log.transaction?.hash ?? '',
          blockNumber: header.height,
        });
        
        deals.set(dealId, deal);
        provider.totalDeals = (provider.totalDeals || 0) + 1;
        provider.activeDeals = (provider.activeDeals || 0) + 1;
        provider.lastUpdated = timestamp;
        
        ctx.log.info(`Storage deal created: ${dealId}`);
      }
      
      if (topic0 === EVENT_SIGNATURES.DealConfirmed) {
        const dealId = topics[1];
        let deal = deals.get(dealId);
        if (!deal) {
          deal = await ctx.store.get(StorageDeal, dealId);
        }
        if (deal) {
          deal.status = StorageDealStatus.ACTIVE;
          deal.startTime = timestamp;
          deals.set(dealId, deal);
        }
      }
      
      if (topic0 === EVENT_SIGNATURES.DealCompleted) {
        const dealId = topics[1];
        let deal = deals.get(dealId);
        if (!deal) {
          deal = await ctx.store.get(StorageDeal, dealId);
        }
        if (deal) {
          deal.status = StorageDealStatus.EXPIRED;
          deal.endTime = timestamp;
          deals.set(dealId, deal);
          
          if (deal.provider) {
            const provider = await getOrCreateProvider(deal.provider.id, timestamp);
            provider.activeDeals = Math.max(0, (provider.activeDeals || 0) - 1);
            provider.completedDeals = (provider.completedDeals || 0) + 1;
            provider.totalEarnings = (provider.totalEarnings || 0n) + (deal.totalCost || 0n);
            provider.lastUpdated = timestamp;
          }
        }
      }
      
      if (topic0 === EVENT_SIGNATURES.DealTerminated) {
        const dealId = topics[1];
        let deal = deals.get(dealId);
        if (!deal) {
          deal = await ctx.store.get(StorageDeal, dealId);
        }
        if (deal) {
          deal.status = StorageDealStatus.TERMINATED;
          deal.endTime = timestamp;
          const refundAmount = BigInt('0x' + log.data.slice(2, 66));
          deal.refundedAmount = refundAmount;
          deals.set(dealId, deal);
          
          if (deal.provider) {
            const provider = await getOrCreateProvider(deal.provider.id, timestamp);
            provider.activeDeals = Math.max(0, (provider.activeDeals || 0) - 1);
            provider.lastUpdated = timestamp;
          }
        }
      }
      
      if (topic0 === EVENT_SIGNATURES.DealFailed) {
        const dealId = topics[1];
        let deal = deals.get(dealId);
        if (!deal) {
          deal = await ctx.store.get(StorageDeal, dealId);
        }
        if (deal) {
          deal.status = StorageDealStatus.FAILED;
          deal.endTime = timestamp;
          deals.set(dealId, deal);
          
          if (deal.provider) {
            const provider = await getOrCreateProvider(deal.provider.id, timestamp);
            provider.activeDeals = Math.max(0, (provider.activeDeals || 0) - 1);
            provider.failedDeals = (provider.failedDeals || 0) + 1;
            provider.lastUpdated = timestamp;
          }
        }
      }
      
      if (topic0 === EVENT_SIGNATURES.DealRated) {
        const dealId = topics[1];
        const score = Number(BigInt('0x' + log.data.slice(2, 66)));
        
        let deal = deals.get(dealId);
        if (!deal) {
          deal = await ctx.store.get(StorageDeal, dealId);
        }
        if (deal) {
          deal.rating = score;
          deals.set(dealId, deal);
          
          if (deal.provider) {
            const provider = await getOrCreateProvider(deal.provider.id, timestamp);
            // Update running average
            const oldTotal = (provider.avgRating || 0) * (provider.ratingCount || 0);
            provider.ratingCount = (provider.ratingCount || 0) + 1;
            provider.avgRating = Math.round((oldTotal + score) / provider.ratingCount);
            provider.lastUpdated = timestamp;
          }
        }
      }
      
      // ============ Ledger Events ============
      
      if (topic0 === EVENT_SIGNATURES.LedgerCreated) {
        const userAddr = '0x' + topics[1].slice(26);
        const balanceId = userAddr.toLowerCase();
        
        const balance = new StorageLedgerBalance({
          id: balanceId,
          user: getOrCreateAccount(userAddr, header.height, timestamp),
          totalBalance: 0n,
          availableBalance: 0n,
          lockedBalance: 0n,
          pendingRefund: 0n,
          lastUpdated: timestamp,
        });
        
        balances.set(balanceId, balance);
      }
      
      if (topic0 === EVENT_SIGNATURES.DepositMade) {
        const userAddr = '0x' + topics[1].slice(26);
        const amount = BigInt('0x' + log.data.slice(2, 66));
        const balanceId = userAddr.toLowerCase();
        
        let balance = balances.get(balanceId);
        if (!balance) {
          balance = await ctx.store.get(StorageLedgerBalance, balanceId);
        }
        if (balance) {
          balance.totalBalance = (balance.totalBalance || 0n) + amount;
          balance.availableBalance = (balance.availableBalance || 0n) + amount;
          balance.lastUpdated = timestamp;
          balances.set(balanceId, balance);
        }
      }
    }
  }
  
  // Update stats
  const stats = await updateStorageStats(ctx, providers, deals);
  
  // Save all entities
  await ctx.store.upsert(Array.from(accounts.values()));
  await ctx.store.upsert(Array.from(providers.values()));
  await ctx.store.upsert(Array.from(deals.values()));
  await ctx.store.upsert(Array.from(balances.values()));
  if (stats) {
    await ctx.store.upsert([stats]);
  }
  
  const startBlock = ctx.blocks[0]?.header.height;
  const endBlock = ctx.blocks[ctx.blocks.length - 1]?.header.height;
  
  if (providers.size > 0 || deals.size > 0) {
    ctx.log.info(
      `Storage events processed ${startBlock}-${endBlock}: ` +
      `${providers.size} providers, ${deals.size} deals, ${balances.size} balances`
    );
  }
}

async function updateStorageStats(
  ctx: ProcessorContext<Store>,
  providers: Map<string, StorageProvider>,
  deals: Map<string, StorageDeal>
): Promise<StorageMarketStats | null> {
  if (providers.size === 0 && deals.size === 0) return null;
  
  const statsId = 'global';
  let stats = await ctx.store.get(StorageMarketStats, statsId);
  
  if (!stats) {
    stats = new StorageMarketStats({
      id: statsId,
      totalProviders: 0,
      activeProviders: 0,
      verifiedProviders: 0,
      totalCapacityTB: 0n,
      usedCapacityTB: 0n,
      totalDeals: 0,
      activeDeals: 0,
      completedDeals: 0,
      totalStaked: 0n,
      totalEarnings: 0n,
      avgPricePerGBMonth: 0n,
      last24hDeals: 0,
      last24hVolume: 0n,
      lastUpdated: new Date(),
    });
  }
  
  // Update provider counts
  let totalProviders = 0;
  let activeProviders = 0;
  let verifiedProviders = 0;
  let totalStaked = 0n;
  let totalCapacity = 0n;
  let usedCapacity = 0n;
  
  for (const p of providers.values()) {
    totalProviders++;
    if (p.isActive) activeProviders++;
    if (p.isVerified || p.agentId) verifiedProviders++;
    totalStaked += p.stakeAmount || 0n;
    totalCapacity += p.totalCapacityGB || 0n;
    usedCapacity += p.usedCapacityGB || 0n;
  }
  
  stats.totalProviders = Math.max(stats.totalProviders, totalProviders);
  stats.activeProviders = activeProviders;
  stats.verifiedProviders = verifiedProviders;
  stats.totalStaked = totalStaked;
  stats.totalCapacityTB = totalCapacity / 1024n;
  stats.usedCapacityTB = usedCapacity / 1024n;
  
  // Update deal counts
  let totalDeals = 0;
  let activeDeals = 0;
  let completedDeals = 0;
  let totalEarnings = 0n;
  
  for (const d of deals.values()) {
    totalDeals++;
    if (d.status === 'ACTIVE') activeDeals++;
    if (d.status === 'EXPIRED') completedDeals++;
    totalEarnings += d.totalCost || 0n;
  }
  
  stats.totalDeals = Math.max(stats.totalDeals, totalDeals);
  stats.activeDeals = activeDeals;
  stats.completedDeals = completedDeals;
  stats.totalEarnings = totalEarnings;
  stats.lastUpdated = new Date();
  
  return stats;
}

