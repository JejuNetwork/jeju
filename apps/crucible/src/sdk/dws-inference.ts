/**
 * DWS Inference - Direct DWS compute calls
 *
 * This module provides direct access to DWS inference for cases
 * where the full ElizaOS runtime isn't needed.
 *
 * All inference goes through DWS - fully decentralized.
 */

import {
  checkDWSHealth,
  dwsChatCompletion,
  getSharedDWSClient,
} from '../client/dws'

/**
 * Generate text using DWS inference
 */
export async function dwsGenerate(
  prompt: string,
  systemPrompt: string,
  options: { maxTokens?: number; temperature?: number; model?: string } = {},
): Promise<string> {
  const response = await dwsChatCompletion(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    {
      model: options.model ?? 'llama-3.1-8b-instant',
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? 500,
    },
  )

  return response.choices[0]?.message?.content ?? ''
}

/**
 * Check if DWS compute is available
 */
export async function checkDWSCompute(): Promise<boolean> {
  return checkDWSHealth()
}

// Re-export for convenience
export { getSharedDWSClient, checkDWSHealth, dwsChatCompletion }
