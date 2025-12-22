/**
 * Network Wallet Providers
 * 
 * Providers expose wallet state and data to the agent's context.
 */

import { WalletService } from '../services/wallet.service';
import type { TokenBalance } from '../types';

export interface ProviderResult {
  text: string;
  data?: Record<string, unknown>;
}

/**
 * Provider that exposes current wallet state
 */
export const walletStateProvider = {
  name: 'jeju-wallet-state',
  description: 'Provides current wallet connection state and account info',
  
  async get(walletService: WalletService | null): Promise<ProviderResult> {
    if (!walletService) {
      return { text: 'Wallet service not available' };
    }
    
    const state = walletService.getState();
    
    if (!state.isInitialized) {
      return { text: 'Wallet not initialized. No accounts connected.' };
    }
    
    if (state.isLocked) {
      return { text: 'Wallet is locked. Please unlock to access account information.' };
    }
    
    const account = state.currentAccount;
    if (!account) {
      return { text: 'No account selected.' };
    }
    
    const text = `Connected wallet: ${account.address.slice(0, 6)}...${account.address.slice(-4)}
Account type: ${account.type}
Account name: ${account.name}
Active chain: ${state.activeChainId}
Preferred chains: ${state.preferredChains.join(', ')}
View mode: ${state.viewMode}`;

    return { 
      text, 
      data: { address: account.address, chainId: state.activeChainId, viewMode: state.viewMode } 
    };
  },
};

/**
 * Provider that exposes token balances
 */
export const balancesProvider = {
  name: 'jeju-wallet-balances',
  description: 'Provides current token balances across all chains',
  
  async get(walletService: WalletService | null): Promise<ProviderResult> {
    if (!walletService) {
      return { text: 'Wallet service not available' };
    }
    
    const state = walletService.getState();
    
    if (state.isLocked || !state.currentAccount) {
      return { text: 'Wallet locked or no account connected' };
    }
    
    let balances: TokenBalance[];
    try {
      balances = await walletService.getBalances();
    } catch (error) {
      return { 
        text: `Unable to fetch balances: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
    }
    
    if (balances.length === 0) {
      return { text: 'No token balances found' };
    }
    
    const balanceLines = balances.map(b => {
      const value = b.valueUsd ? ` ($${b.valueUsd.toFixed(2)})` : '';
      return `${b.token.symbol}: ${b.balanceFormatted}${value} on chain ${b.token.chainId}`;
    });
    
    return { 
      text: `Token Balances:\n${balanceLines.join('\n')}`,
      data: { balances } 
    };
  },
};
