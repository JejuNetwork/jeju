/**
 * Otto Command Handler
 * Parses and executes user commands
 */

import type { Address } from 'viem';
import type {
  PlatformMessage,
  ParsedCommand,
  CommandResult,
  CommandName,
  MessageEmbed,
  OttoUser,
} from '../types';
import { OTTO_COMMANDS, getChainId, getChainName, SUPPORTED_CHAINS, DEFAULT_CHAIN_ID } from '../config';
import { getTradingService } from '../services/trading';
import { getWalletService } from '../services/wallet';

const tradingService = getTradingService();
const walletService = getWalletService();

export class CommandHandler {
  /**
   * Parse a message into a command
   */
  parseCommand(message: PlatformMessage): ParsedCommand | null {
    const content = message.content.trim().toLowerCase();
    
    // Extract command and args
    const parts = content.split(/\s+/);
    const commandStr = parts[0];
    const args = parts.slice(1);
    
    // Match command
    const command = this.matchCommand(commandStr);
    if (!command) return null;

    return {
      command,
      args,
      rawArgs: parts.slice(1).join(' '),
      platform: message.platform,
      userId: message.userId,
      channelId: message.channelId,
    };
  }

  private matchCommand(input: string): CommandName | null {
    const normalized = input.toLowerCase().replace(/^\//, '');
    
    const commandMap: Record<string, CommandName> = {
      help: 'help',
      h: 'help',
      '?': 'help',
      balance: 'balance',
      bal: 'balance',
      b: 'balance',
      price: 'price',
      p: 'price',
      swap: 'swap',
      s: 'swap',
      trade: 'swap',
      bridge: 'bridge',
      br: 'bridge',
      send: 'send',
      transfer: 'send',
      launch: 'launch',
      create: 'launch',
      deploy: 'launch',
      portfolio: 'portfolio',
      port: 'portfolio',
      pf: 'portfolio',
      limit: 'limit',
      orders: 'orders',
      cancel: 'cancel',
      connect: 'connect',
      link: 'connect',
      disconnect: 'disconnect',
      unlink: 'disconnect',
      settings: 'settings',
      config: 'settings',
    };

    return commandMap[normalized] ?? null;
  }

  /**
   * Execute a parsed command
   */
  async execute(command: ParsedCommand): Promise<CommandResult> {
    const user = walletService.getUserByPlatform(command.platform, command.userId);

    switch (command.command) {
      case 'help':
        return this.handleHelp(command.args);
      
      case 'connect':
        return this.handleConnect(command);
      
      case 'disconnect':
        return this.handleDisconnect(command, user);
      
      // Commands that require wallet connection
      case 'balance':
      case 'price':
      case 'swap':
      case 'bridge':
      case 'send':
      case 'launch':
      case 'portfolio':
      case 'limit':
      case 'orders':
      case 'cancel':
      case 'settings':
        if (!user) {
          return {
            success: false,
            message: '🔗 You need to connect your wallet first.\n\nUse `/otto connect` to link your wallet.',
          };
        }
        return this.executeAuthenticatedCommand(command, user);
      
      default:
        return {
          success: false,
          message: `Unknown command. Use \`/otto help\` to see available commands.`,
        };
    }
  }

  private async executeAuthenticatedCommand(command: ParsedCommand, user: OttoUser): Promise<CommandResult> {
    switch (command.command) {
      case 'balance':
        return this.handleBalance(command, user);
      case 'price':
        return this.handlePrice(command);
      case 'swap':
        return this.handleSwap(command, user);
      case 'bridge':
        return this.handleBridge(command, user);
      case 'send':
        return this.handleSend(command, user);
      case 'launch':
        return this.handleLaunch(command, user);
      case 'portfolio':
        return this.handlePortfolio(command, user);
      case 'limit':
        return this.handleLimit(command, user);
      case 'orders':
        return this.handleOrders(command, user);
      case 'cancel':
        return this.handleCancel(command, user);
      case 'settings':
        return this.handleSettings(command, user);
      default:
        return { success: false, message: 'Unknown command' };
    }
  }

  // ============================================================================
  // Command Handlers
  // ============================================================================

  private handleHelp(args: string[]): CommandResult {
    if (args.length > 0) {
      const cmdName = args[0].toLowerCase() as keyof typeof OTTO_COMMANDS;
      const cmd = OTTO_COMMANDS[cmdName];
      if (cmd) {
        return {
          success: true,
          message: `**${cmdName}**\n\n${cmd.description}\n\n**Usage:** \`${cmd.usage}\`\n\n**Examples:**\n${cmd.examples.map(e => `• \`${e}\``).join('\n')}`,
        };
      }
    }

    const commandList = Object.entries(OTTO_COMMANDS)
      .map(([name, cmd]) => `• **${name}** - ${cmd.description}`)
      .join('\n');

    return {
      success: true,
      message: `🤖 **Otto Trading Assistant**\n\nI can help you trade, bridge, and launch tokens across multiple chains.\n\n**Commands:**\n${commandList}\n\nUse \`/otto help <command>\` for more details.`,
      embed: {
        title: '🤖 Otto Commands',
        description: 'Your AI trading assistant',
        color: 0x00d4ff,
        fields: [
          { name: '💰 Trading', value: '`swap`, `bridge`, `send`', inline: true },
          { name: '📊 Info', value: '`balance`, `price`, `portfolio`', inline: true },
          { name: '🚀 Launch', value: '`launch`, `limit`, `orders`', inline: true },
        ],
        footer: 'Use /otto help <command> for details',
      },
    };
  }

  private async handleConnect(command: ParsedCommand): Promise<CommandResult> {
    const url = await walletService.generateConnectUrl(
      command.platform,
      command.userId,
      command.userId // We'd get the actual username from the platform
    );

    return {
      success: true,
      message: `🔗 **Connect Your Wallet**\n\nClick the link below to connect your wallet to Otto:\n\n${url}\n\nThis will allow you to trade directly from Discord/Telegram/WhatsApp.`,
      buttons: [
        { label: 'Connect Wallet', style: 'link', url },
      ],
    };
  }

  private async handleDisconnect(command: ParsedCommand, user: OttoUser | null): Promise<CommandResult> {
    if (!user) {
      return { success: false, message: 'No wallet connected.' };
    }

    await walletService.disconnect(user.id, command.platform, command.userId);
    
    return {
      success: true,
      message: '✅ Wallet disconnected successfully.',
    };
  }

  private async handleBalance(command: ParsedCommand, user: OttoUser): Promise<CommandResult> {
    const [tokenArg, chainArg] = command.args;
    
    const chainId = chainArg ? getChainId(chainArg) : undefined;
    const balances = await tradingService.getBalances(user.primaryWallet, chainId ?? undefined);

    if (balances.length === 0) {
      return {
        success: true,
        message: '💰 No tokens found in your wallet.',
      };
    }

    // Filter by token if specified
    const filtered = tokenArg
      ? balances.filter(b => b.token.symbol.toLowerCase() === tokenArg.toLowerCase())
      : balances;

    if (filtered.length === 0) {
      return {
        success: true,
        message: `No ${tokenArg} found in your wallet.`,
      };
    }

    const fields = filtered.slice(0, 10).map(b => ({
      name: `${b.token.symbol} (${getChainName(b.token.chainId)})`,
      value: `${tradingService.formatAmount(b.balance, b.token.decimals)} ${b.balanceUsd ? `(${tradingService.formatUsd(b.balanceUsd)})` : ''}`,
      inline: true,
    }));

    const totalUsd = filtered.reduce((sum, b) => sum + (b.balanceUsd ?? 0), 0);

    return {
      success: true,
      message: `💰 **Your Balances**\n\nTotal: ${tradingService.formatUsd(totalUsd)}`,
      embed: {
        title: '💰 Wallet Balance',
        color: 0x00ff88,
        fields,
        footer: filtered.length > 10 ? `Showing 10 of ${filtered.length} tokens` : undefined,
      },
    };
  }

  private async handlePrice(command: ParsedCommand): Promise<CommandResult> {
    const [tokenArg, chainArg] = command.args;
    
    if (!tokenArg) {
      return { success: false, message: 'Please specify a token. Example: `/otto price ETH`' };
    }

    const chainId = chainArg ? getChainId(chainArg) : DEFAULT_CHAIN_ID;
    const token = await tradingService.getTokenInfo(tokenArg, chainId ?? DEFAULT_CHAIN_ID);

    if (!token || !token.price) {
      return { success: false, message: `Could not find price for ${tokenArg}` };
    }

    const changeEmoji = token.priceChange24h && token.priceChange24h >= 0 ? '📈' : '📉';
    const changeStr = token.priceChange24h ? `${token.priceChange24h >= 0 ? '+' : ''}${token.priceChange24h.toFixed(2)}%` : '';

    return {
      success: true,
      message: `💵 **${token.symbol}** ${changeEmoji}\n\nPrice: ${tradingService.formatUsd(token.price)}\n24h Change: ${changeStr}`,
      embed: {
        title: `${token.symbol} Price`,
        description: token.name,
        color: token.priceChange24h && token.priceChange24h >= 0 ? 0x00ff88 : 0xff4444,
        fields: [
          { name: 'Price', value: tradingService.formatUsd(token.price), inline: true },
          { name: '24h Change', value: changeStr || 'N/A', inline: true },
          { name: 'Chain', value: getChainName(token.chainId), inline: true },
        ],
        thumbnailUrl: token.logoUrl,
      },
    };
  }

  private async handleSwap(command: ParsedCommand, user: OttoUser): Promise<CommandResult> {
    // Parse: swap <amount> <from> to <to> [on <chain>]
    const { rawArgs } = command;
    
    const swapMatch = rawArgs.match(/^(\d+(?:\.\d+)?)\s+(\w+)\s+(?:to|for)\s+(\w+)(?:\s+on\s+(\w+))?$/i);
    if (!swapMatch) {
      return {
        success: false,
        message: 'Invalid format. Example: `/otto swap 1 ETH to USDC` or `/otto swap 100 USDC to ETH on base`',
      };
    }

    const [, amountStr, fromSymbol, toSymbol, chainName] = swapMatch;
    const chainId = chainName ? getChainId(chainName) : user.settings.defaultChainId;

    if (!chainId) {
      return { success: false, message: `Unknown chain: ${chainName}` };
    }

    // Get token info
    const fromToken = await tradingService.getTokenInfo(fromSymbol, chainId);
    const toToken = await tradingService.getTokenInfo(toSymbol, chainId);

    if (!fromToken) return { success: false, message: `Unknown token: ${fromSymbol}` };
    if (!toToken) return { success: false, message: `Unknown token: ${toSymbol}` };

    // Get quote
    const amount = tradingService.parseAmount(amountStr, fromToken.decimals);
    const quote = await tradingService.getSwapQuote({
      userId: user.id,
      fromToken: fromToken.address,
      toToken: toToken.address,
      amount,
      chainId,
    });

    if (!quote) {
      return { success: false, message: 'Failed to get swap quote. Please try again.' };
    }

    const toAmount = tradingService.formatAmount(quote.toAmount, toToken.decimals);
    const minAmount = tradingService.formatAmount(quote.toAmountMin, toToken.decimals);

    return {
      success: true,
      message: `🔄 **Swap Quote**\n\n${amountStr} ${fromSymbol} → ${toAmount} ${toSymbol}\n\nMinimum received: ${minAmount} ${toSymbol}\nPrice impact: ${quote.priceImpact.toFixed(2)}%\nGas: ${quote.gasCostUsd ? tradingService.formatUsd(quote.gasCostUsd) : 'Estimating...'}\n\n⚠️ Reply with \`confirm\` to execute this swap.`,
      embed: {
        title: '🔄 Swap Quote',
        color: 0x00d4ff,
        fields: [
          { name: 'You Pay', value: `${amountStr} ${fromSymbol}`, inline: true },
          { name: 'You Receive', value: `~${toAmount} ${toSymbol}`, inline: true },
          { name: 'Chain', value: getChainName(chainId), inline: true },
          { name: 'Price Impact', value: `${quote.priceImpact.toFixed(2)}%`, inline: true },
          { name: 'Minimum Received', value: `${minAmount} ${toSymbol}`, inline: true },
        ],
      },
      buttons: [
        { label: 'Confirm Swap', style: 'success', customId: `swap_confirm_${quote.quoteId}` },
        { label: 'Cancel', style: 'danger', customId: 'swap_cancel' },
      ],
    };
  }

  private async handleBridge(command: ParsedCommand, user: OttoUser): Promise<CommandResult> {
    // Parse: bridge <amount> <token> from <chain> to <chain>
    const { rawArgs } = command;
    
    const bridgeMatch = rawArgs.match(/^(\d+(?:\.\d+)?)\s+(\w+)\s+from\s+(\w+)\s+to\s+(\w+)$/i);
    if (!bridgeMatch) {
      return {
        success: false,
        message: 'Invalid format. Example: `/otto bridge 1 ETH from ethereum to base`',
      };
    }

    const [, amountStr, tokenSymbol, fromChain, toChain] = bridgeMatch;
    const sourceChainId = getChainId(fromChain);
    const destChainId = getChainId(toChain);

    if (!sourceChainId) return { success: false, message: `Unknown chain: ${fromChain}` };
    if (!destChainId) return { success: false, message: `Unknown chain: ${toChain}` };

    const sourceToken = await tradingService.getTokenInfo(tokenSymbol, sourceChainId);
    const destToken = await tradingService.getTokenInfo(tokenSymbol, destChainId);

    if (!sourceToken) return { success: false, message: `${tokenSymbol} not found on ${fromChain}` };
    if (!destToken) return { success: false, message: `${tokenSymbol} not found on ${toChain}` };

    const amount = tradingService.parseAmount(amountStr, sourceToken.decimals);
    const quote = await tradingService.getBridgeQuote({
      userId: user.id,
      sourceChainId,
      destChainId,
      sourceToken: sourceToken.address,
      destToken: destToken.address,
      amount,
    });

    if (!quote) {
      return { success: false, message: 'No bridge route found. Please try different chains or amounts.' };
    }

    const outputAmount = tradingService.formatAmount(quote.outputAmount, destToken.decimals);

    return {
      success: true,
      message: `🌉 **Bridge Quote**\n\n${amountStr} ${tokenSymbol} (${fromChain}) → ${outputAmount} ${tokenSymbol} (${toChain})\n\nFee: ${quote.feeUsd ? tradingService.formatUsd(quote.feeUsd) : quote.fee}\nEstimated time: ~${Math.ceil(quote.estimatedTimeSeconds / 60)} minutes\n\n⚠️ Reply with \`confirm\` to execute this bridge.`,
      embed: {
        title: '🌉 Bridge Quote',
        color: 0x9945ff,
        fields: [
          { name: 'From', value: `${amountStr} ${tokenSymbol} on ${getChainName(sourceChainId)}`, inline: false },
          { name: 'To', value: `${outputAmount} ${tokenSymbol} on ${getChainName(destChainId)}`, inline: false },
          { name: 'Fee', value: quote.feeUsd ? tradingService.formatUsd(quote.feeUsd) : quote.fee, inline: true },
          { name: 'Time', value: `~${Math.ceil(quote.estimatedTimeSeconds / 60)} min`, inline: true },
        ],
      },
      buttons: [
        { label: 'Confirm Bridge', style: 'success', customId: `bridge_confirm_${quote.quoteId}` },
        { label: 'Cancel', style: 'danger', customId: 'bridge_cancel' },
      ],
    };
  }

  private async handleSend(command: ParsedCommand, user: OttoUser): Promise<CommandResult> {
    // Parse: send <amount> <token> to <address>
    const { rawArgs } = command;
    
    const sendMatch = rawArgs.match(/^(\d+(?:\.\d+)?)\s+(\w+)\s+to\s+(.+)$/i);
    if (!sendMatch) {
      return {
        success: false,
        message: 'Invalid format. Example: `/otto send 1 ETH to vitalik.eth`',
      };
    }

    const [, amountStr, tokenSymbol, recipientInput] = sendMatch;
    const recipient = await walletService.resolveAddress(recipientInput.trim());

    if (!recipient) {
      return { success: false, message: `Could not resolve address: ${recipientInput}` };
    }

    const token = await tradingService.getTokenInfo(tokenSymbol, user.settings.defaultChainId);
    if (!token) return { success: false, message: `Unknown token: ${tokenSymbol}` };

    const displayName = await walletService.getDisplayName(recipient);

    return {
      success: true,
      message: `💸 **Send Confirmation**\n\nSending ${amountStr} ${tokenSymbol} to ${displayName}\n\n⚠️ Reply with \`confirm\` to execute this transfer.`,
      embed: {
        title: '💸 Send Tokens',
        color: 0xffaa00,
        fields: [
          { name: 'Amount', value: `${amountStr} ${tokenSymbol}`, inline: true },
          { name: 'To', value: displayName, inline: true },
          { name: 'Chain', value: getChainName(user.settings.defaultChainId), inline: true },
        ],
      },
      buttons: [
        { label: 'Confirm Send', style: 'success', customId: `send_confirm_${token.address}_${amountStr}_${recipient}` },
        { label: 'Cancel', style: 'danger', customId: 'send_cancel' },
      ],
    };
  }

  private async handleLaunch(command: ParsedCommand, user: OttoUser): Promise<CommandResult> {
    // Parse: launch "<name>" <symbol> [supply] [liquidity]
    const { rawArgs } = command;
    
    const launchMatch = rawArgs.match(/^"([^"]+)"\s+(\w+)(?:\s+(\d+))?(?:\s+(\d+(?:\.\d+)?)\s*eth)?$/i);
    if (!launchMatch) {
      return {
        success: false,
        message: 'Invalid format. Example: `/otto launch "Moon Coin" MOON` or `/otto launch "My Token" MTK 1000000 10ETH`',
      };
    }

    const [, name, symbol, supplyStr, liquidityStr] = launchMatch;
    const supply = supplyStr ?? '1000000000'; // Default 1B
    const liquidity = liquidityStr ?? '1'; // Default 1 ETH

    return {
      success: true,
      message: `🚀 **Token Launch**\n\nName: ${name}\nSymbol: ${symbol}\nSupply: ${parseInt(supply).toLocaleString()}\nInitial Liquidity: ${liquidity} ETH\n\n⚠️ Reply with \`confirm\` to launch this token.`,
      embed: {
        title: '🚀 Launch Token',
        color: 0xff6b6b,
        fields: [
          { name: 'Name', value: name, inline: true },
          { name: 'Symbol', value: symbol, inline: true },
          { name: 'Supply', value: parseInt(supply).toLocaleString(), inline: true },
          { name: 'Liquidity', value: `${liquidity} ETH`, inline: true },
          { name: 'Chain', value: getChainName(user.settings.defaultChainId), inline: true },
        ],
      },
      buttons: [
        { label: 'Launch Token', style: 'success', customId: `launch_confirm_${name}_${symbol}_${supply}_${liquidity}` },
        { label: 'Cancel', style: 'danger', customId: 'launch_cancel' },
      ],
    };
  }

  private async handlePortfolio(command: ParsedCommand, user: OttoUser): Promise<CommandResult> {
    const chainArg = command.args[0];
    const chainId = chainArg ? getChainId(chainArg) : undefined;

    const portfolio = await tradingService.getPortfolio(user, chainId ?? undefined);

    if (portfolio.balances.length === 0) {
      return { success: true, message: '📊 Your portfolio is empty.' };
    }

    const chainFields = portfolio.chains
      .sort((a, b) => b.valueUsd - a.valueUsd)
      .slice(0, 5)
      .map(c => ({
        name: c.name,
        value: tradingService.formatUsd(c.valueUsd),
        inline: true,
      }));

    const topTokens = portfolio.balances
      .sort((a, b) => (b.balanceUsd ?? 0) - (a.balanceUsd ?? 0))
      .slice(0, 5)
      .map(b => `• ${b.token.symbol}: ${tradingService.formatUsd(b.balanceUsd ?? 0)}`)
      .join('\n');

    return {
      success: true,
      message: `📊 **Portfolio Summary**\n\nTotal Value: ${tradingService.formatUsd(portfolio.totalValueUsd)}\n\n**Top Holdings:**\n${topTokens}`,
      embed: {
        title: '📊 Portfolio',
        description: `Total Value: **${tradingService.formatUsd(portfolio.totalValueUsd)}**`,
        color: 0x00d4ff,
        fields: [
          ...chainFields,
          { name: 'Top Holdings', value: topTokens, inline: false },
        ],
      },
    };
  }

  private async handleLimit(command: ParsedCommand, user: OttoUser): Promise<CommandResult> {
    // Parse: limit <amount> <from> at <price> <to>
    const { rawArgs } = command;
    
    const limitMatch = rawArgs.match(/^(\d+(?:\.\d+)?)\s+(\w+)\s+at\s+(\d+(?:\.\d+)?)\s+(\w+)$/i);
    if (!limitMatch) {
      return {
        success: false,
        message: 'Invalid format. Example: `/otto limit 1 ETH at 4000 USDC`',
      };
    }

    const [, amountStr, fromSymbol, priceStr, toSymbol] = limitMatch;

    return {
      success: true,
      message: `📝 **Limit Order**\n\nSell ${amountStr} ${fromSymbol} when price reaches ${priceStr} ${toSymbol}/${fromSymbol}\n\n⚠️ Reply with \`confirm\` to create this order.`,
      buttons: [
        { label: 'Create Order', style: 'success', customId: `limit_confirm_${fromSymbol}_${amountStr}_${priceStr}_${toSymbol}` },
        { label: 'Cancel', style: 'danger', customId: 'limit_cancel' },
      ],
    };
  }

  private async handleOrders(command: ParsedCommand, user: OttoUser): Promise<CommandResult> {
    const orders = tradingService.getOpenOrders(user.id);

    if (orders.length === 0) {
      return { success: true, message: '📋 No open orders.' };
    }

    const orderList = orders.map(o => 
      `• \`${o.orderId.slice(0, 8)}\`: ${tradingService.formatAmount(o.fromAmount, o.fromToken.decimals)} ${o.fromToken.symbol} at ${o.targetPrice} ${o.toToken.symbol}`
    ).join('\n');

    return {
      success: true,
      message: `📋 **Open Orders**\n\n${orderList}\n\nUse \`/otto cancel <order_id>\` to cancel an order.`,
    };
  }

  private async handleCancel(command: ParsedCommand, user: OttoUser): Promise<CommandResult> {
    const orderId = command.args[0];
    
    if (!orderId) {
      return { success: false, message: 'Please specify an order ID. Use `/otto orders` to see your orders.' };
    }

    const success = await tradingService.cancelLimitOrder(orderId, user.id);
    
    if (!success) {
      return { success: false, message: 'Order not found or already filled/cancelled.' };
    }

    return { success: true, message: `✅ Order ${orderId} cancelled.` };
  }

  private async handleSettings(command: ParsedCommand, user: OttoUser): Promise<CommandResult> {
    const [key, value] = command.args;

    if (!key) {
      // Show current settings
      const settings = user.settings;
      return {
        success: true,
        message: `⚙️ **Settings**\n\n• Slippage: ${settings.defaultSlippageBps / 100}%\n• Default Chain: ${getChainName(settings.defaultChainId)}\n• Notifications: ${settings.notifications ? 'On' : 'Off'}`,
        embed: {
          title: '⚙️ Settings',
          color: 0x888888,
          fields: [
            { name: 'Slippage', value: `${settings.defaultSlippageBps / 100}%`, inline: true },
            { name: 'Default Chain', value: getChainName(settings.defaultChainId), inline: true },
            { name: 'Notifications', value: settings.notifications ? 'On' : 'Off', inline: true },
          ],
        },
      };
    }

    // Update setting
    switch (key.toLowerCase()) {
      case 'slippage':
        const slippage = parseFloat(value.replace('%', ''));
        if (isNaN(slippage) || slippage < 0 || slippage > 10) {
          return { success: false, message: 'Slippage must be between 0% and 10%' };
        }
        walletService.updateSettings(user.id, { defaultSlippageBps: Math.floor(slippage * 100) });
        return { success: true, message: `✅ Slippage set to ${slippage}%` };
      
      case 'chain':
        const chainId = getChainId(value);
        if (!chainId) {
          return { success: false, message: `Unknown chain: ${value}` };
        }
        walletService.updateSettings(user.id, { defaultChainId: chainId });
        return { success: true, message: `✅ Default chain set to ${getChainName(chainId)}` };
      
      case 'notifications':
        const enabled = value.toLowerCase() === 'on' || value === 'true' || value === '1';
        walletService.updateSettings(user.id, { notifications: enabled });
        return { success: true, message: `✅ Notifications ${enabled ? 'enabled' : 'disabled'}` };
      
      default:
        return { success: false, message: `Unknown setting: ${key}` };
    }
  }
}

export const commandHandler = new CommandHandler();

