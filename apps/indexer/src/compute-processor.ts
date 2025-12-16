/**
 * Compute Processor - Indexes compute infrastructure events
 * Handles: ComputeRegistry, ComputeRental, InferenceServing, ComputeStaking
 * 
 * IMPORTANT: Event signatures must match EXACTLY what's in the Solidity contracts
 */

import { keccak256, stringToHex, parseAbi, decodeEventLog, decodeAbiParameters } from 'viem';
import { Store } from '@subsquid/typeorm-store';
import { ProcessorContext } from './processor';
import { 
  ComputeProvider, 
  ComputeResource, 
  ComputeRental, 
  ComputeRentalStatus,
  InferenceRequest as InferenceRequestEntity,
  InferenceStatus,
  ComputeLedgerBalance,
  ComputeStats
} from './model';
import { createAccountFactory, BlockHeader, LogData } from './lib/entities';

// ============ CORRECT Event Signatures from contracts/src/compute/*.sol ============

// ComputeRegistry.sol events
const PROVIDER_REGISTERED = keccak256(stringToHex('ProviderRegistered(address,string,string,bytes32,uint256,uint256)'));
const PROVIDER_UPDATED = keccak256(stringToHex('ProviderUpdated(address,string,bytes32)'));
const PROVIDER_DEACTIVATED = keccak256(stringToHex('ProviderDeactivated(address)'));
const PROVIDER_REACTIVATED = keccak256(stringToHex('ProviderReactivated(address)'));
const STAKE_ADDED = keccak256(stringToHex('StakeAdded(address,uint256,uint256)'));
const STAKE_WITHDRAWN = keccak256(stringToHex('StakeWithdrawn(address,uint256)'));
const CAPABILITY_ADDED = keccak256(stringToHex('CapabilityAdded(address,string,uint256,uint256,uint256)'));
const CAPABILITY_UPDATED = keccak256(stringToHex('CapabilityUpdated(address,uint256,bool)'));

// ComputeRental.sol events
const RENTAL_CREATED = keccak256(stringToHex('RentalCreated(bytes32,address,address,uint256,uint256)'));
const RENTAL_STARTED = keccak256(stringToHex('RentalStarted(bytes32,string,uint16,string)'));
const RENTAL_COMPLETED = keccak256(stringToHex('RentalCompleted(bytes32,uint256,uint256)'));
const RENTAL_CANCELLED = keccak256(stringToHex('RentalCancelled(bytes32,uint256)'));
const RENTAL_EXTENDED = keccak256(stringToHex('RentalExtended(bytes32,uint256,uint256)'));
const RENTAL_RATED = keccak256(stringToHex('RentalRated(bytes32,address,uint8,string)'));
const USER_BANNED = keccak256(stringToHex('UserBanned(address,string,uint256)'));
const PROVIDER_BANNED = keccak256(stringToHex('ProviderBanned(address,string)'));
const DISPUTE_CREATED = keccak256(stringToHex('DisputeCreated(bytes32,bytes32,address,uint8,string)'));
const DISPUTE_RESOLVED = keccak256(stringToHex('DisputeResolved(bytes32,bool,uint256)'));

// InferenceServing.sol events
const SERVICE_REGISTERED = keccak256(stringToHex('ServiceRegistered(address,uint256,string,string,uint256,uint256)'));
const SERVICE_DEACTIVATED = keccak256(stringToHex('ServiceDeactivated(address,uint256)'));
const SETTLED = keccak256(stringToHex('Settled(address,address,bytes32,uint256,uint256,uint256,uint256)'));
const AGENT_SETTLED = keccak256(stringToHex('AgentSettled(uint256,address,uint256,uint256,uint256)'));

// ComputeStaking.sol events
const STAKED_AS_USER = keccak256(stringToHex('StakedAsUser(address,uint256)'));
const STAKED_AS_PROVIDER = keccak256(stringToHex('StakedAsProvider(address,uint256)'));
const STAKED_AS_GUARDIAN = keccak256(stringToHex('StakedAsGuardian(address,uint256)'));
const STAKE_ADDED_STAKING = keccak256(stringToHex('StakeAdded(address,uint256,uint256)'));
const UNSTAKED = keccak256(stringToHex('Unstaked(address,uint256)'));
const SLASHED = keccak256(stringToHex('Slashed(address,uint256,string)'));

// Correct ABI interfaces matching the actual contracts
const computeRegistryInterface = parseAbi([
  // ProviderRegistered(address indexed provider, string name, string endpoint, bytes32 attestationHash, uint256 stake, uint256 agentId)
  'event ProviderRegistered(address indexed provider, string name, string endpoint, bytes32 attestationHash, uint256 stake, uint256 agentId)',
  'event ProviderUpdated(address indexed provider, string endpoint, bytes32 attestationHash)',
  'event ProviderDeactivated(address indexed provider)',
  'event ProviderReactivated(address indexed provider)',
  'event StakeAdded(address indexed provider, uint256 amount, uint256 newTotal)',
  'event StakeWithdrawn(address indexed provider, uint256 amount)',
  'event CapabilityAdded(address indexed provider, string model, uint256 pricePerInputToken, uint256 pricePerOutputToken, uint256 maxContextLength)',
  'event CapabilityUpdated(address indexed provider, uint256 index, bool active)',
]);

const computeRentalInterface = parseAbi([
  // RentalCreated(bytes32 indexed rentalId, address indexed user, address indexed provider, uint256 durationHours, uint256 totalCost)
  'event RentalCreated(bytes32 indexed rentalId, address indexed user, address indexed provider, uint256 durationHours, uint256 totalCost)',
  'event RentalStarted(bytes32 indexed rentalId, string sshHost, uint16 sshPort, string containerId)',
  'event RentalCompleted(bytes32 indexed rentalId, uint256 actualDuration, uint256 refundAmount)',
  'event RentalCancelled(bytes32 indexed rentalId, uint256 refundAmount)',
  'event RentalExtended(bytes32 indexed rentalId, uint256 additionalHours, uint256 additionalCost)',
  'event RentalRated(bytes32 indexed rentalId, address indexed rater, uint8 score, string comment)',
  'event DisputeCreated(bytes32 indexed disputeId, bytes32 indexed rentalId, address indexed initiator, uint8 reason, string evidenceUri)',
  'event DisputeResolved(bytes32 indexed disputeId, bool inFavorOfInitiator, uint256 slashAmount)',
  'event UserBanned(address indexed user, string reason, uint256 bannedAt)',
  'event ProviderBanned(address indexed provider, string reason)',
]);

const inferenceServingInterface = parseAbi([
  // ServiceRegistered(address indexed provider, uint256 serviceIndex, string model, string endpoint, uint256 pricePerInputToken, uint256 pricePerOutputToken)
  'event ServiceRegistered(address indexed provider, uint256 serviceIndex, string model, string endpoint, uint256 pricePerInputToken, uint256 pricePerOutputToken)',
  'event ServiceDeactivated(address indexed provider, uint256 serviceIndex)',
  // Settled(address indexed user, address indexed provider, bytes32 requestHash, uint256 inputTokens, uint256 outputTokens, uint256 fee, uint256 nonce)
  'event Settled(address indexed user, address indexed provider, bytes32 requestHash, uint256 inputTokens, uint256 outputTokens, uint256 fee, uint256 nonce)',
  'event AgentSettled(uint256 indexed agentId, address indexed user, uint256 inputTokens, uint256 outputTokens, uint256 fee)',
]);

const computeStakingInterface = parseAbi([
  'event StakedAsUser(address indexed account, uint256 amount)',
  'event StakedAsProvider(address indexed account, uint256 amount)',
  'event StakedAsGuardian(address indexed account, uint256 amount)',
  'event StakeAdded(address indexed account, uint256 amount, uint256 newTotal)',
  'event Unstaked(address indexed account, uint256 amount)',
  'event Slashed(address indexed account, uint256 amount, string reason)',
]);
  'event StakeAdded(address indexed account, uint256 amount, uint256 newTotal)',
  'event Unstaked(address indexed account, uint256 amount)',
  'event Slashed(address indexed account, uint256 amount, string reason)',
]);

const COMPUTE_EVENT_SIGNATURES = new Set([
  PROVIDER_REGISTERED, PROVIDER_UPDATED, PROVIDER_DEACTIVATED, PROVIDER_REACTIVATED,
  STAKE_ADDED, STAKE_WITHDRAWN, CAPABILITY_ADDED, CAPABILITY_UPDATED,
  RENTAL_CREATED, RENTAL_STARTED, RENTAL_COMPLETED, RENTAL_CANCELLED, RENTAL_EXTENDED,
  RENTAL_RATED, USER_BANNED, PROVIDER_BANNED, DISPUTE_CREATED, DISPUTE_RESOLVED,
  SERVICE_REGISTERED, SERVICE_DEACTIVATED, SETTLED, AGENT_SETTLED,
  STAKED_AS_USER, STAKED_AS_PROVIDER, STAKED_AS_GUARDIAN, STAKE_ADDED_STAKING, UNSTAKED, SLASHED,
]);

export function isComputeEvent(topic0: string): boolean {
  return COMPUTE_EVENT_SIGNATURES.has(topic0);
}

export async function processComputeEvents(ctx: ProcessorContext<Store>): Promise<void> {
  const providers = new Map<string, ComputeProvider>();
  const resources = new Map<string, ComputeResource>();
  const rentals = new Map<string, ComputeRental>();
  const inferenceRequests = new Map<string, InferenceRequestEntity>();
  const balances = new Map<string, ComputeLedgerBalance>();
  const accountFactory = createAccountFactory();

  // Load existing providers
  const existingProviders = await ctx.store.find(ComputeProvider);
  for (const p of existingProviders) {
    providers.set(p.id, p);
  }

  async function getOrCreateProvider(address: string, timestamp: Date): Promise<ComputeProvider> {
    const id = address.toLowerCase();
    let provider = providers.get(id);
    if (!provider) {
      provider = await ctx.store.get(ComputeProvider, id);
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
      });
    }
    providers.set(id, provider);
    return provider;
  }

  for (const block of ctx.blocks) {
    const header = block.header as unknown as BlockHeader;
    const blockTimestamp = new Date(header.timestamp);

    for (const rawLog of block.logs) {
      const log = rawLog as unknown as LogData;
      const eventSig = log.topics[0];

      if (!eventSig || !COMPUTE_EVENT_SIGNATURES.has(eventSig)) continue;

      const txHash = log.transaction?.hash || `${header.hash}-${log.transactionIndex}`;

      // ============ ComputeRegistry events ============
      if (eventSig === PROVIDER_REGISTERED) {
        // ProviderRegistered(address indexed provider, string name, string endpoint, bytes32 attestationHash, uint256 stake, uint256 agentId)
        // topics[0] = event sig, topics[1] = indexed provider
        // data = (name, endpoint, attestationHash, stake, agentId)
        const providerAddr = '0x' + log.topics[1].slice(26);
        const decoded = decodeAbiParameters(
          [{ type: 'string' }, { type: 'string' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }],
          log.data as `0x${string}`
        );
        
        const id = providerAddr.toLowerCase();
        accountFactory.getOrCreate(providerAddr, header.height, blockTimestamp);

        const provider = new ComputeProvider({
          id,
          address: id,
          name: decoded[0],
          endpoint: decoded[1],
          attestationHash: decoded[2],
          stakeAmount: BigInt(decoded[3].toString()),
          agentId: Number(decoded[4]),
          isActive: true,
          registeredAt: blockTimestamp,
          lastUpdated: blockTimestamp,
          totalRentals: 0,
          totalEarnings: 0n,
        });
        providers.set(id, provider);

        ctx.log.info(`Compute provider registered: ${providerAddr.slice(0, 16)}... stake: ${decoded[3]}`);
      }

      if (eventSig === PROVIDER_UPDATED) {
        // ProviderUpdated(address indexed provider, string endpoint, bytes32 attestationHash)
        const providerAddr = '0x' + log.topics[1].slice(26);
        const decoded = decodeAbiParameters(
          [{ type: 'string' }, { type: 'bytes32' }],
          log.data as `0x${string}`
        );

        const provider = await getOrCreateProvider(providerAddr, blockTimestamp);
        provider.endpoint = decoded[0];
        provider.attestationHash = decoded[1];
        provider.lastUpdated = blockTimestamp;
      }

      if (eventSig === PROVIDER_DEACTIVATED) {
        // ProviderDeactivated(address indexed provider)
        const providerAddr = '0x' + log.topics[1].slice(26);
        const provider = await getOrCreateProvider(providerAddr, blockTimestamp);
        provider.isActive = false;
        provider.lastUpdated = blockTimestamp;
      }

      if (eventSig === PROVIDER_REACTIVATED) {
        // ProviderReactivated(address indexed provider)
        const providerAddr = '0x' + log.topics[1].slice(26);
        const provider = await getOrCreateProvider(providerAddr, blockTimestamp);
        provider.isActive = true;
        provider.lastUpdated = blockTimestamp;
      }

      if (eventSig === STAKE_ADDED) {
        // StakeAdded(address indexed provider, uint256 amount, uint256 newTotal)
        const providerAddr = '0x' + log.topics[1].slice(26);
        const decoded = decodeAbiParameters(
          [{ type: 'uint256' }, { type: 'uint256' }],
          log.data as `0x${string}`
        );

        const provider = await getOrCreateProvider(providerAddr, blockTimestamp);
        provider.stakeAmount = BigInt(decoded[1].toString());
        provider.lastUpdated = blockTimestamp;
      }

      if (eventSig === STAKE_WITHDRAWN) {
        // StakeWithdrawn(address indexed provider, uint256 amount)
        const providerAddr = '0x' + log.topics[1].slice(26);
        const decoded = decodeAbiParameters(
          [{ type: 'uint256' }],
          log.data as `0x${string}`
        );

        const provider = await getOrCreateProvider(providerAddr, blockTimestamp);
        const amount = BigInt(decoded[0].toString());
        provider.stakeAmount = provider.stakeAmount > amount ? provider.stakeAmount - amount : 0n;
        provider.lastUpdated = blockTimestamp;
      }

      if (eventSig === CAPABILITY_ADDED) {
        // CapabilityAdded(address indexed provider, string model, uint256 pricePerInputToken, uint256 pricePerOutputToken, uint256 maxContextLength)
        const providerAddr = '0x' + log.topics[1].slice(26);
        const decoded = decodeAbiParameters(
          [{ type: 'string' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
          log.data as `0x${string}`
        );
        
        const id = `${providerAddr.toLowerCase()}-${decoded[0]}`;
        const provider = await getOrCreateProvider(providerAddr, blockTimestamp);

        const resource = new ComputeResource({
          id,
          provider,
          resourceId: decoded[0], // model name as resource ID
          gpuCount: 0,
          cpuCores: 0,
          memoryGB: 0,
          pricePerHour: BigInt(decoded[1].toString()), // Use input token price
          isAvailable: true,
          createdAt: blockTimestamp,
        });
        resources.set(id, resource);
      }

      // ============ ComputeRental events ============
      if (eventSig === RENTAL_CREATED) {
        // RentalCreated(bytes32 indexed rentalId, address indexed user, address indexed provider, uint256 durationHours, uint256 totalCost)
        // topics[1] = rentalId, topics[2] = user, topics[3] = provider
        // data = (durationHours, totalCost)
        const rentalId = log.topics[1];
        const userAddr = '0x' + log.topics[2].slice(26);
        const providerAddr = '0x' + log.topics[3].slice(26);
        const decoded = decodeAbiParameters(
          [{ type: 'uint256' }, { type: 'uint256' }],
          log.data as `0x${string}`
        );

        const renter = accountFactory.getOrCreate(userAddr, header.height, blockTimestamp);
        const provider = await getOrCreateProvider(providerAddr, blockTimestamp);

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
        });
        rentals.set(rentalId, rental);

        ctx.log.info(`Compute rental created: ${rentalId.slice(0, 16)}...`);
      }

      if (eventSig === RENTAL_STARTED) {
        // RentalStarted(bytes32 indexed rentalId, string sshHost, uint16 sshPort, string containerId)
        const rentalId = log.topics[1];
        let rental = rentals.get(rentalId) || await ctx.store.get(ComputeRental, rentalId);
        if (rental) {
          rental.status = ComputeRentalStatus.ACTIVE;
          rental.startTime = blockTimestamp;
          rentals.set(rentalId, rental);
        }
      }

      if (eventSig === RENTAL_COMPLETED) {
        // RentalCompleted(bytes32 indexed rentalId, uint256 actualDuration, uint256 refundAmount)
        const rentalId = log.topics[1];
        let rental = rentals.get(rentalId) || await ctx.store.get(ComputeRental, rentalId);
        if (rental) {
          rental.status = ComputeRentalStatus.COMPLETED;
          rental.endTime = blockTimestamp;
          rentals.set(rentalId, rental);

          // Update provider stats
          if (rental.provider) {
            const provider = providers.get(rental.provider.id) || await ctx.store.get(ComputeProvider, rental.provider.id);
            if (provider) {
              provider.totalRentals++;
              provider.totalEarnings += rental.price;
              providers.set(provider.id, provider);
            }
          }
        }
      }

      if (eventSig === RENTAL_CANCELLED) {
        // RentalCancelled(bytes32 indexed rentalId, uint256 refundAmount)
        const rentalId = log.topics[1];
        let rental = rentals.get(rentalId) || await ctx.store.get(ComputeRental, rentalId);
        if (rental) {
          rental.status = ComputeRentalStatus.CANCELLED;
          rental.endTime = blockTimestamp;
          rentals.set(rentalId, rental);
        }
      }

      if (eventSig === RENTAL_EXTENDED) {
        // RentalExtended(bytes32 indexed rentalId, uint256 additionalHours, uint256 additionalCost)
        const rentalId = log.topics[1];
        const decoded = decodeAbiParameters(
          [{ type: 'uint256' }, { type: 'uint256' }],
          log.data as `0x${string}`
        );

        let rental = rentals.get(rentalId) || await ctx.store.get(ComputeRental, rentalId);
        if (rental) {
          rental.duration += BigInt(decoded[0].toString()) * 3600n;
          rental.price += BigInt(decoded[1].toString());
          rentals.set(rentalId, rental);
        }
      }

      // ============ InferenceServing events ============
      if (eventSig === SETTLED) {
        // Settled(address indexed user, address indexed provider, bytes32 requestHash, uint256 inputTokens, uint256 outputTokens, uint256 fee, uint256 nonce)
        // topics[1] = user, topics[2] = provider
        // data = (requestHash, inputTokens, outputTokens, fee, nonce)
        const userAddr = '0x' + log.topics[1].slice(26);
        const providerAddr = '0x' + log.topics[2].slice(26);
        const decoded = decodeAbiParameters(
          [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
          log.data as `0x${string}`
        );

        const requestId = decoded[0];
        const requester = accountFactory.getOrCreate(userAddr, header.height, blockTimestamp);
        const provider = await getOrCreateProvider(providerAddr, blockTimestamp);

        const request = new InferenceRequestEntity({
          id: requestId,
          requestId,
          requester,
          provider,
          model: '', // Model info not in this event
          maxTokens: BigInt(decoded[1].toString()) + BigInt(decoded[2].toString()), // inputTokens + outputTokens
          tokensUsed: BigInt(decoded[1].toString()) + BigInt(decoded[2].toString()),
          status: InferenceStatus.COMPLETED,
          createdAt: blockTimestamp,
          completedAt: blockTimestamp,
          txHash,
          blockNumber: header.height,
        });
        inferenceRequests.set(requestId, request);

        // Update provider earnings
        provider.totalEarnings += BigInt(decoded[3].toString()); // fee
        provider.lastUpdated = blockTimestamp;
      }

      if (eventSig === AGENT_SETTLED) {
        // AgentSettled(uint256 indexed agentId, address indexed user, uint256 inputTokens, uint256 outputTokens, uint256 fee)
        // Log for tracking, links to agent ID
        ctx.log.debug(`Agent settled: agentId=${log.topics[1]}`);
      }

      // ============ ComputeStaking events ============
      if (eventSig === STAKED_AS_PROVIDER) {
        // StakedAsProvider(address indexed account, uint256 amount)
        const providerAddr = '0x' + log.topics[1].slice(26);
        const decoded = decodeAbiParameters([{ type: 'uint256' }], log.data as `0x${string}`);
        
        const provider = await getOrCreateProvider(providerAddr, blockTimestamp);
        provider.stakeAmount += BigInt(decoded[0].toString());
        provider.lastUpdated = blockTimestamp;
      }

      if (eventSig === SLASHED) {
        // Slashed(address indexed account, uint256 amount, string reason)
        const providerAddr = '0x' + log.topics[1].slice(26);
        const decoded = decodeAbiParameters(
          [{ type: 'uint256' }, { type: 'string' }],
          log.data as `0x${string}`
        );

        const provider = await getOrCreateProvider(providerAddr, blockTimestamp);
        const amount = BigInt(decoded[0].toString());
        provider.stakeAmount = provider.stakeAmount > amount ? provider.stakeAmount - amount : 0n;
        provider.isActive = provider.stakeAmount > 0n;
        provider.lastUpdated = blockTimestamp;

        ctx.log.warn(`Provider ${providerAddr.slice(0, 16)}... slashed: ${decoded[1]}`);
      }
    }
  }

  // Persist all entities
  await ctx.store.upsert(accountFactory.getAll());
  
  if (providers.size > 0) {
    await ctx.store.upsert([...providers.values()]);
  }
  if (resources.size > 0) {
    await ctx.store.upsert([...resources.values()]);
  }
  if (rentals.size > 0) {
    await ctx.store.upsert([...rentals.values()]);
  }
  if (inferenceRequests.size > 0) {
    await ctx.store.upsert([...inferenceRequests.values()]);
  }
  if (balances.size > 0) {
    await ctx.store.upsert([...balances.values()]);
  }

  // Update global stats
  await updateComputeStats(ctx);

  // Log summary
  const totalEvents = providers.size + resources.size + rentals.size + inferenceRequests.size + balances.size;
  if (totalEvents > 0) {
    ctx.log.info(
      `Compute: ${providers.size} providers, ${resources.size} resources, ` +
        `${rentals.size} rentals, ${inferenceRequests.size} inference requests, ${balances.size} balances`
    );
  }
}

async function updateComputeStats(ctx: ProcessorContext<Store>): Promise<void> {
  const globalId = 'global';
  let stats = await ctx.store.get(ComputeStats, globalId);

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
    });
  }

  // Update counts from database
  const providerCount = await ctx.store.count(ComputeProvider);
  const activeProviderCount = await ctx.store.count(ComputeProvider, { where: { isActive: true } });
  const resourceCount = await ctx.store.count(ComputeResource);
  const availableResourceCount = await ctx.store.count(ComputeResource, { where: { isAvailable: true } });
  const rentalCount = await ctx.store.count(ComputeRental);
  const activeRentalCount = await ctx.store.count(ComputeRental, { where: { status: ComputeRentalStatus.ACTIVE } });
  const completedRentalCount = await ctx.store.count(ComputeRental, { where: { status: ComputeRentalStatus.COMPLETED } });
  const inferenceCount = await ctx.store.count(InferenceRequestEntity);

  stats.totalProviders = providerCount;
  stats.activeProviders = activeProviderCount;
  stats.totalResources = resourceCount;
  stats.availableResources = availableResourceCount;
  stats.totalRentals = rentalCount;
  stats.activeRentals = activeRentalCount;
  stats.completedRentals = completedRentalCount;
  stats.totalInferenceRequests = inferenceCount;
  stats.lastUpdated = new Date();

  await ctx.store.upsert(stats);
}
