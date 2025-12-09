/**
 * Registry Processor - Indexes ERC-8004 agent registration events
 * Handles: IdentityRegistry, ReputationRegistry, ValidationRegistry, BanManager, ReportingSystem
 */

import { ethers } from 'ethers';
import { Store } from '@subsquid/typeorm-store';
import { ProcessorContext } from './processor';
import { 
    RegisteredAgent, 
    AgentMetadata, 
    TagUpdate, 
    RegistryStake, 
    Account,
    AgentBanEvent,
    AgentSlashEvent,
    AgentStakeEvent,
    AgentFeedback,
    FeedbackResponse,
    AgentValidation
} from './model';
import {
    AGENT_REGISTERED,
    STAKE_INCREASED,
    STAKE_WITHDRAWN,
    AGENT_BANNED,
    AGENT_UNBANNED,
    AGENT_SLASHED,
    TAGS_UPDATED,
    AGENT_URI_UPDATED,
    METADATA_SET,
    NEW_FEEDBACK,
    FEEDBACK_REVOKED,
    RESPONSE_APPENDED,
    VALIDATION_REQUEST,
    VALIDATION_RESPONSE,
    NETWORK_BAN_APPLIED,
    APP_BAN_APPLIED,
    NETWORK_BAN_REMOVED,
    APP_BAN_REMOVED,
} from './contract-events';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// ABI for decoding events
const identityRegistryInterface = new ethers.Interface([
    'event Registered(uint256 indexed agentId, address indexed owner, uint8 tier, uint256 stakedAmount, string tokenURI)',
    'event StakeIncreased(uint256 indexed agentId, uint8 oldTier, uint8 newTier, uint256 addedAmount)',
    'event StakeWithdrawn(uint256 indexed agentId, address indexed owner, uint256 amount)',
    'event AgentBanned(uint256 indexed agentId, string reason)',
    'event AgentUnbanned(uint256 indexed agentId)',
    'event AgentSlashed(uint256 indexed agentId, uint256 slashAmount, string reason)',
    'event TagsUpdated(uint256 indexed agentId, string[] tags)',
    'event AgentUriUpdated(uint256 indexed agentId, string newTokenURI)',
    'event MetadataSet(uint256 indexed agentId, string indexed indexedKey, string key, bytes value)',
]);

const reputationRegistryInterface = new ethers.Interface([
    'event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint8 score, bytes32 tag1, bytes32 tag2, string fileuri, bytes32 filehash)',
    'event FeedbackRevoked(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex)',
    'event ResponseAppended(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, address responder, string responseUri, bytes32 responseHash)',
]);

const validationRegistryInterface = new ethers.Interface([
    'event ValidationRequest(address indexed validatorAddress, uint256 indexed agentId, string requestUri, bytes32 requestHash)',
    'event ValidationResponse(address indexed validatorAddress, uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, string responseUri, bytes32 responseHash, bytes32 tag)',
]);

const banManagerInterface = new ethers.Interface([
    'event NetworkBanApplied(uint256 indexed agentId, string reason, bytes32 indexed proposalId, uint256 timestamp)',
    'event AppBanApplied(uint256 indexed agentId, bytes32 indexed appId, string reason, bytes32 indexed proposalId, uint256 timestamp)',
    'event NetworkBanRemoved(uint256 indexed agentId, uint256 timestamp)',
    'event AppBanRemoved(uint256 indexed agentId, bytes32 indexed appId, uint256 timestamp)',
]);

export async function processRegistryEvents(ctx: ProcessorContext<Store>): Promise<void> {
    const agents = new Map<string, RegisteredAgent>();
    const accounts = new Map<string, Account>();
    const metadataUpdates: AgentMetadata[] = [];
    const tagUpdates: TagUpdate[] = [];
    const stakes: RegistryStake[] = [];
    const banEvents: AgentBanEvent[] = [];
    const slashEvents: AgentSlashEvent[] = [];
    const stakeEvents: AgentStakeEvent[] = [];
    const feedbackEntries: AgentFeedback[] = [];
    const feedbackResponses: FeedbackResponse[] = [];
    const validations: AgentValidation[] = [];

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
                lastSeenAt: timestamp
            });
            accounts.set(id, account);
        }
        return account;
    }

    async function getOrCreateAgent(agentId: bigint, blockTimestamp: Date): Promise<RegisteredAgent | undefined> {
        const id = agentId.toString();
        let agent = agents.get(id);
        if (!agent) {
            // Try to load from store
            agent = await ctx.store.get(RegisteredAgent, id);
            if (agent) {
                agents.set(id, agent);
            }
        }
        return agent;
    }

    for (const block of ctx.blocks) {
        const blockTimestamp = new Date(block.header.timestamp);

        for (const log of block.logs) {
            const topic0 = log.topics[0];
            if (!log.transaction) continue;
            const txHash = log.transaction.hash;

            // ============ IdentityRegistry Events ============

            if (topic0 === AGENT_REGISTERED) {
                const decoded = identityRegistryInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;

                const agentId = BigInt(log.topics[1]);
                const id = agentId.toString();
                const ownerAddress = '0x' + log.topics[2].slice(26);
                const owner = getOrCreateAccount(ownerAddress, block.header.height, blockTimestamp);

                agents.set(id, new RegisteredAgent({
                    id,
                    agentId,
                    owner,
                    tokenURI: decoded.args.tokenURI,
                    name: decoded.args.tokenURI || `Agent #${id}`,
                    tags: [],
                    stakeTier: Number(decoded.args.tier),
                    stakeToken: ZERO_ADDRESS,
                    stakeAmount: BigInt(decoded.args.stakedAmount.toString()),
                    stakeWithdrawn: false,
                    isSlashed: false,
                    isBanned: false,
                    registeredAt: blockTimestamp,
                    depositedAt: decoded.args.stakedAmount > 0n ? BigInt(block.header.timestamp) : 0n,
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
                }));
            }
            else if (topic0 === STAKE_INCREASED) {
                const decoded = identityRegistryInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;

                const agentId = BigInt(log.topics[1]);
                const agent = await getOrCreateAgent(agentId, blockTimestamp);
                if (!agent) continue;

                const oldTier = Number(decoded.args.oldTier);
                const newTier = Number(decoded.args.newTier);
                const addedAmount = BigInt(decoded.args.addedAmount.toString());

                agent.stakeTier = newTier;
                agent.stakeAmount = agent.stakeAmount + addedAmount;
                agent.lastActivityAt = blockTimestamp;

                stakeEvents.push(new AgentStakeEvent({
                    id: `${txHash}-${log.logIndex}`,
                    agent,
                    eventType: 'increase',
                    oldTier,
                    newTier,
                    amount: addedAmount,
                    token: agent.stakeToken,
                    timestamp: blockTimestamp,
                    txHash,
                    blockNumber: block.header.height
                }));
            }
            else if (topic0 === STAKE_WITHDRAWN) {
                const decoded = identityRegistryInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;

                const agentId = BigInt(log.topics[1]);
                const agent = await getOrCreateAgent(agentId, blockTimestamp);
                if (!agent) continue;

                const amount = BigInt(decoded.args.amount.toString());

                stakeEvents.push(new AgentStakeEvent({
                    id: `${txHash}-${log.logIndex}`,
                    agent,
                    eventType: 'withdraw',
                    oldTier: agent.stakeTier,
                    newTier: 0,
                    amount,
                    token: agent.stakeToken,
                    timestamp: blockTimestamp,
                    txHash,
                    blockNumber: block.header.height
                }));

                agent.stakeTier = 0;
                agent.stakeAmount = 0n;
                agent.stakeWithdrawn = true;
                agent.withdrawnAt = BigInt(block.header.timestamp);
                agent.active = false;
            }
            else if (topic0 === AGENT_BANNED) {
                const decoded = identityRegistryInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;

                const agentId = BigInt(log.topics[1]);
                const agent = await getOrCreateAgent(agentId, blockTimestamp);
                if (!agent) continue;

                agent.isBanned = true;
                agent.lastActivityAt = blockTimestamp;

                banEvents.push(new AgentBanEvent({
                    id: `${txHash}-${log.logIndex}`,
                    agent,
                    isBan: true,
                    banType: 'registry',
                    reason: decoded.args.reason,
                    timestamp: blockTimestamp,
                    txHash,
                    blockNumber: block.header.height
                }));
            }
            else if (topic0 === AGENT_UNBANNED) {
                const agentId = BigInt(log.topics[1]);
                const agent = await getOrCreateAgent(agentId, blockTimestamp);
                if (!agent) continue;

                agent.isBanned = false;
                agent.lastActivityAt = blockTimestamp;

                banEvents.push(new AgentBanEvent({
                    id: `${txHash}-${log.logIndex}`,
                    agent,
                    isBan: false,
                    banType: 'registry',
                    timestamp: blockTimestamp,
                    txHash,
                    blockNumber: block.header.height
                }));
            }
            else if (topic0 === AGENT_SLASHED) {
                const decoded = identityRegistryInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;

                const agentId = BigInt(log.topics[1]);
                const agent = await getOrCreateAgent(agentId, blockTimestamp);
                if (!agent) continue;

                const slashAmount = BigInt(decoded.args.slashAmount.toString());

                agent.isSlashed = true;
                agent.stakeAmount = agent.stakeAmount - slashAmount;
                agent.lastActivityAt = blockTimestamp;

                slashEvents.push(new AgentSlashEvent({
                    id: `${txHash}-${log.logIndex}`,
                    agent,
                    slashAmount,
                    reason: decoded.args.reason,
                    timestamp: blockTimestamp,
                    txHash,
                    blockNumber: block.header.height
                }));
            }
            else if (topic0 === TAGS_UPDATED) {
                const decoded = identityRegistryInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;

                const agentId = BigInt(log.topics[1]);
                const agent = await getOrCreateAgent(agentId, blockTimestamp);
                if (!agent) continue;

                const oldTags = [...agent.tags];
                const newTags = decoded.args.tags as string[];
                agent.tags = newTags;
                agent.lastActivityAt = blockTimestamp;

                tagUpdates.push(new TagUpdate({
                    id: `${txHash}-${log.logIndex}`,
                    agent,
                    oldTags,
                    newTags,
                    updatedAt: blockTimestamp,
                    txHash,
                    blockNumber: block.header.height
                }));
            }
            else if (topic0 === AGENT_URI_UPDATED) {
                const decoded = identityRegistryInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;

                const agentId = BigInt(log.topics[1]);
                const agent = await getOrCreateAgent(agentId, blockTimestamp);
                if (!agent) continue;

                agent.tokenURI = decoded.args.newTokenURI;
                agent.lastActivityAt = blockTimestamp;
            }
            else if (topic0 === METADATA_SET) {
                const decoded = identityRegistryInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;

                const agentId = BigInt(log.topics[1]);
                const agent = await getOrCreateAgent(agentId, blockTimestamp);
                if (!agent) continue;

                const key = decoded.args.key;
                let value: string;
                try {
                    value = ethers.toUtf8String(decoded.args.value);
                } catch {
                    value = ethers.hexlify(decoded.args.value);
                }

                // Update agent fields based on key
                if (key === 'name') agent.name = value;
                else if (key === 'description') agent.description = value;
                else if (key === 'a2aEndpoint') agent.a2aEndpoint = value;
                else if (key === 'mcpEndpoint') agent.mcpEndpoint = value;
                else if (key === 'serviceType') agent.serviceType = value;
                else if (key === 'category') agent.category = value;
                else if (key === 'image') agent.image = value;
                else if (key === 'x402Support') {
                    // x402Support is encoded as bool - decode it properly
                    try {
                        const decodedBool = ethers.AbiCoder.defaultAbiCoder().decode(['bool'], decoded.args.value)[0];
                        agent.x402Support = decodedBool;
                        value = decodedBool ? 'true' : 'false'; // Store as readable string
                    } catch {
                        agent.x402Support = value === 'true';
                        value = agent.x402Support ? 'true' : 'false';
                    }
                }
                // Handle tools and skills as JSON arrays
                else if (key === 'mcpTools') {
                    try {
                        agent.mcpTools = JSON.parse(value);
                    } catch {
                        agent.mcpTools = value.split(',').map((t: string) => t.trim()).filter(Boolean);
                    }
                }
                else if (key === 'a2aSkills') {
                    try {
                        agent.a2aSkills = JSON.parse(value);
                    } catch {
                        agent.a2aSkills = value.split(',').map((s: string) => s.trim()).filter(Boolean);
                    }
                }

                agent.lastActivityAt = blockTimestamp;

                metadataUpdates.push(new AgentMetadata({
                    id: `${agentId.toString()}-${key}-${block.header.height}`,
                    agent,
                    key,
                    value,
                    updatedAt: blockTimestamp,
                    txHash,
                    blockNumber: block.header.height
                }));
            }

            // ============ ReputationRegistry Events ============

            else if (topic0 === NEW_FEEDBACK) {
                const decoded = reputationRegistryInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;

                const agentId = BigInt(log.topics[1]);
                const clientAddress = '0x' + log.topics[2].slice(26);
                const agent = await getOrCreateAgent(agentId, blockTimestamp);
                if (!agent) continue;

                const client = getOrCreateAccount(clientAddress, block.header.height, blockTimestamp);

                feedbackEntries.push(new AgentFeedback({
                    id: `${txHash}-${log.logIndex}`,
                    agent,
                    client,
                    score: Number(decoded.args.score),
                    tag1: decoded.args.tag1 !== ethers.ZeroHash ? decoded.args.tag1 : null,
                    tag2: decoded.args.tag2 !== ethers.ZeroHash ? decoded.args.tag2 : null,
                    fileUri: decoded.args.fileuri || null,
                    fileHash: decoded.args.filehash !== ethers.ZeroHash ? decoded.args.filehash : null,
                    isRevoked: false,
                    timestamp: blockTimestamp,
                    txHash,
                    blockNumber: block.header.height
                }));
            }
            else if (topic0 === FEEDBACK_REVOKED) {
                const decoded = reputationRegistryInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;

                // Mark existing feedback as revoked
                const agentId = BigInt(log.topics[1]);
                const clientAddress = '0x' + log.topics[2].slice(26);
                const feedbackIndex = decoded.args.feedbackIndex;

                // We'd need to look up the existing feedback and mark it revoked
                // For now, we just log this event
                ctx.log.info(`Feedback revoked: agent ${agentId}, client ${clientAddress}, index ${feedbackIndex}`);
            }
            else if (topic0 === RESPONSE_APPENDED) {
                const decoded = reputationRegistryInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;

                const agentId = BigInt(log.topics[1]);
                const clientAddress = '0x' + log.topics[2].slice(26);
                const responderAddress = decoded.args.responder;
                
                const responder = getOrCreateAccount(responderAddress, block.header.height, blockTimestamp);

                // Find the feedback entry - for now we create a reference by constructing an ID
                // In production, we'd need to look up the actual feedback entity
                const feedbackId = `${agentId}-${clientAddress}-${decoded.args.feedbackIndex}`;

                feedbackResponses.push(new FeedbackResponse({
                    id: `${txHash}-${log.logIndex}`,
                    feedback: { id: feedbackId } as AgentFeedback, // Reference by ID
                    responder,
                    responseUri: decoded.args.responseUri,
                    responseHash: decoded.args.responseHash !== ethers.ZeroHash ? decoded.args.responseHash : null,
                    timestamp: blockTimestamp,
                    txHash,
                    blockNumber: block.header.height
                }));
            }

            // ============ ValidationRegistry Events ============

            else if (topic0 === VALIDATION_REQUEST) {
                const decoded = validationRegistryInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;

                const validatorAddress = '0x' + log.topics[1].slice(26);
                const agentId = BigInt(log.topics[2]);
                const agent = await getOrCreateAgent(agentId, blockTimestamp);
                if (!agent) continue;

                const validator = getOrCreateAccount(validatorAddress, block.header.height, blockTimestamp);

                validations.push(new AgentValidation({
                    id: decoded.args.requestHash,
                    agent,
                    validator,
                    requestUri: decoded.args.requestUri,
                    requestHash: decoded.args.requestHash,
                    status: 'pending',
                    requestedAt: blockTimestamp,
                    requestTxHash: txHash,
                    blockNumber: block.header.height
                }));
            }
            else if (topic0 === VALIDATION_RESPONSE) {
                const decoded = validationRegistryInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;

                const requestHash = log.topics[3];
                
                // Find and update the validation
                const existingValidation = await ctx.store.get(AgentValidation, requestHash);
                if (existingValidation) {
                    existingValidation.response = Number(decoded.args.response);
                    existingValidation.responseUri = decoded.args.responseUri || null;
                    existingValidation.responseHash = decoded.args.responseHash !== ethers.ZeroHash ? decoded.args.responseHash : null;
                    existingValidation.tag = decoded.args.tag !== ethers.ZeroHash ? decoded.args.tag : null;
                    existingValidation.status = 'responded';
                    existingValidation.respondedAt = blockTimestamp;
                    existingValidation.responseTxHash = txHash;
                    
                    validations.push(existingValidation);
                }
            }

            // ============ BanManager Events ============

            else if (topic0 === NETWORK_BAN_APPLIED) {
                const decoded = banManagerInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;

                const agentId = BigInt(log.topics[1]);
                const proposalId = log.topics[2];
                const agent = await getOrCreateAgent(agentId, blockTimestamp);
                if (!agent) continue;

                agent.isBanned = true;
                agent.lastActivityAt = blockTimestamp;

                banEvents.push(new AgentBanEvent({
                    id: `${txHash}-${log.logIndex}`,
                    agent,
                    isBan: true,
                    banType: 'network',
                    reason: decoded.args.reason,
                    proposalId,
                    timestamp: blockTimestamp,
                    txHash,
                    blockNumber: block.header.height
                }));
            }
            else if (topic0 === APP_BAN_APPLIED) {
                const decoded = banManagerInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;

                const agentId = BigInt(log.topics[1]);
                const appId = log.topics[2];
                const proposalId = log.topics[3];
                const agent = await getOrCreateAgent(agentId, blockTimestamp);
                if (!agent) continue;

                agent.lastActivityAt = blockTimestamp;

                banEvents.push(new AgentBanEvent({
                    id: `${txHash}-${log.logIndex}`,
                    agent,
                    isBan: true,
                    banType: 'app',
                    appId,
                    reason: decoded.args.reason,
                    proposalId,
                    timestamp: blockTimestamp,
                    txHash,
                    blockNumber: block.header.height
                }));
            }
            else if (topic0 === NETWORK_BAN_REMOVED) {
                const agentId = BigInt(log.topics[1]);
                const agent = await getOrCreateAgent(agentId, blockTimestamp);
                if (!agent) continue;

                agent.isBanned = false;
                agent.lastActivityAt = blockTimestamp;

                banEvents.push(new AgentBanEvent({
                    id: `${txHash}-${log.logIndex}`,
                    agent,
                    isBan: false,
                    banType: 'network',
                    timestamp: blockTimestamp,
                    txHash,
                    blockNumber: block.header.height
                }));
            }
            else if (topic0 === APP_BAN_REMOVED) {
                const agentId = BigInt(log.topics[1]);
                const appId = log.topics[2];
                const agent = await getOrCreateAgent(agentId, blockTimestamp);
                if (!agent) continue;

                agent.lastActivityAt = blockTimestamp;

                banEvents.push(new AgentBanEvent({
                    id: `${txHash}-${log.logIndex}`,
                    agent,
                    isBan: false,
                    banType: 'app',
                    appId,
                    timestamp: blockTimestamp,
                    txHash,
                    blockNumber: block.header.height
                }));
            }
        }
    }

    // Persist all entities
    await ctx.store.upsert(Array.from(accounts.values()));
    await ctx.store.upsert(Array.from(agents.values()));
    await ctx.store.insert(metadataUpdates);
    await ctx.store.insert(tagUpdates);
    await ctx.store.insert(stakes);
    await ctx.store.insert(banEvents);
    await ctx.store.insert(slashEvents);
    await ctx.store.insert(stakeEvents);
    await ctx.store.insert(feedbackEntries);
    // Note: feedbackResponses require the feedback to exist first
    // In production, we'd need to handle this with proper ordering
    await ctx.store.insert(validations);
}
