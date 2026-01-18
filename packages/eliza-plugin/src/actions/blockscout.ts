/**
 * POLL_BLOCKSCOUT Action
 *
 * Discovers recently verified smart contracts on Base chain via Blockscout RPC API.
 * Supports timestamp-based filtering for continuous monitoring.
 */

import type {
  Action,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core'
import { z } from 'zod'
import { fetchWithTimeout, isUrlSafeToFetch } from '../validation'

// Blockscout API base URL for Base chain
const BLOCKSCOUT_BASE_URL = 'https://base.blockscout.com'

// Schema for address object in Blockscout response
const blockscoutAddressSchema = z.object({
  hash: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  name: z.string().nullable(),
  is_verified: z.boolean().optional(),
  is_contract: z.boolean().optional(),
})

// Schema for individual contract item in list response
const blockscoutContractItemSchema = z.object({
  address: blockscoutAddressSchema,
  compiler_version: z.string().optional(),
  verified_at: z.string(),
  language: z.string().optional(),
  optimization_enabled: z.boolean().optional(),
  license_type: z.string().optional(),
})

// Schema for pagination params
const blockscoutNextPageParamsSchema = z
  .object({
    items_count: z.number(),
    smart_contract_id: z.number(),
  })
  .nullable()
  .optional()

// Schema for the full API response
const blockscoutContractsResponseSchema = z.object({
  items: z.array(blockscoutContractItemSchema),
  next_page_params: blockscoutNextPageParamsSchema,
})

// Type exports
export type BlockscoutContractItem = z.infer<
  typeof blockscoutContractItemSchema
>
export type BlockscoutContractsResponse = z.infer<
  typeof blockscoutContractsResponseSchema
>

// Parsed contract info for output
export interface VerifiedContract {
  address: string
  name: string
  verifiedAt: string
  compilerVersion: string
  language: string
  blockscoutUrl: string
}

// Cursor for pagination
export interface BlockscoutCursor {
  itemsCount: number
  smartContractId: number
}

// Action result
export interface PollBlockscoutResult {
  contracts: VerifiedContract[]
  nextCursor: BlockscoutCursor | null
  totalReturned: number
}

/**
 * Build the v2 API URL for verified contracts
 * The v2 API returns actual verification timestamps
 */
function buildContractsApiUrl(): string {
  // Use v2 API which returns verified_at timestamps
  return `${BLOCKSCOUT_BASE_URL}/api/v2/smart-contracts`
}

/**
 * Build the user-facing Blockscout URL for a contract
 */
function buildContractViewUrl(address: string): string {
  return `${BLOCKSCOUT_BASE_URL}/address/${address}`
}

/**
 * Fetch verified contracts from Blockscout v2 API
 * Filters by sinceTimestamp to only return contracts verified after that time
 */
async function fetchVerifiedContracts(
  sinceTimestamp?: number,
  limit = 10,
): Promise<PollBlockscoutResult> {
  const apiUrl = buildContractsApiUrl()

  if (!isUrlSafeToFetch(apiUrl)) {
    throw new Error('URL failed security validation')
  }

  const response = await fetchWithTimeout(
    apiUrl,
    { headers: { Accept: 'application/json' } },
    30000,
  )

  if (!response.ok) {
    throw new Error(
      `Blockscout API error: ${response.status} ${response.statusText}`,
    )
  }

  const json = await response.json()
  const parsed = blockscoutContractsResponseSchema.safeParse(json)

  if (!parsed.success) {
    throw new Error(`Invalid Blockscout response: ${parsed.error.message}`)
  }

  // Filter by sinceTimestamp (only contracts verified after that time)
  // If no sinceTimestamp provided, default to last 24 hours to avoid old contracts
  const effectiveTimestamp =
    sinceTimestamp ?? Math.floor(Date.now() / 1000) - 86400
  const sinceDate = new Date(effectiveTimestamp * 1000)
  const filteredItems = parsed.data.items.filter((item) => {
    const verifiedDate = new Date(item.verified_at)
    return verifiedDate > sinceDate
  })

  const contracts: VerifiedContract[] = filteredItems
    .slice(0, limit)
    .map((item) => ({
      address: item.address.hash,
      name: item.address.name ?? 'Unknown',
      verifiedAt: item.verified_at,
      compilerVersion: item.compiler_version ?? 'unknown',
      language: item.language ?? 'solidity',
      blockscoutUrl: buildContractViewUrl(item.address.hash),
    }))

  // Build cursor from API response
  const nextCursor = parsed.data.next_page_params
    ? {
        itemsCount: parsed.data.next_page_params.items_count,
        smartContractId: parsed.data.next_page_params.smart_contract_id,
      }
    : null

  return {
    contracts,
    nextCursor,
    totalReturned: contracts.length,
  }
}

/**
 * Parse sinceTimestamp from message text or content
 */
function parseSinceTimestamp(message: Memory): number | undefined {
  const content = message.content

  // Check structured content for sinceTimestamp
  if (typeof content.sinceTimestamp === 'number') {
    return content.sinceTimestamp
  }

  // Check for lastTick (from autonomous runner) - convert ms to seconds
  if (typeof content.lastTick === 'number') {
    return Math.floor(content.lastTick / 1000)
  }

  // Check text for timestamp
  const text = (content.text as string) ?? ''
  const timestampMatch = text.match(/sinceTimestamp[=:\s]*(\d+)/i)
  if (timestampMatch) {
    return parseInt(timestampMatch[1], 10)
  }

  return undefined
}

/**
 * Parse limit from message
 */
function parseLimit(message: Memory): number {
  const content = message.content

  // Check structured content
  if (typeof content.limit === 'number') {
    return Math.min(Math.max(content.limit, 1), 50) // Clamp to 1-50
  }

  // Check text
  const text = (content.text as string) ?? ''
  const limitMatch = text.match(/limit[:\s]*(\d+)/i)
  if (limitMatch) {
    const limit = parseInt(limitMatch[1], 10)
    return Math.min(Math.max(limit, 1), 50)
  }

  return 10 // Default
}

/**
 * Format contracts list for display
 */
function formatContractsOutput(result: PollBlockscoutResult): string {
  if (result.contracts.length === 0) {
    return 'No verified contracts found.'
  }

  const lines: string[] = [
    `**Recently Verified Contracts on Base**\n`,
    `Found ${result.totalReturned} contract(s):\n`,
  ]

  for (const contract of result.contracts) {
    const verifiedDate = new Date(contract.verifiedAt).toLocaleString()
    lines.push(
      `- **${contract.name}** (\`${contract.address.slice(0, 10)}...${contract.address.slice(-8)}\`)`,
    )
    lines.push(
      `  Verified: ${verifiedDate} | Compiler: ${contract.compilerVersion}`,
    )
    lines.push(`  [View on Blockscout](${contract.blockscoutUrl})\n`)
  }

  return lines.join('\n')
}

export const pollBlockscoutAction: Action = {
  name: 'POLL_BLOCKSCOUT',
  description:
    'Discover recently verified smart contracts on Base chain from Blockscout',
  similes: [
    'poll blockscout',
    'list verified contracts',
    'find new contracts',
    'discover contracts',
    'check blockscout',
    'get verified contracts',
    'blockscout contracts',
  ],

  validate: async (_runtime: IAgentRuntime): Promise<boolean> => true,

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const sinceTimestamp = parseSinceTimestamp(message)
    const limit = parseLimit(message)

    // Default to 24h ago if no timestamp provided
    const effectiveTimestamp =
      sinceTimestamp ?? Math.floor(Date.now() / 1000) - 86400
    const sinceDate = new Date(effectiveTimestamp * 1000)

    callback?.({
      text: `Fetching contracts verified since ${sinceDate.toISOString()}...`,
    })

    try {
      const result = await fetchVerifiedContracts(sinceTimestamp, limit)

      callback?.({
        text: formatContractsOutput(result),
        content: {
          type: 'blockscout_contracts',
          ...result,
        },
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      callback?.({
        text: `Failed to fetch contracts from Blockscout: ${errorMessage}`,
      })
    }
  },

  examples: [
    [
      {
        name: 'user',
        content: {
          text: 'Poll blockscout for new verified contracts',
        },
      },
      {
        name: 'agent',
        content: {
          text: '**Recently Verified Contracts on Base**\n\nFound 10 contract(s):\n\n- **MetalToken** (`0x8538fE88...AB621CE07616`)\n  Verified: 1/7/2025, 7:32:49 PM | Compiler: 0.8.30...',
        },
      },
    ],
    [
      {
        name: 'user',
        content: {
          text: 'Get contracts verified since sinceTimestamp=1736280000',
        },
      },
      {
        name: 'agent',
        content: {
          text: '**Recently Verified Contracts on Base**\n\nFound 10 contract(s):\n\n- **PaidCounter** (`0xc89E9cB6...091A8C13436E`)...',
        },
      },
    ],
  ],
}
