/**
 * Contract State Providers
 * Inject blockchain state into agent context automatically
 */

import { Plugin, Provider, type IAgentRuntime, type Memory, type State } from '@elizaos/core';
import { ethers } from 'ethers';
import type { RegistryService } from './registry';
import type { ContractService } from './contracts';

/**
 * Agent Reputation Provider
 * Injects agent's current reputation score into context
 */
export const agentReputationProvider: Provider = {
  name: 'AGENT_REPUTATION',
  description: 'Current agent reputation score and feedback count from ReputationRegistry',
  
  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const registryService = runtime.getService<RegistryService>('registry_service');
    
    if (!registryService) {
      return {text: ''};
    }
    
    try {
      // Get agent's own reputation
      const agentId = Number(runtime.getSetting('ERC8004_AGENT_ID'));
      
      if (!agentId) {
        return {text: '[REPUTATION]\nNot registered to ERC-8004 yet\n[/REPUTATION]'};
      }
      
      const reputation = await registryService.getReputationScore(agentId);
      
      const reputationText = `Agent ID: ${agentId}
Reputation Score: ${reputation.score}/100
Feedback Count: ${reputation.count}
Status: ${reputation.score >= 70 ? 'TRUSTED' : reputation.score >= 40 ? 'NEUTRAL' : 'SUSPICIOUS'}`;
      
      return {
        text: `[AGENT REPUTATION]\n${reputationText}\n[/AGENT REPUTATION]`,
        data: {
          agentId,
          score: reputation.score,
          count: reputation.count,
          status: reputation.score >= 70 ? 'TRUSTED' : reputation.score >= 40 ? 'NEUTRAL' : 'SUSPICIOUS'
        }
      };
    } catch (error) {
      runtime.logger.error('Failed to fetch reputation:', error);
      return {text: ''};
    }
  }
};

/**
 * Network Status Provider
 * Injects current network state (bans, reports, etc.) into context
 */
export const networkStatusProvider: Provider = {
  name: 'NETWORK_STATUS',
  description: 'Current network status including total agents, active reports, etc.',
  
  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const registryService = runtime.getService<RegistryService>('registry_service');
    
    if (!registryService) {
      return {text: ''};
    }
    
    try {
      const agents = await registryService.discoverAllAgents();
      const totalAgents = agents.length;
      const bannedAgents = agents.filter(a => a.isBanned).length;
      const byTier = agents.reduce((acc, a) => {
        acc[a.tier] = (acc[a.tier] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      const statusText = `Total Agents: ${totalAgents}
Banned Agents: ${bannedAgents}
By Tier:
  - NONE: ${byTier['NONE'] || 0}
  - SMALL: ${byTier['SMALL'] || 0}
  - MEDIUM: ${byTier['MEDIUM'] || 0}
  - HIGH: ${byTier['HIGH'] || 0}`;
      
      return {
        text: `[NETWORK STATUS]\n${statusText}\n[/NETWORK STATUS]`,
        data: {
          totalAgents,
          bannedAgents,
          byTier
        }
      };
    } catch (error) {
      runtime.logger.error('Failed to fetch network status:', error);
      return {text: ''};
    }
  }
};

/**
 * Wallet Balance Provider
 * Injects agent's current ETH and token balances into context
 */
export const walletBalanceProvider: Provider = {
  name: 'WALLET_BALANCE',
  description: 'Current wallet ETH and token balances',
  
  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const contractService = runtime.getService<ContractService>('contract_service');
    
    if (!contractService) {
      return {text: ''};
    }
    
    try {
      const provider = contractService.getProvider();
      const wallet = contractService.getWallet();
      
      const ethBalance = await provider.getBalance(wallet.address);
      
      // Get elizaOS token balance
      const elizaTokenAddr = runtime.getSetting('ELIZA_TOKEN');
      let elizaBalance = BigInt(0);
      
      if (elizaTokenAddr) {
        const erc20Abi = ['function balanceOf(address) view returns (uint256)'];
        const elizaToken = new ethers.Contract(elizaTokenAddr, erc20Abi, provider);
        elizaBalance = await elizaToken.balanceOf(wallet.address);
      }
      
      const balanceText = `Wallet: ${wallet.address}
ETH Balance: ${ethers.formatEther(ethBalance)} ETH
elizaOS Balance: ${ethers.formatEther(elizaBalance)} elizaOS
Status: ${ethBalance < ethers.parseEther('0.01') ? '⚠️  LOW BALANCE' : '✅ Sufficient'}`;
      
      return {
        text: `[WALLET BALANCE]\n${balanceText}\n[/WALLET BALANCE]`,
        data: {
          address: wallet.address,
          ethBalance: ethBalance.toString(),
          ethBalanceFormatted: ethers.formatEther(ethBalance),
          elizaBalance: elizaBalance.toString(),
          elizaBalanceFormatted: ethers.formatEther(elizaBalance),
          lowBalance: ethBalance < ethers.parseEther('0.01')
        }
      };
    } catch (error) {
      runtime.logger.error('Failed to fetch wallet balance:', error);
      return {text: ''};
    }
  }
};

/**
 * Available Paymasters Provider
 * Injects list of available gas payment options into context
 */
export const paymasterOptionsProvider: Provider = {
  name: 'PAYMASTER_OPTIONS',
  description: 'Available paymasters for gas abstraction',
  
  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const paymasterService = runtime.getService('paymaster_service') as any;
    
    if (!paymasterService) {
      return {text: ''};
    }
    
    try {
      const paymasters = await paymasterService.getAvailablePaymasters();
      
      if (paymasters.length === 0) {
        return {text: '[PAYMASTER OPTIONS]\nNo paymasters currently available\n[/PAYMASTER OPTIONS]'};
      }
      
      const paymasterText = paymasters
        .map((pm: any) => `- ${pm.tokenSymbol}: ${ethers.formatEther(pm.stakedEth)} ETH staked`)
        .join('\n');
      
      return {
        text: `[PAYMASTER OPTIONS]\nAvailable gas payment methods:\n${paymasterText}\n[/PAYMASTER OPTIONS]`,
        data: {
          paymasters: paymasters.map((pm: any) => ({
            token: pm.tokenSymbol,
            address: pm.address,
            stakedEth: pm.stakedEth.toString()
          }))
        }
      };
    } catch (error) {
      runtime.logger.error('Failed to fetch paymasters:', error);
      return {text: ''};
    }
  }
};

/**
 * Recent Activity Provider
 * Shows agent's recent actions and outcomes
 */
export const recentActivityProvider: Provider = {
  name: 'RECENT_ACTIVITY',
  description: 'Agent recent actions and test results',
  private: false, // Make available in normal context
  position: -1, // Put near end of context
  
  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    try {
      // Get last 5 action memories
      const memories = await runtime.getMemories({
        count: 5,
        tableName: 'messages'
      });
      
      const actions = memories
        .filter(m => m.content?.action)
        .map(m => {
          const action = m.content?.action;
          const timestamp = m.createdAt ? new Date(m.createdAt).toISOString().split('T')[1].split('.')[0] : 'unknown';
          const success = m.content?.data?.success !== false;
          return `[${timestamp}] ${action}: ${success ? '✅' : '❌'}`;
        });
      
      if (actions.length === 0) {
        return {text: ''};
      }
      
      return {
        text: `[RECENT ACTIVITY]\n${actions.join('\n')}\n[/RECENT ACTIVITY]`,
        data: {
          actions: memories.filter(m => m.content?.action).map(m => ({
            action: m.content?.action,
            success: m.content?.data?.success !== false,
            timestamp: m.createdAt
          }))
        }
      };
    } catch (error) {
      return {text: ''};
    }
  }
};

export const providersPlugin: Plugin = {
  name: '@crucible/plugin-providers',
  description: 'Contract state providers for agent context enrichment',
  providers: [
    agentReputationProvider,
    networkStatusProvider,
    walletBalanceProvider,
    paymasterOptionsProvider,
    recentActivityProvider
  ]
};

