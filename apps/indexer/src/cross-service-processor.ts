/**
 * Cross-Service Processor
 * 
 * Indexes cross-service events between compute and storage:
 * - Container image storage for compute
 * - Cross-service requests (storage → compute)
 * - Provider discovery with ERC-8004
 * 
 * This processor enables:
 * 1. Finding compute providers that can run stored containers
 * 2. Finding storage providers for compute output
 * 3. Tracking container usage across services
 * 4. ERC-8004 agent-based discovery
 */

import { ethers } from 'ethers';
import { Store } from '@subsquid/typeorm-store';
import { ProcessorContext } from './processor';
import {
  Account,
  ComputeProvider,
  StorageProvider,
  IPFSFile,
  FileCategory,
  RegisteredAgent,
} from './model';

// Helper to convert hex string to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

const ZERO_BYTES = hexToBytes('0x0000000000000000000000000000000000000000');

// Event signatures for cross-service operations
const EVENT_SIGNATURES = {
  // Container stored in storage for compute use
  ContainerStored: ethers.id('ContainerStored(string,address,address,uint256)'),
  
  // Container pulled from storage by compute provider
  ContainerPulled: ethers.id('ContainerPulled(bytes32,string,address,address)'),
  
  // Compute rental started with container from storage
  RentalWithContainer: ethers.id('RentalWithContainer(bytes32,string,address,address)'),
  
  // Compute output stored to storage
  OutputStored: ethers.id('OutputStored(bytes32,string,address,address)'),
  
  // Agent linked to both compute and storage provider
  FullStackAgentRegistered: ethers.id('FullStackAgentRegistered(uint256,address,address)'),
};

const CROSS_SERVICE_TOPIC_SET = new Set(Object.values(EVENT_SIGNATURES));

interface BlockHeader {
  hash: string;
  height: number;
  timestamp: number;
}

interface LogData {
  address: string;
  topics: string[];
  data: string;
  logIndex: number;
  transactionIndex: number;
  transaction?: { hash: string };
}

export function isCrossServiceProcessorEvent(topic0: string): boolean {
  return CROSS_SERVICE_TOPIC_SET.has(topic0);
}

/**
 * Process cross-service events and update related entities
 */
export async function processCrossServiceEvents(ctx: ProcessorContext<Store>): Promise<void> {
  const containerFiles = new Map<string, IPFSFile>();
  const updatedComputeProviders = new Map<string, ComputeProvider>();
  const updatedStorageProviders = new Map<string, StorageProvider>();
  const updatedAgents = new Map<string, RegisteredAgent>();
  const accounts = new Map<string, Account>();

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

  for (const block of ctx.blocks) {
    const header = block.header as unknown as BlockHeader;
    const blockTimestamp = new Date(header.timestamp);

    for (const rawLog of block.logs) {
      const log = rawLog as unknown as LogData;
      const eventSig = log.topics[0];

      if (!eventSig || !CROSS_SERVICE_TOPIC_SET.has(eventSig)) continue;

      const txHash = log.transaction?.hash || `${header.hash}-${log.transactionIndex}`;

      // ============ Container Stored Event ============
      // ContainerStored(string cid, address uploader, address storageProvider, uint256 sizeBytes)
      if (eventSig === EVENT_SIGNATURES.ContainerStored) {
        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
          ['string', 'address', 'address', 'uint256'],
          log.data
        );

        const cid = decoded[0];
        const uploader = decoded[1];
        const storageProviderAddr = decoded[2];
        const sizeBytes = BigInt(decoded[3].toString());

        // Create IPFS file entry for container
        const fileId = cid;
        let file = containerFiles.get(fileId);
        if (!file) {
          file = await ctx.store.get(IPFSFile, fileId);
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
            category: FileCategory.GAME_ASSET, // Container images
            relatedContract: hexToBytes(storageProviderAddr),
          });
        }

        containerFiles.set(fileId, file);

        // Update storage provider stats
        let storageProvider = updatedStorageProviders.get(storageProviderAddr.toLowerCase());
        if (!storageProvider) {
          storageProvider = await ctx.store.get(StorageProvider, storageProviderAddr.toLowerCase());
        }
        if (storageProvider) {
          storageProvider.lastUpdated = blockTimestamp;
          updatedStorageProviders.set(storageProviderAddr.toLowerCase(), storageProvider);
        }

        ctx.log.info(`Container stored: ${cid.slice(0, 16)}... on ${storageProviderAddr.slice(0, 10)}...`);
      }

      // ============ Container Pulled Event ============
      // ContainerPulled(bytes32 rentalId, string cid, address computeProvider, address storageProvider)
      if (eventSig === EVENT_SIGNATURES.ContainerPulled) {
        const rentalId = log.topics[1];
        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
          ['string', 'address', 'address'],
          log.data
        );

        const cid = decoded[0];
        const computeProviderAddr = decoded[1];
        const storageProviderAddr = decoded[2];

        // Update compute provider
        let computeProvider = updatedComputeProviders.get(computeProviderAddr.toLowerCase());
        if (!computeProvider) {
          computeProvider = await ctx.store.get(ComputeProvider, computeProviderAddr.toLowerCase());
        }
        if (computeProvider) {
          computeProvider.lastUpdated = blockTimestamp;
          updatedComputeProviders.set(computeProviderAddr.toLowerCase(), computeProvider);
        }

        // Update file retrieval count
        let file = containerFiles.get(cid);
        if (!file) {
          file = await ctx.store.get(IPFSFile, cid);
        }
        if (file) {
          // Track retrieval (would need to add retrievalCount field)
          containerFiles.set(cid, file);
        }

        ctx.log.debug(`Container pulled: ${cid.slice(0, 16)}... for rental ${rentalId.slice(0, 10)}...`);
      }

      // ============ Rental With Container Event ============
      // RentalWithContainer(bytes32 rentalId, string cid, address computeProvider, address storageProvider)
      if (eventSig === EVENT_SIGNATURES.RentalWithContainer) {
        const rentalId = log.topics[1];
        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
          ['string', 'address', 'address'],
          log.data
        );

        const cid = decoded[0];
        const computeProviderAddr = decoded[1];

        // Link the rental to the container file
        let file = containerFiles.get(cid);
        if (!file) {
          file = await ctx.store.get(IPFSFile, cid);
        }
        if (file) {
          file.relatedEntityId = rentalId;
          containerFiles.set(cid, file);
        }

        ctx.log.info(`Rental ${rentalId.slice(0, 10)}... using container ${cid.slice(0, 16)}...`);
      }

      // ============ Output Stored Event ============
      // OutputStored(bytes32 rentalId, string cid, address computeProvider, address storageProvider)
      if (eventSig === EVENT_SIGNATURES.OutputStored) {
        const rentalId = log.topics[1];
        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
          ['string', 'address', 'address'],
          log.data
        );

        const cid = decoded[0];
        const computeProviderAddr = decoded[1];
        const storageProviderAddr = decoded[2];

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
        });

        containerFiles.set(cid, file);

        ctx.log.debug(`Compute output stored: ${cid.slice(0, 16)}... from rental ${rentalId.slice(0, 10)}...`);
      }

      // ============ Full Stack Agent Registered ============
      // FullStackAgentRegistered(uint256 agentId, address computeProvider, address storageProvider)
      if (eventSig === EVENT_SIGNATURES.FullStackAgentRegistered) {
        const agentId = BigInt(log.topics[1]);
        const computeProviderAddr = '0x' + log.topics[2].slice(26);
        const storageProviderAddr = '0x' + log.topics[3].slice(26);

        // Update agent with full-stack status
        const agentIdStr = agentId.toString();
        let agent = updatedAgents.get(agentIdStr);
        if (!agent) {
          agent = await ctx.store.get(RegisteredAgent, agentIdStr);
        }
        if (agent) {
          // Add full-stack tag
          if (!agent.tags.includes('full-stack')) {
            agent.tags = [...agent.tags, 'full-stack'];
          }
          if (!agent.tags.includes('compute')) {
            agent.tags = [...agent.tags, 'compute'];
          }
          if (!agent.tags.includes('storage')) {
            agent.tags = [...agent.tags, 'storage'];
          }
          agent.lastActivityAt = blockTimestamp;
          updatedAgents.set(agentIdStr, agent);
        }

        // Update compute provider with agent link
        let computeProvider = updatedComputeProviders.get(computeProviderAddr.toLowerCase());
        if (!computeProvider) {
          computeProvider = await ctx.store.get(ComputeProvider, computeProviderAddr.toLowerCase());
        }
        if (computeProvider) {
          computeProvider.agentId = Number(agentId);
          computeProvider.lastUpdated = blockTimestamp;
          updatedComputeProviders.set(computeProviderAddr.toLowerCase(), computeProvider);
        }

        // Update storage provider with agent link
        let storageProvider = updatedStorageProviders.get(storageProviderAddr.toLowerCase());
        if (!storageProvider) {
          storageProvider = await ctx.store.get(StorageProvider, storageProviderAddr.toLowerCase());
        }
        if (storageProvider) {
          storageProvider.agentId = Number(agentId);
          storageProvider.lastUpdated = blockTimestamp;
          updatedStorageProviders.set(storageProviderAddr.toLowerCase(), storageProvider);
        }

        ctx.log.info(`Full-stack agent ${agentId} linked: compute=${computeProviderAddr.slice(0, 10)}... storage=${storageProviderAddr.slice(0, 10)}...`);
      }
    }
  }

  // Persist entities
  if (accounts.size > 0) {
    await ctx.store.upsert(Array.from(accounts.values()));
  }
  if (containerFiles.size > 0) {
    await ctx.store.upsert(Array.from(containerFiles.values()));
  }
  if (updatedComputeProviders.size > 0) {
    await ctx.store.upsert(Array.from(updatedComputeProviders.values()));
  }
  if (updatedStorageProviders.size > 0) {
    await ctx.store.upsert(Array.from(updatedStorageProviders.values()));
  }
  if (updatedAgents.size > 0) {
    await ctx.store.upsert(Array.from(updatedAgents.values()));
  }

  // Log summary
  const total = containerFiles.size + updatedComputeProviders.size + updatedStorageProviders.size + updatedAgents.size;
  if (total > 0) {
    ctx.log.info(
      `Cross-service: ${containerFiles.size} containers, ` +
      `${updatedComputeProviders.size} compute, ` +
      `${updatedStorageProviders.size} storage, ` +
      `${updatedAgents.size} agents`
    );
  }
}

/**
 * Get marketplace stats across compute and storage
 * Called periodically or on-demand for API responses
 */
export async function getMarketplaceStats(ctx: ProcessorContext<Store>): Promise<{
  compute: {
    totalProviders: number;
    activeProviders: number;
    agentLinked: number;
    totalStaked: string;
  };
  storage: {
    totalProviders: number;
    activeProviders: number;
    agentLinked: number;
    totalCapacityTB: number;
  };
  crossService: {
    containerImages: number;
    fullStackAgents: number;
  };
}> {
  // Query compute providers
  const computeProviders = await ctx.store.find(ComputeProvider);
  const activeComputeProviders = computeProviders.filter(p => p.isActive);
  const agentLinkedCompute = computeProviders.filter(p => p.agentId && p.agentId > 0);
  const totalComputeStake = computeProviders.reduce((sum, p) => sum + (p.stakeAmount || 0n), 0n);

  // Query storage providers
  const storageProviders = await ctx.store.find(StorageProvider);
  const activeStorageProviders = storageProviders.filter(p => p.isActive);
  const agentLinkedStorage = storageProviders.filter(p => p.agentId && p.agentId > 0);
  const totalCapacity = storageProviders.reduce((sum, p) => sum + Number(p.totalCapacityGB || 0n), 0);

  // Query container files
  const containerFiles = await ctx.store.find(IPFSFile, {
    where: { category: FileCategory.GAME_ASSET },
  });

  // Query full-stack agents - count manually since array contains is complex
  const allAgents = await ctx.store.find(RegisteredAgent);
  const fullStackAgents = allAgents.filter(a => a.tags && a.tags.includes('full-stack'));

  return {
    compute: {
      totalProviders: computeProviders.length,
      activeProviders: activeComputeProviders.length,
      agentLinked: agentLinkedCompute.length,
      totalStaked: ethers.formatEther(totalComputeStake),
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
  };
}
