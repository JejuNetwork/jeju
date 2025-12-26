/**
 * Storage event processor
 */

import type { Store } from '@subsquid/typeorm-store'
import type { Hex } from 'viem'
import { keccak256, parseAbi, stringToHex } from 'viem'

import {
  StorageDeal,
  StorageDealStatus,
  StorageLedgerBalance,
  StorageMarketStats,
  StorageProvider,
  StorageProviderType,
  StorageTier,
} from '../src/model'
import type { ProcessorContext } from './processor'
import { createAccountFactory } from './utils/entities'
import { decodeLog, isEventInSet } from './utils/hex'

const EVENT_SIGNATURES = {
  ProviderRegistered: keccak256(
    stringToHex('ProviderRegistered(address,string,string,uint8,uint256)'),
  ),
  ProviderUpdated: keccak256(stringToHex('ProviderUpdated(address)')),
  ProviderDeactivated: keccak256(stringToHex('ProviderDeactivated(address)')),
  ProviderReactivated: keccak256(stringToHex('ProviderReactivated(address)')),
  StakeAdded: keccak256(stringToHex('StakeAdded(address,uint256)')),
  StakeWithdrawn: keccak256(stringToHex('StakeWithdrawn(address,uint256)')),
  AgentLinked: keccak256(stringToHex('AgentLinked(address,uint256)')),
  DealCreated: keccak256(
    stringToHex('DealCreated(bytes32,address,address,string,uint256)'),
  ),
  DealConfirmed: keccak256(stringToHex('DealConfirmed(bytes32)')),
  DealCompleted: keccak256(stringToHex('DealCompleted(bytes32)')),
  DealTerminated: keccak256(stringToHex('DealTerminated(bytes32,uint256)')),
  DealFailed: keccak256(stringToHex('DealFailed(bytes32,string)')),
  DealExtended: keccak256(stringToHex('DealExtended(bytes32,uint256,uint256)')),
  DealRated: keccak256(stringToHex('DealRated(bytes32,uint8)')),
  LedgerCreated: keccak256(stringToHex('LedgerCreated(address)')),
  DepositMade: keccak256(stringToHex('DepositMade(address,uint256)')),
  TransferToProvider: keccak256(
    stringToHex('TransferToProvider(address,address,uint256)'),
  ),
}

const STORAGE_TOPIC_SET: Set<Hex> = new Set(Object.values(EVENT_SIGNATURES))

const ABI = {
  providerRegistered: parseAbi([
    'event ProviderRegistered(address indexed provider, string name, string endpoint, uint8 providerType, uint256 agentId)',
  ]),
  dealCreated: parseAbi([
    'event DealCreated(bytes32 indexed dealId, address indexed user, address indexed provider, string cid, uint256 cost)',
  ]),
}

// Event argument interfaces
interface ProviderRegisteredArgs {
  provider: string
  name: string
  endpoint: string
  providerType: number
  agentId: bigint
}

interface DealCreatedArgs {
  dealId: string
  user: string
  provider: string
  cid: string
  cost: bigint
}

const PROVIDER_TYPES_MAP: StorageProviderType[] = [
  StorageProviderType.IPFS_NODE,
  StorageProviderType.FILECOIN,
  StorageProviderType.ARWEAVE,
  StorageProviderType.CLOUD_S3,
  StorageProviderType.CLOUD_VERCEL,
  StorageProviderType.CLOUD_R2,
  StorageProviderType.HYBRID,
]

export function isStorageEvent(topic0: string): boolean {
  return isEventInSet(topic0, STORAGE_TOPIC_SET)
}

export async function processStorageEvents(
  ctx: ProcessorContext<Store>,
): Promise<void> {
  const providers = new Map<string, StorageProvider>()
  const deals = new Map<string, StorageDeal>()
  const balances = new Map<string, StorageLedgerBalance>()
  const accountFactory = createAccountFactory()

  const existingProviders = await ctx.store.find(StorageProvider)
  for (const p of existingProviders) {
    providers.set(p.id, p)
  }

  async function getOrCreateProvider(
    address: string,
    timestamp: Date,
  ): Promise<StorageProvider> {
    const id = address.toLowerCase()
    let provider = providers.get(id)
    if (!provider) {
      provider = await ctx.store.get(StorageProvider, id)
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
      })
    }
    providers.set(id, provider)
    return provider
  }

  for (const block of ctx.blocks) {
    const header = block.header
    const timestamp = new Date(header.timestamp)

    for (const log of block.logs) {
      const topics = log.topics
      if (!topics || topics.length === 0) continue

      const topic0 = topics[0]
      if (!isStorageEvent(topic0)) continue

      if (topic0 === EVENT_SIGNATURES.ProviderRegistered) {
        const providerAddr = `0x${topics[1].slice(26)}`
        const { args }: { args: ProviderRegisteredArgs } = decodeLog({
          abi: ABI.providerRegistered,
          topics,
          data: log.data,
        })

        const provider = await getOrCreateProvider(providerAddr, timestamp)
        provider.name = args.name
        provider.endpoint = args.endpoint
        provider.providerType =
          PROVIDER_TYPES_MAP[Number(args.providerType)] ??
          StorageProviderType.IPFS_NODE
        provider.agentId = Number(args.agentId) || undefined
        provider.isActive = true
        provider.registeredAt = timestamp
        provider.lastUpdated = timestamp
        ctx.log.info(`Storage provider: ${providerAddr.slice(0, 10)}...`)
      }

      if (topic0 === EVENT_SIGNATURES.ProviderDeactivated) {
        const providerAddr = `0x${topics[1].slice(26)}`
        const provider = await getOrCreateProvider(providerAddr, timestamp)
        provider.isActive = false
        provider.lastUpdated = timestamp
      }

      if (topic0 === EVENT_SIGNATURES.ProviderReactivated) {
        const providerAddr = `0x${topics[1].slice(26)}`
        const provider = await getOrCreateProvider(providerAddr, timestamp)
        provider.isActive = true
        provider.lastUpdated = timestamp
      }

      if (topic0 === EVENT_SIGNATURES.StakeAdded) {
        const providerAddr = `0x${topics[1].slice(26)}`
        const provider = await getOrCreateProvider(providerAddr, timestamp)
        const amount = BigInt(`0x${log.data.slice(2, 66)}`)
        provider.stakeAmount += amount
        provider.lastUpdated = timestamp
      }

      if (topic0 === EVENT_SIGNATURES.StakeWithdrawn) {
        const providerAddr = `0x${topics[1].slice(26)}`
        const provider = await getOrCreateProvider(providerAddr, timestamp)
        const amount = BigInt(`0x${log.data.slice(2, 66)}`)
        provider.stakeAmount -= amount
        provider.lastUpdated = timestamp
      }

      if (topic0 === EVENT_SIGNATURES.AgentLinked) {
        const providerAddr = `0x${topics[1].slice(26)}`
        const agentId = Number(BigInt(topics[2]))
        const provider = await getOrCreateProvider(providerAddr, timestamp)
        provider.agentId = agentId
        provider.isVerified = true
        provider.lastUpdated = timestamp

        ctx.log.info(
          `Storage provider ${providerAddr} linked to agent ${agentId}`,
        )
      }

      if (topic0 === EVENT_SIGNATURES.DealCreated) {
        const dealId = topics[1]
        const userAddr = `0x${topics[2].slice(26)}`
        const providerAddr = `0x${topics[3].slice(26)}`
        const { args }: { args: DealCreatedArgs } = decodeLog({
          abi: ABI.dealCreated,
          topics,
          data: log.data,
        })

        const user = accountFactory.getOrCreate(
          userAddr,
          header.height,
          timestamp,
        )
        const provider = await getOrCreateProvider(providerAddr, timestamp)
        const cost = BigInt(args.cost)

        deals.set(
          dealId,
          new StorageDeal({
            id: dealId,
            dealId: dealId,
            user,
            provider,
            status: StorageDealStatus.PENDING,
            cid: args.cid,
            sizeBytes: 0n,
            tier: StorageTier.WARM,
            totalCost: cost,
            paidAmount: cost,
            refundedAmount: 0n,
            replicationFactor: 1,
            retrievalCount: 0,
            createdAt: timestamp,
            txHash: log.transaction?.hash ?? dealId,
            blockNumber: header.height,
          }),
        )

        provider.totalDeals++
        provider.activeDeals++
        provider.lastUpdated = timestamp
        ctx.log.info(`Storage deal: ${dealId.slice(0, 10)}...`)
      }

      if (topic0 === EVENT_SIGNATURES.DealConfirmed) {
        const dealId = topics[1]
        let deal = deals.get(dealId)
        if (!deal) {
          deal = await ctx.store.get(StorageDeal, dealId)
        }
        if (deal) {
          deal.status = StorageDealStatus.ACTIVE
          deal.startTime = timestamp
          deals.set(dealId, deal)
        }
      }

      if (topic0 === EVENT_SIGNATURES.DealCompleted) {
        const dealId = topics[1]
        const deal =
          deals.get(dealId) || (await ctx.store.get(StorageDeal, dealId))
        if (deal) {
          deal.status = StorageDealStatus.EXPIRED
          deal.endTime = timestamp
          deals.set(dealId, deal)
          if (deal.provider) {
            const provider = await getOrCreateProvider(
              deal.provider.id,
              timestamp,
            )
            provider.activeDeals = Math.max(0, provider.activeDeals - 1)
            provider.completedDeals++
            provider.totalEarnings += deal.totalCost
            provider.lastUpdated = timestamp
          }
        }
      }

      if (topic0 === EVENT_SIGNATURES.DealTerminated) {
        const dealId = topics[1]
        const deal =
          deals.get(dealId) || (await ctx.store.get(StorageDeal, dealId))
        if (deal) {
          deal.status = StorageDealStatus.TERMINATED
          deal.endTime = timestamp
          deal.refundedAmount = BigInt(`0x${log.data.slice(2, 66)}`)
          deals.set(dealId, deal)
          if (deal.provider) {
            const provider = await getOrCreateProvider(
              deal.provider.id,
              timestamp,
            )
            provider.activeDeals = Math.max(0, provider.activeDeals - 1)
            provider.lastUpdated = timestamp
          }
        }
      }

      if (topic0 === EVENT_SIGNATURES.DealFailed) {
        const dealId = topics[1]
        const deal =
          deals.get(dealId) || (await ctx.store.get(StorageDeal, dealId))
        if (deal) {
          deal.status = StorageDealStatus.FAILED
          deal.endTime = timestamp
          deals.set(dealId, deal)
          if (deal.provider) {
            const provider = await getOrCreateProvider(
              deal.provider.id,
              timestamp,
            )
            provider.activeDeals = Math.max(0, provider.activeDeals - 1)
            provider.failedDeals++
            provider.lastUpdated = timestamp
          }
        }
      }

      if (topic0 === EVENT_SIGNATURES.DealRated) {
        const dealId = topics[1]
        const score = Number(BigInt(`0x${log.data.slice(2, 66)}`))
        const deal =
          deals.get(dealId) || (await ctx.store.get(StorageDeal, dealId))
        if (deal) {
          deal.rating = score
          deals.set(dealId, deal)
          if (deal.provider) {
            const provider = await getOrCreateProvider(
              deal.provider.id,
              timestamp,
            )
            const oldTotal = provider.avgRating * provider.ratingCount
            provider.ratingCount++
            provider.avgRating = Math.round(
              (oldTotal + score) / provider.ratingCount,
            )
            provider.lastUpdated = timestamp
          }
        }
      }

      if (topic0 === EVENT_SIGNATURES.LedgerCreated) {
        const userAddr = `0x${topics[1].slice(26)}`
        const balanceId = userAddr.toLowerCase()

        const balance = new StorageLedgerBalance({
          id: balanceId,
          user: accountFactory.getOrCreate(userAddr, header.height, timestamp),
          totalBalance: 0n,
          availableBalance: 0n,
          lockedBalance: 0n,
          pendingRefund: 0n,
          lastUpdated: timestamp,
        })

        balances.set(balanceId, balance)
      }

      if (topic0 === EVENT_SIGNATURES.DepositMade) {
        const userAddr = `0x${topics[1].slice(26)}`
        const amount = BigInt(`0x${log.data.slice(2, 66)}`)
        const balanceId = userAddr.toLowerCase()
        const balance =
          balances.get(balanceId) ||
          (await ctx.store.get(StorageLedgerBalance, balanceId))
        if (balance) {
          balance.totalBalance += amount
          balance.availableBalance += amount
          balance.lastUpdated = timestamp
          balances.set(balanceId, balance)
        }
      }
    }
  }

  const stats = await updateStorageStats(ctx, providers, deals)

  await ctx.store.upsert(accountFactory.getAll())
  await ctx.store.upsert([...providers.values()])
  await ctx.store.upsert([...deals.values()])
  await ctx.store.upsert([...balances.values()])
  if (stats) {
    await ctx.store.upsert([stats])
  }

  const startBlock = ctx.blocks[0]?.header.height
  const endBlock = ctx.blocks[ctx.blocks.length - 1]?.header.height

  if (providers.size > 0 || deals.size > 0) {
    ctx.log.info(
      `Storage events processed ${startBlock}-${endBlock}: ` +
        `${providers.size} providers, ${deals.size} deals, ${balances.size} balances`,
    )
  }
}

async function updateStorageStats(
  ctx: ProcessorContext<Store>,
  providers: Map<string, StorageProvider>,
  deals: Map<string, StorageDeal>,
): Promise<StorageMarketStats | null> {
  if (providers.size === 0 && deals.size === 0) return null

  const statsId = 'global'
  let stats = await ctx.store.get(StorageMarketStats, statsId)

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
    })
  }

  let totalProviders = 0
  let activeProviders = 0
  let verifiedProviders = 0
  let totalStaked = 0n
  let totalCapacity = 0n
  let usedCapacity = 0n

  for (const p of providers.values()) {
    totalProviders++
    if (p.isActive) activeProviders++
    if (p.isVerified || p.agentId) verifiedProviders++
    totalStaked += p.stakeAmount
    totalCapacity += p.totalCapacityGB
    usedCapacity += p.usedCapacityGB
  }

  stats.totalProviders = Math.max(stats.totalProviders, totalProviders)
  stats.activeProviders = activeProviders
  stats.verifiedProviders = verifiedProviders
  stats.totalStaked = totalStaked
  stats.totalCapacityTB = totalCapacity / 1024n
  stats.usedCapacityTB = usedCapacity / 1024n

  let totalDeals = 0
  let activeDeals = 0
  let completedDeals = 0
  let totalEarnings = 0n

  for (const d of deals.values()) {
    totalDeals++
    if (d.status === 'ACTIVE') activeDeals++
    if (d.status === 'EXPIRED') completedDeals++
    totalEarnings += d.totalCost
  }

  stats.totalDeals = Math.max(stats.totalDeals, totalDeals)
  stats.activeDeals = activeDeals
  stats.completedDeals = completedDeals
  stats.totalEarnings = totalEarnings
  stats.lastUpdated = new Date()

  return stats
}
