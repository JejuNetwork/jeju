/**
 * Perpetual Trading Actions
 * Open/close positions, manage margin
 */

import { type Address, formatUnits } from 'viem'
import { MARKET_IDS, PositionSide, perpsService } from '../../services'
import type { ActionContext, ActionResult } from './wallet-info'

export const openPerpPositionAction = {
  name: 'OPEN_PERP_POSITION',
  description: 'Open a perpetual futures position (long or short)',
  similes: ['LONG', 'SHORT', 'OPEN_PERP', 'LEVERAGE_TRADE'],

  async execute(
    context: ActionContext,
    params?: { market?: string; side?: 'long' | 'short'; leverage?: number },
  ): Promise<ActionResult> {
    const state = context.walletService.getState()
    if (!state.currentAccount) {
      return { success: false, message: 'Please connect your wallet first.' }
    }

    if (!params?.side) {
      return {
        success: true,
        message: `**Open Perp Position**\n\nSpecify long or short:\n- "Long BTC 5x with 0.1 ETH"\n- "Short ETH 10x with 500 USDC"`,
      }
    }

    const marketSymbol = params.market?.toUpperCase().includes('BTC')
      ? 'BTC-PERP'
      : 'ETH-PERP'
    const marketId = MARKET_IDS[marketSymbol as keyof typeof MARKET_IDS]
    const market = await perpsService.getMarket(marketId)

    if (!market) {
      return {
        success: false,
        message: `Perp market ${marketSymbol} is not available on this network.`,
      }
    }

    const leverage = params.leverage || 5
    if (leverage > market.maxLeverage) {
      return {
        success: false,
        message: `Maximum leverage for ${marketSymbol} is ${market.maxLeverage}x.`,
      }
    }

    const markPrice = perpsService.formatPrice(market.markPrice || 0n)
    const fundingRate = market.fundingRate
      ? ((Number(market.fundingRate) / 1e18) * 100).toFixed(4)
      : '0'

    return {
      success: true,
      message:
        `**${params.side === 'long' ? 'Long' : 'Short'} ${marketSymbol}**\n\n` +
        `Mark Price: $${markPrice}\n` +
        `Funding Rate: ${fundingRate}%/8h\n` +
        `Leverage: ${leverage}x (Max: ${market.maxLeverage}x)\n\n` +
        `Specify margin amount:\n- "0.5 ETH margin"\n- "1000 USDC margin"`,
      data: {
        market: marketSymbol,
        marketId,
        side: params.side,
        leverage,
      },
    }
  },
}

export const closePerpPositionAction = {
  name: 'CLOSE_PERP_POSITION',
  description: 'Close a perpetual futures position',
  similes: ['CLOSE_POSITION', 'EXIT_POSITION', 'CLOSE_LONG', 'CLOSE_SHORT'],

  async execute(
    context: ActionContext,
    params?: { market?: string },
  ): Promise<ActionResult> {
    const state = context.walletService.getState()
    if (!state.currentAccount) {
      return { success: false, message: 'Please connect your wallet first.' }
    }

    const positions = await perpsService.getPositions(
      state.currentAccount.address as Address,
    )

    if (positions.length === 0) {
      return {
        success: true,
        message: "You don't have any open perpetual positions.",
      }
    }

    // Find position to close
    let position = positions[0]
    if (params?.market?.toLowerCase().includes('btc')) {
      const btcPos = positions.find((p) => p.symbol.includes('BTC'))
      if (btcPos) position = btcPos
    } else if (params?.market?.toLowerCase().includes('eth')) {
      const ethPos = positions.find((p) => p.symbol.includes('ETH'))
      if (ethPos) position = ethPos
    }

    const pnlStr =
      position.unrealizedPnl >= 0n
        ? `+$${formatUnits(position.unrealizedPnl, 18)}`
        : `-$${formatUnits(-position.unrealizedPnl, 18)}`

    return {
      success: true,
      message:
        `**Close ${position.side === PositionSide.Long ? 'Long' : 'Short'} ${position.symbol}**\n\n` +
        `Size: ${formatUnits(position.size, 8)}\n` +
        `Entry: $${perpsService.formatPrice(position.entryPrice)}\n` +
        `Mark: $${perpsService.formatPrice(position.markPrice)}\n` +
        `Unrealized PnL: ${pnlStr}\n\n` +
        `Confirm to close this position.`,
      data: {
        requiresConfirmation: true,
        action: 'closePosition',
        positionId: position.positionId,
        size: position.size.toString(),
      },
    }
  },
}

export const viewPerpPositionsAction = {
  name: 'VIEW_PERP_POSITIONS',
  description: 'View all open perpetual positions',
  similes: ['MY_PERPS', 'PERP_POSITIONS', 'SHOW_POSITIONS'],

  async execute(context: ActionContext): Promise<ActionResult> {
    const state = context.walletService.getState()
    if (!state.currentAccount) {
      return { success: false, message: 'Please connect your wallet first.' }
    }

    const positions = await perpsService.getPositions(
      state.currentAccount.address as Address,
    )

    if (positions.length === 0) {
      return {
        success: true,
        message:
          'You don\'t have any open perpetual positions.\n\nSay "Long BTC 5x" or "Short ETH 10x" to open a position.',
      }
    }

    let response = '**Your Perpetual Positions**\n\n'

    for (const pos of positions) {
      const pnlStr =
        pos.unrealizedPnl >= 0n
          ? `+$${formatUnits(pos.unrealizedPnl, 18)}`
          : `-$${formatUnits(-pos.unrealizedPnl, 18)}`

      response += `**${pos.side === PositionSide.Long ? '🟢 Long' : '🔴 Short'} ${pos.symbol}**\n`
      response += `Size: ${formatUnits(pos.size, 8)}\n`
      response += `Leverage: ${pos.leverage.toFixed(1)}x\n`
      response += `Entry: $${perpsService.formatPrice(pos.entryPrice)}\n`
      response += `Mark: $${perpsService.formatPrice(pos.markPrice)}\n`
      response += `PnL: ${pnlStr}\n`
      response += `Liq Price: $${perpsService.formatPrice(pos.liquidationPrice)}\n\n`
    }

    return { success: true, message: response }
  },
}

export const viewPerpMarketsAction = {
  name: 'VIEW_PERP_MARKETS',
  description: 'View available perpetual markets',
  similes: ['PERP_MARKETS', 'AVAILABLE_MARKETS', 'TRADING_PAIRS'],

  async execute(_context: ActionContext): Promise<ActionResult> {
    const markets = await perpsService.getMarkets()

    if (markets.length === 0) {
      return {
        success: true,
        message: 'No perpetual markets available on this network.',
      }
    }

    let response = '**Available Perpetual Markets**\n\n'

    for (const market of markets) {
      const markPrice = market.markPrice
        ? `$${perpsService.formatPrice(market.markPrice)}`
        : 'N/A'
      const fundingRate = market.fundingRate
        ? `${((Number(market.fundingRate) / 1e18) * 100).toFixed(4)}%/8h`
        : 'N/A'

      response += `**${market.symbol}**\n`
      response += `Mark Price: ${markPrice}\n`
      response += `Funding: ${fundingRate}\n`
      response += `Max Leverage: ${market.maxLeverage}x\n`
      response += `Open Interest: ${formatUnits(market.currentOpenInterest, 8)}/${formatUnits(market.maxOpenInterest, 8)}\n\n`
    }

    return { success: true, message: response }
  },
}
