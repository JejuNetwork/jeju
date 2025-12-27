/**
 * API Client Factory
 */

import { getCoreAppUrl } from '@jejunetwork/config'
import { expectValid } from '@jejunetwork/types'
import { z } from 'zod'
import { getRequiredEnv } from '../utils/validation'

const getGatewayBaseUrl = () =>
  getRequiredEnv('GATEWAY_API_URL', getCoreAppUrl('GATEWAY'))

const IntentQuoteResponseSchema = z.array(
  z.object({
    quoteId: z.string(),
    sourceChain: z.number(),
    destinationChain: z.number(),
    sourceToken: z.string(),
    destinationToken: z.string(),
    inputAmount: z.string(),
    outputAmount: z.string(),
    fee: z.string(),
    validUntil: z.number(),
  }),
)

const IntentCreateResponseSchema = z.object({
  intentId: z.string(),
  sourceTxHash: z.string().optional(),
  status: z.string(),
})

const IntentStatusResponseSchema = z.object({
  intentId: z.string(),
  status: z.enum(['open', 'pending', 'filled', 'expired', 'cancelled']),
  sourceChain: z.number(),
  destinationChain: z.number(),
  sourceTxHash: z.string().optional(),
  destinationTxHash: z.string().optional(),
})

export const gatewayApi = {
  intents: {
    async quote(body: {
      sourceChain: number
      destinationChain: number
      sourceToken: string
      destinationToken: string
      amount: string
    }) {
      const response = await fetch(`${getGatewayBaseUrl()}/api/intents/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) return { error: await response.text(), data: null }
      return {
        error: null,
        data: expectValid(
          IntentQuoteResponseSchema,
          await response.json(),
          'intent quote response',
        ),
      }
    },

    async create(
      body: {
        quoteId: string
        sourceChain: number
        destinationChain: number
        sourceToken: string
        destinationToken: string
        amount: string
        recipient: string
        maxSlippageBps: number
      },
      options?: { headers?: Record<string, string> },
    ) {
      const response = await fetch(`${getGatewayBaseUrl()}/api/intents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
        body: JSON.stringify(body),
      })
      if (!response.ok) return { error: await response.text(), data: null }
      return {
        error: null,
        data: expectValid(
          IntentCreateResponseSchema,
          await response.json(),
          'intent create response',
        ),
      }
    },

    async getStatus(intentId: string) {
      const response = await fetch(
        `${getGatewayBaseUrl()}/api/intents/${intentId}`,
      )
      if (!response.ok) return { error: await response.text(), data: null }
      return {
        error: null,
        data: expectValid(
          IntentStatusResponseSchema,
          await response.json(),
          'intent status response',
        ),
      }
    },
  },
}
