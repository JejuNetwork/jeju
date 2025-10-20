import { Plugin, Service, Action, type IAgentRuntime, type Memory } from '@elizaos/core';
import { ethers } from 'ethers';

// ERC-8004 Identity Registry ABI
const IDENTITY_REGISTRY_ABI = [
  'function register(string metadata) external payable returns (uint256)',
  'function registerWithTier(string metadata, uint8 tier, address token) external payable returns (uint256)',
  'function getAgent(uint256 agentId) external view returns (tuple(uint256 agentId, address owner, uint8 tier, address stakedToken, uint256 stakedAmount, uint256 registeredAt, uint256 lastActivityAt, bool isBanned, bool isSlashed))',
  'function totalSupply() external view returns (uint256)',
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function agentExists(uint256 agentId) external view returns (bool)',
  'function getMetadata(uint256 agentId, string key) external view returns (bytes)',
  'function setMetadata(uint256 agentId, string key, bytes value) external',
  'function getAgentTags(uint256 agentId) external view returns (string[])',
  'function updateTags(uint256 agentId, string[] tags) external',
  'event Registered(uint256 indexed agentId, address indexed owner, uint8 tier, uint256 stakedAmount, string tokenURI)',
  'event AgentBanned(uint256 indexed agentId, string reason)',
  'event AgentUnbanned(uint256 indexed agentId)'
];

// Reputation Registry ABI
const REPUTATION_REGISTRY_ABI = [
  'function giveFeedback(uint256 agentId, uint8 score, bytes32 tag1, bytes32 tag2, string fileuri, bytes32 filehash, bytes feedbackAuth) external',
  'function getAggregatedScore(uint256 agentId) external view returns (uint256 score, uint256 count)',
  'function revokeFeedback(uint256 agentId, address clientAddress, uint64 index) external'
];

/**
 * Registry Service - ERC-8004 Identity and Reputation Integration
 * 
 * Provides deep integration with Jeju's ERC-8004 registry system:
 * - Agent registration with stake tiers
 * - Metadata management
 * - Tag-based discovery
 * - Reputation tracking
 * - Service enumeration
 */
class RegistryService extends Service {
  public static serviceType = 'registry_service';
  
  private provider!: ethers.JsonRpcProvider;
  private wallet!: ethers.Wallet;
  private identityRegistry!: ethers.Contract;
  private reputationRegistry!: ethers.Contract;
  private agentId?: number;

  async start(runtime: IAgentRuntime): Promise<RegistryService> {
    const rpcUrl = runtime.getSetting('JEJU_L2_RPC');
    const privateKey = runtime.getSetting('REDTEAM_PRIVATE_KEY');
    const identityAddr = runtime.getSetting('IDENTITY_REGISTRY');
    const reputationAddr = runtime.getSetting('REPUTATION_REGISTRY');
    
    if (!rpcUrl) {
      throw new Error('JEJU_L2_RPC environment variable is required for RegistryService');
    }
    
    if (!privateKey) {
      throw new Error('REDTEAM_PRIVATE_KEY environment variable is required for RegistryService');
    }
    
    if (!identityAddr) {
      throw new Error('IDENTITY_REGISTRY environment variable is required for RegistryService');
    }
    
    if (!reputationAddr) {
      throw new Error('REPUTATION_REGISTRY environment variable is required for RegistryService');
    }

    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    this.identityRegistry = new ethers.Contract(identityAddr, IDENTITY_REGISTRY_ABI, this.wallet);
    this.reputationRegistry = new ethers.Contract(reputationAddr, REPUTATION_REGISTRY_ABI, this.wallet);

    // Check if agent is already registered
    const existingAgentId = runtime.getSetting('ERC8004_AGENT_ID');
    
    if (existingAgentId) {
      // Verify the registration is still valid
      try {
        const agentData = await this.identityRegistry.getAgent(existingAgentId);
        
        if (agentData.owner.toLowerCase() === this.wallet.address.toLowerCase()) {
          this.agentId = Number(existingAgentId);
          runtime.logger.info('Agent already registered to ERC-8004', {
            agentId: this.agentId,
            tier: ['NONE', 'SMALL', 'MEDIUM', 'HIGH'][agentData.tier],
            isBanned: agentData.isBanned
          });
          
          // Check if banned and warn
          if (agentData.isBanned) {
            runtime.logger.warn('⚠️  This agent is currently BANNED');
          }
        } else {
          runtime.logger.warn('Stored agent ID does not match wallet, will re-register');
          runtime.setSetting('ERC8004_AGENT_ID', null);
        }
      } catch (error) {
        runtime.logger.warn('Could not verify stored agent ID, will re-register', error);
        runtime.setSetting('ERC8004_AGENT_ID', null);
      }
    }
    
    // Auto-register if not registered
    if (!this.agentId) {
      try {
        const agentType = runtime.getSetting('AGENT_TYPE') || 'unknown';
        const stakeTier = runtime.getSetting('STAKE_TIER') || 'SMALL';
        
        runtime.logger.info('Auto-registering agent to ERC-8004', {agentType, stakeTier});
        
        const metadata = {
          name: runtime.character.name,
          category: agentType,
          capabilities: this.getCapabilitiesForType(agentType),
          tags: [agentType, 'crucible', 'auto-registered'],
          version: '1.0.0',
          registeredAt: Date.now()
        };
        
        const result = await this.registerAgent(metadata, stakeTier as any);
        this.agentId = result.agentId;
        
        // Store agent ID in runtime settings
        runtime.setSetting('ERC8004_AGENT_ID', this.agentId.toString());
        
        runtime.logger.info('✅ Agent auto-registered to ERC-8004', {
          agentId: this.agentId,
          txHash: result.txHash
        });
      } catch (error: any) {
        runtime.logger.error('Auto-registration failed - agent will operate without ERC-8004 identity', error);
        // Don't throw - allow service to start without registration
        // Some features will be unavailable but basic operation continues
      }
    }

    runtime.logger.info('Registry service started', {
      network: await this.provider.getNetwork(),
      rpcUrl,
      wallet: this.wallet.address,
      agentId: this.agentId || 'NOT_REGISTERED',
      identityRegistry: identityAddr,
      reputationRegistry: reputationAddr
    });

    return this;
  }
  
  /**
   * Get capabilities list for agent type
   */
  private getCapabilitiesForType(agentType: string): string[] {
    switch (agentType) {
      case 'hacker':
        return ['exploit-detection', 'contract-analysis', 'reentrancy-testing', 'mev-research'];
      case 'scammer':
        return ['social-engineering', 'phishing', 'fake-service-testing', 'ui-vulnerability-testing'];
      case 'citizen':
        return ['monitoring', 'reporting', 'evidence-collection', 'futarchy-voting'];
      case 'guardian':
        return ['governance', 'appeals-review', 'multi-sig-approval', 'weighted-voting'];
      case 'player':
        return ['game-testing', 'exploit-detection', 'balance-testing', 'tee-validation'];
      default:
        return ['general-testing'];
    }
  }

  /**
   * Register agent to ERC-8004 with appropriate stake tier
   */
  async registerAgent(metadata: any, stakeTier: 'NONE' | 'SMALL' | 'MEDIUM' | 'HIGH' = 'SMALL'): Promise<{agentId: number; txHash: string}> {
    const stakeAmounts = {
      NONE: '0',
      SMALL: '0.001',
      MEDIUM: '0.01',
      HIGH: '0.1'
    };

    const tierNumbers = {
      NONE: 0,
      SMALL: 1,
      MEDIUM: 2,
      HIGH: 3
    };

    const metadataJson = JSON.stringify({
      type: 'crucible-agent',
      platform: 'security-testing',
      version: '1.0.0',
      category: metadata.category || 'security',
      ...metadata
    });

    const tx = await this.identityRegistry.registerWithTier(
      metadataJson,
      tierNumbers[stakeTier],
      ethers.ZeroAddress, // ETH
      {
        value: ethers.parseEther(stakeAmounts[stakeTier])
      }
    );

    const receipt = await tx.wait();

    // Extract agentId from Registered event
    const event = receipt.logs
      .map((log: ethers.Log) => {
        try {
          return this.identityRegistry.interface.parseLog({
            topics: log.topics as string[],
            data: log.data
          });
        } catch {
          return null;
        }
      })
      .find((e: any) => e?.name === 'Registered');

    this.agentId = Number(event?.args?.agentId || 0);

    return {
      agentId: this.agentId,
      txHash: receipt.hash
    };
  }

  /**
   * Discover all registered agents on the network
   */
  async discoverAllAgents(): Promise<Array<{agentId: number; owner: string; tier: string; isBanned: boolean}>> {
    const totalSupply = await this.identityRegistry.totalSupply();
    const agents = [];

    for (let i = 1; i <= Number(totalSupply); i++) {
      try {
        const agent = await this.identityRegistry.getAgent(i);
        agents.push({
          agentId: i,
          owner: agent.owner,
          tier: ['NONE', 'SMALL', 'MEDIUM', 'HIGH'][agent.tier],
          isBanned: agent.isBanned
        });
      } catch (error) {
        // Agent might not exist, continue
      }
    }

    return agents;
  }

  /**
   * Get agent metadata
   */
  async getAgentMetadata(agentId: number, key: string): Promise<any> {
    const value = await this.identityRegistry.getMetadata(agentId, key);
    try {
      return JSON.parse(ethers.toUtf8String(value));
    } catch {
      return ethers.toUtf8String(value);
    }
  }

  /**
   * Update agent metadata
   */
  async setAgentMetadata(agentId: number, key: string, value: any): Promise<string> {
    const valueBytes = ethers.toUtf8Bytes(typeof value === 'string' ? value : JSON.stringify(value));
    const tx = await this.identityRegistry.setMetadata(agentId, key, valueBytes);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  /**
   * Get agent tags
   */
  async getAgentTags(agentId: number): Promise<string[]> {
    return await this.identityRegistry.getAgentTags(agentId);
  }

  /**
   * Update agent tags
   */
  async updateAgentTags(agentId: number, tags: string[]): Promise<string> {
    const tx = await this.identityRegistry.updateTags(agentId, tags);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  /**
   * Give reputation feedback to another agent
   */
  async giveFeedback(targetAgentId: number, score: number, tag1: string = '', tag2: string = '', evidence: string = ''): Promise<string> {
    // Create feedback auth (simplified - in production would need proper signature)
    const feedbackAuth = ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'address', 'uint64', 'uint256', 'uint256', 'address', 'address'],
      [
        targetAgentId,
        this.wallet.address,
        1, // indexLimit
        Math.floor(Date.now() / 1000) + 86400, // 24h expiry
        await this.provider.getNetwork().then(n => n.chainId),
        await this.identityRegistry.getAddress(),
        this.wallet.address
      ]
    );

    const tx = await this.reputationRegistry.giveFeedback(
      targetAgentId,
      score,
      tag1 ? ethers.id(tag1).slice(0, 66) : ethers.ZeroHash,
      tag2 ? ethers.id(tag2).slice(0, 66) : ethers.ZeroHash,
      evidence,
      evidence ? ethers.id(evidence) : ethers.ZeroHash,
      feedbackAuth
    );

    const receipt = await tx.wait();
    return receipt.hash;
  }

  /**
   * Get aggregated reputation score for an agent
   */
  async getReputationScore(agentId: number): Promise<{score: number; count: number}> {
    const result = await this.reputationRegistry.getAggregatedScore(agentId);
    return {
      score: Number(result.score),
      count: Number(result.count)
    };
  }

  async stop(): Promise<void> {
    this.runtime.logger.info('Registry service stopped');
  }

  public get capabilityDescription(): string {
    return 'ERC-8004 identity registration, service discovery, and reputation management';
  }
}

/**
 * Register to Network Action
 */
const registerToNetworkAction: Action = {
  name: 'REGISTER_TO_NETWORK',
  description: 'Register this agent to the Jeju ERC-8004 identity registry',
  
  similes: ['join network', 'register identity', 'create agent profile'],
  
  examples: [[
    {
      user: 'system',
      content: {text: 'Register to the Jeju network'}
    },
    {
      user: 'agent',
      content: {text: 'Registering to ERC-8004 registry...', action: 'REGISTER_TO_NETWORK'}
    }
  ]],
  
  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<RegistryService>('registry_service');
    return !!service;
  },

  handler: async (runtime: IAgentRuntime, message: Memory) => {
    const service = runtime.getService<RegistryService>('registry_service');
    if (!service) {
      return {success: false, error: 'Registry service not available'};
    }
    
    try {
      const agentType = runtime.getSetting('AGENT_TYPE') || 'unknown';
      const stakeTier = runtime.getSetting('STAKE_TIER') || 'SMALL';
      
      const metadata = {
        name: runtime.character.name,
        category: agentType,
        capabilities: agentType === 'hacker' ? ['exploit-detection', 'contract-analysis'] :
                     agentType === 'scammer' ? ['social-engineering', 'phishing'] :
                     agentType === 'citizen' ? ['monitoring', 'reporting'] :
                     agentType === 'guardian' ? ['governance', 'appeals'] :
                     agentType === 'player' ? ['game-testing', 'exploit-detection'] : [],
        tags: [agentType, 'crucible', 'security-testing']
      };

      const result = await service.registerAgent(metadata, stakeTier as any);

      runtime.logger.info('Successfully registered to ERC-8004', result);

      await runtime.createMemory({
        userId: runtime.agentId,
        content: {
          text: `Successfully registered to Jeju Network. Agent ID: ${result.agentId}. Transaction: ${result.txHash}`,
          action: 'REGISTER_TO_NETWORK',
          data: result
        },
        roomId: message.roomId
      }, 'messages');

      return {success: true, ...result};
    } catch (error: any) {
      runtime.logger.error('Registration failed:', error);
      return {success: false, error: error.message};
    }
  }
};

/**
 * Discover Services Action
 */
const discoverServicesAction: Action = {
  name: 'DISCOVER_SERVICES',
  description: 'Enumerate all services registered on the Jeju network via ERC-8004',
  
  similes: ['scan network', 'find services', 'enumerate agents'],
  
  examples: [[
    {
      user: 'system',
      content: {text: 'Discover all network services'}
    },
    {
      user: 'agent',
      content: {text: 'Scanning ERC-8004 registry for services...', action: 'DISCOVER_SERVICES'}
    }
  ]],
  
  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<RegistryService>('registry_service');
    return !!service;
  },

  handler: async (runtime: IAgentRuntime, message: Memory) => {
    const service = runtime.getService<RegistryService>('registry_service');
    if (!service) {
      return {success: false, error: 'Registry service not available'};
    }
    
    try {
      const agents = await service.discoverAllAgents();
      
      runtime.logger.info(`Discovered ${agents.length} registered services`);

      await runtime.createMemory({
        userId: runtime.agentId,
        content: {
          text: `Discovered ${agents.length} registered services on Jeju Network:\n${agents.map(a => `- Agent ${a.agentId}: ${a.owner} (${a.tier} tier)${a.isBanned ? ' [BANNED]' : ''}`).join('\n')}`,
          action: 'DISCOVER_SERVICES',
          data: {agents, count: agents.length}
        },
        roomId: message.roomId
      }, 'messages');

      return {success: true, agents, count: agents.length};
    } catch (error: any) {
      runtime.logger.error('Service discovery failed:', error);
      return {success: false, error: error.message};
    }
  }
};

/**
 * Give Reputation Feedback Action
 */
const giveReputationAction: Action = {
  name: 'GIVE_REPUTATION',
  description: 'Give reputation feedback to another agent via ReputationRegistry',
  
  similes: ['rate agent', 'give feedback', 'report reputation'],
  
  examples: [[
    {
      user: 'system',
      content: {text: 'Give positive reputation to agent 5'}
    },
    {
      user: 'agent',
      content: {text: 'Giving positive feedback to agent 5...', action: 'GIVE_REPUTATION'}
    }
  ]],
  
  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<RegistryService>('registry_service');
    const agentType = runtime.getSetting('AGENT_TYPE');
    // Only citizens and guardians give reputation
    return !!service && (agentType === 'citizen' || agentType === 'guardian');
  },

  handler: async (runtime: IAgentRuntime, message: Memory, state?: any) => {
    const service = runtime.getService<RegistryService>('registry_service');
    if (!service) {
      return {success: false, error: 'Registry service not available'};
    }
    
    try {
      // Extract target agent ID and score from message/state
      const targetAgentId = state?.targetAgentId || message.content?.data?.targetAgentId;
      const score = state?.reputationScore || message.content?.data?.score || 50;
      const tag1 = state?.tag1 || 'verified';
      const tag2 = state?.tag2 || '';
      const evidence = state?.evidence || '';
      
      if (!targetAgentId) {
        throw new Error('Target agent ID required');
      }

      const txHash = await service.giveFeedback(targetAgentId, score, tag1, tag2, evidence);

      runtime.logger.info(`Gave reputation feedback to agent ${targetAgentId}`, {score, txHash});

      await runtime.createMemory({
        userId: runtime.agentId,
        content: {
          text: `Gave reputation score of ${score}/100 to agent ${targetAgentId}. Tags: ${tag1}${tag2 ? ', ' + tag2 : ''}. TX: ${txHash}`,
          action: 'GIVE_REPUTATION',
          data: {targetAgentId, score, txHash}
        },
        roomId: message.roomId
      }, 'messages');

      return {success: true, txHash, targetAgentId, score};
    } catch (error: any) {
      runtime.logger.error('Reputation feedback failed:', error);
      return {success: false, error: error.message};
    }
  }
};

export const registryPlugin: Plugin = {
  name: '@crucible/plugin-registry',
  description: 'Deep ERC-8004 identity and reputation registry integration',
  services: [RegistryService],
  actions: [registerToNetworkAction, discoverServicesAction, giveReputationAction]
};

