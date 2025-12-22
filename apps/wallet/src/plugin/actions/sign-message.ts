/**
 * Sign Message Action
 *
 * Signs messages or typed data with security analysis.
 */

import { expectNonEmpty } from '../../lib/validation'
import type { SecurityService } from '../services/security.service'
import type { ActionContext, ActionResult } from './wallet-info'

interface SignParams {
  message?: string
}

export const signMessageAction = {
  name: 'SIGN_MESSAGE',
  description: 'Sign a message or typed data with the wallet',
  similes: ['SIGN', 'SIGNATURE', 'APPROVE_SIGNATURE'],

  parseParams(text: string): SignParams {
    // Extract message content after "sign" keyword
    const match = text.match(/sign[:\s]+(.+)/i)
    return { message: match?.[1] || text }
  },

  async execute(
    context: ActionContext & { securityService?: SecurityService },
    params: SignParams,
  ): Promise<ActionResult> {
    context.logger.info('[SignMessage] Processing signature request')

    const { walletService, securityService } = context

    if (!walletService) {
      return { success: false, message: 'Wallet service not available' }
    }

    const state = walletService.getState()
    if (state.isLocked || !state.currentAccount) {
      return { success: false, message: 'Please unlock your wallet first' }
    }

    const messageText = params.message || ''
    expectNonEmpty(messageText, 'message')

    // Security analysis
    if (securityService) {
      const analysis = await securityService.analyzeSignature({
        message: messageText,
        signerAddress: state.currentAccount.address,
      })

      if (analysis.riskLevel === 'critical' || analysis.riskLevel === 'high') {
        return {
          success: true,
          message: `⚠️ **Security Warning**

${analysis.summary}

Risk Level: ${analysis.riskLevel.toUpperCase()}

Please review carefully before signing.`,
          data: { requiresConfirmation: true, riskLevel: analysis.riskLevel },
        }
      }
    }

    return {
      success: true,
      message: `**Signature Request**

Message to sign: "${messageText.slice(0, 100)}${messageText.length > 100 ? '...' : ''}"
Signer: ${state.currentAccount.address.slice(0, 6)}...${state.currentAccount.address.slice(-4)}

Please confirm to sign.`,
      data: { requiresConfirmation: true, message: messageText },
    }
  },
}

export default signMessageAction
