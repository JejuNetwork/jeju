/**
 * DWS Inference - Direct DWS compute calls
 *
 * This module provides direct access to DWS inference for cases
 * where the full ElizaOS runtime isn't needed.
 *
 * All inference goes through DWS - fully decentralized.
 */

import { getCurrentNetwork, getDWSComputeUrl } from '@jejunetwork/config'

function getDWSEndpoint(): string {
  return process.env.DWS_URL ?? getDWSComputeUrl()
}

/**
 * Generate text using DWS inference
 */
export async function dwsGenerate(
  prompt: string,
  systemPrompt: string,
  options: { maxTokens?: number; temperature?: number; model?: string } = {},
): Promise<string> {
  const endpoint = getDWSEndpoint()
  const r = await fetch(`${endpoint}/compute/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: options.model ?? 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 500,
    }),
  })

  if (!r.ok) {
    const network = getCurrentNetwork()
    const errorText = await r.text()
    throw new Error(
      `DWS compute error (network: ${network}): ${r.status} - ${errorText}`,
    )
  }

  const data = (await r.json()) as {
    choices?: Array<{ message?: { content: string } }>
    content?: string
  }
  return data.choices?.[0]?.message?.content ?? data.content ?? ''
}

/**
 * Check if DWS compute is available
 */
export async function checkDWSCompute(): Promise<boolean> {
  const endpoint = getDWSEndpoint()
  try {
    const r = await fetch(`${endpoint}/health`, {
      signal: AbortSignal.timeout(2000),
    })
    return r?.ok ?? false
  } catch {
    return false
  }
}
