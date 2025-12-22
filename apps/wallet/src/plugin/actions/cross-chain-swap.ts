/**
 * Cross-Chain Swap Action
 * 
 * Performs bridgeless cross-chain swaps using EIL.
 */

import { EILService } from '../services/eil.service';
import type { ActionContext, ActionResult } from './wallet-info';
import { expectChainId, expectNonEmpty } from '../../lib/validation';

interface CrossChainParams {
  fromToken?: string;
  toToken?: string;
  amount?: string;
  sourceChain?: string;
  destChain?: string;
}

const CHAIN_NAME_TO_ID: Record<string, number> = {
  ethereum: 1,
  mainnet: 1,
  base: 8453,
  arbitrum: 42161,
  optimism: 10,
  polygon: 137,
};

export const crossChainSwapAction = {
  name: 'CROSS_CHAIN_SWAP',
  description: 'Perform a bridgeless cross-chain swap using EIL',
  similes: ['BRIDGE', 'CROSS_CHAIN', 'BRIDGE_SWAP', 'TRANSFER_CROSS_CHAIN'],
  
  parseParams(text: string): CrossChainParams {
    const params: CrossChainParams = {};
    
    // Pattern: "bridge X TOKEN from CHAIN to CHAIN"
    const bridgeMatch = text.match(/(\d+\.?\d*)\s*(\w+)\s*(?:from\s+(\w+)\s+)?(?:to|on)\s+(\w+)/i);
    if (bridgeMatch) {
      params.amount = bridgeMatch[1];
      params.fromToken = bridgeMatch[2].toUpperCase();
      params.toToken = params.fromToken;
      if (bridgeMatch[3]) {
        params.sourceChain = bridgeMatch[3].toLowerCase();
      }
      params.destChain = bridgeMatch[4].toLowerCase();
    }
    
    // Pattern: "swap X TOKEN for TOKEN on CHAIN"
    const swapMatch = text.match(/(\d+\.?\d*)\s*(\w+)\s*for\s*(\w+)\s*(?:on|to)\s*(\w+)/i);
    if (swapMatch) {
      params.amount = swapMatch[1];
      params.fromToken = swapMatch[2].toUpperCase();
      params.toToken = swapMatch[3].toUpperCase();
      params.destChain = swapMatch[4].toLowerCase();
    }
    
    return params;
  },
  
  async execute(
    context: ActionContext & { eilService?: EILService },
    params: CrossChainParams
  ): Promise<ActionResult> {
    context.logger.info('[CrossChainSwap] Processing cross-chain swap request');
    
    const { walletService, eilService } = context;
    
    if (!walletService || !eilService) {
      return { success: false, message: 'Required services not available' };
    }
    
    const state = walletService.getState();
    if (state.isLocked || !state.currentAccount) {
      return { success: false, message: 'Please unlock your wallet first' };
    }
    
    const sourceChainId = params.sourceChain 
      ? CHAIN_NAME_TO_ID[params.sourceChain.toLowerCase()] || state.activeChainId
      : state.activeChainId;
    const destChainId = CHAIN_NAME_TO_ID[params.destChain?.toLowerCase() || ''] || 8453;
    
    expectChainId(sourceChainId, 'sourceChainId');
    expectChainId(destChainId, 'destChainId');
    if (params.amount) expectNonEmpty(params.amount, 'amount');
    if (params.fromToken) expectNonEmpty(params.fromToken, 'fromToken');
    if (params.toToken) expectNonEmpty(params.toToken, 'toToken');

    // Check if route is supported
    if (!eilService.isRouteSupported(sourceChainId, destChainId)) {
      return {
        success: false,
        message: `Cross-chain route from chain ${sourceChainId} to ${destChainId} is not currently supported.`,
      };
    }
    
    return {
      success: true,
      message: `**Cross-Chain Swap Preview**

Swapping **${params.amount} ${params.fromToken}** on **Chain ${sourceChainId}**
For **${params.toToken}** on **Chain ${destChainId}**

This will use the Ethereum Interoperability Layer (EIL) for a bridgeless transfer.
Estimated time: ~2 minutes

Please confirm to proceed.`,
      data: { requiresConfirmation: true, ...params, sourceChainId, destChainId },
    };
  },
};

export default crossChainSwapAction;
