/**
 * Shared Parsing Utilities
 * Common parsing logic for commands and parameters
 */

import { z } from 'zod'

export const SwapParamsParseSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d+)?$/),
  from: z.string().min(1).max(20),
  to: z.string().min(1).max(20),
  chain: z.string().min(1).max(20).optional(),
})

export const BridgeParamsParseSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d+)?$/),
  token: z.string().min(1).max(20),
  fromChain: z.string().min(1).max(20),
  toChain: z.string().min(1).max(20),
})

export const LimitOrderParamsParseSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d+)?$/),
  from: z.string().min(1).max(20),
  to: z.string().min(1).max(20),
  price: z.string().regex(/^\d+(\.\d+)?$/),
})

export interface ParsedSwapParams {
  amount?: string
  from?: string
  to?: string
  chain?: string
}

export interface ParsedBridgeParams {
  amount?: string
  token?: string
  fromChain?: string
  toChain?: string
}

export interface ParsedLimitOrderParams {
  amount?: string
  from?: string
  to?: string
  price?: string
}

export function parseSwapParams(text: string): ParsedSwapParams {
  if (!text || typeof text !== 'string') {
    return {}
  }

  const result: ParsedSwapParams = {}

  const swapMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(\w+)\s+(?:to|for|into)\s+(\w+)/i,
  )
  if (swapMatch?.[1] && swapMatch[2] && swapMatch[3]) {
    result.amount = swapMatch[1]
    result.from = swapMatch[2].toUpperCase()
    result.to = swapMatch[3].toUpperCase()
  }

  const chainMatch = text.match(/\bon\s+(\w+)/i)
  if (chainMatch?.[1]) {
    result.chain = chainMatch[1].toLowerCase()
  }

  return result
}

export function parseBridgeParams(text: string): ParsedBridgeParams {
  if (!text || typeof text !== 'string') {
    return {}
  }

  const result: ParsedBridgeParams = {}

  const bridgeMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(\w+)\s+from\s+(\w+)\s+to\s+(\w+)/i,
  )
  if (bridgeMatch?.[1] && bridgeMatch[2] && bridgeMatch[3] && bridgeMatch[4]) {
    result.amount = bridgeMatch[1]
    result.token = bridgeMatch[2].toUpperCase()
    result.fromChain = bridgeMatch[3].toLowerCase()
    result.toChain = bridgeMatch[4].toLowerCase()
  }

  return result
}

export function parseLimitOrderParams(text: string): ParsedLimitOrderParams {
  if (!text || typeof text !== 'string') {
    return {}
  }

  const result: ParsedLimitOrderParams = {}

  const limitMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(\w+)\s+at\s+(\d+(?:\.\d+)?)\s*(\w+)/i,
  )
  if (limitMatch?.[1] && limitMatch[2] && limitMatch[3] && limitMatch[4]) {
    result.amount = limitMatch[1]
    result.from = limitMatch[2].toUpperCase()
    result.price = limitMatch[3]
    result.to = limitMatch[4].toUpperCase()
  }

  return result
}

export function validateSwapParams(params: ParsedSwapParams): {
  valid: boolean
  error?: string
} {
  if (!params.amount || !params.from || !params.to) {
    return {
      valid: false,
      error: 'Swap requires amount, from token, and to token',
    }
  }

  const result = SwapParamsParseSchema.safeParse(params)
  if (!result.success) {
    const errors = result.error.issues
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join(', ')
    return { valid: false, error: errors }
  }

  return { valid: true }
}

export function validateBridgeParams(params: ParsedBridgeParams): {
  valid: boolean
  error?: string
} {
  if (!params.amount || !params.token || !params.fromChain || !params.toChain) {
    return {
      valid: false,
      error: 'Bridge requires amount, token, from chain, and to chain',
    }
  }

  const result = BridgeParamsParseSchema.safeParse(params)
  if (!result.success) {
    const errors = result.error.issues
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join(', ')
    return { valid: false, error: errors }
  }

  return { valid: true }
}

export function validateLimitOrderParams(params: ParsedLimitOrderParams): {
  valid: boolean
  error?: string
} {
  if (!params.amount || !params.from || !params.to || !params.price) {
    return {
      valid: false,
      error: 'Limit order requires amount, from token, to token, and price',
    }
  }

  const result = LimitOrderParamsParseSchema.safeParse(params)
  if (!result.success) {
    const errors = result.error.issues
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join(', ')
    return { valid: false, error: errors }
  }

  return { valid: true }
}
