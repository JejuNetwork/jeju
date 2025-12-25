/**
 * Type Guards and Constants
 *
 * Only wallet-specific helpers are defined here.
 */

import type { Memory } from '@elizaos/core'
import { hasKey, isPlainObject } from '@jejunetwork/types'
import type { Hex } from 'viem'

/** Empty calldata constant */
export const EMPTY_CALLDATA: Hex = '0x'

// ============================================================================
// ElizaOS Message Helpers (Wallet-specific)
// ============================================================================

/**
 * Extract text content from ElizaOS Memory
 * Handles the dynamic content structure safely
 */
export function getMessageText(message: Memory): string {
  const content = message.content
  if (typeof content === 'string') {
    return content
  }
  if (isPlainObject(content) && hasKey(content, 'text')) {
    const text = content.text
    return typeof text === 'string' ? text : ''
  }
  return ''
}
