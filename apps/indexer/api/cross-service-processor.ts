/**
 * Cross-service event processor
 */

import type { Store } from '@subsquid/typeorm-store'
import type { Hex } from 'viem'
import { formatEther, keccak256, stringToHex } from 'viem'
import {
  ComputeProvider,
  ComputeRental,
  ContainerArchitecture,
  ContainerImage,
  CrossServiceRequest,
  CrossServiceRequestStatus,
  CrossServiceRequestType,
  FileCategory,
  IPFSFile,
  RegisteredAgent,
  StorageProvider,
  StorageTier,
} from './model'
import type { ProcessorContext } from './processor'
import { createAccountFactory } from './utils/entities'
import { decodeLogData, isEventInSet } from './utils/hex'

const hexToBytes = (hex: string): Uint8Array => {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex
  return Uint8Array.from({ length: h.length / 2 }, (_, i) =>
    parseInt(h.slice(i * 2, i * 2 + 2), 16),
  )
}
const ZERO_BYTES = new Uint8Array(20)

// Event signatures for cross-service operations
const EVENT_SIGNATURES = {
  // Container stored in storage for compute use
  ContainerStored: keccak256(
    stringToHex('ContainerStored(string,address,address,uint256)'),
  ),

  // Container pulled from storage by compute provider
  ContainerPulled: keccak256(
    stringToHex('ContainerPulled(bytes32,string,address,address)'),
  ),

  // Compute rental started with container from storage
  RentalWithContainer: keccak256(
    stringToHex('RentalWithContainer(bytes32,string,address,address)'),
  ),

  // Compute output stored to storage
  OutputStored: keccak256(
    stringToHex('OutputStored(bytes32,string,address,address)'),
  ),

  // Agent linked to both compute and storage provider
  FullStackAgentRegistered: keccak256(
    stringToHex('FullStackAgentRegistered(uint256,address,address)'),
  ),
}

const CROSS_SERVICE_TOPIC_SET: Set<Hex> = new Set(
  Object.values(EVENT_SIGNATURES),
)

export function isCrossServiceProcessorEvent(topic0: string): boolean {
  return isEventInSet(topic0, CROSS_SERVICE_TOPIC_SET)
}

/**
 * Process cross-service events and update related entities
 */
export async function processCrossServiceEvents(
  ctx: ProcessorContext<Store>,
): Promise<void> {
  const containerFiles = new Map<string, IPFSFile>()
  const containerImages = new Map<string, ContainerImage>()
  const crossServiceRequests = new Map<string, CrossServiceRequest>()
  const updatedComputeProviders = new Map<string, ComputeProvider>()
  const updatedStorageProviders = new Map<string, StorageProvider>()
  const updatedAgents = new Map<string, RegisteredAgent>()
  const accountFactory = createAccountFactory()

  for (const block of ctx.blocks) {
    const header = block.header
    const blockTimestamp = new Date(header.timestamp)

    for (const log of block.logs) {
      const eventSig = log.topics[0]

      if (!eventSig || !isEventInSet(eventSig, CROSS_SERVICE_TOPIC_SET))
        continue

      const txHash =
        log.transaction?.hash || `${header.hash}-${log.transactionIndex}`

      // ContainerStored(string cid, address uploader, address storageProvider, uint256 sizeBytes)
      if (eventSig === EVENT_SIGNATURES.ContainerStored) {
        const decoded = decodeLogData(
          [
            { type: 'string' },
            { type: 'address' },
            { type: 'address' },
            { type: 'uint256' },
          ] as const,
          log.data,
        )

        const cid = decoded[0]
        const uploader = decoded[1]
        const storageProviderAddr = decoded[2]
        const sizeBytes = decoded[3]

        const uploaderAccount = accountFactory.getOrCreate(
          uploader,
          header.height,
          blockTimestamp,
        )

        // Create IPFS file entry for container
        const fileId = cid
        let file = containerFiles.get(fileId)
        if (!file) {
          file = await ctx.store.get(IPFSFile, fileId)
        }

        if (!file) {
          file = new IPFSFile({
            id: fileId,
            cid,
            owner: hexToBytes(uploader),
            sizeBytes,
            paidAmount: 0n,
            paymentToken: ZERO_BYTES,
            createdAt: blockTimestamp,
            expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // Default 1 year
            isPinned: true,
            category: FileCategory.CONTAINER_IMAGE,
            relatedContract: hexToBytes(storageProviderAddr),
          })
        }

        containerFiles.set(fileId, file)

        // Get or create storage provider reference
        let storageProvider = updatedStorageProviders.get(
          storageProviderAddr.toLowerCase(),
        )
        if (!storageProvider) {
          storageProvider = await ctx.store.get(
            StorageProvider,
            storageProviderAddr.toLowerCase(),
          )
        }
        if (storageProvider) {
          storageProvider.lastUpdated = blockTimestamp
          updatedStorageProviders.set(
            storageProviderAddr.toLowerCase(),
            storageProvider,
          )
        }

        // Create ContainerImage entity
        let containerImage = containerImages.get(cid)
        if (!containerImage) {
          containerImage = await ctx.store.get(ContainerImage, cid)
        }

        if (!containerImage) {
          containerImage = new ContainerImage({
            id: cid,
            cid,
            name: `container-${cid.slice(0, 8)}`,
            tag: 'latest',
            sizeBytes,
            uploadedAt: blockTimestamp,
            uploadedBy: uploaderAccount,
            storageProvider: storageProvider || undefined,
            tier: StorageTier.HOT,
            architecture: ContainerArchitecture.AMD64,
            gpuRequired: false,
            teeRequired: false,
            contentHash: cid,
            verified: false,
            pullCount: 0,
          })
        }

        containerImages.set(cid, containerImage)

        ctx.log.info(
          `Container stored: ${cid.slice(0, 16)}... on ${storageProviderAddr.slice(0, 10)}...`,
        )
      }

      // ContainerPulled(bytes32 rentalId, string cid, address computeProvider, address storageProvider)
      if (eventSig === EVENT_SIGNATURES.ContainerPulled) {
        const rentalId = log.topics[1]
        const decoded = decodeLogData(
          [
            { type: 'string' },
            { type: 'address' },
            { type: 'address' },
          ] as const,
          log.data,
        )

        const cid = decoded[0]
        const computeProviderAddr = decoded[1]
        const storageProviderAddr = decoded[2]

        // Get compute provider
        let computeProvider = updatedComputeProviders.get(
          computeProviderAddr.toLowerCase(),
        )
        if (!computeProvider) {
          computeProvider = await ctx.store.get(
            ComputeProvider,
            computeProviderAddr.toLowerCase(),
          )
        }
        if (computeProvider) {
          computeProvider.lastUpdated = blockTimestamp
          updatedComputeProviders.set(
            computeProviderAddr.toLowerCase(),
            computeProvider,
          )
        }

        // Get storage provider
        let storageProvider = updatedStorageProviders.get(
          storageProviderAddr.toLowerCase(),
        )
        if (!storageProvider) {
          storageProvider = await ctx.store.get(
            StorageProvider,
            storageProviderAddr.toLowerCase(),
          )
        }

        // Update container image pull count
        let containerImage = containerImages.get(cid)
        if (!containerImage) {
          containerImage = await ctx.store.get(ContainerImage, cid)
        }
        if (containerImage) {
          containerImage.pullCount += 1
          containerImage.lastPulledAt = blockTimestamp
          containerImages.set(cid, containerImage)
        }

        // Get rental if exists
        const rental = rentalId
          ? await ctx.store.get(ComputeRental, rentalId)
          : undefined

        // Create requester account (use compute provider address as requester)
        const requesterAccount = accountFactory.getOrCreate(
          computeProviderAddr,
          header.height,
          blockTimestamp,
        )

        // Create CrossServiceRequest entity
        const requestId = `${txHash}-${log.logIndex}`
        const crossServiceRequest = new CrossServiceRequest({
          id: requestId,
          requestId,
          requester: requesterAccount,
          requestType: CrossServiceRequestType.CONTAINER_PULL,
          containerImage: containerImage || undefined,
          sourceCid: cid,
          sourceProvider: storageProvider || undefined,
          destinationProvider: computeProvider || undefined,
          destinationRental: rental || undefined,
          status: CrossServiceRequestStatus.COMPLETED,
          createdAt: blockTimestamp,
          completedAt: blockTimestamp,
          storageCost: 0n,
          bandwidthCost: 0n,
          totalCost: 0n,
          txHash,
          blockNumber: header.height,
        })

        crossServiceRequests.set(requestId, crossServiceRequest)

        ctx.log.debug(
          `Container pulled: ${cid.slice(0, 16)}... for rental ${rentalId?.slice(0, 10) ?? 'N/A'}...`,
        )
      }

      // RentalWithContainer(bytes32 rentalId, string cid, address computeProvider, address storageProvider)
      if (eventSig === EVENT_SIGNATURES.RentalWithContainer) {
        const rentalId = log.topics[1]
        const decoded = decodeLogData(
          [
            { type: 'string' },
            { type: 'address' },
            { type: 'address' },
          ] as const,
          log.data,
        )

        const cid = decoded[0]
        // decoded[1] is computeProviderAddr - unused currently

        // Link the rental to the container file
        let file = containerFiles.get(cid)
        if (!file) {
          file = await ctx.store.get(IPFSFile, cid)
        }
        if (file) {
          file.relatedEntityId = rentalId
          containerFiles.set(cid, file)
        }

        ctx.log.info(
          `Rental ${rentalId.slice(0, 10)}... using container ${cid.slice(0, 16)}...`,
        )
      }

      // OutputStored(bytes32 rentalId, string cid, address computeProvider, address storageProvider)
      if (eventSig === EVENT_SIGNATURES.OutputStored) {
        const rentalId = log.topics[1]
        const decoded = decodeLogData(
          [
            { type: 'string' },
            { type: 'address' },
            { type: 'address' },
          ] as const,
          log.data,
        )

        const cid = decoded[0]
        const computeProviderAddr = decoded[1]
        const storageProviderAddr = decoded[2]

        // Create file entry for compute output
        const file = new IPFSFile({
          id: cid,
          cid,
          owner: hexToBytes(computeProviderAddr),
          sizeBytes: 0n,
          paidAmount: 0n,
          paymentToken: ZERO_BYTES,
          createdAt: blockTimestamp,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          isPinned: true,
          category: FileCategory.USER_CONTENT, // Compute output
          relatedContract: hexToBytes(storageProviderAddr),
          relatedEntityId: rentalId,
        })

        containerFiles.set(cid, file)

        ctx.log.debug(
          `Compute output stored: ${cid.slice(0, 16)}... from rental ${rentalId.slice(0, 10)}...`,
        )
      }

      // FullStackAgentRegistered(uint256 agentId, address computeProvider, address storageProvider)
      if (eventSig === EVENT_SIGNATURES.FullStackAgentRegistered) {
        const agentId = BigInt(log.topics[1])
        const computeProviderAddr = `0x${log.topics[2].slice(26)}`
        const storageProviderAddr = `0x${log.topics[3].slice(26)}`

        // Update agent with full-stack status
        const agentIdStr = agentId.toString()
        let agent = updatedAgents.get(agentIdStr)
        if (!agent) {
          agent = await ctx.store.get(RegisteredAgent, agentIdStr)
        }
        if (agent) {
          // Add full-stack tag
          if (!agent.tags.includes('full-stack')) {
            agent.tags = [...agent.tags, 'full-stack']
          }
          if (!agent.tags.includes('compute')) {
            agent.tags = [...agent.tags, 'compute']
          }
          if (!agent.tags.includes('storage')) {
            agent.tags = [...agent.tags, 'storage']
          }
          agent.lastActivityAt = blockTimestamp
          updatedAgents.set(agentIdStr, agent)
        }

        // Update compute provider with agent link
        let computeProvider = updatedComputeProviders.get(
          computeProviderAddr.toLowerCase(),
        )
        if (!computeProvider) {
          computeProvider = await ctx.store.get(
            ComputeProvider,
            computeProviderAddr.toLowerCase(),
          )
        }
        if (computeProvider) {
          computeProvider.agentId = Number(agentId)
          computeProvider.lastUpdated = blockTimestamp
          updatedComputeProviders.set(
            computeProviderAddr.toLowerCase(),
            computeProvider,
          )
        }

        // Update storage provider with agent link
        let storageProvider = updatedStorageProviders.get(
          storageProviderAddr.toLowerCase(),
        )
        if (!storageProvider) {
          storageProvider = await ctx.store.get(
            StorageProvider,
            storageProviderAddr.toLowerCase(),
          )
        }
        if (storageProvider) {
          storageProvider.agentId = Number(agentId)
          storageProvider.lastUpdated = blockTimestamp
          updatedStorageProviders.set(
            storageProviderAddr.toLowerCase(),
            storageProvider,
          )
        }

        ctx.log.info(
          `Full-stack agent ${agentId} linked: compute=${computeProviderAddr.slice(0, 10)}... storage=${storageProviderAddr.slice(0, 10)}...`,
        )
      }
    }
  }

  // Persist entities - order matters for foreign key dependencies
  if (accountFactory.hasAccounts()) {
    await ctx.store.upsert(accountFactory.getAll())
  }
  if (updatedStorageProviders.size > 0) {
    await ctx.store.upsert([...updatedStorageProviders.values()])
  }
  if (updatedComputeProviders.size > 0) {
    await ctx.store.upsert([...updatedComputeProviders.values()])
  }
  if (containerFiles.size > 0) {
    await ctx.store.upsert([...containerFiles.values()])
  }
  if (containerImages.size > 0) {
    await ctx.store.upsert([...containerImages.values()])
  }
  if (crossServiceRequests.size > 0) {
    await ctx.store.upsert([...crossServiceRequests.values()])
  }
  if (updatedAgents.size > 0) {
    await ctx.store.upsert([...updatedAgents.values()])
  }

  // Log summary
  const total =
    containerFiles.size +
    containerImages.size +
    crossServiceRequests.size +
    updatedComputeProviders.size +
    updatedStorageProviders.size +
    updatedAgents.size
  if (total > 0) {
    ctx.log.info(
      `Cross-service: ${containerImages.size} containers, ${crossServiceRequests.size} requests, ` +
        `${updatedComputeProviders.size} compute, ${updatedStorageProviders.size} storage, ` +
        `${updatedAgents.size} agents`,
    )
  }
}

/**
 * Get marketplace stats across compute and storage
 * Called periodically or on-demand for API responses
 */
export async function getMarketplaceStats(
  ctx: ProcessorContext<Store>,
): Promise<{
  compute: {
    totalProviders: number
    activeProviders: number
    agentLinked: number
    totalStaked: string
  }
  storage: {
    totalProviders: number
    activeProviders: number
    agentLinked: number
    totalCapacityTB: number
  }
  crossService: {
    containerImages: number
    fullStackAgents: number
  }
}> {
  // Query compute providers
  const computeProviders = await ctx.store.find(ComputeProvider)
  const activeComputeProviders = computeProviders.filter((p) => p.isActive)
  const agentLinkedCompute = computeProviders.filter(
    (p) => p.agentId && p.agentId > 0,
  )
  const totalComputeStake = computeProviders.reduce(
    (sum, p) => sum + p.stakeAmount,
    0n,
  )

  // Query storage providers
  const storageProviders = await ctx.store.find(StorageProvider)
  const activeStorageProviders = storageProviders.filter((p) => p.isActive)
  const agentLinkedStorage = storageProviders.filter(
    (p) => p.agentId && p.agentId > 0,
  )
  const totalCapacity = storageProviders.reduce(
    (sum, p) => sum + Number(p.totalCapacityGB),
    0,
  )

  // Query container files
  const containerFiles = await ctx.store.find(IPFSFile, {
    where: { category: FileCategory.GAME_ASSET },
  })

  // Query full-stack agents - count manually since array contains is complex
  const allAgents = await ctx.store.find(RegisteredAgent)
  const fullStackAgents = allAgents.filter((a) =>
    a.tags?.includes('full-stack'),
  )

  return {
    compute: {
      totalProviders: computeProviders.length,
      activeProviders: activeComputeProviders.length,
      agentLinked: agentLinkedCompute.length,
      totalStaked: formatEther(totalComputeStake),
    },
    storage: {
      totalProviders: storageProviders.length,
      activeProviders: activeStorageProviders.length,
      agentLinked: agentLinkedStorage.length,
      totalCapacityTB: totalCapacity / 1024,
    },
    crossService: {
      containerImages: containerFiles.length,
      fullStackAgents: fullStackAgents.length,
    },
  }
}
