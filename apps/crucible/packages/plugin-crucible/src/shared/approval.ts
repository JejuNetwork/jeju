/**
 * Approval Service
 * Manages token approvals for paymasters and other contracts
 * Handles approval failures gracefully with retry logic
 */

import { Plugin, Service, Action, type IAgentRuntime, type Memory } from '@elizaos/core';
import { ethers } from 'ethers';
import type { ContractService } from './contracts';

/**
 * Approval Service
 * Manages token allowances for contracts
 */
export class ApprovalService extends Service {
  public static serviceType = 'approval_service';
  
  private provider!: ethers.JsonRpcProvider;
  private wallet!: ethers.Wallet;
  private pendingApprovals: Map<string, Promise<string>> = new Map();
  
  async start(runtime: IAgentRuntime): Promise<ApprovalService> {
    const contractService = runtime.getService<ContractService>('contract_service');
    
    if (!contractService) {
      throw new Error('ContractService required for ApprovalService');
    }
    
    this.provider = contractService.getProvider();
    this.wallet = contractService.getWallet();
    
    runtime.logger.info('Approval service started', {
      wallet: this.wallet.address
    });
    
    return this;
  }
  
  /**
   * Check if spender has sufficient allowance
   */
  async checkAllowance(
    tokenAddress: string,
    spenderAddress: string,
    requiredAmount: bigint
  ): Promise<{ approved: boolean; currentAllowance: bigint }> {
    try {
      const erc20Abi = ['function allowance(address owner, address spender) view returns (uint256)'];
      const token = new ethers.Contract(tokenAddress, erc20Abi, this.provider);
      const allowance = await token.allowance(this.wallet.address, spenderAddress);
      
      return {
        approved: allowance >= requiredAmount,
        currentAllowance: allowance
      };
    } catch (error) {
      this.runtime.logger.error('Failed to check allowance:', error);
      return { approved: false, currentAllowance: BigInt(0) };
    }
  }
  
  /**
   * Approve token spending with retry logic
   */
  async approveToken(
    tokenAddress: string,
    spenderAddress: string,
    amount: bigint,
    maxRetries: number = 3
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const approvalKey = `${tokenAddress}_${spenderAddress}`;
    
    // Check if approval is already pending
    if (this.pendingApprovals.has(approvalKey)) {
      this.runtime.logger.debug('Approval already in progress, waiting...');
      try {
        const txHash = await this.pendingApprovals.get(approvalKey)!;
        return { success: true, txHash };
      } catch (error) {
        return { 
          success: false, 
          error: error instanceof Error ? error.message : 'Pending approval failed' 
        };
      }
    }
    
    // Create approval promise
    const approvalPromise = this.executeApproval(
      tokenAddress,
      spenderAddress,
      amount,
      maxRetries
    );
    
    this.pendingApprovals.set(approvalKey, approvalPromise);
    
    try {
      const txHash = await approvalPromise;
      return { success: true, txHash };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Approval failed'
      };
    } finally {
      this.pendingApprovals.delete(approvalKey);
    }
  }
  
  /**
   * Execute approval with retries
   */
  private async executeApproval(
    tokenAddress: string,
    spenderAddress: string,
    amount: bigint,
    maxRetries: number
  ): Promise<string> {
    const erc20Abi = ['function approve(address spender, uint256 amount) returns (bool)'];
    const token = new ethers.Contract(tokenAddress, erc20Abi, this.wallet);
    
    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        this.runtime.logger.info(`Approving token spend (attempt ${attempt + 1}/${maxRetries})`, {
          token: tokenAddress,
          spender: spenderAddress,
          amount: ethers.formatUnits(amount, 18)
        });
        
        const tx = await token.approve(spenderAddress, amount);
        const receipt = await tx.wait();
        
        if (!receipt) {
          throw new Error('Approval transaction receipt is null');
        }
        
        this.runtime.logger.info('Approval successful', {
          txHash: receipt.hash
        });
        
        return receipt.hash;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.runtime.logger.warn(`Approval attempt ${attempt + 1} failed:`, lastError.message);
        
        // Wait before retry (exponential backoff)
        if (attempt < maxRetries - 1) {
          const waitTime = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }
    
    throw lastError || new Error('Approval failed after all retries');
  }
  
  /**
   * Ensure approval exists, approve if needed
   */
  async ensureApproval(
    tokenAddress: string,
    spenderAddress: string,
    requiredAmount: bigint
  ): Promise<{ approved: boolean; txHash?: string; error?: string }> {
    // Check current allowance
    const check = await this.checkAllowance(tokenAddress, spenderAddress, requiredAmount);
    
    if (check.approved) {
      this.runtime.logger.debug('Sufficient allowance already exists', {
        currentAllowance: ethers.formatUnits(check.currentAllowance, 18)
      });
      return { approved: true };
    }
    
    // Need to approve
    this.runtime.logger.info('Insufficient allowance, approving...', {
      required: ethers.formatUnits(requiredAmount, 18),
      current: ethers.formatUnits(check.currentAllowance, 18)
    });
    
    // Approve with some buffer (10% extra to account for price fluctuations)
    const approvalAmount = (requiredAmount * BigInt(110)) / BigInt(100);
    
    return await this.approveToken(tokenAddress, spenderAddress, approvalAmount);
  }
  
  async stop(): Promise<void> {
    // Wait for any pending approvals
    if (this.pendingApprovals.size > 0) {
      this.runtime.logger.info('Waiting for pending approvals to complete...');
      await Promise.allSettled(Array.from(this.pendingApprovals.values()));
    }
    
    this.pendingApprovals.clear();
    this.runtime.logger.info('Approval service stopped');
  }
  
  public get capabilityDescription(): string {
    return 'Token approval management with automatic retry and failure handling';
  }
}

/**
 * Approve Token Action
 * Allows agents to manually approve token spending
 */
export const approveTokenAction: Action = {
  name: 'APPROVE_TOKEN',
  description: 'Approve a contract to spend tokens on behalf of this agent',
  
  similes: ['approve spending', 'allow token use', 'grant approval'],
  
  examples: [[
    {
      name: 'system',
      content: {text: 'Approve paymaster to spend USDC'}
    },
    {
      name: 'agent',
      content: {text: 'Approving USDC spending for paymaster...', action: 'APPROVE_TOKEN'}
    }
  ]],
  
  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<ApprovalService>('approval_service');
    return !!service;
  },
  
  handler: async (runtime: IAgentRuntime, message: Memory, state?: any) => {
    const service = runtime.getService<ApprovalService>('approval_service');
    if (!service) {
      return {success: false, error: 'Approval service not available'};
    }
    
    try {
      const tokenAddress = state?.tokenAddress || message.content?.data?.tokenAddress;
      const spenderAddress = state?.spenderAddress || message.content?.data?.spenderAddress;
      const amount = state?.amount ? BigInt(state.amount) : ethers.parseEther('1000000'); // Default: unlimited
      
      if (!tokenAddress || !spenderAddress) {
        throw new Error('Token address and spender address required');
      }
      
      const result = await service.approveToken(tokenAddress, spenderAddress, amount);
      
      if (!result.success) {
        return result;
      }
      
      runtime.logger.info('Token approval successful', {
        token: tokenAddress,
        spender: spenderAddress,
        amount: ethers.formatUnits(amount, 18),
        txHash: result.txHash
      });
      
      await runtime.createMemory({
        userId: runtime.agentId,
        content: {
          text: `Approved ${ethers.formatUnits(amount, 18)} tokens for spender ${spenderAddress}. TX: ${result.txHash}`,
          action: 'APPROVE_TOKEN',
          data: {
            tokenAddress,
            spenderAddress,
            amount: amount.toString(),
            txHash: result.txHash
          }
        },
        roomId: message.roomId
      }, 'messages');
      
      return {
        success: true,
        txHash: result.txHash,
        tokenAddress,
        spenderAddress,
        amount: amount.toString()
      };
    } catch (error: any) {
      runtime.logger.error('Token approval failed:', error);
      return {success: false, error: error.message};
    }
  }
};

export const approvalPlugin: Plugin = {
  name: '@crucible/plugin-approval',
  description: 'Token approval management with automatic retry and failure handling',
  services: [ApprovalService],
  actions: [approveTokenAction]
};

