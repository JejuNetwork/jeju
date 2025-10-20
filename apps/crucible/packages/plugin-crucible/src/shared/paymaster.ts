/**
 * Multicoin Paymaster Integration for Crucible
 * Integrates with Jeju's standard LiquidityPaymaster system
 * Uses PaymasterFactory and TokenRegistry from contracts/src/paymaster/
 */

import { Plugin, Service, type IAgentRuntime, Action, type Memory } from '@elizaos/core';
import { ethers } from 'ethers';

export interface PaymasterDeployment {
  paymaster: string;
  vault: string;
  distributor: string;
  token: string;
  operator: string;
  feeMargin: number;
}

export interface PaymasterInfo {
  address: string;
  vault: string;
  distributor: string;
  token: string;
  tokenSymbol: string;
  tokenName: string;
  feeMargin: number;
  isOperational: boolean;
  entryPointBalance: bigint;
  vaultLiquidity: bigint;
}

/**
 * Paymaster Service
 * Manages paymaster discovery and gas abstraction
 */
export class PaymasterService extends Service {
  public static serviceType = 'paymaster_service';
  
  private provider!: ethers.JsonRpcProvider;
  private factoryAddress!: string;
  private minStakedEth!: bigint;
  private paymasterCache: Map<string, PaymasterInfo> = new Map();
  private cacheExpiry: number = 0;
  
  async start(runtime: IAgentRuntime): Promise<PaymasterService> {
    const rpcUrl = runtime.getSetting('JEJU_L2_RPC');
    
    if (!rpcUrl) {
      throw new Error('JEJU_L2_RPC required for PaymasterService');
    }
    
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    
    // Load factory address from environment
    this.factoryAddress = runtime.getSetting('PAYMASTER_FACTORY') || ethers.ZeroAddress;
    
    const minStakeSetting = runtime.getSetting('PAYMASTER_MIN_STAKE');
    this.minStakedEth = minStakeSetting ? ethers.parseEther(minStakeSetting) : ethers.parseEther('1.0');
    
    runtime.logger.info('Paymaster service started', {
      rpcUrl,
      factory: this.factoryAddress,
      minStake: ethers.formatEther(this.minStakedEth) + ' ETH'
    });
    
    return this;
  }
  
  /**
   * Get all available paymasters from factory
   */
  async getAvailablePaymasters(): Promise<PaymasterInfo[]> {
    // Check cache (refresh every 5 minutes)
    if (this.cacheExpiry > Date.now() && this.paymasterCache.size > 0) {
      return Array.from(this.paymasterCache.values());
    }
    
    if (this.factoryAddress === ethers.ZeroAddress) {
      this.runtime.logger.warn('Paymaster factory not configured');
      return [];
    }
    
    try {
      // Query PaymasterFactory for all deployments
      const factoryAbi = [
        'function getAllDeployments() view returns (address[] memory tokens)',
        'function getDeployment(address token) view returns (tuple(address paymaster, address vault, address distributor, address token, address operator, uint256 deployedAt, uint256 feeMargin))'
      ];
      
      const factory = new ethers.Contract(this.factoryAddress, factoryAbi, this.provider);
      const tokenAddresses = await factory.getAllDeployments();
      
      const paymasters: PaymasterInfo[] = [];
      
      for (const tokenAddr of tokenAddresses) {
        try {
          const deployment = await factory.getDeployment(tokenAddr);
          
          // Get token metadata
          const erc20Abi = [
            'function symbol() view returns (string)',
            'function name() view returns (string)'
          ];
          
          const tokenContract = new ethers.Contract(tokenAddr, erc20Abi, this.provider);
          const [tokenSymbol, tokenName] = await Promise.all([
            tokenContract.symbol(),
            tokenContract.name()
          ]);
          
          // Get paymaster status
          const paymasterAbi = [
            'function isOperational() view returns (bool)',
            'function getStatus() view returns (uint256 entryPointBalance, uint256 vaultLiquidity, bool oracleFresh, bool operational)'
          ];
          
          const paymasterContract = new ethers.Contract(deployment.paymaster, paymasterAbi, this.provider);
          const status = await paymasterContract.getStatus();
          
          const paymasterInfo: PaymasterInfo = {
            address: deployment.paymaster,
            vault: deployment.vault,
            distributor: deployment.distributor,
            token: tokenAddr,
            tokenSymbol,
            tokenName,
            feeMargin: Number(deployment.feeMargin),
            isOperational: status.operational,
            entryPointBalance: status.entryPointBalance,
            vaultLiquidity: status.vaultLiquidity
          };
          
          paymasters.push(paymasterInfo);
          this.paymasterCache.set(tokenAddr.toLowerCase(), paymasterInfo);
          
        } catch (error) {
          this.runtime.logger.error(`Error querying paymaster for token ${tokenAddr}:`, error);
        }
      }
      
      // Update cache expiry
      this.cacheExpiry = Date.now() + (5 * 60 * 1000); // 5 minutes
      
      return paymasters;
      
    } catch (error) {
      this.runtime.logger.error('Error querying paymaster factory:', error);
      return [];
    }
  }
  
  /**
   * Get paymaster for specific token
   */
  async getPaymasterForToken(tokenAddress: string): Promise<PaymasterInfo | null> {
    // Check cache first
    const cached = this.paymasterCache.get(tokenAddress.toLowerCase());
    if (cached && this.cacheExpiry > Date.now()) {
      return cached;
    }
    
    // Refresh cache
    const paymasters = await this.getAvailablePaymasters();
    return paymasters.find(pm => pm.token.toLowerCase() === tokenAddress.toLowerCase()) || null;
  }
  
  /**
   * Estimate gas cost in tokens using paymaster's calculateElizaOSAmount
   */
  async estimateTokenCost(
    paymaster: PaymasterInfo,
    gasEstimate: bigint,
    gasPrice: bigint
  ): Promise<bigint> {
    try {
      const ethCost = gasEstimate * gasPrice;
      
      // Query paymaster contract for accurate cost calculation
      const paymasterAbi = ['function calculateElizaOSAmount(uint256 gasCostInETH) view returns (uint256)'];
      const paymasterContract = new ethers.Contract(paymaster.address, paymasterAbi, this.provider);
      const tokenCost = await paymasterContract.calculateElizaOSAmount(ethCost);
      
      return tokenCost;
    } catch (error) {
      this.runtime.logger.error('Failed to estimate token cost, using fallback:', error);
      // Fallback: simple 1:1 with margin
      const ethCost = gasEstimate * gasPrice;
      const margin = BigInt(paymaster.feeMargin || 1000); // Default 10%
      const baseTokens = ethCost * BigInt(1000); // Assume 1000 tokens per ETH
      return baseTokens + (baseTokens * margin) / BigInt(10000);
    }
  }
  
  /**
   * Prepare paymaster data for ERC-4337 UserOperation (v0.7 format)
   * Format: paymaster (20 bytes) + verificationGasLimit (16 bytes) + postOpGasLimit (16 bytes) + appAddress (20 bytes)
   */
  preparePaymasterData(
    paymasterAddress: string,
    maxTokenAmount: bigint,
    appAddress: string = ethers.ZeroAddress,
    verificationGas: bigint = BigInt(100000),
    postOpGas: bigint = BigInt(50000)
  ): { paymaster: string; paymasterData: string } {
    // ERC-4337 v0.7 paymasterAndData format:
    // [0:20]   - paymaster address
    // [20:36]  - verificationGasLimit (uint128)
    // [36:52]  - postOpGasLimit (uint128)  
    // [52:72]  - appAddress (custom data for LiquidityPaymaster)
    
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const customData = abiCoder.encode(['address'], [appAddress]);
    
    // Construct paymasterAndData
    const paymasterData = ethers.concat([
      paymasterAddress,
      ethers.toBeHex(verificationGas, 16), // uint128
      ethers.toBeHex(postOpGas, 16),       // uint128
      customData                            // app address
    ]);
    
    return {
      paymaster: paymasterAddress,
      paymasterData
    };
  }
  
  /**
   * Check if user has approved paymaster
   */
  async checkApproval(
    userAddress: string,
    tokenAddress: string,
    paymasterAddress: string,
    amount: bigint
  ): Promise<boolean> {
    try {
      const erc20Abi = ['function allowance(address owner, address spender) view returns (uint256)'];
      const token = new ethers.Contract(tokenAddress, erc20Abi, this.provider);
      const allowance = await token.allowance(userAddress, paymasterAddress);
      return allowance >= amount;
    } catch (error) {
      this.runtime.logger.error('Error checking paymaster approval:', error);
      return false;
    }
  }
  
  async stop(): Promise<void> {
    this.paymasterCache.clear();
    this.runtime.logger.info('Paymaster service stopped');
  }
  
  public get capabilityDescription(): string {
    return 'Multicoin paymaster integration for gas abstraction';
  }
}

/**
 * Discover Paymasters Action
 */
export const discoverPaymastersAction: Action = {
  name: 'DISCOVER_PAYMASTERS',
  description: 'Discover available paymasters that accept different tokens for gas payment',
  
  similes: ['find paymasters', 'check gas tokens', 'list payment methods'],
  
  examples: [[
    {
      name: 'system',
      content: {text: 'Discover available paymasters'}
    },
    {
      name: 'agent',
      content: {text: 'Querying paymaster factory for available gas payment options...', action: 'DISCOVER_PAYMASTERS'}
    }
  ]],
  
  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<PaymasterService>('paymaster_service');
    return !!service;
  },
  
  handler: async (runtime: IAgentRuntime, message: Memory) => {
    const service = runtime.getService<PaymasterService>('paymaster_service');
    if (!service) {
      return {success: false, error: 'Paymaster service not available'};
    }
    
    try {
      const paymasters = await service.getAvailablePaymasters();
      
      runtime.logger.info(`Discovered ${paymasters.length} paymasters`);
      
      const description = paymasters.length > 0 
        ? paymasters.map(pm => 
            `- ${pm.tokenSymbol} (${pm.tokenName}): ${pm.isOperational ? '✅ Operational' : '⚠️  Offline'}, Fee: ${pm.feeMargin / 100}%`
          ).join('\n')
        : 'No paymasters currently available';
      
      await runtime.createMemory({
        userId: runtime.agentId,
        content: {
          text: `Discovered ${paymasters.length} paymasters:\n${description}`,
          action: 'DISCOVER_PAYMASTERS',
          data: {paymasters, count: paymasters.length}
        },
        roomId: message.roomId
      }, 'messages');
      
      return {success: true, paymasters, count: paymasters.length};
    } catch (error: any) {
      runtime.logger.error('Paymaster discovery failed:', error);
      return {success: false, error: error.message};
    }
  }
};

/**
 * Use Paymaster Action
 * Prepares transaction to use paymaster for gas payment
 */
export const usePaymasterAction: Action = {
  name: 'USE_PAYMASTER',
  description: 'Prepare a transaction to use a specific token for gas payment via paymaster',
  
  similes: ['pay gas with tokens', 'use paymaster', 'gas abstraction'],
  
  examples: [[
    {
      name: 'system',
      content: {text: 'Pay gas with USDC'}
    },
    {
      name: 'agent',
      content: {text: 'Preparing transaction to pay gas with USDC...', action: 'USE_PAYMASTER'}
    }
  ]],
  
  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<PaymasterService>('paymaster_service');
    return !!service;
  },
  
  handler: async (runtime: IAgentRuntime, message: Memory, state?: any) => {
    const service = runtime.getService<PaymasterService>('paymaster_service');
    if (!service) {
      return {success: false, error: 'Paymaster service not available'};
    }
    
    try {
      const tokenAddress = state?.tokenAddress || message.content?.data?.tokenAddress;
      const gasEstimate = state?.gasEstimate || BigInt(21000);
      const gasPrice = state?.gasPrice || ethers.parseUnits('1', 'gwei');
      
      if (!tokenAddress) {
        throw new Error('Token address required');
      }
      
      const paymaster = await service.getPaymasterForToken(tokenAddress);
      
      if (!paymaster) {
        return {
          success: false,
          error: `No paymaster available for token ${tokenAddress}`
        };
      }
      
      const tokenCost = await service.estimateTokenCost(paymaster, gasEstimate, gasPrice);
      const paymasterData = service.preparePaymasterData(
        paymaster.address,
        tokenCost
      );
      
      runtime.logger.info('Paymaster prepared', {
        token: paymaster.tokenSymbol,
        estimatedCost: ethers.formatUnits(tokenCost, 18),
        paymaster: paymaster.address
      });
      
      await runtime.createMemory({
        userId: runtime.agentId,
        content: {
          text: `Prepared paymaster for ${paymaster.tokenSymbol}. Estimated cost: ${ethers.formatUnits(tokenCost, 18)} ${paymaster.tokenSymbol}`,
          action: 'USE_PAYMASTER',
          data: {
            paymaster: paymaster.address,
            token: paymaster.token,
            tokenSymbol: paymaster.tokenSymbol,
            estimatedCost: ethers.formatUnits(tokenCost, 18),
            paymasterData: paymasterData.paymasterData
          }
        },
        roomId: message.roomId
      }, 'messages');
      
      return {
        success: true,
        paymaster: paymaster.address,
        paymasterData: paymasterData.paymasterData,
        estimatedCost: tokenCost.toString(),
        tokenSymbol: paymaster.tokenSymbol
      };
      
    } catch (error: any) {
      runtime.logger.error('Paymaster preparation failed:', error);
      return {success: false, error: error.message};
    }
  }
};

export const paymasterPlugin: Plugin = {
  name: '@crucible/plugin-paymaster',
  description: 'Multicoin paymaster integration for gas abstraction',
  services: [PaymasterService],
  actions: [discoverPaymastersAction, usePaymasterAction]
};

