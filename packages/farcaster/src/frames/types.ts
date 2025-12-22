import type { Address, Hex } from 'viem'
import { z } from 'zod'
import { AddressSchema } from '../hub/schemas'

export type { FrameActionPayload } from '../hub/schemas'

import type { FrameActionPayload } from '../hub/schemas'

export type FrameMessage = FrameActionPayload['untrustedData']

export interface FrameMetadata {
  version: 'vNext'
  image: string
  imageAspectRatio?: '1.91:1' | '1:1'
  buttons?: FrameButton[]
  inputText?: string
  postUrl?: string
  state?: string
}

export interface FrameButton {
  label: string
  action?: 'post' | 'post_redirect' | 'link' | 'mint' | 'tx'
  target?: string
}

export interface FrameValidationResult {
  isValid: boolean
  message?: FrameMessage
  error?: string
}

export interface FrameTransactionTarget {
  chainId: string
  method: 'eth_sendTransaction'
  params: FrameTransactionParams
}

export interface FrameTransactionParams {
  to: Address
  value?: Hex
  data?: Hex
  attribution?: boolean
}

export const JejuBridgeFrameStateSchema = z
  .object({
    sourceChain: z.number().int().positive(),
    targetChain: z.number().int().positive(),
    token: AddressSchema,
    amount: z.string().min(1).regex(/^\d+$/),
    recipient: AddressSchema.optional(),
  })
  .strict()

export const JejuSwapFrameStateSchema = z
  .object({
    tokenIn: AddressSchema,
    tokenOut: AddressSchema,
    amountIn: z.string().min(1).regex(/^\d+$/),
    slippage: z.number().min(0).max(100),
  })
  .strict()

export const JejuAgentFrameStateSchema = z
  .object({
    agentId: AddressSchema,
    action: z.enum(['view', 'delegate', 'hire']),
  })
  .strict()

export type JejuBridgeFrameState = z.infer<typeof JejuBridgeFrameStateSchema>
export type JejuSwapFrameState = z.infer<typeof JejuSwapFrameStateSchema>
export type JejuAgentFrameState = z.infer<typeof JejuAgentFrameStateSchema>

export interface FrameResponse {
  html: string
  metadata: FrameMetadata
}

export interface FrameErrorResponse {
  error: string
  code?: string
}

/**
 * Escape HTML special characters to prevent XSS attacks
 */
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function generateFrameMetaTags(metadata: FrameMetadata): string {
  const tags: string[] = [
    `<meta property="fc:frame" content="${escapeHtml(metadata.version)}" />`,
    `<meta property="fc:frame:image" content="${escapeHtml(metadata.image)}" />`,
  ]

  if (metadata.imageAspectRatio) {
    tags.push(
      `<meta property="fc:frame:image:aspect_ratio" content="${escapeHtml(metadata.imageAspectRatio)}" />`,
    )
  }

  if (metadata.postUrl) {
    tags.push(
      `<meta property="fc:frame:post_url" content="${escapeHtml(metadata.postUrl)}" />`,
    )
  }

  if (metadata.inputText) {
    tags.push(
      `<meta property="fc:frame:input:text" content="${escapeHtml(metadata.inputText)}" />`,
    )
  }

  if (metadata.state) {
    tags.push(
      `<meta property="fc:frame:state" content="${encodeURIComponent(metadata.state)}" />`,
    )
  }

  if (metadata.buttons) {
    metadata.buttons.forEach((button, index) => {
      const i = index + 1
      tags.push(
        `<meta property="fc:frame:button:${i}" content="${escapeHtml(button.label)}" />`,
      )
      if (button.action) {
        tags.push(
          `<meta property="fc:frame:button:${i}:action" content="${escapeHtml(button.action)}" />`,
        )
      }
      if (button.target) {
        tags.push(
          `<meta property="fc:frame:button:${i}:target" content="${escapeHtml(button.target)}" />`,
        )
      }
    })
  }

  return tags.join('\n')
}

export function createFrameResponse(
  metadata: FrameMetadata,
  title = 'Jeju Frame',
): string {
  const safeTitle = escapeHtml(title)
  const safeImage = escapeHtml(metadata.image)
  return `<!DOCTYPE html>
<html>
<head>
  <title>${safeTitle}</title>
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:image" content="${safeImage}" />
  ${generateFrameMetaTags(metadata)}
</head>
<body>
  <h1>${safeTitle}</h1>
</body>
</html>`
}

export function parseFrameState<T>(
  state: string | undefined,
  schema: z.ZodType<T>,
): T | null {
  if (!state) return null
  const decoded = decodeURIComponent(state)
  const result = schema.safeParse(JSON.parse(decoded))
  if (!result.success) return null
  return result.data
}

export function encodeFrameState<T>(state: T): string {
  return encodeURIComponent(JSON.stringify(state))
}
