/**
 * Node Staking Processor - Indexes node registration, performance, and governance
 */

import { ethers } from 'ethers';
import { Store } from '@subsquid/typeorm-store';
import { ProcessorContext } from './processor';
import { NodeStake, PerformanceUpdate, RewardClaim, GovernanceProposal, GovernanceEvent } from './model';

const EMPTY_BYTES32 = Buffer.from('0000000000000000000000000000000000000000000000000000000000000000', 'hex');

const nodeStakingInterface = new ethers.Interface([
    'event NodeRegistered(bytes32 indexed nodeId, address indexed operator, address stakedToken, uint256 stakedAmount, string rpcUrl, uint8 region)',
    'event PerformanceUpdated(bytes32 indexed nodeId, uint256 uptimeScore, uint256 requestsServed, uint256 avgResponseTime)',
    'event RewardsClaimed(bytes32 indexed nodeId, address indexed operator, address rewardToken, uint256 amount, uint256 paymasterFeesETH)',
    'event NodeSlashed(bytes32 indexed nodeId, address indexed operator, string reason)',
    'event ProposalCreated(bytes32 indexed proposalId, string parameter, uint256 currentValue, uint256 proposedValue, address proposer)',
    'event ProposalExecuted(bytes32 indexed proposalId, bool outcome)',
    'event ProposalVetoed(bytes32 indexed proposalId, address admin, string reason)'
]);

const NODE_REGISTERED = ethers.id('NodeRegistered(bytes32,address,address,uint256,string,uint8)');
const PERFORMANCE_UPDATED = ethers.id('PerformanceUpdated(bytes32,uint256,uint256,uint256)');
const REWARDS_CLAIMED = ethers.id('RewardsClaimed(bytes32,address,address,uint256,uint256)');
const NODE_SLASHED = ethers.id('NodeSlashed(bytes32,address,string)');
const PROPOSAL_CREATED = ethers.id('ProposalCreated(bytes32,string,uint256,uint256,address)');
const PROPOSAL_EXECUTED = ethers.id('ProposalExecuted(bytes32,bool)');
const PROPOSAL_VETOED = ethers.id('ProposalVetoed(bytes32,address,string)');

export async function processNodeStakingEvents(ctx: ProcessorContext<Store>): Promise<void> {
    const nodes = new Map<string, NodeStake>();
    const performanceUpdates: PerformanceUpdate[] = [];
    const rewardClaims: RewardClaim[] = [];
    const proposals = new Map<string, GovernanceProposal>();
    const proposalEvents: GovernanceEvent[] = [];

    for (const block of ctx.blocks) {
        for (const log of block.logs) {
            const eventSig = log.topics[0];
            if (!log.transaction) continue;
            const txHash = log.transaction.hash;
            
            if (eventSig === NODE_REGISTERED) {
                const nodeId = log.topics[1];
                const decoded = nodeStakingInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;
                
                nodes.set(nodeId, new NodeStake({
                    id: nodeId,
                    nodeId,
                    operator: decoded.args.operator,
                    stakedToken: decoded.args.stakedToken,
                    stakedAmount: BigInt(decoded.args.stakedAmount.toString()),
                    stakedValueUSD: 0n,
                    rewardToken: decoded.args.stakedToken,
                    totalRewardsClaimed: 0n,
                    lastClaimTime: 0n,
                    rpcUrl: decoded.args.rpcUrl,
                    geographicRegion: decoded.args.region,
                    registrationTime: BigInt(block.header.timestamp),
                    isActive: true,
                    isSlashed: false
                }));
            }
            else if (eventSig === PERFORMANCE_UPDATED) {
                const nodeId = log.topics[1];
                const decoded = nodeStakingInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;
                
                const node = nodes.get(nodeId);
                if (node) {
                    node.currentUptimeScore = BigInt(decoded.args.uptimeScore.toString());
                    node.currentRequestsServed = BigInt(decoded.args.requestsServed.toString());
                    node.currentAvgResponseTime = BigInt(decoded.args.avgResponseTime.toString());
                    
                    performanceUpdates.push(new PerformanceUpdate({
                        id: `${txHash}-${log.logIndex}`,
                        node,
                        uptimeScore: BigInt(decoded.args.uptimeScore.toString()),
                        requestsServed: BigInt(decoded.args.requestsServed.toString()),
                        avgResponseTime: BigInt(decoded.args.avgResponseTime.toString()),
                        timestamp: BigInt(block.header.timestamp),
                        blockNumber: BigInt(block.header.height),
                        transactionHash: txHash
                    }));
                }
            }
            else if (eventSig === REWARDS_CLAIMED) {
                const nodeId = log.topics[1];
                const decoded = nodeStakingInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;
                
                const node = nodes.get(nodeId);
                if (node) {
                    const amount = BigInt(decoded.args.amount.toString());
                    node.totalRewardsClaimed = node.totalRewardsClaimed + amount;
                    node.lastClaimTime = BigInt(block.header.timestamp);
                    
                    rewardClaims.push(new RewardClaim({
                        id: `${txHash}-${log.logIndex}`,
                        node,
                        operator: decoded.args.operator,
                        rewardToken: decoded.args.rewardToken,
                        rewardAmount: amount,
                        paymasterFeesETH: BigInt(decoded.args.paymasterFeesETH.toString()),
                        timestamp: BigInt(block.header.timestamp),
                        blockNumber: BigInt(block.header.height),
                        transactionHash: txHash
                    }));
                }
            }
            else if (eventSig === NODE_SLASHED) {
                const nodeId = log.topics[1];
                const node = nodes.get(nodeId);
                if (node) {
                    node.isSlashed = true;
                    node.isActive = false;
                }
            }
            else if (eventSig === PROPOSAL_CREATED) {
                const proposalId = log.topics[1];
                const decoded = nodeStakingInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;
                
                const proposal = new GovernanceProposal({
                    id: proposalId,
                    proposalId: Buffer.from(proposalId.slice(2), 'hex'),
                    parameter: decoded.args.parameter,
                    currentValue: BigInt(decoded.args.currentValue.toString()),
                    proposedValue: BigInt(decoded.args.proposedValue.toString()),
                    changeMarketId: EMPTY_BYTES32,
                    statusQuoMarketId: EMPTY_BYTES32,
                    createdAt: BigInt(block.header.timestamp),
                    votingEnds: BigInt(block.header.timestamp + 7 * 24 * 3600),
                    executeAfter: BigInt(block.header.timestamp + 14 * 24 * 3600),
                    executed: false,
                    vetoed: false,
                    proposer: decoded.args.proposer
                });
                proposals.set(proposalId, proposal);
                
                proposalEvents.push(new GovernanceEvent({
                    id: `${txHash}-${log.logIndex}`,
                    proposal,
                    eventType: 'created',
                    actor: decoded.args.proposer,
                    reason: null,
                    timestamp: BigInt(block.header.timestamp),
                    blockNumber: BigInt(block.header.height),
                    transactionHash: txHash
                }));
            }
            else if (eventSig === PROPOSAL_EXECUTED) {
                const proposalId = log.topics[1];
                const proposal = proposals.get(proposalId);
                if (proposal) {
                    const decoded = nodeStakingInterface.parseLog({ topics: log.topics, data: log.data });
                    if (!decoded) continue;
                    
                    proposal.executed = true;
                    
                    proposalEvents.push(new GovernanceEvent({
                        id: `${txHash}-${log.logIndex}`,
                        proposal,
                        eventType: 'executed',
                        actor: null,
                        reason: null,
                        timestamp: BigInt(block.header.timestamp),
                        blockNumber: BigInt(block.header.height),
                        transactionHash: txHash
                    }));
                }
            }
            else if (eventSig === PROPOSAL_VETOED) {
                const proposalId = log.topics[1];
                const proposal = proposals.get(proposalId);
                if (proposal) {
                    const decoded = nodeStakingInterface.parseLog({ topics: log.topics, data: log.data });
                    if (!decoded) continue;
                    
                    proposal.vetoed = true;
                    
                    proposalEvents.push(new GovernanceEvent({
                        id: `${txHash}-${log.logIndex}`,
                        proposal,
                        eventType: 'vetoed',
                        actor: decoded.args.admin,
                        reason: decoded.args.reason,
                        timestamp: BigInt(block.header.timestamp),
                        blockNumber: BigInt(block.header.height),
                        transactionHash: txHash
                    }));
                }
            }
        }
    }

    await ctx.store.upsert([...nodes.values()]);
    await ctx.store.insert(performanceUpdates);
    await ctx.store.insert(rewardClaims);
    await ctx.store.upsert([...proposals.values()]);
    await ctx.store.insert(proposalEvents);
}
