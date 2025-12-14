/**
 * Jeju Wallet Agent Actions
 * Wallet actions for the AI agent - simplified format
 */

import type { Address, Hex } from 'viem';
import { rpcService, SupportedChainId, SUPPORTED_CHAINS } from '../../services/rpc';
import { oracleService } from '../../services/oracle';
import { securityEngine, type RiskLevel } from '../../services/security';
import { approvalService } from '../../services/approval';
import { historyService } from '../../services/history';
import { aaService } from '../../services/account-abstraction';
import { formatEther, parseEther } from 'viem';

export interface ActionContext {
  walletAddress?: Address;
  chainId?: number;
  logger: {
    info: (msg: string) => void;
    error: (msg: string) => void;
  };
}

export interface ActionResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

function formatConfirmation(params: {
  action: string;
  details: Record<string, string>;
  riskLevel: RiskLevel;
  gasEstimate?: string;
}): string {
  const { action, details, riskLevel, gasEstimate } = params;
  let message = `**${action}**\n\n`;
  
  for (const [key, value] of Object.entries(details)) {
    message += `• **${key}:** ${value}\n`;
  }
  
  if (gasEstimate) {
    message += `\n**Estimated Gas:** ${gasEstimate}\n`;
  }
  
  message += `\n**Risk Level:** ${securityEngine.getRiskLevelLabel(riskLevel)}\n`;
  
  return message;
}

// GET_PORTFOLIO
export const getPortfolioAction = {
  name: 'GET_PORTFOLIO',
  description: 'Get the user portfolio showing all token balances across supported chains',
  similes: ['show portfolio', 'my balances', 'show balances', 'what do I have', 'my tokens'],
  
  async execute(context: ActionContext): Promise<ActionResult> {
    const { walletAddress } = context;
    
    if (!walletAddress) {
      return { success: false, message: 'Please connect your wallet first.' };
    }

    const balances = await rpcService.getAllBalances(walletAddress);
    const nonZeroBalances = balances.filter(b => b.balance > 0n);
    
    if (nonZeroBalances.length === 0) {
      return { 
        success: true, 
        message: `**Your Portfolio**\n\nNo balances found across supported chains.\n\nAddress: \`${walletAddress}\`` 
      };
    }

    const nativePrices = await Promise.all(
      nonZeroBalances.map(b => oracleService.getNativeTokenPrice(b.chainId))
    );

    let totalUsd = 0;
    let response = `**Your Portfolio**\n\nAddress: \`${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}\`\n\n`;
    
    for (let i = 0; i < nonZeroBalances.length; i++) {
      const b = nonZeroBalances[i];
      const chain = SUPPORTED_CHAINS[b.chainId];
      const usdValue = parseFloat(b.formatted) * nativePrices[i];
      totalUsd += usdValue;
      
      response += `• **${chain.name}:** ${b.formatted} ${chain.nativeCurrency.symbol} ($${usdValue.toFixed(2)})\n`;
    }
    
    response += `\n**Total Value:** $${totalUsd.toFixed(2)}`;
    
    return { success: true, message: response };
  },
};

// SWAP_TOKENS
export const swapTokensAction = {
  name: 'SWAP_TOKENS',
  description: 'Swap tokens via Jeju solver',
  similes: ['swap', 'exchange', 'trade', 'convert'],
  
  parseParams(text: string): { amount?: string; fromToken?: string; toToken?: string } {
    const amountMatch = text.match(/(\d+\.?\d*)/);
    const amount = amountMatch ? amountMatch[1] : undefined;
    // Simple parsing - would use NLP in production
    const hasEth = text.toLowerCase().includes('eth');
    const hasUsdc = text.toLowerCase().includes('usdc');
    return { 
      amount, 
      fromToken: hasEth ? 'ETH' : hasUsdc ? 'USDC' : undefined,
      toToken: hasUsdc ? 'USDC' : hasEth ? 'ETH' : undefined,
    };
  },
  
  async execute(context: ActionContext, params: { amount?: string; fromToken?: string; toToken?: string }): Promise<ActionResult> {
    const { walletAddress } = context;
    
    if (!walletAddress) {
      return { success: false, message: 'Please connect your wallet first.' };
    }
    
    if (!params.amount) {
      return { success: false, message: 'Please specify the amount you want to swap. Example: "Swap 0.1 ETH for USDC"' };
    }

    return {
      success: true,
      message: formatConfirmation({
        action: 'Token Swap',
        details: {
          'Amount': params.amount,
          'From': params.fromToken || 'ETH',
          'To': params.toToken || 'USDC',
          'Chain': 'Base',
        },
        riskLevel: 'low',
        gasEstimate: '~$0.50',
      }) + '\n\nReply "confirm" to execute this swap.',
      data: { 
        requiresConfirmation: true, 
        actionType: 'swap',
        ...params,
        chainId: 8453,
      },
    };
  },
};

// SEND_TOKEN
export const sendTokenAction = {
  name: 'SEND_TOKEN',
  description: 'Send tokens to another address',
  similes: ['send', 'transfer', 'pay'],
  
  parseParams(text: string): { to?: string; amount?: string } {
    const addressMatch = text.match(/0x[a-fA-F0-9]{40}/);
    const amountMatch = text.match(/(\d+\.?\d*)/);
    return { 
      to: addressMatch ? addressMatch[0] : undefined,
      amount: amountMatch ? amountMatch[1] : undefined,
    };
  },
  
  async execute(context: ActionContext, params: { to?: string; amount?: string }): Promise<ActionResult> {
    const { walletAddress } = context;
    
    if (!walletAddress) {
      return { success: false, message: 'Please connect your wallet first.' };
    }
    
    if (!params.to) {
      return { success: false, message: 'Please provide a valid recipient address. Example: "Send 0.1 ETH to 0x1234...5678"' };
    }
    
    if (!params.amount) {
      return { success: false, message: 'Please specify the amount to send.' };
    }

    const analysis = await securityEngine.analyzeTransaction({
      chainId: 8453,
      from: walletAddress,
      to: params.to as Address,
      value: parseEther(params.amount),
      data: '0x' as Hex,
    });

    let message = formatConfirmation({
      action: 'Send Token',
      details: {
        'To': `${params.to.slice(0, 6)}...${params.to.slice(-4)}`,
        'Amount': `${params.amount} ETH`,
        'Chain': 'Base',
      },
      riskLevel: analysis.overallRisk,
      gasEstimate: '~$0.10',
    });
    
    if (analysis.recommendations.length > 0) {
      message += `\n\n⚠️ **Warnings:**\n${analysis.recommendations.map(r => `• ${r}`).join('\n')}`;
    }
    
    message += '\n\nReply "confirm" to send.';
    
    return {
      success: true,
      message,
      data: { 
        requiresConfirmation: true, 
        actionType: 'send',
        riskLevel: analysis.overallRisk,
        ...params,
        chainId: 8453,
      },
    };
  },
};

// CHECK_APPROVALS
export const checkApprovalsAction = {
  name: 'CHECK_APPROVALS',
  description: 'Check all token approvals for potential risks',
  similes: ['approvals', 'check approvals', 'token approvals', 'spending permissions'],
  
  async execute(context: ActionContext): Promise<ActionResult> {
    const { walletAddress } = context;
    
    if (!walletAddress) {
      return { success: false, message: 'Please connect your wallet first.' };
    }

    const summary = await approvalService.getApprovals(walletAddress);
    
    if (summary.totalTokenApprovals === 0) {
      return { 
        success: true, 
        message: '**Token Approvals**\n\nNo active token approvals found. Your tokens are safe from unauthorized spending.' 
      };
    }

    let response = `**Token Approvals Summary**\n\n`;
    response += `• **Total Approvals:** ${summary.totalTokenApprovals}\n`;
    response += `• **Unlimited Approvals:** ${summary.unlimitedApprovals}\n`;
    response += `• **High Risk:** ${summary.highRiskApprovals}\n\n`;

    if (summary.highRiskApprovals > 0) {
      response += `⚠️ **High Risk Approvals:**\n`;
      for (const approval of summary.tokenApprovals.filter(a => a.riskLevel === 'high')) {
        response += `• ${approval.tokenSymbol} → ${approval.spenderName || approval.spender.slice(0, 10)}... (Unlimited)\n`;
      }
      response += `\nConsider revoking these approvals for better security.`;
    }

    return { success: true, message: response };
  },
};

// GET_HISTORY
export const getHistoryAction = {
  name: 'GET_HISTORY',
  description: 'Show recent transaction history',
  similes: ['history', 'transactions', 'recent activity', 'past transactions'],
  
  async execute(context: ActionContext): Promise<ActionResult> {
    const { walletAddress } = context;
    
    if (!walletAddress) {
      return { success: false, message: 'Please connect your wallet first.' };
    }

    const transactions = await historyService.getHistory(walletAddress, { limit: 10 });
    
    if (transactions.length === 0) {
      return { success: true, message: '**Transaction History**\n\nNo transactions found.' };
    }

    let response = '**Recent Transactions**\n\n';
    
    for (const tx of transactions) {
      const formatted = historyService.formatTransaction(tx, walletAddress);
      const chain = SUPPORTED_CHAINS[tx.chainId];
      const date = new Date(tx.timestamp * 1000).toLocaleDateString();
      
      response += `• **${formatted.title}** - ${formatted.amount} (${chain.name})\n`;
      response += `  ${formatted.subtitle} • ${date}\n\n`;
    }

    return { success: true, message: response };
  },
};

// GET_GAS_PRICE
export const getGasPriceAction = {
  name: 'GET_GAS_PRICE',
  description: 'Show current gas prices across chains',
  similes: ['gas', 'gas price', 'gas fees', 'how much is gas'],
  
  async execute(context: ActionContext): Promise<ActionResult> {
    const chainIds = Object.keys(SUPPORTED_CHAINS).map(Number) as SupportedChainId[];
    const gasPrices = await Promise.all(chainIds.map(id => oracleService.getGasPrice(id)));

    let response = '**Current Gas Prices**\n\n';
    
    for (let i = 0; i < chainIds.length; i++) {
      const chain = SUPPORTED_CHAINS[chainIds[i]];
      const gas = gasPrices[i];
      response += `**${chain.name}:**\n`;
      response += `• Slow: ${gas.slow.gwei} gwei (~${gas.slow.estimatedTime}s)\n`;
      response += `• Standard: ${gas.standard.gwei} gwei (~${gas.standard.estimatedTime}s)\n`;
      response += `• Fast: ${gas.fast.gwei} gwei (~${gas.fast.estimatedTime}s)\n\n`;
    }

    return { success: true, message: response };
  },
};

// CREATE_SMART_ACCOUNT
export const createSmartAccountAction = {
  name: 'CREATE_SMART_ACCOUNT',
  description: 'Create a smart account for gasless transactions',
  similes: ['smart account', 'create account', 'gasless', 'account abstraction'],
  
  async execute(context: ActionContext): Promise<ActionResult> {
    const { walletAddress } = context;
    
    if (!walletAddress) {
      return { success: false, message: 'Please connect your wallet first.' };
    }

    const smartAccount = await aaService.createSmartAccount(walletAddress, 8453);

    return {
      success: true,
      message: `**Smart Account Created**\n\n` +
        `• **Address:** \`${smartAccount.address}\`\n` +
        `• **Owner:** \`${smartAccount.owner.slice(0, 6)}...${smartAccount.owner.slice(-4)}\`\n` +
        `• **Status:** ${smartAccount.isDeployed ? 'Deployed' : 'Ready (deploys on first use)'}\n\n` +
        `**Features:**\n` +
        `• Gas sponsorship available\n` +
        `• Pay gas in any token\n` +
        `• Batch multiple transactions\n` +
        `• Social recovery (coming soon)`,
    };
  },
};

// HELP
export const helpAction = {
  name: 'HELP',
  description: 'Show available wallet commands and features',
  similes: ['help', 'commands', 'what can you do', 'features'],
  
  async execute(): Promise<ActionResult> {
    return {
      success: true,
      message: `**Jeju Wallet - Available Commands**\n\n` +
        `**Portfolio & Balances:**\n` +
        `• "Show my portfolio" - View all balances across chains\n\n` +
        `**Trading:**\n` +
        `• "Swap 0.1 ETH for USDC" - Swap tokens\n\n` +
        `**Transfers:**\n` +
        `• "Send 0.1 ETH to 0x..." - Send tokens\n\n` +
        `**Security:**\n` +
        `• "Check my approvals" - Review token approvals\n\n` +
        `**History:**\n` +
        `• "Show my transactions" - View recent history\n\n` +
        `**Advanced:**\n` +
        `• "Create smart account" - Enable gasless transactions\n` +
        `• "What's the gas price?" - Check current gas\n\n` +
        `All transactions require your confirmation before execution.`,
    };
  },
};

// Export all actions
export const walletActions = [
  getPortfolioAction,
  swapTokensAction,
  sendTokenAction,
  checkApprovalsAction,
  getHistoryAction,
  getGasPriceAction,
  createSmartAccountAction,
  helpAction,
];

// Action dispatcher
export async function dispatchAction(
  actionName: string, 
  context: ActionContext, 
  text: string
): Promise<ActionResult> {
  const action = walletActions.find(a => 
    a.name === actionName || 
    a.similes.some(s => text.toLowerCase().includes(s.toLowerCase()))
  );
  
  if (!action) {
    return { success: false, message: 'Unknown action. Type "help" for available commands.' };
  }
  
  const params = 'parseParams' in action ? action.parseParams(text) : {};
  return action.execute(context, params);
}
