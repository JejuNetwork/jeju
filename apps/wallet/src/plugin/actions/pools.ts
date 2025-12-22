/**
 * Pool Management Actions
 * Add/remove liquidity from XLP pools
 */

import { type Address, formatUnits } from 'viem'
import { poolsService } from '../../services'
import type { ActionContext, ActionResult } from './wallet-info'

export const addLiquidityAction = {
  name: 'ADD_LIQUIDITY',
  description: 'Add liquidity to a token pair pool',
  similes: ['ADD_LP', 'PROVIDE_LIQUIDITY', 'DEPOSIT_POOL'],

  async execute(
    context: ActionContext,
    _params?: { tokenA?: string; tokenB?: string; amountA?: string },
  ): Promise<ActionResult> {
    const state = context.walletService.getState()
    if (!state.currentAccount) {
      return { success: false, message: 'Please connect your wallet first.' }
    }

    return {
      success: true,
      message: `**Add Liquidity**\n\nTo add liquidity, specify:\n- Token pair (e.g., ETH/USDC)\n- Amount of first token\n\nExample: "Add liquidity to ETH/USDC with 0.5 ETH"`,
    }
  },
}

export const removeLiquidityAction = {
  name: 'REMOVE_LIQUIDITY',
  description: 'Remove liquidity from a pool',
  similes: ['REMOVE_LP', 'WITHDRAW_LIQUIDITY', 'EXIT_POOL'],

  async execute(context: ActionContext): Promise<ActionResult> {
    const state = context.walletService.getState()
    if (!state.currentAccount) {
      return { success: false, message: 'Please connect your wallet first.' }
    }

    return {
      success: true,
      message: `**Remove Liquidity**\n\nTo remove liquidity, specify the pool and percentage:\n\nExample: "Remove 50% of my ETH/USDC liquidity"`,
    }
  },
}

export const viewPositionsAction = {
  name: 'VIEW_POOL_POSITIONS',
  description: 'View all liquidity pool positions',
  similes: ['MY_POOLS', 'LP_POSITIONS', 'SHOW_LIQUIDITY'],

  async execute(context: ActionContext): Promise<ActionResult> {
    const state = context.walletService.getState()
    if (!state.currentAccount) {
      return { success: false, message: 'Please connect your wallet first.' }
    }

    context.logger.info('[Pools] Fetching positions')
    const address = state.currentAccount.address as Address

    const [v2Positions, v3Positions] = await Promise.all([
      poolsService.getAllV2Positions(address),
      poolsService.getAllV3Positions(address),
    ])

    if (v2Positions.length === 0 && v3Positions.length === 0) {
      return {
        success: true,
        message:
          'You don\'t have any active liquidity positions.\n\nSay "Add liquidity" to provide liquidity to a pool.',
      }
    }

    let response = '**Your Liquidity Positions**\n\n'

    if (v2Positions.length > 0) {
      response += '**V2 Pools**\n'
      for (const pos of v2Positions) {
        response += `- Pool: ${pos.pool.token0.slice(0, 8)}.../${pos.pool.token1.slice(0, 8)}...\n`
        response += `  Share: ${pos.share.toFixed(4)}%\n`
        response += `  LP Tokens: ${formatUnits(pos.lpBalance, 18)}\n\n`
      }
    }

    if (v3Positions.length > 0) {
      response += '**V3 Positions**\n'
      for (const pos of v3Positions) {
        response += `- Position #${pos.tokenId}\n`
        response += `  Range: ${pos.tickLower} to ${pos.tickUpper}\n`
        response += `  Liquidity: ${formatUnits(pos.liquidity, 18)}\n`
        if (pos.tokensOwed0 > 0n || pos.tokensOwed1 > 0n) {
          response += `  Uncollected Fees: ${formatUnits(pos.tokensOwed0, 18)} / ${formatUnits(pos.tokensOwed1, 18)}\n`
        }
        response += '\n'
      }
    }

    return { success: true, message: response }
  },
}

export const collectFeesAction = {
  name: 'COLLECT_POOL_FEES',
  description: 'Collect accumulated fees from V3 positions',
  similes: ['COLLECT_FEES', 'CLAIM_REWARDS', 'HARVEST_FEES'],

  async execute(context: ActionContext): Promise<ActionResult> {
    const state = context.walletService.getState()
    if (!state.currentAccount) {
      return { success: false, message: 'Please connect your wallet first.' }
    }

    const v3Positions = await poolsService.getAllV3Positions(
      state.currentAccount.address as Address,
    )
    const positionsWithFees = v3Positions.filter(
      (p) => p.tokensOwed0 > 0n || p.tokensOwed1 > 0n,
    )

    if (positionsWithFees.length === 0) {
      return {
        success: true,
        message: 'No uncollected fees found in your V3 positions.',
      }
    }

    let response = `**Uncollected Fees Found**\n\n`
    for (const pos of positionsWithFees) {
      response += `Position #${pos.tokenId}:\n`
      response += `- Token0: ${formatUnits(pos.tokensOwed0, 18)}\n`
      response += `- Token1: ${formatUnits(pos.tokensOwed1, 18)}\n\n`
    }
    response += 'Confirm to collect all fees.'

    return {
      success: true,
      message: response,
      data: {
        requiresConfirmation: true,
        action: 'collectFees',
        positions: positionsWithFees.map((p) => p.tokenId.toString()),
      },
    }
  },
}
