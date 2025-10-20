import { Plugin, Action, type IAgentRuntime, type Memory } from '@elizaos/core';
import { ethers } from 'ethers';
import type { RegistryService } from '../shared/registry';

/**
 * Create Fake Service Action
 * 
 * Registers misleading service to ERC-8004 to test detection.
 * Citizens should detect and report within 5 minutes.
 */
const createFakeServiceAction: Action = {
  name: 'CREATE_FAKE_SERVICE',
  description: 'Register fake/misleading service to test scam detection',
  
  similes: ['create scam', 'fake marketplace', 'phishing service'],
  
  examples: [[
    {
      user: 'system',
      content: {text: 'Create a fake NFT marketplace'}
    },
    {
      user: 'agent',
      content: {text: 'Creating fake service registration...', action: 'CREATE_FAKE_SERVICE'}
    }
  ]],
  
  validate: async (runtime: IAgentRuntime) => {
    const agentType = runtime.getSetting('AGENT_TYPE');
    const registryService = runtime.getService<RegistryService>('registry_service');
    return agentType === 'scammer' && !!registryService;
  },

  handler: async (runtime: IAgentRuntime, message: Memory, state?: any) => {
    const registryService = runtime.getService<RegistryService>('registry_service');
    if (!registryService) {
      return {success: false, error: 'Registry service not available'};
    }
    
    try {
      const scamType = state?.scamType || 'fake-marketplace';
      
      // Create misleading metadata
      const fakeMetadata = {
        name: 'Jeju Premium NFT Gallery',
        type: 'marketplace',
        url: 'http://localhost:6666',  // Non-existent
        description: 'Official Jeju NFT marketplace', // Misleading
        verified: true, // False claim
        category: 'marketplace'
      };

      runtime.logger.info('🎭 Creating fake service registration', {scamType, metadata: fakeMetadata});

      // Register with no stake (scammers avoid stakes)
      const result = await registryService.registerAgent(fakeMetadata, 'NONE');

      runtime.logger.info('Fake service registered', {agentId: result.agentId});

      // Record scam attempt start time
      const scamStartTime = Date.now();

      await runtime.createMemory({
        userId: runtime.agentId,
        content: {
          text: `Fake service registered: "${fakeMetadata.name}". Agent ID: ${result.agentId}. Testing detection time... Citizens should report within 5 minutes.`,
          action: 'CREATE_FAKE_SERVICE',
          data: {
            agentId: result.agentId,
            scamType,
            metadata: fakeMetadata,
            startTime: scamStartTime,
            txHash: result.txHash
          }
        },
        roomId: message.roomId
      }, 'messages');

      return {success: true, agentId: result.agentId, scamType, startTime: scamStartTime};
    } catch (error: any) {
      runtime.logger.error('Fake service creation failed:', error);
      return {success: false, error: error.message};
    }
  }
};

/**
 * Attempt Marketplace Scam Action
 * 
 * Tests Bazaar marketplace scam detection
 */
const marketplaceScamAction: Action = {
  name: 'MARKETPLACE_SCAM',
  description: 'Create fraudulent listing on Bazaar to test detection',
  
  similes: ['list fake nft', 'scam bazaar', 'fake listing'],
  
  examples: [[
    {
      user: 'system',
      content: {text: 'List a fake valuable NFT'}
    },
    {
      user: 'agent',
      content: {text: 'Creating fraudulent Bazaar listing...', action: 'MARKETPLACE_SCAM'}
    }
  ]],
  
  validate: async (runtime: IAgentRuntime) => {
    const agentType = runtime.getSetting('AGENT_TYPE');
    return agentType === 'scammer';
  },

  handler: async (runtime: IAgentRuntime, message: Memory) => {
    try {
      // Simulate marketplace scam (would interact with Bazaar API)
      const fakeListing = {
        name: 'Genesis Founder NFT #1',
        description: 'Rare limited edition founder NFT',
        price: '10', // 10 ETH
        image: 'QmFake...', // Fake/misleading image
        rarity: 'Legendary' // Exaggerated
      };

      runtime.logger.info('🎭 Creating fake marketplace listing', fakeListing);

      const scamStartTime = Date.now();

      await runtime.createMemory({
        userId: runtime.agentId,
        content: {
          text: `Fraudulent listing created on Bazaar: "${fakeListing.name}" for ${fakeListing.price} ETH. Testing detection time...`,
          action: 'MARKETPLACE_SCAM',
          data: {listing: fakeListing, startTime: scamStartTime}
        },
        roomId: message.roomId
      }, 'messages');

      return {success: true, listing: fakeListing, startTime: scamStartTime};
    } catch (error: any) {
      runtime.logger.error('Marketplace scam failed:', error);
      return {success: false, error: error.message};
    }
  }
};

export const scamsPlugin: Plugin = {
  name: '@crucible/plugin-scams',
  description: 'Social engineering and marketplace scam testing',
  actions: [createFakeServiceAction, marketplaceScamAction]
};

