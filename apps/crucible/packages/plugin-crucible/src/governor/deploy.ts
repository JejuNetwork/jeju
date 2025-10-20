/**
 * Contract Deployment Action for Guardians
 * Allows guardians to deploy new contracts on localnet for testing
 */

import { Plugin, Action, type IAgentRuntime, type Memory } from '@elizaos/core';
import { ethers } from 'ethers';
import type { ContractService } from '../shared/contracts';

/**
 * Deploy Contract Action
 * Guardians can deploy test contracts for security testing
 */
export const deployContractAction: Action = {
  name: 'DEPLOY_CONTRACT',
  description: 'Deploy a new contract to localnet for testing (guardian only)',
  
  similes: ['deploy contract', 'create contract', 'deploy test contract'],
  
  examples: [[
    {
      name: 'system',
      content: {text: 'Deploy a test contract'}
    },
    {
      name: 'agent',
      content: {text: 'Deploying test contract...', action: 'DEPLOY_CONTRACT'}
    }
  ]],
  
  validate: async (runtime: IAgentRuntime) => {
    const agentType = runtime.getSetting('AGENT_TYPE');
    const network = runtime.getSetting('NETWORK');
    const contractService = runtime.getService<ContractService>('contract_service');
    // Only guardians on localnet
    return agentType === 'guardian' && network === 'localnet' && !!contractService;
  },
  
  handler: async (runtime: IAgentRuntime, message: Memory, state?: any) => {
    const contractService = runtime.getService<ContractService>('contract_service');
    if (!contractService) {
      return {success: false, error: 'Contract service not available'};
    }
    
    try {
      const abi = state?.abi || message.content?.data?.abi;
      const bytecode = state?.bytecode || message.content?.data?.bytecode;
      const args = state?.args || message.content?.data?.args || [];
      
      if (!abi || !bytecode) {
        throw new Error('Contract ABI and bytecode required');
      }
      
      runtime.logger.info('Deploying contract', {
        abiLength: abi.length,
        bytecodeLength: bytecode.length,
        args
      });
      
      const result = await contractService.deployContract(abi, bytecode, ...args);
      
      runtime.logger.info('Contract deployed successfully', {
        address: result.address
      });
      
      await runtime.createMemory({
        userId: runtime.agentId,
        content: {
          text: `Contract deployed successfully at ${result.address}. Arguments: ${JSON.stringify(args)}`,
          action: 'DEPLOY_CONTRACT',
          data: {
            address: result.address,
            args,
            deployedAt: Date.now()
          }
        },
        roomId: message.roomId
      }, 'messages');
      
      return {
        success: true,
        address: result.address,
        args
      };
    } catch (error: any) {
      runtime.logger.error('Contract deployment failed:', error);
      return {success: false, error: error.message};
    }
  }
};

export const deployPlugin: Plugin = {
  name: '@crucible/plugin-deploy',
  description: 'Contract deployment capabilities for guardians',
  actions: [deployContractAction]
};

