/**
 * Authentication Hooks
 * Shared authentication business logic
 */

import type { Address, Hex } from 'viem'
import { verifyMessage } from 'viem'
import { AuthVerifyRequestSchema, expectValid } from '../schemas'
import { getStateManager } from '../services/state'
import { getWalletService } from '../services/wallet'
import { validateNonce } from '../utils/validation'

/**
 * Generate authentication message for wallet signing
 */
export function generateAuthMessage(address: Address): {
  message: string
  nonce: string
} {
  if (!address) {
    throw new Error('Address is required for auth message')
  }

  const nonce = crypto.randomUUID()
  const message = `Sign in to Otto\nAddress: ${address}\nNonce: ${nonce}`

  return { message, nonce }
}

/**
 * Verify signature and connect wallet
 */
export async function verifyAndConnectWallet(
  address: Address,
  message: string,
  signature: Hex,
  sessionId: string,
  platform: 'web' = 'web',
): Promise<{ success: boolean; error?: string }> {
  const walletService = getWalletService()
  const stateManager = getStateManager()

  // Validate inputs
  const validated = expectValid(
    AuthVerifyRequestSchema,
    {
      address,
      message,
      signature,
      sessionId,
    },
    'auth verify request',
  )

  // Verify signature
  const valid = await verifyMessage({
    address: validated.address,
    message: validated.message,
    signature: validated.signature,
  })

  if (!valid) {
    return { success: false, error: 'Invalid signature' }
  }

  // Extract nonce from message
  const nonceMatch = validated.message.match(/Nonce: ([a-zA-Z0-9-]+)/)
  if (!nonceMatch || !nonceMatch[1]) {
    throw new Error('Nonce not found in message')
  }

  const nonce = validateNonce(nonceMatch[1])

  // Update session
  const session = stateManager.getSession(validated.sessionId)
  if (session) {
    stateManager.updateSession(validated.sessionId, {
      userId: validated.address,
      walletAddress: validated.address,
    })
  }

  // Connect wallet
  await walletService.verifyAndConnect(
    platform,
    validated.sessionId,
    validated.address,
    validated.address,
    validated.signature,
    nonce,
  )

  return { success: true }
}
