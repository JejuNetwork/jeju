/**
 * Agent utilities
 * Shared business logic for agent-related operations
 */

import { query, type RegisteredAgent } from '../db'

/**
 * Get agents by tag from SQLit
 * SQLit stores tags as JSON string, so we search with LIKE
 */
export async function getAgentsByTag(
  tag: string,
  limit: number,
): Promise<{ tag: string; agents: RegisteredAgent[] }> {
  if (!tag || tag.trim().length === 0) {
    throw new Error('tag is required and must be a non-empty string')
  }
  if (limit <= 0) {
    throw new Error(`Invalid limit: ${limit}. Must be a positive number.`)
  }

  const normalizedTag = tag.toLowerCase()

  // SQLit stores tags as JSON string, search with LIKE
  const result = await query<RegisteredAgent>(
    `SELECT * FROM registered_agent 
     WHERE tags LIKE ? AND active = 1
     ORDER BY stake_amount DESC
     LIMIT ?`,
    [`%"${normalizedTag}"%`, limit],
  )

  return {
    tag: normalizedTag,
    agents: result.rows,
  }
}
