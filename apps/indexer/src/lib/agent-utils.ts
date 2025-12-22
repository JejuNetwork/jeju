/**
 * Agent utilities
 * Shared business logic for agent-related operations
 */

import { DataSource } from 'typeorm';
import { RegisteredAgent } from '../model';

export async function getAgentsByTag(
  dataSource: DataSource,
  tag: string,
  limit: number
): Promise<{ tag: string; agents: RegisteredAgent[] }> {
  if (!dataSource) {
    throw new Error('DataSource is required');
  }
  if (!tag || typeof tag !== 'string' || tag.trim().length === 0) {
    throw new Error('tag is required and must be a non-empty string');
  }
  if (typeof limit !== 'number' || limit <= 0) {
    throw new Error(`Invalid limit: ${limit}. Must be a positive number.`);
  }

  const normalizedTag = tag.toLowerCase();
  
  const agents = await dataSource.getRepository(RegisteredAgent)
    .createQueryBuilder('a')
    .where(':tag = ANY(a.tags)', { tag: normalizedTag })
    .andWhere('a.active = true')
    .orderBy('a.stakeTier', 'DESC')
    .take(limit)
    .getMany();

  return {
    tag: normalizedTag,
    agents,
  };
}
