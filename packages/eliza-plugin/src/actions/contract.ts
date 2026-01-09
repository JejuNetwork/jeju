/**
 * Contract Actions - Fetch Solidity source from GitHub
 */

import type {
  Action,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core'
import { fetchWithTimeout, isUrlSafeToFetch, truncateOutput } from '../validation'

// Domain allowlist for security
const ALLOWED_DOMAINS = new Set([
  'raw.githubusercontent.com',
  'gist.githubusercontent.com',
])

function isAllowedDomain(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    return ALLOWED_DOMAINS.has(url.hostname)
  } catch {
    return false
  }
}

export const fetchContractAction: Action = {
  name: 'FETCH_CONTRACT',
  description: 'Fetch Solidity contract source code from a GitHub raw URL for security analysis',
  similes: [
    'fetch contract',
    'get contract source',
    'read contract',
    'analyze contract at',
    'review code from',
  ],

  validate: async (_runtime: IAgentRuntime): Promise<boolean> => true,

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const text = message.content.text as string

    // Extract URL
    const urlMatch = text.match(/https?:\/\/[^\s]+/)
    if (!urlMatch) {
      callback?.({ text: 'Please provide a GitHub raw URL to a Solidity contract.' })
      return
    }

    const targetUrl = urlMatch[0]

    // Security: SSRF protection
    if (!isUrlSafeToFetch(targetUrl)) {
      callback?.({ text: 'Cannot fetch from internal or private URLs.' })
      return
    }

    // Security: Domain allowlist
    if (!isAllowedDomain(targetUrl)) {
      callback?.({
        text: `Only GitHub raw URLs are allowed. Supported domains: ${[...ALLOWED_DOMAINS].join(', ')}`,
      })
      return
    }

    callback?.({ text: `Fetching contract from ${targetUrl}...` })

    // Fetch with timeout (30s)
    const response = await fetchWithTimeout(targetUrl, {}, 30000)

    if (!response.ok) {
      callback?.({ text: `Failed to fetch: ${response.status} ${response.statusText}` })
      return
    }

    const content = await response.text()

    // Size limit: 50KB for contracts (reasonable for analysis)
    const MAX_CONTRACT_SIZE = 50 * 1024
    if (content.length > MAX_CONTRACT_SIZE) {
      callback?.({
        text: `Contract too large (${content.length} bytes). Maximum size is ${MAX_CONTRACT_SIZE} bytes.`,
      })
      return
    }

    // Return full source (truncated for display safety)
    const displayContent = truncateOutput(content, 50000)

    callback?.({
      text: `Contract source (${content.length} bytes):\n\n\`\`\`solidity\n${displayContent}\n\`\`\``,
      content: {
        url: targetUrl,
        size: content.length,
        source: content,
      },
    })
  },

  examples: [
    [
      { name: 'user', content: { text: 'Fetch contract from https://raw.githubusercontent.com/...' } },
      { name: 'agent', content: { text: 'Contract source (1234 bytes):\n\n```solidity\n// SPDX-License-Identifier...' } },
    ],
  ],
}
