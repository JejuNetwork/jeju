/**
 * Wallet Info Action
 *
 * Retrieves and displays wallet information including balances, NFTs, and activity.
 */

import type { Address } from 'viem'
import type { WalletService } from '../services/wallet.service'

// Logger interface for action context
interface ActionLogger {
  info: (msg: string, data?: Record<string, string | number | boolean>) => void
  warn: (msg: string, data?: Record<string, string | number | boolean>) => void
}

export interface ActionContext {
  walletService: WalletService
  logger: ActionLogger
}

// Action result data - flexible object with primitive and nested values
// This allows different actions to return different data shapes
type ActionPrimitive = string | number | boolean | null | undefined
type ActionResultValue =
  | ActionPrimitive
  | ActionPrimitive[]
  | { to?: Address; data?: string; [key: string]: ActionPrimitive }
type ActionResultData = Record<string, ActionResultValue>

export interface ActionResult {
  success: boolean
  message: string
  data?: ActionResultData
}

export const walletInfoAction = {
  name: 'GET_WALLET_INFO',
  description:
    'Get wallet information including address, balances, and account details',
  similes: [
    'SHOW_WALLET',
    'WALLET_STATUS',
    'MY_WALLET',
    'CHECK_BALANCE',
    'VIEW_PORTFOLIO',
  ],

  async execute(context: ActionContext): Promise<ActionResult> {
    context.logger.info('[WalletInfo] Getting wallet information')

    const { walletService } = context

    if (!walletService) {
      return { success: false, message: 'Wallet service is not available' }
    }

    const state = walletService.getState()

    if (!state.isInitialized) {
      return {
        success: true,
        message: 'No wallet connected. Would you like to create or import one?',
      }
    }

    if (state.isLocked) {
      return {
        success: true,
        message: 'Wallet is locked. Please unlock to view details.',
      }
    }

    const account = state.currentAccount
    if (!account) {
      return { success: true, message: 'No account selected.' }
    }

    // Get balances
    let balanceInfo = ''
    try {
      const balances = await walletService.getBalances()
      if (balances.length > 0) {
        balanceInfo = '\n\nToken Balances:'
        for (const b of balances) {
          const value = b.valueUsd ? ` (~$${b.valueUsd.toFixed(2)})` : ''
          balanceInfo += `\n• ${b.balanceFormatted} ${b.token.symbol}${value}`
        }
      } else {
        balanceInfo = '\n\nNo token balances found.'
      }
    } catch (_error) {
      context.logger.warn('[WalletInfo] Failed to fetch balances')
      balanceInfo = '\n\nUnable to fetch balances.'
    }

    const message = `**Wallet Information**

**Address:** \`${account.address}\`
**Account:** ${account.name} (${account.type})
**Active Chain:** ${state.activeChainId}
**View Mode:** ${state.viewMode}
${balanceInfo}`

    return {
      success: true,
      message,
      data: { address: account.address, chainId: state.activeChainId },
    }
  },
}

export default walletInfoAction
