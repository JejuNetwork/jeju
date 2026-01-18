/**
 * IPFS Metadata Fetching Utility
 *
 * Shared logic for fetching agent character metadata from IPFS
 */

import { z } from 'zod'
import { config } from '../config'

// Schema for agent character metadata from IPFS
export const AgentCharacterSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    topics: z.array(z.string()).optional(),
  })
  .passthrough() // Allow additional fields

export type AgentCharacter = z.infer<typeof AgentCharacterSchema>

/**
 * Parse tokenURI to extract character CID
 * Format: ipfs://QmXxx...#state=QmYyy...
 */
export function parseTokenUriForCid(tokenUri: string): string | null {
  if (!tokenUri || !tokenUri.startsWith('ipfs://')) return null
  const [base] = tokenUri.split('#')
  const cid = base?.replace('ipfs://', '')
  return cid && cid.length > 0 ? cid : null
}

/**
 * Fetch agent character metadata from IPFS with timeout
 * Returns null on any failure (timeout, network error, invalid data)
 *
 * @param tokenUri - The token URI in format ipfs://QmXxx...#state=QmYyy...
 * @param agentId - The agent ID for logging purposes
 * @param timeoutMs - Timeout in milliseconds (default: 5000)
 */
export async function fetchAgentMetadata(
  tokenUri: string,
  agentId: string,
  timeoutMs = 5000,
): Promise<AgentCharacter | null> {
  const cid = parseTokenUriForCid(tokenUri)
  if (!cid) {
    console.warn(`[IPFS] Invalid tokenURI for agent ${agentId}: ${tokenUri}`)
    return null
  }

  try {
    // Use AbortController for timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    const url = `${config.ipfsGateway}/ipfs/${cid}`
    console.log(`[IPFS] Fetching metadata for agent ${agentId} from ${url}`)

    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timeoutId)

    if (!response.ok) {
      console.warn(
        `[IPFS] Failed to fetch metadata for agent ${agentId}: HTTP ${response.status}`,
      )
      return null
    }

    const data = await response.json()
    const result = AgentCharacterSchema.safeParse(data)

    if (!result.success) {
      console.warn(
        `[IPFS] Invalid metadata for agent ${agentId}: ${result.error.message}`,
      )
      return null
    }

    console.log(
      `[IPFS] Successfully fetched metadata for agent ${agentId}: name="${result.data.name}"`,
    )
    return result.data
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn(`[IPFS] Timeout fetching metadata for agent ${agentId}`)
    } else {
      console.warn(
        `[IPFS] Error fetching metadata for agent ${agentId}:`,
        error,
      )
    }
    return null
  }
}
