/**
 * Jeju Wallet Agent Providers
 * State providers for the AI agent - simplified format
 */

import type { Address } from 'viem';
import { rpcService, SUPPORTED_CHAINS, SupportedChainId } from '../../services/rpc';
import { oracleService } from '../../services/oracle';
import { approvalService } from '../../services/approval';
import { historyService } from '../../services/history';

export interface ProviderResult {
  text: string;
  values: Record<string, unknown>;
}

// Wallet State Provider
export async function getWalletState(address?: Address): Promise<ProviderResult> {
  if (!address) {
    return {
      text: 'No wallet connected. User needs to connect wallet first.',
      values: { walletConnected: false },
    };
  }

  return {
    text: `Wallet connected: ${address.slice(0, 6)}...${address.slice(-4)}`,
    values: {
      walletConnected: true,
      address,
      addressShort: `${address.slice(0, 6)}...${address.slice(-4)}`,
      supportedChains: Object.values(SUPPORTED_CHAINS).map(c => c.name).join(', '),
    },
  };
}

// Balance Provider
export async function getBalances(address?: Address): Promise<ProviderResult> {
  if (!address) {
    return { text: 'No wallet connected', values: { hasBalances: false } };
  }

  try {
    const balances = await rpcService.getAllBalances(address);
    const nonZero = balances.filter(b => b.balance > 0n);
    
    if (nonZero.length === 0) {
      return {
        text: 'No balances found across any chain.',
        values: { hasBalances: false },
      };
    }

    const balanceInfo = await Promise.all(nonZero.map(async (b) => {
      const chain = SUPPORTED_CHAINS[b.chainId];
      const price = await oracleService.getNativeTokenPrice(b.chainId);
      const usdValue = parseFloat(b.formatted) * price;
      return {
        chain: chain.name,
        symbol: chain.nativeCurrency.symbol,
        amount: b.formatted,
        usdValue: usdValue.toFixed(2),
      };
    }));

    const totalUsd = balanceInfo.reduce((sum, b) => sum + parseFloat(b.usdValue), 0);

    return {
      text: `Total portfolio: $${totalUsd.toFixed(2)} across ${nonZero.length} chains`,
      values: {
        hasBalances: true,
        balances: balanceInfo,
        totalUsdValue: totalUsd.toFixed(2),
      },
    };
  } catch {
    return { text: 'Failed to fetch balances', values: { hasBalances: false } };
  }
}

// Security Provider
export async function getSecurityInfo(address?: Address): Promise<ProviderResult> {
  if (!address) {
    return { text: 'No wallet connected', values: { hasSecurityInfo: false } };
  }

  try {
    const approvals = await approvalService.getApprovals(address);
    
    const securityStatus = approvals.highRiskApprovals > 0 ? 'warning' : 'good';
    const recommendation = approvals.highRiskApprovals > 0 
      ? 'Consider reviewing and revoking high-risk token approvals.'
      : 'Your wallet security looks good.';

    return {
      text: `Security status: ${securityStatus}. ${approvals.totalTokenApprovals} active approvals.`,
      values: {
        hasSecurityInfo: true,
        totalApprovals: approvals.totalTokenApprovals,
        unlimitedApprovals: approvals.unlimitedApprovals,
        highRiskApprovals: approvals.highRiskApprovals,
        securityStatus,
        recommendation,
      },
    };
  } catch {
    return { text: 'Failed to fetch security info', values: { hasSecurityInfo: false } };
  }
}

// History Provider
export async function getTransactionHistory(address?: Address): Promise<ProviderResult> {
  if (!address) {
    return { text: 'No wallet connected', values: { hasHistory: false } };
  }

  try {
    const transactions = await historyService.getHistory(address, { limit: 5 });
    const pending = await historyService.getPendingTransactions(address);

    return {
      text: `${transactions.length} recent transactions, ${pending.length} pending`,
      values: {
        hasHistory: transactions.length > 0,
        recentTransactionCount: transactions.length,
        pendingTransactionCount: pending.length,
        lastTransaction: transactions[0] ? {
          type: transactions[0].type,
          chain: SUPPORTED_CHAINS[transactions[0].chainId].name,
          timestamp: new Date(transactions[0].timestamp * 1000).toLocaleString(),
        } : null,
      },
    };
  } catch {
    return { text: 'Failed to fetch history', values: { hasHistory: false } };
  }
}

// Gas Provider
export async function getGasPrices(): Promise<ProviderResult> {
  try {
    const gasPrices = await Promise.all(
      [1, 8453, 42161].map(async (chainId) => {
        const gas = await oracleService.getGasPrice(chainId as SupportedChainId);
        return {
          chain: SUPPORTED_CHAINS[chainId as SupportedChainId].name,
          standard: gas.standard.gwei,
          fast: gas.fast.gwei,
        };
      })
    );

    const isGasCheap = gasPrices[0].standard < 20;

    return {
      text: isGasCheap ? 'Gas is cheap right now.' : 'Gas prices are elevated.',
      values: {
        hasGasInfo: true,
        gasPrices,
        recommendation: isGasCheap ? 'Good time for transactions.' : 'Consider waiting for lower gas.',
      },
    };
  } catch {
    return { text: 'Failed to fetch gas prices', values: { hasGasInfo: false } };
  }
}

// Get all wallet context
export async function getWalletContext(address?: Address): Promise<Record<string, ProviderResult>> {
  const [walletState, balances, security, history, gas] = await Promise.all([
    getWalletState(address),
    getBalances(address),
    getSecurityInfo(address),
    getTransactionHistory(address),
    getGasPrices(),
  ]);

  return {
    walletState,
    balances,
    security,
    history,
    gas,
  };
}
