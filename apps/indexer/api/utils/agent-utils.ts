/**
 * Agent utilities
 * Shared business logic for agent-related operations
 */

import type { DataSource } from 'typeorm'
import { RegisteredAgent } from '../model'

export async function getAgentsByTag(
  dataSource: DataSource,
  tag: string,
  limit: number,
): Promise<{ tag: string; agents: RegisteredAgent[] }> {
  if (!dataSource) {
    throw new Error('DataSource is required')
  }
  if (!tag || tag.trim().length === 0) {
    throw new Error('tag is required and must be a non-empty string')
  }
  if (limit <= 0) {
    throw new Error(`Invalid limit: ${limit}. Must be a positive number.`)
  }

  const normalizedTag = tag.toLowerCase()

  const agents = await dataSource
    .getRepository(RegisteredAgent)
    .createQueryBuilder('a')
    .where(':tag = ANY(a.tags)', { tag: normalizedTag })
    .andWhere('a.active = true')
    .orderBy('a.stakeTier', 'DESC')
    .take(limit)
    .getMany()

  return {
    tag: normalizedTag,
    agents,
  }
}
