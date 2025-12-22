/**
 * Wallet Events
 *
 * Event handlers for wallet-related events like transaction confirmations,
 * intent status changes, and security alerts.
 */

import type { EventPayload } from '@elizaos/core'

// Custom event types for wallet
interface TransactionConfirmedPayload extends EventPayload {
  txHash: string
  chainId: number
  status: 'confirmed' | 'failed'
  confirmations?: number
}

interface IntentStatusPayload extends EventPayload {
  intentId: string
  status: string
  outputAmount?: string
  solver?: string
}

interface SignatureRequestPayload extends EventPayload {
  requestId: string
  type: 'message' | 'typed-data' | 'transaction'
  origin?: string
  riskLevel?: string
}

/**
 * Handle transaction confirmation events
 */
const handleTransactionConfirmed = async (
  payload: TransactionConfirmedPayload,
) => {
  const {
    runtime,
    txHash,
    chainId,
    status,
    confirmations: _confirmations,
  } = payload

  runtime.logger.info(
    `[WalletEvents] Transaction ${txHash} ${status} on chain ${chainId}`,
  )

  // Would emit to frontend via WebSocket
  // messageBusService.notifyTransactionUpdate(...)
}

/**
 * Handle intent status changes
 */
const handleIntentStatusChanged = async (payload: IntentStatusPayload) => {
  const { runtime, intentId, status, outputAmount, solver } = payload

  runtime.logger.info(`[WalletEvents] Intent ${intentId} status: ${status}`)

  if (status === 'filled') {
    runtime.logger.info(
      `[WalletEvents] Intent filled by ${solver} for ${outputAmount}`,
    )
  }
}

/**
 * Handle signature requests from dApps
 */
const handleSignatureRequest = async (payload: SignatureRequestPayload) => {
  const { runtime, requestId, type: _type, origin, riskLevel } = payload

  runtime.logger.info(
    `[WalletEvents] Signature request ${requestId} from ${origin} (risk: ${riskLevel})`,
  )

  // Would route to chat for user review
}

// Custom event handler type
type EventHandler = (payload: EventPayload) => Promise<void>

/**
 * Wallet plugin events
 */
export const events: Record<string, EventHandler[]> = {
  // Transaction events
  TRANSACTION_CONFIRMED: [
    async (payload: EventPayload) => {
      await handleTransactionConfirmed(payload as TransactionConfirmedPayload)
    },
  ],

  TRANSACTION_FAILED: [
    async (payload: EventPayload) => {
      const { runtime } = payload
      const txPayload = payload as TransactionConfirmedPayload
      runtime.logger.warn(
        `[WalletEvents] Transaction ${txPayload.txHash} failed`,
      )
    },
  ],

  // Intent events
  INTENT_STATUS_CHANGED: [
    async (payload: EventPayload) => {
      await handleIntentStatusChanged(payload as IntentStatusPayload)
    },
  ],

  // Signature events
  SIGNATURE_REQUESTED: [
    async (payload: EventPayload) => {
      await handleSignatureRequest(payload as SignatureRequestPayload)
    },
  ],

  // Balance update events
  BALANCE_UPDATED: [
    async (payload: EventPayload) => {
      const { runtime } = payload
      runtime.logger.debug('[WalletEvents] Balance updated')
    },
  ],

  // Security events
  SECURITY_ALERT: [
    async (payload: EventPayload) => {
      const { runtime } = payload
      runtime.logger.warn('[WalletEvents] Security alert triggered')
    },
  ],
}

export default events
