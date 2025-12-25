/**
 * Node Staking Processor - Indexes node registration, performance, and governance
 */

import type { Store } from '@subsquid/typeorm-store'
import { keccak256, parseAbi, stringToHex } from 'viem'
import {
  GovernanceEvent,
  GovernanceProposal,
  NodeStake,
  PerformanceUpdate,
  RewardClaim,
} from './model'
import type { ProcessorContext } from './processor'
import { decodeEventArgs } from './utils/hex'

// Event argument interfaces
interface NodeRegisteredArgs {
  nodeId: string
  operator: string
  stakedToken: string
  stakedAmount: bigint
  rpcUrl: string
  region: number
}

interface PerformanceUpdatedArgs {
  nodeId: string
  uptimeScore: bigint
  requestsServed: bigint
  avgResponseTime: bigint
}

interface RewardsClaimedArgs {
  nodeId: string
  operator: string
  rewardToken: string
  amount: bigint
  paymasterFeesETH: bigint
}

interface ProposalCreatedArgs {
  proposalId: string
  parameter: string
  currentValue: bigint
  proposedValue: bigint
  proposer: string
}

interface ProposalExecutedArgs {
  proposalId: string
  outcome: boolean
}

interface ProposalVetoedArgs {
  proposalId: string
  admin: string
  reason: string
}

const EMPTY_BYTES32 = Buffer.from(
  '0000000000000000000000000000000000000000000000000000000000000000',
  'hex',
)

const nodeStakingInterface = parseAbi([
  'event NodeRegistered(bytes32 indexed nodeId, address indexed operator, address stakedToken, uint256 stakedAmount, string rpcUrl, uint8 region)',
  'event PerformanceUpdated(bytes32 indexed nodeId, uint256 uptimeScore, uint256 requestsServed, uint256 avgResponseTime)',
  'event RewardsClaimed(bytes32 indexed nodeId, address indexed operator, address rewardToken, uint256 amount, uint256 paymasterFeesETH)',
  'event NodeSlashed(bytes32 indexed nodeId, address indexed operator, string reason)',
  'event ProposalCreated(bytes32 indexed proposalId, string parameter, uint256 currentValue, uint256 proposedValue, address proposer)',
  'event ProposalExecuted(bytes32 indexed proposalId, bool outcome)',
  'event ProposalVetoed(bytes32 indexed proposalId, address admin, string reason)',
])

const NODE_REGISTERED = keccak256(
  stringToHex('NodeRegistered(bytes32,address,address,uint256,string,uint8)'),
)
const PERFORMANCE_UPDATED = keccak256(
  stringToHex('PerformanceUpdated(bytes32,uint256,uint256,uint256)'),
)
const REWARDS_CLAIMED = keccak256(
  stringToHex('RewardsClaimed(bytes32,address,address,uint256,uint256)'),
)
const NODE_SLASHED = keccak256(
  stringToHex('NodeSlashed(bytes32,address,string)'),
)
const PROPOSAL_CREATED = keccak256(
  stringToHex('ProposalCreated(bytes32,string,uint256,uint256,address)'),
)
const PROPOSAL_EXECUTED = keccak256(
  stringToHex('ProposalExecuted(bytes32,bool)'),
)
const PROPOSAL_VETOED = keccak256(
  stringToHex('ProposalVetoed(bytes32,address,string)'),
)

export async function processNodeStakingEvents(
  ctx: ProcessorContext<Store>,
): Promise<void> {
  const nodes = new Map<string, NodeStake>()
  const performanceUpdates: PerformanceUpdate[] = []
  const rewardClaims: RewardClaim[] = []
  const proposals = new Map<string, GovernanceProposal>()
  const proposalEvents: GovernanceEvent[] = []

  for (const block of ctx.blocks) {
    for (const log of block.logs) {
      const eventSig = log.topics[0]
      if (!log.transaction) continue
      const txHash = log.transaction.hash

      if (eventSig === NODE_REGISTERED) {
        const nodeId = log.topics[1]
        const args = decodeEventArgs<NodeRegisteredArgs>(
          nodeStakingInterface,
          log.data,
          log.topics,
        )

        nodes.set(
          nodeId,
          new NodeStake({
            id: nodeId,
            nodeId,
            operator: args.operator,
            stakedToken: args.stakedToken,
            stakedAmount: BigInt(args.stakedAmount.toString()),
            stakedValueUSD: 0n,
            rewardToken: args.stakedToken,
            totalRewardsClaimed: 0n,
            lastClaimTime: 0n,
            rpcUrl: args.rpcUrl,
            geographicRegion: args.region,
            registrationTime: BigInt(block.header.timestamp),
            isActive: true,
            isSlashed: false,
          }),
        )
      } else if (eventSig === PERFORMANCE_UPDATED) {
        const nodeId = log.topics[1]
        const args = decodeEventArgs<PerformanceUpdatedArgs>(
          nodeStakingInterface,
          log.data,
          log.topics,
        )

        const node = nodes.get(nodeId)
        if (node) {
          node.currentUptimeScore = BigInt(args.uptimeScore.toString())
          node.currentRequestsServed = BigInt(args.requestsServed.toString())
          node.currentAvgResponseTime = BigInt(args.avgResponseTime.toString())

          performanceUpdates.push(
            new PerformanceUpdate({
              id: `${txHash}-${log.logIndex}`,
              node,
              uptimeScore: BigInt(args.uptimeScore.toString()),
              requestsServed: BigInt(args.requestsServed.toString()),
              avgResponseTime: BigInt(args.avgResponseTime.toString()),
              timestamp: BigInt(block.header.timestamp),
              blockNumber: BigInt(block.header.height),
              transactionHash: txHash,
            }),
          )
        }
      } else if (eventSig === REWARDS_CLAIMED) {
        const nodeId = log.topics[1]
        const args = decodeEventArgs<RewardsClaimedArgs>(
          nodeStakingInterface,
          log.data,
          log.topics,
        )

        const node = nodes.get(nodeId)
        if (node) {
          const amount = BigInt(args.amount.toString())
          node.totalRewardsClaimed = node.totalRewardsClaimed + amount
          node.lastClaimTime = BigInt(block.header.timestamp)

          rewardClaims.push(
            new RewardClaim({
              id: `${txHash}-${log.logIndex}`,
              node,
              operator: args.operator,
              rewardToken: args.rewardToken,
              rewardAmount: amount,
              paymasterFeesETH: BigInt(args.paymasterFeesETH.toString()),
              timestamp: BigInt(block.header.timestamp),
              blockNumber: BigInt(block.header.height),
              transactionHash: txHash,
            }),
          )
        }
      } else if (eventSig === NODE_SLASHED) {
        const nodeId = log.topics[1]
        const node = nodes.get(nodeId)
        if (node) {
          node.isSlashed = true
          node.isActive = false
        }
      } else if (eventSig === PROPOSAL_CREATED) {
        const proposalId = log.topics[1]
        const args = decodeEventArgs<ProposalCreatedArgs>(
          nodeStakingInterface,
          log.data,
          log.topics,
        )

        const proposal = new GovernanceProposal({
          id: proposalId,
          proposalId: Buffer.from(proposalId.slice(2), 'hex'),
          parameter: args.parameter,
          currentValue: BigInt(args.currentValue.toString()),
          proposedValue: BigInt(args.proposedValue.toString()),
          changeMarketId: EMPTY_BYTES32,
          statusQuoMarketId: EMPTY_BYTES32,
          createdAt: BigInt(block.header.timestamp),
          votingEnds: BigInt(block.header.timestamp + 7 * 24 * 3600),
          executeAfter: BigInt(block.header.timestamp + 14 * 24 * 3600),
          executed: false,
          vetoed: false,
          proposer: args.proposer,
        })
        proposals.set(proposalId, proposal)

        proposalEvents.push(
          new GovernanceEvent({
            id: `${txHash}-${log.logIndex}`,
            proposal,
            eventType: 'created',
            actor: args.proposer,
            reason: null,
            timestamp: BigInt(block.header.timestamp),
            blockNumber: BigInt(block.header.height),
            transactionHash: txHash,
          }),
        )
      } else if (eventSig === PROPOSAL_EXECUTED) {
        const proposalId = log.topics[1]
        const proposal = proposals.get(proposalId)
        if (proposal) {
          // Decode to verify event type but we don't need the args for this event
          decodeEventArgs<ProposalExecutedArgs>(
            nodeStakingInterface,
            log.data,
            log.topics,
          )

          proposal.executed = true

          proposalEvents.push(
            new GovernanceEvent({
              id: `${txHash}-${log.logIndex}`,
              proposal,
              eventType: 'executed',
              actor: null,
              reason: null,
              timestamp: BigInt(block.header.timestamp),
              blockNumber: BigInt(block.header.height),
              transactionHash: txHash,
            }),
          )
        }
      } else if (eventSig === PROPOSAL_VETOED) {
        const proposalId = log.topics[1]
        const proposal = proposals.get(proposalId)
        if (proposal) {
          const args = decodeEventArgs<ProposalVetoedArgs>(
            nodeStakingInterface,
            log.data,
            log.topics,
          )

          proposal.vetoed = true

          proposalEvents.push(
            new GovernanceEvent({
              id: `${txHash}-${log.logIndex}`,
              proposal,
              eventType: 'vetoed',
              actor: args.admin,
              reason: args.reason,
              timestamp: BigInt(block.header.timestamp),
              blockNumber: BigInt(block.header.height),
              transactionHash: txHash,
            }),
          )
        }
      }
    }
  }

  await ctx.store.upsert([...nodes.values()])
  await ctx.store.insert(performanceUpdates)
  await ctx.store.insert(rewardClaims)
  await ctx.store.upsert([...proposals.values()])
  await ctx.store.insert(proposalEvents)
}
