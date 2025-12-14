/**
 * Swap Action
 * 
 * Swaps one token for another on the same chain.
 */

import { WalletService } from '../services/wallet.service';
import { GasService } from '../services/gas.service';
import type { ActionContext, ActionResult } from './wallet-info';

interface SwapParams {
  fromToken?: string;
  toToken?: string;
  amount?: string;
  chainId?: number;
}

export const swapAction = {
  name: 'SWAP_TOKENS',
  description: 'Swap one token for another on the same chain',
  similes: ['SWAP', 'EXCHANGE', 'TRADE', 'CONVERT'],
  
  parseParams(text: string): SwapParams {
    const params: SwapParams = {};
    
    // Pattern: "swap X TOKEN for TOKEN"
    const swapMatch = text.match(/(\d+\.?\d*)\s*(\w+)\s*(?:for|to)\s*(\w+)/i);
    if (swapMatch) {
      params.amount = swapMatch[1];
      params.fromToken = swapMatch[2].toUpperCase();
      params.toToken = swapMatch[3].toUpperCase();
    }
    
    return params;
  },
  
  async execute(
    context: ActionContext & { gasService?: GasService },
    params: SwapParams
  ): Promise<ActionResult> {
    context.logger.info('[Swap] Processing swap request');
    
    const { walletService, gasService } = context;
    
    if (!walletService) {
      return { success: false, message: 'Wallet service not available' };
    }
    
    const state = walletService.getState();
    if (state.isLocked || !state.currentAccount) {
      return { success: false, message: 'Please unlock your wallet first' };
    }
    
    const chainId = params.chainId || state.activeChainId;
    
    // Get gas estimate if available
    let gasInfo = '';
    if (gasService) {
      const gasEstimate = await gasService.getGasPrice(chainId);
      gasInfo = `\nEstimated gas: ~${gasEstimate.estimatedCost.eth.toFixed(6)} ETH`;
    }
    
    return {
      success: true,
      message: `**Swap Preview**

Swapping **${params.amount} ${params.fromToken}** for **${params.toToken}**
Chain: ${chainId}
${gasInfo}

Please confirm to proceed with the swap.`,
      data: { requiresConfirmation: true, ...params, chainId },
    };
  },
};

export default swapAction;
