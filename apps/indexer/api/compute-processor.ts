/**
 * Compute event processor
 */

import type { Store } from '@subsquid/typeorm-store'
import type { Hex } from 'viem'
import { keccak256, stringToHex } from 'viem'
import {
  type ComputeLedgerBalance,
  ComputeProvider,
  ComputeRental,
  ComputeRentalStatus,
  ComputeResource,
  ComputeStats,
  InferenceRequest as InferenceRequestEntity,
  InferenceStatus,
} from '../src/model'
import type { ProcessorContext } from './processor'
import { createAccountFactory } from './utils/entities'
import { decodeLogData, isEventInSet } from './utils/hex'

const PROVIDER_REGISTERED = keccak256(
  stringToHex(
    'ProviderRegistered(address,string,string,bytes32,uint256,uint256)',
  ),
)
const PROVIDER_UPDATED = keccak256(
  stringToHex('ProviderUpdated(address,string,bytes32)'),
)
const PROVIDER_DEACTIVATED = keccak256(
  stringToHex('ProviderDeactivated(address)'),
)
const PROVIDER_REACTIVATED = keccak256(
  stringToHex('ProviderReactivated(address)'),
)
const STAKE_ADDED = keccak256(
  stringToHex('StakeAdded(address,uint256,uint256)'),
)
const STAKE_WITHDRAWN = keccak256(
  stringToHex('StakeWithdrawn(address,uint256)'),
)
const CAPABILITY_ADDED = keccak256(
  stringToHex('CapabilityAdded(address,string,uint256,uint256,uint256)'),
)
const CAPABILITY_UPDATED = keccak256(
  stringToHex('CapabilityUpdated(address,uint256,bool)'),
)
const RENTAL_CREATED = keccak256(
  stringToHex('RentalCreated(bytes32,address,address,uint256,uint256)'),
)
const RENTAL_STARTED = keccak256(
  stringToHex('RentalStarted(bytes32,string,uint16,string)'),
)
const RENTAL_COMPLETED = keccak256(
  stringToHex('RentalCompleted(bytes32,uint256,uint256)'),
)
const RENTAL_CANCELLED = keccak256(
  stringToHex('RentalCancelled(bytes32,uint256)'),
)
const RENTAL_EXTENDED = keccak256(
  stringToHex('RentalExtended(bytes32,uint256,uint256)'),
)
const RENTAL_RATED = keccak256(
  stringToHex('RentalRated(bytes32,address,uint8,string)'),
)
const USER_BANNED = keccak256(stringToHex('UserBanned(address,string,uint256)'))
const PROVIDER_BANNED = keccak256(stringToHex('ProviderBanned(address,string)'))
const DISPUTE_CREATED = keccak256(
  stringToHex('DisputeCreated(bytes32,bytes32,address,uint8,string)'),
)
const DISPUTE_RESOLVED = keccak256(
  stringToHex('DisputeResolved(bytes32,bool,uint256)'),
)
const SERVICE_REGISTERED = keccak256(
  stringToHex(
    'ServiceRegistered(address,uint256,string,string,uint256,uint256)',
  ),
)
const SERVICE_DEACTIVATED = keccak256(
  stringToHex('ServiceDeactivated(address,uint256)'),
)
const SETTLED = keccak256(
  stringToHex(
    'Settled(address,address,bytes32,uint256,uint256,uint256,uint256)',
  ),
)
const AGENT_SETTLED = keccak256(
  stringToHex('AgentSettled(uint256,address,uint256,uint256,uint256)'),
)
const STAKED_AS_USER = keccak256(stringToHex('StakedAsUser(address,uint256)'))
const STAKED_AS_PROVIDER = keccak256(
  stringToHex('StakedAsProvider(address,uint256)'),
)
const STAKED_AS_GUARDIAN = keccak256(
  stringToHex('StakedAsGuardian(address,uint256)'),
)
const STAKE_ADDED_STAKING = keccak256(
  stringToHex('StakeAdded(address,uint256,uint256)'),
)
const UNSTAKED = keccak256(stringToHex('Unstaked(address,uint256)'))
const SLASHED = keccak256(stringToHex('Slashed(address,uint256,string)'))

const COMPUTE_EVENT_SIGNATURES: Set<Hex> = new Set([
  PROVIDER_REGISTERED,
  PROVIDER_UPDATED,
  PROVIDER_DEACTIVATED,
  PROVIDER_REACTIVATED,
  STAKE_ADDED,
  STAKE_WITHDRAWN,
  CAPABILITY_ADDED,
  CAPABILITY_UPDATED,
  RENTAL_CREATED,
  RENTAL_STARTED,
  RENTAL_COMPLETED,
  RENTAL_CANCELLED,
  RENTAL_EXTENDED,
  RENTAL_RATED,
  USER_BANNED,
  PROVIDER_BANNED,
  DISPUTE_CREATED,
  DISPUTE_RESOLVED,
  SERVICE_REGISTERED,
  SERVICE_DEACTIVATED,
  SETTLED,
  AGENT_SETTLED,
  STAKED_AS_USER,
  STAKED_AS_PROVIDER,
  STAKED_AS_GUARDIAN,
  STAKE_ADDED_STAKING,
  UNSTAKED,
  SLASHED,
])

export function isComputeEvent(topic0: string): boolean {
  return isEventInSet(topic0, COMPUTE_EVENT_SIGNATURES)
}

export async function processComputeEvents(
  ctx: ProcessorContext<Store>,
): Promise<void> {
  const providers = new Map<string, ComputeProvider>()
  const resources = new Map<string, ComputeResource>()
  const rentals = new Map<string, ComputeRental>()
  const inferenceRequests = new Map<string, InferenceRequestEntity>()
  const balances = new Map<string, ComputeLedgerBalance>()
  const accountFactory = createAccountFactory()

  const existingProviders = await ctx.store.find(ComputeProvider)
  for (const p of existingProviders) {
    providers.set(p.id, p)
  }

  async function getOrCreateProvider(
    address: string,
    timestamp: Date,
  ): Promise<ComputeProvider> {
    const id = address.toLowerCase()
    let provider = providers.get(id)
    if (!provider) {
      provider = await ctx.store.get(ComputeProvider, id)
    }
    if (!provider) {
      provider = new ComputeProvider({
        id,
        address: id,
        endpoint: '',
        stakeAmount: 0n,
        isActive: false,
        registeredAt: timestamp,
        lastUpdated: timestamp,
        totalRentals: 0,
        totalEarnings: 0n,
      })
    }
    providers.set(id, provider)
    return provider
  }

  for (const block of ctx.blocks) {
    const header = block.header
    const blockTimestamp = new Date(header.timestamp)

    for (const log of block.logs) {
      const eventSig = log.topics[0]

      if (!eventSig || !isEventInSet(eventSig, COMPUTE_EVENT_SIGNATURES))
        continue

      const txHash =
        log.transaction?.hash || `${header.hash}-${log.transactionIndex}`

      if (eventSig === PROVIDER_REGISTERED) {
        const providerAddr = `0x${log.topics[1].slice(26)}`
        const decoded = decodeLogData(
          [
            { type: 'string' },
            { type: 'string' },
            { type: 'bytes32' },
            { type: 'uint256' },
            { type: 'uint256' },
          ] as const,
          log.data,
        )

        const id = providerAddr.toLowerCase()
        accountFactory.getOrCreate(providerAddr, header.height, blockTimestamp)
        const [name, endpoint, attestationHash, stakeAmount, agentIdBigint] =
          decoded as [string, string, string, bigint, bigint]

        const provider = new ComputeProvider({
          id,
          address: id,
          name,
          endpoint,
          attestationHash,
          stakeAmount,
          agentId: Number(agentIdBigint),
          isActive: true,
          registeredAt: blockTimestamp,
          lastUpdated: blockTimestamp,
          totalRentals: 0,
          totalEarnings: 0n,
        })
        providers.set(id, provider)

        ctx.log.info(
          `Compute provider registered: ${providerAddr.slice(0, 16)}... stake: ${decoded[3]}`,
        )
      }

      if (eventSig === PROVIDER_UPDATED) {
        const providerAddr = `0x${log.topics[1].slice(26)}`
        const decoded = decodeLogData(
          [{ type: 'string' }, { type: 'bytes32' }] as const,
          log.data,
        )

        const provider = await getOrCreateProvider(providerAddr, blockTimestamp)
        const [updatedEndpoint, updatedHash] = decoded as [string, string]
        provider.endpoint = updatedEndpoint
        provider.attestationHash = updatedHash
        provider.lastUpdated = blockTimestamp
      }

      if (eventSig === PROVIDER_DEACTIVATED) {
        // ProviderDeactivated(address indexed provider)
        const providerAddr = `0x${log.topics[1].slice(26)}`
        const provider = await getOrCreateProvider(providerAddr, blockTimestamp)
        provider.isActive = false
        provider.lastUpdated = blockTimestamp
      }

      if (eventSig === PROVIDER_REACTIVATED) {
        // ProviderReactivated(address indexed provider)
        const providerAddr = `0x${log.topics[1].slice(26)}`
        const provider = await getOrCreateProvider(providerAddr, blockTimestamp)
        provider.isActive = true
        provider.lastUpdated = blockTimestamp
      }

      if (eventSig === STAKE_ADDED) {
        // StakeAdded(address indexed provider, uint256 amount, uint256 newTotal)
        const providerAddr = `0x${log.topics[1].slice(26)}`
        const decoded = decodeLogData(
          [{ type: 'uint256' }, { type: 'uint256' }] as const,
          log.data,
        )

        const provider = await getOrCreateProvider(providerAddr, blockTimestamp)
        provider.stakeAmount = BigInt(decoded[1].toString())
        provider.lastUpdated = blockTimestamp
      }

      if (eventSig === STAKE_WITHDRAWN) {
        // StakeWithdrawn(address indexed provider, uint256 amount)
        const providerAddr = `0x${log.topics[1].slice(26)}`
        const decoded = decodeLogData([{ type: 'uint256' }] as const, log.data)

        const provider = await getOrCreateProvider(providerAddr, blockTimestamp)
        const amount = BigInt(decoded[0].toString())
        provider.stakeAmount =
          provider.stakeAmount > amount ? provider.stakeAmount - amount : 0n
        provider.lastUpdated = blockTimestamp
      }

      if (eventSig === CAPABILITY_ADDED) {
        // CapabilityAdded(address indexed provider, string model, uint256 pricePerInputToken, uint256 pricePerOutputToken, uint256 maxContextLength)
        const providerAddr = `0x${log.topics[1].slice(26)}`
        const decoded = decodeLogData(
          [
            { type: 'string' },
            { type: 'uint256' },
            { type: 'uint256' },
            { type: 'uint256' },
          ] as const,
          log.data,
        )

        const [modelName, pricePerHour] = decoded as [
          string,
          bigint,
          bigint,
          bigint,
        ]
        const id = `${providerAddr.toLowerCase()}-${modelName}`
        const provider = await getOrCreateProvider(providerAddr, blockTimestamp)

        const resource = new ComputeResource({
          id,
          provider,
          resourceId: modelName,
          gpuCount: 0,
          cpuCores: 0,
          memoryGB: 0,
          pricePerHour,
          isAvailable: true,
          createdAt: blockTimestamp,
        })
        resources.set(id, resource)
      }

      if (eventSig === RENTAL_CREATED) {
        // RentalCreated(bytes32 indexed rentalId, address indexed user, address indexed provider, uint256 durationHours, uint256 totalCost)
        // topics[1] = rentalId, topics[2] = user, topics[3] = provider
        // data = (durationHours, totalCost)
        const rentalId = log.topics[1]
        const userAddr = `0x${log.topics[2].slice(26)}`
        const providerAddr = `0x${log.topics[3].slice(26)}`
        const decoded = decodeLogData(
          [{ type: 'uint256' }, { type: 'uint256' }] as const,
          log.data,
        )

        const renter = accountFactory.getOrCreate(
          userAddr,
          header.height,
          blockTimestamp,
        )
        const provider = await getOrCreateProvider(providerAddr, blockTimestamp)

        const rental = new ComputeRental({
          id: rentalId,
          rentalId,
          renter,
          provider,
          duration: BigInt(decoded[0].toString()) * 3600n, // Convert hours to seconds
          price: BigInt(decoded[1].toString()),
          status: ComputeRentalStatus.PENDING,
          createdAt: blockTimestamp,
          txHash,
          blockNumber: header.height,
        })
        rentals.set(rentalId, rental)

        ctx.log.info(`Compute rental created: ${rentalId.slice(0, 16)}...`)
      }

      if (eventSig === RENTAL_STARTED) {
        // RentalStarted(bytes32 indexed rentalId, string sshHost, uint16 sshPort, string containerId)
        const rentalId = log.topics[1]
        const rental =
          rentals.get(rentalId) ||
          (await ctx.store.get(ComputeRental, rentalId))
        if (rental) {
          rental.status = ComputeRentalStatus.ACTIVE
          rental.startTime = blockTimestamp
          rentals.set(rentalId, rental)
        }
      }

      if (eventSig === RENTAL_COMPLETED) {
        // RentalCompleted(bytes32 indexed rentalId, uint256 actualDuration, uint256 refundAmount)
        const rentalId = log.topics[1]
        const rental =
          rentals.get(rentalId) ||
          (await ctx.store.get(ComputeRental, rentalId))
        if (rental) {
          rental.status = ComputeRentalStatus.COMPLETED
          rental.endTime = blockTimestamp
          rentals.set(rentalId, rental)

          // Update provider stats
          if (rental.provider) {
            const provider =
              providers.get(rental.provider.id) ||
              (await ctx.store.get(ComputeProvider, rental.provider.id))
            if (provider) {
              provider.totalRentals++
              provider.totalEarnings += rental.price
              providers.set(provider.id, provider)
            }
          }
        }
      }

      if (eventSig === RENTAL_CANCELLED) {
        // RentalCancelled(bytes32 indexed rentalId, uint256 refundAmount)
        const rentalId = log.topics[1]
        const rental =
          rentals.get(rentalId) ||
          (await ctx.store.get(ComputeRental, rentalId))
        if (rental) {
          rental.status = ComputeRentalStatus.CANCELLED
          rental.endTime = blockTimestamp
          rentals.set(rentalId, rental)
        }
      }

      if (eventSig === RENTAL_EXTENDED) {
        // RentalExtended(bytes32 indexed rentalId, uint256 additionalHours, uint256 additionalCost)
        const rentalId = log.topics[1]
        const decoded = decodeLogData(
          [{ type: 'uint256' }, { type: 'uint256' }] as const,
          log.data,
        )

        const rental =
          rentals.get(rentalId) ||
          (await ctx.store.get(ComputeRental, rentalId))
        if (rental) {
          rental.duration += BigInt(decoded[0].toString()) * 3600n
          rental.price += BigInt(decoded[1].toString())
          rentals.set(rentalId, rental)
        }
      }

      if (eventSig === SETTLED) {
        // Settled(address indexed user, address indexed provider, bytes32 requestHash, uint256 inputTokens, uint256 outputTokens, uint256 fee, uint256 nonce)
        // topics[1] = user, topics[2] = provider
        // data = (requestHash, inputTokens, outputTokens, fee, nonce)
        const userAddr = `0x${log.topics[1].slice(26)}`
        const providerAddr = `0x${log.topics[2].slice(26)}`
        const decoded = decodeLogData(
          [
            { type: 'bytes32' },
            { type: 'uint256' },
            { type: 'uint256' },
            { type: 'uint256' },
            { type: 'uint256' },
          ] as const,
          log.data,
        )

        const [requestId, inputTokens, outputTokens, fee] = decoded as [
          string,
          bigint,
          bigint,
          bigint,
          bigint,
        ]
        const requester = accountFactory.getOrCreate(
          userAddr,
          header.height,
          blockTimestamp,
        )
        const provider = await getOrCreateProvider(providerAddr, blockTimestamp)

        const request = new InferenceRequestEntity({
          id: requestId,
          requestId,
          requester,
          provider,
          model: '', // Model info not in this event
          maxTokens: inputTokens + outputTokens,
          tokensUsed: inputTokens + outputTokens,
          status: InferenceStatus.COMPLETED,
          createdAt: blockTimestamp,
          completedAt: blockTimestamp,
          txHash,
          blockNumber: header.height,
        })
        inferenceRequests.set(requestId, request)

        // Update provider earnings
        provider.totalEarnings += fee
        provider.lastUpdated = blockTimestamp
      }

      if (eventSig === AGENT_SETTLED) {
        // AgentSettled(uint256 indexed agentId, address indexed user, uint256 inputTokens, uint256 outputTokens, uint256 fee)
        // Log for tracking, links to agent ID
        ctx.log.debug(`Agent settled: agentId=${log.topics[1]}`)
      }

      if (eventSig === STAKED_AS_PROVIDER) {
        // StakedAsProvider(address indexed account, uint256 amount)
        const providerAddr = `0x${log.topics[1].slice(26)}`
        const decoded = decodeLogData([{ type: 'uint256' }] as const, log.data)

        const provider = await getOrCreateProvider(providerAddr, blockTimestamp)
        provider.stakeAmount += BigInt(decoded[0].toString())
        provider.lastUpdated = blockTimestamp
      }

      if (eventSig === SLASHED) {
        // Slashed(address indexed account, uint256 amount, string reason)
        const providerAddr = `0x${log.topics[1].slice(26)}`
        const decoded = decodeLogData(
          [{ type: 'uint256' }, { type: 'string' }] as const,
          log.data,
        )

        const provider = await getOrCreateProvider(providerAddr, blockTimestamp)
        const amount = BigInt(decoded[0].toString())
        provider.stakeAmount =
          provider.stakeAmount > amount ? provider.stakeAmount - amount : 0n
        provider.isActive = provider.stakeAmount > 0n
        provider.lastUpdated = blockTimestamp

        ctx.log.warn(
          `Provider ${providerAddr.slice(0, 16)}... slashed: ${decoded[1]}`,
        )
      }
    }
  }

  // Persist all entities
  await ctx.store.upsert(accountFactory.getAll())

  if (providers.size > 0) {
    await ctx.store.upsert([...providers.values()])
  }
  if (resources.size > 0) {
    await ctx.store.upsert([...resources.values()])
  }
  if (rentals.size > 0) {
    await ctx.store.upsert([...rentals.values()])
  }
  if (inferenceRequests.size > 0) {
    await ctx.store.upsert([...inferenceRequests.values()])
  }
  if (balances.size > 0) {
    await ctx.store.upsert([...balances.values()])
  }

  // Update global stats
  await updateComputeStats(ctx)

  // Log summary
  const totalEvents =
    providers.size +
    resources.size +
    rentals.size +
    inferenceRequests.size +
    balances.size
  if (totalEvents > 0) {
    ctx.log.info(
      `Compute: ${providers.size} providers, ${resources.size} resources, ` +
        `${rentals.size} rentals, ${inferenceRequests.size} inference requests, ${balances.size} balances`,
    )
  }
}

async function updateComputeStats(ctx: ProcessorContext<Store>): Promise<void> {
  const globalId = 'global'
  let stats = await ctx.store.get(ComputeStats, globalId)

  if (!stats) {
    stats = new ComputeStats({
      id: globalId,
      totalProviders: 0,
      activeProviders: 0,
      totalResources: 0,
      availableResources: 0,
      totalRentals: 0,
      activeRentals: 0,
      completedRentals: 0,
      totalInferenceRequests: 0,
      totalStaked: 0n,
      totalEarnings: 0n,
      last24hRentals: 0,
      last24hInference: 0,
      lastUpdated: new Date(),
    })
  }

  // Update counts from database
  const providerCount = await ctx.store.count(ComputeProvider)
  const activeProviderCount = await ctx.store.count(ComputeProvider, {
    where: { isActive: true },
  })
  const resourceCount = await ctx.store.count(ComputeResource)
  const availableResourceCount = await ctx.store.count(ComputeResource, {
    where: { isAvailable: true },
  })
  const rentalCount = await ctx.store.count(ComputeRental)
  const activeRentalCount = await ctx.store.count(ComputeRental, {
    where: { status: ComputeRentalStatus.ACTIVE },
  })
  const completedRentalCount = await ctx.store.count(ComputeRental, {
    where: { status: ComputeRentalStatus.COMPLETED },
  })
  const inferenceCount = await ctx.store.count(InferenceRequestEntity)

  stats.totalProviders = providerCount
  stats.activeProviders = activeProviderCount
  stats.totalResources = resourceCount
  stats.availableResources = availableResourceCount
  stats.totalRentals = rentalCount
  stats.activeRentals = activeRentalCount
  stats.completedRentals = completedRentalCount
  stats.totalInferenceRequests = inferenceCount
  stats.lastUpdated = new Date()

  await ctx.store.upsert(stats)
}
