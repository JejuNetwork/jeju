/**
 * Send Token Action
 * 
 * Sends tokens to a recipient address.
 */

import { WalletService } from '../services/wallet.service';
import { SecurityService } from '../services/security.service';
import { type Address, parseUnits, isAddress } from 'viem';
import type { ActionContext, ActionResult } from './wallet-info';

interface SendParams {
  recipient?: string;
  to?: string;
  amount?: string;
  token?: string;
  chainId?: number;
}

export const sendTokenAction = {
  name: 'SEND_TOKEN',
  description: 'Send tokens or ETH to a recipient address',
  similes: ['TRANSFER', 'SEND_ETH', 'SEND_CRYPTO', 'PAY'],
  
  parseParams(text: string): SendParams {
    const params: SendParams = {};
    
    // Extract address
    const addressMatch = text.match(/0x[a-fA-F0-9]{40}/);
    if (addressMatch) {
      params.recipient = addressMatch[0];
    }
    
    // Extract amount
    const amountMatch = text.match(/(\d+\.?\d*)\s*(ETH|USDC|USDT|DAI)?/i);
    if (amountMatch) {
      params.amount = amountMatch[1];
      if (amountMatch[2]) {
        params.token = amountMatch[2].toUpperCase();
      }
    }
    
    return params;
  },
  
  async execute(
    context: ActionContext & { securityService?: SecurityService },
    params: SendParams
  ): Promise<ActionResult> {
    context.logger.info('[SendToken] Processing send request');
    
    const { walletService, securityService } = context;
    
    if (!walletService) {
      return { success: false, message: 'Wallet service not available' };
    }
    
    const state = walletService.getState();
    if (state.isLocked || !state.currentAccount) {
      return { success: false, message: 'Please unlock your wallet first' };
    }
    
    const recipient = (params.recipient || params.to) as Address;
    
    if (!recipient || !isAddress(recipient)) {
      return { success: false, message: 'Invalid recipient address' };
    }
    
    const amount = params.amount || '0';
    const token = params.token || 'ETH';
    const chainId = params.chainId || state.activeChainId;
    
    // Parse amount
    let value: bigint;
    try {
      value = parseUnits(amount, 18);
    } catch {
      return { success: false, message: 'Invalid amount format' };
    }
    
    // Security analysis
    if (securityService) {
      const analysis = await securityService.analyzeTransaction({
        chainId,
        to: recipient,
        value,
      });
      
      if (analysis.riskLevel === 'critical' || analysis.riskLevel === 'high') {
        return {
          success: true,
          message: `⚠️ High risk detected: ${analysis.summary}\n\nAre you sure you want to proceed?`,
          data: { requiresConfirmation: true, riskLevel: analysis.riskLevel },
        };
      }
    }
    
    return {
      success: true,
      message: `**Confirm Transaction**

Sending **${amount} ${token}** to \`${recipient}\`
Chain: ${chainId}

Please confirm to proceed.`,
      data: { requiresConfirmation: true, recipient, amount, token, chainId },
    };
  },
};

export default sendTokenAction;
