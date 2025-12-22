/**
 * Launchpad Actions
 * Launch tokens, buy/sell on bonding curves
 */

import { type Address, formatUnits } from 'viem'
import { LaunchType, launchpadService } from '../../services'
import type { ActionContext, ActionResult } from './wallet-info'

export const launchTokenAction = {
  name: 'LAUNCH_TOKEN',
  description: 'Launch a new token with bonding curve or ICO presale',
  similes: ['CREATE_TOKEN', 'NEW_TOKEN', 'DEPLOY_TOKEN'],

  async execute(context: ActionContext): Promise<ActionResult> {
    const state = context.walletService.getState()
    if (!state.currentAccount) {
      return { success: false, message: 'Please connect your wallet first.' }
    }

    return {
      success: true,
      message:
        `**Launch Your Token**\n\n` +
        `**1. Bonding Curve (Pump.fun style)**\n` +
        `- Token starts at low price on a curve\n` +
        `- Price increases as more people buy\n` +
        `- Auto-graduates to AMM LP at target\n\n` +
        `**2. ICO Presale**\n` +
        `- Fixed price presale period\n` +
        `- Soft/hard cap goals\n` +
        `- LP locked after presale\n\n` +
        `Say "Launch SYMBOL with bonding curve" or "Launch SYMBOL with ICO presale"`,
    }
  },
}

export const buyOnCurveAction = {
  name: 'BUY_ON_CURVE',
  description: 'Buy tokens from a bonding curve',
  similes: ['BUY_BONDING', 'APE_INTO', 'BUY_TOKEN'],

  async execute(context: ActionContext): Promise<ActionResult> {
    const state = context.walletService.getState()
    if (!state.currentAccount) {
      return { success: false, message: 'Please connect your wallet first.' }
    }

    return {
      success: true,
      message: `**Buy from Bonding Curve**\n\nSpecify token and ETH amount:\n\nExample: "Buy 0.1 ETH of 0x1234...5678"`,
    }
  },
}

export const sellOnCurveAction = {
  name: 'SELL_ON_CURVE',
  description: 'Sell tokens back to bonding curve',
  similes: ['SELL_BONDING', 'EXIT_CURVE', 'DUMP_TOKEN'],

  async execute(context: ActionContext): Promise<ActionResult> {
    const state = context.walletService.getState()
    if (!state.currentAccount) {
      return { success: false, message: 'Please connect your wallet first.' }
    }

    return {
      success: true,
      message: `**Sell to Bonding Curve**\n\nSpecify token and amount:\n\nExample: "Sell 10000 MEME"`,
    }
  },
}

export const viewLaunchesAction = {
  name: 'VIEW_LAUNCHES',
  description: 'View recent token launches',
  similes: ['RECENT_LAUNCHES', 'NEW_TOKENS', 'TRENDING_TOKENS'],

  async execute(context: ActionContext): Promise<ActionResult> {
    context.logger.info('[Launchpad] Fetching recent launches')
    const launches = await launchpadService.getRecentLaunches(10)

    if (launches.length === 0) {
      return {
        success: true,
        message:
          'No recent token launches found.\n\nSay "Launch token" to create your own.',
      }
    }

    let response = '**Recent Token Launches**\n\n'

    for (const launch of launches) {
      const typeStr =
        launch.launchType === LaunchType.BondingCurve
          ? '📈 Bonding Curve'
          : '🎯 ICO Presale'
      const statusStr = launch.graduated ? '✅ Graduated' : '🔄 Active'

      response += `**#${launch.id}** ${statusStr}\n`
      response += `Token: \`${launch.token.slice(0, 10)}...${launch.token.slice(-6)}\`\n`
      response += `Type: ${typeStr}\n`

      if (
        launch.launchType === LaunchType.BondingCurve &&
        launch.bondingCurve !== '0x0000000000000000000000000000000000000000'
      ) {
        const curveInfo = await launchpadService.getBondingCurveInfo(
          launch.bondingCurve,
        )
        if (curveInfo) {
          response += `Progress: ${curveInfo.progress}% to graduation\n`
          response += `Price: ${formatUnits(curveInfo.currentPrice, 18)} ETH\n`
        }
      }
      response += '\n'
    }

    return { success: true, message: response }
  },
}

export const viewMyLaunchesAction = {
  name: 'VIEW_MY_LAUNCHES',
  description: 'View your created token launches',
  similes: ['MY_LAUNCHES', 'MY_TOKENS', 'CREATED_TOKENS'],

  async execute(context: ActionContext): Promise<ActionResult> {
    const state = context.walletService.getState()
    if (!state.currentAccount) {
      return { success: false, message: 'Please connect your wallet first.' }
    }

    const launches = await launchpadService.getCreatorLaunches(
      state.currentAccount.address as Address,
    )

    if (launches.length === 0) {
      return {
        success: true,
        message:
          'You haven\'t launched any tokens yet.\n\nSay "Launch token" to create your first token.',
      }
    }

    let response = '**Your Token Launches**\n\n'

    for (const launch of launches) {
      const statusStr = launch.graduated ? '✅ Graduated' : '🔄 Active'

      response += `**#${launch.id}** ${statusStr}\n`
      response += `Token: \`${launch.token}\`\n`
      response += `Creator Fee: ${launch.creatorFeeBps / 100}%\n`

      if (
        launch.launchType === LaunchType.BondingCurve &&
        launch.bondingCurve !== '0x0000000000000000000000000000000000000000'
      ) {
        const curveInfo = await launchpadService.getBondingCurveInfo(
          launch.bondingCurve,
        )
        if (curveInfo) {
          response += `ETH Raised: ${formatUnits(curveInfo.realEthReserves, 18)} ETH\n`
          response += `Progress: ${curveInfo.progress}%\n`
        }
      }
      response += '\n'
    }

    return { success: true, message: response }
  },
}

export const joinPresaleAction = {
  name: 'JOIN_PRESALE',
  description: 'Participate in a token ICO presale',
  similes: ['BUY_PRESALE', 'PARTICIPATE_ICO', 'INVEST_PRESALE'],

  async execute(context: ActionContext): Promise<ActionResult> {
    const state = context.walletService.getState()
    if (!state.currentAccount) {
      return { success: false, message: 'Please connect your wallet first.' }
    }

    return {
      success: true,
      message: `**Join Presale**\n\nSpecify presale and amount:\n\nExample: "Join presale #5 with 0.5 ETH"`,
    }
  },
}
