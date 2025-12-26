/**
 * Registry and game event processor
 */

import { ZERO_ADDRESS } from '@jejunetwork/types'
import type { Store } from '@subsquid/typeorm-store'
import { decodeAbiParameters, hexToString, parseAbi, zeroHash } from 'viem'
import { z } from 'zod'
import {
  AgentBanEvent,
  AgentFeedback,
  AgentMetadata,
  AgentSlashEvent,
  AgentStakeEvent,
  AgentValidation,
  FeedbackResponse,
  RegisteredAgent,
  type RegistryStake,
  TagUpdate,
} from '../src/model'
import type { ProcessorContext } from './processor'
import { createAccountFactory, relationId } from './utils/entities'
import { decodeEventArgs } from './utils/hex'

const stringArraySchema = z.array(z.string())

// Event argument types for IdentityRegistry
interface RegisteredArgs {
  agentId: bigint
  owner: string
  tier: number
  stakedAmount: bigint
  tokenURI: string
}

interface StakeIncreasedArgs {
  agentId: bigint
  oldTier: number
  newTier: number
  addedAmount: bigint
}

interface StakeWithdrawnArgs {
  agentId: bigint
  owner: string
  amount: bigint
}

interface AgentBannedArgs {
  agentId: bigint
  reason: string
}

interface AgentSlashedArgs {
  agentId: bigint
  slashAmount: bigint
  reason: string
}

interface TagsUpdatedArgs {
  agentId: bigint
  tags: readonly string[]
}

interface AgentUriUpdatedArgs {
  agentId: bigint
  newTokenURI: string
}

interface MetadataSetArgs {
  agentId: bigint
  indexedKey: string
  key: string
  value: `0x${string}`
}

// Event argument types for ReputationRegistry
interface NewFeedbackArgs {
  agentId: bigint
  clientAddress: string
  score: number
  tag1: string
  tag2: string
  fileuri: string
  filehash: string
}

interface FeedbackRevokedArgs {
  agentId: bigint
  clientAddress: string
  feedbackIndex: bigint
}

interface ResponseAppendedArgs {
  agentId: bigint
  clientAddress: string
  feedbackIndex: bigint
  responder: string
  responseUri: string
  responseHash: string
}

// Event argument types for ValidationRegistry
interface ValidationRequestArgs {
  validatorAddress: string
  agentId: bigint
  requestUri: string
  requestHash: string
}

interface ValidationResponseArgs {
  validatorAddress: string
  agentId: bigint
  requestHash: string
  response: number
  responseUri: string
  responseHash: string
  tag: string
}

// Event argument types for BanManager
interface NetworkBanAppliedArgs {
  agentId: bigint
  reason: string
  proposalId: string
  timestamp: bigint
}

interface AppBanAppliedArgs {
  agentId: bigint
  appId: string
  reason: string
  proposalId: string
  timestamp: bigint
}

import {
  AGENT_BANNED,
  AGENT_REGISTERED,
  AGENT_SLASHED,
  AGENT_UNBANNED,
  AGENT_URI_UPDATED,
  APP_BAN_APPLIED,
  APP_BAN_REMOVED,
  FEEDBACK_REVOKED,
  METADATA_SET,
  NETWORK_BAN_APPLIED,
  NETWORK_BAN_REMOVED,
  NEW_FEEDBACK,
  RESPONSE_APPENDED,
  STAKE_INCREASED,
  STAKE_WITHDRAWN,
  TAGS_UPDATED,
  VALIDATION_REQUEST,
  VALIDATION_RESPONSE,
} from './contract-events'

// ABI for decoding events
const identityRegistryInterface = parseAbi([
  'event Registered(uint256 indexed agentId, address indexed owner, uint8 tier, uint256 stakedAmount, string tokenURI)',
  'event StakeIncreased(uint256 indexed agentId, uint8 oldTier, uint8 newTier, uint256 addedAmount)',
  'event StakeWithdrawn(uint256 indexed agentId, address indexed owner, uint256 amount)',
  'event AgentBanned(uint256 indexed agentId, string reason)',
  'event AgentUnbanned(uint256 indexed agentId)',
  'event AgentSlashed(uint256 indexed agentId, uint256 slashAmount, string reason)',
  'event TagsUpdated(uint256 indexed agentId, string[] tags)',
  'event AgentUriUpdated(uint256 indexed agentId, string newTokenURI)',
  'event MetadataSet(uint256 indexed agentId, string indexed indexedKey, string key, bytes value)',
])

const reputationRegistryInterface = parseAbi([
  'event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint8 score, bytes32 tag1, bytes32 tag2, string fileuri, bytes32 filehash)',
  'event FeedbackRevoked(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex)',
  'event ResponseAppended(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, address responder, string responseUri, bytes32 responseHash)',
])

const validationRegistryInterface = parseAbi([
  'event ValidationRequest(address indexed validatorAddress, uint256 indexed agentId, string requestUri, bytes32 requestHash)',
  'event ValidationResponse(address indexed validatorAddress, uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, string responseUri, bytes32 responseHash, bytes32 tag)',
])

const banManagerInterface = parseAbi([
  'event NetworkBanApplied(uint256 indexed agentId, string reason, bytes32 indexed proposalId, uint256 timestamp)',
  'event AppBanApplied(uint256 indexed agentId, bytes32 indexed appId, string reason, bytes32 indexed proposalId, uint256 timestamp)',
  'event NetworkBanRemoved(uint256 indexed agentId, uint256 timestamp)',
  'event AppBanRemoved(uint256 indexed agentId, bytes32 indexed appId, uint256 timestamp)',
])

export async function processRegistryEvents(
  ctx: ProcessorContext<Store>,
): Promise<void> {
  const agents = new Map<string, RegisteredAgent>()
  const accountFactory = createAccountFactory()
  const metadataUpdates: AgentMetadata[] = []
  const tagUpdates: TagUpdate[] = []
  const stakes: RegistryStake[] = []
  const banEvents: AgentBanEvent[] = []
  const slashEvents: AgentSlashEvent[] = []
  const stakeEvents: AgentStakeEvent[] = []
  const feedbackEntries: AgentFeedback[] = []
  const feedbackResponses: FeedbackResponse[] = []
  const validations: AgentValidation[] = []

  async function getOrCreateAgent(
    agentId: bigint,
    _blockTimestamp: Date,
  ): Promise<RegisteredAgent | undefined> {
    const id = agentId.toString()
    let agent = agents.get(id)
    if (!agent) {
      // Try to load from store
      agent = await ctx.store.get(RegisteredAgent, id)
      if (agent) {
        agents.set(id, agent)
      }
    }
    return agent
  }

  for (const block of ctx.blocks) {
    const blockTimestamp = new Date(block.header.timestamp)

    for (const log of block.logs) {
      const topic0 = log.topics[0]
      if (!log.transaction) continue
      const txHash = log.transaction.hash

      if (topic0 === AGENT_REGISTERED) {
        const args = decodeEventArgs<RegisteredArgs>(
          identityRegistryInterface,
          log.data,
          log.topics,
        )

        const agentId = BigInt(log.topics[1])
        const id = agentId.toString()
        const ownerAddress = `0x${log.topics[2].slice(26)}`
        const owner = accountFactory.getOrCreate(
          ownerAddress,
          block.header.height,
          blockTimestamp,
        )

        agents.set(
          id,
          new RegisteredAgent({
            id,
            agentId,
            owner,
            tokenURI: args.tokenURI,
            name: args.tokenURI || `Agent #${id}`,
            tags: [],
            stakeTier: Number(args.tier),
            stakeToken: ZERO_ADDRESS,
            stakeAmount: BigInt(args.stakedAmount.toString()),
            stakeWithdrawn: false,
            isSlashed: false,
            isBanned: false,
            registeredAt: blockTimestamp,
            depositedAt:
              args.stakedAmount > 0n ? BigInt(block.header.timestamp) : 0n,
            lastActivityAt: blockTimestamp,
            active: true,
            // Marketplace fields - initialized as empty/default
            a2aEndpoint: undefined,
            mcpEndpoint: undefined,
            serviceType: 'agent',
            category: undefined,
            x402Support: false,
            mcpTools: [],
            a2aSkills: [],
            image: undefined,
          }),
        )
      } else if (topic0 === STAKE_INCREASED) {
        const args = decodeEventArgs<StakeIncreasedArgs>(
          identityRegistryInterface,
          log.data,
          log.topics,
        )

        const agentId = BigInt(log.topics[1])
        const agent = await getOrCreateAgent(agentId, blockTimestamp)
        if (!agent) continue

        const oldTier = Number(args.oldTier)
        const newTier = Number(args.newTier)
        const addedAmount = BigInt(args.addedAmount.toString())

        agent.stakeTier = newTier
        agent.stakeAmount = agent.stakeAmount + addedAmount
        agent.lastActivityAt = blockTimestamp

        stakeEvents.push(
          new AgentStakeEvent({
            id: `${txHash}-${log.logIndex}`,
            agent,
            eventType: 'increase',
            oldTier,
            newTier,
            amount: addedAmount,
            token: agent.stakeToken,
            timestamp: blockTimestamp,
            txHash,
            blockNumber: block.header.height,
          }),
        )
      } else if (topic0 === STAKE_WITHDRAWN) {
        const args = decodeEventArgs<StakeWithdrawnArgs>(
          identityRegistryInterface,
          log.data,
          log.topics,
        )

        const agentId = BigInt(log.topics[1])
        const agent = await getOrCreateAgent(agentId, blockTimestamp)
        if (!agent) continue

        const amount = BigInt(args.amount.toString())

        stakeEvents.push(
          new AgentStakeEvent({
            id: `${txHash}-${log.logIndex}`,
            agent,
            eventType: 'withdraw',
            oldTier: agent.stakeTier,
            newTier: 0,
            amount,
            token: agent.stakeToken,
            timestamp: blockTimestamp,
            txHash,
            blockNumber: block.header.height,
          }),
        )

        agent.stakeTier = 0
        agent.stakeAmount = 0n
        agent.stakeWithdrawn = true
        agent.withdrawnAt = BigInt(block.header.timestamp)
        agent.active = false
      } else if (topic0 === AGENT_BANNED) {
        const args = decodeEventArgs<AgentBannedArgs>(
          identityRegistryInterface,
          log.data,
          log.topics,
        )

        const agentId = BigInt(log.topics[1])
        const agent = await getOrCreateAgent(agentId, blockTimestamp)
        if (!agent) continue

        agent.isBanned = true
        agent.lastActivityAt = blockTimestamp

        banEvents.push(
          new AgentBanEvent({
            id: `${txHash}-${log.logIndex}`,
            agent,
            isBan: true,
            banType: 'registry',
            reason: args.reason,
            timestamp: blockTimestamp,
            txHash,
            blockNumber: block.header.height,
          }),
        )
      } else if (topic0 === AGENT_UNBANNED) {
        const agentId = BigInt(log.topics[1])
        const agent = await getOrCreateAgent(agentId, blockTimestamp)
        if (!agent) continue

        agent.isBanned = false
        agent.lastActivityAt = blockTimestamp

        banEvents.push(
          new AgentBanEvent({
            id: `${txHash}-${log.logIndex}`,
            agent,
            isBan: false,
            banType: 'registry',
            timestamp: blockTimestamp,
            txHash,
            blockNumber: block.header.height,
          }),
        )
      } else if (topic0 === AGENT_SLASHED) {
        const args = decodeEventArgs<AgentSlashedArgs>(
          identityRegistryInterface,
          log.data,
          log.topics,
        )

        const agentId = BigInt(log.topics[1])
        const agent = await getOrCreateAgent(agentId, blockTimestamp)
        if (!agent) continue

        const slashAmount = BigInt(args.slashAmount.toString())

        agent.isSlashed = true
        agent.stakeAmount = agent.stakeAmount - slashAmount
        agent.lastActivityAt = blockTimestamp

        slashEvents.push(
          new AgentSlashEvent({
            id: `${txHash}-${log.logIndex}`,
            agent,
            slashAmount,
            reason: args.reason,
            timestamp: blockTimestamp,
            txHash,
            blockNumber: block.header.height,
          }),
        )
      } else if (topic0 === TAGS_UPDATED) {
        const args = decodeEventArgs<TagsUpdatedArgs>(
          identityRegistryInterface,
          log.data,
          log.topics,
        )

        const agentId = BigInt(log.topics[1])
        const agent = await getOrCreateAgent(agentId, blockTimestamp)
        if (!agent) continue

        const oldTags = [...agent.tags]
        const newTags = [...args.tags]
        agent.tags = newTags
        agent.lastActivityAt = blockTimestamp

        tagUpdates.push(
          new TagUpdate({
            id: `${txHash}-${log.logIndex}`,
            agent,
            oldTags,
            newTags,
            updatedAt: blockTimestamp,
            txHash,
            blockNumber: block.header.height,
          }),
        )
      } else if (topic0 === AGENT_URI_UPDATED) {
        const args = decodeEventArgs<AgentUriUpdatedArgs>(
          identityRegistryInterface,
          log.data,
          log.topics,
        )

        const agentId = BigInt(log.topics[1])
        const agent = await getOrCreateAgent(agentId, blockTimestamp)
        if (!agent) continue

        agent.tokenURI = args.newTokenURI
        agent.lastActivityAt = blockTimestamp
      } else if (topic0 === METADATA_SET) {
        const args = decodeEventArgs<MetadataSetArgs>(
          identityRegistryInterface,
          log.data,
          log.topics,
        )

        const agentId = BigInt(log.topics[1])
        const agent = await getOrCreateAgent(agentId, blockTimestamp)
        if (!agent) continue

        const key = args.key
        let metadataValue: string

        // Update agent fields based on key
        if (key === 'x402Support') {
          // x402Support is ABI-encoded as bool
          const decodedBool = decodeAbiParameters(
            [{ type: 'bool' }],
            args.value,
          )[0]
          agent.x402Support = decodedBool
          metadataValue = decodedBool ? 'true' : 'false'
        } else if (key === 'mcpTools') {
          const value = hexToString(args.value)
          agent.mcpTools = stringArraySchema.parse(JSON.parse(value))
          metadataValue = value
        } else if (key === 'a2aSkills') {
          const value = hexToString(args.value)
          agent.a2aSkills = stringArraySchema.parse(JSON.parse(value))
          metadataValue = value
        } else {
          // Standard string metadata fields
          metadataValue = hexToString(args.value)
          if (key === 'name') agent.name = metadataValue
          else if (key === 'description') agent.description = metadataValue
          else if (key === 'a2aEndpoint') agent.a2aEndpoint = metadataValue
          else if (key === 'mcpEndpoint') agent.mcpEndpoint = metadataValue
          else if (key === 'serviceType') agent.serviceType = metadataValue
          else if (key === 'category') agent.category = metadataValue
          else if (key === 'image') agent.image = metadataValue
        }

        agent.lastActivityAt = blockTimestamp

        metadataUpdates.push(
          new AgentMetadata({
            id: `${agentId.toString()}-${key}-${block.header.height}`,
            agent,
            key,
            value: metadataValue,
            updatedAt: blockTimestamp,
            txHash,
            blockNumber: block.header.height,
          }),
        )
      } else if (topic0 === NEW_FEEDBACK) {
        const args = decodeEventArgs<NewFeedbackArgs>(
          reputationRegistryInterface,
          log.data,
          log.topics,
        )

        const agentId = BigInt(log.topics[1])
        const clientAddress = `0x${log.topics[2].slice(26)}`
        const agent = await getOrCreateAgent(agentId, blockTimestamp)
        if (!agent) continue

        const client = accountFactory.getOrCreate(
          clientAddress,
          block.header.height,
          blockTimestamp,
        )

        feedbackEntries.push(
          new AgentFeedback({
            id: `${txHash}-${log.logIndex}`,
            agent,
            client,
            score: Number(args.score),
            tag1: args.tag1 !== zeroHash ? args.tag1 : null,
            tag2: args.tag2 !== zeroHash ? args.tag2 : null,
            fileUri: args.fileuri || null,
            fileHash: args.filehash !== zeroHash ? args.filehash : null,
            isRevoked: false,
            timestamp: blockTimestamp,
            txHash,
            blockNumber: block.header.height,
          }),
        )
      } else if (topic0 === FEEDBACK_REVOKED) {
        const args = decodeEventArgs<FeedbackRevokedArgs>(
          reputationRegistryInterface,
          log.data,
          log.topics,
        )

        const agentId = BigInt(log.topics[1])
        const clientAddress = `0x${log.topics[2].slice(26)}`
        const feedbackIndex = args.feedbackIndex

        // Find and revoke the feedback entry
        const feedbackId = `${agentId}-${clientAddress.toLowerCase()}-${feedbackIndex}`
        const existingFeedback = await ctx.store.get(AgentFeedback, feedbackId)
        if (existingFeedback) {
          existingFeedback.isRevoked = true
          feedbackEntries.push(existingFeedback)
          ctx.log.info(
            `Feedback revoked: agent ${agentId}, client ${clientAddress}, index ${feedbackIndex}`,
          )
        }
      } else if (topic0 === RESPONSE_APPENDED) {
        const args = decodeEventArgs<ResponseAppendedArgs>(
          reputationRegistryInterface,
          log.data,
          log.topics,
        )

        const agentId = BigInt(log.topics[1])
        const clientAddress = `0x${log.topics[2].slice(26)}`
        const responderAddress = args.responder

        const responder = accountFactory.getOrCreate(
          responderAddress,
          block.header.height,
          blockTimestamp,
        )

        // Find the feedback entry - for now we create a reference by constructing an ID
        // In production, we'd need to look up the actual feedback entity
        const feedbackId = `${agentId}-${clientAddress}-${args.feedbackIndex}`

        feedbackResponses.push(
          new FeedbackResponse({
            id: `${txHash}-${log.logIndex}`,
            feedback: relationId<AgentFeedback>(feedbackId),
            responder,
            responseUri: args.responseUri,
            responseHash:
              args.responseHash !== zeroHash ? args.responseHash : null,
            timestamp: blockTimestamp,
            txHash,
            blockNumber: block.header.height,
          }),
        )
      } else if (topic0 === VALIDATION_REQUEST) {
        const args = decodeEventArgs<ValidationRequestArgs>(
          validationRegistryInterface,
          log.data,
          log.topics,
        )

        const validatorAddress = `0x${log.topics[1].slice(26)}`
        const agentId = BigInt(log.topics[2])
        const agent = await getOrCreateAgent(agentId, blockTimestamp)
        if (!agent) continue

        const validator = accountFactory.getOrCreate(
          validatorAddress,
          block.header.height,
          blockTimestamp,
        )

        validations.push(
          new AgentValidation({
            id: args.requestHash,
            agent,
            validator,
            requestUri: args.requestUri,
            requestHash: args.requestHash,
            status: 'pending',
            requestedAt: blockTimestamp,
            requestTxHash: txHash,
            blockNumber: block.header.height,
          }),
        )
      } else if (topic0 === VALIDATION_RESPONSE) {
        const args = decodeEventArgs<ValidationResponseArgs>(
          validationRegistryInterface,
          log.data,
          log.topics,
        )

        const requestHash = log.topics[3]

        // Find and update the validation
        const existingValidation = await ctx.store.get(
          AgentValidation,
          requestHash,
        )
        if (existingValidation) {
          existingValidation.response = Number(args.response)
          existingValidation.responseUri = args.responseUri || null
          existingValidation.responseHash =
            args.responseHash !== zeroHash ? args.responseHash : null
          existingValidation.tag = args.tag !== zeroHash ? args.tag : null
          existingValidation.status = 'responded'
          existingValidation.respondedAt = blockTimestamp
          existingValidation.responseTxHash = txHash

          validations.push(existingValidation)
        }
      } else if (topic0 === NETWORK_BAN_APPLIED) {
        const args = decodeEventArgs<NetworkBanAppliedArgs>(
          banManagerInterface,
          log.data,
          log.topics,
        )

        const agentId = BigInt(log.topics[1])
        const proposalId = log.topics[2]
        const agent = await getOrCreateAgent(agentId, blockTimestamp)
        if (!agent) continue

        agent.isBanned = true
        agent.lastActivityAt = blockTimestamp

        banEvents.push(
          new AgentBanEvent({
            id: `${txHash}-${log.logIndex}`,
            agent,
            isBan: true,
            banType: 'network',
            reason: args.reason,
            proposalId,
            timestamp: blockTimestamp,
            txHash,
            blockNumber: block.header.height,
          }),
        )
      } else if (topic0 === APP_BAN_APPLIED) {
        const args = decodeEventArgs<AppBanAppliedArgs>(
          banManagerInterface,
          log.data,
          log.topics,
        )

        const agentId = BigInt(log.topics[1])
        const appId = log.topics[2]
        const proposalId = log.topics[3]
        const agent = await getOrCreateAgent(agentId, blockTimestamp)
        if (!agent) continue

        agent.lastActivityAt = blockTimestamp

        banEvents.push(
          new AgentBanEvent({
            id: `${txHash}-${log.logIndex}`,
            agent,
            isBan: true,
            banType: 'app',
            appId,
            reason: args.reason,
            proposalId,
            timestamp: blockTimestamp,
            txHash,
            blockNumber: block.header.height,
          }),
        )
      } else if (topic0 === NETWORK_BAN_REMOVED) {
        const agentId = BigInt(log.topics[1])
        const agent = await getOrCreateAgent(agentId, blockTimestamp)
        if (!agent) continue

        agent.isBanned = false
        agent.lastActivityAt = blockTimestamp

        banEvents.push(
          new AgentBanEvent({
            id: `${txHash}-${log.logIndex}`,
            agent,
            isBan: false,
            banType: 'network',
            timestamp: blockTimestamp,
            txHash,
            blockNumber: block.header.height,
          }),
        )
      } else if (topic0 === APP_BAN_REMOVED) {
        const agentId = BigInt(log.topics[1])
        const appId = log.topics[2]
        const agent = await getOrCreateAgent(agentId, blockTimestamp)
        if (!agent) continue

        agent.lastActivityAt = blockTimestamp

        banEvents.push(
          new AgentBanEvent({
            id: `${txHash}-${log.logIndex}`,
            agent,
            isBan: false,
            banType: 'app',
            appId,
            timestamp: blockTimestamp,
            txHash,
            blockNumber: block.header.height,
          }),
        )
      }
    }
  }

  // Persist all entities
  await ctx.store.upsert(accountFactory.getAll())
  await ctx.store.upsert([...agents.values()])
  await ctx.store.insert(metadataUpdates)
  await ctx.store.insert(tagUpdates)
  await ctx.store.insert(stakes)
  await ctx.store.insert(banEvents)
  await ctx.store.insert(slashEvents)
  await ctx.store.insert(stakeEvents)
  await ctx.store.insert(feedbackEntries)
  // Insert feedback responses after feedback entries (responses reference feedbacks)
  await ctx.store.insert(feedbackResponses)
  await ctx.store.insert(validations)
}
