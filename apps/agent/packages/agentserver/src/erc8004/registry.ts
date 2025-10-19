/**
 * ERC-8004 Registry Client for Elizagotchi
 * Handles agent registration and service discovery
 */

import { ethers } from 'ethers';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { RegistrationResult, Service, ServiceFilters, AgentCard } from './types';

export class ERC8004RegistryClient {
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private registryContract: ethers.Contract | null = null;
  private reputationContract: ethers.Contract | null = null;

  constructor(rpcUrl: string, privateKey: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
  }

  async initialize(): Promise<void> {
    // Load ERC-8004 contract addresses from deployment files
    const possiblePaths = [
      join(process.cwd(), 'contracts/deployments/localnet/liquidity-system.json'),
      join(process.cwd(), '../contracts/deployments/localnet/liquidity-system.json'),
      join(process.cwd(), '../../contracts/deployments/localnet/liquidity-system.json'),
      join(process.cwd(), '../../../contracts/deployments/localnet/liquidity-system.json'),
      join(process.cwd(), '../../../../contracts/deployments/localnet/liquidity-system.json'),
      join(process.cwd(), '../../../../../contracts/deployments/localnet/liquidity-system.json')
    ];

    let identityAddress: string | undefined;
    let reputationAddress: string | undefined;

    for (const path of possiblePaths) {
      if (existsSync(path)) {
        const content = readFileSync(path, 'utf-8');
        const deployment = JSON.parse(content);
        
        if (deployment.identityRegistry) {
          identityAddress = deployment.identityRegistry;
          reputationAddress = deployment.reputationRegistry;
          break;
        }
      }
    }

    if (!identityAddress) {
      throw new Error('ERC-8004 contracts not found. Deploy contracts first: cd contracts && forge script script/DeployLiquiditySystem.s.sol --rpc-url http://localhost:8545 --broadcast');
    }

    // Minimal ABI for registry operations
    const registryAbi = [
      'function register(string calldata tokenURI) external returns (uint256 agentId)',
      'function register() external returns (uint256 agentId)',
      'function resolveAgentByAddress(address agent) external view returns (uint256 agentId_, string agentDomain_)',
      'function setMetadata(uint256 agentId, string calldata key, bytes calldata value) external',
      'function getMetadata(uint256 agentId, string calldata key) external view returns (bytes memory)',
      'function agentExists(uint256 agentId) external view returns (bool)',
      'function totalAgents() external view returns (uint256)',
      'function ownerOf(uint256 tokenId) external view returns (address)',
      'event Registered(uint256 indexed agentId, string tokenURI, address indexed owner)'
    ];

    const reputationAbi = [
      'function getAggregateScore(uint256 agentId) external view returns (uint256 score, uint256 count)',
      'function getFeedbackCount(uint256 agentId) external view returns (uint256)'
    ];

    this.registryContract = new ethers.Contract(identityAddress, registryAbi, this.wallet);
    
    if (reputationAddress) {
      this.reputationContract = new ethers.Contract(reputationAddress, reputationAbi, this.wallet);
    }
  }

  async register(agentName: string, agentType: string = 'ai-agent'): Promise<RegistrationResult> {
    if (!this.registryContract) {
      return { registered: false, error: 'Registry not initialized' };
    }

    // Check if already registered
    const resolution = await this.registryContract.resolveAgentByAddress(this.wallet.address);
    
    if (resolution.agentId_ !== 0n) {
      console.log(`[ERC-8004] Already registered as Agent #${resolution.agentId_}`);
      return {
        registered: true,
        agentId: resolution.agentId_,
        agentDomain: resolution.agentDomain_
      };
    }

    // Create agent card URI (will be hosted by agent server)
    const agentCardUri = `${process.env.AGENT_URL || 'http://localhost:7777'}/.well-known/agent-card.json`;

    // Register agent
    console.log('[ERC-8004] Registering agent to registry...');
    const tx = await this.registryContract.register(agentCardUri);
    const receipt = await tx.wait();

    // Extract agent ID from event
    const event = receipt.logs
      .map((log: ethers.Log) => {
        return this.registryContract!.interface.parseLog({
          topics: log.topics as string[],
          data: log.data
        });
      })
      .find((e: ethers.LogDescription | null) => e?.name === 'Registered');

    const agentId = event!.args.agentId as bigint;

    // Set metadata
    await this.setMetadata(agentId, 'name', agentName);
    await this.setMetadata(agentId, 'type', agentType);
    await this.setMetadata(agentId, 'url', process.env.AGENT_URL || 'http://localhost:7777');

    console.log(`[ERC-8004] ✅ Registered as Agent #${agentId}`);
    console.log(`[ERC-8004]    TX: ${receipt.hash}`);

    return {
      registered: true,
      agentId,
      transactionHash: receipt.hash
    };
  }

  async listServices(filters?: ServiceFilters): Promise<Service[]> {
    if (!this.registryContract) {
      throw new Error('Registry not initialized');
    }

    const totalAgents = await this.registryContract.totalAgents();
    const services: Service[] = [];

    // Iterate through all registered agents
    for (let i = 1n; i <= totalAgents; i++) {
      
        const exists = await this.registryContract.agentExists(i);
        if (!exists) continue;

        const owner = await this.registryContract.ownerOf(i);
        
        // Get metadata
        const nameBytes = await this.registryContract.getMetadata(i, 'name');
        const typeBytes = await this.registryContract.getMetadata(i, 'type');
        const urlBytes = await this.registryContract.getMetadata(i, 'url');
        
        const name = nameBytes ? ethers.AbiCoder.defaultAbiCoder().decode(['string'], nameBytes)[0] : 'Unknown';
        const type = typeBytes ? ethers.AbiCoder.defaultAbiCoder().decode(['string'], typeBytes)[0] : 'other';
        const url = urlBytes ? ethers.AbiCoder.defaultAbiCoder().decode(['string'], urlBytes)[0] : '';

        // Apply filters
        if (filters?.type && type !== filters.type) continue;
        if (filters?.searchTerm && !name.toLowerCase().includes(filters.searchTerm.toLowerCase())) continue;

        // Get reputation if available
        let reputation;
        if (this.reputationContract) {
          try {
            const [score, count] = await this.reputationContract.getAggregateScore(i);
            reputation = {
              score: Number(score),
              feedbackCount: Number(count)
            };
            
            if (filters?.minReputation && reputation.score < filters.minReputation) continue;
          
        }

        services.push({
          id: i,
          name,
          type: type as Service['type'],
          description: '', // Fetch from agent card
          url,
          ownerAddress: owner,
          agentCardUri: url,
          metadata: {},
          reputation
        });
      } catch (e) {
        console.error(`Failed to fetch agent ${i}:`, e);
      }
    }

    return services;
  }

  async getService(serviceId: bigint): Promise<Service | null> {
    if (!this.registryContract) {
      throw new Error('Registry not initialized');
    }

    const exists = await this.registryContract.agentExists(serviceId);
    if (!exists) return null;

    const owner = await this.registryContract.ownerOf(serviceId);
    
    // Get metadata
    const nameBytes = await this.registryContract.getMetadata(serviceId, 'name');
    const typeBytes = await this.registryContract.getMetadata(serviceId, 'type');
    const urlBytes = await this.registryContract.getMetadata(serviceId, 'url');
    
    const name = nameBytes ? ethers.AbiCoder.defaultAbiCoder().decode(['string'], nameBytes)[0] : 'Unknown';
    const type = typeBytes ? ethers.AbiCoder.defaultAbiCoder().decode(['string'], typeBytes)[0] : 'other';
    const url = urlBytes ? ethers.AbiCoder.defaultAbiCoder().decode(['string'], urlBytes)[0] : '';

    // Get reputation
    let reputation;
    if (this.reputationContract) {
      
        const [score, count] = await this.reputationContract.getAggregateScore(serviceId);
        reputation = {
          score: Number(score),
          feedbackCount: Number(count)
        };
      
    }

    return {
      id: serviceId,
      name,
      type: type as Service['type'],
      description: '',
      url,
      ownerAddress: owner,
      agentCardUri: url,
      metadata: {},
      reputation
    };
  }

  async fetchAgentCard(serviceUrl: string): Promise<AgentCard | null> {
    try {
      const cardUrl = `${serviceUrl}/.well-known/agent-card.json`;
      const response = await fetch(cardUrl);
      if (!response.ok) return null;
      
      return await response.json() as AgentCard;
    } catch (e) {
      console.error(`Failed to fetch agent card from ${serviceUrl}:`, e);
      return null;
    }
  }

  private async setMetadata(agentId: bigint, key: string, value: string): Promise<void> {
    if (!this.registryContract) return;

    const encodedValue = ethers.AbiCoder.defaultAbiCoder().encode(['string'], [value]);
    await this.registryContract.setMetadata(agentId, key, encodedValue);
  }

  getWalletAddress(): string {
    return this.wallet.address;
  }

  async getMyAgentId(): Promise<bigint | null> {
    if (!this.registryContract) return null;
    
    const resolution = await this.registryContract.resolveAgentByAddress(this.wallet.address);
    return resolution.agentId_ === 0n ? null : resolution.agentId_;
  }
}

/**
 * Auto-register to ERC-8004 with smart detection
 * Tries: Jeju L2 (8004/420691) → Anvil (31337) → graceful skip
 */
export async function autoRegisterToRegistry(agentName: string): Promise<RegistrationResult> {
  const rpcUrl = process.env.RPC_URL || 'http://localhost:8545';
  const privateKey = process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

  const client = new ERC8004RegistryClient(rpcUrl, privateKey);
  
  try {
    await client.initialize();
    const result = await client.register(agentName, 'ai-agent');
    return result;
  } catch (error) {
    console.error('[ERC-8004] Registration failed:', error);
    return {
      registered: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

